"""LLM 없이 PasugunAgent의 tool-use 오케스트레이션 메커니즘만 검증한다.
가짜 LLM 프로바이더가 Anthropic 응답 형태(content blocks/stop_reason)를 그대로
흉내내, 에이전트가 tool_use -> tool_result -> 최종 text 루프를 올바르게 도는지 확인."""

from app.agent import PasugunAgent
from app.models import RagMatch
from app.providers.rag.faiss_provider import FaissLocalRagProvider


class FakeLlmProvider:
    """1턴: scenario_rag 호출 -> 2턴: 최종 텍스트 응답."""

    def __init__(self):
        self.calls = []

    def chat(self, system, messages, tools=None):
        self.calls.append({"system": system, "messages": messages, "tools": tools})
        if len(self.calls) == 1:
            return {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "scenario_rag",
                        "input": {"text": "검찰이 안전계좌로 옮기라고 했다"},
                    }
                ],
                "stop_reason": "tool_use",
            }
        return {
            "content": [{"type": "text", "text": "확인했어요, 조심하셔야 할 것 같아요."}],
            "stop_reason": "end_turn",
        }


class FakeRagProvider:
    def __init__(self, match: RagMatch):
        self._match = match
        self.called_with = None

    def scenario_rag(self, text: str) -> RagMatch:
        self.called_with = text
        return self._match


def test_agent_calls_scenario_rag_tool_and_returns_final_reply():
    llm = FakeLlmProvider()
    rag_match = RagMatch(
        hit=True, matched_type="기관사칭", matched_id="S02", similarity=0.87,
        score=50, risk_signals=["안전계좌"], source="경찰청 월간피싱 zero S02",
    )
    rag = FakeRagProvider(rag_match)

    agent = PasugunAgent(llm, rag)
    result = agent.analyze("남용환", "검찰이 안전계좌로 옮기라고 했다")

    assert rag.called_with == "검찰이 안전계좌로 옮기라고 했다"
    assert result.rag is rag_match
    assert "조심" in result.reply
    assert len(llm.calls) == 2
    # 두 번째 호출에는 tool_result가 messages에 포함되어야 한다
    second_call_messages = llm.calls[1]["messages"]
    assert second_call_messages[-1]["content"][0]["type"] == "tool_result"


def test_agent_returns_direct_text_without_tool_use():
    class DirectTextLlm:
        def chat(self, system, messages, tools=None):
            return {"content": [{"type": "text", "text": "네, 알겠습니다."}], "stop_reason": "end_turn"}

    agent = PasugunAgent(DirectTextLlm(), FaissLocalRagProvider())
    result = agent.analyze("김도윤", "그냥 확인차 여쭤봤어요")

    assert result.reply == "네, 알겠습니다."
    assert result.rag is None
