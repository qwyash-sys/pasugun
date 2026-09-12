"""프로바이더 공통 LLM 인터페이스.

Anthropic Messages API의 content-block 형태({"type": "text"|"tool_use"|"tool_result", ...})를
내부 공용 포맷(wire format)으로 삼는다. Bedrock provider는 Converse API 입출력을 이 포맷으로
번역해 호출부(app.agent)가 프로바이더를 몰라도 되게 한다.
"""

from typing import Any, Protocol


class LlmProvider(Protocol):
    def chat(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """반환: {"content": [block, ...], "stop_reason": str}"""
        ...
