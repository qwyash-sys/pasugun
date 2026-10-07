"""1단계 계좌 신호 툴 (SPEC 3-1, 4-1의 8종 + 확장). 항상 전량 호출하며, 결정론적 룰만 사용한다.

신호 추가 방법: 판정 함수를 만들고 AccountSignalSpec으로 ACCOUNT_SIGNALS에 등록(register_account_signal).

SPEC은 fund_source/limit_change/device/velocity를 customer_id만으로 조회하는 툴로
정의하지만, 이 4개 신호는 실제로는 "이번 이체 시도 시점"의 이벤트 스냅샷이다.
실 코어뱅킹 이벤트 로그가 없는 프로토타입에서 고객 레코드에 정적으로 박아두면
같은 고객(C001)을 재사용하는 여러 데모 케이스(1·3·4)가 서로 다른 이벤트 상태를
요구할 때 충돌한다. 그래서 이 4개 툴은 ContextOverrides(이번 요청에 한정된 합성
이벤트 플래그)를 함께 받는다 — 실서비스 전환 시 이 인자 자리를 실제 이벤트 로그
조회로 그대로 대체하면 된다.
"""

from collections.abc import Callable
from dataclasses import dataclass
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
    age = payee.get("account_age_days")
    if age is None:
        # 개설일을 확인할 수 없는 계좌는 신규 계좌와 같은 위험으로 본다.
        return SignalResult(signal="payee_freshness", hit=True, score=20, detail="개설일 정보 없음(신규 계좌로 취급)")
    if age <= 7:
        score = 20
    elif age <= 30:
        score = 10
    else:
        score = 0
    return SignalResult(signal="payee_freshness", hit=score > 0, score=score, detail=f"개설 {age}일")


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


@dataclass(frozen=True)
class SignalInput:
    """1단계 신호가 볼 수 있는 이번 이체 시도의 입력 전부. 새 신호는 이것만 받으면 된다."""

    customer_id: str
    payee_account: str
    amount: int
    current_time: str
    overrides: ContextOverrides


@dataclass(frozen=True)
class AccountSignalSpec:
    """신호(룰) 하나 = 이름·표시명·만점·판정 함수 + 관리자 화면에 보여줄 룰 설명. 레지스트리
    (ACCOUNT_SIGNALS)에 넣으면 스코어링·API 응답·화면(막대/룰 설명)·리포트까지 자동으로 따라온다."""

    name: str
    label: str
    max_score: int
    check: Callable[[SignalInput], SignalResult]
    # 관리자 화면 룰 설명(항목을 누르면 나옴). 비워도 동작하지만 새 룰은 채워두는 걸 권장.
    rule_id: str = ""
    definition: str = ""  # 정의/기능
    condition: str = ""  # 조건(무엇을 보고 배점하는가)
    scoring: str = ""  # 이 시스템의 실제 배점 기준

    def evaluate(self, inp: SignalInput) -> SignalResult:
        result = self.check(inp)
        if result.signal != self.name:
            raise ValueError(f"신호 이름 불일치: spec={self.name} result={result.signal}")
        if not 0 <= result.score <= self.max_score:
            raise ValueError(f"{self.name} 점수 {result.score}가 만점 {self.max_score} 범위를 벗어남")
        return result.model_copy(
            update={
                "label": self.label,
                "max_score": self.max_score,
                "rule_id": self.rule_id,
                "definition": self.definition,
                "condition": self.condition,
                "scoring": self.scoring,
            }
        )


