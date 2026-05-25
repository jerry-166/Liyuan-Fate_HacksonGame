"""
物品发现旁白生成器。
"""

import os
import logging
from typing import Optional

from state.session import GameSession, NarrativeItem
from llm.client import LLMClient
from config import LLM_MODEL

logger = logging.getLogger(__name__)


class ItemGenerator:

    def __init__(self):
        self._template_cache: Optional[str] = None

    def _load_template(self) -> str:
        if self._template_cache:
            return self._template_cache
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "prompts", "item_discovery.txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._template_cache = f.read()
        else:
            self._template_cache = ""
        return self._template_cache

    async def generate_discovery_narration(
        self, session: GameSession, item: NarrativeItem
    ) -> str:
        """为物品发现生成旁白文本。"""
        template = self._load_template()
        chapter = session.get_current_chapter()

        prompt = template.format(
            script_name=session.script_id,
            worldview=session.system_prompt[:300] if session.system_prompt else "",
            player_name=session.player_name,
            chapter_name=chapter.get("name", "未知") if chapter else "未知",
            item_name=item.name,
            item_desc=item.base_description[:200],
        )

        messages = [
            {"role": "system", "content": "你是叙事旁白生成器。直接输出旁白文本，不要 JSON。"},
            {"role": "user", "content": prompt},
        ]

        llm = LLMClient(model=session.model or LLM_MODEL)
        try:
            result = await llm.chat_json(
                messages, api_key=session.api_key,
                temperature=0.8, max_tokens=256,
            )
            narration = result.get("raw", str(result))
            if len(narration) > 300:
                narration = narration[:300]
            return narration.strip()
        except Exception as e:
            logger.warning(f"[ItemGenerator] 旁白生成失败: {e}")
            return f"你发现了「{item.name}」……"

    @staticmethod
    def create_runtime_item(item_def: dict) -> NarrativeItem:
        """从 YAML 物品定义创建运行时 NarrativeItem。"""
        return NarrativeItem.from_dict(item_def)
