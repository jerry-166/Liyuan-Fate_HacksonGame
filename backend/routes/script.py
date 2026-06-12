"""
剧本路由 — 剧本可插拔 + AI 生成微剧本 + 骨架编辑。

端点：
  GET  /api/scripts                       列出所有剧本
  GET  /api/scripts/{script_id}           获取单个剧本详情
  POST /api/scripts/generate              AI 生成新剧本（写入 data/scripts/）
  GET  /api/scripts/{script_id}/skeleton  获取剧本骨架（章节大纲）
  PATCH /api/scripts/{script_id}/skeleton 修改剧本骨架
  GET  /api/scripts/{script_id}/chapters  获取完整章节列表
  GET  /api/scripts/{script_id}/items     获取全量物品信息（含模板合并+坐标）
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


def _format_world_items_for_prompt() -> str:
    """
    加载世界物品数据并格式化为适合 LLM prompt 的文本。
    按场景分组，每件物品附名称、描述和坐标。
    """
    import yaml as _yaml

    items_path = SCRIPTS_DIR.parent / "world" / "items" / "world_items.yaml"
    templates_path = SCRIPTS_DIR.parent / "world" / "items" / "templates.yaml"

    # 加载模板
    templates = {}
    if templates_path.exists():
        try:
            with open(templates_path, "r", encoding="utf-8") as f:
                raw = _yaml.safe_load(f)
            for t in (raw.get("templates", []) if isinstance(raw, dict) else []):
                tid = t.get("template_id", "")
                if tid:
                    templates[tid] = t
        except Exception:
            pass

    # 加载物品
    if not items_path.exists():
        return "（暂无预置物品）"

    try:
        with open(items_path, "r", encoding="utf-8") as f:
            raw = _yaml.safe_load(f)
        item_defs = raw.get("items", []) if isinstance(raw, dict) else raw or []
    except Exception:
        return "（物品数据加载失败）"

    if not item_defs:
        return "（暂无预置物品）"

    # 按场景分组
    scene_groups: dict[str, list] = {}
    for item in item_defs:
        scene = item.get("scene", "未知场景")
        scene_groups.setdefault(scene, []).append(item)

    # 格式化输出
    lines = []
    scene_names = {
        "father_house": "父亲旧居",
        "stage_ruin": "戏台遗址",
        "teahouse": "茶馆",
        "temple": "祠堂",
        "cemetery": "墓地",
        "town": "镇上",
        "dock": "渡口",
    }

    for scene, items in scene_groups.items():
        scene_cn = scene_names.get(scene, scene)
        lines.append(f"\n### {scene_cn}（{scene}）")
        for item in items:
            item_id = item.get("item_id", "")
            name = item.get("name", item_id)
            desc = item.get("base_description", "")
            tmpl_ref = item.get("template_ref", "")
            tmpl = templates.get(tmpl_ref, {})
            category = item.get("category", tmpl.get("category", "misc"))
            holdable = item.get("holdable", tmpl.get("holdable", True))
            pos = item.get("position", {})
            coord = f"({pos.get('col','?')},{pos.get('row','?')})" if pos else ""

            hold_str = "可拾取" if holdable else "仅查看"
            lines.append(f"- [{category}] **{name}** {coord} ({hold_str})")
            if desc:
                # 限制描述长度，避免 prompt 过长
                desc_short = desc if len(desc) <= 120 else desc[:117] + "..."
                lines.append(f"  {desc_short}")

    return "\n".join(lines) if lines else "（暂无预置物品）"


def _format_world_scenes_for_prompt() -> str:
    """
    加载世界场景数据并格式化为适合 LLM prompt 的文本。
    包含场景名称、类型、描述、氛围、连接关系。
    """
    import yaml as _yaml

    scenes_path = SCRIPTS_DIR.parent / "world" / "scenes.yaml"
    if not scenes_path.exists():
        return "（暂无世界场景定义）"

    try:
        with open(scenes_path, "r", encoding="utf-8") as f:
            raw = _yaml.safe_load(f)
        scene_defs = raw.get("scenes", []) if isinstance(raw, dict) else raw or []
    except Exception:
        return "（场景数据加载失败）"

    if not scene_defs:
        return "（暂无世界场景定义）"

    lines = []

    # 先列所有户外场景（主世界）
    outdoor = [s for s in scene_defs if s.get("type") == "outdoor"]
    indoor = [s for s in scene_defs if s.get("type") == "indoor"]

    for s in outdoor:
        sid = s.get("scene_id", "")
        name = s.get("name", sid)
        desc = s.get("description", "").strip()
        atmos = "、".join(s.get("atmosphere", []))
        connections = " | ".join(s.get("connections", []))
        lines.append(f"\n### {name}（{sid}）[户外]")
        lines.append(f"氛围: {atmos}")
        lines.append(f"描述: {desc}")
        lines.append(f"可前往: {connections}")

    for s in indoor:
        sid = s.get("scene_id", "")
        name = s.get("name", sid)
        desc = s.get("description", "").strip()
        atmos = "、".join(s.get("atmosphere", []))
        areas = "、".join(s.get("notable_areas", []))
        lines.append(f"\n### {name}（{sid}）[室内]")
        lines.append(f"氛围: {atmos}")
        lines.append(f"描述: {desc}")
        if areas:
            lines.append(f"重要区域: {areas}")

    return "\n".join(lines) if lines else "（暂无世界场景定义）"


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

GENERATE_SCRIPT_PROMPT = """你是一位专精于「剧本杀·恐怖悬疑·规则怪谈」类型的叙事游戏编剧。请根据以下信息创作一个微剧本骨架，格式为严格的JSON，不要任何markdown标记。

