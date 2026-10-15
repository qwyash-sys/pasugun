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

from app.rag_eval import CASES  # noqa: E402  (관리자 페이지 '검증 문장 점검'과 같은 세트)


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
