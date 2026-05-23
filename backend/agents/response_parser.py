"""
LLM 响应解析器。

职责：
  - 解析 LLM 返回的 JSON → DialogueResult 结构化数据
  - 降级策略：解析失败 → 使用 LLM 原始文本作为 dialogue_text
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class DialogueResult:
    """对话解析结果。"""
    dialogue_text: str = ""
    relationship_delta: int = 0
    options: list[str] = field(default_factory=list)
    should_trigger_event: bool = False
    new_event: str = ""
    stage_should_advance: bool = False
    advance_reason: str = ""


def parse_dialogue_response(llm_raw: str) -> DialogueResult:
    """
    解析 LLM 返回的 JSON → DialogueResult。

    降级策略（按优先级）：
      1. 正常 JSON 解析 → 各字段填充
      2. JSON 解析失败 → 使用原始文本作为 dialogue_text，其余字段为默认值
      3. dialogue_text 为空 → 回退到 raw 全文
    """
    result = DialogueResult()
    parsed = None

    # Step 1: 尝试 JSON 解析
    try:
        # 处理可能的 markdown 代码块包裹
        text = llm_raw.strip()
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        parsed = json.loads(text.strip())
    except json.JSONDecodeError:
        logger.warning(f"[ResponseParser] JSON parse failed, using raw text. First 200 chars: {llm_raw[:200]}")

    if parsed is None:
        # 降级：用全文
        result.dialogue_text = llm_raw.strip()
        return result

    # Step 2: 安全提取各字段
    result.dialogue_text = str(parsed.get("dialogue_text", "")).strip()
    if not result.dialogue_text:
        result.dialogue_text = llm_raw.strip()
        logger.warning("[ResponseParser] dialogue_text empty, fallback to raw")

    # relationship_delta
    try:
        result.relationship_delta = int(parsed.get("relationship_delta", 0))
    except (ValueError, TypeError):
        result.relationship_delta = 0
        logger.warning("[ResponseParser] relationship_delta parse failed, default 0")

    # Clamp delta
    from config import RELATIONSHIP_DELTA_CLAMP
    lo, hi = RELATIONSHIP_DELTA_CLAMP
    result.relationship_delta = max(lo, min(hi, result.relationship_delta))

    # options
    raw_options = parsed.get("options", [])
    if isinstance(raw_options, list):
        result.options = [str(o).strip() for o in raw_options if str(o).strip()]
    elif isinstance(raw_options, str):
        result.options = [raw_options.strip()] if raw_options.strip() else []

    # events
    result.should_trigger_event = bool(parsed.get("should_trigger_event", False))
    result.new_event = str(parsed.get("new_event", "")).strip()

    # stage
    result.stage_should_advance = bool(parsed.get("stage_should_advance", False))
    result.advance_reason = str(parsed.get("advance_reason", "")).strip()

    return result
