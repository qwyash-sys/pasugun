"""데모 모드(백엔드 없음)용 사례집 화면 데이터: 검증 문장 세트의 실제 SBERT + FAISS 유사도 순위를 미리 계산해 둔다.

브라우저에서는 문장을 임베딩할 수 없어서, 데모의 '유사도 시험'은 이 문장들만 실제 엔진 결과로 보여준다.
점수·매칭 여부는 화면이 현재 RAG 기준값으로 다시 계산하므로 기준을 바꿔도 결과가 따라 움직인다.

    cd backend && python scripts/generate_rag_demo.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.providers.rag.faiss_provider import FaissLocalRagProvider  # noqa: E402
from app.rag_eval import CASES  # noqa: E402

OUT = ROOT.parent / "frontend" / "src" / "demoData" / "admin" / "ragDemo.json"


def main() -> None:
    rag = FaissLocalRagProvider()
    results = {}
    for _, text in CASES:
        m = rag.scenario_rag(text)
        results[text] = [{"scenario_id": c.scenario_id, "matched_type": c.matched_type, "similarity": c.similarity} for c in m.candidates]
    OUT.write_text(json.dumps({"cases": [{"expected": e, "text": t} for e, t in CASES], "results": results}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(results)}개 문장 → {OUT}")


if __name__ == "__main__":
    main()
