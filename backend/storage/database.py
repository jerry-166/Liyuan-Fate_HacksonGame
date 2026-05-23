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
        """执行建表 SQL。"""
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        if os.path.exists(schema_path):
            with open(schema_path, "r", encoding="utf-8") as f:
                sql = f.read()
            with self._conn() as conn:
                conn.executescript(sql)

    # ─── Session CRUD ───────────────────────────────────

    def create_session(self, session_id: str, player_name: str = "玩家", stage: int = 1) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO sessions (session_id, player_name, current_stage, updated_at) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (session_id, player_name, stage),
            )

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
                conn.execute(f"DELETE FROM sessions WHERE session_id IN ({placeholders})", ids)
        return ids

    # ─── Dialogue CRUD ──────────────────────────────────

    def save_dialogue(
        self, session_id: str, npc_id: str, role: str, content: str, stage: int
    ) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO dialogues (session_id, npc_id, role, content, stage) "
                "VALUES (?, ?, ?, ?, ?)",
                (session_id, npc_id, role, content, stage),
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


# 全局单例
_db: Optional[Database] = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db
