"""
SQLite 数据库操作封装 — v2 章节驱动架构。
"""

import sqlite3
import json
import time
import os
from typing import Optional
from contextlib import contextmanager

from config import DB_PATH


class Database:

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
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        if os.path.exists(schema_path):
            with open(schema_path, "r", encoding="utf-8") as f:
                sql = f.read()
            with self._conn() as conn:
                conn.executescript(sql)
        self._migrate()

    def _migrate(self):
        migrations = [
            "ALTER TABLE sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE dialogues ADD COLUMN options TEXT",
            "ALTER TABLE sessions ADD COLUMN current_chapter_id TEXT",
            "ALTER TABLE sessions ADD COLUMN script_id TEXT DEFAULT 'liyuan_shengsi'",
            "ALTER TABLE sessions ADD COLUMN active_item TEXT",
        ]
        with self._conn() as conn:
            for sql in migrations:
                try:
                    conn.execute(sql)
                except sqlite3.OperationalError:
                    pass

    # ─── Session CRUD ───────────────────────────────────

    def create_session(self, session_id: str, player_name: str = "玩家",
                       stage: int = 1, script_id: str = "liyuan_shengsi") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO sessions (session_id, player_name, current_stage, script_id, updated_at) "
                "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (session_id, player_name, stage, script_id),
            )

    def list_sessions(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT session_id, player_name, current_stage, current_chapter_id, "
                "script_id, game_ended, created_at, updated_at FROM sessions "
                "WHERE deleted = 0 ORDER BY updated_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def soft_delete_session(self, session_id: str) -> bool:
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

    def update_session(self, session_id: str, stage: Optional[int] = None,
                       game_ended: Optional[bool] = None,
                       ending_type: Optional[str] = None,
                       ending_data: Optional[dict] = None,
                       current_chapter_id: Optional[str] = None,
                       active_item: Optional[str] = None,
                       script_id: Optional[str] = None) -> None:
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
        if current_chapter_id is not None:
            fields.append("current_chapter_id = ?")
            params.append(current_chapter_id)
        if active_item is not None:
            fields.append("active_item = ?")
            params.append(active_item)
        if script_id is not None:
            fields.append("script_id = ?")
            params.append(script_id)
        params.append(session_id)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE sessions SET {', '.join(fields)} WHERE session_id = ?",
                params,
            )

    # ─── Dialogue CRUD ──────────────────────────────────

    def save_dialogue(self, session_id: str, npc_id: str, role: str, content: str,
                      stage: int, options: Optional[list[str]] = None) -> int:
        options_json = json.dumps(options, ensure_ascii=False) if options else None
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO dialogues (session_id, npc_id, role, content, options, stage) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, npc_id, role, content, options_json, stage),
            )
            return cur.lastrowid

    def get_dialogue_history(self, session_id: str, npc_id: Optional[str] = None,
                             limit: int = 20) -> list[dict]:
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
        return [dict(r) for r in reversed(rows)]

    def get_dialogue_history_paginated(self, session_id: str, npc_id: Optional[str] = None,
                                        page: int = 1, page_size: int = 20) -> dict:
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

    def save_event(self, session_id: str, event_id: str, description: str = "",
                   triggered_by_npc: str = "", stage: int = 1) -> None:
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

    def save_npc_state(self, session_id: str, npc_id: str, relationship: int = 0,
                       is_available: bool = True, current_greeting: str = "",
                       dialogue_round_count: int = 0) -> None:
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
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT npc_id, relationship, is_available, current_greeting, "
                "dialogue_round_count FROM npc_states WHERE session_id = ?",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ─── Relationship Log ──────────────────────────────

    def save_relationship_log(self, session_id: str, npc_id: str, delta: int,
                               old_value: int, new_value: int, reason: str = "",
                               dialogue_id: Optional[int] = None) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO relationship_log (session_id, npc_id, delta, old_value, "
                "new_value, reason, dialogue_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session_id, npc_id, delta, old_value, new_value, reason, dialogue_id),
            )

    def get_relationship_log(self, session_id: str, npc_id: Optional[str] = None) -> list[dict]:
        with self._conn() as conn:
            if npc_id:
                rows = conn.execute(
                    "SELECT * FROM relationship_log WHERE session_id = ? AND npc_id = ? "
                    "ORDER BY created_at ASC", (session_id, npc_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM relationship_log WHERE session_id = ? "
                    "ORDER BY created_at ASC", (session_id,),
                ).fetchall()
        return [dict(r) for r in rows]

    # ─── Player Choices ────────────────────────────────

    def save_player_choice(self, session_id: str, npc_id: str, choice_text: str,
                           available_options: list[str] = None,
                           dialogue_id: Optional[int] = None, stage: int = 1) -> None:
        options_json = json.dumps(available_options, ensure_ascii=False) if available_options else None
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO player_choices (session_id, npc_id, choice_text, "
                "available_options, dialogue_id, stage) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, npc_id, choice_text, options_json, dialogue_id, stage),
            )

    def get_player_choices(self, session_id: str) -> list[dict]:
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

    # ─── Stage History ─────────────────────────────────

    def save_stage_history(self, session_id: str, from_stage: int, to_stage: int,
                            reason: str = "") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO stage_history (session_id, from_stage, to_stage, reason) "
                "VALUES (?, ?, ?, ?)",
                (session_id, from_stage, to_stage, reason),
            )

    def get_stage_history(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM stage_history WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ─── v2: NarrativeItem CRUD ────────────────────────

    def save_narrative_item(self, session_id: str, item: dict) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO narrative_items (id, session_id, item_type, name, "
                "base_description, ai_detail, ai_detail_locked, is_key, is_discovered, "
                "discovery_context, related_npcs, npc_knowledge, desc_source, "
                "location_scene, location_pos, source_npc, stage_relevance, "
                "template_ref, holdable, acquire_method) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    item.get("id"), session_id, item.get("item_type", "misc"),
                    item.get("name", ""), item.get("base_description", ""),
                    item.get("ai_detail"), 1 if item.get("ai_detail_locked") else 0,
                    1 if item.get("is_key") else 0,
                    1 if item.get("is_discovered") else 0,
                    item.get("discovery_context", ""),
                    json.dumps(item.get("related_npcs", []), ensure_ascii=False),
                    json.dumps(item.get("npc_knowledge", {}), ensure_ascii=False),
                    item.get("desc_source", "fixed"),
                    item.get("location", {}).get("scene") if item.get("location") else None,
                    json.dumps(item.get("location", {}).get("position", {}) if item.get("location") else {}),
                    item.get("source_npc"),
                    json.dumps(item.get("stage_relevance", []), ensure_ascii=False),
                    item.get("template_ref"),
                    1 if item.get("holdable", True) else 0,
                    item.get("acquire_method", ""),
                ),
            )

    def load_narrative_items(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM narrative_items WHERE session_id = ?",
                (session_id,),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            for json_field in ["related_npcs", "npc_knowledge", "stage_relevance", "location_pos"]:
                if d.get(json_field):
                    try:
                        d[json_field] = json.loads(d[json_field])
                    except (json.JSONDecodeError, TypeError):
                        d[json_field] = [] if json_field != "npc_knowledge" else {}
                else:
                    d[json_field] = [] if json_field != "npc_knowledge" else {}
            d["ai_detail_locked"] = bool(d.get("ai_detail_locked", 0))
            d["is_key"] = bool(d.get("is_key", 0))
            d["is_discovered"] = bool(d.get("is_discovered", 0))
            d["holdable"] = bool(d.get("holdable", 1))
            d["location"] = {"scene": d.get("location_scene"), "position": d.get("location_pos")}
            result.append(d)
        return result

    # ─── v2: TaskInstance CRUD ─────────────────────────

    def save_task_instance(self, session_id: str, task: dict) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO task_instances (id, session_id, chapter_id, "
                "chapter_name, description, sub_tasks, related_npc_ids, "
                "npc_completion_votes, is_completed) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    task.get("task_id"), session_id, task.get("chapter_id"),
                    task.get("chapter_name"), task.get("description"),
                    json.dumps(task.get("sub_tasks", []), ensure_ascii=False),
                    json.dumps(task.get("related_npc_ids", []), ensure_ascii=False),
                    json.dumps(task.get("npc_completion_votes", {}), ensure_ascii=False),
                    1 if task.get("is_completed") else 0,
                ),
            )

    def load_task_instance(self, session_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM task_instances WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        if not row:
            return None
        d = dict(row)
        for json_field in ["sub_tasks", "related_npc_ids", "npc_completion_votes"]:
            if d.get(json_field):
                try:
                    d[json_field] = json.loads(d[json_field])
                except json.JSONDecodeError:
                    d[json_field] = [] if json_field != "npc_completion_votes" else {}
            else:
                d[json_field] = [] if json_field != "npc_completion_votes" else {}
        d["is_completed"] = bool(d.get("is_completed", 0))
        return d

    # ─── v2: Chapter Progress CRUD ─────────────────────

    def save_chapter_progress(self, session_id: str, chapter_id: str,
                              task_id: Optional[str] = None, status: str = "active") -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO chapter_progress (session_id, chapter_id, task_id, status) "
                "VALUES (?, ?, ?, ?)",
                (session_id, chapter_id, task_id, status),
            )

    def complete_chapter_progress(self, session_id: str, chapter_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE chapter_progress SET status = 'completed', completed_at = datetime('now') "
                "WHERE session_id = ? AND chapter_id = ?",
                (session_id, chapter_id),
            )

    def load_chapter_progress(self, session_id: str) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM chapter_progress WHERE session_id = ? ORDER BY started_at",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ─── TTL 淘汰 ──────────────────────────────────────

    def delete_expired_sessions(self, ttl_seconds: float) -> list[str]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT session_id FROM sessions "
                "WHERE updated_at < datetime('now', ?)",
                (f"-{int(ttl_seconds)} seconds",),
            ).fetchall()
            ids = [r["session_id"] for r in rows]
            if ids:
                placeholders = ",".join("?" * len(ids))
                for table in ["dialogues", "events", "npc_states", "relationship_log",
                              "player_choices", "stage_history", "narrative_items",
                              "task_instances", "chapter_progress", "sessions"]:
                    conn.execute(
                        f"DELETE FROM {table} WHERE session_id IN ({placeholders})", ids
                    )
        return ids


_db: Optional[Database] = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db
