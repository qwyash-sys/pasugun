import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agent import llm_status
from app.config import get_settings
from app.providers.rag.factory import get_rag
from app.routers import chat, reports, transfer

logger = logging.getLogger("pasugun")
settings = get_settings()


def _warm_up_rag() -> None:
    """임베딩 모델 로드 + 사례집 인덱싱(수 초)을 서버 시작 직후 미리 해둔다 — 안 하면 첫 고객의
    첫 대화·결과 확인이 그만큼 늦는다. 로컬 FAISS만(관리형 KB는 호출 자체가 과금·네트워크라 제외)."""
    try:
        get_rag().scenario_rag("서버 시작 워밍업")
        logger.info("RAG warm-up done")
    except Exception:
        logger.exception("RAG warm-up failed (첫 요청 때 다시 시도됨)")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.rag_backend == "faiss":
        threading.Thread(target=_warm_up_rag, daemon=True).start()
    yield


app = FastAPI(title="파수꾼(Pasugun) API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """처리 안 된 예외를 그대로 500으로 흘려보내면 Starlette가 CORS 미들웨어를
    거치지 않은 응답을 만들어 브라우저가 CORS 오류로 잘못 보고한다(진짜 원인은
    가려짐). 항상 CORS 헤더가 붙는 정상 JSON 응답으로 바꿔서 내려준다 — 예:
    Anthropic API 키 문제·크레딧 소진처럼 외부 서비스 오류가 여기 걸린다."""

    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=502,
        content={"detail": "요청 처리 중 문제가 발생했어요. 잠시 후 다시 시도해주세요."},
    )


app.include_router(transfer.router)
app.include_router(chat.router)
app.include_router(reports.router)


@app.get("/api/health")
def health():
    # llm: unknown(아직 호출 전) / ok / fallback(최근 호출이 실패해 규칙 기반 대체 응답 중).
    # 키 만료·크레딧 소진을 로그 없이 바로 확인할 수 있다. 오류 메시지에 키 값은 들어가지 않는다.
    return {"status": "ok", **llm_status.snapshot()}
