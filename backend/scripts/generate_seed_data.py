"""관리자 페이지(룰 관리·모니터링·통계 분석)에 쓰는 가상 이력 데이터 생성기.

손으로 숫자를 지어내지 않고, 시드 고정 난수로 만든 가상 이체 시도를 실제 1·2·3단계 엔진(룰 설정 포함)에
그대로 통과시킨다 — 그래서 점수·등급·RAG 후보가 서로 모순되지 않는다. LLM은 부르지 않는다.

만드는 것
  backend/mock_data/transfer_logs.json   모든 판정(안전·주의·위험)의 로그 — 통계·룰 분석의 재료
  backend/mock_data/report_history.json  위험 판정 건의 영업점 연계 리포트
  backend/mock_data/cases.json           위험 건을 본부가 처리한 모니터링 사례(내방/지연송금/이탈/대기)
  frontend/src/demoData/...              같은 내용을 Vercel 데모(백엔드 없음)가 읽는 복사본 + 룰 스키마·사례집·영업점
  frontend/src/admin/__golden__/rescore.json  룰 설정을 바꿔 실제 엔진에 다시 돌린 정답지(프론트의 재채점 검증용)

고객·계좌·이름은 모두 가상이다. 사기 여부(truth)는 합성 데이터라 생성 시점에 알고 있는 정답이며,
실제 운영에서는 모니터링 사례의 최종 결과로 채워진다.

    cd backend && python scripts/generate_seed_data.py
"""

from __future__ import annotations

import copy
import json
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app import rule_config  # noqa: E402
from app.aggregator import calculate_final_risk, intervention_intensity  # noqa: E402
from app.case_store import (  # noqa: E402
    CaseDoc, DelayedInfo, Decision, Interview, MailInfo, Person, PostCheck, Reconfirm, TimelineEvent, VisitInfo,
    branches, severity_of,
)
from app.data_store import customers, get_customer, get_payee, payees, scenarios  # noqa: E402
from app.models import KST, AccountAssessment, ContextAnswer, ContextOverrides  # noqa: E402
from app.payee_activity import analyze_activity, make_activity  # noqa: E402
from app.providers.rag.faiss_provider import FaissLocalRagProvider  # noqa: E402
from app.questions import SAFETY_QUESTION, empathy_question  # noqa: E402
from app.reports import build_report  # noqa: E402
from app.routers.admin import _rules_state  # noqa: E402
from app.scoring import build_account_assessment, build_context_assessment  # noqa: E402
from app.tools.account_signals import run_all_account_signals  # noqa: E402
from app.transfer_log import build_log  # noqa: E402

SEED = 20261007
TARGET_LOGS = 400
START_DAY = datetime(2026, 8, 15)
SPAN_DAYS = 41
FRONT = BACKEND.parent / "frontend" / "src"

