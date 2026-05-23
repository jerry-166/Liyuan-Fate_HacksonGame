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
        }

        start = time.time()
        logger.info(f"[LLM] Stream request → {self.base_url}/chat/completions (model={self.model})")

        async with httpx.AsyncClient(timeout=LLM_SSE_TIMEOUT) as client:
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

        async with httpx.AsyncClient(timeout=LLM_HTTP_TIMEOUT) as client:
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
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                logger.warning(f"[LLM] Failed to parse JSON response: {content[:200]}")
                return {"raw": content}


class LLMError(Exception):
    """LLM 调用异常。"""
    def __init__(self, message: str, code: str = "LLM_ERROR", detail: str = ""):
        super().__init__(message)
        self.code = code
        self.detail = detail
