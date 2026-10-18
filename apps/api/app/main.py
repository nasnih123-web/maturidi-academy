"""نقطهٔ ورود API — فاز ۱.

- پاکت خطای یکدست برای همهٔ خطاها (فاز ۰ §۱) + request_id در هدر و context
- روترها: auth، users، meta — همه زیر /api/v1
"""
import uuid

from fastapi import FastAPI, Request

from app.core.config import get_settings
from app.core.context import request_id_var
from app.core.errors import register_error_handlers
from app.modules.auth.router import router as auth_router
from app.modules.meta.router import router as meta_router
from app.modules.users.router import router as users_router

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs" if settings.is_dev else None,
)


@app.middleware("http")
async def _request_id_middleware(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request_id_var.set(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


register_error_handlers(app)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(meta_router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}


@app.get("/api/v1/health")
async def health_v1():
    return {"status": "ok", "env": settings.app_env, "api": "v1"}
