"""AI 대화 첫 마디: 앞 단계 답에 맞춰 바뀌고, AI가 실패하면 같은 기준의 규칙 문장을 쓴다."""

from fastapi.testclient import TestClient

import app.routers.chat as chat_router
from app.main import app
from app.opening import rule_opening

client = TestClient(app)
QUOTE = {"customer_id": "C001", "payee_account": "010-6691-98217", "amount": 20_000_000, "current_time": "2026-08-11T01:10:00+09:00", "context_overrides": {"fund_source_recent": True}}


class Dead:
    def chat(self, *a, **k):
        raise RuntimeError("llm down")


class Echo:
    def __init__(self):
        self.prompts = []

    def chat(self, system, messages, tools=None):
        self.prompts.append(messages[0]["content"])
        return {"content": [{"type": "text", "text": "AI가 쓴 첫 마디예요."}], "stop_reason": "end_turn"}


def _session(empathy: str, safety: str) -> str:
    q = client.post("/api/transfer/quote", json=QUOTE).json()
    client.post(f"/api/transfer/{q['session_id']}/answers", json={"answers": [{"question_id": "empathy", "choice_id": empathy}, {"question_id": "safety", "choice_id": safety}]})
    return q["session_id"]


def test_rule_opening_follows_the_answers():
    assert "안전계좌" in rule_opening(["normal_known", "safety_yes"])  # 안전 질문 답이 최우선
    assert "대출·투자" in rule_opening(["risky_offer", "safety_no"])
    assert "직접 통화" in rule_opening(["normal_known", "safety_no"])
    for ids in ([], ["normal_trade"]):
        text = rule_opening(ids)
        assert text.endswith("AI가 분석해드릴게요.") and len(text) < 90  # 짧게, AI 분석 안내로 마무리


def test_opening_uses_ai_and_falls_back_to_rules(monkeypatch):
    echo = Echo()
    monkeypatch.setattr(chat_router, "get_llm", lambda: echo)
    sid = _session("risky_offer", "safety_no")
    res = client.post(f"/api/transfer/{sid}/opening").json()
    assert res == {"text": "AI가 쓴 첫 마디예요.", "source": "ai"}
    assert "최근 대출·투자 안내를 받고 보내요" in echo.prompts[0] and "질문" in echo.prompts[0]  # 고객이 고른 답이 AI에 전달된다
    assert client.post(f"/api/transfer/{sid}/opening").json()["text"] == "AI가 쓴 첫 마디예요."  # 다시 열어도 같은 문장

    monkeypatch.setattr(chat_router, "get_llm", lambda: Dead())
    sid2 = _session("normal_known", "safety_yes")
    res2 = client.post(f"/api/transfer/{sid2}/opening").json()
    assert res2["source"] == "rule" and "안전계좌" in res2["text"]
