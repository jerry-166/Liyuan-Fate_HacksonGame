"""
输入内容审核模块 — 基于规则的关键词黑名单 + 长度限制 + 频率限制。

审核流程：
  1. 长度检查（超过 MAX_INPUT_LENGTH 直接拒绝）
  2. 黑名单关键词匹配（从文件加载，实时读取）
  3. 正则模式匹配（常见的 Prompt 注入变体）
  4. 频率限制（同一 session 短时间大量拦截 → 临时封禁）
"""

import os
import re
import time
import logging
from dataclasses import dataclass
from collections import defaultdict

logger = logging.getLogger(__name__)

# ─── 输入审核配置 ─────────────────────────────────────

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

# ─── 频率限制配置 ─────────────────────────────────────

MAX_BLOCKED_IN_WINDOW: int = 4      # 滑动窗口内最大拦截次数（≥4 次即封禁）
RATE_WINDOW_SECONDS: int = 60       # 滑动窗口时长（秒）
BLOCK_DURATION_SECONDS: int = 300   # 触发封禁后的封禁时长（秒），5 分钟


@dataclass
class ModerationResult:
    """审核结果。"""
    safe: bool
    reason: str = ""


@dataclass
class RateLimitResult:
    """频率限制检查结果。"""
    allowed: bool
    reason: str = ""


# ─── 频率限制器 ─────────────────────────────────────

class _RateLimiter:
    """
    会话级频率限制器 — 全内存，进程重启后清空。

    工作原理：
      每个 session_id 维护一个滑动窗口：
      - 只记录被拦截请求的时间戳
      - 窗口内的拦截次数 ≥ MAX_BLOCKED_IN_WINDOW → 封禁
      - 封禁期间所有对话请求返回 429
      - 封禁到期后自动解除
    """

    def __init__(self):
        # session_id → list[timestamp]  滑动窗口内被拦截的时间戳
        self._blocked_timestamps: dict[str, list[float]] = defaultdict(list)
        # session_id → float  封禁到期的 Unix 时间戳
        self._banned_until: dict[str, float] = {}

    def check(self, session_id: str) -> RateLimitResult:
        """检查该 session 是否允许发送对话请求。"""
        now = time.time()

        # 1. 是否在封禁期内
        banned_until = self._banned_until.get(session_id)
        if banned_until and now < banned_until:
            remain = int(banned_until - now)
            logger.warning(
                f"[RateLimiter] session={session_id[:12]}… 仍在封禁中，剩余 {remain}s"
            )
            return RateLimitResult(
                allowed=False,
                reason=f"由于短时间内违规次数过多，对话功能已被暂时限制（{remain} 秒后恢复）",
            )

        # 2. 封禁期已过，清理状态
        if banned_until and now >= banned_until:
            self._reset_session(session_id)
            logger.info(f"[RateLimiter] session={session_id[:12]}… 封禁到期，已解除")

        return RateLimitResult(allowed=True)

    def record_block(self, session_id: str):
        """记录一次拦截，如果触发阈值则封禁。"""
        now = time.time()

        # 滑动窗口：只保留最近 RATE_WINDOW_SECONDS 内的记录
        window_start = now - RATE_WINDOW_SECONDS
        timestamps = self._blocked_timestamps[session_id]
        timestamps = [t for t in timestamps if t > window_start]
        timestamps.append(now)
        self._blocked_timestamps[session_id] = timestamps

        if len(timestamps) >= MAX_BLOCKED_IN_WINDOW:
            self._banned_until[session_id] = now + BLOCK_DURATION_SECONDS
            self._blocked_timestamps.pop(session_id, None)
            logger.warning(
                f"[RateLimiter] session={session_id[:12]}… "
                f"{RATE_WINDOW_SECONDS}s 内被拦截 {len(timestamps)} 次，封禁 {BLOCK_DURATION_SECONDS}s"
            )

    def _reset_session(self, session_id: str):
        """清理 session 的所有限流状态。"""
        self._blocked_timestamps.pop(session_id, None)
        self._banned_until.pop(session_id, None)


# 全局单例
_rate_limiter = _RateLimiter()


def check_rate_limit(session_id: str) -> RateLimitResult:
    """对指定 session 进行频率限制检查。"""
    return _rate_limiter.check(session_id)


def record_block(session_id: str):
    """记录该 session 的一次内容拦截，触发阈值则自动封禁。"""
    _rate_limiter.record_block(session_id)


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
