"""Mock JSON 데이터 로더 (SPEC 2장). 프로토타입은 파일을 그대로 메모리에 올려 조회한다."""

import json
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


@lru_cache
def scenarios() -> list[dict[str, Any]]:
    return _load("scenarios.json")


def get_customer(customer_id: str) -> dict[str, Any]:
    customer = customers().get(customer_id)
    if customer is None:
        raise KeyError(f"unknown customer_id: {customer_id}")
    return customer


def get_payee(payee_account: str) -> dict[str, Any]:
    payee = payees().get(payee_account)
    if payee is None:
        # 미등록 신규계좌: 사기이력 없음, 개설일 정보 없음(신규로 취급)
        return {
            "payee_account": payee_account,
            "payee_bank": "미상",
            "payee_name": "미상",
            "is_fraud_reported": False,
            "fraud_report_count": 0,
            "account_age_days": 9999,
        }
    return payee
