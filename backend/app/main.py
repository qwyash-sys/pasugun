import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers import chat, transfer

logger = logging.getLogger("meomchit")

app = FastAPI(title="멈칫(Meomchit) API")

settings = get_settings()
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
