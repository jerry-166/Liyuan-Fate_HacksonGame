"""
剧本路由 — 剧本可插拔 + AI 生成微剧本 + 骨架编辑。

端点：
  GET  /api/scripts                       列出所有剧本
  GET  /api/scripts/{script_id}           获取单个剧本详情
  POST /api/scripts/generate              AI 生成新剧本（写入 data/scripts/）
  GET  /api/scripts/{script_id}/skeleton  获取剧本骨架（章节大纲）
  PATCH /api/scripts/{script_id}/skeleton 修改剧本骨架
  GET  /api/scripts/{script_id}/chapters  获取完整章节列表
"""

import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Optional, List

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import DATA_DIR

router = APIRouter()
logger = logging.getLogger(__name__)

SCRIPTS_DIR = Path(DATA_DIR).parent / "data" / "scripts"


# ═══════════════════════════════════════════════════════════════
# 辅助函数
# ═══════════════════════════════════════════════════════════════

def _load_script_meta(script_id: str) -> dict:
    meta_path = SCRIPTS_DIR / script_id / "meta.yaml"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "SCRIPT_NOT_FOUND",
            "message": f"剧本不存在: {script_id}"
        })
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": True, "message": f"读取 meta.yaml 失败: {e}"})


def _load_chapters(script_id: str) -> list:
    meta = _load_script_meta(script_id)
    ch_file = SCRIPTS_DIR / script_id / (meta.get("chapters_file") or "chapters.yaml")
    if not ch_file.exists():
        return []
    try:
        with open(ch_file, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        if isinstance(raw, dict):
            return raw.get("chapters", [])
        return raw or []
    except Exception:
        return []


def _save_chapters(script_id: str, chapters: list) -> None:
    meta = _load_script_meta(script_id)
    ch_file = SCRIPTS_DIR / script_id / (meta.get("chapters_file") or "chapters.yaml")
    with open(ch_file, "w", encoding="utf-8") as f:
        yaml.dump({"chapters": chapters}, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _sanitize_id(text: str) -> str:
    """把中文/空格等转成合法目录名。"""
    s = re.sub(r'[^\w\u4e00-\u9fff]', '_', text.strip())
    return s[:32] if s else "script"


# ═══════════════════════════════════════════════════════════════
# 请求/响应模型
# ═══════════════════════════════════════════════════════════════

class GenerateScriptRequest(BaseModel):
    theme: str                              # 主题，如"赛博朋克侦探"
    style: str = "悬疑推理"                 # 风格
    chapter_count: int = 5                  # 章节数 2~8
    protagonist_desc: str = ""              # 主角背景描述（可选）
    extra_notes: str = ""                   # 额外备注（可选）
    api_key: Optional[str] = None
    model: Optional[str] = None


class UpdateSkeletonRequest(BaseModel):
    chapters: List[dict]   # 修改后的章节骨架列表
    worldview: Optional[str] = None   # 可选：同时修改世界观
    name: Optional[str] = None        # 可选：同时修改剧本名


class GenerateScriptResponse(BaseModel):
    script_id: str
    name: str
    worldview: str
    chapters: list
    npc_count: int
    status: str  # "generated" | "saved"


# ═══════════════════════════════════════════════════════════════
# AI 生成剧本的 Prompt
# ═══════════════════════════════════════════════════════════════

GENERATE_SCRIPT_PROMPT = """你是一位资深叙事游戏编剧。请根据以下信息创作一个完整的微剧本骨架，格式为严格的JSON，不要任何markdown标记。

【主题】{theme}
【风格】{style}
【章节数】{chapter_count}
【主角背景】{protagonist_desc}
【额外备注】{extra_notes}

要求：
1. 世界观描述100-200字，有画面感，有时代/地域特色
2. 每章节有独特的情节钩子，章节间有因果推进
3. NPC设计：3-5个，各有独特性格和在故事中的作用
4. 剧本需有明确的核心冲突和至少两种可能的结局走向
5. ★ 不要生成 sub_task_templates —— 子任务将在游戏中由 AI 根据上一章上下文动态生成，更贴合玩家行为

输出JSON格式：
{{
  "name": "剧本名称（4-8字）",
  "worldview": "世界观描述（100-200字）",
  "npcs": [
    {{
      "id": "npc_xxx",
      "name": "NPC名字",
      "role": "角色定位（如：老医生、神秘向导）",
      "scene": "主要所在场景（town/stage/teahouse/dock之一）",
      "personality": "性格特点（30字内）",
      "secret": "隐藏的秘密或动机（30字内）"
    }}
  ],
  "chapters": [
    {{
      "id": "ch_01",
      "name": "章节名（4-8字）",
      "sort_order": 1,
      "type": "normal",
      "description": "章节概要（50-80字）",
      "goal": "玩家目标（20字内）",
      "key_conflict": "核心冲突（30字内）",
      "atmosphere": "氛围描述（20字内）",
      "color_tone": "amber|crimson|teal|violet|slate 之一",
      "bgm_mood": "melancholy|tense|hopeful|mysterious|triumphant 之一",
      "required_npcs": ["npc_xxx"]
    }}
  ],
  "ending_directions": [
    {{"type": "ending_A", "condition": "触发条件", "title": "结局名"}},
    {{"type": "ending_B", "condition": "触发条件", "title": "结局名"}}
  ]
}}"""


# ═══════════════════════════════════════════════════════════════
# 路由实现
# ═══════════════════════════════════════════════════════════════

@router.get("/scripts")
async def list_scripts():
    """列出所有可用剧本（带章节数、NPC数、描述）。"""
    from data.script_loader import ScriptLoader
    loader = ScriptLoader()
    try:
        scripts = loader.list_scripts()
        return {"scripts": scripts, "total": len(scripts)}
    except Exception as e:
        logger.error(f"[Scripts] list failed: {e}")
        return {"scripts": [], "total": 0, "error": str(e)}


@router.get("/scripts/{script_id}")
async def get_script_detail(script_id: str):
    """获取单个剧本详情（meta + chapters 骨架）。"""
    meta = _load_script_meta(script_id)
    chapters = _load_chapters(script_id)

    return {
        "script_id": script_id,
        "name": meta.get("name", script_id),
        "version": meta.get("version", "1.0"),
        "author": meta.get("author", ""),
        "worldview": meta.get("worldview", ""),
        "npc_count": len(meta.get("npcs", [])),
        "chapter_count": len(chapters),
        "npcs": [
            {
                "id": n.get("id"),
                "name": n.get("name"),
                "role": n.get("role", ""),
                "scene": n.get("scene", "town"),
            }
            for n in meta.get("npcs", [])
        ],
        "chapters": [
            {
                "id": ch.get("id"),
                "name": ch.get("name"),
                "sort_order": ch.get("sort_order", 0),
                "type": ch.get("type", "normal"),
                "description": ch.get("description", ""),
                "goal": ch.get("goal", ""),
                "key_conflict": ch.get("key_conflict", ""),
                "atmosphere": ch.get("atmosphere", ""),
                "color_tone": ch.get("color_tone", ""),
                "bgm_mood": ch.get("bgm_mood", ""),
                "required_npcs": ch.get("required_npcs", []),
                "sub_task_count": len(ch.get("sub_task_templates", [])),
            }
            for ch in chapters
        ],
    }


@router.post("/scripts/generate", status_code=201)
async def generate_script(req: GenerateScriptRequest):
    """
    AI 根据主题生成完整微剧本骨架，写入 data/scripts/{script_id}/。

    流程：
    1. 调用 LLM 生成 JSON 结构化剧本
    2. 校验并补全缺失字段
    3. 写入 meta.yaml + chapters.yaml + personas/
    4. 返回 script_id + 完整骨架供前端预览/编辑
    """
    from llm.client import LLMClient
    from config import LLM_MODEL

    chapter_count = max(2, min(8, req.chapter_count))

    prompt = GENERATE_SCRIPT_PROMPT.format(
        theme=req.theme,
        style=req.style,
        chapter_count=chapter_count,
        protagonist_desc=req.protagonist_desc or "由玩家自行定义",
        extra_notes=req.extra_notes or "无",
    )

    messages = [
        {
            "role": "system",
            "content": "你是专业游戏编剧AI，只输出合法JSON，不要任何markdown、代码块或额外文字。"
        },
        {"role": "user", "content": prompt},
    ]

    llm = LLMClient(model=req.model or LLM_MODEL)
    try:
        import asyncio
        result = await asyncio.wait_for(
            llm.chat_json(messages, api_key=req.api_key, temperature=0.85, max_tokens=4096),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail={
            "error": True, "code": "LLM_TIMEOUT",
            "message": "AI 生成超时，请重试"
        })
    except Exception as e:
        logger.exception(f"[ScriptGen] LLM call failed: {e}")
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "LLM_FAILED",
            "message": f"AI 生成失败: {str(e)}"
        })

    # ── 校验 & 补全 ──
    if not result.get("name") or not result.get("chapters"):
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "INVALID_RESULT",
            "message": "AI 返回的剧本结构不完整，请重试"
        })

    script_name = result["name"]
    script_id = f"ai_{_sanitize_id(req.theme)}_{uuid.uuid4().hex[:6]}"

    # 补全 NPC 默认字段
    npcs_raw = result.get("npcs", [])
    npcs_for_meta = []
    for i, npc in enumerate(npcs_raw):
        npc_id = npc.get("id") or f"npc_{uuid.uuid4().hex[:6]}"
        scenes = ["town", "stage", "teahouse", "dock"]
        npcs_for_meta.append({
            "id": npc_id,
            "name": npc.get("name", f"NPC{i+1}"),
            "role": npc.get("role", "角色"),
            "persona_file": f"{npc_id}.yaml",
            "scene": npc.get("scene", scenes[i % len(scenes)]),
            "position": {"col": 20 + i * 8, "row": 15 + i * 4},
            "sprite_key": f"npc_{npc_id}_idle",
            "relationship_default": 0,
        })

    # 补全章节默认字段
    chapters = result.get("chapters", [])
    valid_color_tones = {"amber", "crimson", "teal", "violet", "slate"}
    valid_bgm_moods = {"melancholy", "tense", "hopeful", "mysterious", "triumphant"}
    for i, ch in enumerate(chapters):
        if not ch.get("id"):
            ch["id"] = f"ch_{i+1:02d}"
        ch.setdefault("sort_order", i + 1)
        ch.setdefault("type", "normal")
        ch.setdefault("description", ch.get("goal", ""))
        ch.setdefault("color_tone", list(valid_color_tones)[i % len(valid_color_tones)])
        ch.setdefault("bgm_mood", list(valid_bgm_moods)[i % len(valid_bgm_moods)])
        ch.setdefault("required_npcs", [n["id"] for n in npcs_for_meta[:2]])
        ch.setdefault("required_items", [])
        # ★ AI 生成的剧本不留 sub_task_templates，让 LLM 在游戏中动态生成
        ch["sub_task_templates"] = []

    # ── 写入文件 ──
    script_dir = SCRIPTS_DIR / script_id
    script_dir.mkdir(parents=True, exist_ok=True)
    (script_dir / "personas").mkdir(exist_ok=True)
    (script_dir / "items").mkdir(exist_ok=True)

    # meta.yaml
    meta = {
        "script_id": script_id,
        "name": script_name,
        "version": "1.0",
        "author": f"AI Generated ({req.theme})",
        "worldview": result.get("worldview", ""),
        "system_prompt_file": None,
        "persona_dir": "personas/",
        "chapters_file": "chapters.yaml",
        "items_file": "items/story_items.yaml",
        "npcs": npcs_for_meta,
        "town_npcs": [],
        "prompt_overrides": {},
        "ai_generated": True,
        "ai_theme": req.theme,
        "ai_style": req.style,
        "ending_directions": result.get("ending_directions", []),
    }
    with open(script_dir / "meta.yaml", "w", encoding="utf-8") as f:
        yaml.dump(meta, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    # chapters.yaml
    with open(script_dir / "chapters.yaml", "w", encoding="utf-8") as f:
        yaml.dump({"chapters": chapters}, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    # personas — 为每个 NPC 生成基础 persona 文件
    for npc_raw, npc_meta in zip(npcs_raw, npcs_for_meta):
        persona = {
            "id": npc_meta["id"],
            "name": npc_meta["name"],
            "role": npc_meta["role"],
            "personality": npc_raw.get("personality", ""),
            "secret": npc_raw.get("secret", ""),
            "background": f"在{req.theme}的世界里，{npc_meta['name']}是{npc_meta['role']}。",
            "speech_style": "根据性格说话",
            "knowledge": [],
        }
        with open(script_dir / "personas" / f"{npc_meta['id']}.yaml", "w", encoding="utf-8") as f:
            yaml.dump(persona, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    # items — 空模板
    with open(script_dir / "items" / "story_items.yaml", "w", encoding="utf-8") as f:
        yaml.dump({"items": []}, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    logger.info(f"[ScriptGen] Generated script: {script_id} ({script_name}), {len(chapters)} chapters, {len(npcs_for_meta)} NPCs")

    return {
        "script_id": script_id,
        "name": script_name,
        "worldview": meta["worldview"],
        "npcs": npcs_for_meta,
        "chapters": chapters,
        "npc_count": len(npcs_for_meta),
        "chapter_count": len(chapters),
        "ending_directions": result.get("ending_directions", []),
        "status": "saved",
    }


@router.get("/scripts/{script_id}/skeleton")
async def get_script_skeleton(script_id: str):
    """
    获取剧本骨架：世界观 + 每章标题/描述/目标/冲突。
    用于生成后的预览和游戏中的骨架编辑。
    """
    meta = _load_script_meta(script_id)
    chapters = _load_chapters(script_id)

    return {
        "script_id": script_id,
        "name": meta.get("name", script_id),
        "worldview": meta.get("worldview", ""),
        "ai_generated": meta.get("ai_generated", False),
        "ai_theme": meta.get("ai_theme", ""),
        "ai_style": meta.get("ai_style", ""),
        "ending_directions": meta.get("ending_directions", []),
        "chapters": [
            {
                "id": ch.get("id"),
                "name": ch.get("name"),
                "sort_order": ch.get("sort_order", i + 1),
                "type": ch.get("type", "normal"),
                "description": ch.get("description", ""),
                "goal": ch.get("goal", ""),
                "key_conflict": ch.get("key_conflict", ""),
                "atmosphere": ch.get("atmosphere", ""),
                "color_tone": ch.get("color_tone", "amber"),
                "bgm_mood": ch.get("bgm_mood", "melancholy"),
                "required_npcs": ch.get("required_npcs", []),
                "sub_task_count": len(ch.get("sub_task_templates", [])),
                "sub_task_templates": ch.get("sub_task_templates", []),
            }
            for i, ch in enumerate(chapters)
        ],
    }


@router.patch("/scripts/{script_id}/skeleton")
async def update_script_skeleton(script_id: str, req: UpdateSkeletonRequest):
    """
    修改剧本骨架（章节标题/描述/目标等），写回 YAML 文件。
    不影响 NPC personas 和物品数据。
    """
    # 校验剧本存在
    meta = _load_script_meta(script_id)
    chapters = _load_chapters(script_id)

    # 构建 chapter_id → 原章节 的映射
    existing_map = {ch.get("id"): ch for ch in chapters}

    updated_chapters = []
    for new_ch in req.chapters:
        ch_id = new_ch.get("id")
        if ch_id and ch_id in existing_map:
            # 合并：保留原章节的 sub_task_templates 等字段，只更新骨架字段
            base = dict(existing_map[ch_id])
            # 允许修改的骨架字段
            editable_fields = ["name", "description", "goal", "key_conflict",
                               "atmosphere", "color_tone", "bgm_mood", "type",
                               "required_npcs", "sub_task_templates"]
            for field in editable_fields:
                if field in new_ch:
                    base[field] = new_ch[field]
            updated_chapters.append(base)
        else:
            # 新增章节
            updated_chapters.append(new_ch)

    # 重新排序
    updated_chapters.sort(key=lambda c: c.get("sort_order", 999))

    _save_chapters(script_id, updated_chapters)

    # 可选：更新 meta.yaml 中的 worldview 和 name
    if req.worldview is not None or req.name is not None:
        if req.worldview is not None:
            meta["worldview"] = req.worldview
        if req.name is not None:
            meta["name"] = req.name
        meta_path = SCRIPTS_DIR / script_id / "meta.yaml"
        with open(meta_path, "w", encoding="utf-8") as f:
            yaml.dump(meta, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    logger.info(f"[Skeleton] Updated {script_id}: {len(updated_chapters)} chapters")

    return {
        "success": True,
        "script_id": script_id,
        "updated_chapter_count": len(updated_chapters),
        "chapters": updated_chapters,
    }
