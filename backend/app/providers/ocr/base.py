from typing import Protocol


class OcrProvider(Protocol):
    def ocr_extract(self, image_bytes: bytes) -> dict: ...
