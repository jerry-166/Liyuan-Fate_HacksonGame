"""
剧本游玩记录路由 — 文件系统持久化的完善剧本。

每个游戏会话在 chapter 完成时写入 YAML 文件，
路径: data/plays/{script_id}/{session_id}.yaml

端点:
  GET  /api/plays?script_id=xxx    列出某蓝本的所有游玩记录
  GET  /api/plays/{session_id}     读取单个游玩记录的完整剧本内容
"""

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException, Query

from config import DATA_DIR

router = APIRouter()
logger = logging.getLogger(__name__)

PLAYS_DIR = Path(DATA_DIR).parent / "data" / "plays"


def _ensure_plays_dir():
    PLAYS_DIR.mkdir(parents=True, exist_ok=True)


def _play_path(script_id: str, session_id: str) -> Path:
    script_dir = PLAYS_DIR / script_id
    script_dir.mkdir(parents=True, exist_ok=True)
    return script_dir / f"{session_id}.yaml"


def write_play_record(session_id: str, script_id: str, player_name: str,
                      chapters: list, game_ended: bool = False) -> str:
    """
    将完善剧本写入文件系统。每次章节完成时调用，增量更新。
    
    Args:
        session_id: 游戏会话 ID
        script_id:  蓝本 ID
        player_name: 玩家名
        chapters:   章节列表，每项含 blueprint 字段 + generated 的 task 数据
        game_ended: 是否已结局
    
    Returns:
        文件路径
    """
    _ensure_plays_dir()
    filepath = _play_path(script_id, session_id)
    
    record = {
        "session_id": session_id,
        "player_name": player_name,
        "script_id": script_id,
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "game_ended": game_ended,
        "chapters": chapters,
    }
    
    with open(filepath, "w", encoding="utf-8") as f:
        yaml.dump(record, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    
    logger.info(f"[Plays] Wrote {filepath} ({len(chapters)} chapters)")
    return str(filepath)


def read_play_record(session_id: str) -> Optional[dict]:
    """读取单个游玩记录。遍历所有 script 目录查找。"""
    _ensure_plays_dir()
    for script_dir in PLAYS_DIR.iterdir():
        if script_dir.is_dir():
            filepath = script_dir / f"{session_id}.yaml"
            if filepath.exists():
                with open(filepath, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f)
    return None


def list_plays_by_script(script_id: str) -> list[dict]:
    """列出某蓝本下的所有游玩记录（摘要）。"""
    _ensure_plays_dir()
    script_dir = PLAYS_DIR / script_id
    if not script_dir.exists():
        return []
    
    plays = []
    for f in sorted(script_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.suffix == ".yaml":
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                plays.append({
                    "session_id": data.get("session_id", f.stem),
                    "player_name": data.get("player_name", "玩家"),
                    "script_id": data.get("script_id", script_id),
                    "updated_at": data.get("updated_at", ""),
                    "game_ended": data.get("game_ended", False),
                    "chapter_count": len(data.get("chapters", [])),
                })
            except Exception as e:
                logger.warning(f"[Plays] Failed to read {f}: {e}")
    return plays


# ═══════════════════════════════════════════════
# API 端点
# ═══════════════════════════════════════════════

@router.get("/plays")
async def api_list_plays(script_id: Optional[str] = Query(None)):
    """列出游玩记录。可按 script_id 过滤。"""
    if script_id:
        plays = list_plays_by_script(script_id)
    else:
        # 列出所有
        _ensure_plays_dir()
        plays = []
        for script_dir in sorted(PLAYS_DIR.iterdir()):
            if script_dir.is_dir():
                plays.extend(list_plays_by_script(script_dir.name))
        plays.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    
    return {"plays": plays, "total": len(plays)}


@router.get("/plays/{session_id}")
async def api_read_play(session_id: str):
    """读取单个游玩记录的完整剧本内容。"""
    record = read_play_record(session_id)
    if not record:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "PLAY_NOT_FOUND",
            "message": f"游玩记录不存在: {session_id}"
        })
    
    # Enrich chapters with display info
    chapters_out = []
    for ch in record.get("chapters", []):
        task = ch.get("task") or ch.get("generated")
        chapters_out.append({
            "chapter_id": ch.get("chapter_id", ""),
            "name": ch.get("name", ""),
            "blueprint": ch.get("blueprint", ""),
            "description": task.get("description", "") if task else ch.get("description", ""),
            "goal": ch.get("goal", ""),
            "key_conflict": ch.get("key_conflict", ""),
            "atmosphere": ch.get("atmosphere", ""),
            "color_tone": ch.get("color_tone", ""),
            "is_completed": True,  # play records only contain completed chapters
            "is_current": False,
            "sub_tasks": task.get("sub_tasks", []) if task else [],
        })
    
    return {
        "session_id": record.get("session_id"),
        "player_name": record.get("player_name"),
        "script_id": record.get("script_id"),
        "updated_at": record.get("updated_at"),
        "game_ended": record.get("game_ended", False),
        "chapters": chapters_out,
    }


