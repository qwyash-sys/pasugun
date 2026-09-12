from functools import lru_cache

from app.config import get_settings
from app.providers.llm.anthropic_provider import AnthropicLlmProvider
from app.providers.llm.base import LlmProvider
from app.providers.llm.bedrock_provider import BedrockLlmProvider


@lru_cache
def get_llm() -> LlmProvider:
    settings = get_settings()
    if settings.llm_provider == "bedrock":
        return BedrockLlmProvider(settings)
    return AnthropicLlmProvider(settings)
