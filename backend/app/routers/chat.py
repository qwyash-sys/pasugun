"""M4(질문 카드)~M6(최종 판정) 대응."""

import base64
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.aggregator import calculate_final_risk
from app.agent import PasugunAgent
from app.data_store import get_customer, get_payee
from app.models import AccountAssessment, ContextAnswer
from app.providers.llm.factory import get_llm
from app.providers.ocr.factory import get_ocr
from app.providers.rag.factory import get_rag
from app.questions import SAFETY_QUESTION, empathy_question
from app.reports import build_report
from app.scoring import build_context_assessment
from app.session_store import get_session

logger = logging.getLogger("pasugun")

router = APIRouter(prefix="/api/transfer", tags=["chat"])

# M5 대화는 "게시판 글쓰기" 느낌을 피하려고 실제 멀티턴 채팅으로 주고받되, 길어지면
# 안 되니 사용자 턴 수를 하드 캡으로 못박는다(에이전트가 스스로 대화를 끝내게 두지 않음 —
# 최종 판정과 마찬가지로 대화 종료 시점도 결정론적으로 정한다).
MAX_CHAT_TURNS = 3


class AnswerIn(BaseModel):
    question_id: str
    choice_id: str


class AnswersRequest(BaseModel):
    answers: list[AnswerIn]


class ChatTurnRequest(BaseModel):
    text: str = ""
    attachment_base64: str | None = None


class ChatTurnResponse(BaseModel):
    reply: str
    turn: int
    max_turns: int


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


@router.post("/{session_id}/chat", response_model=ChatTurnResponse)
def chat_turn(session_id: str, payload: ChatTurnRequest):
    try:
        session = get_session(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    if session.chat_turns >= MAX_CHAT_TURNS:
        raise HTTPException(status_code=400, detail="대화 턴 한도를 넘었어요. 결과를 확인해주세요.")

    text = payload.text.strip()
    if payload.attachment_base64:
        try:
            image_bytes = base64.b64decode(payload.attachment_base64)
            ocr_result = get_ocr().ocr_extract(image_bytes)
            text = (text + "\n" + ocr_result["text"]).strip()
        except Exception as e:
            logger.exception("OCR failed")
            raise HTTPException(status_code=502, detail="첨부 이미지 처리 중 문제가 발생했어요.") from e
        session.attachments_present = True

    if not text:
        raise HTTPException(status_code=400, detail="메시지를 입력해주세요.")

    agent = PasugunAgent(get_llm(), get_rag())
    try:
        reply, new_history, rag_match = agent.chat_turn(session.customer_name, session.chat_history, text)
    except Exception as e:
        logger.exception("Agent chat_turn failed")
        raise HTTPException(status_code=502, detail="AI 확인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.") from e

    session.chat_history = new_history
    session.conversation_text = (session.conversation_text + "\n" + text).strip()
    session.chat_turns += 1
    session.last_reply = reply
    if rag_match is not None:
        session.rag_match = rag_match

    return ChatTurnResponse(reply=reply, turn=session.chat_turns, max_turns=MAX_CHAT_TURNS)


@router.post("/{session_id}/finalize")
def finalize(session_id: str):
    try:
        session = get_session(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    combined_text = session.conversation_text
    used_input_or_attachment = bool(combined_text) or session.attachments_present

    context = None
    if session.answers or used_input_or_attachment:
        context = build_context_assessment(session.answers, used_input_or_attachment, session.rag_match)

    final = calculate_final_risk(session.account_score, session.account_level, session.account_signals, context)

    account = AccountAssessment(
        signals=session.account_signals, total_score=session.account_score, level=session.account_level
    )

    report = None
    if final.final == "위험":
        agent = PasugunAgent(get_llm(), get_rag())
        customer = get_customer(session.customer_id)
        payee = get_payee(session.payee_account)
        try:
            report = build_report(
                agent=agent,
                customer=customer,
                customer_phone=customer["phone"],
                payee=payee,
                amount=session.amount,
                attempted_at=session.current_time,
                final=final,
                conversation=combined_text,
                attachments_present=session.attachments_present,
                rag=session.rag_match,
                account=account,
                context=context,
            )
        except Exception as e:
            logger.exception("Report generation failed")
            raise HTTPException(status_code=502, detail="리포트 생성 중 문제가 발생했어요.") from e

    return {
        "final": final,
        "agent_reply": session.last_reply,
        "report": report,
        "account": account,
        "context": context,
    }
