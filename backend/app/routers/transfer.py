"""M1~M3 대응: 1단계 계좌 신호 백그라운드 스코어링 (SPEC 6-0, 6-1)."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.aggregator import intervention_intensity
from app.case_flow import apply_customer_choice
from app.case_store import get_case_store
from app.data_store import get_customer, get_payee
from app.models import TransferRequest
from app.questions import questions_for
from app.scoring import account_level, build_account_assessment
from app.session_store import create_session, get_session
from app.tools.account_signals import run_all_account_signals

router = APIRouter(prefix="/api/transfer", tags=["transfer"])


@router.post("/quote")
def create_quote(payload: TransferRequest):
    try:
        customer = get_customer(payload.customer_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    payee = get_payee(payload.payee_account)

    signals = run_all_account_signals(
        customer_id=payload.customer_id,
        payee_account=payload.payee_account,
        amount=payload.amount,
        current_time=payload.current_time,
        overrides=payload.context_overrides,
    )
    total, level = build_account_assessment(signals)
    intervention = intervention_intensity(total)

    session = create_session(
        customer_id=payload.customer_id,
        customer_name=customer["name"],
        payee_account=payload.payee_account,
        amount=payload.amount,
        current_time=payload.current_time,
        account_signals=signals,
        account_score=total,
        account_level=level,
        intervention=intervention,
    )

    return {
        "session_id": session.session_id,
        "customer_name": customer["name"],
        "payee_name": payee.get("payee_name", "미상"),
        "payee_bank": payee.get("payee_bank", "미상"),
        # 모의 데이터에 있는 계좌인지 — 아니면 화면에서 "예금주 확인됨" 대신 확인 불가로 안내한다.
        "payee_verified": payee.get("verified", True),
        "account": {"signals": signals, "total_score": total, "level": level},
        "intervention": intervention,
        "questions": questions_for(intervention, customer["name"]),
    }


class ChoiceRequest(BaseModel):
    choice: Literal["visit", "delayed", "abandoned"]
    branch: str | None = Field(default=None, max_length=40)
    reserved_at: str | None = Field(default=None, max_length=40)


@router.post("/{session_id}/choice")
def record_choice(session_id: str, body: ChoiceRequest):
    """위험 결과 화면에서 고객이 고른 분기(영업점 내방 예약 / 지연송금 / 중단)를 본부 모니터링 사례에 반영한다."""
    try:
        session = get_session(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    report = (session.final_response or {}).get("report")
    if report is None:
        return {"ok": True, "case_id": None}  # 위험이 아닌 건은 모니터링 대상이 아니다
    case = apply_customer_choice(get_case_store(), report, body.choice, body.branch, body.reserved_at)
    return {"ok": True, "case_id": case.case_id}
