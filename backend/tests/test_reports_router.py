"""관리자 리포트 목록·상세·첨부 API, 그리고 실제 이체 finalize가 만든 리포트가 목록에
쌓이고 업로드 원본 이미지를 다시 받아볼 수 있는지 검증한다."""

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.routers.chat as chat_router
from app.main import app
from app.models import RagMatch

client = TestClient(app)


def _png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


class _TextLlm:
    def chat(self, system, messages, tools=None):
        return {"content": [{"type": "text", "text": "확인했어요."}], "stop_reason": "end_turn"}


class _Rag:
    def scenario_rag(self, text):
        return RagMatch(hit=True, matched_type="기관사칭", matched_id="S02", similarity=0.9, score=50,
                        risk_signals=["안전계좌"], source="test", candidates=[])


class _Ocr:
    def ocr_extract(self, image_bytes):
        return {"text": "안전계좌로 이체하세요"}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    monkeypatch.setattr(chat_router, "get_llm", lambda: _TextLlm())
    monkeypatch.setattr(chat_router, "get_rag", lambda: _Rag())
    monkeypatch.setattr(chat_router, "get_ocr", lambda: _Ocr())


def test_list_is_seeded_with_history_newest_first_and_paged():
    res = client.get("/api/reports", params={"page": 1, "page_size": 5})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 30
    assert len(body["items"]) == 5
    dates = [i["generated_at"] for i in body["items"]]
    assert dates == sorted(dates, reverse=True)

    page2 = client.get("/api/reports", params={"page": 2, "page_size": 5}).json()
    assert {i["report_id"] for i in page2["items"]}.isdisjoint({i["report_id"] for i in body["items"]})


def test_filters_by_levels_rag_and_date():
    only = client.get("/api/reports", params={"account_level": "고", "context_level": "중", "page_size": 50}).json()
    assert only["items"] and all(i["account_level"] == "고" and i["context_level"] == "중" for i in only["items"])

    rag = client.get("/api/reports", params={"rag_type": "메신저피싱", "page_size": 50}).json()
    assert rag["items"] and all(i["rag_type"] == "메신저피싱" for i in rag["items"])

    dated = client.get("/api/reports", params={"date_from": "2026-09-01", "date_to": "2026-09-10", "page_size": 50}).json()
    assert all("2026-09-01" <= i["attempted_at"][:10] <= "2026-09-10" for i in dated["items"])


def test_rejects_bad_filter_values():
    assert client.get("/api/reports", params={"account_level": "매우높음"}).status_code == 422
    assert client.get("/api/reports", params={"date_from": "9월1일"}).status_code == 422
    assert client.get("/api/reports", params={"page_size": 500}).status_code == 422


def test_detail_and_mock_capture_attachment():
    items = client.get("/api/reports", params={"page_size": 50}).json()["items"]
    with_attach = next(i for i in items if i["attachment_count"] > 0)
    detail = client.get(f"/api/reports/{with_attach['report_id']}").json()
    url = detail["attachments"][0]["url"]
    att = client.get(url)
    assert att.status_code == 200
    assert att.headers["content-type"].startswith("image/svg+xml")
    assert "nosniff" in att.headers["x-content-type-options"]
    assert client.get("/api/reports/RPT-없음").status_code == 404
    assert client.get(url[:-1] + "9").status_code == 404


def test_finalize_adds_report_with_downloadable_uploads_once():
    q = client.post("/api/transfer/quote", json={
        "customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000,
        "current_time": "2026-08-11T01:10:00+09:00",
    }).json()
    sid = q["session_id"]
    client.post(f"/api/transfer/{sid}/chat", json={"text": "검찰이래요", "attachments": [{"name": "캡처.png", "base64": _png_b64()}]})

    first = client.post(f"/api/transfer/{sid}/finalize").json()
    again = client.post(f"/api/transfer/{sid}/finalize").json()
    report = first["report"]
    assert report is not None and again["report"]["report_id"] == report["report_id"]

    listed = client.get("/api/reports", params={"q": report["report_id"]}).json()
    assert listed["total"] == 1  # 두 번 finalize 해도 한 번만 쌓인다

    assert report["attachments"][0]["name"] == "캡처.png"
    img = client.get(report["attachments"][0]["url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"


def test_new_report_is_listed_first_even_with_backdated_transaction_time():
    # 개발용 시나리오는 거래 시각을 과거(8월)로 고정한다 — 그래도 방금 만든 리포트가 1페이지 맨 위여야 한다.
    q = client.post("/api/transfer/quote", json={
        "customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000,
        "current_time": "2026-08-11T01:10:00+09:00",
    }).json()
    client.post(f"/api/transfer/{q['session_id']}/chat", json={"text": "검찰이래요"})
    report = client.post(f"/api/transfer/{q['session_id']}/finalize").json()["report"]
    assert report["generated_at"].endswith("+09:00")

    first = client.get("/api/reports", params={"page_size": 1}).json()["items"][0]
    assert first["report_id"] == report["report_id"]


def test_concurrent_finalize_creates_one_report():
    from concurrent.futures import ThreadPoolExecutor

    q = client.post("/api/transfer/quote", json={
        "customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000,
        "current_time": "2026-08-11T01:10:00+09:00",
    }).json()
    sid = q["session_id"]
    client.post(f"/api/transfer/{sid}/chat", json={"text": "검찰이래요"})
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: client.post(f"/api/transfer/{sid}/finalize").json(), range(4)))
    assert len({r["report"]["report_id"] for r in results}) == 1