# ---------------------------------------------------------------- 사기 유형별 대본
SCAMS: dict[str, dict] = {
    "기관사칭": {
        "texts": [
            "검찰청 수사관이라며 제 명의 계좌가 범죄에 쓰였다고 안전계좌로 옮기라고 했어요",
            "금융감독원 직원이라면서 자산 보호를 위해 돈을 지정 계좌로 옮겨야 한다고 했어요",
            "카드 발급 안 했는데 배송 온다고 해서 전화했더니 금감원으로 연결해줬어요",
        ],
        "empathy": "normal_known", "safety_yes": 0.75,
        "captures": [
            ("검찰_안내문자.jpg", ["[Web발신] 서울중앙지검 사건조회", "귀하 명의 계좌가 범죄에 연루되어", "자산 보호를 위해 안전계좌로", "금일 중 이체 바랍니다"]),
            ("사건공문_사진.jpg", ["서울중앙지방검찰청", "사건번호 2026형제XXXXX호", "피의자 명의 계좌 범죄 연루", "자산 동결 전 보호조치 요망"]),
            ("통화목록_캡처.png", ["02-XXXX-XXXX (수사관)", "오늘 오전 10:12 · 통화 42분", "02-XXXX-XXXX (금감원 팀장)", "오늘 오전 11:03 · 통화 18분"]),
        ],
    },
    "대출사기": {
        "texts": [
            "저금리 대환대출 해준다고 해서 기존 대출 상환금을 먼저 보내려고 해요",
            "신용점수 올려준다면서 한도를 올리고 수수료를 먼저 입금하래요",
        ],
        "empathy": "risky_offer", "safety_yes": 0.1,
        "captures": [
            ("대출안내_문자.png", ["[Web발신] 정부지원 저금리 대환대출", "기존 대출 선상환 확인 후", "승인금 즉시 입금 예정", "상담: 1600-XXXX"]),
            ("대출승인_안내서.jpg", ["대출 승인 예정 안내", "승인 한도 30,000,000원 / 연 3.2%", "기존 대출 상환 확인 후 실행", "상환 계좌로 선입금 요망"]),
            ("상담원_카톡.jpg", ["오늘 오후 3시 전까지 입금하셔야", "승인이 유지됩니다", "입금 후 캡처 보내주세요"]),
        ],
    },
    "메신저피싱": {
        "texts": [
            "딸이라면서 카톡이 왔는데 폰이 고장나서 전화는 안 된대요. 급하게 돈 보내달래요",
            "아는 동생이 문자로만 연락해서 급한 돈이 필요하다고 해요",
        ],
        "empathy": "risky_text_only", "safety_yes": 0.05,
        "captures": [
            ("카톡_대화캡처.jpg", ["엄마 나 폰 액정 깨져서 이걸로 연락해", "급하게 결제할 게 있는데", "이 계좌로 먼저 보내줄 수 있어?", "통화는 안 돼 문자로 해줘"]),
            ("프로필_캡처.jpg", ["프로필 사진 없음", "상태메시지: 폰 수리중", "친구 추가 안 된 사용자"]),
            ("계좌안내_캡처.jpg", ["이 계좌로 보내줘 (친구 계좌야)", "OO은행 XXX-XXXX-XXXX", "보내고 바로 말해줘"]),
        ],
    },
    "원격제어형": {
        "texts": ["상담원이 앱을 설치하라고 해서 깔았더니 화면을 보면서 이체하라고 해요"],
        "empathy": "normal_known", "safety_yes": 0.6,
        "captures": [
            ("원격앱_설치안내.png", ["보안 점검을 위해 아래 앱을 설치하세요", "설치 후 화면을 켠 상태로 유지", "상담원 안내에 따라 이체 진행"]),
            ("앱설치_화면.png", ["원격 지원 앱 설치 완료", "화면 공유 권한: 허용됨", "연결 코드: XXX-XXX"]),
        ],
    },
    "협박형": {
        "texts": [
            "아들이 사고를 쳐서 합의금을 지금 안 보내면 큰일 난다고 전화가 왔어요",
            "딸을 데리고 있다며 경찰에 알리면 안 된다고 돈을 보내라고 협박해요",
        ],
        "empathy": "normal_known", "safety_yes": 0.2,
        "captures": [
            ("협박문자_캡처.jpg", ["아드님이 사고를 냈습니다", "합의금 입금 전까지 연락 금지", "경찰에 알리면 일이 커집니다"]),
            ("통화녹음_목록.png", ["발신번호 표시제한 · 통화 23분", "발신번호 표시제한 · 통화 9분"]),
        ],
    },
    "스미싱": {
        "texts": ["택배 주소가 잘못됐다는 문자 링크를 눌렀더니 결제 확인을 하라고 해요"],
        "empathy": "normal_trade", "safety_yes": 0.1,
        "captures": [
            ("택배_문자.jpg", ["[국제발신] 주소지 불명으로 반송 예정", "주소 수정: http://xx.kr/abc", "미수정 시 추가요금 발생"]),
            ("결제확인_화면.png", ["주소 변경 수수료 결제", "본인 확인을 위해 계좌 이체 필요", "결제 금액 확인 후 진행"]),
        ],
    },
    "취업사기": {
        "texts": ["고액 알바라면서 제 통장으로 들어온 돈을 다른 계좌로 옮겨달래요"],
        "empathy": "normal_trade", "safety_yes": 0.05,
        "captures": [("구인글_캡처.jpg", ["재택 고액 알바 모집 (일당 30만원)", "통장만 있으면 누구나 가능", "입금된 돈 지정 계좌로 전달"])],
    },
    "몸캠피싱": {
        "texts": ["영상통화하다가 녹화됐다며 지인들에게 영상을 뿌리겠다고 돈을 보내래요"],
        "empathy": "normal_known", "safety_yes": 0.1,
        "captures": [("협박_메신저.jpg", ["영상 전부 녹화했다", "30분 안에 입금 안 하면 지인에게 전송", "계좌번호는 아래와 같다"])],
    },
}