# ═══════════════════════════════════════════════
# 管理：回填历史存档为 play 文件
# ═══════════════════════════════════════════════

@router.post("/plays/backfill", status_code=200)
async def api_backfill_plays():
    """
    遍历所有现有 session，将已完成章节的内容回填为 play YAML 文件。
    """
    from state.manager import get_session_manager
    manager = get_session_manager()
    sessions = manager.list_sessions()

    created = 0
    skipped = 0
    errors = []

    for s in sessions:
        sid = s.get("session_id")
        script_id = s.get("script_id", "liyuan_shengsi")

        # 跳过已存在 play 文件的
        if read_play_record(sid):
            skipped += 1
            continue

        try:
            session = manager.get(sid)
            if not session:
                continue

            # 获取当前 task 数据（从内存或 DB）
            task_dict = None
            if session.current_task:
                task_dict = session.current_task.to_dict()
            else:
                # 尝试从 DB 恢复
                try:
                    db_task = manager._db.load_task_instance(sid)
                    if db_task:
                        task_dict = {
                            "description": db_task.get("description", ""),
                            "sub_tasks": [],
                        }
                        # 还原子任务（DB 中存为 JSON 字符串）
                        raw_sub = db_task.get("sub_tasks", "[]")
                        if isinstance(raw_sub, str):
                            import json
                            raw_sub = json.loads(raw_sub)
                        for st in (raw_sub or []):
                            task_dict["sub_tasks"].append({
                                "id": st.get("id", ""),
                                "title": st.get("title", ""),
                                "mode": st.get("mode", "dialogue"),
                                "description": st.get("description", ""),
                                "target_npc_id": st.get("target_npc_id"),
                                "status": st.get("status", "locked"),
                            })
                except Exception:
                    pass

            chapters_data = []
            current_ch = session.current_chapter_id
            for ch_def in session.chapter_defs:
                ch_id = ch_def.get("id", "")
                task_data = task_dict if ch_id == current_ch else None

                chapter_entry = {
                    "chapter_id": ch_id,
                    "name": ch_def.get("name", ""),
                    "sort_order": ch_def.get("sort_order", 0),
                    "blueprint": ch_def.get("description", ""),
                    "goal": ch_def.get("goal", ""),
                    "key_conflict": ch_def.get("key_conflict", ""),
                    "atmosphere": ch_def.get("atmosphere", ""),
                    "color_tone": ch_def.get("color_tone", ""),
                    "bgm_mood": ch_def.get("bgm_mood", ""),
                }
                if task_data:
                    chapter_entry["task"] = {
                        "description": task_data.get("description", ""),
                        "sub_tasks": [
                            {
                                "id": st.get("id", ""),
                                "title": st.get("title", ""),
                                "mode": st.get("mode", "dialogue"),
                                "description": st.get("description", ""),
                                "target_npc_id": st.get("target_npc_id"),
                                "status": st.get("status", "locked"),
                            }
                            for st in task_data.get("sub_tasks", [])
                        ],
                    }
                chapters_data.append(chapter_entry)

            write_play_record(
                session_id=sid,
                script_id=script_id,
                player_name=s.get("player_name", session.player_name),
                chapters=chapters_data,
                game_ended=bool(s.get("game_ended", False)),
            )
            created += 1
        except Exception as e:
            errors.append({"session_id": sid, "error": str(e)})
            logger.warning(f"[Plays] Backfill failed for {sid}: {e}")

    return {
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "total": len(sessions),
    }
