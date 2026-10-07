"""룰 설정(임계치·배점) — 본부 관리자 페이지에서 조정하고, 실제 점수 계산이 이 값을 읽는다.

설정은 JSON으로 그대로 오가는 dict 하나다(프론트의 영향 미리보기와 같은 구조):

    {"global": {"account_mid": 30, ...},
     "rules": {"amount_anomaly": {"enabled": true, "params": {"ratio_high": 10, ...}}, ...}}

기본값은 SPEC 4장 그대로라, 아무도 설정을 바꾸지 않으면 기존 동작·테스트 결과와 완전히 같다.
각 파라미터의 이름·단위·허용 범위는 PARAM_SCHEMA에 한곳에 모아 두고, 화면은 그 스키마만 보고 입력
폼을 그린다 — 룰이 늘어도 화면 코드는 그대로다. 프로토타입이라 설정·변경 이력은 프로세스 메모리에 둔다.
"""

from __future__ import annotations

import copy
import threading
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from app.models import KST


@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    default: float
    min: float
    max: float
    step: float = 1
    unit: str = ""  # "점" | "일" | "건" | "배" | "시" | ""
    kind: str = "threshold"  # "score"(배점) | "threshold"(임계치)
    help: str = ""


def _score(key: str, label: str, default: int, help: str = "") -> ParamSpec:
    return ParamSpec(key, label, default, 0, 100, 1, "점", "score", help)


# 룰별 조정 가능한 파라미터. 키 이름은 신호(룰) 이름(account_signals의 AccountSignalSpec.name)과 같다.
RULE_PARAMS: dict[str, list[ParamSpec]] = {
    "payee_fraud": [
        _score("score", "사기신고 이력 있을 때 배점", 40, "신고 이력이 하나라도 있으면 이 점수를 줘요."),
    ],
    "amount_anomaly": [
        ParamSpec("ratio_high", "고위험 배수(이상)", 10, 1.5, 100, 0.5, "배", help="평소 평균 이체액의 몇 배부터 고위험으로 볼지"),
        _score("score_high", "고위험 배점", 25),
        ParamSpec("ratio_mid", "중위험 배수(이상)", 5, 1.2, 100, 0.5, "배"),
        _score("score_mid", "중위험 배점", 15),
        ParamSpec("ratio_low", "저위험 배수(이상)", 2, 1.1, 100, 0.5, "배"),
        _score("score_low", "저위험 배점", 8),
    ],
    "fund_source": [
        _score("score", "24시간 내 자금 이동 시 배점", 25),
    ],
    "payee_freshness": [
        ParamSpec("days_new", "신규 계좌 기준(일 이내)", 7, 1, 365, 1, "일", help="개설 후 이 기간 이내면 신규 계좌"),
        _score("score_new", "신규 계좌 배점", 20),
        ParamSpec("days_recent", "최근 개설 기준(일 이내)", 30, 2, 730, 1, "일"),
        _score("score_recent", "최근 개설 배점", 10),
        _score("score_unknown", "개설일 확인 불가 시 배점", 20, "개설일을 알 수 없으면 신규 계좌로 보고 이 점수를 줘요."),
    ],
    "limit_change": [
        _score("score", "24시간 내 한도 상향 시 배점", 20),
    ],
    "velocity": [
        ParamSpec("count_high", "다건 이체 기준(건 이상)", 3, 2, 50, 1, "건", help="10분 내 이 건수 이상이면 고위험"),
        _score("score_high", "다건 이체 배점", 20),
        ParamSpec("count_mid", "반복 이체 기준(건 이상)", 2, 2, 50, 1, "건"),
        _score("score_mid", "반복 이체 배점", 10),
    ],
    "device": [
        _score("score", "신규 기기·환경 감지 시 배점", 15),
    ],
    "time_pattern": [
        ParamSpec("dawn_start", "새벽 시작 시각", 0, 0, 23, 1, "시"),
        ParamSpec("dawn_end", "새벽 종료 시각(미만)", 6, 1, 24, 1, "시"),
        _score("score_dawn", "새벽 시간대 배점", 10),
        _score("score_off_hours", "평소 이용시간 밖 배점", 5),
    ],
}

# 전역 임계치: 등급 경계, RAG 유사도, 대화 개입 강도.
GLOBAL_PARAMS: list[ParamSpec] = [
    ParamSpec("account_mid", "송금위험 '중' 시작 점수", 30, 1, 200, 1, "점", help="1단계 총점이 이 점수 이상이면 '중'"),
    ParamSpec("account_high", "송금위험 '고' 시작 점수", 60, 2, 300, 1, "점"),
    ParamSpec("context_mid", "AI분석 '중' 시작 점수", 25, 1, 200, 1, "점", help="2단계 총점이 이 점수 이상이면 '중'"),
    ParamSpec("context_high", "AI분석 '고' 시작 점수", 50, 2, 300, 1, "점"),
    ParamSpec("rag_mid_sim", "RAG 유사 사례 인정 유사도", 0.60, 0.3, 0.99, 0.01, "", help="사례집과 이 값 이상 비슷해야 '매칭'으로 봐요"),
    ParamSpec("rag_mid_score", "RAG 매칭 배점(유사)", 30, 0, 100, 1, "점", "score"),
    ParamSpec("rag_high_sim", "RAG 강한 매칭 유사도", 0.80, 0.31, 1.0, 0.01, ""),
    ParamSpec("rag_high_score", "RAG 강한 매칭 배점", 50, 0, 100, 1, "점", "score"),
    ParamSpec("intervene_question", "AI 질문을 시작하는 1단계 점수", 25, 0, 200, 1, "점", help="이 점수 미만이면 질문 없이 확인 1탭으로 끝나요"),
    ParamSpec("intervene_safety", "안전 질문까지 묻는 1단계 점수", 60, 1, 300, 1, "점"),
]

