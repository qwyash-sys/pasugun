"""관리자 리포트 목록용 과거 리포트 목업 생성기.

손으로 숫자를 지어내지 않고, 시드 고정 난수로 만든 가상 이체 시도를 실제 1·2·3단계 엔진
(계좌 신호 8종 → 맥락 점수 + 로컬 RAG → 매트릭스)에 그대로 통과시켜 '위험' 판정이 난 것만
리포트로 남긴다 — 그래서 목록/상세의 점수·등급·RAG 후보가 서로 모순되지 않는다.
LLM은 부르지 않는다(대화 요약은 템플릿 문장).

같은 결과를 백엔드(mock_data)와 프론트 데모(demoData, Vercel엔 백엔드가 없으므로)에 함께 쓴다.

    cd backend && python scripts/generate_report_history.py
"""

import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.aggregator import calculate_final_risk, intervention_intensity  # noqa: E402
from app.data_store import customers, get_customer, get_payee, payees  # noqa: E402
from app.models import AccountAssessment, ContextAnswer, ContextOverrides  # noqa: E402
from app.providers.rag.faiss_provider import FaissLocalRagProvider  # noqa: E402
from app.questions import SAFETY_QUESTION, questions_for  # noqa: E402
from app.reports import build_report  # noqa: E402
from app.scoring import build_account_assessment, build_context_assessment  # noqa: E402
from app.tools.account_signals import run_all_account_signals  # noqa: E402

TARGET = 36
SEED = 20260926
KST = "+09:00"

SCAMS = {
    "기관사칭": {
        "texts": [
            "검찰청 수사관이라며 제 명의 계좌가 범죄에 쓰였다고 안전계좌로 옮기라고 했어요",
            "금융감독원 직원이라면서 자산 보호를 위해 돈을 지정 계좌로 옮겨야 한다고 했어요",
            "카드 배송기사라더니 금감원 연결해준다고 하고 원격 앱을 깔라고 했어요",
        ],
        "empathy": "normal_known",
        "safety_yes": 0.75,
        "capture": ("검찰_안내문자.jpg", ["[Web발신] 서울중앙지검 사건조회", "귀하 명의 계좌가 범죄에 연루되어", "자산 보호를 위해 안전계좌로", "금일 중 이체 바랍니다"]),
    },
    "대출사기": {
        "texts": [
            "저금리 대환대출 해준다고 해서 기존 대출 상환금을 먼저 보내려고 해요",
            "신용점수 올려준다면서 한도를 올리고 수수료를 먼저 입금하래요",
        ],
        "empathy": "risky_offer",
        "safety_yes": 0.1,
        "capture": ("대출안내_문자.png", ["[Web발신] 정부지원 저금리 대환대출", "기존 대출 선상환 확인 후", "승인금 즉시 입금 예정", "상담: 1600-XXXX"]),
    },
    "메신저피싱": {
        "texts": [
            "딸이라면서 카톡이 왔는데 폰이 고장나서 전화는 안 된대요. 급하게 돈 보내달래요",
            "아는 동생이 문자로만 연락해서 급한 돈이 필요하다고 해요",
        ],
        "empathy": "risky_text_only",
        "safety_yes": 0.05,
        "capture": ("카톡_대화캡처.jpg", ["엄마 나 폰 액정 깨져서 이걸로 연락해", "급하게 결제할 게 있는데", "이 계좌로 먼저 보내줄 수 있어?", "통화는 안 돼 문자로 해줘"]),
    },
    "원격제어형": {
        "texts": ["상담원이 앱을 설치하라고 해서 깔았더니 화면을 보면서 이체하라고 해요"],
        "empathy": "normal_known",
        "safety_yes": 0.6,
        "capture": ("원격앱_설치안내.png", ["보안 점검을 위해 아래 앱을 설치하세요", "설치 후 화면을 켠 상태로 유지", "상담원 안내에 따라 이체 진행"]),
    },
    "협박형": {
        "texts": ["아들이 사고를 쳐서 합의금을 지금 안 보내면 큰일 난다고 전화가 왔어요"],
        "empathy": "normal_known",
        "safety_yes": 0.2,
        "capture": None,
    },
    "스미싱": {
        "texts": ["택배 주소가 잘못됐다는 문자 링크를 눌렀더니 결제 확인을 하라고 해요"],
        "empathy": "normal_trade",
        "safety_yes": 0.1,
        "capture": ("택배_문자.jpg", ["[국제발신] 주소지 불명으로 반송 예정", "주소 수정: http://xx.kr/abc", "미수정 시 추가요금 발생"]),
    },
    "취업사기": {
        "texts": ["고액 알바라면서 제 통장으로 들어온 돈을 다른 계좌로 옮겨달래요"],
        "empathy": "normal_trade",
        "safety_yes": 0.05,
        "capture": None,
    },
    "없음": {"texts": [], "empathy": "normal_known", "safety_yes": 0.5, "capture": None},
}

