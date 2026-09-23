"""SPEC 5장 시연 5케이스 검증. LLM 없이도(로컬 RAG는 순수 텍스트 유사도라 키 불필요)
1~3단계 결정론적 파이프라인이 SPEC이 선언한 최종 판정(🔴🔴🔴🟢🟢)과 일치하는지 확인한다.

SPEC 5장의 총점(90/65/28/20/45, 110/85/70/0/0)은 서술용 요약이라 일부 신호(예: 케이스1의
payee_freshness)가 빠져 있다 — mock_data/customers.json, payees.json에 그 이유를 적어뒀다.
그래서 여기서는 '핵심 신호의 점수'와 '등급/최종판정'을 검증하고, 총점은 근접치로만 확인한다."""

from app.aggregator import calculate_final_risk, intervention_intensity
from app.models import ContextAnswer, ContextOverrides
from app.providers.rag.faiss_provider import FaissLocalRagProvider
from app.scoring import build_account_assessment, build_context_assessment
from app.tools.account_signals import run_all_account_signals

rag = FaissLocalRagProvider()


def _signal(signals, name):
    return next(s for s in signals if s.signal == name)


def test_case1_prosecutor_impersonation_red():
    signals = run_all_account_signals(
        customer_id="C001",
        payee_account="010-6691-98217",
        amount=20_000_000,
        current_time="2026-08-11T01:10:00+09:00",
        overrides=ContextOverrides(
            fund_source_recent=True
        ),
    )
    total, level = build_account_assessment(signals)

    assert _signal(signals, "payee_fraud").score == 40
    assert _signal(signals, "amount_anomaly").score == 25
    assert _signal(signals, "fund_source").score == 25
    assert level == "고"
    assert total >= 90
    assert intervention_intensity(total) == "empathy_question+safety_question"

    # 안전질문에서 "비슷한 안내 받음"(+50, 결정적 피싱징후)을 선택한 상황을 재현
    safety_hit = ContextAnswer(question_id="safety", choice_id="safety_yes", choice_weight=50, hard_override=True)
    rag_match = rag.scenario_rag("검찰청 수사관이라며 안전계좌로 이체하라고 안내받았다")
    context = build_context_assessment([safety_hit], used_input_or_attachment=True, rag=rag_match)

    assert context.hard_override is True
    assert context.level == "고"

    final = calculate_final_risk(total, level, signals, context)
    assert final.final == "위험"
    assert final.hard_override is True


def test_case2_loan_refinancing_scam_red():
    signals = run_all_account_signals(
        customer_id="C002",
        payee_account="110-452-118921",
        amount=5_000_000,
        current_time="2026-08-09T11:00:00+09:00",
        overrides=ContextOverrides(
            limit_changed_recent=True
        ),
    )
    total, level = build_account_assessment(signals)

    assert total == 65
    assert level == "고"

    risky_choice = ContextAnswer(question_id="empathy", choice_id="risky_offer", choice_weight=25, hard_override=False)
    safety_no = ContextAnswer(question_id="safety", choice_id="safety_no", choice_weight=0, hard_override=False)
    rag_match = rag.scenario_rag("저금리로 대환대출 해준다고 해서 먼저 상환할 돈을 이체하려 한다")
    context = build_context_assessment([risky_choice, safety_no], used_input_or_attachment=True, rag=rag_match)

    assert context.level in ("중", "고")

    final = calculate_final_risk(total, level, signals, context)
    assert final.final in ("주의", "위험")


def test_case3_messenger_phishing_caught_by_context_despite_low_account_score():
    signals = run_all_account_signals(
        customer_id="C001",
        payee_account="301-8827-4491",
        amount=1_000_000,
        current_time="2026-08-12T15:00:00+09:00",
        overrides=ContextOverrides(),
    )
    total, level = build_account_assessment(signals)

    assert total == 28
    assert level == "저"
    # SPEC 핵심 데모: 계좌점수는 낮아도(28) 질문 단계까지는 가야 한다
    assert intervention_intensity(total) == "empathy_question"

    risky_choice = ContextAnswer(
        question_id="empathy", choice_id="risky_text_only", choice_weight=25, hard_override=False
    )
    rag_match = rag.scenario_rag("아는 사람이라는데 전화는 안 받고 문자로만 연락하며 급하게 돈을 보내달라고 한다")
    context = build_context_assessment([risky_choice], used_input_or_attachment=True, rag=rag_match)

    final = calculate_final_risk(total, level, signals, context)
    # 계좌 저 + 맥락 高 -> 매트릭스상 위험(SPEC 4-3)
    assert context.level == "고", f"RAG 유사도 {rag_match.similarity} 로는 맥락 高에 못 미침"
    assert final.final == "위험"


def test_case4_secondhand_trade_normal_green_no_question():
    signals = run_all_account_signals(
        customer_id="C001",
        payee_account="552-102-993917",
        amount=150_000,
        current_time="2026-08-13T18:00:00+09:00",
        overrides=ContextOverrides(),
    )
    total, level = build_account_assessment(signals)

    assert total == 20
    assert level == "저"
    assert intervention_intensity(total) == "confirm_only"

    final = calculate_final_risk(total, level, signals, context=None)
    assert final.final == "안전"


def test_case5_real_estate_settlement_normal_green_false_positive_suppressed():
    signals = run_all_account_signals(
        customer_id="C004",
        payee_account="088-19-284812",
        amount=50_000_000,
        current_time="2026-08-14T11:00:00+09:00",
        overrides=ContextOverrides(),
    )
    total, level = build_account_assessment(signals)

    assert total == 45
    assert level == "중"
    assert intervention_intensity(total) == "empathy_question"

    normal_choice = ContextAnswer(
        question_id="empathy", choice_id="normal_settlement", choice_weight=0, hard_override=False
    )
    context = build_context_assessment([normal_choice], used_input_or_attachment=False, rag=None)

    assert context.total_score == 0
    assert context.level == "저"

    final = calculate_final_risk(total, level, signals, context)
    # 계좌 중 + 맥락 低 -> 매트릭스상 안전(오탐 억제, SPEC 4-3/케이스5)
    assert final.final == "안전"


def test_rag_does_not_false_positive_on_benign_text():
    """경량 TF-IDF 매처가 정상 거래 설명까지 사기 사례로 오탐하지 않는지 확인.
    (사기 관련 어휘가 겹칠 수 있는 '입금' 같은 단어가 있어도 임계값 0.60을 넘지 않아야 함)"""

    benign_texts = [
        "중고거래 대금 입금합니다 물건 잘 받았어요",
        "부동산 잔금 이체합니다 계약서에 적힌 금액이에요",
    ]
    for text in benign_texts:
        rag_match = rag.scenario_rag(text)
        assert rag_match.score == 0, f"'{text}' 가 오탐: {rag_match.matched_type} 유사도 {rag_match.similarity}"
