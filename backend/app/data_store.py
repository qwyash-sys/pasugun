"""Mock JSON 데이터 로더 (SPEC 2장). 프로토타입은 파일을 그대로 메모리에 올려 조회한다."""

import json
import re
from functools import lru_cache
from typing import Any

from app.config import MOCK_DATA_DIR


def _load(filename: str) -> list[dict[str, Any]]:
    path = MOCK_DATA_DIR / filename
    with path.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def customers() -> dict[str, dict[str, Any]]:
    return {c["customer_id"]: c for c in _load("customers.json")}


@lru_cache
def payees() -> dict[str, dict[str, Any]]:
    return {p["payee_account"]: p for p in _load("payees.json")}


def _digits(account: str) -> str:
    return re.sub(r"\D", "", account)


@lru_cache
def payees_by_digits() -> dict[str, dict[str, Any]]:
    # 고객은 하이픈 없이(또는 다른 위치에) 계좌번호를 치는 경우가 많다 — 숫자만으로도 찾는다.
    return {_digits(p["payee_account"]): p for p in _load("payees.json")}


@lru_cache
def scenarios() -> list[dict[str, Any]]:
    return _load("scenarios.json")


def get_customer(customer_id: str) -> dict[str, Any]:
    customer = customers().get(customer_id)
    if customer is None:
        raise KeyError(f"unknown customer_id: {customer_id}")
    return customer


def get_payee(payee_account: str) -> dict[str, Any]:
    payee = payees().get(payee_account) or payees_by_digits().get(_digits(payee_account))
    if payee is None:
        # 미등록 계좌: 예금주를 확인할 수 없다(verified=False). 사기신고 이력은 없지만 개설일을 알 수
        # 없으니 신규 계좌로 취급한다(account_age_days=None) — 확인 못 한 계좌를 오래된 안전 계좌로 보면 안 된다.
        return {
            "payee_account": payee_account,
            "payee_bank": "미상",
            "payee_name": "미상",
            "is_fraud_reported": False,
            "fraud_report_count": 0,
            "account_age_days": None,
            "verified": False,
        }
    return {**payee, "verified": True}