HISTORY_PAYEES = [p["payee_account"] for p in payees().values() if "리포트 이력" in p.get("note", "")]
AMOUNTS = [500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000, 50_000_000]


class TemplateSummarizer:
    """build_report가 요구하는 agent 자리 대용 — LLM 대신 사실 요약 템플릿을 쓴다."""

    def __init__(self, text: str, capture_name: str | None):
        self._text = text
        self._capture_name = capture_name

    def summarize_for_report(self, conversation: str, rag) -> str:
        quote = self._text if len(self._text) <= 30 else self._text[:30] + "…"
        summary = f'"{quote}"라고 응답'
        if self._capture_name:
            summary += f", 캡처 1건 업로드({self._capture_name})"
        return summary


def main() -> None:
    rng = random.Random(SEED)
    rag_provider = FaissLocalRagProvider()
    customer_ids = sorted(customers().keys())
    start_day = datetime(2026, 8, 15)

    entries = []
    per_day_seq: dict[str, int] = {}

    for _ in range(2000):
        if len(entries) >= TARGET:
            break

        day = start_day + timedelta(days=rng.randint(0, 40))
        hour = rng.choice([1, 2, 3, 9, 10, 11, 13, 14, 15, 16, 19, 20, 21, 23])
        attempted = day.replace(hour=hour, minute=rng.randint(0, 59))
        current_time = attempted.strftime("%Y-%m-%dT%H:%M:00") + KST

        customer_id = rng.choice(customer_ids)
        payee_account = rng.choice(HISTORY_PAYEES)
        amount = rng.choice(AMOUNTS)
        overrides = ContextOverrides(
            fund_source_recent=rng.random() < 0.3,
            limit_changed_recent=rng.random() < 0.25,
            device_new=rng.random() < 0.2,
            velocity_recent_count=rng.choice([0, 0, 0, 2, 3]),
        )

        signals = run_all_account_signals(customer_id, payee_account, amount, current_time, overrides)
        total, level = build_account_assessment(signals)
        intervention = intervention_intensity(total)
        asked = {q["question_id"] for q in questions_for(intervention, get_customer(customer_id)["name"])}

        scam_type = rng.choice(list(SCAMS))
        scam = SCAMS[scam_type]

        answers = []
        if "empathy" in asked:
            answers.append(ContextAnswer(question_id="empathy", choice_id=scam["empathy"], choice_weight=25 if scam["empathy"].startswith("risky") else 0))
        if "safety" in asked:
            yes = rng.random() < scam["safety_yes"]
            choice = next(c for c in SAFETY_QUESTION["choices"] if c["choice_id"] == ("safety_yes" if yes else "safety_no"))
            answers.append(ContextAnswer(question_id="safety", choice_id=choice["choice_id"], choice_weight=choice["weight"], hard_override=choice["hard_override"]))

        text = rng.choice(scam["texts"]) if scam["texts"] and intervention != "confirm_only" else ""
        capture = scam["capture"] if text and scam["capture"] and rng.random() < 0.65 else None

        rag = rag_provider.scenario_rag(text) if text else None
        context = build_context_assessment(answers, bool(text), rag) if (answers or text) else None
        final = calculate_final_risk(total, level, signals, context)
        if final.final != "위험":
            continue

        account = AccountAssessment(signals=signals, total_score=total, level=level)
        customer = get_customer(customer_id)
        report = build_report(
            agent=TemplateSummarizer(text, capture[0] if capture else None),
            customer=customer,
            customer_phone=customer["phone"],
            payee=get_payee(payee_account),
            amount=amount,
            attempted_at=current_time,
            final=final,
            conversation=text,
            attachments_present=capture is not None,
            rag=rag,
            account=account,
            context=context,
        )
        key = attempted.strftime("%Y%m%d")
        per_day_seq[key] = per_day_seq.get(key, 0) + 1
        report.report_id = f"RPT-{key}-{per_day_seq[key]:03d}"
        report.generated_at = (attempted + timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:00") + KST

        entries.append(
            {
                "report": report.model_dump(mode="json", exclude={"attachments"}),
                "attachments": [{"name": capture[0], "lines": capture[1]}] if capture else [],
            }
        )

    entries.sort(key=lambda e: e["report"]["attempted_at"], reverse=True)
    body = json.dumps(entries, ensure_ascii=False, indent=1) + "\n"
    for out in (BACKEND / "mock_data" / "report_history.json", BACKEND.parent / "frontend" / "src" / "demoData" / "reportHistory.json"):
        out.write_text(body, encoding="utf-8")
        print(f"wrote {len(entries)} reports -> {out}")


if __name__ == "__main__":
    main()
