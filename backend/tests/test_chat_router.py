"""chat.py 라우터 통합 테스트 (TestClient) — quote -> answers -> chat -> finalize 전체
흐름을 HTTP 레벨에서 검증한다. 여태 라우터 자체를 자동으로 검증하는 테스트가 없었고
(test_agent.py는 PasugunAgent 단위 테스트, test_scoring.py는 순수 함수 테스트) M5를
멀티턴으로 바꾸면서 세션 상태(chat_history/conversation_text/rag_match/chat_turns)가
여러 요청에 걸쳐 올바르게 누적되는지가 특히 중요해져서 추가한다.

LLM/RAG는 가짜로 주입해 API 키나 모델 로딩 없이 빠르고 결정론적으로 돈다 — get_llm/get_rag는
main.py가 아니라 chat.py 모듈 안에서 직접 호출되므로(FastAPI Depends가 아님) 그 모듈
네임스페이스를 monkeypatch한다."""

import pytest
from fastapi.testclient import TestClient

import app.routers.chat as chat_router
from app.main import app
from app.models import RagMatch

client = TestClient(app)


class FakeLlm:
    """1번째 호출은 scenario_rag tool_use, 그 이후는 평문 응답 — 실제 두 채팅턴을
    거치는 동안 RAG가 정확히 한 번만 호출되고 그 결과가 세션에 누적되는지 확인한다."""

    def __init__(self):
        self.calls = 0

    def chat(self, system, messages, tools=None):
        self.calls += 1
        if self.calls == 1:
            return {
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "scenario_rag",
                        "input": {"text": "검찰이 안전계좌로 옮기라고 했어요"},
                    }
                ],
                "stop_reason": "tool_use",
            }
        return {"content": [{"type": "text", "text": f"AI 응답 {self.calls}"}], "stop_reason": "end_turn"}


class FakeRag:
    def scenario_rag(self, text: str) -> RagMatch:
        return RagMatch(
            hit=True,
            matched_type="기관사칭",
            matched_id="S02",
            similarity=0.9,
            score=50,
            risk_signals=["안전계좌"],
            source="test",
            candidates=[],
        )


@pytest.fixture
def fake_llm():
    return FakeLlm()


@pytest.fixture(autouse=True)
def patch_providers(monkeypatch, fake_llm):
    # get_llm()은 원래 @lru_cache라 프로세스 전체에서 같은 인스턴스를 돌려준다 —
    # 매 호출마다 새 FakeLlm을 만들면 self.calls가 요청 간에 누적되지 않으므로
    # 같은 인스턴스를 계속 반환하게 해서 그 singleton 성격을 그대로 재현한다.
    monkeypatch.setattr(chat_router, "get_llm", lambda: fake_llm)
    monkeypatch.setattr(chat_router, "get_rag", lambda: FakeRag())


