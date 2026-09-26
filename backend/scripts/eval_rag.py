"""2단계 RAG 품질 점검: 유형별 실제 고객 발화 + 정상 송금 발화를 넣어 top-1 유형 정확도와
정상 발화 오탐(임계값 0.60 이상으로 매칭되는지)을 본다. 사례집(scenarios.json)을 늘리거나
임베딩 모델·임계값을 바꿨을 때 회귀 확인용.

    cd backend && python scripts/eval_rag.py
"""

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.providers.rag.faiss_provider import FaissLocalRagProvider  # noqa: E402

# (기대 유형, 발화). 기대 유형 None = 정상 송금(매칭되면 오탐).
CASES: list[tuple[str | None, str]] = [
    ("기관사칭", "검찰청 수사관이라는 사람이 제 계좌가 범죄에 연루됐다고 안전계좌로 옮기래요"),
    ("기관사칭", "금융감독원 직원이라면서 자산을 보호하려면 돈을 지정 계좌로 옮겨야 한대요"),
    ("기관사칭", "경찰이라면서 제 명의로 대포통장이 만들어졌다고 조사받아야 한대요"),
    ("기관사칭", "카드 발급 안 했는데 카드 배송 온다고 해서 전화했더니 금감원으로 연결해줬어요"),
    ("대출사기", "저금리 대환대출 해준다고 기존 대출 상환금을 먼저 이 계좌로 보내래요"),
    ("대출사기", "신용점수 올려서 대출 한도 높여준다고 수수료를 먼저 입금하라네요"),
    ("대출사기", "캐피탈 직원이 정부지원 대출 승인됐다고 기존 대출부터 갚으래요"),
    ("메신저피싱", "딸이 폰이 고장났다고 카톡으로 급하게 돈을 보내달래요"),
    ("메신저피싱", "엄마 나 폰 액정 깨져서 이걸로 연락해 급하게 결제할 게 있어"),
    ("메신저피싱", "아들이라면서 문자로만 연락되고 전화는 안 받아요 상품권 사달래요"),
    ("협박형", "아들이 사고를 쳐서 합의금을 지금 안 보내면 큰일 난다고 전화가 왔어요"),
    ("협박형", "딸을 데리고 있다고 경찰에 알리면 안 된다며 돈을 보내라고 협박해요"),
    ("스미싱", "택배 주소가 잘못됐다는 문자 링크를 눌렀더니 결제 확인을 하래요"),
    ("스미싱", "청첩장 문자 링크 눌렀더니 앱이 깔리고 나서 이상한 결제 문자가 와요"),
    ("몸캠피싱", "영상통화하다가 녹화된 영상을 지인들한테 뿌리겠다고 돈을 요구해요"),
    ("취업사기", "고액 알바라면서 제 통장으로 들어온 돈을 다른 계좌로 옮겨달래요"),
    ("취업사기", "재택 부업인데 먼저 교육비랑 보증금을 입금해야 일을 준대요"),
    ("원격제어형", "상담원이 앱을 설치하라고 해서 깔았더니 화면을 보면서 이체하라고 해요"),
    ("원격제어형", "은행 보안점검이라며 팀뷰어 같은 앱 깔고 화면 켜두라고 했어요"),
    (None, "친구 결혼식 축의금 보내려고요"),
    (None, "이번 달 월세 집주인한테 보내는 거예요"),
    (None, "중고나라에서 자전거 사고 직거래 대금 보내요"),
    (None, "부모님 생신이라 용돈 보내드려요"),
    (None, "회사 거래처에 물품 대금 결제하는 거예요"),
    (None, "동생 등록금 대신 내주려고요"),
    (None, "모임 회비 총무한테 보내요"),
    (None, "전세 잔금 부동산 중개사 입회하에 치르는 거예요"),
]


def main() -> None:
    rag = FaissLocalRagProvider()
    per_type: dict[str, list[bool]] = defaultdict(list)
    false_positives = []
    misses = []
    for expected, text in CASES:
        m = rag.scenario_rag(text)
        top = m.candidates[0]
        mark = ""
        if expected is None:
            if m.hit:
                false_positives.append((text, m.matched_type, m.similarity))
                mark = "  <-- 오탐"
        else:
            ok = m.hit and m.matched_type == expected
            per_type[expected].append(ok)
            if not ok:
                misses.append((expected, text, top.matched_type, top.similarity, m.hit))
                mark = "  <-- 놓침" if not m.hit else "  <-- 유형 불일치"
        print(f"[{expected or '정상':6}] top={top.matched_type}({top.similarity:.2f}) hit={m.hit} score={m.score}  {text[:34]}{mark}")

    scam_total = sum(len(v) for v in per_type.values())
    scam_ok = sum(sum(v) for v in per_type.values())
    benign_total = sum(1 for e, _ in CASES if e is None)
    print()
    print(f"사기 발화 탐지(유형까지 일치): {scam_ok}/{scam_total}")
    for t, v in per_type.items():
        print(f"  {t}: {sum(v)}/{len(v)}")
    print(f"정상 발화 오탐: {len(false_positives)}/{benign_total}")


if __name__ == "__main__":
    main()
