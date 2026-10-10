"""은행 영업일 계산(주말 + 2026년 은행 휴무일). frontend/src/utils/branchVisit.ts의 목록과 같다 — 해가 바뀌면 둘 다 갱신."""

from __future__ import annotations

from datetime import date, datetime, timedelta

BANK_HOLIDAYS = {
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01", "2026-05-05",
    "2026-05-25", "2026-06-03", "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28",
    "2026-10-05", "2026-10-09", "2026-12-25",
}


def is_business_day(d: date | datetime) -> bool:
    day = d.date() if isinstance(d, datetime) else d
    return day.weekday() < 5 and day.isoformat() not in BANK_HOLIDAYS


def next_business_day(dt: datetime) -> datetime:
    d = dt + timedelta(days=1)
    while not is_business_day(d):
        d += timedelta(days=1)
    return d
