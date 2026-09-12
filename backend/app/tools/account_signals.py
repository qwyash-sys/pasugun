"""1단계 계좌 신호 툴 8종 (SPEC 3-1, 4-1). 항상 전량 호출하며, 결정론적 룰만 사용한다.

SPEC은 fund_source/limit_change/device/velocity를 customer_id만으로 조회하는 툴로
정의하지만, 이 4개 신호는 실제로는 "이번 이체 시도 시점"의 이벤트 스냅샷이다.
실 코어뱅킹 이벤트 로그가 없는 프로토타입에서 고객 레코드에 정적으로 박아두면
같은 고객(C001)을 재사용하는 여러 데모 케이스(1·3·4)가 서로 다른 이벤트 상태를
요구할 때 충돌한다. 그래서 이 4개 툴은 ContextOverrides(이번 요청에 한정된 합성
이벤트 플래그)를 함께 받는다 — 실서비스 전환 시 이 인자 자리를 실제 이벤트 로그
조회로 그대로 대체하면 된다.
"""

from datetime import datetime

from app.data_store import get_customer, get_payee
from app.models import ContextOverrides, SignalResult


def check_payee_fraud(payee_account: str) -> SignalResult:
    payee = get_payee(payee_account)
    hit = bool(payee["is_fraud_reported"])
    score = 40 if hit else 0
    count = payee.get("fraud_report_count", 0)
    detail = f"사기신고 {count}건" if hit else "사기신고 이력 없음"
    return SignalResult(signal="payee_fraud", hit=hit, score=score, detail=detail)


def check_amount_anomaly(customer_id: str, amount: int) -> SignalResult:
    customer = get_customer(customer_id)
    avg = customer["baseline"]["avg_transfer_amount"]

    if avg <= 0:
        ratio = None
        score = 25 if amount >= 1_000_000 else 0
    else:
        ratio = amount / avg
        if ratio >= 10:
            score = 25
        elif ratio >= 5:
            score = 15
        elif ratio >= 2:
            score = 8
        else:
            score = 0

    hit = score > 0
    ratio_text = f"평소 대비 {ratio:.1f}배" if ratio is not None else "평소 이체 이력 없음"
    return SignalResult(signal="amount_anomaly", hit=hit, score=score, detail=ratio_text)


def check_fund_source(customer_id: str, overrides: ContextOverrides) -> SignalResult:
    customer = get_customer(customer_id)
    hit = overrides.fund_source_recent or customer["recent_events"].get("fund_source") is not None
    score = 25 if hit else 0
    detail = "예·적금 해지 등 자금이동 24시간 이내" if hit else "특이 자금이동 없음"
    return SignalResult(signal="fund_source", hit=hit, score=score, detail=detail)


def check_payee_freshness(payee_account: str) -> SignalResult:
    payee = get_payee(payee_account)
    age = payee.get("account_age_days", 9999)
    if age <= 7:
        score = 20
    elif age <= 30:
        score = 10
    else:
        score = 0
    hit = score > 0
    detail = f"개설 {age}일" if age < 9999 else "개설일 정보 없음(신규 취급)"
    return SignalResult(signal="payee_freshness", hit=hit, score=score, detail=detail)


def check_limit_change(customer_id: str, overrides: ContextOverrides) -> SignalResult:
    customer = get_customer(customer_id)
    hit = overrides.limit_changed_recent or bool(customer["recent_events"].get("limit_changed"))
    score = 20 if hit else 0
    detail = "24시간 내 이체한도 상향" if hit else "한도 변경 없음"
    return SignalResult(signal="limit_change", hit=hit, score=score, detail=detail)


def check_velocity(customer_id: str, overrides: ContextOverrides) -> SignalResult:
    count = overrides.velocity_recent_count
    if count >= 3:
        score = 20
    elif count == 2:
        score = 10
    else:
        score = 0
    hit = score > 0
    detail = f"10분 내 {count}건" if hit else "정상 빈도"
    return SignalResult(signal="velocity", hit=hit, score=score, detail=detail)


def check_device(customer_id: str, overrides: ContextOverrides) -> SignalResult:
    customer = get_customer(customer_id)
    hit = overrides.device_new or bool(customer["recent_events"].get("device_new"))
    score = 15 if hit else 0
    detail = "신규 기기/환경" if hit else "기존 사용 기기"
    return SignalResult(signal="device", hit=hit, score=score, detail=detail)


def check_time_pattern(current_time: str, customer_id: str) -> SignalResult:
    customer = get_customer(customer_id)
    start, end = customer["baseline"]["usual_hours"]
    hour = datetime.fromisoformat(current_time).hour

    if 0 <= hour < 6:
        score = 10
        detail = "평소 없는 새벽 시간대(00~06시)"
    elif not (start <= hour < end):
        score = 5
        detail = "평소 이용 시간대 밖"
    else:
        score = 0
        detail = "평소 이용 시간대"

    hit = score > 0
    return SignalResult(signal="time_pattern", hit=hit, score=score, detail=detail)


def run_all_account_signals(
    customer_id: str,
    payee_account: str,
    amount: int,
    current_time: str,
    overrides: ContextOverrides,
) -> list[SignalResult]:
    """1단계 8개 툴을 항상 전량 호출한다 (SPEC 1장)."""

    return [
        check_payee_fraud(payee_account),
        check_amount_anomaly(customer_id, amount),
        check_fund_source(customer_id, overrides),
        check_payee_freshness(payee_account),
        check_limit_change(customer_id, overrides),
        check_velocity(customer_id, overrides),
        check_device(customer_id, overrides),
        check_time_pattern(current_time, customer_id),
    ]
