"""
存档管理路由 — GET /api/sessions + DELETE /api/game/{session_id}。
"""
import logging
from fastapi import APIRouter, HTTPException
from state.manager import get_session_manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/sessions")
async def list_sessions():
    """列出所有历史存档（仅摘要，不含完整 NPC 状态）。"""
    manager = get_session_manager()
    sessions = manager.list_sessions()

    # 补充阶段名称
    from config import STAGES
    result = []
    for s in sessions:
        stage_name = STAGES.get(s.get("current_stage", 1), {}).get("name", "未知")
        result.append({
            "session_id": s["session_id"],
            "player_name": s["player_name"],
            "stage": s["current_stage"],
            "stage_name": stage_name,
            "game_ended": bool(s.get("game_ended", 0)),
            "created_at": str(s.get("created_at", "")),
            "updated_at": str(s.get("updated_at", "")),
        })

    return {"sessions": result, "total": len(result)}


@router.delete("/game/{session_id}", status_code=200)
async def delete_session(session_id: str):
    """软删除指定游戏会话。"""
    manager = get_session_manager()
    ok = manager.soft_delete(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在或已删除: {session_id}"
        })

    logger.info(f"[Archive] Deleted session: {session_id}")
    return {"success": True, "message": f"已删除会话: {session_id}"}
