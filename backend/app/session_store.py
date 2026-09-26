"""이체 세션 인메모리 저장소. 프로토타입이라 DB 없이 프로세스 메모리에 둔다.
M2에서 1단계 백그라운드 스코어링 결과를 들고 있다가, M4/M5 단계에서 이어받는다."""

import uuid
from dataclasses import dataclass, field
from typing import Any

from app.models import ContextAnswer, RagMatch, RiskLevel, SignalResult
from app.report_store import UploadedImage


@dataclass
class TransferSession:
    session_id: str
    customer_id: str
    customer_name: str
    payee_account: str
    amount: int
    current_time: str
    account_signals: list[SignalResult]
    account_score: int
    account_level: RiskLevel
    intervention: str
    answers: list[ContextAnswer] = field(default_factory=list)
    # M5 멀티턴 대화 상태. chat_history는 LLM에 그대로 재전달하는 원본 메시지 형식(role/content
    # 블록)이고, conversation_text는 사람이 읽는 합본 — 리포트 요약·2단계 스코어링에 쓴다.
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    conversation_text: str = ""
    chat_turns: int = 0
    rag_match: RagMatch | None = None
    attachments_present: bool = False
    # 영업점 리포트의 "첨부자료 보기"용 원본 이미지. 리포트가 생성될 때 리포트 저장소로 넘어간다.
    uploads: list[UploadedImage] = field(default_factory=list)
    finalized: bool = False
    # finalize를 다시 불러도(프론트 "다시 시도") 리포트가 두 번 쌓이지 않게 첫 결과를 그대로 돌려준다.
    final_response: dict[str, Any] | None = None


_sessions: dict[str, TransferSession] = {}


def create_session(**kwargs) -> TransferSession:
    session_id = str(uuid.uuid4())
    session = TransferSession(session_id=session_id, **kwargs)
    _sessions[session_id] = session
    return session


def get_session(session_id: str) -> TransferSession:
    session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"unknown session_id: {session_id}")
    return session
