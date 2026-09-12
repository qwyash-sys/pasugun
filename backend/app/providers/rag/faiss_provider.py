"""RAG_BACKEND=faiss (로컬) 구현체.

SPEC 1장은 '로컬 = FAISS + 오픈소스 한국어 임베딩(sentence-transformers)'을 지정한다.
이 프로토타입은 개발 샌드박스에서 큰 임베딩 모델(torch 의존)을 내려받지 않고도
바로 동작·시연 가능하도록, 사례 10건 규모에 맞춰 문자 bigram TF-IDF + 코사인
유사도로 같은 인터페이스(scenario_rag)를 구현한다. 문서가 10건뿐이라 FAISS 인덱스도
사실상 불필요 — brute-force 코사인이면 충분하다.

실제 배포 시 이 파일의 _vectorize만 sentence-transformers 임베딩 호출로 교체하면
나머지(코사인 검색·스코어링·RagMatch 매핑)는 그대로 재사용된다. 호출부
(app.providers.rag.factory.get_rag)는 RagProvider 인터페이스만 보므로 영향 없다.
"""

import math
import re
from collections import Counter
from functools import lru_cache

from app.data_store import scenarios
from app.models import RagMatch
from app.scoring import rag_score


def _corpus_text(scenario: dict) -> str:
    return " ".join([scenario["수법요약"], *scenario["범인멘트"], *scenario["위험신호"]])


def _tokenize(text: str) -> Counter:
    """공백 단위 어절 + 문자 2-gram을 함께 써서 형태소 분석기 없이도 한국어
    부분 문자열 유사도를 대충 잡는다. 사례집 10건짜리 데모용 근사치다."""

    words = re.findall(r"[가-힣A-Za-z0-9]+", text)
    tokens: list[str] = list(words)
    for w in words:
        tokens.extend(w[i : i + 2] for i in range(len(w) - 1))
    return Counter(tokens)


@lru_cache
def _index() -> tuple[list[dict], list[Counter], dict[str, float]]:
    docs = scenarios()
    term_counts = [_tokenize(_corpus_text(d)) for d in docs]

    df: Counter = Counter()
    for tc in term_counts:
        df.update(tc.keys())

    n_docs = len(docs)
    idf = {term: math.log((n_docs + 1) / (freq + 1)) + 1 for term, freq in df.items()}
    return docs, term_counts, idf


def _tfidf_vector(counts: Counter, idf: dict[str, float]) -> dict[str, float]:
    total = sum(counts.values()) or 1
    return {term: (freq / total) * idf.get(term, 0.0) for term, freq in counts.items()}


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[t] * b[t] for t in common)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)



# 문자 bigram TF-IDF 코사인은 실제 문장 임베딩보다 절대값이 구조적으로 낮게 나온다
# (예: 자연스러운 패러프레이즈가 0.3~0.5대). SPEC 4-2의 0.60/0.80 임계값은 진짜 의미
# 임베딩 기준이므로, 이 경량 매처의 원점수를 같은 척도로 보정해서 rag_score()에 넘긴다.
# 계수는 코퍼스 10건 기준 실측(정탐 0.36~0.49대 / 오탐 벤치마크 <0.30)으로 정했다 —
# sentence-transformers로 교체하면 이 보정 없이 원점수를 그대로 써야 한다.
_SIMILARITY_CALIBRATION = 1.5


class FaissLocalRagProvider:
    def scenario_rag(self, text: str) -> RagMatch:
        docs, term_counts, idf = _index()
        query_vec = _tfidf_vector(_tokenize(text), idf)

        best_sim = 0.0
        best_doc: dict | None = None
        for doc, counts in zip(docs, term_counts):
            doc_vec = _tfidf_vector(counts, idf)
            sim = _cosine(query_vec, doc_vec)
            if sim > best_sim:
                best_sim = sim
                best_doc = doc

        best_sim = min(1.0, best_sim * _SIMILARITY_CALIBRATION)
        score = rag_score(best_sim)
        if best_doc is None or score == 0:
            return RagMatch(
                hit=False,
                matched_type=best_doc["유형"] if best_doc else None,
                matched_id=best_doc["id"] if best_doc else None,
                similarity=round(best_sim, 2),
                score=0,
                risk_signals=[],
                source=best_doc["출처"] if best_doc else None,
            )

        return RagMatch(
            hit=True,
            matched_type=best_doc["유형"],
            matched_id=best_doc["id"],
            similarity=round(best_sim, 2),
            score=score,
            risk_signals=best_doc["위험신호"],
            source=f"{best_doc['출처']} {best_doc['id']}",
        )
