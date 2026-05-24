"""
SQLite 数据库操作封装。

职责：
  - 连接管理 + 建表
  - session 的创建、查询、更新、TTL 淘汰
  - dialogue 的追加写入和历史查询
  - event 的写入和查询
"""

import sqlite3
import json
import time
import os
from typing import Optional
from contextlib import contextmanager

from config import DB_PATH


class Database:
    """SQLite 操作封装（线程安全的连接池简化版）。"""

    def __init__(self, db_path: str = DB_PATH):
        os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)
        self.db_path = db_path
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self):
        """执行建表 SQL + 增量迁移。"""
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        if os.path.exists(schema_path):
            with open(schema_path, "r", encoding="utf-8") as f:
                sql = f.read()
            with self._conn() as conn:
                conn.executescript(sql)
        # 增量迁移：为已存在的表添加新列（SQLite 不支持 IF NOT EXISTS for ALTER TABLE，用 try/except）
        self._migrate()

    def _migrate(self):
        """增量迁移：为旧表添加新列（忽略已存在的列）。"""
        migrations = [
            "ALTER TABLE sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE dialogues ADD COLUMN options TEXT",
        ]
        with self._conn() as conn:
            for sql in migrations:
                try:
                    conn.execute(sql)
                except sqlite3.OperationalError:
                    pass  # 列已存在，忽略

    # ─── Session CRUD ───────────────────────────────────

    def create_session(self, session_id: str, player_name: str = "玩家", stage: int = 1) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO sessions (session_id, player_name, current_stage, updated_at) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (session_id, player_name, stage),
            )

    def list_sessions(self) -> list[dict]:
        """列出所有未删除的存档（仅摘要）。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT session_id, player_name, current_stage, game_ended, "
                "created_at, updated_at FROM sessions "
                "WHERE deleted = 0 ORDER BY updated_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def soft_delete_session(self, session_id: str) -> bool:
        """软删除会话，返回是否成功。"""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE sessions SET deleted = 1, updated_at = CURRENT_TIMESTAMP "
                "WHERE session_id = ? AND deleted = 0",
                (session_id,),
            )
            return cur.rowcount > 0

    def get_session(self, session_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def update_session(
        self,
        session_id: str,
        stage: Optional[int] = None,
        game_ended: Optional[bool] = None,
        ending_type: Optional[str] = None,
        ending_data: Optional[dict] = None,
    ) -> None:
        fields = ["updated_at = CURRENT_TIMESTAMP"]
        params = []
        if stage is not None:
            fields.append("current_stage = ?")
            params.append(stage)
        if game_ended is not None:
            fields.append("game_ended = ?")
            params.append(1 if game_ended else 0)
        if ending_type is not None:
            fields.append("ending_type = ?")
            params.append(ending_type)
        if ending_data is not None:
            fields.append("ending_data = ?")
            params.append(json.dumps(ending_data, ensure_ascii=False))
        params.append(session_id)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE sessions SET {', '.join(fields)} WHERE session_id = ?",
                params,
            )

    # ─── Dialogue CRUD ──────────────────────────────────

    def save_dialogue(
        self, session_id: str, npc_id: str, role: str, content: str, stage: int,
        options: Optional[list[str]] = None,
    ) -> int:
        options_json = json.dumps(options, ensure_ascii=False) if options else None
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO dialogues (session_id, npc_id, role, content, options, stage) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, npc_id, role, content, options_json, stage),
            )
            return cur.lastrowid

    def get_dialogue_history(
        self, session_id: str, npc_id: Optional[str] = None, limit: int = 20
    ) -> list[dict]:
        with self._conn() as conn:
            if npc_id:
                rows = conn.execute(
                    "SELECT * FROM dialogues WHERE session_id = ? AND npc_id = ? "
                    "ORDER BY created_at DESC LIMIT ?",
                    (session_id, npc_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM dialogues WHERE session_id = ? "
                    "ORDER BY created_at DESC LIMIT ?",
                    (session_id, limit),
                ).fetchall()
        # 反转回时间正序
        return [dict(r) for r in reversed(rows)]

    def get_dialogue_history_paginated(
        self, session_id: str, npc_id: Optional[str] = None,
        page: int = 1, page_size: int = 20,
    ) -> dict:
        """分页查询对话历史。返回 {items, total, page, page_size}。"""
        with self._conn() as conn:
            if npc_id:
                count_row = conn.execute(
                    "SELECT COUNT(*) as cnt FROM dialogues WHERE session_id = ? AND npc_id = ?",
                    (session_id, npc_id),
                ).fetchone()
            else:
                count_row = conn.execute(
                    "SELECT COUNT(*) as cnt FROM dialogues WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
            total = count_row["cnt"]

            offset = (page - 1) * page_size
            if npc_id:
                rows = conn.execute(
                    "SELECT * FROM dialogues WHERE session_id = ? AND npc_id = ? "
                    "ORDER BY created_at ASC LIMIT ? OFFSET ?",
                    (session_id, npc_id, page_size, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM dialogues WHERE session_id = ? "
                    "ORDER BY created_at ASC LIMIT ? OFFSET ?",
                    (session_id, page_size, offset),
                ).fetchall()

        items = []
        for r in rows:
            d = dict(r)
            if d.get("options"):
                try:
                    d["options"] = json.loads(d["options"])
                except json.JSONDecodeError:
                    d["options"] = []
            else:
                d["options"] = []
            items.append(d)

        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def get_last_dialogue_per_npc(self, session_id: str) -> dict[str, dict]:
        """获取每个 NPC 最近一条对话（含 options）。返回 {npc_id: {role, content, options, created_at}}。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT d.* FROM dialogues d "
                "INNER JOIN ("
                "  SELECT npc_id, MAX(created_at) AS max_ts "
                "  FROM dialogues WHERE session_id = ? AND role = 'npc' "
                "  GROUP BY npc_id"
                ") latest ON d.npc_id = latest.npc_id AND d.created_at = latest.max_ts "
                "WHERE d.session_id = ?",
                (session_id, session_id),
            ).fetchall()

        result = {}
        for r in rows:
            d = dict(r)
            opts = []
            if d.get("options"):
                try:
                    opts = json.loads(d["options"])
                except json.JSONDecodeError:
                    pass
            result[d["npc_id"]] = {
                "role": d["role"],
                "content": d["content"],
                "options": opts,
                "created_at": str(d.get("created_at", "")),
            }
        return result

    # ─── Event CRUD ─────────────────────────────────────

    def save_event(
        self,
        session_id: str,
        event_id: str,
        description: str = "",
        triggered_by_npc: str = "",
        stage: int = 1,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO events (session_id, event_id, description, triggered_by_npc, stage) "
                "VALUES (?, ?, ?, ?, ?)",
                (session_id, event_id, description, triggered_by_npc, stage),
            )

    def get_events(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT event_id, description, triggered_by_npc, stage, created_at "
                "FROM events WHERE session_id = ? ORDER BY created_at",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]


    # ─── NPC States CRUD ───────────────────────────────

    def save_npc_state(
        self,
        session_id: str,
        npc_id: str,
        relationship: int = 0,
        is_available: bool = True,
        current_greeting: str = "",
        dialogue_round_count: int = 0,
    ) -> None:
        """写入或更新单个 NPC 的运行时状态（UPSERT）。"""
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO npc_states (session_id, npc_id, relationship, is_available, "
                "current_greeting, dialogue_round_count, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(session_id, npc_id) DO UPDATE SET "
                "relationship = excluded.relationship, "
                "is_available = excluded.is_available, "
                "current_greeting = excluded.current_greeting, "
                "dialogue_round_count = excluded.dialogue_round_count, "
                "updated_at = CURRENT_TIMESTAMP",
                (session_id, npc_id, relationship, 1 if is_available else 0,
                 current_greeting, dialogue_round_count),
            )

    def save_npc_states_batch(self, session_id: str, npcs: dict) -> None:
        """批量持久化所有 NPC 状态。npcs: {npc_id: NPCState}。"""
        with self._conn() as conn:
            for npc_id, npc in npcs.items():
                conn.execute(
                    "INSERT INTO npc_states (session_id, npc_id, relationship, is_available, "
                    "current_greeting, dialogue_round_count, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) "
                    "ON CONFLICT(session_id, npc_id) DO UPDATE SET "
                    "relationship = excluded.relationship, "
                    "is_available = excluded.is_available, "
                    "current_greeting = excluded.current_greeting, "
                    "dialogue_round_count = excluded.dialogue_round_count, "
                    "updated_at = CURRENT_TIMESTAMP",
                    (session_id, npc_id, npc.relationship, 1 if npc.is_available else 0,
                     npc.current_greeting, npc.dialogue_round_count),
                )

    def load_npc_states(self, session_id: str) -> list[dict]:
        """加载某个会话下所有 NPC 的持久化状态。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT npc_id, relationship, is_available, current_greeting, "
                "dialogue_round_count FROM npc_states WHERE session_id = ?",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ─── Relationship Log CRUD ──────────────────────────

    def save_relationship_log(
        self,
        session_id: str,
        npc_id: str,
        delta: int,
        old_value: int,
        new_value: int,
        reason: str = "",
        dialogue_id: Optional[int] = None,
    ) -> None:
        """记录一次关系值变化。"""
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO relationship_log (session_id, npc_id, delta, old_value, "
                "new_value, reason, dialogue_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session_id, npc_id, delta, old_value, new_value, reason, dialogue_id),
            )

    def get_relationship_log(self, session_id: str, npc_id: Optional[str] = None) -> list[dict]:
        """查询关系值变化历史。"""
        with self._conn() as conn:
            if npc_id:
                rows = conn.execute(
                    "SELECT * FROM relationship_log WHERE session_id = ? AND npc_id = ? "
                    "ORDER BY created_at ASC",
                    (session_id, npc_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM relationship_log WHERE session_id = ? "
                    "ORDER BY created_at ASC",
                    (session_id,),
                ).fetchall()
        return [dict(r) for r in rows]

    # ─── Player Choices CRUD ────────────────────────────

    def save_player_choice(
        self,
        session_id: str,
        npc_id: str,
        choice_text: str,
        available_options: list[str] = None,
        dialogue_id: Optional[int] = None,
        stage: int = 1,
    ) -> None:
        """记录一次玩家选择。"""
        options_json = json.dumps(available_options, ensure_ascii=False) if available_options else None
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO player_choices (session_id, npc_id, choice_text, "
                "available_options, dialogue_id, stage) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, npc_id, choice_text, options_json, dialogue_id, stage),
            )

    def get_player_choices(self, session_id: str) -> list[dict]:
        """查询玩家选择历史。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM player_choices WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("available_options"):
                try:
                    d["available_options"] = json.loads(d["available_options"])
                except json.JSONDecodeError:
                    d["available_options"] = []
            result.append(d)
        return result

    # ─── Stage History CRUD ─────────────────────────────

    def save_stage_history(
        self,
        session_id: str,
        from_stage: int,
        to_stage: int,
        reason: str = "",
    ) -> None:
        """记录一次阶段切换。"""
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO stage_history (session_id, from_stage, to_stage, reason) "
                "VALUES (?, ?, ?, ?)",
                (session_id, from_stage, to_stage, reason),
            )

    def get_stage_history(self, session_id: str) -> list[dict]:
        """查询阶段切换历史。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM stage_history WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_expired_sessions(self, ttl_seconds: float) -> list[str]:
        """删除超过 TTL 的会话，返回被删除的 session_id 列表。"""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT session_id FROM sessions "
                "WHERE updated_at < datetime('now', ?)",
                (f"-{int(ttl_seconds)} seconds",),
            ).fetchall()
            ids = [r["session_id"] for r in rows]
            if ids:
                placeholders = ",".join("?" * len(ids))
                conn.execute(f"DELETE FROM dialogues WHERE session_id IN ({placeholders})", ids)
                conn.execute(f"DELETE FROM events WHERE session_id IN ({placeholders})", ids)
                conn.execute(f"DELETE FROM npc_states WHERE session_id IN ({placeholders})", ids)
                conn.execute(f"DELETE FROM relationship_log WHERE session_id IN ({placeholders})", ids)
                conn.execute(f"DELETE FROM player_choices WHERE session_id IN ({placeholders})", ids)
                conn.execute(f"DELETE FROM stage_history WHERE session_id IN ({placeholders})", ids)
                conn.execute(f"DELETE FROM sessions WHERE session_id IN ({placeholders})", ids)
        return ids


# 全局单例
_db: Optional[Database] = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db
