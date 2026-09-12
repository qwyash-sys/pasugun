"""결정론적 스코어링 로직 (SPEC 4장). LLM은 대화·해석만 담당하고, 등급 산출은
전부 이 모듈의 규칙으로만 결정한다 — 재현 가능하고 설명 가능해야 하기 때문."""

from app.models import ContextAnswer, ContextAssessment, RagMatch, RiskLevel, SignalResult

# 하드오버라이드 위험신호: 이 중 하나라도 RAG 매칭에서 직접 hit 하면 즉시 맥락 高
HARD_OVERRIDE_RISK_SIGNALS = {"안전계좌", "원격제어앱", "화면유지요구"}


def account_level(total_score: int) -> RiskLevel:
    if total_score >= 60:
        return "고"
    if total_score >= 30:
        return "중"
    return "저"


def context_level(total_score: int, hard_override: bool) -> RiskLevel:
    if hard_override:
        return "고"
    if total_score >= 50:
        return "고"
    if total_score >= 25:
        return "중"
    return "저"


def rag_score(similarity: float) -> int:
    """SPEC 4-2: 고위험 유형 매칭 + similarity>=0.80 -> 50 / 0.60~0.79 -> 30 / <0.60 -> 0."""

    if similarity >= 0.80:
        return 50
    if similarity >= 0.60:
        return 30
    return 0


def build_account_assessment(signals: list[SignalResult]) -> tuple[int, RiskLevel]:
    total = sum(s.score for s in signals)
    return total, account_level(total)


def build_context_assessment(
    answers: list[ContextAnswer],
    used_input_or_attachment: bool,
    rag: RagMatch | None,
) -> ContextAssessment:
    choice_score = sum(a.choice_weight for a in answers)
    input_score = 10 if used_input_or_attachment else 0
    rag_hit_score = rag.score if rag else 0

    total = choice_score + input_score + rag_hit_score

    hard_override = any(a.hard_override for a in answers)
    if rag and rag.hit and set(rag.risk_signals) & HARD_OVERRIDE_RISK_SIGNALS:
        hard_override = True

    level = context_level(total, hard_override)

    return ContextAssessment(
        answers=answers,
        used_input_or_attachment=used_input_or_attachment,
        rag=rag,
        total_score=total,
        level=level,
        hard_override=hard_override,
    )
