from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

RiskLevel = Literal["저", "중", "고"]
FinalVerdict = Literal["안전", "주의", "위험"]


class SignalResult(BaseModel):
    """1단계 계좌 신호 툴의 공통 반환 형식 (SPEC 3-1)."""

    signal: str
    hit: bool
    score: int
    detail: str


class ContextOverrides(BaseModel):
    """실 코어뱅킹 이벤트 로그가 없는 프로토타입에서, 이번 이체 시도에 한해
    주입하는 합성 이벤트 플래그. 고객 정적 프로필과 분리해 케이스별 충돌을 피한다."""

    fund_source_recent: bool = False
    limit_changed_recent: bool = False
    device_new: bool = False
    velocity_recent_count: int = 0


class TransferRequest(BaseModel):
    customer_id: str = Field(min_length=1, max_length=32)
    payee_account: str = Field(min_length=1, max_length=64)
    amount: int = Field(gt=0, le=100_000_000_000)
    current_time: str  # ISO8601
    context_overrides: ContextOverrides = ContextOverrides()

    @field_validator("current_time")
    @classmethod
    def _iso8601(cls, v: str) -> str:
        # 형식이 틀리면 하위 신호 툴에서 터져 502로 새므로, 입구에서 422로 막는다.
        try:
            datetime.fromisoformat(v)
        except ValueError as e:
            raise ValueError("current_time은 ISO8601 형식이어야 합니다") from e
        return v


class AccountAssessment(BaseModel):
    signals: list[SignalResult]
    total_score: int
    level: RiskLevel


class RagCandidate(BaseModel):
    """scenario_rag가 비교한 사례집 후보 1건 — 왜 다른 사례가 아니라 이 사례가
    뽑혔는지 보여주기 위해, 1등만이 아니라 전체 순위를 남긴다."""

    scenario_id: str
    matched_type: str
    similarity: float


class RagMatch(BaseModel):
    signal: str = "scenario"
    hit: bool
    matched_type: str | None = None
    matched_id: str | None = None
    similarity: float
    score: int
    risk_signals: list[str] = []
    source: str | None = None
    candidates: list[RagCandidate] = []


class ContextAnswer(BaseModel):
    question_id: str
    choice_id: str
    choice_weight: int
    hard_override: bool = False


class ContextAssessment(BaseModel):
    answers: list[ContextAnswer] = []
    used_input_or_attachment: bool = False
    rag: RagMatch | None = None
    total_score: int
    level: RiskLevel
    hard_override: bool = False


class FinalRisk(BaseModel):
    account_level: RiskLevel
    context_level: RiskLevel
    final: FinalVerdict
    hard_override: bool
    reasons: list[str]
    action: str


class AttachmentMeta(BaseModel):
    """리포트에 딸린 첨부자료 1건. url은 /api/reports/{id}/attachments/{i} 형태의 상대경로."""

    name: str
    url: str


class ReportPayload(BaseModel):
    report_id: str
    generated_at: str
    customer_name: str
    customer_phone_masked: str
    customer_account_masked: str
    payee_bank: str
    payee_account: str
    payee_name: str
    amount: int
    attempted_at: str
    final: FinalRisk
    account_reasons: list[str]
    conversation_summary: str
    attachments_present: bool
    rag: RagMatch | None
    recommendation: str
    account: AccountAssessment
    context: ContextAssessment | None = None
    attachments: list[AttachmentMeta] = []
    extra: dict[str, Any] = {}


class ReportSummary(BaseModel):
    """관리자 리포트 목록 한 줄 — 목록 화면에 필요한 값만 추린다(상세는 ReportPayload)."""

    report_id: str
    attempted_at: str
    customer_name: str
    payee_bank: str
    payee_name: str
    amount: int
    account_score: int
    account_level: RiskLevel
    context_score: int | None
    context_level: RiskLevel
    hard_override: bool
    rag_type: str | None
    rag_similarity: float | None
    attachment_count: int


class ReportListResponse(BaseModel):
    items: list[ReportSummary]
    total: int
    page: int
    page_size: int
