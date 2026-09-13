"""영업점 연계 리포트 (SPEC 7장). 데이터 매핑 + LLM 자연어 요약(대화 진단 요약만).
나머지 항목은 전부 구조화 데이터 그대로 매핑한다."""

import re
from datetime import datetime, timezone
from itertools import count

from app.agent import PasugunAgent
from app.models import AccountAssessment, ContextAssessment, FinalRisk, RagMatch, ReportPayload

_report_seq = count(1)

_RECOMMENDATIONS = {
    "위험": "대면 본인확인 및 통화상대 진위 확인, 필요시 지급정지·112 안내",
}


def _mask_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 7:
        return phone
    return f"{digits[:3]}-****-{digits[-4:]}"


def _mask_account(account: str) -> str:
    parts = account.split("-")
    if len(parts) < 2:
        return account
    return "-".join([parts[0], *(["*" * len(p) for p in parts[1:-1]]), parts[-1]])


def next_report_id(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"RPT-{now.strftime('%Y%m%d')}-{next(_report_seq):03d}"


def build_report(
    *,
    agent: PasugunAgent,
    customer: dict,
    customer_phone: str,
    payee: dict,
    amount: int,
    attempted_at: str,
    final: FinalRisk,
    conversation: str,
    attachments_present: bool,
    rag: RagMatch | None,
    account: AccountAssessment,
    context: ContextAssessment | None,
) -> ReportPayload:
    conversation_summary = (
        agent.summarize_for_report(conversation, rag)
        if conversation
        else "고객 응답 없음(대화창 미사용)"
    )

    return ReportPayload(
        report_id=next_report_id(),
        generated_at=datetime.now(timezone.utc).isoformat(),
        customer_name=customer["name"],
        customer_phone_masked=_mask_phone(customer_phone),
        customer_account_masked=_mask_account(customer["account"]),
        payee_bank=payee.get("payee_bank", "미상"),
        payee_account=payee["payee_account"],
        payee_name=payee.get("payee_name", "미상"),
        amount=amount,
        attempted_at=attempted_at,
        final=final,
        account_reasons=[r for r in final.reasons if not r.startswith("RAG") and "결정적 피싱징후" not in r],
        conversation_summary=conversation_summary,
        attachments_present=attachments_present,
        rag=rag,
        recommendation=_RECOMMENDATIONS.get(final.final, "특이사항 없음, 정상 처리"),
        account=account,
        context=context,
    )
