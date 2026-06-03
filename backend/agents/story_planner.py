"""
剧本大纲生成器 — 开局时一次性生成全5章大纲，逐章生成详细任务。
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
