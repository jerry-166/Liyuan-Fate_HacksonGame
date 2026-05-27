"""
存档管理路由 — v3: Session 级别 + Save 级别存档管理。
"""
import logging
import uuid
from fastapi import APIRouter, HTTPException, Body
from state.manager import get_session_manager

router = APIRouter()
logger = logging.getLogger(__name__)

# 全局常量
MAX_SAVE_SLOTS = 6


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


# ═══════════════════════════════════════════════════════════════
# v3: Save 级别接口（Session 1:N Save）
# ═══════════════════════════════════════════════════════════════


@router.post("/game/{session_id}/saves", status_code=201)
async def create_save(session_id: str,
                      body: dict = Body(...)):
    """在指定 session 下创建新存档快照。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    # 生成存档 ID 和标签
    save_id = f"sv_{uuid.uuid4().hex[:8]}"
    slot_id = body.get("slot_id") or _allocate_slot(manager, session_id, save_id)
    player_pos = body.get("player_position")
    town_npc_pos = body.get("town_npc_positions")

    timestamp = __import__("datetime").datetime.now().strftime("%m-%d %H:%M")
    stage_label = f"阶段{session.current_stage}"
    chapter_name = ""
    if session.current_chapter_id:
        ch = session.get_current_chapter()
        if ch:
            chapter_name = ch.get("name", "")
    label = body.get("label") or f"{stage_label}{' · ' + chapter_name if chapter_name else ''} · {timestamp}"

    manager.save_snapshot(
        session=session,
        save_id=save_id,
        label=label,
        slot_id=slot_id,
        player_position=player_pos,
        town_npc_positions=town_npc_pos,
    )

    logger.info(f"[Archive] Created save {save_id} for session {session_id} (slot={slot_id})")
    return {
        "save_id": save_id,
        "session_id": session_id,
        "slot_id": slot_id,
        "label": label,
        "stage": session.current_stage,
        "chapter_id": session.current_chapter_id,
        "message": "存档成功",
    }


@router.get("/game/{session_id}/saves")
async def list_saves(session_id: str):
    """列出 session 下所有存档。"""
    manager = get_session_manager()
    saves = manager.list_saves(session_id)
    return {"saves": saves, "total": len(saves)}


@router.post("/game/{session_id}/saves/{save_id}/load")
async def load_save(session_id: str, save_id: str):
    """从存档快照恢复游戏状态，返回完整游戏数据。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    game_state = manager.load_snapshot(session_id, save_id)
    if not game_state:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SAVE_NOT_FOUND",
            "message": f"存档不存在: {save_id}"
        })

    # 将快照状态写回当前 session（内存 + DB）
    from state.session import NPCState, NarrativeItem, TaskInstance
    session.current_stage = game_state.get("current_stage", session.current_stage)
    session.current_chapter_id = game_state.get("current_chapter_id")
    session.completed_chapters = game_state.get("completed_chapters", [])
    session.game_ended = game_state.get("game_ended", False)
    session.ending_type = game_state.get("ending_type")
    session.ending_data = game_state.get("ending_data")

    # 恢复 NPC 状态
    npcs_data = game_state.get("npcs", {})
    for npc_id, npc_dict in npcs_data.items():
        if npc_id in session.npcs:
            npc = session.npcs[npc_id]
            npc.relationship = npc_dict.get("relationship", npc.relationship)
            npc.is_available = npc_dict.get("is_available", True)
            npc.current_greeting = npc_dict.get("current_greeting", "")
            npc.dialogue_round_count = npc_dict.get("dialogue_round_count", 0)
            pos = npc_dict.get("position")
            if pos and isinstance(pos, dict):
                npc.position = pos
            scene = npc_dict.get("scene")
            if scene:
                npc.scene = scene

    # 恢复物品
    inventory_data = game_state.get("inventory", [])
    session.inventory = [NarrativeItem.from_dict(item) for item in inventory_data]
    session.active_item = game_state.get("active_item")

    # 恢复任务
    task_data = game_state.get("current_task")
    if task_data:
        session.current_task = TaskInstance.from_dict(task_data)
    else:
        session.current_task = None

    # 恢复事件
    events = game_state.get("events_triggered", [])
    session.events_triggered = set(events)

    # 持久化到 DB
    manager.persist_session(session)

    logger.info(f"[Archive] Loaded save {save_id} into session {session_id}")

    # 返回完整状态给前端
    response = session.to_api_response()
    response["_player_position"] = game_state.get("_player_position")
    response["_town_npc_positions"] = game_state.get("_town_npc_positions")
    response["loaded_from_save"] = save_id
    return response


@router.delete("/game/{session_id}/saves/{save_id}", status_code=200)
async def delete_save(session_id: str, save_id: str):
    """删除指定存档。"""
    manager = get_session_manager()
    ok = manager.delete_save(session_id, save_id)
    if not ok:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SAVE_NOT_FOUND",
            "message": f"存档不存在: {save_id}"
        })

    logger.info(f"[Archive] Deleted save {save_id} from session {session_id}")
    return {"success": True, "message": f"已删除存档: {save_id}"}


# ─── helper ──────────────────────────────────────────

def _allocate_slot(manager, session_id: str, new_save_id: str) -> int:
    """分配存档槽位，满 6 个时覆盖最旧的。"""
    existing = manager.list_saves(session_id)
    if len(existing) < MAX_SAVE_SLOTS:
        used = {s["slot_id"] for s in existing}
        for i in range(1, MAX_SAVE_SLOTS + 1):
            if i not in used:
                return i
    # 槽位满，覆盖最旧的
    oldest = min(existing, key=lambda s: s.get("created_at", ""))
    manager.delete_save(session_id, oldest["save_id"])
    return oldest["slot_id"]
