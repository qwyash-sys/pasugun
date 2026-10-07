"""1단계(계좌 신호)·2단계(RAG 사례집)가 코드 수정 없이/최소 수정으로 확장되는지, 그리고
경계값·다양한 실제 발화에서 제대로 도는지 검증한다."""

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.providers.rag.faiss_provider as faiss_provider
import app.tools.account_signals as signals_mod
from app.aggregator import calculate_final_risk, intervention_intensity
from app.main import app
from app.models import ContextAnswer, ContextOverrides, RagMatch, SignalResult
from app.scoring import account_level, build_context_assessment, context_level, rag_score
from app.tools.account_signals import AccountSignalSpec, register_account_signal, run_all_account_signals

client = TestClient(app)
BASE_QUOTE = {"customer_id": "C001", "payee_account": "552-102-993917", "amount": 150_000,
              "current_time": "2026-08-13T18:00:00+09:00"}


# ---------------- 1단계: 신호 레지스트리 ----------------

def test_every_signal_carries_label_and_max_score():
    results = run_all_account_signals("C001", "010-6691-98217", 20_000_000, "2026-08-11T01:10:00+09:00", ContextOverrides())
    assert [r.signal for r in results] == [s.name for s in signals_mod.ACCOUNT_SIGNALS]
    assert all(r.label and r.max_score > 0 and 0 <= r.score <= r.max_score for r in results)
    assert sum(s.max_score for s in signals_mod.ACCOUNT_SIGNALS) == 175  # SPEC 4-1 만점 합


@pytest.fixture
def isolated_registry(monkeypatch):
    monkeypatch.setattr(signals_mod, "ACCOUNT_SIGNALS", list(signals_mod.ACCOUNT_SIGNALS))


def _overseas(inp) -> SignalResult:
    hit = inp.amount >= 100_000
    return SignalResult(signal="overseas_ip", hit=hit, score=15 if hit else 0, detail="해외 IP 접속" if hit else "국내 접속")


def test_new_signal_flows_through_quote_api_without_touching_other_code(isolated_registry):
    before = client.post("/api/transfer/quote", json=BASE_QUOTE).json()
    register_account_signal(AccountSignalSpec("overseas_ip", "해외 IP 접속", 15, _overseas))
    after = client.post("/api/transfer/quote", json=BASE_QUOTE).json()

    new = next(s for s in after["account"]["signals"] if s["signal"] == "overseas_ip")
    assert new == {
        "signal": "overseas_ip", "hit": True, "score": 15, "detail": "해외 IP 접속", "label": "해외 IP 접속", "max_score": 15,
        "rule_id": "", "definition": "", "condition": "", "scoring": "", "value": None,  # 설명·측정값을 안 채운 룰도 정상 동작
    }
    assert after["account"]["total_score"] == before["account"]["total_score"] + 15
    # 20점(확인 1탭) → 35점: 개입 강도가 질문 단계로 바뀐다 — 신규 신호가 흐름 분기까지 반영된다.
    assert before["intervention"] == "confirm_only" and after["intervention"] == "empathy_question"


def test_registry_rejects_duplicates_and_out_of_range_scores(isolated_registry):
    with pytest.raises(ValueError):
        register_account_signal(AccountSignalSpec("payee_fraud", "중복", 10, _overseas))
    register_account_signal(AccountSignalSpec("overseas_ip", "해외 IP", 5, _overseas))  # 15점을 내는데 만점 5
    with pytest.raises(ValueError):
        run_all_account_signals("C001", "552-102-993917", 150_000, "2026-08-13T18:00:00+09:00", ContextOverrides())


# ---------------- 경계값: 등급·개입 강도·매트릭스 ----------------

@pytest.mark.parametrize("score,level", [(0, "저"), (29, "저"), (30, "중"), (59, "중"), (60, "고"), (175, "고")])
def test_account_level_bands(score, level):
    assert account_level(score) == level


@pytest.mark.parametrize("score,level", [(0, "저"), (24, "저"), (25, "중"), (49, "중"), (50, "고")])
def test_context_level_bands(score, level):
    assert context_level(score, hard_override=False) == level
    assert context_level(score, hard_override=True) == "고"


@pytest.mark.parametrize("score,mode", [(24, "confirm_only"), (25, "empathy_question"), (59, "empathy_question"),
                                        (60, "empathy_question+safety_question")])
def test_intervention_boundaries(score, mode):
    assert intervention_intensity(score) == mode


@pytest.mark.parametrize("sim,score", [(0.59, 0), (0.60, 30), (0.79, 30), (0.80, 50), (0.99, 50)])
def test_rag_score_thresholds(sim, score):
    assert rag_score(sim) == score


_EXPECTED = {("고", "고"): "위험", ("고", "중"): "위험", ("고", "저"): "주의",
             ("중", "고"): "위험", ("중", "중"): "주의", ("중", "저"): "안전",
             ("저", "고"): "위험", ("저", "중"): "주의", ("저", "저"): "안전"}


