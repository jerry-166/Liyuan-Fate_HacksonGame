"""
会话状态管理器 — v2 集成 ScriptLoader + 章节/物品持久化。
"""

import time
import uuid
import logging
from typing import Optional

from config import SESSION_TTL_SECONDS, NPC_DEFS, DEFAULT_SCRIPT_ID
from state.session import GameSession, NPCState, NarrativeItem, TaskInstance
from storage.database import get_db

logger = logging.getLogger(__name__)


class SessionManager:

    def __init__(self):
        self._sessions: dict[str, GameSession] = {}
        self._db = get_db()

    @property
    def active_count(self) -> int:
        self._evict_expired()
        return len(self._sessions)

    def create(self, player_name: str = "玩家", api_key: Optional[str] = None,
               model: Optional[str] = None, script_id: str = DEFAULT_SCRIPT_ID) -> GameSession:
        session_id = f"sess_{uuid.uuid4().hex[:8]}"
        session = GameSession(
            session_id=session_id,
            player_name=player_name,
            api_key=api_key,
            model=model,
            last_active_at=time.time(),
        )

        # 加载剧本
        from data.script_loader import ScriptLoader
        loader = ScriptLoader()
        try:
            script_data = loader.load_script(script_id)
            session.script_id = script_id
            session.system_prompt = script_data.get("system_prompt", "")
            session.chapter_defs = script_data.get("chapters", [])
            session.item_defs = script_data.get("items", [])
            session.persona_cache = script_data.get("personas", {})

            # 使用剧本中的 NPC 定义（如果有的话）
            meta_npcs = script_data.get("meta", {}).get("npcs", [])
            npc_defs_to_use = meta_npcs if meta_npcs else NPC_DEFS

            for npc_def in npc_defs_to_use:
                npc = NPCState(
                    id=npc_def["id"],
                    name=npc_def.get("name", ""),
                    role=npc_def.get("role", ""),
                    scene=npc_def.get("scene", ""),
                    position=npc_def.get("position", {}),
                    sprite_key=npc_def.get("sprite_key", ""),
                    relationship_default=npc_def.get("relationship_default", 0),
                )
                npc.relationship = npc.relationship_default
                npc.current_greeting = self._default_greeting(npc.id)
                session.npcs[npc.id] = npc
        except Exception as e:
            logger.error(f"[SessionManager] 剧本加载失败 {script_id}: {e}, 使用默认配置")
            # 兜底：使用硬编码 NPC
            for npc_def in NPC_DEFS:
                npc = NPCState(**npc_def)
                npc.current_greeting = self._default_greeting(npc.id)
                session.npcs[npc.id] = npc

        self._sessions[session_id] = session
        self._db.create_session(session_id, player_name, script_id=script_id)
        self._db.save_npc_states_batch(session_id, session.npcs)
        logger.info(f"[SessionManager] Created: {session_id} (script={script_id})")
        return session

    def get(self, session_id: str) -> Optional[GameSession]:
        self._evict_expired()
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.last_active_at = time.time()
            return session

        row = self._db.get_session(session_id)
        if row is None:
            return None

        session = self._rebuild_from_db(row)
        self._sessions[session_id] = session
        logger.info(f"[SessionManager] Rebuilt {session_id} from DB")
        return session

    def _rebuild_from_db(self, row: dict) -> GameSession:
        session_id = row["session_id"]
        script_id = row.get("script_id", DEFAULT_SCRIPT_ID)

        session = GameSession(
            session_id=session_id,
            player_name=row.get("player_name", "玩家"),
            current_stage=row.get("current_stage", 1),
            game_ended=bool(row.get("game_ended", 0)),
            ending_type=row.get("ending_type"),
            script_id=script_id,
            current_chapter_id=row.get("current_chapter_id"),
            active_item=row.get("active_item"),
            last_active_at=time.time(),
        )

        if row.get("ending_data"):
            import json
            try:
                session.ending_data = json.loads(row["ending_data"])
            except json.JSONDecodeError:
                pass

        # 加载剧本数据
        from data.script_loader import ScriptLoader
        try:
            loader = ScriptLoader()
            script_data = loader.load_script(script_id)
            session.system_prompt = script_data.get("system_prompt", "")
            session.chapter_defs = script_data.get("chapters", [])
            session.item_defs = script_data.get("items", [])
            session.persona_cache = script_data.get("personas", {})
            meta_npcs = script_data.get("meta", {}).get("npcs", [])
            npc_defs_to_use = meta_npcs if meta_npcs else NPC_DEFS
        except Exception:
            npc_defs_to_use = NPC_DEFS

        # 重建 NPC
        saved_npcs = {r["npc_id"]: r for r in self._db.load_npc_states(session_id)}
        for npc_def in npc_defs_to_use:
            npc_id = npc_def["id"]
            npc = NPCState(
                id=npc_id,
                name=npc_def.get("name", ""),
                role=npc_def.get("role", ""),
                scene=npc_def.get("scene", ""),
                position=npc_def.get("position", {}),
                sprite_key=npc_def.get("sprite_key", ""),
                relationship_default=npc_def.get("relationship_default", 0),
            )
            if npc_id in saved_npcs:
                saved = saved_npcs[npc_id]
                npc.relationship = saved.get("relationship", 0)
                npc.is_available = bool(saved.get("is_available", 1))
                npc.current_greeting = saved.get("current_greeting", "") or self._default_greeting(npc_id)
                npc.dialogue_round_count = saved.get("dialogue_round_count", 0)
            else:
                npc.relationship = npc.relationship_default
                npc.current_greeting = self._default_greeting(npc_id)
            session.npcs[npc_id] = npc

        # 恢复事件
        events = self._db.get_events(session_id)
        for evt in events:
            session.events_triggered.add(evt["event_id"])

        # 恢复对话历史
        dialogues = self._db.get_dialogue_history(session_id, limit=10)
        for d in dialogues:
            npc_id = d["npc_id"]
            if npc_id in session.npcs:
                from state.session import DialogueTurn
                session.npcs[npc_id].dialogue_history.append(DialogueTurn(
                    role=d["role"], content=d["content"],
                    npc_id=npc_id, stage=d.get("stage", session.current_stage),
                    chapter_id=session.current_chapter_id or "",
                ))

        # v2: 恢复物品
        try:
            raw_items = self._db.load_narrative_items(session_id)
            for item_dict in raw_items:
                item = NarrativeItem.from_dict(item_dict)
                session.inventory.append(item)
        except Exception:
            pass

        # v2: 恢复任务实例
        try:
            task_dict = self._db.load_task_instance(session_id)
            if task_dict:
                session.current_task = TaskInstance.from_dict(task_dict)
        except Exception:
            pass

        # v2: 恢复已完成章节
        try:
            progress = self._db.load_chapter_progress(session_id)
            for p in progress:
                if p.get("status") == "completed":
                    session.completed_chapters.append(p["chapter_id"])
        except Exception:
            pass

        return session

    def persist_dialogue(self, session, npc_id, role, content, options=None) -> int:
        return self._db.save_dialogue(session.session_id, npc_id, role, content, session.current_stage, options=options)

    def persist_event(self, session, event_id, description="", triggered_by_npc=""):
        self._db.save_event(session.session_id, event_id, description, triggered_by_npc, session.current_stage)

    def persist_session(self, session: GameSession) -> None:
        self._db.update_session(
            session.session_id,
            stage=session.current_stage,
            game_ended=session.game_ended,
            ending_type=session.ending_type,
            ending_data=session.ending_data,
            current_chapter_id=session.current_chapter_id,
            active_item=session.active_item,
        )
        self._db.save_npc_states_batch(session.session_id, session.npcs)

    def persist_npc_state(self, session, npc_id):
        npc = session.npcs.get(npc_id)
        if not npc:
            return
        self._db.save_npc_state(session.session_id, npc_id,
                                npc.relationship, npc.is_available,
                                npc.current_greeting, npc.dialogue_round_count)

    def persist_relationship_log(self, session, npc_id, delta, old_value, new_value,
                                 reason="", dialogue_id=None):
        self._db.save_relationship_log(session.session_id, npc_id, delta, old_value,
                                       new_value, reason, dialogue_id)

    def persist_player_choice(self, session, npc_id, choice_text,
                              available_options=None, dialogue_id=None):
        self._db.save_player_choice(session.session_id, npc_id, choice_text,
                                    available_options, dialogue_id, session.current_stage)

    def persist_stage_history(self, session, from_stage, to_stage, reason=""):
        self._db.save_stage_history(session.session_id, from_stage, to_stage, reason)

    def list_sessions(self) -> list[dict]:
        return self._db.list_sessions()

    def soft_delete(self, session_id: str) -> bool:
        ok = self._db.soft_delete_session(session_id)
        if ok:
            self._sessions.pop(session_id, None)
        return ok

    def _evict_expired(self) -> None:
        now = time.time()
        expired = [sid for sid, s in self._sessions.items()
                   if now - s.last_active_at > SESSION_TTL_SECONDS]
        for sid in expired:
            logger.info(f"[SessionManager] Evicting expired: {sid}")
            del self._sessions[sid]

    def _default_greeting(self, npc_id: str) -> str:
        greetings = {
            "npc_chen": "……（陈师傅低头擦拭琴弦，仿佛没看见你）",
            "npc_xiaohua": "你也是来看戏班笑话的吗？",
            "npc_laozhou": "……",
            "npc_meiyi": "哎呀，来客人了！快坐快坐，喝点什么？",
            "npc_laoli": "过河啊？等着，马上开船。",
        }
        return greetings.get(npc_id, "…")


_manager: Optional[SessionManager] = None


def get_session_manager() -> SessionManager:
    global _manager
    if _manager is None:
        _manager = SessionManager()
    return _manager
