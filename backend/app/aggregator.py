"""3단계 취합 함수 (SPEC 3-3, 4-3). 툴이 아니라 1·2단계 결과를 매트릭스로 합치는 순수 함수."""

from app.models import ContextAssessment, FinalRisk, RiskLevel, SignalResult

_MATRIX: dict[tuple[RiskLevel, RiskLevel], str] = {
    ("고", "고"): "위험", ("고", "중"): "위험", ("고", "저"): "주의",
    ("중", "고"): "위험", ("중", "중"): "주의", ("중", "저"): "안전",
    ("저", "고"): "위험", ("저", "중"): "주의", ("저", "저"): "안전",
}

_ACTIONS = {
    "안전": "확인 1탭으로 송금 진행",
    "주의": "공식번호로 직접 확인 안내 후 진행 여부 재확인",
    # 송금 자체를 강제로 막지는 않는다 — 완전 차단은 민원 소지가 있어, 강한 경고와
    # 지연이체 안내 후 최종 진행 여부는 고객이 선택한다(SPEC 6-1 M6 위험 분기).
    "위험": "강력 경고 + 영업점 연계 리포트 생성(고객이 원하면 지연이체로 진행 가능)",
}


def calculate_final_risk(
    account_score: int,
    account_lv: RiskLevel,
    account_signals: list[SignalResult],
    context: ContextAssessment | None,
) -> FinalRisk:
    context_lv: RiskLevel = context.level if context else "저"
    hard_override = bool(context and context.hard_override)

    final = "위험" if hard_override else _MATRIX[(account_lv, context_lv)]

    reasons = [f"{s.detail}(+{s.score})" for s in account_signals if s.hit]
    if context:
        if context.rag and context.rag.hit:
            reasons.append(
                f"RAG 매칭: {context.rag.matched_type}(유사도 {context.rag.similarity:.2f}, {context.rag.source})"
            )
        if hard_override:
            reasons.append("결정적 피싱징후 감지: 위험신호 직접 확인")

    return FinalRisk(
        account_level=account_lv,
        context_level=context_lv,
        final=final,
        hard_override=hard_override,
        reasons=reasons,
        action=_ACTIONS[final],
    )


def intervention_intensity(account_score: int) -> str:
    """SPEC 4-4: 1단계 점수가 대화 개입 강도를 결정한다.

    등급 표시 경계(0-29/30-59/60+)와 별개로, 개입 여부는 25점을 하한으로 쓴다.
    SPEC 5장 케이스3(28점, 등급상 '저')은 신규계좌 메신저피싱을 맥락으로 잡아내는
    핵심 데모라 질문 단계까지 가야 하고, 케이스4(20점, '저')는 질문 없이 3초 통과가
    맞다 — 두 케이스 모두 표시 등급은 '저'로 같지만 원점수는 다르므로, 등급이 아닌
    원점수 25/60을 기준으로 삼아야 두 케이스가 SPEC이 의도한 대로 갈린다.
    """

    if account_score < 25:
        return "confirm_only"
    if account_score >= 60:
        return "empathy_question+safety_question"
    return "empathy_question"
