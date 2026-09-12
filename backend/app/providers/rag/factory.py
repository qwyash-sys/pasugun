from functools import lru_cache

from app.config import get_settings
from app.providers.rag.base import RagProvider
from app.providers.rag.bedrock_kb_provider import BedrockKbRagProvider
from app.providers.rag.faiss_provider import FaissLocalRagProvider


@lru_cache
def get_rag() -> RagProvider:
    settings = get_settings()
    if settings.rag_backend == "bedrock_kb":
        return BedrockKbRagProvider(settings)
    return FaissLocalRagProvider()
