"""고객이 위험 결과 화면에서 고른 분기를 모니터링 사례에 반영한다(내방 예약 / 지연송금 / 송금 중단).

그 뒤 본부·영업점이 하는 일(면담 결과 작성, 송금 승인·재확인·지급정지, 사후 확인 …)은 관리자 페이지가
같은 사례 문서를 갱신해 나간다. 여기서는 '고객이 선택한 순간'만 다룬다.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.case_store import (
    CaseDoc, CaseStore, DelayedInfo, MailInfo, Person, TimelineEvent, VisitInfo, branches, find_branch, now_iso,
)
from app.models import KST, ReportPayload

DEFAULT_BRANCH = "양재남지점"


def _next_business_morning(now: datetime) -> datetime:
    d = now + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.replace(hour=9, minute=30, second=0, microsecond=0)


def _log(case: CaseDoc, actor: str, kind: str, text: str, at: str) -> None:
    case.timeline.append(TimelineEvent(at=at, actor=actor, kind=kind, text=text))


def apply_customer_choice(
    store: CaseStore,
    report: ReportPayload,
    choice: str,
    branch_name: str | None = None,
    reserved_at: str | None = None,
) -> CaseDoc:
    """처음 고른 선택만 인정한다(이미 정해진 사례는 그대로 돌려준다 — 같은 요청이 두 번 와도 안전)."""
    case = store.ensure_pending(report)
    if case.choice != "pending":
        return case

    at = now_iso()
    now = datetime.now(KST)

    if choice == "visit":
        branch = find_branch(branch_name or DEFAULT_BRANCH) or find_branch(DEFAULT_BRANCH) or branches()[0]
        officer = Person(**branch["officer"])
        reserved = reserved_at or _next_business_morning(now).isoformat(timespec="seconds")
        case.choice = "visit"
        case.visit = VisitInfo(
            branch=branch["name"],
            branch_code=branch["code"],
            reserved_at=reserved,
            officer=officer,
            mail=MailInfo(sent_at=at, to=f"{officer.name} {officer.title} ({branch['name']})", subject=f"[AI파수꾼] 고객 면담 요청 · {report.report_id}"),
        )
        case.assignee = Person(name=officer.name, title=f"{officer.title} · {branch['name']}")
        case.status = "면담 대기"
        _log(case, "고객", "choice", f"영업점 내방을 예약했어요 — {branch['name']}", at)
        _log(case, "시스템", "mail", f"{branch['name']} {officer.name} {officer.title}에게 리포트를 개인우편으로 전송했어요.", at)
    elif choice == "delayed":
        case.choice = "delayed"
        case.delayed = DelayedInfo(delay_until=(now + timedelta(hours=2)).isoformat(timespec="seconds"))
        case.status = "본부 검토 대기"
        _log(case, "고객", "choice", "송금을 강행해 지연송금으로 접수했어요.", at)
    else:
        case.choice = "abandoned"
        case.status = "종결"
        case.outcome_at = at
        _log(case, "고객", "choice", "위험 안내를 보고 송금을 중단했어요. 조치가 필요 없는 건이에요.", at)
    return store.put(case)
