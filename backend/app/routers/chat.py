"""M4(질문 카드)~M6(최종 판정) 대응."""

import base64
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.aggregator import calculate_final_risk
from app.agent import PasugunAgent
from app.data_store import get_customer, get_payee
from app.models import AccountAssessment, ContextAnswer
from app.providers.llm.factory import get_llm
from app.providers.ocr.factory import get_ocr
from app.providers.rag.factory import get_rag
from app.questions import SAFETY_QUESTION, empathy_question, questions_for
from app.report_store import UploadedImage, get_report_store
from app.reports import build_report
from app.scoring import build_context_assessment
from app.session_store import get_session

logger = logging.getLogger("pasugun")

router = APIRouter(prefix="/api/transfer", tags=["chat"])

# M5 대화는 "게시판 글쓰기" 느낌을 피하려고 실제 멀티턴 채팅으로 주고받되, 길어지면
# 안 되니 사용자 턴 수를 하드 캡으로 못박는다(에이전트가 스스로 대화를 끝내게 두지 않음 —
# 최종 판정과 마찬가지로 대화 종료 시점도 결정론적으로 정한다).
MAX_CHAT_TURNS = 3
MAX_ATTACHMENTS_PER_TURN = 5


class AnswerIn(BaseModel):
    question_id: str
    choice_id: str


class AnswersRequest(BaseModel):
    answers: list[AnswerIn]


class AttachmentIn(BaseModel):
    # 파일명은 영업점 리포트 "첨부자료 보기"에 그대로 표시된다.
    name: str = Field(default="첨부이미지", max_length=200)
    base64: str = Field(max_length=14_000_000)  # 장당 base64 약 10MB


class ChatTurnRequest(BaseModel):
    # 상한이 없으면 수십만 자 입력이 그대로 LLM 호출(=크레딧)로 이어진다.
    text: str = Field(default="", max_length=2000)
    attachments: list[AttachmentIn] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_TURN)


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

    if session.finalized:
        raise HTTPException(status_code=409, detail="이미 확정된 이체예요.")

    # 클라이언트가 점수를 조작하지 못하게: 이 세션이 실제로 받은 질문에 대한 답만, 질문당 1번씩만 인정한다.
    allowed = {q["question_id"] for q in questions_for(session.intervention, session.customer_name)}
    seen: set[str] = set()
    for answer in payload.answers:
        if answer.question_id not in allowed:
            raise HTTPException(status_code=400, detail=f"이 이체에서 묻지 않은 질문이에요: {answer.question_id}")
        if answer.question_id in seen:
            raise HTTPException(status_code=400, detail=f"같은 질문에 중복 답변할 수 없어요: {answer.question_id}")
        seen.add(answer.question_id)

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

    if session.finalized:
        raise HTTPException(status_code=409, detail="이미 확정된 이체예요.")

    if session.chat_turns >= MAX_CHAT_TURNS:
        raise HTTPException(status_code=400, detail="대화 턴 한도를 넘었어요. 결과를 확인해주세요.")

    text = payload.text.strip()
    uploads: list[UploadedImage] = []
    ocr_texts = []
    for attachment in payload.attachments:
        try:
            image_bytes = base64.b64decode(attachment.base64)
            ocr_result = get_ocr().ocr_extract(image_bytes)
        except Exception as e:
            logger.exception("OCR failed")
            raise HTTPException(status_code=502, detail="첨부 이미지 처리 중 문제가 발생했어요.") from e
        uploads.append(UploadedImage(name=attachment.name, data=image_bytes))
        if ocr_result["text"]:
            ocr_texts.append(ocr_result["text"])
    if ocr_texts:
        text = (text + "\n" + "\n".join(ocr_texts)).strip()

    if not text:
        raise HTTPException(status_code=400, detail="메시지를 입력해주세요.")

    agent = PasugunAgent(get_llm(), get_rag())
    try:
        reply, new_history, rag_match = agent.chat_turn(session.customer_name, session.chat_history, text)
    except Exception as e:
        logger.exception("Agent chat_turn failed")
        raise HTTPException(status_code=502, detail="AI 확인 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.") from e

    # 이 턴이 끝까지 성공했을 때만 반영한다 — 중간에 실패하면 프론트가 같은 이미지를
    # 다시 보내므로, 먼저 쌓아두면 리포트에 같은 첨부가 두 번 들어간다.
    session.chat_history = new_history
    session.conversation_text = (session.conversation_text + "\n" + text).strip()
    session.chat_turns += 1
    if uploads:
        session.uploads.extend(uploads)
        session.attachments_present = True
    if rag_match is not None:
        session.rag_match = rag_match

    return ChatTurnResponse(reply=reply, turn=session.chat_turns, max_turns=MAX_CHAT_TURNS)


@router.post("/{session_id}/finalize")
def finalize(session_id: str):
    try:
        session = get_session(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    if session.final_response is not None:
        return session.final_response

    combined_text = session.conversation_text
    used_input_or_attachment = bool(combined_text) or session.attachments_present

    # 에이전트가 scenario_rag를 호출할지는 LLM 재량이라, 소형 모델은 사기 정황이 뚜렷해도
    # 되묻기만 하고 넘어가는 경우가 있다. 2단계 RAG 점수·후보비교는 시연의 핵심이므로,
    # 대화가 있었는데도 매칭이 비어 있으면 서버가 대화 내용으로 직접 한 번 돌린다(로컬 FAISS라 무료).
    if combined_text and session.rag_match is None:
        try:
            session.rag_match = get_rag().scenario_rag(combined_text)
        except Exception:
            logger.exception("RAG fallback failed")

    context = None
    if session.answers or used_input_or_attachment:
        context = build_context_assessment(session.answers, used_input_or_attachment, session.rag_match)

    final = calculate_final_risk(session.account_score, session.account_level, session.account_signals, context)

    account = AccountAssessment(
        signals=session.account_signals, total_score=session.account_score, level=session.account_level
    )

    agent = PasugunAgent(get_llm(), get_rag())

    # 결과 화면 상단의 결론 안내(데모 모드의 agentReply와 같은 자리). 마지막 채팅 답장은 대개
    # 후속 질문이라 결론으로 부적절하므로, 판정이 확정된 뒤 결론 문구만 따로 생성한다.
    conclusion = None
    if combined_text:
        try:
            conclusion = agent.conclude(session.customer_name, final.final, final.reasons, combined_text)
        except Exception:
            logger.exception("Conclusion generation failed")

    report = None
    if final.final == "위험":
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
        report = get_report_store().add(report, session.uploads)

    session.finalized = True
    session.final_response = {
        "final": final,
        "agent_reply": conclusion,
        "report": report,
        "account": account,
        "context": context,
    }
    return session.final_response
