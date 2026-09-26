"""관리자(내부직원) 전용 영업점 연계 리포트 목록·상세·첨부 조회."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models import ReportListResponse, ReportPayload, RiskLevel
from app.report_store import get_report_store, to_summary

router = APIRouter(prefix="/api/reports", tags=["reports"])

# 업로드 이미지를 이 오리진에서 직접 열어도 스크립트가 실행되지 않게 막는다.
_ATTACHMENT_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
}


@router.get("", response_model=ReportListResponse)
def list_reports(
    q: str = Query(default="", max_length=100),
    account_level: RiskLevel | None = None,
    context_level: RiskLevel | None = None,
    rag_type: str | None = Query(default=None, max_length=30),
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
):
    matched = get_report_store().search(
        q=q,
        account_level=account_level,
        context_level=context_level,
        rag_type=rag_type,
        date_from=date_from,
        date_to=date_to,
    )
    start = (page - 1) * page_size
    return ReportListResponse(
        items=[to_summary(r) for r in matched[start : start + page_size]],
        total=len(matched),
        page=page,
        page_size=page_size,
    )


@router.get("/{report_id}", response_model=ReportPayload)
def get_report(report_id: str):
    report = get_report_store().get(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없어요.")
    return report


@router.get("/{report_id}/attachments/{index}")
def get_attachment(report_id: str, index: int):
    found = get_report_store().attachment(report_id, index)
    if found is None:
        raise HTTPException(status_code=404, detail="첨부자료를 찾을 수 없어요.")
    data, content_type = found
    return Response(content=data, media_type=content_type, headers=_ATTACHMENT_HEADERS)
