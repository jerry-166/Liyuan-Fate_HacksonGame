"""
LLM 响应解析器 — v2 新增 task_progress 字段。
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TaskProgress:
    """任务进度投票结果。"""
    should_vote_complete: bool = False
    vote_reason: str = ""
    completed_sub_task_ids: list[str] = field(default_factory=list)


@dataclass
class DialogueResult:
    dialogue_text: str = ""
    relationship_delta: int = 0
    options: list[str] = field(default_factory=list)
    should_trigger_event: bool = False
    new_event: str = ""
    stage_should_advance: bool = False
    advance_reason: str = ""
    task_progress: Optional[TaskProgress] = None


def _fix_unescaped_quotes(text: str) -> str:
    """修复 JSON 中 dialogue_text 值内未转义的双引号。

    LLM 经常在对话文本中使用 "xxx" 包裹角色台词，
    但不会转义这些引号，导致 JSON 解析失败。
    """
    import re

    pattern = r'("dialogue_text"\s*:\s*")'
    m = re.search(pattern, text)
    if not m:
        return text

    value_start = m.end()

    # 已知的后续 key
    next_keys = [
        '"relationship_delta"', '"options"', '"should_trigger_event"',
        '"new_event"', '"stage_should_advance"', '"advance_reason"',
        '"task_progress"', '"key_event"',
    ]

    # 在 value_start 之后找最近的下一个 key
    earliest_pos = len(text)
    for key in next_keys:
        pos = text.find(key, value_start)
        if pos != -1 and pos < earliest_pos:
            earliest_pos = pos

    if earliest_pos <= value_start:
        return text

    # 值区域：value_start 到 earliest_pos
    # 去掉末尾的引号/逗号/空白
    value_end = earliest_pos
    while value_end > value_start and text[value_end - 1] in ('"', ' ', ',', '\n', '\r', '\t'):
        value_end -= 1

    # 最后一个 " 可能是值的结束引号
    if value_end > value_start and text[value_end - 1] == '"':
        value_end -= 1

    value_region = text[value_start:value_end]

    # 替换值区域内的 ASCII 双引号为中文引号（但保留转义的 \"）
    fixed = value_region.replace('\\"', '\x00ESCAPED\x00')
    fixed = fixed.replace('"', '“')
    fixed = fixed.replace('\x00ESCAPED\x00', '"')

    return text[:value_start] + fixed + text[value_end:]


def _strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def parse_dialogue_response(llm_raw: str) -> DialogueResult:
    result = DialogueResult()
    parsed = None

    # 第一次尝试：直接解析
    try:
        parsed = json.loads(_strip_markdown_fences(llm_raw))
    except json.JSONDecodeError:
        pass

    # 第二次尝试：修复未转义引号后重试
    if parsed is None:
        try:
            fixed = _fix_unescaped_quotes(_strip_markdown_fences(llm_raw))
            parsed = json.loads(fixed)
            logger.info("[ResponseParser] Recovered via quote fix")
        except (json.JSONDecodeError, Exception):
            logger.debug(f"[ResponseParser] JSON parse failed, using raw text fallback. First 200: {llm_raw[:200]}")

    if parsed is None:
        result.dialogue_text = llm_raw.strip()
        # 纯文本 fallback：生成默认选项
        result.relationship_delta = 3
        result.options = [
            "继续聊",
            "我还有其他想问的",
            "我先走了",
        ]
        return result

    result.dialogue_text = str(parsed.get("dialogue_text", "")).strip()
    if not result.dialogue_text:
        result.dialogue_text = llm_raw.strip()

    try:
        result.relationship_delta = int(parsed.get("relationship_delta", 0))
    except (ValueError, TypeError):
        result.relationship_delta = 0

    from config import RELATIONSHIP_DELTA_CLAMP
    lo, hi = RELATIONSHIP_DELTA_CLAMP
    result.relationship_delta = max(lo, min(hi, result.relationship_delta))

    raw_options = parsed.get("options", [])
    if isinstance(raw_options, list):
        result.options = [str(o).strip() for o in raw_options if str(o).strip()]
    elif isinstance(raw_options, str):
        result.options = [raw_options.strip()] if raw_options.strip() else []

    result.should_trigger_event = bool(parsed.get("should_trigger_event", False))
    result.new_event = str(parsed.get("new_event", "")).strip()
    result.stage_should_advance = bool(parsed.get("stage_should_advance", False))
    result.advance_reason = str(parsed.get("advance_reason", "")).strip()

    # v2: task_progress
    tp = parsed.get("task_progress")
    if tp and isinstance(tp, dict):
        result.task_progress = TaskProgress(
            should_vote_complete=bool(tp.get("should_vote_complete", False)),
            vote_reason=str(tp.get("vote_reason", "")),
            completed_sub_task_ids=list(tp.get("completed_sub_task_ids", [])),
        )

    return result
