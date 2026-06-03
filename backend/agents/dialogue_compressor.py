"""
对话压缩器 — LLM 对话摘要压缩。

触发时机：
  1. 章节结束时 → 压缩所有 NPC 的上一章对话（所有对话历史）
  2. 单个 NPC 对话轮数超过阈值 → 压缩该 NPC 的旧对话（保留最近5轮）
"""

import os
import logging
from typing import Optional

from state.session import GameSession

logger = logging.getLogger(__name__)

_PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "prompts")

# 触发压缩的单 NPC 对话轮数阈值
COMPRESS_ROUND_THRESHOLD = 15

# 压缩时保留最近 N 轮原始对话
KEEP_RECENT_ROUNDS = 5


class DialogueCompressor:

    def __init__(self):
        self._template_cache: Optional[str] = None

    def _load_template(self) -> str:
        if self._template_cache:
            return self._template_cache
        path = os.path.join(_PROMPTS_DIR, "compress_dialogue.txt")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._template_cache = f.read()
        else:
            logger.warning("[DialogueCompressor] compress_dialogue.txt not found")
            return self._default_template()
        return self._template_cache

    @staticmethod
    def _default_template() -> str:
        return """请将以下 {npc_name} 与 {player_name} 的对话压缩为叙事摘要（100-200字）。
对话历史：
{dialogue_text}
章节：{chapter_name}
直接输出摘要。"""

    async def compress_npc_dialogue(
        self,
        session: GameSession,
        npc_id: str,
    ) -> Optional[str]:
        """压缩指定 NPC 的全部对话历史为叙事摘要。

        Args:
            session: 游戏会话
            npc_id: NPC ID

        Returns:
            压缩后的摘要文本，或 None（无需压缩或无对话）
        """
        npc = session.npcs.get(npc_id)
        if not npc or not npc.dialogue_history:
            return None

        total_turns = len(npc.dialogue_history)
        if total_turns == 0:
            return None

        # 构建对话文本
        dialogue_lines = []
        for turn in npc.dialogue_history:
            role_label = "玩家" if turn.role == "player" else npc.name
            dialogue_lines.append(f"{role_label}：{turn.content[:200]}")

        # 如果对话太长，截断总行数（保留前后各50轮）
        if len(dialogue_lines) > 100:
            dialogue_text = "\n".join(dialogue_lines[:50]) + "\n...(中略)...\n" + "\n".join(dialogue_lines[-50:])
        else:
            dialogue_text = "\n".join(dialogue_lines)

        chapter = session.get_current_chapter()
        chapter_name = chapter.get("name", "未知") if chapter else "未知"

        template = self._load_template()
        prompt = template.format(
            npc_name=npc.name,
            npc_role=npc.role,
            chapter_name=chapter_name,
            player_name=session.player_name,
            dialogue_text=dialogue_text,
        )

        # 安全问题：转义花括号
        prompt = prompt.replace("{", "{{").replace("}", "}}")
        # 还原我们自己的占位符... wait no, we already formatted. The prompt is good.

        messages = [
            {"role": "system", "content": "你是叙事摘要引擎。只输出摘要文本，不要 JSON、markdown、或任何格式标记。"},
            {"role": "user", "content": prompt},
        ]

        from llm.client import LLMClient
        from config import LLM_MODEL

        llm = LLMClient(model=session.model or LLM_MODEL)
        try:
            result = await llm.chat_completion(
                messages,
                api_key=session.api_key,
                temperature=0.5,
                max_tokens=300,
            )
            summary = result.strip()
            if summary:
                logger.info(f"[DialogueCompressor] Compressed {npc_id} dialogue "
                           f"({total_turns} turns → {len(summary)} chars)")
                return summary
        except Exception as e:
            logger.warning(f"[DialogueCompressor] LLM compress failed for {npc_id}: {e}")

        return None

    async def compress_npc_old_dialogue(
        self,
        session: GameSession,
        npc_id: str,
    ) -> Optional[str]:
        """压缩指定 NPC 的旧对话（保留最近 KEEP_RECENT_ROUNDS 轮）。

        用于单 NPC 对话超阈值时的增量压缩。
        压缩后清空旧对话，保留最近几轮。

        Args:
            session: 游戏会话
            npc_id: NPC ID

        Returns:
            压缩后的摘要文本
        """
        npc = session.npcs.get(npc_id)
        if not npc or not npc.dialogue_history:
            return None

        total = len(npc.dialogue_history)
        # 保留最近 KEEP_RECENT_ROUNDS*2 条（玩家+NPC 各一轮）
        keep_count = KEEP_RECENT_ROUNDS * 2
        if total <= keep_count:
            return None

        # 要被压缩的部分
        compress_turns = npc.dialogue_history[:-keep_count]

        dialogue_lines = []
        for turn in compress_turns:
            role_label = "玩家" if turn.role == "player" else npc.name
            dialogue_lines.append(f"{role_label}：{turn.content[:200]}")

        if len(dialogue_lines) > 100:
            dialogue_text = "\n".join(dialogue_lines[:50]) + "\n...(中略)...\n" + "\n".join(dialogue_lines[-50:])
        else:
            dialogue_text = "\n".join(dialogue_lines)

        chapter = session.get_current_chapter()
        chapter_name = chapter.get("name", "未知") if chapter else "未知"

        template = self._load_template()
        prompt = template.format(
            npc_name=npc.name,
            npc_role=npc.role,
            chapter_name=chapter_name,
            player_name=session.player_name,
            dialogue_text=dialogue_text,
        )

        messages = [
            {"role": "system", "content": "你是叙事摘要引擎。只输出摘要文本。"},
            {"role": "user", "content": prompt},
        ]

        from llm.client import LLMClient
        from config import LLM_MODEL

        llm = LLMClient(model=session.model or LLM_MODEL)
        try:
            result = await llm.chat_completion(
                messages,
                api_key=session.api_key,
                temperature=0.5,
                max_tokens=300,
            )
            summary = result.strip()
            if summary:
                logger.info(f"[DialogueCompressor] Incremental compress {npc_id} "
                           f"({len(compress_turns)} old turns → {len(summary)} chars)")
                # 清除旧对话，只保留最近几轮
                npc.dialogue_history = npc.dialogue_history[-keep_count:]
                return summary
        except Exception as e:
            logger.warning(f"[DialogueCompressor] Incremental compress failed for {npc_id}: {e}")

        return None

    async def compress_all_for_chapter_end(self, session: GameSession) -> dict[str, str]:
        """章节结束时压缩所有 NPC 的对话。

        跳过低对话量的 NPC（跳章场景：对话太少不值得调 LLM，模板拼接已足够）。
        Returns:
            {npc_id: summary} 字典
        """
        MIN_TURNS_TO_COMPRESS = 6  # 至少3轮对话才值得压缩

        results = {}
        for npc_id in session.npcs:
            npc = session.npcs[npc_id]
            if not npc.dialogue_history:
                continue
            # 对话太少（如跳章场景），跳过 LLM 压缩，只靠模板拼接
            if len(npc.dialogue_history) < MIN_TURNS_TO_COMPRESS:
                continue
            summary = await self.compress_npc_dialogue(session, npc_id)
            if summary:
                results[npc_id] = summary
                # 清除该 NPC 的所有对话历史（已压缩）
                npc.dialogue_history = []
                npc.dialogue_round_count = 0
                npc.last_options = []

        if results:
            logger.info(f"[DialogueCompressor] Chapter end: compressed {len(results)} NPCs")
            # 存入 session
            session.compressed_summaries.update(results)

        return results
