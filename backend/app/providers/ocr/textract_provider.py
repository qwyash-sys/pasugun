"""OCR_PROVIDER=textract (AWS 전환용) 구현체."""

from app.config import Settings


class TextractOcrProvider:
    def __init__(self, settings: Settings):
        self._settings = settings

    def ocr_extract(self, image_bytes: bytes) -> dict:
        import boto3

        client = boto3.client("textract", region_name=self._settings.aws_region)
        response = client.detect_document_text(Document={"Bytes": image_bytes})
        lines = [b["Text"] for b in response.get("Blocks", []) if b.get("BlockType") == "LINE"]
        return {"text": "\n".join(lines)}
