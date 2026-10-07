"""본부 관리자 페이지 API — 룰 관리, 거래 로그, 모니터링 사례, AI 설명.

프로토타입이라 인증이 없다(누구나 호출 가능). 실서비스에서는 본부 담당자 권한 검증이 반드시 필요하다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.admin_ai import narrate
from app.case_store import ActivityEvent, CaseDoc, branches, get_case_store, now_iso
from app.data_store import get_payee, scenarios
from app.payee_activity import analysis_facts, analyze_activity, make_activity
from app.report_store import get_report_store, to_summary
from app.rule_config import DEFAULT_CONFIG, get_rule_config, get_rule_config_store, param_schema
from app.tools.account_signals import ACCOUNT_SIGNALS
from app.transfer_log import TransferLog, get_log_store

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ------------------------------------------------------------------ 룰 관리
def _rules_state() -> dict[str, Any]:
    store = get_rule_config_store()
    cfg = get_rule_config()
    schema = param_schema()
    rules = []
    for spec in ACCOUNT_SIGNALS:
        if not cfg.has_rule(spec.name):
            continue  # 설정 스키마가 없는 임시 등록 룰은 조정 대상이 아니다
        rules.append(
            {
                "name": spec.name,
                "rule_id": spec.rule_id,
                "label": spec.label,
                "definition": spec.definition,
                "condition": spec.condition,
                "scoring": spec.scoring,
                "enabled": cfg.enabled(spec.name),
                "max_score": cfg.max_score(spec.name),
                "params": schema["rules"][spec.name],
            }
        )
    return {
        "version": store.version,
        "config": cfg.to_dict(),
        "defaults": DEFAULT_CONFIG,
        "global_params": schema["global"],
        "rules": rules,
        # 입력 즉시 검증용(범위 + 값 사이 순서 제약). 화면이 서버와 같은 규칙으로 미리 검사한다.
        "schema": schema,
    }


@router.get("/rules")
def get_rules():
    return _rules_state()


class RuleConfigUpdate(BaseModel):
    config: dict[str, Any]
    note: str = Field(default="", max_length=200)


@router.put("/rules/config")
def put_rules_config(body: RuleConfigUpdate):
    ok, errors, changes = get_rule_config_store().update(body.config, note=body.note)
    if not ok:
        raise HTTPException(status_code=422, detail={"errors": errors})
    return {**_rules_state(), "changes": changes}


@router.post("/rules/reset")
def reset_rules():
    changes = get_rule_config_store().reset()
    return {**_rules_state(), "changes": changes}


@router.get("/rules/history")
def rules_history():
    return get_rule_config_store().history()


# ------------------------------------------------------------------ 분석 재료
@router.get("/logs", response_model=list[TransferLog])
def logs():
    return get_log_store().all()


@router.get("/scenarios")
def get_scenarios():
    return scenarios()


@router.get("/branches")
def get_branches():
    return branches()


# ------------------------------------------------------------------ 모니터링 사례
@router.get("/cases")
def list_cases():
    reports = get_report_store()
    items = []
    for case in get_case_store().all():
        report = reports.get(case.report_id)
        if report is None:
            continue
        items.append({"case": case, "report": to_summary(report)})
    return items


@router.get("/cases/{case_id}")
def get_case(case_id: str):
    case = get_case_store().get(case_id)
    report = get_report_store().get(case.report_id) if case else None
    if case is None or report is None:
        raise HTTPException(status_code=404, detail="사례를 찾을 수 없어요.")
    return {"case": case, "report": report}


@router.put("/cases/{case_id}")
def put_case(case_id: str, doc: CaseDoc):
    if doc.case_id != case_id:
        raise HTTPException(status_code=400, detail="사례 번호가 맞지 않아요.")
    if get_case_store().get(case_id) is None:
        raise HTTPException(status_code=404, detail="사례를 찾을 수 없어요.")
    return get_case_store().put(doc)


class NarrativeRequest(BaseModel):
    task: str = Field(max_length=40)
    facts: dict[str, Any]
    fallback: str = Field(max_length=2000)


@router.post("/ai/narrative")
def ai_narrative(body: NarrativeRequest):
    text, source = narrate(body.task, body.facts, body.fallback)
    return {"text": text, "llm": source}


@router.post("/cases/{case_id}/reanalyze")
def reanalyze(case_id: str):
    """사후 확인: 송금이 실행된 수취계좌의 이후 거래내역을 AI로 재분석한다. 저장은 하지 않고 결과만 돌려준다."""
    import random
    import zlib

    case = get_case_store().get(case_id)
    report = get_report_store().get(case.report_id) if case else None
    if case is None or report is None:
        raise HTTPException(status_code=404, detail="사례를 찾을 수 없어요.")
    if not (case.delayed and case.delayed.executed_at):
        raise HTTPException(status_code=409, detail="송금이 실행된 건만 사후 확인을 할 수 있어요.")

    activity = list(case.postcheck.activity) if case.postcheck and case.postcheck.activity else []
    if not activity:
        # 실제 거래내역 연동 전이라 가상 내역을 만든다. 사기 신고 이력이 있거나 개설 2주 이내 계좌는 수상한 패턴으로.
        payee = get_payee(report.payee_account)
        age = payee.get("account_age_days")
        suspicious = bool(payee.get("is_fraud_reported")) or (age is not None and age <= 14)
        rng = random.Random(zlib.crc32(case_id.encode()))
        activity = make_activity(case.delayed.executed_at, report.amount, suspicious, rng)

    analysis = analyze_activity(activity, case.severity, now_iso())
    facts = analysis_facts(
        {"금액": report.amount, "수취계좌": f"{report.payee_bank} {report.payee_name}", "위험 심각도": case.severity},
        activity,
        analysis,
    )
    text, source = narrate("post_check", facts, analysis.narrative)
    analysis.narrative = text
    analysis.source = "ai" if source == "ok" else "rule"
    return {"activity": [ActivityEvent(**a.model_dump()) for a in activity], "analysis": analysis, "llm": source}
