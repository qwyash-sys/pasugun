"""OCR_PROVIDER=tesseract (로컬) 구현체. SPEC 3-2: ocr_extract(image_ref) -> {text}."""

import io

import pytesseract
from PIL import Image

from app.config import Settings


class TesseractOcrProvider:
    def __init__(self, settings: Settings):
        if settings.tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd

    def ocr_extract(self, image_bytes: bytes) -> dict:
        image = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(image, lang="kor+eng")
        return {"text": text.strip()}
