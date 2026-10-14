"""AI 대화(M5)의 첫 마디. 앞 단계 질문에서 고른 답을 한 줄로 짚고, 질문 하나를 던진 뒤 AI 분석을 안내한다.

개발 모드는 LLM이 같은 형식으로 쓰고(agent.opening), LLM이 실패하거나 데모 모드일 때는 아래 규칙 문장을 쓴다.
프론트 데모(frontend/src/utils/opening.ts)도 같은 규칙이라 두 모드의 흐름이 같다.
누구에게 얼마를 보내는지 같은 세부 정보, 판정·점수·위험 신호는 말하지 않는다(짧고 깔끔하게, 탐지 로직 비노출).
"""

from __future__ import annotations

FOLLOW_UP = {
    "safety_yes": "기관에서 '안전계좌'나 앱 설치를 안내받으셨군요. 어디서, 어떻게 연락이 왔나요?",
    "risky_offer": "대출·투자 안내를 받고 보내시는군요. 돈을 먼저 보내라는 이유가 뭐였나요?",
    "risky_text_only": "문자로만 연락되는 지인이시군요. 급하게 돈을 부탁받으셨나요?",
    "normal_known": "가족·지인에게 보내시는군요. 직접 통화로 부탁받으셨나요?",
    "normal_trade": "물건 거래 대금이시군요. 판매자와는 어디서 연락하셨나요?",
    "normal_settlement": "정산 대금이시군요. 이 계좌번호는 어디서 받으셨나요?",
}
DEFAULT_FOLLOW_UP = "어떤 일로 보내시는지 알려주세요."
CLOSING = "상황 설명이나 캡처를 올려주시면 AI가 분석해드릴게요."


def opening_key(choice_ids: list[str]) -> str | None:
    """가장 먼저 짚어야 할 답: 안전 질문의 '비슷한 안내를 받았어요'가 최우선, 그다음 공감 질문의 답."""
    if "safety_yes" in choice_ids:
        return "safety_yes"
    return next((c for c in choice_ids if c in FOLLOW_UP), None)


def rule_opening(choice_ids: list[str]) -> str:
    return f"{FOLLOW_UP.get(opening_key(choice_ids) or '', DEFAULT_FOLLOW_UP)} {CLOSING}"


OPENING_PROMPT = """고객이 송금 직전 확인 질문에서 고른 답: {answers}

이 답을 바탕으로 AI 대화의 첫 마디를 쓰세요.
- 고른 답을 한 마디로 짚고(예: "~하시는군요."), 꼭 확인할 질문을 딱 하나만 짧게 하세요.
- 마지막 문장은 반드시 "{closing}" 로 끝내세요.
- 전체 3문장 이내, 해요체, 마크다운 없이 평문. 고객 이름·받는 분·금액은 말하지 마세요.
- 판정·점수·'보이스피싱'·'사기' 같은 단정 표현은 쓰지 마세요.

예시: {example}
"""