BENIGN_TEXTS = [
    "이번 달 월세 집주인한테 보내는 거예요", "중고 거래 대금이에요", "친구한테 빌린 돈 갚는 거예요",
    "부모님 용돈 보내드려요", "학원비 납부예요", "인테리어 계약금이에요", "모임 회비 보내요",
]

SCAM_WEIGHTS = {
    "senior": {"기관사칭": 38, "협박형": 14, "메신저피싱": 20, "원격제어형": 12, "스미싱": 6, "대출사기": 8, "몸캠피싱": 2},
    "mid": {"메신저피싱": 26, "기관사칭": 22, "대출사기": 18, "협박형": 10, "스미싱": 10, "원격제어형": 10, "취업사기": 2, "몸캠피싱": 2},
    "thirties": {"대출사기": 28, "메신저피싱": 18, "기관사칭": 14, "취업사기": 14, "스미싱": 10, "원격제어형": 10, "협박형": 4, "몸캠피싱": 2},
    "young": {"취업사기": 28, "스미싱": 20, "몸캠피싱": 18, "대출사기": 14, "메신저피싱": 10, "기관사칭": 6, "원격제어형": 2, "협박형": 2},
}

REGION_BRANCH = {
    "서울 강남구": "강남역지점", "서울 마포구": "마포중앙지점", "경기 성남시": "성남분당지점", "서울 서초구": "양재남지점",
    "부산 해운대구": "해운대지점", "인천 연수구": "인천연수지점", "대구 수성구": "수성지점", "대전 유성구": "대전둔산지점",
    "광주 북구": "광주상무지점", "서울 관악구": "양재남지점", "경기 수원시": "수원영통지점", "경기 용인시": "성남분당지점",
    "울산 남구": "해운대지점", "서울 송파구": "송파지점", "경북 포항시": "수성지점", "충남 천안시": "대전둔산지점",
    "경남 창원시": "해운대지점", "서울 노원구": "마포중앙지점", "전북 전주시": "전주완산지점", "부산 사하구": "해운대지점",
    "충북 청주시": "대전둔산지점", "강원 춘천시": "송파지점", "제주 제주시": "광주상무지점", "경기 고양시": "마포중앙지점",
}

INTERVIEW_LABEL = {"fraud_signs": "보이스피싱 정황 확인", "normal": "정상 거래 확인", "no_show": "고객 미내방"}

HQ_STAFF = [Person(name="구하늘", title="본부 모니터링 담당"), Person(name="남기준", title="본부 모니터링 담당"), Person(name="도세영", title="본부 모니터링 팀장")]


class TemplateSummarizer:
    """build_report가 요구하는 agent 자리 대용 — LLM 대신 사실 요약 템플릿을 쓴다."""

    def __init__(self, text: str, capture_names: list[str]):
        self._text, self._names = text, capture_names

    def summarize_for_report(self, conversation: str, rag) -> str:
        quote = self._text if len(self._text) <= 30 else self._text[:30] + "…"
        summary = f'"{quote}"라고 응답'
        if self._names:
            summary += f", 캡처 {len(self._names)}건 업로드({', '.join(self._names)})"
        return summary


# ---------------------------------------------------------------- 이체 시뮬레이션
@dataclass
class Tx:
    customer_id: str
    at: datetime
    amount: int
    payee_account: str
    overrides: ContextOverrides
    is_fraud: bool
    scam: str | None
    emp: ContextAnswer | None
    safety: ContextAnswer | None
    text: str
    captures: list[tuple[str, list[str]]] = field(default_factory=list)
    # 결과
    out: dict = field(default_factory=dict)


def _choice(question: dict, choice_id: str) -> ContextAnswer:
    c = next(c for c in question["choices"] if c["choice_id"] == choice_id)
    return ContextAnswer(question_id=question["question_id"], choice_id=choice_id, choice_weight=c["weight"], hard_override=c["hard_override"])


