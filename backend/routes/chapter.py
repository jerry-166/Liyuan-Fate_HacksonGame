"""
章节路由 — POST /api/game/{id}/chapter/start, GET /api/game/{id}/chapter
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from state.manager import get_session_manager

router = APIRouter()
logger = logging.getLogger(__name__)


class StartChapterRequest(BaseModel):
    chapter_id: Optional[str] = None


@router.post("/game/{session_id}/chapter/start")
async def start_chapter(session_id: str, req: StartChapterRequest = None):
    """开始下一章（触发 LLM 任务规划）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    if session.game_ended:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "GAME_ENDED",
            "message": "游戏已结束"
        })

    from state.chapter_engine import ChapterEngine
    engine = ChapterEngine()

    # 确定要开始的章节
    if req and req.chapter_id:
        target_ch = None
        for ch in session.chapter_defs:
            if ch.get("id") == req.chapter_id:
                target_ch = ch
                break
        if not target_ch:
            raise HTTPException(status_code=400, detail={
                "error": True, "code": "CHAPTER_NOT_FOUND",
                "message": f"章节不存在: {req.chapter_id}"
            })
    elif session.current_chapter_id:
        # 推进到下一章：必须当前章节真正完成（NPC 共识投票通过）
        if not session.current_task or not session.current_task.is_completed:
            raise HTTPException(status_code=400, detail={
                "error": True, "code": "CHAPTER_NOT_COMPLETED",
                "message": "当前章节尚未完成，需所有相关 NPC 投票通过后方可推进",
                "completion_rate": session.current_task.completion_rate if session.current_task else 0,
                "required_npcs": session.current_task.related_npc_ids if session.current_task else [],
                "npc_votes": session.current_task.npc_completion_votes if session.current_task else {},
            })
        target_ch = engine.advance_to_next_chapter(session)
        if not target_ch:
            return {
                "chapter_id": None,
                "game_ended": True,
                "message": "所有章节已完成",
            }
        if session.game_ended:
            manager.persist_session(session)
            return {
                "chapter_id": None,
                "game_ended": True,
                "message": "故事已完结",
            }
    else:
        # 第一次开始，取第一章（跳过序章 cinematic）
        target_ch = session.get_next_chapter()
        if not target_ch:
            # 没有章节定义，返回错误
            raise HTTPException(status_code=400, detail={
                "error": True, "code": "NO_CHAPTERS",
                "message": "没有可用的章节定义"
            })
        # 跳过 cinematic 类型
        while target_ch and target_ch.get("type") == "cinematic":
            session.completed_chapters.append(target_ch.get("id"))
            target_ch = session.get_next_chapter()
        if not target_ch:
            return {
                "chapter_id": None,
                "game_ended": True,
                "message": "没有可玩的章节",
            }

    try:
        task = await engine.start_chapter(session, target_ch)
    except Exception as e:
        logger.exception(f"[Chapter] start_chapter failed: {e}")
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "CHAPTER_START_FAILED",
            "message": f"章节初始化失败: {str(e)}"
        })

    return {
        "chapter_id": target_ch.get("id"),
        "chapter_name": target_ch.get("name"),
        "chapter_type": target_ch.get("type"),
        "task": session.current_task.to_dict() if session.current_task else None,
        "color_tone": target_ch.get("color_tone"),
        "bgm_mood": target_ch.get("bgm_mood"),
    }


@router.post("/game/{session_id}/chapter/skip")
async def skip_chapter(session_id: str):
    """调试用：强制完成当前章节并推进到下一章。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    if session.game_ended:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "GAME_ENDED",
            "message": "游戏已结束"
        })

    from state.chapter_engine import ChapterEngine, SubTaskStatus
    engine = ChapterEngine()

    # 强制完成当前 task
    if session.current_task:
        task = session.current_task
        # 所有子任务标记完成
        for st in task.sub_tasks:
            st.status = SubTaskStatus.COMPLETED.value
        # 所有相关 NPC 投票通过
        for npc_id in task.related_npc_ids:
            task.npc_completion_votes[npc_id] = True
        task.is_completed = True

    # 推进到下一章
    next_ch = engine.advance_to_next_chapter(session)
    if not next_ch:
        manager.persist_session(session)
        return {
            "chapter_id": None,
            "game_ended": True,
            "message": "所有章节已完成（跳章）",
        }

    if session.game_ended:
        manager.persist_session(session)
        return {
            "chapter_id": None,
            "game_ended": True,
            "message": "故事已完结（跳章）",
        }

    # 开始下一章
    try:
        task = await engine.start_chapter(session, next_ch)
    except Exception as e:
        logger.exception(f"[Chapter] skip_chapter start_chapter failed: {e}")
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "CHAPTER_START_FAILED",
            "message": f"跳章后初始化失败: {str(e)}"
        })

    return {
        "chapter_id": next_ch.get("id"),
        "chapter_name": next_ch.get("name"),
        "chapter_type": next_ch.get("type"),
        "task": session.current_task.to_dict() if session.current_task else None,
        "color_tone": next_ch.get("color_tone"),
        "bgm_mood": next_ch.get("bgm_mood"),
    }


@router.get("/game/{session_id}/chapter")
async def get_chapter_status(session_id: str):
    """获取当前章节状态和任务进度。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    chapter = session.get_current_chapter()
    return {
        "current_chapter": {
            "chapter_id": session.current_chapter_id,
            "chapter_name": chapter.get("name", "") if chapter else None,
            "chapter_type": chapter.get("type", "") if chapter else None,
            "color_tone": chapter.get("color_tone", "") if chapter else None,
            "bgm_mood": chapter.get("bgm_mood", "") if chapter else None,
        } if chapter else None,
        "completed_chapters": session.completed_chapters,
        "task": session.current_task.to_dict() if session.current_task else None,
    }


@router.get("/game/{session_id}/task")
async def get_task_detail(session_id: str):
    """获取当前任务详情（子任务列表+NPC投票）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    if not session.current_task:
        return {"task": None}

    return {"task": session.current_task.to_dict()}
