"""관리자 페이지 백엔드: 룰 설정이 실제 점수에 반영되는지, 검증·이력·초기화, 거래 로그, 모니터링 사례 흐름."""

import pytest
from fastapi.testclient import TestClient

import app.admin_ai as admin_ai
import app.routers.chat as chat_router
from app.main import app
from app.models import ContextOverrides, RagMatch
from app.rule_config import DEFAULT_CONFIG, get_rule_config, get_rule_config_store, validate_config
from app.scoring import account_level, context_level, rag_score
from app.tools.account_signals import run_all_account_signals

client = TestClient(app)
NOW = "2026-08-12T15:00:00+09:00"


def _signals(**kw):
    args = dict(customer_id="C001", payee_account="010-6691-98217", amount=20_000_000, current_time="2026-08-11T01:10:00+09:00", overrides=ContextOverrides())
    args.update(kw)
    return {s.signal: s for s in run_all_account_signals(**args)}


def _patch(patch: dict) -> dict:
    cfg = get_rule_config().to_dict()
    for section, body in patch.items():
        if section == "global":
            cfg["global"].update(body)
        else:
            for rule, rbody in body.items():
                if "enabled" in rbody:
                    cfg["rules"][rule]["enabled"] = rbody["enabled"]
                cfg["rules"][rule]["params"].update(rbody.get("params", {}))
    return cfg


# ---------------------------------------------------------------- 설정이 점수에 반영된다
def test_default_config_matches_spec():
    s = _signals()
    assert s["amount_anomaly"].score == 25 and s["payee_fraud"].score == 40 and s["time_pattern"].score == 10
    assert s["payee_freshness"].score == 20 and s["payee_fraud"].max_score == 40
    assert (account_level(29), account_level(30), account_level(60)) == ("저", "중", "고")
    assert (context_level(24, False), context_level(25, False), context_level(50, False)) == ("저", "중", "고")
    assert rag_score(0.59) == 0 and rag_score(0.60) == 30 and rag_score(0.80) == 50


def test_changing_a_threshold_changes_the_score_and_the_max():
    ok, errors, changes = get_rule_config_store().update(_patch({"rules": {"amount_anomaly": {"params": {"score_high": 30, "ratio_high": 100}}}}))
    assert ok and not errors and len(changes) == 2
    s = _signals()  # 평소의 66.7배 — 새 기준(100배)에는 못 미쳐 '중위험(5배)' 배점 15점
    assert s["amount_anomaly"].score == 15 and s["amount_anomaly"].max_score == 30
    assert s["amount_anomaly"].value == pytest.approx(66.67, abs=0.01)  # 원측값은 설정과 무관하게 남는다


def test_level_cutoffs_and_rag_thresholds_follow_the_config():
    get_rule_config_store().update(_patch({"global": {"account_high": 100, "context_mid": 40, "rag_mid_sim": 0.5, "rag_high_sim": 0.9}}))
    assert account_level(90) == "중" and context_level(30, False) == "저" and rag_score(0.55) == 30 and rag_score(0.85) == 30


def test_disabled_rule_scores_zero_but_keeps_its_value():
    get_rule_config_store().update(_patch({"rules": {"time_pattern": {"enabled": False}}}))
    s = _signals()
    assert s["time_pattern"].score == 0 and s["time_pattern"].max_score == 0 and not s["time_pattern"].hit
    assert s["time_pattern"].value == 1.0  # 새벽 1시라는 측정값은 남겨 둔다(다시 켜거나 영향 미리보기에 쓰도록)


def test_unknown_payee_is_scored_as_new_with_the_configured_points():
    get_rule_config_store().update(_patch({"rules": {"payee_freshness": {"params": {"score_unknown": 12}}}}))
    s = _signals(payee_account="999-999-999999")
    assert s["payee_freshness"].score == 12 and s["payee_freshness"].value is None


# ---------------------------------------------------------------- 검증
@pytest.mark.parametrize(
    "patch,needle",
    [
        ({"rules": {"amount_anomaly": {"params": {"ratio_low": 6}}}}, "작아야"),  # ratio_low < ratio_mid(5) 위반
        ({"rules": {"payee_fraud": {"params": {"score": 500}}}}, "범위"),
        ({"global": {"account_mid": 70}}, "작아야"),  # account_mid < account_high(60) 위반
        ({"global": {"nope": 1}}, "알 수 없는"),
        ({"rules": {"ghost": {"params": {}}}}, "알 수 없는"),
        ({"rules": {"device": {"params": {"score": "많이"}}}}, "숫자"),
    ],
)
def test_invalid_configs_are_rejected_with_a_readable_message(patch, needle):
    cfg = _patch({}) if not patch else None
    base = get_rule_config().to_dict()
    for section, body in patch.items():
        if section == "global":
            base["global"].update(body)
        else:
            for rule, rbody in body.items():
                base["rules"].setdefault(rule, {"enabled": True, "params": {}})["params"].update(rbody.get("params", {}))
    merged, errors = validate_config(base)
    assert merged is None and any(needle in e for e in errors), errors
    assert cfg is None
    assert get_rule_config().to_dict() == DEFAULT_CONFIG  # 거절되면 설정은 그대로


