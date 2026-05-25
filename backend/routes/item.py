"""
物品路由 — GET /api/game/{id}/items, POST /api/game/{id}/item/discover
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from state.manager import get_session_manager

router = APIRouter()
logger = logging.getLogger(__name__)


class DiscoverItemRequest(BaseModel):
    item_id: str


@router.get("/game/{session_id}/items")
async def get_items(session_id: str):
    """获取物品清单（背包 + 场景中未发现的物品）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    # 背包物品
    inventory = [item.to_dict() for item in session.inventory]

    # 场景中可发现的物品（未发现的、属于当前章节 stage_relevance 的）
    current_chapter_idx = -1
    for ch in session.chapter_defs:
        if ch.get("id") == session.current_chapter_id:
            current_chapter_idx = ch.get("sort_order", -1)
            break

    scene_items = []
    for item_def in session.item_defs:
        item_id = item_def.get("item_id", item_def.get("id", ""))
        # 检查是否已在背包中
        if session.get_inventory_item(item_id):
            continue
        # 检查 stage_relevance
        relevance = item_def.get("stage_relevance", [])
        if relevance and current_chapter_idx not in relevance:
            continue
        scene_items.append({
            "item_id": item_id,
            "name": item_def.get("narrative_name", item_def.get("name", "")),
            "location": item_def.get("location"),
            "acquire_method": item_def.get("acquire_method", ""),
        })

    return {
        "inventory": inventory,
        "scene_items": scene_items,
    }


@router.post("/game/{session_id}/item/discover")
async def discover_item(session_id: str, req: DiscoverItemRequest):
    """发现物品（标记 + 触发 LLM 生成旁白）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    # 查找物品定义
    item_def = None
    for i in session.item_defs:
        if i.get("item_id", i.get("id", "")) == req.item_id:
            item_def = i
            break

    if not item_def:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "ITEM_NOT_FOUND",
            "message": f"物品定义不存在: {req.item_id}"
        })

    # 检查是否已发现
    existing = session.get_inventory_item(req.item_id)
    if existing:
        return {
            "item_id": req.item_id,
            "already_discovered": True,
            "item": existing.to_dict(),
        }

    # 创建运行时物品
    from agents.item_generator import ItemGenerator
    runtime_item = ItemGenerator.create_runtime_item(item_def)
    runtime_item.is_discovered = True

    # 尝试生成发现旁白
    try:
        gen = ItemGenerator()
        narration = await gen.generate_discovery_narration(session, runtime_item)
        runtime_item.discovery_context = narration
    except Exception as e:
        logger.warning(f"[Item] 旁白生成失败: {e}")
        runtime_item.discovery_context = f"你发现了「{runtime_item.name}」。"

    # 如果物品可持有，加入背包
    if runtime_item.holdable:
        session.add_to_inventory(runtime_item)
        logger.info(f"[Item] Discovered & added to inventory: {req.item_id}")
    else:
        # 不可拾取的物品只标记已发现，不加入背包
        session.add_to_inventory(runtime_item)
        logger.info(f"[Item] Discovered (non-holdable): {req.item_id}")

    # 持久化
    try:
        manager._db.save_narrative_item(session_id, runtime_item.to_dict())
    except Exception as e:
        logger.error(f"[Item] 持久化失败: {e}")

    return {
        "item_id": req.item_id,
        "already_discovered": False,
        "item": runtime_item.to_dict(),
        "discovery_narration": runtime_item.discovery_context,
    }
