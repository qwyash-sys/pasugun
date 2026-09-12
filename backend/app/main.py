from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import chat, transfer

app = FastAPI(title="멈칫(Meomchit) API")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transfer.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