def test_history_records_what_changed_and_reset_restores_defaults():
    store = get_rule_config_store()
    store.update(_patch({"rules": {"device": {"params": {"score": 5}}}}), actor="테스터", note="점검")
    store.update(_patch({"global": {"account_mid": 28}}))
    history = store.history()
    assert [h["version"] for h in history] == [3, 2]
    assert history[1]["actor"] == "테스터" and history[1]["note"] == "점검"
    assert history[1]["changes"] == [{"path": "rules.device.params.score", "label": "device · 신규 기기·환경 감지 시 배점", "from": 15, "to": 5}]
    store.reset()
    assert get_rule_config().to_dict() == DEFAULT_CONFIG and store.history()[0]["note"].startswith("기본값")


def test_no_change_does_not_create_a_history_entry():
    ok, _, changes = get_rule_config_store().update(DEFAULT_CONFIG)
    assert ok and changes == [] and get_rule_config_store().history() == []


# ---------------------------------------------------------------- 룰 API
def test_rules_state_carries_the_schema_the_screen_validates_against():
    """화면이 입력 즉시 순서 제약까지 검사하려면 스키마가 응답에 들어 있어야 한다(없으면 AI 제안이 잘못된 값을 낼 수 있다)."""
    state = client.get("/api/admin/rules").json()
    order = state["schema"]["order"]
    assert ["account_mid", "account_high", False] in order["global"]
    assert order["rules"]["amount_anomaly"]
    assert set(state["schema"]["rules"]) == {r["name"] for r in state["rules"]}


