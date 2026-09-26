"""AI(LLM)·OCR 장애 내성: API 키 만료·크레딧 소진·네트워크 장애·OCR 엔진 고장이 나도 송금
안전 확인 흐름(견적 → 질문 → 대화 → 판정 → 리포트)이 끝까지 돌아야 한다. 판정은 원래 결정론적
로직이라 LLM이 없어도 같고, 대화·결론·리포트 요약만 규칙 기반 문구로 대체된다."""

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.routers.chat as chat_router
from app.main import app
from app.providers.rag.faiss_provider import FaissLocalRagProvider

client = TestClient(app)


class DeadLlm:
    """키가 무효가 된 상황(anthropic.AuthenticationError 대용)."""

    calls = 0

    def chat(self, system, messages, tools=None):
        DeadLlm.calls += 1
        raise RuntimeError("Error code: 401 - authentication_error: API key is invalid")


class RecordingLlm:
    """복구된 LLM — 받은 대화 이력을 기록한다."""

    def __init__(self):
        self.seen: list[list[dict]] = []

    def chat(self, system, messages, tools=None):
        self.seen.append(messages)
        return {"content": [{"type": "text", "text": "다시 연결됐어요. 계속 말씀해주세요."}], "stop_reason": "end_turn"}


class GoodOcr:
    def ocr_extract(self, image_bytes):
        return {"text": "[Web발신] 서울중앙지검 계좌 범죄 연루 안전계좌로 이체 바랍니다"}


class BrokenOcr:
    def ocr_extract(self, image_bytes):
        raise OSError("tesseract is not installed")


def _png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(autouse=True)
def real_rag_dead_llm(monkeypatch):
    monkeypatch.setattr(chat_router, "get_llm", lambda: DeadLlm())
    monkeypatch.setattr(chat_router, "get_rag", lambda: FaissLocalRagProvider())
    monkeypatch.setattr(chat_router, "get_ocr", lambda: GoodOcr())


def _risky_session() -> str:
    q = client.post("/api/transfer/quote", json={
        "customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000,
        "current_time": "2026-08-11T10:10:00+09:00",
    }).json()
    return q["session_id"]


def test_whole_flow_completes_with_llm_down():
    sid = _risky_session()
    r1 = client.post(f"/api/transfer/{sid}/chat", json={"text": "어떤 분이 전화로 급하게 돈을 보내달라고 했어요"})
    r2 = client.post(f"/api/transfer/{sid}/chat", json={
        "text": "검찰청 수사관이 제 계좌가 범죄에 연루됐다고 안전계좌로 옮기래요",
        "attachments": [{"name": "검찰문자.png", "base64": _png_b64()}],
    })
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    b1, b2 = r1.json(), r2.json()
    assert b1["fallback"] and b2["fallback"] and (b1["turn"], b2["turn"]) == (1, 2)
    for reply in (b1["reply"], b2["reply"]):
        assert reply and "보이스피싱" not in reply and "사기" not in reply  # 시스템 프롬프트 원칙 유지
    assert "기관사칭" in b2["reply"]  # 로컬 RAG 대조 결과가 답장에 반영된다

    final = client.post(f"/api/transfer/{sid}/finalize")
    assert final.status_code == 200, final.text
    body = final.json()
    assert body["final"]["final"] == "위험"
    assert body["agent_reply"] and "영업점" in body["agent_reply"]  # 판정별 고정 결론 문구
    report = body["report"]
    assert "원문 발췌" in report["conversation_summary"] and "기관사칭" in report["conversation_summary"]
    assert [a["name"] for a in report["attachments"]] == ["검찰문자.png"]
    assert body["context"]["rag"]["hit"] is True


def test_health_reports_llm_fallback_without_leaking_secrets():
    sid = _risky_session()
    client.post(f"/api/transfer/{sid}/chat", json={"text": "확인 부탁해요"})
    health = client.get("/api/health").json()
    assert health["status"] == "ok" and health["llm"] == "fallback"
    assert "401" in health["last_error"] and health["fallback_count"] >= 1
    assert "sk-" not in health["last_error"]


def test_llm_recovery_continues_the_same_conversation(monkeypatch):
    sid = _risky_session()
    client.post(f"/api/transfer/{sid}/chat", json={"text": "모르는 번호로 전화가 왔어요"})  # 장애 중(대체 답장)

    recovered = RecordingLlm()
    monkeypatch.setattr(chat_router, "get_llm", lambda: recovered)
    r = client.post(f"/api/transfer/{sid}/chat", json={"text": "은행 직원이라고 했어요"})
    assert r.status_code == 200 and r.json()["fallback"] is False
    history = recovered.seen[0]
    # 대체 답장이 이력에 assistant로 들어가 있어 user/assistant 교대가 깨지지 않는다(Anthropic API 요구사항).
    assert [m["role"] for m in history] == ["user", "assistant", "user"]
    assert client.get("/api/health").json()["llm"] == "ok"


def test_broken_ocr_keeps_the_image_and_the_conversation(monkeypatch):
    monkeypatch.setattr(chat_router, "get_ocr", lambda: BrokenOcr())
    sid = _risky_session()
    r = client.post(f"/api/transfer/{sid}/chat", json={
        "text": "", "attachments": [{"name": "캡처1.png", "base64": _png_b64()}, {"name": "캡처2.png", "base64": _png_b64()}],
    })
    assert r.status_code == 200, r.text  # 예전엔 502로 대화 전체가 막혔다
    r2 = client.post(f"/api/transfer/{sid}/chat", json={"text": "검찰 수사관이 안전계좌로 옮기라는 문자였어요"})
    assert r2.status_code == 200, r2.text
    report = client.post(f"/api/transfer/{sid}/finalize").json()["report"]
    assert [a["name"] for a in report["attachments"]] == ["캡처1.png", "캡처2.png"]
    assert client.get(report["attachments"][1]["url"]).headers["content-type"] == "image/png"


def test_fallback_reply_only_names_type_and_signals_on_strong_matches():
    from app.agent import _fallback_chat_reply
    from app.models import RagMatch

    def rag(sim):
        return RagMatch(hit=True, matched_type="메신저피싱", matched_id="S05", similarity=sim, score=30,
                        risk_signals=["통화회피", "문자로만연락"], source="t", candidates=[])

    weak = _fallback_chat_reply("남용준", rag(0.64), 1)
    strong = _fallback_chat_reply("남용준", rag(0.86), 1)
    assert "통화회피" not in weak and "메신저피싱" not in weak and "공식 대표번호" in weak
    assert "메신저피싱" in strong and "통화회피" in strong