【主题】{theme}
【风格】{style}（强烈建议往悬疑、恐怖、怪谈方向深化）
【章节数】{chapter_count}
【主角背景】{protagonist_desc}
【额外备注】{extra_notes}

## 开放世界场景（重要）
以下是当前开放世界中已存在的所有场景。你的剧本 **必须基于这些已有场景来设计**——
不要把故事发生地设在游戏里不存在的场景中。每个场景的氛围和空间结构是固定的，
你可以在这些空间里安排叙事。

{world_scenes}

## 开放世界预置物品（重要）
以下是当前开放世界中已存在的所有预置物品。你的剧本 **必须基于这些已有物品来设计**——
不要凭空编造不存在的物品。你可以决定哪些物品是叙事的核心，哪些是背景。
你可以：让物品之间产生隐藏的联系、赋予物品新的叙事意义、设计 NPC 对物品的不同认知。
——总之：**用已有的场景和物品，讲新的故事**。

{world_items}

## 叙事风格要求
你的故事必须有"细思极恐"的质感。技法：
- **信息不对称**：玩家知道的比NPC少，或者NPC说的和事实对不上
- **渐进恐怖**：不要一上来就吓人，先日常→违和→异常→毛骨悚然
- **规则怪谈**：如果有超自然元素，遵守一套自洽的"规则"（如：天黑后不能看镜子、第四个选项永远不存在）
- **反转钩子**：每章结束留一个让玩家脊背发凉的问题或画面
- **情感锚点**：恐怖中要有情感——遗憾、愧疚、执念、爱而不得——否则只是吓人不够动人

## 章节设计
1. 每章只需一个**叙事钩子**（20-30字），描述本章给玩家的核心悬念。不要写完整剧情——详细叙事将在游戏中根据前文上下文动态生成
2. 章节间必须有**因果级联**：前一章的某个发现，引出下一章的某个疑问
3. 整体形成"剥洋葱"式结构：表层谜题 → 中层反转 → 底层真相

## 输出JSON格式
{{
  "name": "剧本名称（4-8字，有氛围感）",
  "worldview": "世界观描述（100-200字，有画面感+让人不安的细节）",
  "horror_core": "恐怖核心（一条让整个故事立起来的「细思极恐」设定，如：'所有人都不记得你的名字'/'镇上的镜子里照不出你的脸'）",
  "npcs": [
    {{
      "id": "npc_xxx",
      "name": "NPC名字",
      "role": "角色定位",
      "scene": "主要所在场景（town/stage/teahouse/dock之一）",
      "personality": "性格特点（30字内）",
      "secret": "隐藏的秘密或动机（30字内，最好令人不安）"
    }}
  ],
  "chapters": [
    {{
      "id": "ch_01",
      "name": "章节名（4-8字，有悬念感）",
      "sort_order": 1,
      "type": "normal",
      "description": "叙事钩子（20-30字，激起好奇心，如：'你推开虚掩的门，镜子里的人影没有跟着你一起回头'）",
      "goal": "玩家目标（15字内）",
      "key_conflict": "核心冲突（30字内）",
      "atmosphere": "氛围（2-3词，如：'雨夜，霉味，窃窃私语'）",
      "color_tone": "amber|crimson|teal|violet|slate 之一",
      "bgm_mood": "melancholy|tense|hopeful|mysterious|triumphant 之一",
      "required_npcs": ["npc_xxx"]
    }}
  ],
  "ending_directions": [
    {{"type": "ending_A", "condition": "触发条件", "title": "结局名（有冲击力）"}},
    {{"type": "ending_B", "condition": "触发条件", "title": "结局名"}}
  ]
}}

