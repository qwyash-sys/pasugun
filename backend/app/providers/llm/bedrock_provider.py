"""LLM_PROVIDER=bedrock (AWS 전환용) 구현체. Bedrock Converse API를 Anthropic
content-block 포맷으로 번역해 app.agent가 프로바이더 차이를 몰라도 되게 한다."""

from typing import Any

from app.config import Settings


def _to_bedrock_content(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"text": content}]

    blocks = []
    for block in content:
        if block["type"] == "text":
            blocks.append({"text": block["text"]})
        elif block["type"] == "tool_use":
            blocks.append(
                {"toolUse": {"toolUseId": block["id"], "name": block["name"], "input": block["input"]}}
            )
        elif block["type"] == "tool_result":
            result_content = block["content"]
            blocks.append(
                {
                    "toolResult": {
                        "toolUseId": block["tool_use_id"],
                        "content": [{"text": result_content}],
                    }
                }
            )
    return blocks


def _to_bedrock_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"role": m["role"], "content": _to_bedrock_content(m["content"])} for m in messages]


def _to_bedrock_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "toolSpec": {
                "name": t["name"],
                "description": t["description"],
                "inputSchema": {"json": t["input_schema"]},
            }
        }
        for t in tools
    ]


def _from_bedrock_response(response: dict[str, Any]) -> dict[str, Any]:
    output_message = response["output"]["message"]
    content = []
    for block in output_message["content"]:
        if "text" in block:
            content.append({"type": "text", "text": block["text"]})
        elif "toolUse" in block:
            tool_use = block["toolUse"]
            content.append(
                {"type": "tool_use", "id": tool_use["toolUseId"], "name": tool_use["name"], "input": tool_use["input"]}
            )

    stop_reason_map = {"tool_use": "tool_use", "end_turn": "end_turn", "max_tokens": "max_tokens"}
    stop_reason = stop_reason_map.get(response.get("stopReason", "end_turn"), "end_turn")

    return {"content": content, "stop_reason": stop_reason}


class BedrockLlmProvider:
    def __init__(self, settings: Settings):
        import boto3

        self._client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
        self._model_id = settings.bedrock_model_id

    def chat(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "modelId": self._model_id,
            "system": [{"text": system}],
            "messages": _to_bedrock_messages(messages),
        }
        if tools:
            kwargs["toolConfig"] = {"tools": _to_bedrock_tools(tools)}

        response = self._client.converse(**kwargs)
        return _from_bedrock_response(response)
