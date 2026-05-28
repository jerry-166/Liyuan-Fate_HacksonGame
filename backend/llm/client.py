"""
LLM HTTP 客户端 — httpx 异步流式调用 OpenAI 兼容接口。

支持:
  - Session 级 API Key（优先于环境变量 fallback）
  - 流式 SSE 解析（aiter_lines）
  - 非流式 JSON 调用
  - 超时控制 + 错误处理
"""

import json
import time
import logging
from typing import Optional, AsyncIterator

import httpx

from config import (
    LLM_BASE_URL,
    LLM_MODEL,
    LLM_MAX_TOKENS,
    LLM_TEMPERATURE,
    LLM_API_KEY_FALLBACK,
    LLM_HTTP_TIMEOUT,
    LLM_SSE_TIMEOUT,
)

logger = logging.getLogger(__name__)


def _parse_json_content(content: str) -> dict:
    """从 LLM 返回的 content 中提取 JSON dict。

    处理以下情况：
    - 纯 JSON 字符串
    - markdown code block 包裹: ```json ... ``` 或 ``` ... ```
    - 前后有多余空白或文字
    - 截断的 JSON（尝试修复）
    """
    import re

    text = content.strip()

    # 1. 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. 去掉 markdown code block
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 3. 找到第一个 { 和最后一个 } 之间的内容
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        sub = text[first:last + 1]
        try:
            return json.loads(sub)
        except json.JSONDecodeError:
            pass

        # 4. 截断修复：补全缺失的括号
        repaired = _repair_truncated_json(sub)
        if repaired is not None:
            return repaired

    logger.warning(f"[LLM] Failed to parse JSON response: {content[:200]}")
    return {"raw": content}


def _repair_truncated_json(text: str) -> dict | None:
    """尝试修复截断的 JSON：从末尾找最后一个完整的 key-value 或数组元素，然后补全括号。"""
    # 简单策略：统计未关闭的括号，补全
    stack = []
    in_string = False
    escape = False
    for ch in text:
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in '{[':
            stack.append(ch)
        elif ch == '}' and stack and stack[-1] == '{':
            stack.pop()
        elif ch == ']' and stack and stack[-1] == '[':
            stack.pop()

    if not stack:
        return None

    # 找到最后一个逗号或冒号后的截断点，截断到那里
    repaired = text.rstrip()
    # 移除末尾不完整的 token（未闭合的字符串、不完整的 key 等）
    while repaired and not repaired.endswith(('"', '}', ']', '}', 'e', 's', 'd', 'n', 'l')):
        repaired = repaired[:-1]

    # 补全未关闭的括号
    stack2 = []
    in_str2 = False
    esc2 = False
    for ch in repaired:
        if esc2:
            esc2 = False
            continue
        if ch == '\\' and in_str2:
            esc2 = True
            continue
        if ch == '"':
            in_str2 = not in_str2
            continue
        if in_str2:
            continue
        if ch in '{[':
            stack2.append(ch)
        elif ch == '}' and stack2 and stack2[-1] == '{':
            stack2.pop()
        elif ch == ']' and stack2 and stack2[-1] == '[':
            stack2.pop()

    # 如果还在字符串内，先关闭字符串
    if in_str2:
        repaired += '"'

    # 按反向顺序补全括号
    for bracket in reversed(stack2):
        repaired += ']' if bracket == '[' else '}'

    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        return None


class LLMClient:
    """异步 LLM 调用客户端。"""

    def __init__(
        self,
        base_url: str = LLM_BASE_URL,
        model: str = LLM_MODEL,
        api_key: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key or LLM_API_KEY_FALLBACK

    def resolve_api_key(self, session_key: Optional[str] = None) -> str:
        """解析 API Key：session 级 > 实例级 > 环境变量。"""
        key = session_key or self.api_key
        if not key:
            raise ValueError(
                "LLM API Key 未配置。请在游戏开始前输入 API Key，"
                "或设置环境变量 TENCENT_LLM_API_KEY。"
            )
        return key

    def _headers(self, api_key: str) -> dict:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def chat_stream(
        self,
        messages: list[dict],
        api_key: Optional[str] = None,
        temperature: float = LLM_TEMPERATURE,
        max_tokens: int = LLM_MAX_TOKENS,
    ) -> AsyncIterator[str]:
        """
        流式对话 — 返回 AsyncIterator[str]，yield 每个 token 文本。

        使用示例:
            async for token in client.chat_stream(messages):
                print(token, end="", flush=True)
                full_text += token
        """
        key = self.resolve_api_key(api_key)
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "response_format": {"type": "json_object"},
        }

        start = time.time()
        logger.info(f"[LLM] Stream request → {self.base_url}/chat/completions (model={self.model})")

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=LLM_SSE_TIMEOUT, write=10.0, pool=10.0)
        ) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._headers(key),
                json=payload,
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    logger.error(f"[LLM] HTTP {response.status_code}: {body.decode()[:500]}")
                    raise LLMError(
                        f"LLM API 返回错误 {response.status_code}",
                        code="LLM_ERROR",
                        detail=body.decode()[:500],
                    )

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        choices = data.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue

        elapsed = time.time() - start
        logger.info(f"[LLM] Stream completed in {elapsed:.1f}s")

    async def chat_json(
        self,
        messages: list[dict],
        api_key: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 512,
    ) -> dict:
        """
        非流式 JSON 调用 — 返回解析后的 dict。

        用于阶段判定、结局评价等结构化输出场景。
        """
        key = self.resolve_api_key(api_key)
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            "response_format": {"type": "json_object"},
        }

        logger.info(f"[LLM] JSON request → {self.base_url}/chat/completions")

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=LLM_HTTP_TIMEOUT, write=10.0, pool=10.0)
        ) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(key),
                json=payload,
            )
            if response.status_code != 200:
                raise LLMError(
                    f"LLM API 返回错误 {response.status_code}",
                    code="LLM_ERROR",
                    detail=response.text[:500],
                )

            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return _parse_json_content(content)


class LLMError(Exception):
    """LLM 调用异常。"""
    def __init__(self, message: str, code: str = "LLM_ERROR", detail: str = ""):
        super().__init__(message)
        self.code = code
        self.detail = detail