## 质量约束
- ★ 不要生成 sub_task_templates —— 子任务将在游戏中由AI根据上一章上下文动态生成
- 每章 description 是"钩子"，不是完整剧情。详细叙事留给游戏时的动态生成
- horror_core 是全剧的灵魂，必须让人起鸡皮疙瘩
- NPC 的 secret 要互相矛盾或形成闭环，不能是孤立的"""


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
    1. 加载世界物品列表（作为生成约束）
    2. 调用 LLM 生成 JSON 结构化剧本
    3. 校验并补全缺失字段
    4. 写入 meta.yaml + chapters.yaml + personas/
    5. 返回 script_id + 完整骨架供前端预览/编辑
    """
    from llm.client import LLMClient
    from config import LLM_MODEL

    chapter_count = max(2, min(8, req.chapter_count))

    # ── 1. 加载世界资产作为生成约束 ──
    world_items_text = _format_world_items_for_prompt()
    world_scenes_text = _format_world_scenes_for_prompt()

    prompt = GENERATE_SCRIPT_PROMPT.format(
        theme=req.theme,
        style=req.style,
        chapter_count=chapter_count,
        protagonist_desc=req.protagonist_desc or "由玩家自行定义",
        extra_notes=req.extra_notes or "无",
        world_items=world_items_text,
        world_scenes=world_scenes_text,
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
        ch.setdefault("description", ch.get("name") or ch.get("goal", ""))
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
        "horror_core": result.get("horror_core", ""),  # ★ 恐怖核心设定
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


# ═══════════════════════════════════════════════════════════════
# 脚本级别全量物品查询 — 供 AI 剧本生成使用（无需 session）
# ═══════════════════════════════════════════════════════════════

@router.get("/scripts/{script_id}/items")
async def get_script_items(script_id: str):
    """
    获取剧本中【所有物品】的完整信息（含模板合并、坐标、NPC关联等）。

    不需要游戏 session —— 直接读取 YAML 文件。
    是 AI 生成剧本内容的核心数据源。

    返回格式：
    {
      "script_id": "liyuan_shengsi",
      "total": 10,
      "summary": { ... },
      "items": [ { ...完整物品信息... }, ... ]
    }
    """
    import yaml as _yaml

    # 读取剧本 meta 获取 items 文件路径
    meta = _load_script_meta(script_id)
    items_file_rel = meta.get("items_file") or "items/story_items.yaml"
    items_path = SCRIPTS_DIR / script_id / items_file_rel
    templates_path = SCRIPTS_DIR / script_id / "items" / "templates.yaml"

    # 1. 加载模板
    templates = {}
    if templates_path.exists():
        try:
            with open(templates_path, "r", encoding="utf-8") as f:
                raw = _yaml.safe_load(f)
            for t in (raw.get("templates", []) if isinstance(raw, dict) else []):
                tid = t.get("template_id", "")
                if tid:
                    templates[tid] = t
        except Exception as e:
            logger.error(f"[ScriptItems] 模板加载失败: {e}")

    # 2. 加载物品定义
    item_defs = []
    if items_path.exists():
        try:
            with open(items_path, "r", encoding="utf-8") as f:
                raw = _yaml.safe_load(f)
            item_defs = raw.get("items", []) if isinstance(raw, dict) else raw or []
        except Exception as e:
            logger.error(f"[ScriptItems] 物品定义加载失败: {e}")

    # 3. 加载章节（用于填充 stage_names）
    chapters = _load_chapters(script_id)
    chapter_map: dict[int, dict] = {}
    for ch in chapters:
        so = ch.get("sort_order", -1)
        if so >= 0:
            chapter_map[so] = {
                "id": ch.get("id", ""),
                "name": ch.get("name", ""),
                "description": (ch.get("description", "") or "")[:80],
            }

    # 4. 合并（复用 item.py 的合并逻辑）
    from routes.item import _merge_item_full
    items = []
    for item_def in item_defs:
        full = _merge_item_full(item_def, templates)

        # 填充章节名称
        stage_names = []
        for idx in full.get("stage_relevance", []):
            ch_info = chapter_map.get(idx)
            if ch_info:
                stage_names.append(ch_info)
        full["stage_names"] = stage_names

        items.append(full)

    # 5. 统计摘要
    key_items = [i for i in items if i["is_key"]]
    holdable_items = [i for i in items if i["holdable"]]
    scene_dist = {}
    for i in items:
        sc = i["scene"] or "(无场景)"
        scene_dist[sc] = scene_dist.get(sc, 0) + 1

    return {
        "script_id": script_id,
        "total": len(items),
        "summary": {
            "key_count": len(key_items),
            "holdable_count": len(holdable_items),
            "by_scene": scene_dist,
            "scenes": list(scene_dist.keys()),
        },
        "items": items,
    }
