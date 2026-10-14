"""R06(분할 재시도)·R07(접속 위치 급변) 보강과 R09~R11(잔액소진율·신규 수취인 급증·다수입금 집중) 구현 확인."""

from app.models import ContextOverrides
from app.tools.account_signals import run_all_account_signals

NOW = "2026-08-12T15:00:00+09:00"


def _s(customer="C001", payee="301-8827-4491", amount=1_000_000, **ov):
    return {s.signal: s for s in run_all_account_signals(customer, payee, amount, NOW, ContextOverrides(**ov))}


def test_r06_counts_split_retries_together_with_rapid_transfers():
    assert _s()["velocity"].score == 0
    s = _s(velocity_recent_count=1, split_retry_count=2)["velocity"]
    assert s.score == 20 and s.value == 3 and "분할 재시도 2건" in s.detail


def test_r07_flags_a_login_from_an_unusual_region():
    assert _s(login_region="서울 강남구")["device"].score == 0  # 평소 지역과 같으면 정상
    s = _s(login_region="해외(필리핀)")["device"]
    assert s.score == 15 and "접속 위치 급변" in s.detail


def test_r09_balance_drain_by_share_of_balance():
    assert _s(amount=1_000_000)["balance_drain"].score == 0  # 잔액 805만원 중 12%
    assert _s(amount=6_000_000)["balance_drain"].score == 8  # 75%
    s = _s(amount=20_000_000)["balance_drain"]  # 잔액보다 큰 금액(해지 자금 유입 후)
    assert s.score == 15 and s.value > 100


def test_r10_new_payee_surge_counts_this_transfer():
    assert _s()["new_payee"].score == 0  # 처음 보내는 계좌 1명뿐
    assert _s(new_payees_7d=1)["new_payee"].score == 8
    assert _s(new_payees_7d=4)["new_payee"].score == 15


def test_r11_inbound_concentration_on_mule_accounts():
    assert _s(payee="010-6691-98217")["inbound_concentration"].score == 20  # 24시간 12명 입금
    assert _s(payee="552-102-993917")["inbound_concentration"].score == 0
