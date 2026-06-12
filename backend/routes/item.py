"""
物品路由 — GET /api/game/{id}/items, GET /api/game/{id}/item/{item_id}, POST /api/game/{id}/item/discover
          GET /api/game/{id}/items/full — 全量物品信息（含模板合并、坐标），供 AI 生成剧本
"""

import json
import logging
import os
import yaml
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from state.manager import get_session_manager
from config import DATA_DIR

router = APIRouter()
logger = logging.getLogger(__name__)

# ─── 模板加载辅助 ─────────────────────────────────────────

_TEMPLATE_CACHE: dict[str, dict] = {}  # script_id → {template_id: template_dict}


def _load_item_templates(script_id: str) -> dict[str, dict]:
    """加载指定剧本的物品模板（带缓存）。返回 {template_id: template} 映射。"""
    if script_id in _TEMPLATE_CACHE:
        return _TEMPLATE_CACHE[script_id]

    template_path = Path(DATA_DIR) / "scripts" / script_id / "items" / "templates.yaml"
    if not template_path.exists():
        logger.warning(f"[ItemsFull] 模板文件不存在: {template_path}")
        _TEMPLATE_CACHE[script_id] = {}
        return {}

    try:
        with open(template_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        templates_raw = raw.get("templates", []) if isinstance(raw, dict) else []
        templates = {}
        for t in templates_raw:
            tid = t.get("template_id", "")
            if tid:
                templates[tid] = t
        _TEMPLATE_CACHE[script_id] = templates
        logger.info(f"[ItemsFull] 加载 {len(templates)} 个物品模板: {script_id}")
        return templates
    except Exception as e:
        logger.error(f"[ItemsFull] 模板加载失败: {e}")
        _TEMPLATE_CACHE[script_id] = {}
        return {}


def _merge_item_full(item_def: dict, templates: dict[str, dict]) -> dict:
    """将一个剧本物品定义与其模板合并，返回完整的扁平化 dict。"""
    template_ref = item_def.get("template_ref", "")
    tmpl = templates.get(template_ref, {})

    item_id = item_def.get("item_id", item_def.get("id", ""))

    # 从模板获取物理属性，剧本定义可覆盖
    category = item_def.get("category", tmpl.get("category", "misc"))
    icon = item_def.get("icon", tmpl.get("icon", "item"))
    size = item_def.get("size", tmpl.get("size", "small"))
    holdable = item_def.get("holdable", tmpl.get("holdable", True))
    actions = item_def.get("actions", tmpl.get("actions", ["examine"]))

    # 名称和描述：剧本定义优先
    name = item_def.get("narrative_name", item_def.get("name", tmpl.get("name", item_id)))
    base_description = item_def.get("narrative_desc", item_def.get("description", tmpl.get("generic_desc", "")))

    # 坐标：item_def.location 优先，也尝试从 editor_config 获取
    location = item_def.get("location")
    position = None
    scene = None
    if isinstance(location, dict):
        scene = location.get("scene", "")
        position = location.get("position")

    # 章节关联
    stage_relevance = item_def.get("stage_relevance", [])

    # 章节名称映射（如果有 chapter_defs）
    stage_names = []
    # stage_names 由调用方填充

    return {
        # ── 标识 ──
        "item_id": item_id,
        "template_ref": template_ref,
        # ── 名称与描述 ──
        "name": name,
        "desc_source": item_def.get("desc_source", "fixed"),
        "base_description": (base_description or "").strip(),
        "ai_detail": item_def.get("ai_detail"),
        "ai_detail_locked": item_def.get("ai_detail_locked", False),
        # ── 模板物理属性 ──
        "category": category,
        "icon": icon,
        "size": size,
        "holdable": holdable,
        "actions": actions,
        # ── 坐标与场景 ──
        "scene": scene,
        "position": position,
        "acquire_method": item_def.get("acquire_method", ""),
        # ── 叙事属性 ──
        "is_key": item_def.get("is_key", False),
        "is_discovered": item_def.get("is_discovered", False),
        "discovery_context": item_def.get("discovery_context", ""),
        # ── 关联 ──
        "related_npcs": item_def.get("related_npcs", []),
        "npc_knowledge": item_def.get("npc_knowledge", {}),
        "source_npc": item_def.get("source_npc"),
        # ── 章节 ──
        "stage_relevance": stage_relevance,
        "stage_names": [],  # 由调用方填充
    }


class DiscoverItemRequest(BaseModel):
    item_id: str


# ═══════════════════════════════════════════════════════════════
# 全量物品接口 — 供 AI 剧本生成使用
# ═══════════════════════════════════════════════════════════════

@router.get("/game/{session_id}/items/full")
async def get_items_full(session_id: str):
    """
    返回剧本中【所有物品】的完整信息（含模板合并、坐标、NPC关联等）。

    与 GET /items 的区别：
    - /items 只返回当前章节可发现的物品（受 stage_relevance 过滤）
    - /items/full 返回全部物品，不做任何过滤
    - /items/full 合并了模板通用属性（category、icon、size、actions 等）
    - /items/full 是 AI 生成剧本内容的数据源

    返回格式：
    {
      "script_id": "liyuan_shengsi",
      "total": 10,
      "items": [ { ...完整物品信息... }, ... ]
    }
    """
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    # 1. 加载模板
    templates = _load_item_templates(session.script_id)

    # 2. 构建章节索引映射 (sort_order → chapter info)
    chapter_map: dict[int, dict] = {}
    for ch in session.chapter_defs:
        so = ch.get("sort_order", -1)
        if so >= 0:
            chapter_map[so] = {
                "id": ch.get("id", ""),
                "name": ch.get("name", ""),
                "description": ch.get("description", "")[:80] if ch.get("description") else "",
            }

    # 3. 合并所有物品
    items = []
    for item_def in session.item_defs:
        full = _merge_item_full(item_def, templates)

        # 填充章节名称
        stage_names = []
        for idx in full.get("stage_relevance", []):
            ch_info = chapter_map.get(idx)
            if ch_info:
                stage_names.append(ch_info)
        full["stage_names"] = stage_names

        # 运行时发现状态（如果在背包中）
        item_id = full["item_id"]
        inv_item = session.get_inventory_item(item_id)
        if inv_item:
            full["is_discovered"] = True
            full["discovery_context"] = inv_item.discovery_context
            full["ai_detail"] = inv_item.ai_detail
            full["ai_detail_locked"] = inv_item.ai_detail_locked

        items.append(full)

    # 4. 统计摘要
    key_items = [i for i in items if i["is_key"]]
    holdable_items = [i for i in items if i["holdable"]]
    scene_dist = {}
    for i in items:
        sc = i["scene"] or "(无场景)"
        scene_dist[sc] = scene_dist.get(sc, 0) + 1

    return {
        "script_id": session.script_id,
        "total": len(items),
        "summary": {
            "key_count": len(key_items),
            "holdable_count": len(holdable_items),
            "by_scene": scene_dist,
            "scenes": list(scene_dist.keys()),
        },
        "items": items,
    }


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


@router.get("/game/{session_id}/item/{item_id}")
async def get_item_detail(session_id: str, item_id: str):
    """查看单个物品完整详情（背包中已发现的 + 场景中未发现的均可查）。"""
    manager = get_session_manager()
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SESSION_NOT_FOUND",
            "message": f"游戏会话不存在: {session_id}"
        })

    # 先查背包
    inventory_item = session.get_inventory_item(item_id)
    if inventory_item:
        return {
            "item_id": item_id,
            "from": "inventory",
            "item": inventory_item.to_dict(),
        }

    # 再查场景物品定义
    for item_def in session.item_defs:
        def_id = item_def.get("item_id", item_def.get("id", ""))
        if def_id == item_id:
            return {
                "item_id": item_id,
                "from": "scene",
                "is_discovered": False,
                "item": {
                    "id": def_id,
                    "name": item_def.get("narrative_name", item_def.get("name", "")),
                    "base_description": item_def.get("narrative_desc", item_def.get("description", "")),
                    "item_type": item_def.get("item_type", item_def.get("category", "misc")),
                    "is_key": item_def.get("is_key", False),
                    "is_discovered": False,
                    "holdable": item_def.get("holdable", True),
                    "location": item_def.get("location"),
                    "acquire_method": item_def.get("acquire_method", ""),
                    "related_npcs": item_def.get("related_npcs", []),
                    "stage_relevance": item_def.get("stage_relevance", []),
                },
            }

    raise HTTPException(status_code=404, detail={
        "error": True, "code": "ITEM_NOT_FOUND",
        "message": f"物品不存在: {item_id}"
    })


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
    runtime_item.discovery_context = f"你发现了「{runtime_item.name}」。"

    # 加入背包
    session.add_to_inventory(runtime_item)
    logger.info(f"[Item] Discovered: {req.item_id}")

    # 持久化
    try:
        manager._db.save_narrative_item(session_id, runtime_item.to_dict())
    except Exception as e:
        logger.error(f"[Item] 持久化失败: {e}")

    # 立即返回，不等旁白生成
    response = {
        "item_id": req.item_id,
        "already_discovered": False,
        "item": runtime_item.to_dict(),
        "discovery_narration": runtime_item.discovery_context,
    }

    # 旁白生成放后台，不阻塞响应
    import asyncio
    async def _gen_narration_bg():
        try:
            gen = ItemGenerator()
            narration = await gen.generate_discovery_narration(session, runtime_item)
            runtime_item.discovery_context = narration
            manager._db.save_narrative_item(session_id, runtime_item.to_dict())
        except Exception as e:
            logger.warning(f"[Item] 旁白后台生成失败: {e}")
    asyncio.create_task(_gen_narration_bg())

    return response