@pytest.mark.parametrize("acc,ctx", list(_EXPECTED))
def test_all_nine_matrix_cells(acc, ctx):
    ctx_score = {"저": 0, "중": 25, "고": 50}[ctx]
    context = build_context_assessment([ContextAnswer(question_id="empathy", choice_id="x", choice_weight=ctx_score)], False, None)
    final = calculate_final_risk(0, acc, [], context)
    assert (final.context_level, final.final) == (ctx, _EXPECTED[(acc, ctx)])


def test_hard_override_beats_matrix_even_when_everything_else_is_low():
    rag = RagMatch(hit=True, matched_type="원격제어형", matched_id="S10", similarity=0.61, score=30,
                   risk_signals=["원격제어앱"], source="t", candidates=[])
    context = build_context_assessment([], False, rag)
    assert context.hard_override and calculate_final_risk(0, "저", [], context).final == "위험"


# ---------------- 2단계: RAG 사례집 확장 ----------------

def _load_eval_cases():
    path = Path(__file__).resolve().parent.parent / "scripts" / "eval_rag.py"
    spec = importlib.util.spec_from_file_location("eval_rag", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.CASES


EVAL_CASES = _load_eval_cases()


@pytest.mark.parametrize("expected,text", EVAL_CASES, ids=[t[:14] for _, t in EVAL_CASES])
def test_rag_real_utterances(expected, text):
    m = faiss_provider.FaissLocalRagProvider().scenario_rag(text)
    if expected is None:
        assert not m.hit, f"정상 송금이 {m.matched_type}({m.similarity})로 오탐"
    else:
        assert m.hit and m.matched_type == expected, f"{expected} 기대, 실제 {m.matched_type}({m.similarity}) hit={m.hit}"


def test_rag_candidates_cover_whole_corpus():
    from app.data_store import scenarios

    m = faiss_provider.FaissLocalRagProvider().scenario_rag("검찰이 안전계좌로 옮기래요")
    assert len(m.candidates) == len(scenarios())
    sims = [c.similarity for c in m.candidates]
    assert sims == sorted(sims, reverse=True)


def test_new_scenario_is_searchable_by_adding_data_only(monkeypatch):
    from app.data_store import scenarios

    new_doc = {"id": "S99", "중분류": "가상자산 투자 리딩방", "수법요약": "코인 리딩방에서 고수익을 약속하며 지정 거래소 계좌로 투자금 입금을 유도",
               "범인멘트": ["리딩방 VIP만 받는 코인 정보입니다", "원금 보장에 수익 300% 드립니다", "이 계좌로 투자금 넣으시면 바로 매수해드려요"],
               "위험신호": ["고수익보장", "리딩방", "지정계좌입금"], "유형": "투자사기", "위험도": "고", "출처": "테스트"}
    query = "코인 리딩방에서 원금 보장에 수익 300% 준다고 이 계좌로 투자금 넣으래요"

    faiss_provider._index.cache_clear()
    before = faiss_provider.FaissLocalRagProvider().scenario_rag(query)
    monkeypatch.setattr(faiss_provider, "scenarios", lambda: [*scenarios(), new_doc])
    faiss_provider._index.cache_clear()
    try:
        after = faiss_provider.FaissLocalRagProvider().scenario_rag(query)
    finally:
        monkeypatch.undo()
        faiss_provider._index.cache_clear()

    assert before.matched_type != "투자사기"
    assert after.hit and after.matched_id == "S99" and after.matched_type == "투자사기"
    assert after.similarity > before.similarity


def test_report_filter_rag_types_follow_the_corpus(monkeypatch):
    import app.routers.reports as reports_router
    from app.data_store import scenarios

    types = client.get("/api/reports/rag-types").json()
    assert types == list(dict.fromkeys(s["유형"] for s in scenarios()))
    monkeypatch.setattr(reports_router, "scenarios", lambda: [*scenarios(), {"유형": "투자사기"}])
    assert client.get("/api/reports/rag-types").json()[-1] == "투자사기"


def test_builtin_rules_carry_documentation_r01_to_r08():
    quote = _quote_api()
    rules = {s["signal"]: s for s in quote["account"]["signals"]}
    ids = [rules[spec.name]["rule_id"] for spec in signals_mod.ACCOUNT_SIGNALS]
    assert ids == [f"R0{i}" for i in range(1, 9)]
    for r in rules.values():
        assert r["definition"] and r["condition"] and r["scoring"], r["signal"]
    assert rules["payee_fraud"]["definition"] == "수취계좌의 사기신고 이력 여부"
    assert rules["time_pattern"]["condition"] == "평소 거래시간대 이탈 여부에 따라 점수 배점"


def _quote_api() -> dict:
    return client.post("/api/transfer/quote", json=BASE_QUOTE).json()
