from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
MOCK_DATA_DIR = BASE_DIR / "mock_data"


class Settings(BaseSettings):
    """SPEC.md 1장 프로바이더 스위치. 호출부는 이 설정만 보고 구현체를 고른다."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    llm_provider: str = "anthropic"  # anthropic | bedrock
    ocr_provider: str = "tesseract"  # tesseract | textract
    rag_backend: str = "faiss"  # faiss | bedrock_kb
    stt_provider: str = "local"  # local | transcribe

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"

    aws_region: str = "ap-northeast-2"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    bedrock_model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    bedrock_kb_id: str = ""

    tesseract_cmd: str = ""

    cors_origins: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()
