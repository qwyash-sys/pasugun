from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
MOCK_DATA_DIR = BASE_DIR / "mock_data"
# winget의 무인 설치는 영어 언어팩만 넣고 한국어(kor.traineddata)는 빠뜨린다 — 시스템
# tessdata를 덮어쓰는 대신, 한국어까지 받아둔 이 프로젝트 로컬 폴더를 대신 가리킨다.
TESSDATA_DIR = BASE_DIR / "tessdata"


class Settings(BaseSettings):
    """SPEC.md 1장 프로바이더 스위치. 호출부는 이 설정만 보고 구현체를 고른다."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    llm_provider: str = "anthropic"  # anthropic | bedrock
    ocr_provider: str = "tesseract"  # tesseract | textract
    rag_backend: str = "faiss"  # faiss | bedrock_kb
    stt_provider: str = "local"  # local | transcribe

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"  # 현재 라인업 최저가($1/$5 per 1M) — 프로토타입 기본값

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
