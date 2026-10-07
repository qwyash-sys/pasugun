"""거래 로그 — 파수꾼이 판정한 모든 이체(안전·주의·위험)의 기록. 통계 분석·룰 분석의 재료다.

리포트는 '위험'으로 판정된 건만 남지만, 룰이 잘 맞는지(놓친 사기는 없는지, 괜히 막은 정상 거래는 없는지)
보려면 안전·주의로 통과된 거래도 있어야 한다. 그래서 판정마다 한 줄씩 쌓는다.

임계치를 바꿨을 때 과거 거래가 어떻게 달라졌을지(영향 미리보기) 다시 채점할 수 있도록, 각 신호의
원측값(value)과 2단계 구성요소(답변 점수·입력 여부·RAG 유사도)를 그대로 남긴다.
truth(실제 사기 여부)는 사후에 확정되는 값이라 시연용 합성 데이터에서만 미리 채워져 있고, 실제 운영에서는
모니터링 사례의 최종 결과(case.outcome)로 채워진다.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

from app.config import MOCK_DATA_DIR
from app.models import KST, ContextAssessment, FinalRisk, FinalVerdict, RiskLevel, SignalResult

AGE_GROUPS = ["20대 미만", "20대", "30대", "40대", "50대", "60대", "70대 이상"]


def age_group(age: int) -> str:
    if age < 20:
        return AGE_GROUPS[0]
    if age >= 70:
        return AGE_GROUPS[-1]
    return f"{age // 10 * 10}대"


class LogSignal(BaseModel):
    signal: str
    value: float | None = None
    score: int
    hit: bool


class TransferLog(BaseModel):
    log_id: str
    at: str  # 이체를 시도한 시각(KST)
    customer_id: str
    customer_age_group: str
    customer_region: str
    amount: int
    payee_account: str
    payee_bank: str
    usual_hours: list[int]
    signals: list[LogSignal]
    account_total: int
    account_level: RiskLevel
    asked: bool  # AI 질문(2단계)을 거쳤는지
    # 질문별 답변 점수. 질문을 받지 않았으면 None — 임계치를 바꿔 다시 채점할 때 "그 질문을 지금도
    # 받게 되는지"를 따로 따져야 해서 공감 질문과 안전 질문을 나눠 남긴다.
    answers_empathy: int | None = None
    answers_safety: int | None = None
    answer_hard: bool = False  # 안전 질문에서 결정적 피싱징후 답을 골랐는지
    input_used: bool = False
    rag_id: str | None = None
    rag_type: str | None = None
    rag_similarity: float | None = None
    context_total: int | None = None
    context_level: RiskLevel
    hard_override: bool
    final: FinalVerdict
    report_id: str | None = None
    truth: Literal["fraud", "normal"] | None = None  # 사후 확정된 실제 사기 여부
    scenario: str | None = None  # 실제 사기 유형(시연용 합성 데이터의 정답)


def build_log(
    *,
    log_id: str,
    at: str,
    customer_id: str,
    customer: dict,
    amount: int,
    payee_account: str,
    payee_bank: str,
    signals: list[SignalResult],
    account_total: int,
    account_level: RiskLevel,
    context: ContextAssessment | None,
    final: FinalRisk,
    report_id: str | None,
    truth: Literal["fraud", "normal"] | None = None,
    scenario: str | None = None,
) -> TransferLog:
    profile = customer.get("profile", {})
    rag = context.rag if context else None
    by_question = {a.question_id: a for a in (context.answers if context else [])}
    return TransferLog(
        log_id=log_id,
        at=at,
        customer_id=customer_id,
        customer_age_group=age_group(profile["age"]) if "age" in profile else "",
        customer_region=profile.get("region", ""),
        amount=amount,
        payee_account=payee_account,
        payee_bank=payee_bank,
        usual_hours=list(customer["baseline"]["usual_hours"]),
        signals=[LogSignal(signal=s.signal, value=s.value, score=s.score, hit=s.hit) for s in signals],
        account_total=account_total,
        account_level=account_level,
        asked=context is not None and (bool(context.answers) or context.used_input_or_attachment),
        answers_empathy=by_question["empathy"].choice_weight if "empathy" in by_question else None,
        answers_safety=by_question["safety"].choice_weight if "safety" in by_question else None,
        answer_hard=bool(context and any(a.hard_override for a in context.answers)),
        input_used=bool(context and context.used_input_or_attachment),
        rag_id=rag.matched_id if rag else None,
        rag_type=rag.matched_type if rag else None,
        # 등급 경계를 바꿔 다시 채점해도 어긋나지 않게 소수 3자리까지 남긴다(RagMatch.similarity는 2자리 반올림).
        rag_similarity=(rag.candidates[0].similarity if rag.candidates else rag.similarity) if rag else None,
        context_total=context.total_score if context else None,
        context_level=final.context_level,
        hard_override=final.hard_override,
        final=final.final,
        report_id=report_id,
        truth=truth,
        scenario=scenario,
    )


class TransferLogStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._logs: list[TransferLog] = []
        self._load_seed()

    def _load_seed(self) -> None:
        path = MOCK_DATA_DIR / "transfer_logs.json"
        if not path.exists():
            return
        with path.open(encoding="utf-8") as f:
            self._logs = [TransferLog(**row) for row in json.load(f)]

    def add(self, log: TransferLog) -> None:
        with self._lock:
            self._logs.append(log)

    def all(self) -> list[TransferLog]:
        with self._lock:
            return sorted(self._logs, key=lambda l: l.at, reverse=True)

    def attach_report(self, log_id: str, report_id: str) -> None:
        with self._lock:
            for log in self._logs:
                if log.log_id == log_id:
                    log.report_id = report_id

    def next_id(self, now: datetime | None = None) -> str:
        now = now or datetime.now(KST)
        with self._lock:
            n = sum(1 for l in self._logs if l.log_id.startswith(f"TXN-{now.strftime('%Y%m%d')}")) + 1
        return f"TXN-{now.strftime('%Y%m%d')}-{n:04d}"


@lru_cache
def get_log_store() -> TransferLogStore:
    return TransferLogStore()