# 값 사이의 순서 제약: (왼쪽 키) < (오른쪽 키) — 어기면 등급·구간이 뒤집혀 의미가 사라진다.
_ORDER_RULES: dict[str, list[tuple[str, str, bool]]] = {
    # (작은 쪽, 큰 쪽, 같아도 되는지)
    "amount_anomaly": [("ratio_low", "ratio_mid", False), ("ratio_mid", "ratio_high", False), ("score_low", "score_mid", True), ("score_mid", "score_high", True)],
    "payee_freshness": [("days_new", "days_recent", False), ("score_recent", "score_new", True)],
    "velocity": [("count_mid", "count_high", False), ("score_mid", "score_high", True)],
    "time_pattern": [("dawn_start", "dawn_end", False), ("score_off_hours", "score_dawn", True)],
}
_GLOBAL_ORDER: list[tuple[str, str, bool]] = [
    ("account_mid", "account_high", False),
    ("context_mid", "context_high", False),
    ("rag_mid_sim", "rag_high_sim", False),
    ("rag_mid_score", "rag_high_score", True),
    ("intervene_question", "intervene_safety", False),
]


def _defaults() -> dict[str, Any]:
    return {
        "global": {p.key: p.default for p in GLOBAL_PARAMS},
        "rules": {
            name: {"enabled": True, "params": {p.key: p.default for p in params}}
            for name, params in RULE_PARAMS.items()
        },
    }


DEFAULT_CONFIG: dict[str, Any] = _defaults()


def _spec_map(params: list[ParamSpec]) -> dict[str, ParamSpec]:
    return {p.key: p for p in params}


