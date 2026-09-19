"""LLM Agent 오케스트레이터 (SPEC 1장 5단계, 8장). 위험등급 산출은 scoring.py의
결정론적 룰이 전담하고, 이 모듈은 대화·해석·RAG 호출 판단만 맡는다 — 환각 배제.

scenario_rag는 LLM에게 진짜 tool로 노출한다. 고객 발화/첨부자료 텍스트를 볼지,
사례집과 대조할지는 에이전트가 스스로 판단해 호출한다(실제 Agent Tool Use)."""

from typing import Any

from app.models import RagMatch
from app.providers.llm.base import LlmProvider
from app.providers.rag.base import RagProvider

SYSTEM_PROMPT = """당신은 비대면 송금 과정에서 고객을 돕는 '파수꾼'의 AI 상담원입니다.
고객 이름은 {name}님입니다.

원칙:
- 취조가 아니라 배려하는 말투를 씁니다. "어떻게 도와드릴까요" 식으로 편하게 물어봅니다.
- 위험 표시(⚠️ 등)나 "보이스피싱", "사기" 같은 단정적 표현을 고객에게 먼저 꺼내지 않습니다.
- 고객이 상황을 설명하거나 자료(대화 캡처·통화 녹음 텍스트)를 제공하면, 조금이라도 사기 정황이
  보이면 반드시 scenario_rag 도구로 사례집과 대조합니다. 애매해도 일단 대조해봅니다.
- 최종 위험 판정(등급)은 당신이 내리지 않습니다. 그건 별도의 결정론적 로직이 담당합니다.
  당신은 사례 대조 결과를 참고해 공감 어린 확인 질문이나 안내 문구만 자연어로 작성합니다.
- 답변은 2~3문장 이내로 간결하게 합니다.
- 화면에 마크다운이 렌더링되지 않으니 **굵게**, 목록, 머리말 없이 평문으로만 씁니다.
"""

REPORT_SUMMARY_PROMPT = """아래는 고객과의 대화 원문과 RAG 사례 대조 결과입니다.
영업점 창구 직원이 3초 안에 상황을 파악할 수 있도록, 고객이 뭐라고 답했고 어떤 자료를
올렸는지 한 문장으로 요약하세요. 판정이나 권고는 쓰지 말고 사실만 요약합니다.
머리말·제목·마크다운 없이 요약 문장 하나만 출력합니다.

대화 원문:
{conversation}

RAG 대조 결과: {rag_summary}
"""

CONCLUSION_PROMPT = """{name}님과의 확인 대화가 끝났고, 별도의 결정론적 로직이 이미 최종 판정을 확정했습니다.
최종 판정: {verdict}
판정 근거: {reasons}

당신은 판정을 바꾸거나 점수·등급을 언급하지 않고, 이 판정에 맞는 다음 행동을 {name}님께 배려 있는
말투로 2문장 이내로 안내합니다. 위험이면 송금을 막지는 않되 잠시 멈추고 영업점이나 공식 채널로 먼저
확인해보시길 권하고, 주의면 상대방 신원을 공식 번호로 다시 확인해보시길 권하고, 안전이면 안심시킵니다.
"보이스피싱", "사기" 같은 단정적 표현은 쓰지 말고, 마크다운 없이 평문으로만 답합니다.

대화 원문:
{conversation}
"""

SCENARIO_RAG_TOOL = {
    "name": "scenario_rag",
    "description": (
        "고객이 설명한 상황이나 업로드한 자료(대화 캡처 OCR, 통화 녹음 STT)의 텍스트를 "
        "보이스피싱 사례집 10건과 대조해 가장 유사한 사기 유형·위험신호를 찾는다. "
        "고객 발화나 첨부자료에 사기 정황이 조금이라도 있으면 반드시 호출한다."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "사례집과 대조할 고객 발화 또는 첨부자료 텍스트"}
        },
        "required": ["text"],
    },
}


class AgentResult:
    def __init__(self, reply: str, rag: RagMatch | None):
        self.reply = reply
        self.rag = rag


