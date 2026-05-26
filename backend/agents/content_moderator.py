"""
输入内容审核模块 — 基于规则的关键词黑名单 + 长度限制。

审核流程：
  1. 长度检查（超过 MAX_INPUT_LENGTH 直接拒绝）
  2. 黑名单关键词匹配（从文件加载，实时读取）
  3. 正则模式匹配（常见的 Prompt 注入变体）
"""

import os
import re
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ─── 配置 ───────────────────────────────────────────

MAX_INPUT_LENGTH: int = 100

BLACKLIST_FILE = os.path.join(os.path.dirname(__file__), "..", "prompts", "content_blacklist.txt")

# 正则模式：匹配试图操控 AI 的常见变体（黑名单之外的兜底）
INJECTION_PATTERNS = [
    re.compile(r"(?i)ignore\s+(all\s+)?previous"),
    re.compile(r"(?i)forget\s+(all\s+)?(?:your|the)\s+(?:instruction|prompt|rule|setting)"),
    re.compile(r"(?i)system\s*prompt"),
    re.compile(r"(?i)你是谁的开发"),
    re.compile(r"(?i)\[INST\]"),          # LLaMA 风格注入
    re.compile(r"(?i)<\|im_start\|>"),     # ChatML 风格注入
]


@dataclass
class ModerationResult:
    """审核结果。"""
    safe: bool
    reason: str = ""


def _load_blacklist() -> list[str]:
    """从文件加载黑名单关键词（每次调用实时读取）。"""
    if not os.path.exists(BLACKLIST_FILE):
        logger.warning(f"[Moderator] 黑名单文件不存在: {BLACKLIST_FILE}")
        return []

    keywords: list[str] = []
    try:
        with open(BLACKLIST_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    keywords.append(line)
    except Exception as e:
        logger.error(f"[Moderator] 读取黑名单文件失败: {e}")

    logger.debug(f"[Moderator] 已加载 {len(keywords)} 条黑名单关键词")
    return keywords


def moderate_input(text: str) -> ModerationResult:
    """
    对玩家输入进行内容审核。

    返回 ModerationResult，safe=True 表示通过。
    """
    if not text:
        return ModerationResult(safe=True)

    # 1. 长度检查
    if len(text) > MAX_INPUT_LENGTH:
        return ModerationResult(
            safe=False,
            reason=f"输入内容过长（最多 {MAX_INPUT_LENGTH} 字，当前 {len(text)} 字）",
        )

    lower_text = text.lower()

    # 2. 黑名单关键词匹配
    keywords = _load_blacklist()
    for keyword in keywords:
        if keyword.lower() in lower_text:
            return ModerationResult(
                safe=False,
                reason="输入包含不当内容，请修改后重试",
            )

    # 3. 正则注入模式匹配
    for pattern in INJECTION_PATTERNS:
        if pattern.search(lower_text):
            return ModerationResult(
                safe=False,
                reason="输入包含不当内容，请修改后重试",
            )

    return ModerationResult(safe=True)
