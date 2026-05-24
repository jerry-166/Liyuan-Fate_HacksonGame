"""
会话状态管理器。

职责：
  - 内存热数据：dict[session_id → GameSession]，O(1) 读写
  - 冷数据持久化：SQLite 存储对话历史、事件日志
  - Session 生命周期：lazy loading、TTL 自动淘汰
  - 健康监控：active_sessions 计数
"""

import time
import uuid
import logging
from typing import Optional

from config import SESSION_TTL_SECONDS, NPC_DEFS
from state.session import GameSession, NPCState
from storage.database import get_db

logger = logging.getLogger(__name__)


class SessionManager:
    """全局会话状态管理器（单例）。"""

    def __init__(self):
        self._sessions: dict[str, GameSession] = {}
        self._db = get_db()

    @property
    def active_count(self) -> int:
        """活跃会话数。"""
        self._evict_expired()
        return len(self._sessions)

    # ─── Session 生命周期 ───────────────────────────────

    def create(self, player_name: str = "玩家", api_key: Optional[str] = None, model: Optional[str] = None) -> GameSession:
        """创建新游戏会话，返回完整 GameSession 对象。"""
        session_id = f"sess_{uuid.uuid4().hex[:8]}"
        session = GameSession(
            session_id=session_id,
            player_name=player_name,
            api_key=api_key,
            model=model,
            last_active_at=time.time(),
        )
        # 初始化 NPC 状态
        for npc_def in NPC_DEFS:
            npc = NPCState(**npc_def)
            npc.current_greeting = self._default_greeting(npc.id)
            session.npcs[npc.id] = npc

        self._sessions[session_id] = session
        self._db.create_session(session_id, player_name, stage=1)
        # 持久化初始 NPC 状态
        self._db.save_npc_states_batch(session_id, session.npcs)
        logger.info(f"[SessionManager] Created session: {session_id} (player={player_name})")
        return session

    def get(self, session_id: str) -> Optional[GameSession]:
        """获取会话（先从内存查找；未命中则从 SQLite 重建）。"""
        self._evict_expired()

        # 内存命中
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.last_active_at = time.time()
            return session

        # 从 SQLite 重建
        row = self._db.get_session(session_id)
        if row is None:
            return None

        session = self._rebuild_from_db(row)
        self._sessions[session_id] = session
        logger.info(f"[SessionManager] Rebuilt session {session_id} from DB")
        return session

    def _rebuild_from_db(self, row: dict) -> GameSession:
        """从数据库行重建 GameSession 对象。"""
        session_id = row["session_id"]
        session = GameSession(
            session_id=session_id,
            player_name=row.get("player_name", "玩家"),
            current_stage=row.get("current_stage", 1),
            game_ended=bool(row.get("game_ended", 0)),
            ending_type=row.get("ending_type"),
            last_active_at=time.time(),
        )
        # 重建 ending_data
        if row.get("ending_data"):
            import json
            try:
                session.ending_data = json.loads(row["ending_data"])
            except json.JSONDecodeError:
                pass

        # 重建 NPC 状态：先从 npc_states 表恢复持久化数据
        saved_npcs = {r["npc_id"]: r for r in self._db.load_npc_states(session_id)}
        for npc_def in NPC_DEFS:
            npc_id = npc_def["id"]
            npc = NPCState(**npc_def)
            if npc_id in saved_npcs:
                saved = saved_npcs[npc_id]
                npc.relationship = saved.get("relationship", 0)
                npc.is_available = bool(saved.get("is_available", 1))
                npc.current_greeting = saved.get("current_greeting", "") or self._default_greeting(npc_id)
                npc.dialogue_round_count = saved.get("dialogue_round_count", 0)
            else:
                npc.current_greeting = self._default_greeting(npc_id)
            session.npcs[npc_id] = npc

        # 从 DB 恢复事件列表
        events = self._db.get_events(session_id)
        for evt in events:
            session.events_triggered.add(evt["event_id"])

        # 从 DB 恢复对话历史（最近 10 轮）到每个 NPC 的内存
        dialogues = self._db.get_dialogue_history(session_id, limit=10)
        for d in dialogues:
            npc_id = d["npc_id"]
            if npc_id in session.npcs:
                from state.session import DialogueTurn
                session.npcs[npc_id].dialogue_history.append(DialogueTurn(
                    role=d["role"],
                    content=d["content"],
                    npc_id=npc_id,
                    stage=d.get("stage", session.current_stage),
                ))

        return session

    def persist_dialogue(self, session: GameSession, npc_id: str, role: str, content: str,
                         options: list[str] = None) -> int:
        """持久化一条对话记录（含选项），返回 dialogue_id。"""
        return self._db.save_dialogue(session.session_id, npc_id, role, content, session.current_stage, options=options)

    def persist_event(self, session: GameSession, event_id: str, description: str = "",
                      triggered_by_npc: str = "") -> None:
        """持久化一个事件。"""
        self._db.save_event(
            session.session_id, event_id, description,
            triggered_by_npc, session.current_stage
        )

    def persist_session(self, session: GameSession) -> None:
        """将内存状态同步到 SQLite（含 session + NPC 状态）。"""
        self._db.update_session(
            session.session_id,
            stage=session.current_stage,
            game_ended=session.game_ended,
            ending_type=session.ending_type,
            ending_data=session.ending_data,
        )
        # 同步所有 NPC 状态
        self._db.save_npc_states_batch(session.session_id, session.npcs)

    def persist_npc_state(self, session: GameSession, npc_id: str) -> None:
        """持久化单个 NPC 状态。"""
        npc = session.npcs.get(npc_id)
        if not npc:
            return
        self._db.save_npc_state(
            session.session_id, npc_id,
            relationship=npc.relationship,
            is_available=npc.is_available,
            current_greeting=npc.current_greeting,
            dialogue_round_count=npc.dialogue_round_count,
        )

    def persist_relationship_log(
        self,
        session: GameSession,
        npc_id: str,
        delta: int,
        old_value: int,
        new_value: int,
        reason: str = "",
        dialogue_id: int = None,
    ) -> None:
        """持久化关系值变化日志。"""
        self._db.save_relationship_log(
            session.session_id, npc_id, delta, old_value, new_value,
            reason=reason, dialogue_id=dialogue_id,
        )

    def persist_player_choice(
        self,
        session: GameSession,
        npc_id: str,
        choice_text: str,
        available_options: list[str] = None,
        dialogue_id: int = None,
    ) -> None:
        """持久化玩家选择记录。"""
        self._db.save_player_choice(
            session.session_id, npc_id, choice_text,
            available_options=available_options,
            dialogue_id=dialogue_id,
            stage=session.current_stage,
        )

    def persist_stage_history(
        self,
        session: GameSession,
        from_stage: int,
        to_stage: int,
        reason: str = "",
    ) -> None:
        """持久化阶段切换历史。"""
        self._db.save_stage_history(
            session.session_id, from_stage, to_stage, reason,
        )

    def list_sessions(self) -> list[dict]:
        """列出所有未删除的存档摘要。"""
        return self._db.list_sessions()

    def soft_delete(self, session_id: str) -> bool:
        """软删除会话（同时从内存移除）。"""
        ok = self._db.soft_delete_session(session_id)
        if ok:
            self._sessions.pop(session_id, None)
        return ok

    # ─── TTL 淘汰 ───────────────────────────────────────

    def _evict_expired(self) -> None:
        """淘汰超过 TTL 的会话（仅从内存移除，SQLite 保留完整数据）。"""
        now = time.time()
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.last_active_at > SESSION_TTL_SECONDS
        ]
        for sid in expired:
            logger.info(f"[SessionManager] Evicting expired session: {sid}")
            del self._sessions[sid]

    # ─── 辅助 ───────────────────────────────────────────

    def _default_greeting(self, npc_id: str) -> str:
        """NPC 初始问候语（阶段 1 默认）。"""
        greetings = {
            "npc_chen": "……（陈师傅低头擦拭琴弦，仿佛没看见你）",
            "npc_xiaohua": "你也是来看戏班笑话的吗？",
        }
        return greetings.get(npc_id, "…")


# 全局单例
_manager: Optional[SessionManager] = None


def get_session_manager() -> SessionManager:
    global _manager
    if _manager is None:
        _manager = SessionManager()
    return _manager
