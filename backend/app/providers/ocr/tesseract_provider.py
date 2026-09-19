"""OCR_PROVIDER=tesseract (로컬) 구현체. SPEC 3-2: ocr_extract(image_ref) -> {text}."""

import io
import os

import pytesseract
from PIL import Image

from app.config import TESSDATA_DIR, Settings


class TesseractOcrProvider:
    def __init__(self, settings: Settings):
        if settings.tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
        if TESSDATA_DIR.is_dir():
            # --tessdata-dir를 config 문자열로 넘기면 이 프로젝트 경로의 한글(파수꾼프로젝트)
            # 때문에 하위 프로세스 인자 처리에서 깨지는 경우가 있었다 — 환경변수가 더 안정적.
            os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)

    def ocr_extract(self, image_bytes: bytes) -> dict:
        image = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(image, lang="kor+eng")
        return {"text": text.strip()}
