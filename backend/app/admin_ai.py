"""관리자 페이지의 AI 설명문. 판정·제안·수치는 모두 규칙이 정하고, LLM은 그 결과를 사람이 읽기 좋게 풀어쓰기만
한다. LLM이 실패하면(키 만료·크레딧·네트워크) 호출한 쪽이 넘겨준 규칙 기반 문장(fallback)을 그대로 돌려준다."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agent import llm_status
from app.providers.llm.factory import get_llm

logger = logging.getLogger("pasugun")

_SYSTEM = (
    "당신은 보이스피싱 방지 시스템(AI파수꾼)의 본부 분석 보조입니다. 아래 JSON의 사실만 근거로 쓰고, 숫자·건수를 "
    "바꾸거나 새로 만들지 마세요. 본부 담당자가 바로 읽도록 3~4문장의 한국어 평문으로 쓰고, 마크다운·목록·머리말은 쓰지 않습니다."
)

_TASK_HINT = {
    "rule_analysis": "룰 분석 결과를 요약하고 가장 먼저 손볼 부분을 한 가지 짚어 주세요.",
    "stats_summary": "통계 분석 결과를 요약하고 주목할 점과 개선 방향을 짚어 주세요.",
    "post_check": "수취계좌 사후 분석 결과를 담당자에게 설명하고 권고 조치를 짚어 주세요.",
}


def narrate(task: str, facts: dict[str, Any], fallback: str) -> tuple[str, str]:
    """(문장, 'ok' | 'fallback')."""
    try:
        response = get_llm().chat(
            system=_SYSTEM,
            messages=[{"role": "user", "content": f"{_TASK_HINT.get(task, '아래 사실을 요약해 주세요.')}\n\n{json.dumps(facts, ensure_ascii=False)}"}],
        )
        text = "".join(b["text"] for b in response["content"] if b["type"] == "text").strip()
        if not text:
            raise ValueError("빈 응답")
        llm_status.success()
        return text, "ok"
    except Exception as e:  # 키 만료·크레딧·네트워크 — 규칙 기반 문장으로 대체
        logger.exception("admin narrate failed — using the rule-based text")
        llm_status.failure(e)
        return fallback, "fallback"
