"""M4 질문 카드 문구/선택지 (SPEC 4장 톤 원칙: 이름 부르기, 배려형, 정상 선택지 먼저,
위험표시 미노출). 선택지 가중치는 SPEC 4-2 일반 규칙(위험 25 / 하드오버라이드 50 / 정상 0)을 따른다."""


def empathy_question(customer_name: str) -> dict:
    return {
        "question_id": "empathy",
        "prompt": f"{customer_name}님, 이번 송금은 어떤 이유로 보내시는 걸까요?",
        "choices": [
            {"choice_id": "normal_known", "label": "직접 아는 지인·가족에게 보내요", "weight": 0, "hard_override": False},
            {"choice_id": "normal_trade", "label": "물건 구매/판매 대금이에요", "weight": 0, "hard_override": False},
            {"choice_id": "normal_settlement", "label": "임대료·잔금 등 정산 목적이에요", "weight": 0, "hard_override": False},
            {"choice_id": "risky_offer", "label": "최근 대출·투자 안내를 받고 보내요", "weight": 25, "hard_override": False},
            {"choice_id": "risky_text_only", "label": "아는 사람이라는데 문자로만 연락돼요", "weight": 25, "hard_override": False},
        ],
    }


SAFETY_QUESTION = {
    "question_id": "safety",
    "prompt": "혹시 검찰·금감원이라며 '안전계좌'로 옮기라거나, 앱 설치를 안내받으셨나요?",
    "choices": [
        {"choice_id": "safety_no", "label": "아니요", "weight": 0, "hard_override": False},
        {"choice_id": "safety_yes", "label": "비슷한 안내를 받았어요", "weight": 50, "hard_override": True},
    ],
}


def questions_for(intervention: str, customer_name: str) -> list[dict]:
    if intervention == "confirm_only":
        return []
    if intervention == "empathy_question":
        return [empathy_question(customer_name)]
    return [empathy_question(customer_name), SAFETY_QUESTION]
