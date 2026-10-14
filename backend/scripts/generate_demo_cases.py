"""데모 시연 케이스의 점수·판정·리포트를 개발 모드 엔진으로 계산해 데모 데이터에 넣는다.

데모 모드(서버 없음)도 '개발 모드 기준의 샘플'이어야 하므로, 시연 케이스의 입력을 개발 모드와 똑같은
API 흐름(quote → answers → chat → finalize)에 그대로 흘려 1·2·3단계 결과를 받는다. 대화 응답·요약 문장만
대본 문장을 쓰고(LLM 호출 없이 매번 같은 결과), 첨부 캡처는 그 안의 글자를 OCR 결과로 넣는다.

실행 순서(케이스 대본을 바꿨거나 룰·목업 데이터를 바꿨을 때):
  1) cd frontend && npx -y tsx scripts/export-demo-inputs.mts > ../backend/scripts/demo_inputs.json
  2) cd backend && python scripts/generate_demo_cases.py   → frontend/src/demoData/engineCases.json
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

import app.routers.chat as chat_router  # noqa: E402
from app.main import app  # noqa: E402
from app.rule_config import reset_rule_config  # noqa: E402

INPUTS = BACKEND / "scripts" / "demo_inputs.json"
OUT = BACKEND.parent / "frontend" / "src" / "demoData" / "engineCases.json"


class ScriptLlm:
    """대화 턴은 '확인했어요' 수준의 짧은 응답만(판정에는 영향 없음). RAG는 finalize가 대화 전체로 직접 돌린다."""

    def chat(self, system, messages, tools=None):
        return {"content": [{"type": "text", "text": "확인했어요."}], "stop_reason": "end_turn"}


class TextOcr:
    """첨부로 보낸 '캡처 속 글자'(UTF-8)를 그대로 돌려준다 — 실제 OCR이 같은 캡처에서 읽어낼 내용."""

    def ocr_extract(self, image_bytes: bytes) -> dict:
        return {"text": image_bytes.decode("utf-8")}


def main() -> None:
    reset_rule_config()  # 기본 룰(SPEC 기준)로 계산
    chat_router.get_llm = lambda: ScriptLlm()  # type: ignore[assignment]
    chat_router.get_ocr = lambda: TextOcr()  # type: ignore[assignment]
    chat_router._decode_image = lambda a: base64.b64decode(a.base64)  # type: ignore[assignment]

    client = TestClient(app)
    cases = json.loads(INPUTS.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for c in cases:
        q = client.post(
            "/api/transfer/quote",
            json={"customer_id": c["customer_id"], "payee_account": c["payee_account"], "amount": c["amount"], "current_time": c["current_time"], "context_overrides": c["overrides"]},
        )
        q.raise_for_status()
        quote = q.json()
        sid = quote["session_id"]
        answers = [
            {"question_id": qq["question_id"], "choice_id": c["answers"].get(qq["question_id"], qq["choices"][0]["choice_id"])}
            for qq in quote["questions"]
        ]
        if answers:
            client.post(f"/api/transfer/{sid}/answers", json={"answers": answers}).raise_for_status()
            for turn in c["chat"]:
                atts = [{"name": a["name"], "base64": base64.b64encode("\n".join(a["lines"]).encode("utf-8")).decode()} for a in turn["attachments"]]
                client.post(f"/api/transfer/{sid}/chat", json={"text": turn["text"], "attachments": atts}).raise_for_status()
        f = client.post(f"/api/transfer/{sid}/finalize")
        f.raise_for_status()
        res = f.json()
        report = res.get("report")
        if report:
            report.pop("attachments", None)  # 첨부 미리보기는 데모 대본의 것을 쓴다
        out[c["id"]] = {
            "intervention": quote["intervention"],
            "questions": quote["questions"],
            "account": res["account"],
            "context": res["context"],
            "final": res["final"],
            "report": report,
        }
        ctx = res["context"]
        print(f"{c['id']} {c['title']}: 송금위험 {res['account']['total_score']}({res['account']['level']}) · AI분석 {ctx['total_score'] if ctx else '-'}({res['final']['context_level']}) → {res['final']['final']} · 질문 {len(quote['questions'])}개")

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"쓴 파일: {OUT.relative_to(BACKEND.parent)}")


if __name__ == "__main__":
    main()
