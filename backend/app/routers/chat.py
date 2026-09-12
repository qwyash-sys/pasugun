"""M4(질문 카드)~M6(최종 판정) 대응."""

import base64

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.aggregator import calculate_final_risk
from app.agent import MeomchitAgent
from app.data_store import get_customer, get_payee
from app.models import ContextAnswer
from app.providers.llm.factory import get_llm
from app.providers.ocr.factory import get_ocr
from app.providers.rag.factory import get_rag
from app.questions import SAFETY_QUESTION, empathy_question
from app.reports import build_report
from app.scoring import build_context_assessment
from app.session_store import get_session

router = APIRouter(prefix="/api/transfer", tags=["chat"])


class AnswerIn(BaseModel):
    question_id: str
    choice_id: str


class AnswersRequest(BaseModel):
    answers: list[AnswerIn]


class FinalizeRequest(BaseModel):
    text: str = ""
    attachment_base64: str | None = None
    skipped: bool = False


def _choice_lookup(question_id: str, choice_id: str, customer_name: str) -> dict:
    question = empathy_question(customer_name) if question_id == "empathy" else SAFETY_QUESTION
    for choice in question["choices"]:
        if choice["choice_id"] == choice_id:
            return choice
    raise HTTPException(status_code=400, detail=f"unknown choice_id: {choice_id}")


@router.post("/{session_id}/answers")
def submit_answers(session_id: str, payload: AnswersRequest):
    try:
        session = get_session(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    session.answers = []
    for answer in payload.answers:
        choice = _choice_lookup(answer.question_id, answer.choice_id, session.customer_name)
        session.answers.append(
            ContextAnswer(
                question_id=answer.question_id,
                choice_id=answer.choice_id,
                choice_weight=choice["weight"],
                hard_override=choice["hard_override"],
            )
        )
    return {"ok": True}


@router.post("/{session_id}/finalize")
def finalize(session_id: str, payload: FinalizeRequest):
    try:
        session = get_session(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    agent = MeomchitAgent(get_llm(), get_rag())

    combined_text = payload.text.strip()
    attachments_present = bool(payload.attachment_base64)
    agent_reply = None
    rag = None
    used_input_or_attachment = False

    if not payload.skipped:
        if payload.attachment_base64:
            image_bytes = base64.b64decode(payload.attachment_base64)
            ocr_result = get_ocr().ocr_extract(image_bytes)
            combined_text = (combined_text + "\n" + ocr_result["text"]).strip()

        if combined_text:
            used_input_or_attachment = True
            result = agent.analyze(session.customer_name, combined_text)
            agent_reply = result.reply
            rag = result.rag

    context = None
    if session.answers or used_input_or_attachment:
        context = build_context_assessment(session.answers, used_input_or_attachment, rag)

    final = calculate_final_risk(session.account_score, session.account_level, session.account_signals, context)

    report = None
    if final.final == "위험":
        customer = get_customer(session.customer_id)
        payee = get_payee(session.payee_account)
        report = build_report(
            agent=agent,
            customer=customer,
            customer_phone=customer["phone"],
            payee=payee,
            amount=session.amount,
            attempted_at=session.current_time,
            final=final,
            conversation=combined_text,
            attachments_present=attachments_present,
            rag=rag,
        )

    return {"final": final, "agent_reply": agent_reply, "report": report}
