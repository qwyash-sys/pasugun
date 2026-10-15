"""사례집(RAG) 관리 API — 등록·수정·중지가 유사 사례 검색에 바로 반영되는지 검사한다(실제 SBERT + FAISS)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

INVEST = {
    "유형": "투자사기",
    "중분류": "가상자산 투자 리딩방",
    "수법요약": "코인 리딩방에서 고수익을 약속하며 지정 거래소 계좌로 투자금 입금을 유도",
    "범인멘트": ["리딩방 VIP만 받는 코인 정보입니다", "원금 보장에 수익 300% 드립니다", "이 계좌로 투자금 넣으시면 바로 매수해드려요"],
    "위험신호": ["고수익보장", "리딩방", "지정계좌입금"],
    "위험도": "고",
    "출처": "테스트",
}
QUERY = "코인 리딩방에서 원금 보장에 수익 300% 준다고 이 계좌로 투자금 넣으래요"


def _search(text: str) -> dict:
    res = client.post("/api/admin/rag/search", json={"text": text})
    assert res.status_code == 200, res.text
    return res.json()


def test_search_ranks_every_active_scenario_with_thresholds():
    body = _search("검찰 수사관이 자산 보호하려면 안전계좌로 옮기래요")
    scenarios = client.get("/api/admin/scenarios").json()
    assert len(body["match"]["candidates"]) == len(scenarios)
    assert body["match"]["matched_type"] == "기관사칭"
    assert body["thresholds"] == {"rag_mid_sim": 0.6, "rag_mid_score": 30, "rag_high_sim": 0.8, "rag_high_score": 50}


def test_create_scenario_is_searchable_and_logged():
    res = client.post("/api/admin/scenarios", json={"scenario": INVEST, "note": "신종 수법"})
    assert res.status_code == 200
    doc = res.json()["scenario"]
    assert doc["id"] == "S13" and doc["enabled"] and doc["updated_at"]
    assert res.json()["nearest"]["scenario_id"] != "S13"

    match = _search(QUERY)["match"]
    assert match["hit"] and match["matched_id"] == "S13"

    hist = client.get("/api/admin/scenarios/history").json()
    assert hist[0]["scenario_id"] == "S13" and hist[0]["action"] == "등록" and hist[0]["note"] == "신종 수법"


def test_disabled_scenario_drops_out_of_search():
    doc = client.post("/api/admin/scenarios", json={"scenario": INVEST}).json()["scenario"]
    res = client.put(f"/api/admin/scenarios/{doc['id']}", json={"scenario": {**INVEST, "enabled": False}})
    assert res.status_code == 200 and res.json()["nearest"] is None
    ids = [c["scenario_id"] for c in _search(QUERY)["match"]["candidates"]]
    assert doc["id"] not in ids
    assert client.get("/api/admin/scenarios/history").json()[0]["action"] == "중지"


def test_edit_changes_what_matches():
    s01 = next(s for s in client.get("/api/admin/scenarios").json() if s["id"] == "S01")
    edited = {k: s01[k] for k in ("유형", "중분류", "위험도", "출처")} | {
        "수법요약": INVEST["수법요약"], "범인멘트": INVEST["범인멘트"], "위험신호": INVEST["위험신호"],
    }
    assert client.put("/api/admin/scenarios/S01", json={"scenario": edited}).status_code == 200
    assert _search(QUERY)["match"]["matched_id"] == "S01"
    assert client.get("/api/admin/scenarios/history").json()[0]["summary"].startswith("수정")


def test_validation_rejects_empty_lines_and_unknown_id():
    bad = {**INVEST, "범인멘트": ["  ", ""]}
    assert client.post("/api/admin/scenarios", json={"scenario": bad}).status_code == 422
    assert client.put("/api/admin/scenarios/S99", json={"scenario": INVEST}).status_code == 404


def test_evaluate_runs_the_shared_sentence_set():
    from app.rag_eval import CASES

    body = client.post("/api/admin/rag/evaluate").json()
    assert len(body["items"]) == len(CASES)
    assert all(i["ok"] for i in body["items"]), [i for i in body["items"] if not i["ok"]]
    # 사례를 모두 중지하면 점검할 수 없다
    for s in client.get("/api/admin/scenarios").json():
        client.put(f"/api/admin/scenarios/{s['id']}", json={"scenario": {k: s[k] for k in ("유형", "중분류", "수법요약", "범인멘트", "위험신호", "위험도", "출처")} | {"enabled": False}})
    assert client.post("/api/admin/rag/evaluate").status_code == 409


def test_signal_tags_ignore_spacing_so_hard_override_still_applies():
    res = client.post("/api/admin/scenarios", json={"scenario": {**INVEST, "위험신호": ["안전 계좌", "원격 제어앱", "안전계좌"]}})
    assert res.json()["scenario"]["위험신호"] == ["안전계좌", "원격제어앱"]
