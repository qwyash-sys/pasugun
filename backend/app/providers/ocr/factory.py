from functools import lru_cache

from app.config import get_settings
from app.providers.ocr.base import OcrProvider
from app.providers.ocr.tesseract_provider import TesseractOcrProvider
from app.providers.ocr.textract_provider import TextractOcrProvider


@lru_cache
def get_ocr() -> OcrProvider:
    settings = get_settings()
    if settings.ocr_provider == "textract":
        return TextractOcrProvider(settings)
    return TesseractOcrProvider(settings)
