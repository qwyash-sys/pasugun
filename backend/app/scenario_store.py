"""사례집(RAG 말뭉치) 저장소 — 본부 관리자가 사례를 추가·수정·중지하면 유사 사례 검색에 바로 반영된다.

룰 설정(rule_config)과 같이 프로토타입은 메모리에 두고 서버를 다시 켜면 mock_data/scenarios.json으로
돌아간다. 실서비스에서는 DB와 결재(승인) 절차가 필요하다. RAG 색인은 version이 바뀔 때 다시 만든다.
"""

from __future__ import annotations

import copy
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.data_store import scenarios as seed_scenarios

KST = timezone(timedelta(hours=9))


def _now() -> str:
    return datetime.now(KST).isoformat(timespec="seconds")


def _clean_list(values: list[str]) -> list[str]:
    out: list[str] = []
    for v in values:
        v = v.strip()
        if v and v not in out:
            out.append(v)
    return out


class ScenarioInput(BaseModel):
    """관리자가 입력하는 사례 한 건. id·이력은 서버가 붙인다."""

    유형: str = Field(min_length=1, max_length=20)
    중분류: str = Field(min_length=1, max_length=40)
    수법요약: str = Field(min_length=10, max_length=600)
    범인멘트: list[str] = Field(min_length=1, max_length=12)
    위험신호: list[str] = Field(min_length=1, max_length=10)
    위험도: Literal["고", "중", "저"] = "고"
    출처: str = Field(default="본부 등록", max_length=60)
    enabled: bool = True

    @field_validator("유형", "중분류", "수법요약", "출처")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("비어 있을 수 없어요")
        return v

    @field_validator("범인멘트", "위험신호")
    @classmethod
    def _items(cls, v: list[str]) -> list[str]:
        v = _clean_list(v)
        if not v:
            raise ValueError("한 개 이상 입력해 주세요")
        if any(len(x) > 120 for x in v):
            raise ValueError("한 줄은 120자 이내로 입력해 주세요")
        return v


class ScenarioStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: list[dict[str, Any]] = [
            {**copy.deepcopy(s), "enabled": True, "updated_at": None, "updated_by": None} for s in seed_scenarios()
        ]
        self._version = 1
        self._history: list[dict[str, Any]] = []

    @property
    def version(self) -> int:
        return self._version

    def all(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._items)

    def active(self) -> list[dict[str, Any]]:
        return [s for s in self.all() if s.get("enabled", True)]

    def get(self, scenario_id: str) -> dict[str, Any] | None:
        return next((copy.deepcopy(s) for s in self._items if s["id"] == scenario_id), None)

    def history(self) -> list[dict[str, Any]]:
        return list(reversed(self._history))

    def _next_id(self) -> str:
        nums = [int(s["id"][1:]) for s in self._items if s["id"][1:].isdigit()]
        return f"S{(max(nums, default=0) + 1):02d}"

    def create(self, data: ScenarioInput, actor: str = "본부 담당자", note: str = "") -> dict[str, Any]:
        with self._lock:
            doc = {"id": self._next_id(), **data.model_dump(), "updated_at": _now(), "updated_by": actor}
            self._items.append(doc)
            self._bump(actor, note, doc["id"], "등록", f"{doc['유형']} · {doc['중분류']} 사례 등록")
            return copy.deepcopy(doc)

    def update(self, scenario_id: str, data: ScenarioInput, actor: str = "본부 담당자", note: str = "") -> dict[str, Any] | None:
        with self._lock:
            idx = next((i for i, s in enumerate(self._items) if s["id"] == scenario_id), None)
            if idx is None:
                return None
            old = self._items[idx]
            new = {**old, **data.model_dump(), "updated_at": _now(), "updated_by": actor}
            fields = [k for k in ScenarioInput.model_fields if old.get(k) != new.get(k)]
            if not fields:
                return copy.deepcopy(old)
            self._items[idx] = new
            if fields == ["enabled"]:
                action, summary = ("사용", "검색에 다시 사용") if new["enabled"] else ("중지", "검색에서 제외")
            else:
                action, summary = "수정", "수정: " + ", ".join(fields)
            self._bump(actor, note, scenario_id, action, summary)
            return copy.deepcopy(new)

    def _bump(self, actor: str, note: str, scenario_id: str, action: str, summary: str) -> None:
        self._version += 1
        self._history.append(
            {"version": self._version, "at": _now(), "actor": actor, "note": note, "scenario_id": scenario_id, "action": action, "summary": summary}
        )


_store: ScenarioStore | None = None


def get_scenario_store() -> ScenarioStore:
    global _store
    if _store is None:
        _store = ScenarioStore()
    return _store


def reset_scenario_store() -> None:
    global _store
    _store = None
