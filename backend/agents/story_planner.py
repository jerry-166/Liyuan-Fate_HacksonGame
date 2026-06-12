"""
剧本大纲生成器 — 开局时一次性生成全5章大纲，逐章生成详细任务 + 动态叙事。
"""

import json
import logging
import os
import uuid
from typing import Optional

from state.session import GameSession, TaskInstance, SubTask, SubTaskStatus
from llm.client import LLMClient
from config import LLM_MODEL

logger = logging.getLogger(__name__)


class StoryPlanner:

    def __init__(self):
        self._outline_template: Optional[str] = None
        self._narrative_template: Optional[str] = None

    def _load_outline_template(self) -> str:
        if self._outline_template:
            return self._outline_template
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "prompts", "story_outline.txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._outline_template = f.read()
        else:
            self._outline_template = ""
        return self._outline_template

    def _load_narrative_template(self) -> str:
        """加载章节叙事动态生成模板。"""
        if self._narrative_template:
            return self._narrative_template
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "prompts", "chapter_narrative.txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._narrative_template = f.read()
        else:
            self._narrative_template = ""
        return self._narrative_template

    async def generate_outline(self, session: GameSession) -> list[dict]:
        """生成全5章叙事大纲。返回 list[{chapter_id, summary, key_conflict, atmosphere}]。"""
        template = self._load_outline_template()
        if not template:
            logger.warning("[StoryPlanner] story_outline.txt not found, skipping outline generation")
            return []

        # 安全 format：转义花括号
        worldview_safe = (session.system_prompt or "").replace("{", "{{").replace("}", "}}")[:500]

        chapters_skeleton = "\n".join(
            f"- {ch.get('id')}: {ch.get('name')} — {ch.get('description', '')[:80]}"
            for ch in session.chapter_defs
        ).replace("{", "{{").replace("}", "}}")

        prompt = template.format(
            script_name=session.script_id,
            worldview=worldview_safe,
            chapters_skeleton=chapters_skeleton,
        )

        messages = [
            {"role": "system", "content": "你是叙事规划引擎，只输出合法 JSON，不要任何 markdown 标记或额外文字。"},
            {"role": "user", "content": prompt},
        ]

        llm = LLMClient(model=session.model or LLM_MODEL)
        try:
            import asyncio
            result = await asyncio.wait_for(
                llm.chat_json(messages, api_key=session.api_key,
                              temperature=0.7, max_tokens=1024),
                timeout=20.0,
            )
            outlines = result.get("outlines", [])
            if isinstance(outlines, list) and len(outlines) > 0:
                logger.info(f"[StoryPlanner] Generated {len(outlines)} chapter outlines")
                return outlines
        except Exception as e:
            logger.warning(f"[StoryPlanner] Outline generation failed: {e}")

        return []

    async def generate_chapter_detail(
        self, session: GameSession, chapter_def: dict, outline: Optional[dict] = None
    ) -> TaskInstance:
        """为指定章节生成详细 TaskInstance。

        优先使用 sub_task_templates（无 LLM 延迟）；
        有 AI 大纲时增强 prompt；否则调 LLM 规划。
        """
        from agents.task_planner import TaskPlanner
        planner = TaskPlanner()

        st_templates = chapter_def.get("sub_task_templates", [])
        if st_templates:
            result = planner._fallback_from_templates(chapter_def)
            task = planner._parse_result(session, chapter_def, result)
        else:
            # 无模板 → 调 LLM
            task = await planner.plan_chapter(session, chapter_def)

        # 为 dialogue 类型子任务设置默认 min_dialogue_rounds
        for st in task.sub_tasks:
            if st.mode == "dialogue" and st.min_dialogue_rounds == 0:
                st.min_dialogue_rounds = 2

        return task

    async def generate_chapter_narrative(
        self, session: GameSession, chapter_def: dict
    ) -> str:
        """根据前一章游戏上下文，动态生成本章的完整叙事描述（200-300字）。

        与开局时一次性生成的简短钩子不同，此方法利用：
        - 前章 NPC 对话压缩摘要
        - NPC 关系变化
        - 新获得的物品
        - 已触发事件
        生成一篇具有剧本杀/恐怖风格、与玩家实际体验紧密相连的章节叙事。

        Returns:
            200-350 字的叙事文本；失败时返回章节原始钩子。
        """
        template = self._load_narrative_template()
        if not template:
            logger.warning("[StoryPlanner] chapter_narrative.txt not found, falling back to hook")
            return chapter_def.get("description", "")

        # ── 构建前情摘要 ──
        previous_context = self._build_previous_context(session)

        # ── 关系变化摘要 ──
        rel_parts = []
        for npc in session.npcs.values():
            delta = npc.relationship - npc.relationship_default
            if delta != 0:
                sign = "+" if delta > 0 else ""
                rel_parts.append(f"{npc.name}: {sign}{delta}")
        relationship_changes = "、".join(rel_parts) if rel_parts else "无显著变化"

        # ── 新获得物品 ──
        inv_names = [i.name for i in session.inventory]
        completed_ch_ids = set(session.completed_chapters)
        prev_ch_items = []
        for ch in session.chapter_defs:
            if ch.get("id") in completed_ch_ids:
                for item_id in ch.get("required_items", []):
                    if any(i.id == item_id for i in session.inventory):
                        item_name = next((i.name for i in session.inventory if i.id == item_id), item_id)
                        prev_ch_items.append(f"{item_name}（{ch.get('name', '')}）")
        new_items = "、".join(prev_ch_items[-5:]) if prev_ch_items else "无"

        # ── 已触发事件 ──
        triggered_events = "、".join(sorted(session.events_triggered)[-5:]) if session.events_triggered else "无"

        # ── 构建 prompt ──
        worldview_raw = (session.system_prompt or "")[:500]
        worldview_safe = worldview_raw.replace("{", "{{").replace("}", "}}")

        # 从 meta 获取 horror_core（AI 生成的剧本才有）
        horror_core = ""
        try:
            from routes.script import _load_script_meta
            meta = _load_script_meta(session.script_id)
            horror_core = meta.get("horror_core", "")
        except Exception:
            pass
        horror_core_safe = horror_core.replace("{", "{{").replace("}", "}}")

        chapter_hook = chapter_def.get("description", "")
        chapter_hook_safe = chapter_hook.replace("{", "{{").replace("}", "}}")

        prompt = template.format(
            script_name=session.script_id,
            worldview=worldview_safe,
            horror_core=horror_core_safe,
            chapter_name=chapter_def.get("name", ""),
            chapter_hook=chapter_hook_safe,
            goal=chapter_def.get("goal", ""),
            key_conflict=chapter_def.get("key_conflict", ""),
            previous_context=previous_context,
            player_name=session.player_name,
            completed_chapters="、".join(session.completed_chapters) or "无（新游戏开始）",
            relationship_changes=relationship_changes,
            new_items=new_items,
            triggered_events=triggered_events,
        )

        messages = [
            {"role": "system", "content": "你是专精于「剧本杀·恐怖悬疑·规则怪谈」的叙事写手。输出纯文本，不要任何标记或额外说明。"},
            {"role": "user", "content": prompt},
        ]

        llm = LLMClient(model=session.model or LLM_MODEL)
        fallback = chapter_def.get("description", "")
        try:
            import asyncio
            result = await asyncio.wait_for(
                llm.chat_completion(messages, api_key=session.api_key, temperature=0.8, max_tokens=512),
                timeout=15.0,
            )
            # clean possible markdown wrappers
            text = result.strip()
            if text.startswith("```"):
                # remove code fence
                lines = text.split("\n")
                text = "\n".join(lines[1:-1] if len(lines) > 2 else lines)
            text = text.strip()
            if len(text) < 30:
                logger.warning(f"[StoryPlanner] Narrative too short ({len(text)} chars), fallback")
                return fallback
            logger.info(f"[StoryPlanner] Generated chapter narrative ({len(text)} chars)")
            return text
        except asyncio.TimeoutError:
            logger.warning("[StoryPlanner] Narrative generation timed out (15s)")
        except Exception as e:
            logger.warning(f"[StoryPlanner] Narrative generation failed: {e}")

        return fallback

    def _build_previous_context(self, session: GameSession) -> str:
        """从前章压缩对话和其他状态构建前情摘要文本。"""
        parts = []

        # 1. 压缩的 NPC 对话摘要
        if session.compressed_summaries:
            for npc_id, summary in session.compressed_summaries.items():
                npc = session.npcs.get(npc_id)
                name = npc.name if npc else npc_id
                # 只取最后 150 字
                short = summary[-150:] if len(summary) > 150 else summary
                parts.append(f"【{name}】{short}")
            # 取最近 3 个 NPC
            if len(parts) > 3:
                parts = parts[-3:]

        # 2. 如果没有任何压缩摘要（第一章），提供基础上下文
        if not parts and session.completed_chapters:
            completed_names = []
            for ch in session.chapter_defs:
                if ch.get("id") in session.completed_chapters:
                    completed_names.append(ch.get("name", ch.get("id", "")))
            if completed_names:
                parts.append(f"已完成章节：{' → '.join(completed_names)}")
            if session.current_task:
                parts.append(session.current_task.description[:200])

        if not parts:
            return "（新游戏开始，尚无前情）"

        return "\n\n".join(parts)
