"""모니터링 사례(case) — '위험'으로 판정된 거래 한 건을 본부가 어떻게 처리했는지의 기록.

고객이 위험 결과 화면에서 무엇을 골랐느냐(분기)에 따라 처리 흐름이 달라진다:
  visit   영업점 내방 예약 → 담당 영업점의 준법감시책임자에게 리포트 개인우편 자동 전송 →
          면담 후 책임자가 결과 작성 → 본부가 결과 확인(종결)
  delayed 지연송금(고객이 강행) → 본부가 리포트·거래 추적으로 판단해 송금 진행 / 고객 재확인 / 지급정지 →
          송금이 실행된 건은 사후 확인(수취계좌 거래내역 AI 재분석)
  abandoned 고객이 송금을 중단 — 조치 불필요(예방 성공으로 집계)
  pending 고객이 아직 선택 전

처리 흐름(상태 전이)은 프론트(admin/engine/cases.ts)가 한 곳에서 계산하고, 이 저장소는 사례 문서를 그대로
보관·반환한다. 프로토타입이라 프로세스 메모리에 두며, 서버에서의 권한·상태 검증은 실서비스 전환 때 필요하다.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

from app.config import MOCK_DATA_DIR
from app.models import KST, ReportPayload

CaseChoice = Literal["visit", "delayed", "abandoned", "pending"]
Outcome = Literal["fraud_confirmed", "normal", "unresolved"]
Severity = Literal["초고위험", "고위험"]


class Person(BaseModel):
    name: str
    title: str


class TimelineEvent(BaseModel):
    at: str
    actor: str
    kind: str
    text: str


class MailInfo(BaseModel):
    sent_at: str
    to: str
    subject: str


class Interview(BaseModel):
    written_at: str
    result: Literal["fraud_signs", "normal", "no_show"]
    action: Literal["payment_stop", "guide", "none"]
    memo: str = ""


class VisitInfo(BaseModel):
    branch: str
    branch_code: str
    reserved_at: str
    officer: Person
    mail: MailInfo
    interview: Interview | None = None
    hq_confirmed_at: str | None = None


class Decision(BaseModel):
    type: Literal["approve", "reconfirm", "hold"]
    at: str
    by: str
    note: str = ""


class Reconfirm(BaseModel):
    requested_at: str
    result: Literal["intent_confirmed", "victim_aware"] | None = None
    at: str | None = None
    note: str = ""


class DelayedInfo(BaseModel):
    delay_until: str
    decision: Decision | None = None
    reconfirm: Reconfirm | None = None
    executed_at: str | None = None


class ActivityEvent(BaseModel):
    at: str
    kind: Literal["in", "split", "atm", "overseas", "report", "normal_use", "hold"]
    text: str
    amount: int | None = None


class Analysis(BaseModel):
    at: str
    verdict: Literal["정상 가능성 높음", "추가 확인 필요", "사기 의심"]
    confidence: int
    evidence: list[str]
    narrative: str
    action: str
    source: Literal["ai", "rule", "seed"]


class PostCheck(BaseModel):
    required: bool
    activity: list[ActivityEvent] = []
    analysis: Analysis | None = None
    confirmed_at: str | None = None


class CaseDoc(BaseModel):
    case_id: str
    report_id: str
    created_at: str
    updated_at: str
    choice: CaseChoice
    severity: Severity
    status: str
    outcome: Outcome | None = None
    outcome_at: str | None = None
    assignee: Person | None = None
    visit: VisitInfo | None = None
    delayed: DelayedInfo | None = None
    postcheck: PostCheck | None = None
    timeline: list[TimelineEvent] = []


def severity_of(report: ReportPayload) -> Severity:
    """초고위험: 결정적 피싱징후가 있거나 송금위험·AI분석이 모두 '고'. 나머지 위험 판정은 고위험."""
    f = report.final
    if f.hard_override or (f.account_level == "고" and f.context_level == "고"):
        return "초고위험"
    return "고위험"


def now_iso() -> str:
    return datetime.now(KST).isoformat(timespec="seconds")


@lru_cache
def branches() -> list[dict]:
    path = MOCK_DATA_DIR / "branches.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def find_branch(name: str) -> dict | None:
    return next((b for b in branches() if b["name"] == name), None)


class CaseStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cases: dict[str, CaseDoc] = {}
        self._load_seed()

    def _load_seed(self) -> None:
        path = MOCK_DATA_DIR / "cases.json"
        if not path.exists():
            return
        with path.open(encoding="utf-8") as f:
            for row in json.load(f):
                doc = CaseDoc(**row)
                self._cases[doc.case_id] = doc

    def all(self) -> list[CaseDoc]:
        with self._lock:
            return sorted(self._cases.values(), key=lambda c: c.created_at, reverse=True)

    def get(self, case_id: str) -> CaseDoc | None:
        with self._lock:
            return self._cases.get(case_id)

    def put(self, doc: CaseDoc) -> CaseDoc:
        with self._lock:
            doc.updated_at = now_iso()
            self._cases[doc.case_id] = doc
            return doc

    def ensure_pending(self, report: ReportPayload) -> CaseDoc:
        """위험 리포트가 만들어질 때 사례를 하나 열어둔다(고객 선택 대기)."""
        with self._lock:
            existing = self._cases.get(report.report_id)
            if existing:
                return existing
            at = now_iso()
            doc = CaseDoc(
                case_id=report.report_id,
                report_id=report.report_id,
                created_at=at,
                updated_at=at,
                choice="pending",
                severity=severity_of(report),
                status="고객 선택 대기",
                timeline=[TimelineEvent(at=at, actor="시스템", kind="created", text="위험 판정 — 리포트가 생성됐어요.")],
            )
            self._cases[doc.case_id] = doc
            return doc


@lru_cache
def get_case_store() -> CaseStore:
    return CaseStore()
