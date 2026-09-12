"""RAG_BACKEND=bedrock_kb (AWS 전환용) 구현체.

Bedrock Knowledge Base(Titan 임베딩)로 사례집 10건을 색인해두었다고 가정하고
retrieve API를 호출한다. AWS 자격증명·KB ID가 없는 로컬 개발에서는 이 provider가
선택되지 않으므로(factory가 RAG_BACKEND 설정을 보고 분기) 프로토타입 필수 경로는
아니다 — 인터페이스만 맞춰 전환 가능성을 열어둔다.
"""

from app.config import Settings
from app.models import RagMatch
from app.scoring import rag_score


class BedrockKbRagProvider:
    def __init__(self, settings: Settings):
        self._settings = settings

    def scenario_rag(self, text: str) -> RagMatch:
        import boto3

        client = boto3.client("bedrock-agent-runtime", region_name=self._settings.aws_region)
        response = client.retrieve(
            knowledgeBaseId=self._settings.bedrock_kb_id,
            retrievalQuery={"text": text},
            retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": 1}},
        )
        results = response.get("retrievalResults", [])
        if not results:
            return RagMatch(hit=False, similarity=0.0, score=0, risk_signals=[])

        top = results[0]
        similarity = float(top.get("score", 0.0))
        metadata = top.get("metadata", {})
        score = rag_score(similarity)

        return RagMatch(
            hit=score > 0,
            matched_type=metadata.get("유형"),
            matched_id=metadata.get("id"),
            similarity=round(similarity, 2),
            score=score,
            risk_signals=metadata.get("위험신호", []),
            source=metadata.get("출처"),
        )
