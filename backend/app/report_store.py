"""영업점 연계 리포트 저장소 (관리자 리포트 목록용). 프로토타입이라 프로세스 메모리에 둔다.

시작 시 mock_data/report_history.json(과거 리포트 목업, scripts/generate_report_history.py로
실제 스코어링 엔진을 돌려 만든 것)으로 채워두고, 실제 모드에서 새로 생성된 리포트를 앞에 쌓는다.
첨부자료는 두 종류다 — 실제 업로드된 이미지 바이트, 그리고 목업 이력의 "문자 캡처" 문구
(원본 이미지가 없으니 요청 시 SVG로 그려서 내려준다)."""

import io
import json
from dataclasses import dataclass
from functools import lru_cache
from html import escape

from PIL import Image

from app.config import MOCK_DATA_DIR
from app.models import AttachmentMeta, ReportPayload, ReportSummary, RiskLevel

_FORMAT_TO_MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "GIF": "image/gif",
    "WEBP": "image/webp",
    "BMP": "image/bmp",
    "TIFF": "image/tiff",
}


@dataclass
class UploadedImage:
    name: str
    data: bytes

    @property
    def content_type(self) -> str:
        # 클라이언트가 보낸 타입을 믿지 않고 실제 바이트로 판별한다(엉뚱한 타입으로 서빙 방지).
        try:
            fmt = Image.open(io.BytesIO(self.data)).format
        except Exception:
            fmt = None
        return _FORMAT_TO_MIME.get(fmt or "", "application/octet-stream")


@dataclass
class MockCapture:
    name: str
    lines: list[str]


Attachment = UploadedImage | MockCapture


def render_capture_svg(capture: MockCapture) -> bytes:
    """목업 이력의 첨부(문자 캡처)를 휴대폰 문자 화면처럼 그린다. 사용자 입력이 아니라
    우리가 만든 고정 문구지만 그래도 텍스트는 이스케이프한다."""

    line_h = 28
    bubble_h = 24 + line_h * len(capture.lines)
    height = 120 + bubble_h
    texts = "".join(
        f'<text x="44" y="{112 + i * line_h}" font-size="17" fill="#17191c">{escape(line)}</text>'
        for i, line in enumerate(capture.lines)
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="420" height="{height}" viewBox="0 0 420 {height}">'
        f'<rect width="420" height="{height}" fill="#f4f5f6"/>'
        '<rect width="420" height="52" fill="#ffffff"/>'
        '<text x="210" y="32" font-size="16" font-weight="700" text-anchor="middle" fill="#17191c">문자 메시지</text>'
        f'<rect x="24" y="76" width="372" height="{bubble_h}" rx="16" fill="#ffffff" stroke="#e9eaec"/>'
        f"{texts}</svg>"
    )
    return svg.encode("utf-8")


class ReportStore:
    def __init__(self) -> None:
        self._reports: list[ReportPayload] = []
        self._attachments: dict[str, list[Attachment]] = {}
        self._load_history()

    def _load_history(self) -> None:
        path = MOCK_DATA_DIR / "report_history.json"
        if not path.exists():
            return
        with path.open(encoding="utf-8") as f:
            entries = json.load(f)
        for entry in entries:
            captures = [MockCapture(a["name"], a["lines"]) for a in entry.get("attachments", [])]
            report = ReportPayload(**entry["report"])
            self._put(report, captures)

    def _put(self, report: ReportPayload, attachments: list[Attachment]) -> ReportPayload:
        report.attachments = [
            AttachmentMeta(name=a.name, url=f"/api/reports/{report.report_id}/attachments/{i}")
            for i, a in enumerate(attachments)
        ]
        self._reports.append(report)
        self._attachments[report.report_id] = attachments
        return report

    def add(self, report: ReportPayload, uploads: list[UploadedImage]) -> ReportPayload:
        # 목업 이력과 번호가 겹치지 않게 한다(실제 생성분은 오늘 날짜 + 프로세스 내 순번이라
        # 재시작하면 001부터 다시 시작한다).
        base, n = report.report_id, 2
        while self.get(report.report_id) is not None:
            report.report_id = f"{base}-{n}"
            n += 1
        return self._put(report, list(uploads))

    def get(self, report_id: str) -> ReportPayload | None:
        return next((r for r in self._reports if r.report_id == report_id), None)

    def attachment(self, report_id: str, index: int) -> tuple[bytes, str] | None:
        items = self._attachments.get(report_id)
        if items is None or not 0 <= index < len(items):
            return None
        item = items[index]
        if isinstance(item, UploadedImage):
            return item.data, item.content_type
        return render_capture_svg(item), "image/svg+xml"

    def search(
        self,
        *,
        q: str = "",
        account_level: RiskLevel | None = None,
        context_level: RiskLevel | None = None,
        rag_type: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> list[ReportPayload]:
        q = q.strip()
        result = []
        for r in self._reports:
            if account_level and r.final.account_level != account_level:
                continue
            if context_level and r.final.context_level != context_level:
                continue
            if rag_type:
                matched = r.rag.matched_type if r.rag and r.rag.hit else None
                if rag_type == "none" and matched is not None:
                    continue
                if rag_type != "none" and matched != rag_type:
                    continue
            day = r.attempted_at[:10]
            if date_from and day < date_from:
                continue
            if date_to and day > date_to:
                continue
            if q and not any(q in s for s in (r.report_id, r.customer_name, r.payee_name, r.payee_account)):
                continue
            result.append(r)
        return sorted(result, key=lambda r: r.attempted_at, reverse=True)


def to_summary(r: ReportPayload) -> ReportSummary:
    rag_hit = bool(r.rag and r.rag.hit)
    return ReportSummary(
        report_id=r.report_id,
        attempted_at=r.attempted_at,
        customer_name=r.customer_name,
        payee_bank=r.payee_bank,
        payee_name=r.payee_name,
        amount=r.amount,
        account_score=r.account.total_score,
        account_level=r.final.account_level,
        context_score=r.context.total_score if r.context else None,
        context_level=r.final.context_level,
        hard_override=r.final.hard_override,
        rag_type=r.rag.matched_type if rag_hit and r.rag else None,
        rag_similarity=r.rag.similarity if rag_hit and r.rag else None,
        attachment_count=len(r.attachments),
    )


@lru_cache
def get_report_store() -> ReportStore:
    return ReportStore()
