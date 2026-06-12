"""
世界路由 — 开放世界的静态数据（物品、场景等）。
与剧本无关，是 AI 生成剧本时的"世界约束"数据源。

端点：
  GET  /api/world/items    — 获取世界中所有预置物品（含模板合并）
  GET  /api/world/scenes   — 获取世界中所有场景定义
"""

import logging
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException

from config import DATA_DIR

router = APIRouter()
logger = logging.getLogger(__name__)

WORLD_DIR = Path(DATA_DIR) / "world"
WORLD_ITEMS_DIR = WORLD_DIR / "items"

# ─── 缓存 ────────────────────────────────────────────────

_world_templates_cache: dict = {}
_world_items_cache: list = []
_world_scenes_cache: list = []
_cache_loaded = False


def _ensure_world_data_loaded():
    """懒加载世界数据（模板 + 物品 + 场景）。"""
    global _world_templates_cache, _world_items_cache, _world_scenes_cache, _cache_loaded
    if _cache_loaded:
        return

    # 加载模板
    tmpl_path = WORLD_ITEMS_DIR / "templates.yaml"
    if tmpl_path.exists():
        try:
            with open(tmpl_path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            for t in (raw.get("templates", []) if isinstance(raw, dict) else []):
                tid = t.get("template_id", "")
                if tid:
                    _world_templates_cache[tid] = t
            logger.info(f"[World] 加载 {len(_world_templates_cache)} 个物品模板")
        except Exception as e:
            logger.error(f"[World] 模板加载失败: {e}")

    # 加载物品
    items_path = WORLD_ITEMS_DIR / "world_items.yaml"
    if items_path.exists():
        try:
            with open(items_path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            _world_items_cache = raw.get("items", []) if isinstance(raw, dict) else raw or []
            logger.info(f"[World] 加载 {len(_world_items_cache)} 件世界物品")
        except Exception as e:
            logger.error(f"[World] 物品加载失败: {e}")

    # 加载场景
    scenes_path = WORLD_DIR / "scenes.yaml"
    if scenes_path.exists():
        try:
            with open(scenes_path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            _world_scenes_cache = raw.get("scenes", []) if isinstance(raw, dict) else raw or []
            logger.info(f"[World] 加载 {len(_world_scenes_cache)} 个世界场景")
        except Exception as e:
            logger.error(f"[World] 场景加载失败: {e}")

    _cache_loaded = True


def _merge_world_item(item_def: dict, templates: dict) -> dict:
    """将世界物品与模板合并，返回干净的扁平 dict（无剧本属性）。"""
    template_ref = item_def.get("template_ref", "")
    tmpl = templates.get(template_ref, {})

    item_id = item_def.get("item_id", "")

    # 模板物理属性（物品可覆盖）
    category = item_def.get("category", tmpl.get("category", "misc"))
    icon = item_def.get("icon", tmpl.get("icon", "item"))
    size = item_def.get("size", tmpl.get("size", "small"))
    holdable = item_def.get("holdable", tmpl.get("holdable", True))
    actions = item_def.get("actions", tmpl.get("actions", ["examine"]))

    # 名称与描述
    name = item_def.get("name", tmpl.get("name", item_id))
    base_description = item_def.get("base_description", tmpl.get("generic_desc", ""))

    # 位置
    position = item_def.get("position")
    scene = item_def.get("scene", "")

    # 模板通用描述（AI 可据此生成物品外观）
    generic_desc = tmpl.get("generic_desc", "")

    return {
        "item_id": item_id,
        "name": name,
        "template_ref": template_ref,
        # 描述
        "base_description": (base_description or generic_desc or "").strip(),
        "generic_desc": generic_desc,  # 模板的通用描述，AI 可参考
        "desc_source": item_def.get("desc_source", "ai"),
        # 物理属性
        "category": category,
        "icon": icon,
        "size": size,
        "holdable": holdable,
        "actions": actions,
        # 世界位置
        "scene": scene,
        "position": position,
    }


# ═══════════════════════════════════════════════════════════════
# API
# ═══════════════════════════════════════════════════════════════

@router.get("/world/items")
async def get_world_items():
    """
    返回开放世界中所有预置物品的完整信息（模板合并后）。

    无章节关联、无 NPC 关联、无关键标记 —— 纯粹的世界资产数据。
    这是 AI 生成微剧本时的"世界约束"数据源。

    返回格式：
    {
      "total": 10,
      "templates_count": 8,
      "scenes": ["father_house", "stage_ruin", ...],
      "items": [ { ... }, ... ]
    }
    """
    _ensure_world_data_loaded()

    if not _world_items_cache:
        return {
            "total": 0,
            "templates_count": len(_world_templates_cache),
            "scenes": [],
            "items": [],
        }

    items = []
    scenes_set = set()
    for item_def in _world_items_cache:
        full = _merge_world_item(item_def, _world_templates_cache)
        items.append(full)
        if full["scene"]:
            scenes_set.add(full["scene"])

    return {
        "total": len(items),
        "templates_count": len(_world_templates_cache),
        "scenes": sorted(scenes_set),
        "items": items,
    }


@router.get("/world/scenes")
async def get_world_scenes():
    """
    返回开放世界中所有场景的完整定义。

    包括场景名称、描述、氛围、类型、子场景映射、场景间连接、值得注意的区域等。
    这是 AI 生成微剧本时的"世界空间"数据源。

    返回格式：
    {
      "total": 7,
      "scenes": [
        {
          "scene_id": "town",
          "name": "江南小镇",
          "type": "outdoor",
          "description": "...",
          "atmosphere": [...],
          "connections": [...],
          ...
        }
      ]
    }
    """
    _ensure_world_data_loaded()

    if not _world_scenes_cache:
        return {"total": 0, "scenes": []}

    # 按类型分组统计
    outdoor_count = sum(1 for s in _world_scenes_cache if s.get("type") == "outdoor")
    indoor_count = sum(1 for s in _world_scenes_cache if s.get("type") == "indoor")

    # 构建场景连接图
    adjacencies = {}
    for s in _world_scenes_cache:
        sid = s.get("scene_id", "")
        connections = s.get("connections", [])
        adjacencies[sid] = connections

    return {
        "total": len(_world_scenes_cache),
        "outdoor_count": outdoor_count,
        "indoor_count": indoor_count,
        "adjacencies": adjacencies,
        "scenes": _world_scenes_cache,
    }
