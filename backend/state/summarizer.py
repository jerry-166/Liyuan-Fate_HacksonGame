"""对话摘要器（MVP 占位）。

MVP 阶段：对话轮数 < 20，LLM 上下文窗口足够容纳完整历史，
不需要摘要。此模块为后续版本预留接口。

TODO: 当对话轮数超过上下文窗口时，自动对早期对话做 LLM 摘要。
"""

import logging

logger = logging.getLogger(__name__)


def summarize_dialogue(dialogue_history: list[dict], max_summary_length: int = 200) -> str:
    """（占位）对对话历史做摘要。"""
    # MVP 不启用，直接返回原文拼接
    return ""
