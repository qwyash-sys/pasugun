"""사후 확인용: 송금이 실행된 수취계좌의 이후 거래내역(가상)과, 그 내역에 대한 AI 재분석.

실제 코어뱅킹이 없는 프로토타입이라 수취계좌의 이후 거래는 규칙으로 만들어 낸다. 사기 계좌는 입금 직후
분산 이체·현금 인출·가상자산 이동 같은 '자금 세탁' 패턴을, 정상 계좌는 평범한 자동이체·보유 패턴을 보인다.

재분석의 판정(정상 가능성 높음 / 추가 확인 필요 / 사기 의심)은 거래내역의 신호를 세는 규칙으로 정한다 —
AI(LLM)는 그 결과를 사람이 읽기 좋은 설명문으로 풀어쓰는 일만 하므로, AI가 멈춰도 판정은 같다.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from app.case_store import ActivityEvent, Analysis
from app.models import KST


def _at(base: datetime, minutes: int) -> str:
    return (base + timedelta(minutes=minutes)).astimezone(KST).isoformat(timespec="seconds")


def make_activity(sent_at: str, amount: int, suspicious: bool, rng: random.Random) -> list[ActivityEvent]:
    base = datetime.fromisoformat(sent_at)
    events = [ActivityEvent(at=_at(base, 0), kind="in", text=f"{amount:,}원 입금(분석 대상 거래)", amount=amount)]
    if suspicious:
        parts = rng.choice([2, 3, 4])
        events.append(
            ActivityEvent(
                at=_at(base, rng.randint(4, 15)),
                kind="split",
                text=f"입금 직후 {parts}개 계좌로 분산 이체(건당 약 {amount // parts:,}원)",
                amount=amount,
            )
        )
        if rng.random() < 0.75:
            cash = amount // rng.choice([3, 4, 5])
            events.append(ActivityEvent(at=_at(base, rng.randint(20, 55)), kind="atm", text=f"ATM 현금 출금 {cash:,}원", amount=cash))
        if rng.random() < 0.45:
            events.append(ActivityEvent(at=_at(base, rng.randint(70, 180)), kind="overseas", text="가상자산 거래소 연동 계좌로 이체", amount=amount // 2))
        if rng.random() < 0.6:
            events.append(ActivityEvent(at=_at(base, 240), kind="report", text=f"동일 수취계좌에 대한 다른 피해 신고 {rng.choice([1, 2, 3])}건 접수"))
    else:
        events.append(
            ActivityEvent(
                at=_at(base, rng.randint(600, 1500)),
                kind="normal_use",
                text=rng.choice(["다음 영업일 공과금·관리비 자동이체 정상 출금", "카드 대금 결제 출금(평소 사용 패턴)", "급여·정기 입금 이력과 같은 패턴"]),
            )
        )
        events.append(ActivityEvent(at=_at(base, 2880), kind="hold", text="이후 48시간 추가 자금 이동 없음(보유)"))
    return events


def analyze_activity(activity: list[ActivityEvent], severity: str, at: str) -> Analysis:
    kinds = [e.kind for e in activity]
    splits = sum(1 for k in kinds if k == "split")
    risk = 40 * splits + 25 * kinds.count("atm") + 20 * kinds.count("overseas") + 30 * kinds.count("report")
    calm = 30 * kinds.count("normal_use") + 15 * kinds.count("hold")
    score = max(0, risk - calm)

    evidence = [e.text for e in activity if e.kind in ("split", "atm", "overseas", "report")]
    if not evidence:
        evidence = [e.text for e in activity if e.kind in ("normal_use", "hold")] or ["입금 외 특이한 자금 이동이 확인되지 않았어요."]

    if score >= 60:
        verdict, confidence = "사기 의심", min(97, 62 + score // 2)
        action = "수취은행에 지급정지를 요청하고 피해 구제 절차(피해 신고·환급 안내)를 고객에게 안내하세요."
        narrative = "입금 직후 자금이 짧은 시간 안에 여러 곳으로 흩어지거나 현금화되는 전형적인 사기 자금 이동 패턴이에요."
    elif score >= 25:
        verdict, confidence = "추가 확인 필요", 55 + score // 3
        action = "고객에게 거래 경위를 재확인하고, 수취계좌의 이후 움직임을 24시간 더 모니터링하세요."
        narrative = "의심스러운 신호가 일부 있지만 사기로 단정하기엔 근거가 부족해요. 경위 확인이 필요해요."
    else:
        verdict, confidence = "정상 가능성 높음", min(95, 70 + (calm - risk) // 3)
        action = "특이 사항이 없어 정상 거래로 종결 처리해도 돼요."
        narrative = "입금 이후 자금 흐름이 일상적인 사용 패턴과 같고 이상 신호가 확인되지 않았어요."

    return Analysis(at=at, verdict=verdict, confidence=int(confidence), evidence=evidence, narrative=narrative, action=action, source="rule")


def analysis_facts(report_summary: dict[str, Any], activity: list[ActivityEvent], analysis: Analysis) -> dict[str, Any]:
    """LLM에게 설명문을 쓰게 할 때 넘기는 사실 묶음(판정은 이미 정해져 있다)."""
    return {
        "거래": report_summary,
        "수취계좌 이후 거래내역": [e.text for e in activity],
        "규칙 판정": analysis.verdict,
        "확신도": analysis.confidence,
    }
