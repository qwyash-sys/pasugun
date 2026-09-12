"""M1~M3 대응: 1단계 계좌 신호 백그라운드 스코어링 (SPEC 6-0, 6-1)."""

from fastapi import APIRouter, HTTPException

from app.aggregator import intervention_intensity
from app.data_store import get_customer, get_payee
from app.models import TransferRequest
from app.questions import questions_for
from app.scoring import account_level, build_account_assessment
from app.session_store import create_session
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
        "account": {"signals": signals, "total_score": total, "level": level},
        "intervention": intervention,
        "questions": questions_for(intervention, customer["name"]),
    }