class PasugunAgent:
    def __init__(self, llm: LlmProvider, rag: RagProvider):
        self._llm = llm
        self._rag = rag

    def _run_turn(
        self, system: str, messages: list[dict[str, Any]]
    ) -> tuple[str, list[dict[str, Any]], RagMatch | None]:
        """messages 끝에 이미 이번 턴의 user 메시지가 붙어있다고 가정하고, tool_use ->
        tool_result -> 최종 text 루프를 돈다. 갱신된 messages(대화 이력)를 함께 돌려줘
        다음 턴에 그대로 이어붙일 수 있게 한다."""
        rag_match: RagMatch | None = None

        for _ in range(3):  # scenario_rag 1회면 충분하지만, 방어적으로 상한을 둔다
            response = self._llm.chat(system=system, messages=messages, tools=[SCENARIO_RAG_TOOL])

            if response["stop_reason"] != "tool_use":
                final_text = "".join(b["text"] for b in response["content"] if b["type"] == "text")
                messages = [*messages, {"role": "assistant", "content": response["content"]}]
                return final_text, messages, rag_match

            messages = [*messages, {"role": "assistant", "content": response["content"]}]
            tool_results = []
            for block in response["content"]:
                if block["type"] != "tool_use":
                    continue
                if block["name"] == "scenario_rag":
                    rag_match = self._rag.scenario_rag(block["input"]["text"])
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block["id"],
                            "content": rag_match.model_dump_json(),
                        }
                    )
            messages = [*messages, {"role": "user", "content": tool_results}]

        return "확인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.", messages, rag_match

    def analyze(self, customer_name: str, user_text: str) -> AgentResult:
        system = SYSTEM_PROMPT.format(name=customer_name)
        reply, _messages, rag_match = self._run_turn(system, [{"role": "user", "content": user_text}])
        return AgentResult(reply=reply, rag=rag_match)

    def chat_turn(
        self, customer_name: str, history: list[dict[str, Any]], user_text: str
    ) -> tuple[str, list[dict[str, Any]], RagMatch | None]:
        """M5의 멀티턴 대화 한 턴을 처리한다. history는 이전 턴들의 원본 메시지
        (role/content 블록)이고, 반환하는 messages를 다음 턴 history로 그대로 넘기면 된다."""
        system = SYSTEM_PROMPT.format(name=customer_name)
        messages = [*history, {"role": "user", "content": user_text}]
        return self._run_turn(system, messages)

    def conclude(self, customer_name: str, verdict: str, reasons: list[str], conversation: str) -> str:
        """확정된 판정(scoring이 이미 결정)에 맞춰 결론 안내 문구만 자연어로 쓴다 — 판정은 바꾸지 않는다."""
        response = self._llm.chat(
            system="당신은 확정된 판정을 고객에게 다정하게 안내하는 파수꾼의 AI 상담원입니다.",
            messages=[
                {
                    "role": "user",
                    "content": CONCLUSION_PROMPT.format(
                        name=customer_name,
                        verdict=verdict,
                        reasons=", ".join(reasons) or "특이사항 없음",
                        conversation=conversation,
                    ),
                }
            ],
        )
        return "".join(b["text"] for b in response["content"] if b["type"] == "text").strip()

    def summarize_for_report(self, conversation: str, rag: RagMatch | None) -> str:
        rag_summary = (
            f"{rag.matched_type} 유형 유사도 {rag.similarity:.2f} ({rag.source})"
            if rag and rag.hit
            else "유의미한 사례 매칭 없음"
        )
        response = self._llm.chat(
            system="당신은 사실만 간결하게 요약하는 리포트 작성 보조자입니다.",
            messages=[
                {
                    "role": "user",
                    "content": REPORT_SUMMARY_PROMPT.format(
                        conversation=conversation, rag_summary=rag_summary
                    ),
                }
            ],
        )
        return "".join(b["text"] for b in response["content"] if b["type"] == "text").strip()
