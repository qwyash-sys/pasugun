"""RAG_BACKEND=faiss (로컬) 구현체. SPEC 1장: FAISS + 오픈소스 한국어 sentence-transformers.

`jhgan/ko-sroberta-multitask`(한국어 STS 튜닝 SBERT, 768차원)로 사례집 10건을 임베딩해
FAISS `IndexFlatIP`(코사인 = 정규화된 벡터의 내적)로 검색한다. 문서가 10건뿐이라 인덱스
자체의 이점은 미미하지만, SPEC이 명시한 라이브러리 조합을 그대로 쓴다.

모델은 최초 1회 HuggingFace Hub에서 내려받아 로컬 캐시(~/.cache/huggingface)에 저장되고,
이후로는 완전히 오프라인으로 동작한다 — AWS VDI로 옮겨가도 Python 환경만 있으면 이 코드가
그대로 동작한다(별도 AWS 서비스 의존 없음). AWS 쪽에서 관리형 RAG(Bedrock KB + Titan)를
쓰고 싶을 때는 RAG_BACKEND=bedrock_kb 로 전환하면 된다(bedrock_kb_provider.py).
"""

from functools import lru_cache

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

from app.data_store import scenarios
from app.models import RagMatch
from app.scoring import rag_score

_MODEL_NAME = "jhgan/ko-sroberta-multitask"


def _corpus_text(scenario: dict) -> str:
    return " ".join([scenario["수법요약"], *scenario["범인멘트"], *scenario["위험신호"]])


@lru_cache
def _model() -> SentenceTransformer:
    return SentenceTransformer(_MODEL_NAME)


@lru_cache
def _index() -> tuple[list[dict], "faiss.IndexFlatIP"]:
    docs = scenarios()
    embeddings = _model().encode(
        [_corpus_text(d) for d in docs], normalize_embeddings=True, convert_to_numpy=True
    )
    index = faiss.IndexFlatIP(embeddings.shape[1])
    index.add(np.asarray(embeddings, dtype="float32"))
    return docs, index


class FaissLocalRagProvider:
    def scenario_rag(self, text: str) -> RagMatch:
        docs, index = _index()
        query_vec = _model().encode([text], normalize_embeddings=True, convert_to_numpy=True)
        similarities, indices = index.search(np.asarray(query_vec, dtype="float32"), k=1)

        best_sim = float(similarities[0][0])
        best_doc = docs[int(indices[0][0])]

        score = rag_score(best_sim)
        if score == 0:
            return RagMatch(
                hit=False,
                matched_type=best_doc["유형"],
                matched_id=best_doc["id"],
                similarity=round(best_sim, 2),
                score=0,
                risk_signals=[],
                source=best_doc["출처"],
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