# 1단계 계좌신호 룰. 순서 = 화면 표시 순서. 만점 합계가 곧 1단계 최대 점수(175).
# 룰ID·정의·조건은 업무 룰 목록(R01~R11) 기준 — R09~R11은 아직 구현 전이라 여기엔 없다.
ACCOUNT_SIGNALS: list[AccountSignalSpec] = [
    AccountSignalSpec(
        "payee_fraud", "수취계좌 사기이력", 40, lambda i: check_payee_fraud(i.payee_account),
        rule_id="R01",
        definition="수취계좌의 사기신고 이력 여부",
        condition="신고 건수에 따라 점수 배점",
        scoring="사기신고 이력 있음 40점 · 없음 0점 (현재는 신고 건수와 무관하게 같은 점수)",
    ),
    AccountSignalSpec(
        "amount_anomaly", "이체금액 이상치", 25, lambda i: check_amount_anomaly(i.customer_id, i.amount),
        rule_id="R02",
        definition="평소 이체금액 대비 이번 이체금액의 이상 정도",
        condition="평소 대비 배수 구간에 따라 점수 배점",
        scoring="평소의 10배 이상 25점 · 5배 이상 15점 · 2배 이상 8점 · 그 미만 0점",
    ),
    AccountSignalSpec(
        "fund_source", "최근 자금이동(해지 등)", 25, lambda i: check_fund_source(i.customer_id, i.overrides),
        rule_id="R03",
        definition="예·적금 해지 등 자금원천 이동 여부",
        condition="자금원천 이동 후 경과시간에 따라 점수 배점",
        scoring="24시간 이내 자금 이동 25점 · 없음 0점",
    ),
    AccountSignalSpec(
        "payee_freshness", "수취계좌 개설 기간", 20, lambda i: check_payee_freshness(i.payee_account),
        rule_id="R04",
        definition="수취계좌 개설 후 경과일수",
        condition="개설 경과일 구간에 따라 점수 배점",
        scoring="개설 7일 이내 20점 · 30일 이내 10점 · 그 이후 0점 (개설일 확인 불가는 신규로 보고 20점)",
    ),
    AccountSignalSpec(
        "limit_change", "이체한도 변경 이력", 20, lambda i: check_limit_change(i.customer_id, i.overrides),
        rule_id="R05",
        definition="최근 이체한도 상향 이력",
        condition="최근 한도상향 이력 유무에 따라 점수 배점",
        scoring="24시간 이내 한도 상향 20점 · 없음 0점",
    ),
    AccountSignalSpec(
        "velocity", "단기간 반복 이체", 20, lambda i: check_velocity(i.customer_id, i.overrides),
        rule_id="R06",
        definition="짧은 시간 내 다건 이체 또는 분할 재시도 (단시간 다건이체 + 분할이체 통합)",
        condition="단시간 내 이체(분할 포함) 건수에 따라 점수 배점",
        scoring="10분 내 3건 이상 20점 · 2건 10점 · 그 미만 0점 (분할 재시도는 건수에 포함)",
    ),
    AccountSignalSpec(
        "device", "신규 기기·환경", 15, lambda i: check_device(i.customer_id, i.overrides),
        rule_id="R07",
        definition="기기·접속위치 등 접속환경 변화 (신규기기 + 로그인위치 급변 통합)",
        condition="기기·위치 변경 이력 유무에 따라 점수 배점",
        scoring="신규 기기·환경 감지 15점 · 없음 0점",
    ),
    AccountSignalSpec(
        "time_pattern", "이용 시간대", 10, lambda i: check_time_pattern(i.current_time, i.customer_id),
        rule_id="R08",
        definition="평소와 다른 시간대 거래",
        condition="평소 거래시간대 이탈 여부에 따라 점수 배점",
        scoring="새벽 00~06시 10점 · 평소 이용시간 밖 5점 · 평소 시간대 0점",
    ),
]


def register_account_signal(spec: AccountSignalSpec) -> None:
    """신호 추가(확장 지점). 같은 이름을 두 번 넣으면 점수가 이중으로 잡히므로 막는다."""

    if any(s.name == spec.name for s in ACCOUNT_SIGNALS):
        raise ValueError(f"이미 등록된 신호: {spec.name}")
    ACCOUNT_SIGNALS.append(spec)


def run_all_account_signals(
    customer_id: str,
    payee_account: str,
    amount: int,
    current_time: str,
    overrides: ContextOverrides,
) -> list[SignalResult]:
    """1단계 등록된 신호를 항상 전량 호출한다 (SPEC 1장)."""

    inp = SignalInput(customer_id, payee_account, amount, current_time, overrides)
    return [spec.evaluate(inp) for spec in ACCOUNT_SIGNALS]
