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


def parse_dialogue_response(llm_raw: str) -> DialogueResult:
    result = DialogueResult()
    parsed = None

    try:
        text = llm_raw.strip()
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        parsed = json.loads(text.strip())
    except json.JSONDecodeError:
        logger.warning(f"[ResponseParser] JSON parse failed, using raw. First 200: {llm_raw[:200]}")

    if parsed is None:
        result.dialogue_text = llm_raw.strip()
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
