"""LLM_PROVIDER=anthropic (개발 기본) 구현체. Anthropic Messages API 직접 호출."""

from typing import Any

from anthropic import Anthropic

from app.config import Settings


class AnthropicLlmProvider:
    def __init__(self, settings: Settings):
        self._client = Anthropic(api_key=settings.anthropic_api_key)
        self._model = settings.anthropic_model

    def chat(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=system,
            messages=messages,
            tools=tools or [],
        )
        return {
            "content": [block.model_dump() for block in response.content],
            "stop_reason": response.stop_reason,
        }