def pick_scam(rng: random.Random, age: int) -> str:
    table = SCAM_WEIGHTS["senior" if age >= 60 else "mid" if age >= 40 else "thirties" if age >= 30 else "young"]
    return rng.choices(list(table), weights=list(table.values()))[0]


def sample_tx(rng: random.Random, customer_ids: list[str], pools: dict[str, list[str]]) -> Tx:
    customer_id = rng.choice(customer_ids)
    customer = get_customer(customer_id)
    age = customer["profile"]["age"]
    p_fraud = 0.22 + (0.12 if age >= 65 else 0.07 if age >= 50 else 0.0) - (0.08 if age < 30 else 0.0)
    is_fraud = rng.random() < p_fraud
    scam = pick_scam(rng, age) if is_fraud else None

    avg = customer["baseline"]["avg_transfer_amount"]
    if is_fraud:
        ratio = rng.choice([1.5, 2, 3, 4, 6, 8, 10, 15, 20, 30, 50])
        payee = rng.choice(pools["scam_reported"]) if rng.random() < 0.40 else rng.choice(pools["scam_new"])
        hour = rng.choice([1, 2, 3, 4] if rng.random() < 0.18 else [9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21])
        overrides = ContextOverrides(
            fund_source_recent=rng.random() < 0.30,
            limit_changed_recent=rng.random() < 0.22,
            device_new=rng.random() < 0.25,
            velocity_recent_count=rng.choice([0, 0, 0, 0, 0, 0, 2, 2, 3, 3]),
        )
    else:
        ratio = rng.choice([0.3, 0.5, 0.8, 1, 1, 1.2, 1.5, 2, 2.5, 3, 6])
        payee = rng.choice(pools["scam_new"]) if rng.random() < 0.12 else rng.choice(pools["normal"])
        hour = rng.choice([1, 2] if rng.random() < 0.03 else [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
        overrides = ContextOverrides(
            fund_source_recent=rng.random() < 0.04,
            limit_changed_recent=rng.random() < 0.04,
            device_new=rng.random() < 0.06,
            velocity_recent_count=rng.choice([0] * 19 + [2]),
        )
    amount = max(10_000, min(100_000_000, int(avg * ratio / 10_000) * 10_000))
    at = START_DAY + timedelta(days=rng.randint(0, SPAN_DAYS - 1), hours=hour, minutes=rng.randint(0, 59))

    name = customer["name"]
    coached = is_fraud and rng.random() < 0.30  # 사기범이 시킨 대로 정상인 척 답하는 피해자
    if is_fraud and not coached:
        spec = SCAMS[scam]
        emp = _choice(empathy_question(name), spec["empathy"])
        safety = _choice(SAFETY_QUESTION, "safety_yes" if rng.random() < spec["safety_yes"] else "safety_no")
        text = rng.choice(spec["texts"]) if rng.random() < 0.70 else ""
    else:
        risky_slip = (not is_fraud) and rng.random() < 0.05
        emp = _choice(empathy_question(name), rng.choice(["risky_offer", "risky_text_only"]) if risky_slip else rng.choice(["normal_known", "normal_trade", "normal_settlement"]))
        safety = _choice(SAFETY_QUESTION, "safety_no")
        text = rng.choice(BENIGN_TEXTS) if (not is_fraud and rng.random() < 0.35) else ""
    captures = []
    if is_fraud and not coached and text and SCAMS[scam]["captures"] and rng.random() < 0.85:
        captures = SCAMS[scam]["captures"][: rng.choices([1, 2, 3], weights=[25, 40, 35])[0]]
    return Tx(customer_id, at, amount, payee, overrides, is_fraud, scam, emp, safety, text, captures)


def run_engine(tx: Tx, rag_provider, had: tuple[bool, bool, bool] = (True, True, True)) -> dict:
    """tx 하나를 현재 룰 설정으로 판정한다. had=(공감 질문, 안전 질문, 대화 입력)을 원래 거쳤는지 —
    임계치를 바꿨을 때 '원래 받지 않은 질문은 새로 받은 셈 치지 않는다'는 재채점 규칙과 같다."""
    cfg = rule_config.get_rule_config()
    current_time = tx.at.strftime("%Y-%m-%dT%H:%M:00") + "+09:00"
    signals = run_all_account_signals(tx.customer_id, tx.payee_account, tx.amount, current_time, tx.overrides)
    total, level = build_account_assessment(signals)

    ask_emp = had[0] and total >= cfg.g("intervene_question")
    ask_safety = ask_emp and had[1] and total >= cfg.g("intervene_safety")
    answers = ([tx.emp] if ask_emp else []) + ([tx.safety] if ask_safety else [])
    text = tx.text if ask_emp and had[2] else ""
    rag = rag_provider.scenario_rag(text) if text else None
    context = build_context_assessment(answers, bool(text), rag) if (answers or text) else None
    final = calculate_final_risk(total, level, signals, context)
    return dict(signals=signals, total=total, level=level, context=context, final=final, ask_emp=ask_emp, ask_safety=ask_safety, input_used=bool(text), current_time=current_time)


# ---------------------------------------------------------------- 모니터링 사례 시드
def _iso(dt: datetime) -> str:
    return dt.astimezone(KST).isoformat(timespec="seconds")


def _next_business_day(dt: datetime) -> datetime:
    d = dt + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def open_probability(rank: float) -> float:
    """최근 건일수록 아직 처리 중일 확률이 높다(rank 0=가장 최근, 1=가장 오래됨)."""
    return 0.80 if rank < 0.12 else 0.45 if rank < 0.30 else 0.12 if rank < 0.55 else 0.03


def build_case(report, truth: str, customer: dict, rank: float, rng: random.Random) -> CaseDoc:
    severity = severity_of(report)
    created = datetime.fromisoformat(report.generated_at)
    doc = CaseDoc(case_id=report.report_id, report_id=report.report_id, created_at=_iso(created), updated_at=_iso(created), choice="pending", severity=severity, status="고객 선택 대기")

    def log(at: datetime, actor: str, kind: str, text: str) -> None:
        doc.timeline.append(TimelineEvent(at=_iso(at), actor=actor, kind=kind, text=text))
        doc.updated_at = _iso(at)

    log(created, "시스템", "created", "위험 판정 — 리포트가 생성됐어요.")

    weights = {"초고위험": [("delayed", 48), ("visit", 28), ("abandoned", 14), ("pending", 10)], "고위험": [("visit", 38), ("delayed", 30), ("abandoned", 22), ("pending", 10)]}[severity]
    choice = rng.choices([c for c, _ in weights], weights=[w for _, w in weights])[0]
    is_open = rng.random() < open_probability(rank)
    t_choice = created + timedelta(minutes=rng.randint(1, 6))

    if choice == "pending":
        return doc
    doc.choice = choice

    if choice == "abandoned":
        doc.status = "종결"
        log(t_choice, "고객", "choice", "위험 안내를 보고 송금을 중단했어요. 조치가 필요 없는 건이에요.")
        doc.outcome_at = _iso(t_choice)
        return doc

    if choice == "visit":
        region = customer["profile"]["region"]
        branch_name = REGION_BRANCH.get(region)
        roster = branches()
        branch = next((b for b in roster if b["name"] == branch_name), None) or rng.choice(roster)
        officer = Person(**branch["officer"])
        reserved = _next_business_day(created).replace(hour=rng.choice([9, 10, 11, 13, 14, 15]), minute=rng.choice([0, 30]), second=0)
        mail = MailInfo(sent_at=_iso(t_choice + timedelta(minutes=1)), to=f"{officer.name} {officer.title} ({branch['name']})", subject=f"[AI파수꾼] 고객 면담 요청 · {report.report_id}")
        doc.visit = VisitInfo(branch=branch["name"], branch_code=branch["code"], reserved_at=_iso(reserved), officer=officer, mail=mail)
        doc.assignee = Person(name=officer.name, title=f"{officer.title} · {branch['name']}")
        doc.status = "면담 대기"
        log(t_choice, "고객", "choice", f"영업점 내방을 예약했어요 — {branch['name']} {reserved.strftime('%m월 %d일 %H:%M')}")
        log(t_choice + timedelta(minutes=1), "시스템", "mail", f"{branch['name']} {officer.name} {officer.title}에게 리포트를 개인우편으로 전송했어요.")
        steps = 1 if is_open and rng.random() < 0.5 else 2 if is_open else 3
        if steps >= 2:
            if truth == "fraud":
                result, action = ("fraud_signs", rng.choice(["payment_stop", "payment_stop", "guide"])) if rng.random() < 0.8 else ("no_show", "none")
            else:
                result, action = ("normal", "none") if rng.random() < 0.85 else ("no_show", "none")
            at = reserved + timedelta(minutes=rng.randint(40, 150))
            memo = {"fraud_signs": "고객 면담 결과 보이스피싱 정황이 확인되어 송금을 중단하도록 안내했습니다.", "normal": "거래 목적과 상대방을 확인했고 정상 거래로 판단됩니다.", "no_show": "예약 시간에 내방하지 않아 전화로 안내했습니다."}[result]
            doc.visit.interview = Interview(written_at=_iso(at), result=result, action=action, memo=memo)
            doc.status = "면담 결과 확인 대기"
            log(at, f"영업점 담당직원({officer.name})", "interview", f"면담 결과 작성 — {INTERVIEW_LABEL[result]}")
        if steps >= 3:
            staff = rng.choice(HQ_STAFF)
            at = datetime.fromisoformat(doc.visit.interview.written_at) + timedelta(hours=rng.randint(2, 20))
            doc.visit.hq_confirmed_at = _iso(at)
            doc.status = "종결"
            doc.outcome = {"fraud_signs": "fraud_confirmed", "normal": "normal", "no_show": "unresolved"}[doc.visit.interview.result]
            doc.outcome_at = _iso(at)
            log(at, f"본부 담당자({staff.name})", "confirm", "면담 결과를 확인하고 종결했어요.")
        return doc

    # delayed
    flows = (
        [(0.50, ["reconfirm", "reconfirm_done", "hold"]), (0.25, ["hold"]), (0.25, ["approve", "analysis", "confirm"])]
        if truth == "fraud"
        else [(0.55, ["approve", "analysis", "confirm"]), (0.45, ["reconfirm", "reconfirm_done", "approve", "analysis", "confirm"])]
    )
    flow = rng.choices([f for _, f in flows], weights=[w for w, _ in flows])[0]
    doc.delayed = DelayedInfo(delay_until=_iso(created + timedelta(hours=2)))
    doc.status = "본부 검토 대기"
    log(t_choice, "고객", "choice", "송금을 강행해 지연송금으로 접수했어요.")
    cut = rng.randint(0, len(flow) - 1) if is_open else len(flow)
    staff = rng.choice(HQ_STAFF)
    t = t_choice
    for step in flow[:cut]:
        t += timedelta(minutes=rng.randint(8, 90))
        doc.assignee = doc.assignee or staff
        who = f"본부 담당자({staff.name})"
        if step == "reconfirm":
            doc.delayed.decision = Decision(type="reconfirm", at=_iso(t), by=staff.name, note="리포트 검토 결과 고객 재확인이 필요합니다.")
            doc.delayed.reconfirm = Reconfirm(requested_at=_iso(t))
            doc.status = "고객 재확인 중"
            log(t, who, "decision", "고객 재확인을 요청했어요.")
        elif step == "reconfirm_done":
            r = "victim_aware" if truth == "fraud" else "intent_confirmed"
            doc.delayed.reconfirm.result, doc.delayed.reconfirm.at = r, _iso(t)
            doc.delayed.reconfirm.note = "고객이 사기 피해 가능성을 인지했습니다." if r == "victim_aware" else "고객이 본인 의사로 정상 거래임을 확인했습니다."
            doc.status = "재확인 완료"
            log(t, "고객", "reconfirm", doc.delayed.reconfirm.note)
        elif step == "hold":
            doc.delayed.decision = Decision(type="hold", at=_iso(t), by=staff.name, note="사기 정황이 확인되어 지급정지를 요청합니다.")
            doc.status = "종결"
            doc.outcome, doc.outcome_at = "fraud_confirmed", _iso(t)
            log(t, who, "decision", "지급정지를 요청하고 종결했어요.")
        elif step == "approve":
            doc.delayed.decision = Decision(type="approve", at=_iso(t), by=staff.name, note="위험 요소를 검토했으나 송금을 진행합니다.")
            t_exec = t + timedelta(minutes=1)
            doc.delayed.executed_at = _iso(t_exec)
            activity = make_activity(_iso(t_exec), report.amount, truth == "fraud", rng)
            doc.postcheck = PostCheck(required=severity == "초고위험", activity=activity)
            doc.status = "사후확인 대기"
            log(t, who, "decision", "송금 진행을 승인했어요.")
            log(t_exec, "시스템", "executed", "지연송금이 실행됐어요. 사후 확인 대상으로 등록했어요.")
        elif step == "analysis":
            a = analyze_activity(doc.postcheck.activity, severity, _iso(t))
            a.source = "seed"
            doc.postcheck.analysis = a
            doc.status = "사후확인 결과 확인 대기"
            log(t, "AI파수꾼", "analysis", f"수취계좌 거래내역 AI 재분석 — {a.verdict}({a.confidence}%)")
        elif step == "confirm":
            doc.postcheck.confirmed_at = _iso(t)
            doc.status = "종결"
            doc.outcome = "fraud_confirmed" if doc.postcheck.analysis.verdict == "사기 의심" else "normal"
            doc.outcome_at = _iso(t)
            log(t, who, "confirm", "사후 확인 결과를 확인하고 종결했어요.")
    return doc


# ---------------------------------------------------------------- 정답지(재채점 검증용)
GOLDEN_CONFIGS = {
    "g1": {"rules": {"amount_anomaly": {"params": {"ratio_low": 3, "ratio_mid": 6}}, "payee_freshness": {"params": {"days_new": 10, "score_new": 25}}}},
    "g2": {"global": {"account_mid": 25, "context_mid": 20, "rag_mid_sim": 0.55}},
    "g3": {"rules": {"device": {"enabled": False}, "time_pattern": {"enabled": False}, "velocity": {"params": {"count_high": 4, "score_high": 25}}}},
    "g4": {"global": {"rag_high_sim": 0.70, "rag_high_score": 45, "account_high": 70}, "rules": {"payee_fraud": {"params": {"score": 30}}}},
}


def merge(base: dict, patch: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


def dump(path: Path, data, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
    path.write_text(text + "\n", encoding="utf-8")
    print(f"  {path.relative_to(BACKEND.parent)}  ({len(text) / 1024:.0f} KB)")


def main() -> None:
    rule_config.reset_rule_config()
    rng = random.Random(SEED)
    rag_provider = FaissLocalRagProvider()
    customer_ids = sorted(customers().keys())
    pools = {k: [a for a, p in payees().items() if p.get("pool") == k] for k in ("normal", "scam_new", "scam_reported")}
    assert all(pools.values()), pools

    txs = [sample_tx(rng, customer_ids, pools) for _ in range(TARGET_LOGS)]
    txs.sort(key=lambda t: t.at)

    per_day: dict[str, int] = {}
    report_day: dict[str, int] = {}
    logs, entries, risky = [], [], []
    for tx in txs:
        tx.out = out = run_engine(tx, rag_provider)
        key = tx.at.strftime("%Y%m%d")
        per_day[key] = per_day.get(key, 0) + 1
        customer = get_customer(tx.customer_id)
        payee = get_payee(tx.payee_account)
        report_id = None
        if out["final"].final == "위험":
            report_day[key] = report_day.get(key, 0) + 1
            report_id = f"RPT-{key}-{report_day[key]:03d}"
        log = build_log(
            log_id=f"TXN-{key}-{per_day[key]:04d}", at=out["current_time"], customer_id=tx.customer_id, customer=customer, amount=tx.amount,
            payee_account=tx.payee_account, payee_bank=payee.get("payee_bank", "미상"), signals=out["signals"], account_total=out["total"],
            account_level=out["level"], context=out["context"], final=out["final"], report_id=report_id,
            truth="fraud" if tx.is_fraud else "normal", scenario=tx.scam,
        )
        logs.append(log)
        if report_id:
            ctx_text = tx.text if out["input_used"] else ""
            captures = tx.captures if ctx_text else []
            report = build_report(
                agent=TemplateSummarizer(ctx_text, [c[0] for c in captures]), customer=customer, customer_phone=customer["phone"], payee=payee,
                amount=tx.amount, attempted_at=out["current_time"], final=out["final"], conversation=ctx_text, attachments_present=bool(captures),
                rag=out["context"].rag if out["context"] else None,
                account=AccountAssessment(signals=out["signals"], total_score=out["total"], level=out["level"]), context=out["context"],
            )
            report.report_id = report_id
            report.generated_at = _iso(tx.at + timedelta(minutes=3))
            entries.append({"report": report.model_dump(mode="json", exclude={"attachments"}), "attachments": [{"name": n, "lines": l} for n, l in captures]})
            risky.append((report, tx))

    # 사례(case): 최근 건일수록 처리 중. 리포트 최신순으로 rank를 매긴다.
    case_rng = random.Random(SEED + 7)
    cases = []
    ordered = sorted(risky, key=lambda r: r[0].attempted_at, reverse=True)
    for i, (report, tx) in enumerate(ordered):
        cases.append(build_case(report, "fraud" if tx.is_fraud else "normal", get_customer(tx.customer_id), i / max(1, len(ordered) - 1), case_rng))
    entries.sort(key=lambda e: e["report"]["attempted_at"], reverse=True)

    # 정답지: 룰 설정을 바꿔 같은 거래를 실제 엔진에 다시 돌린 결과.
    golden = {"configs": {}, "results": {}}
    for name, patch in GOLDEN_CONFIGS.items():
        cfg = merge(rule_config.DEFAULT_CONFIG, patch)
        ok, errors, _ = rule_config.get_rule_config_store().update(cfg, actor="정답지 생성기")
        assert ok, (name, errors)
        res = {}
        for tx, log in zip(txs, logs):
            had = (log.answers_empathy is not None, log.answers_safety is not None, log.input_used)
            o = run_engine(tx, rag_provider, had)
            res[log.log_id] = [o["total"], o["context"].total_score if o["context"] else None, o["final"].final]
        golden["configs"][name] = cfg
        golden["results"][name] = res
        rule_config.reset_rule_config()
    # 기본 설정으로 다시 돌린 결과가 원본 로그와 같은지(재채점 규칙이 원본 판정을 재현하는지) 확인.
    for tx, log in zip(txs, logs):
        had = (log.answers_empathy is not None, log.answers_safety is not None, log.input_used)
        o = run_engine(tx, rag_provider, had)
        assert (o["total"], o["final"].final) == (log.account_total, log.final), log.log_id

    stats = {v: sum(1 for l in logs if l.final == v) for v in ("안전", "주의", "위험")}
    fraud = [l for l in logs if l.truth == "fraud"]
    print(f"로그 {len(logs)}건 {stats} · 사기 {len(fraud)}건 중 위험 {sum(1 for l in fraud if l.final == '위험')} / 주의 {sum(1 for l in fraud if l.final == '주의')} / 놓침 {sum(1 for l in fraud if l.final == '안전')}")
    choices = {c: sum(1 for x in cases if x.choice == c) for c in ("visit", "delayed", "abandoned", "pending")}
    print(f"리포트 {len(entries)}건 · 사례 {len(cases)}건 {choices}")

    print("쓴 파일:")
    log_rows = [l.model_dump(mode="json") for l in logs]
    case_rows = [c.model_dump(mode="json") for c in sorted(cases, key=lambda c: c.created_at, reverse=True)]
    dump(BACKEND / "mock_data" / "transfer_logs.json", log_rows)
    dump(BACKEND / "mock_data" / "report_history.json", entries, indent=1)
    dump(BACKEND / "mock_data" / "cases.json", case_rows)
    dump(FRONT / "demoData" / "reportHistory.json", entries, indent=1)
    dump(FRONT / "demoData" / "admin" / "transferLogs.json", log_rows)
    dump(FRONT / "demoData" / "admin" / "cases.json", case_rows)
    dump(FRONT / "demoData" / "admin" / "ruleSchema.json", {**_rules_state(), "schema": rule_config.param_schema()})
    dump(FRONT / "demoData" / "admin" / "scenarios.json", scenarios())
    dump(FRONT / "demoData" / "admin" / "branches.json", branches())
    dump(FRONT / "admin" / "__golden__" / "rescore.json", golden)


if __name__ == "__main__":
    main()