class RuleConfig:
    """설정 dict를 읽기 쉽게 감싼 값 객체. 점수 계산 코드는 이것만 본다."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        self._d = copy.deepcopy(data) if data is not None else copy.deepcopy(DEFAULT_CONFIG)

    def g(self, key: str) -> float:
        return self._d["global"][key]

    def has_rule(self, rule: str) -> bool:
        return rule in self._d["rules"]

    def enabled(self, rule: str) -> bool:
        return bool(self._d["rules"].get(rule, {}).get("enabled", True))

    def p(self, rule: str, key: str) -> float:
        return self._d["rules"][rule]["params"][key]

    def max_score(self, rule: str) -> int:
        """이 룰이 줄 수 있는 최대 점수(= 배점 파라미터 중 가장 큰 값). 꺼져 있으면 0."""
        if not self.enabled(rule):
            return 0
        scores = [self.p(rule, s.key) for s in RULE_PARAMS[rule] if s.kind == "score"]
        return int(max(scores)) if scores else 0

    def to_dict(self) -> dict[str, Any]:
        return copy.deepcopy(self._d)


def validate_config(data: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """들어온 설정을 검사하고, 빠진 항목은 기본값으로 채운 완성본을 돌려준다. 오류 메시지는 화면에 그대로 보여준다."""
    errors: list[str] = []
    if not isinstance(data, dict):
        return None, ["설정 형식이 올바르지 않아요."]

    merged = copy.deepcopy(DEFAULT_CONFIG)

    def read_params(section: dict[str, Any], specs: list[ParamSpec], label_prefix: str, out: dict[str, Any]) -> None:
        by_key = _spec_map(specs)
        for key, value in section.items():
            if key not in by_key:
                errors.append(f"{label_prefix}알 수 없는 항목이에요: {key}")
                continue
            spec = by_key[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                errors.append(f"{label_prefix}{spec.label}: 숫자를 입력해주세요.")
                continue
            if not spec.min <= value <= spec.max:
                lo, hi = _fmt(spec.min), _fmt(spec.max)
                errors.append(f"{label_prefix}{spec.label}: {lo}~{hi}{spec.unit} 범위여야 해요.")
                continue
            out[key] = int(value) if float(value).is_integer() and spec.step >= 1 else float(value)

    read_params(data.get("global", {}) or {}, GLOBAL_PARAMS, "전역 · ", merged["global"])

    rules_in = data.get("rules", {}) or {}
    for name, body in rules_in.items():
        if name not in RULE_PARAMS:
            errors.append(f"알 수 없는 룰이에요: {name}")
            continue
        if not isinstance(body, dict):
            errors.append(f"{name}: 설정 형식이 올바르지 않아요.")
            continue
        if "enabled" in body:
            merged["rules"][name]["enabled"] = bool(body["enabled"])
        read_params(body.get("params", {}) or {}, RULE_PARAMS[name], f"{name} · ", merged["rules"][name]["params"])

    if not errors:
        labels = {name: _spec_map(specs) for name, specs in RULE_PARAMS.items()}
        for name, orders in _ORDER_RULES.items():
            params = merged["rules"][name]["params"]
            for small, big, equal_ok in orders:
                ok = params[small] <= params[big] if equal_ok else params[small] < params[big]
                if not ok:
                    errors.append(
                        f"{name} · {labels[name][small].label}({_fmt(params[small])})은(는) "
                        f"{labels[name][big].label}({_fmt(params[big])})보다 {'크지 않아야' if equal_ok else '작아야'} 해요."
                    )
        gl = _spec_map(GLOBAL_PARAMS)
        for small, big, equal_ok in _GLOBAL_ORDER:
            a, b = merged["global"][small], merged["global"][big]
            if not (a <= b if equal_ok else a < b):
                errors.append(f"전역 · {gl[small].label}({_fmt(a)})은(는) {gl[big].label}({_fmt(b)})보다 {'크지 않아야' if equal_ok else '작아야'} 해요.")

    return (None, errors) if errors else (merged, [])


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def diff_configs(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, Any]]:
    """변경 이력에 남길 항목별 변경 내용(경로, 이전 값, 새 값, 사람이 읽는 이름)."""
    changes: list[dict[str, Any]] = []
    gl = _spec_map(GLOBAL_PARAMS)
    for key, spec in gl.items():
        if old["global"][key] != new["global"][key]:
            changes.append({"path": f"global.{key}", "label": f"전역 · {spec.label}", "from": old["global"][key], "to": new["global"][key]})
    for name, specs in RULE_PARAMS.items():
        if old["rules"][name]["enabled"] != new["rules"][name]["enabled"]:
            changes.append({"path": f"rules.{name}.enabled", "label": f"{name} · 사용 여부", "from": old["rules"][name]["enabled"], "to": new["rules"][name]["enabled"]})
        for spec in specs:
            a, b = old["rules"][name]["params"][spec.key], new["rules"][name]["params"][spec.key]
            if a != b:
                changes.append({"path": f"rules.{name}.params.{spec.key}", "label": f"{name} · {spec.label}", "from": a, "to": b})
    return changes


class RuleConfigStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._config = RuleConfig()
        self._history: list[dict[str, Any]] = []
        self._version = 1

    def get(self) -> RuleConfig:
        with self._lock:
            return self._config

    @property
    def version(self) -> int:
        return self._version

    def history(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(reversed(self._history))

    def update(self, data: Any, actor: str = "본부 담당자", note: str = "") -> tuple[bool, list[str], list[dict[str, Any]]]:
        merged, errors = validate_config(data)
        if errors or merged is None:
            return False, errors, []
        with self._lock:
            changes = diff_configs(self._config.to_dict(), merged)
            if not changes:
                return True, [], []
            self._config = RuleConfig(merged)
            self._version += 1
            self._history.append(self._entry(actor, note, changes))
            return True, [], changes

    def reset(self, actor: str = "본부 담당자") -> list[dict[str, Any]]:
        with self._lock:
            changes = diff_configs(self._config.to_dict(), DEFAULT_CONFIG)
            self._config = RuleConfig()
            if changes:
                self._version += 1
                self._history.append(self._entry(actor, "기본값(SPEC)으로 복원", changes))
            return changes

    def _entry(self, actor: str, note: str, changes: list[dict[str, Any]]) -> dict[str, Any]:
        first = changes[0]
        more = f" 외 {len(changes) - 1}건" if len(changes) > 1 else ""
        return {
            "id": f"CFG-{self._version:04d}",
            "version": self._version,
            "at": datetime.now(KST).isoformat(timespec="seconds"),
            "actor": actor,
            "note": note,
            "summary": f"{first['label']}: {_fmt_any(first['from'])} → {_fmt_any(first['to'])}{more}",
            "changes": changes,
        }


def _fmt_any(v: Any) -> str:
    if isinstance(v, bool):
        return "사용" if v else "중지"
    return _fmt(v) if isinstance(v, (int, float)) else str(v)


_store = RuleConfigStore()


def get_rule_config() -> RuleConfig:
    return _store.get()


def get_rule_config_store() -> RuleConfigStore:
    return _store


def reset_rule_config() -> None:
    """테스트·재시작용: 설정과 변경 이력을 모두 처음 상태로."""
    global _store
    _store = RuleConfigStore()


def param_schema() -> dict[str, Any]:
    """프론트 입력 폼용 스키마(룰별 파라미터 + 전역 파라미터)."""
    return {
        "rules": {name: [asdict(p) for p in params] for name, params in RULE_PARAMS.items()},
        "global": [asdict(p) for p in GLOBAL_PARAMS],
    }