def _quote(**overrides) -> dict:
    payload = {
        "customer_id": "C001",
        "payee_account": "010-6660-98261",
        "amount": 20_000_000,
        "current_time": "2026-08-11T01:10:00+09:00",
        **overrides,
    }
    res = client.post("/api/transfer/quote", json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def test_chat_turns_accumulate_and_finalize_uses_session_state():
    session_id = _quote()["session_id"]

    res1 = client.post(f"/api/transfer/{session_id}/chat", json={"text": "검찰이 안전계좌로 옮기라고 했어요"})
    assert res1.status_code == 200, res1.text
    body1 = res1.json()
    assert body1 == {"reply": "AI 응답 2", "turn": 1, "max_turns": 3}

    res2 = client.post(f"/api/transfer/{session_id}/chat", json={"text": "공문도 보여줬어요"})
    assert res2.status_code == 200, res2.text
    assert res2.json() == {"reply": "AI 응답 3", "turn": 2, "max_turns": 3}

    final = client.post(f"/api/transfer/{session_id}/finalize")
    assert final.status_code == 200, final.text
    data = final.json()
    # 마지막 채팅 답장(후속 질문)이 아니라, 확정 판정 뒤에 따로 생성한 결론 문구여야 한다.
    # FakeLlm 호출: 채팅 2턴(tool_use 1 + 텍스트 2) = 3회 → 결론이 4번째 응답.
    assert data["agent_reply"] == "AI 응답 4"
    assert data["context"]["used_input_or_attachment"] is True
    assert data["context"]["rag"]["hit"] is True
    assert data["context"]["rag"]["matched_id"] == "S02"
    # RAG는 1번째 턴에서만 호출됐지만(FakeLlm 2번째 호출부터는 tool_use 없음),
    # 세션에 남아 2번째 턴 이후에도 finalize에 그대로 반영돼야 한다.


def test_finalize_runs_rag_itself_when_llm_never_called_the_tool(monkeypatch):
    """소형 모델이 scenario_rag를 호출하지 않고 되묻기만 해도, 대화가 있었다면 finalize가
    직접 RAG를 돌려 2단계 점수·후보비교가 비지 않아야 한다."""

    class NeverCallsToolLlm:
        def chat(self, system, messages, tools=None):
            return {"content": [{"type": "text", "text": "더 자세히 말씀해주실래요?"}], "stop_reason": "end_turn"}

    monkeypatch.setattr(chat_router, "get_llm", lambda: NeverCallsToolLlm())
    session_id = _quote()["session_id"]
    client.post(f"/api/transfer/{session_id}/chat", json={"text": "검찰이 안전계좌로 옮기라고 했어요"})

    data = client.post(f"/api/transfer/{session_id}/finalize").json()
    assert data["context"]["rag"]["matched_id"] == "S02"


def test_chat_turn_cap_enforced_server_side():
    session_id = _quote()["session_id"]
    for _ in range(3):
        res = client.post(f"/api/transfer/{session_id}/chat", json={"text": "메시지"})
        assert res.status_code == 200, res.text

    over_cap = client.post(f"/api/transfer/{session_id}/chat", json={"text": "한 번 더요"})
    assert over_cap.status_code == 400


def test_chat_requires_nonempty_text_or_attachment():
    session_id = _quote()["session_id"]
    res = client.post(f"/api/transfer/{session_id}/chat", json={"text": "   "})
    assert res.status_code == 400


def test_chat_bad_attachment_base64_returns_502_not_500():
    session_id = _quote()["session_id"]
    res = client.post(
        f"/api/transfer/{session_id}/chat",
        json={"text": "", "attachment_base64": "%%%not-valid-base64%%%"},
    )
    assert res.status_code == 502
    # main.py의 전역 예외 핸들러(ServerErrorMiddleware 경유, CORS 헤더 누락)로 새지
    # 않고 chat.py가 직접 HTTPException(502)로 잡아야 CORS 헤더가 정상적으로 붙는다.
    assert res.status_code != 500


def test_chat_unknown_session_returns_404():
    res = client.post("/api/transfer/does-not-exist/chat", json={"text": "hi"})
    assert res.status_code == 404


def test_finalize_unknown_session_returns_404():
    res = client.post("/api/transfer/does-not-exist/finalize")
    assert res.status_code == 404


def test_finalize_survives_conclusion_llm_failure(monkeypatch):
    """결론 문구 생성이 실패해도 판정 자체는 결정론적이므로 finalize는 성공하고 agent_reply만 비어야 한다."""

    class ConclusionFailsLlm(FakeLlm):
        def chat(self, system, messages, tools=None):
            if "최종 판정" in str(messages[-1]["content"]):
                raise RuntimeError("boom")
            return super().chat(system, messages, tools)

    monkeypatch.setattr(chat_router, "get_llm", lambda: ConclusionFailsLlm())
    session_id = _quote(payee_account="000-0000-000000", amount=10_000)["session_id"]
    client.post(f"/api/transfer/{session_id}/chat", json={"text": "그냥 확인차 물어봤어요"})

    res = client.post(f"/api/transfer/{session_id}/finalize")
    assert res.status_code == 200, res.text
    assert res.json()["agent_reply"] is None
    assert res.json()["final"]["final"] in ("안전", "주의", "위험")


def test_finalize_with_no_chat_and_no_answers_skips_context():
    """M3a 확인 1탭 경로 및 M5 건너뛰기 경로: finalize에 바디가 없어도(세션에 아무것도
    쌓이지 않았으면) context가 아예 비어야 한다 — 2단계가 실행되지 않았다는 뜻."""
    session_id = _quote(payee_account="000-0000-000000", amount=10_000)["session_id"]

    final = client.post(f"/api/transfer/{session_id}/finalize")
    assert final.status_code == 200, final.text
    assert final.json()["context"] is None


# ---- 입력 검증 / 점수 조작 방어 (API 퍼징에서 발견된 구멍들) ----


@pytest.mark.parametrize(
    "override",
    [{"amount": -5}, {"amount": 0}, {"amount": 10**18}, {"current_time": "어제"}, {"payee_account": ""}, {"payee_account": "9" * 500}],
)
def test_quote_rejects_invalid_input_with_422(override):
    payload = {
        "customer_id": "C001",
        "payee_account": "010-6660-98261",
        "amount": 1_000_000,
        "current_time": "2026-08-11T01:10:00+09:00",
        **override,
    }
    assert client.post("/api/transfer/quote", json=payload).status_code == 422


def test_answers_cannot_inflate_score_by_repeating_or_faking_questions():
    # 중고거래 케이스: 개입=confirm_only(질문 없음). 안전질문 '예'를 5번 보내면 예전엔 250점·🔴가 됐다.
    session_id = _quote(payee_account="552-102-993841", amount=150_000)["session_id"]
    forged = {"question_id": "safety", "choice_id": "safety_yes"}
    res = client.post(f"/api/transfer/{session_id}/answers", json={"answers": [forged] * 5})
    assert res.status_code == 400
    assert client.post(f"/api/transfer/{session_id}/finalize").json()["final"]["final"] == "안전"


def test_answers_reject_duplicate_question():
    q = _quote()  # 검찰사칭 계좌: empathy + safety 질문
    assert q["intervention"] == "empathy_question+safety_question"
    dup = {"question_id": "safety", "choice_id": "safety_yes"}
    res = client.post(f"/api/transfer/{q['session_id']}/answers", json={"answers": [dup, dup]})
    assert res.status_code == 400


def test_answers_accept_the_questions_actually_asked():
    q = _quote()
    res = client.post(
        f"/api/transfer/{q['session_id']}/answers",
        json={"answers": [{"question_id": "empathy", "choice_id": "normal_known"}, {"question_id": "safety", "choice_id": "safety_no"}]},
    )
    assert res.status_code == 200


def test_chat_rejects_oversized_text():
    session_id = _quote()["session_id"]
    assert client.post(f"/api/transfer/{session_id}/chat", json={"text": "가" * 2001}).status_code == 422


def test_session_is_locked_after_finalize():
    session_id = _quote()["session_id"]
    assert client.post(f"/api/transfer/{session_id}/finalize").status_code == 200
    assert client.post(f"/api/transfer/{session_id}/chat", json={"text": "또 말해요"}).status_code == 409
    assert client.post(f"/api/transfer/{session_id}/answers", json={"answers": []}).status_code == 409
    # finalize 자체는 재호출해도 안전(멱등)해야 한다 — 프론트 "다시 시도" 버튼용.
    assert client.post(f"/api/transfer/{session_id}/finalize").status_code == 200