def test_rules_api_roundtrip_and_effect_on_quote():
    state = client.get("/api/admin/rules").json()
    assert [r["rule_id"] for r in state["rules"]] == [f"R0{i}" for i in range(1, 9)]
    assert state["rules"][1]["params"][0]["key"] == "ratio_high"

    cfg = state["config"]
    cfg["rules"]["payee_freshness"]["params"]["days_new"] = 3  # 개설 5일 계좌는 더 이상 '신규'가 아니다
    res = client.put("/api/admin/rules/config", json={"config": cfg, "note": "신규 기준 완화"})
    assert res.status_code == 200 and res.json()["changes"][0]["to"] == 3
    quote = client.post("/api/transfer/quote", json={"customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000, "current_time": NOW}).json()
    fresh = next(s for s in quote["account"]["signals"] if s["signal"] == "payee_freshness")
    assert fresh["score"] == 10  # 5일 → 'days_recent(30일 이내)' 구간

    bad = client.put("/api/admin/rules/config", json={"config": {"global": {"account_mid": 99}}})
    assert bad.status_code == 422 and bad.json()["detail"]["errors"]
    assert client.get("/api/admin/rules/history").json()[0]["note"] == "신규 기준 완화"
    assert client.post("/api/admin/rules/reset").status_code == 200
    assert client.get("/api/admin/rules").json()["config"] == DEFAULT_CONFIG


# ---------------------------------------------------------------- 로그·사례 (시드 데이터)
def test_seeded_logs_have_what_rescoring_needs():
    logs = client.get("/api/admin/logs").json()
    assert len(logs) >= 300
    assert {l["final"] for l in logs} == {"안전", "주의", "위험"}
    assert any(l["truth"] == "fraud" and l["final"] == "안전" for l in logs)  # 놓친 사기도 있다
    row = logs[0]
    assert {s["signal"] for s in row["signals"]} >= {"amount_anomaly", "payee_freshness", "time_pattern"}
    assert row["usual_hours"] and row["customer_age_group"] and row["customer_region"]


def test_seeded_cases_cover_every_branch_and_status():
    items = client.get("/api/admin/cases").json()
    assert {i["case"]["choice"] for i in items} == {"visit", "delayed", "abandoned", "pending"}
    assert all(i["report"]["report_id"] == i["case"]["report_id"] for i in items)
    visit = next(i["case"] for i in items if i["case"]["choice"] == "visit")
    assert visit["visit"]["officer"]["title"] == "준법감시책임자" and visit["visit"]["mail"]["subject"].startswith("[AI파수꾼]")
    assert any(i["case"]["postcheck"] for i in items)


# ---------------------------------------------------------------- 실제 송금 흐름 → 로그·사례
class _Llm:
    def chat(self, system, messages, tools=None):
        return {"content": [{"type": "text", "text": "확인했어요."}], "stop_reason": "end_turn"}


class _Rag:
    def scenario_rag(self, text):
        return RagMatch(hit=True, matched_type="기관사칭", matched_id="S02", similarity=0.9, score=50, risk_signals=["안전계좌"], source="t", candidates=[])


@pytest.fixture
def live(monkeypatch):
    monkeypatch.setattr(chat_router, "get_llm", lambda: _Llm())
    monkeypatch.setattr(chat_router, "get_rag", lambda: _Rag())


def _risky_session():
    q = client.post("/api/transfer/quote", json={"customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000, "current_time": "2026-08-11T01:10:00+09:00"}).json()
    client.post(f"/api/transfer/{q['session_id']}/chat", json={"text": "검찰이 안전계좌로 옮기래요"})
    return q["session_id"]


def test_finalize_logs_every_decision_and_opens_a_case_for_risky_ones(live):
    before = len(client.get("/api/admin/logs").json())
    safe = client.post("/api/transfer/quote", json={"customer_id": "C001", "payee_account": "552-102-993917", "amount": 150_000, "current_time": "2026-08-13T18:00:00+09:00"}).json()
    client.post(f"/api/transfer/{safe['session_id']}/finalize")
    risky = client.post(f"/api/transfer/{_risky_session()}/finalize").json()
    logs = client.get("/api/admin/logs").json()
    assert len(logs) == before + 2
    newest = [l for l in logs if l["report_id"] == risky["report"]["report_id"]][0]
    assert newest["final"] == "위험" and newest["truth"] is None and newest["rag_id"] == "S02"
    case = client.get(f"/api/admin/cases/{risky['report']['report_id']}").json()["case"]
    assert case["choice"] == "pending" and case["status"] == "고객 선택 대기"


def test_customer_choice_visit_assigns_the_officer_and_sends_the_mail(live):
    sid = _risky_session()
    rid = client.post(f"/api/transfer/{sid}/finalize").json()["report"]["report_id"]
    assert client.post(f"/api/transfer/{sid}/choice", json={"choice": "visit", "branch": "양재남지점"}).json() == {"ok": True, "case_id": rid}
    case = client.get(f"/api/admin/cases/{rid}").json()["case"]
    assert case["choice"] == "visit" and case["status"] == "면담 대기"
    assert case["visit"]["branch"] == "양재남지점" and case["visit"]["officer"]["title"] == "준법감시책임자"
    assert rid in case["visit"]["mail"]["subject"] and case["assignee"]["name"] == case["visit"]["officer"]["name"]
    # 같은 요청이 다시 와도(또는 다른 선택이 와도) 처음 선택이 유지된다.
    client.post(f"/api/transfer/{sid}/choice", json={"choice": "delayed"})
    assert client.get(f"/api/admin/cases/{rid}").json()["case"]["choice"] == "visit"


def test_customer_choice_delayed_and_abandoned(live):
    sid = _risky_session()
    rid = client.post(f"/api/transfer/{sid}/finalize").json()["report"]["report_id"]
    client.post(f"/api/transfer/{sid}/choice", json={"choice": "delayed"})
    case = client.get(f"/api/admin/cases/{rid}").json()["case"]
    assert case["choice"] == "delayed" and case["status"] == "본부 검토 대기" and case["delayed"]["delay_until"]

    sid2 = _risky_session()
    rid2 = client.post(f"/api/transfer/{sid2}/finalize").json()["report"]["report_id"]
    client.post(f"/api/transfer/{sid2}/choice", json={"choice": "abandoned"})
    assert client.get(f"/api/admin/cases/{rid2}").json()["case"]["status"] == "종결"


def test_customer_can_cancel_a_delayed_transfer_before_it_runs(live):
    sid = _risky_session()
    rid = client.post(f"/api/transfer/{sid}/finalize").json()["report"]["report_id"]
    client.post(f"/api/transfer/{sid}/choice", json={"choice": "cancel_delayed"})  # 지연송금 전엔 아무 일 없음
    assert client.get(f"/api/admin/cases/{rid}").json()["case"]["status"] == "고객 선택 대기"
    client.post(f"/api/transfer/{sid}/choice", json={"choice": "delayed"})
    client.post(f"/api/transfer/{sid}/choice", json={"choice": "cancel_delayed"})
    case = client.get(f"/api/admin/cases/{rid}").json()["case"]
    assert case["status"] == "종결" and case["timeline"][-1]["kind"] == "cancel"
    assert case["delayed"]["executed_at"] is None


def test_choice_on_a_non_risky_session_is_a_noop(live):
    q = client.post("/api/transfer/quote", json={"customer_id": "C001", "payee_account": "552-102-993917", "amount": 150_000, "current_time": "2026-08-13T18:00:00+09:00"}).json()
    client.post(f"/api/transfer/{q['session_id']}/finalize")
    assert client.post(f"/api/transfer/{q['session_id']}/choice", json={"choice": "visit"}).json() == {"ok": True, "case_id": None}
    assert client.post("/api/transfer/nope/choice", json={"choice": "visit"}).status_code == 404
    assert client.post(f"/api/transfer/{q['session_id']}/choice", json={"choice": "teleport"}).status_code == 422


def test_case_update_is_validated():
    item = next(i for i in client.get("/api/admin/cases").json() if i["case"]["choice"] == "pending")
    doc = item["case"]
    doc["status"] = "종결"
    assert client.put(f"/api/admin/cases/{doc['case_id']}", json=doc).status_code == 200
    assert client.get(f"/api/admin/cases/{doc['case_id']}").json()["case"]["status"] == "종결"
    bad = dict(doc, choice="teleport")
    assert client.put(f"/api/admin/cases/{doc['case_id']}", json=bad).status_code == 422
    assert client.put("/api/admin/cases/RPT-없음", json=dict(doc, case_id="RPT-없음")).status_code == 404
    assert client.put(f"/api/admin/cases/{doc['case_id']}", json=dict(doc, case_id="다른번호")).status_code == 400


# ---------------------------------------------------------------- 사후 확인(AI 재분석)
def test_reanalyze_needs_an_executed_transfer_and_survives_llm_failure(monkeypatch):
    class Dead:
        def chat(self, *a, **k):
            raise RuntimeError("401 invalid key")

    monkeypatch.setattr(admin_ai, "get_llm", lambda: Dead())
    cases = [i["case"] for i in client.get("/api/admin/cases").json()]
    not_executed = next(c for c in cases if not (c["delayed"] and c["delayed"]["executed_at"]))
    assert client.post(f"/api/admin/cases/{not_executed['case_id']}/reanalyze").status_code == 409

    executed = next(c for c in cases if c["delayed"] and c["delayed"]["executed_at"])
    res = client.post(f"/api/admin/cases/{executed['case_id']}/reanalyze").json()
    assert res["llm"] == "fallback" and res["analysis"]["source"] == "rule"
    assert res["analysis"]["verdict"] in ("정상 가능성 높음", "추가 확인 필요", "사기 의심") and res["analysis"]["evidence"] and res["activity"]


def test_reanalyze_uses_the_llm_narrative_when_available(monkeypatch):
    class Good:
        def chat(self, *a, **k):
            return {"content": [{"type": "text", "text": "AI가 쓴 설명입니다."}], "stop_reason": "end_turn"}

    monkeypatch.setattr(admin_ai, "get_llm", lambda: Good())
    executed = next(i["case"] for i in client.get("/api/admin/cases").json() if i["case"]["delayed"] and i["case"]["delayed"]["executed_at"])
    res = client.post(f"/api/admin/cases/{executed['case_id']}/reanalyze").json()
    assert res["llm"] == "ok" and res["analysis"]["narrative"] == "AI가 쓴 설명입니다." and res["analysis"]["source"] == "ai"
    # 판정 자체는 LLM과 무관하게 규칙이 정한다.
    assert res["analysis"]["verdict"] in ("정상 가능성 높음", "추가 확인 필요", "사기 의심")


def test_narrative_endpoint_returns_the_fallback_when_the_llm_is_down(monkeypatch):
    class Dead:
        def chat(self, *a, **k):
            raise RuntimeError("down")

    monkeypatch.setattr(admin_ai, "get_llm", lambda: Dead())
    res = client.post("/api/admin/ai/narrative", json={"task": "stats_summary", "facts": {"위험": 3}, "fallback": "규칙 기반 요약"}).json()
    assert res == {"text": "규칙 기반 요약", "llm": "fallback"}
