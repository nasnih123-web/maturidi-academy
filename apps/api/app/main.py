"""نقطهٔ ورود API — فاز ۲.

- پاکت خطای یکدست برای همهٔ خطاها (فاز ۰ §۱) + request_id در هدر و context
- روترها: auth، users، meta، admin، content — همه زیر /api/v1
- WebSocket بلادرنگ: /ws/events (احراز هویت JWT در handshake)
- lifespan: راه‌اندازی/توقف dispatcher رویدادها + Sentry + OpenTelemetry
- لاگ ساختاریافته (text یا JSON با LOG_FORMAT=json) — فاز ۲ §۱۱
"""
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.context import request_id_var
from app.core.database import get_db
from app.core.dispatcher import start_realtime, stop_realtime
from app.core.errors import register_error_handlers
from app.core.logging import logger, setup_logging
from app.core.realtime import websocket_endpoint
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.content.router import router as content_router
from app.modules.meta.router import router as meta_router
from app.modules.users.router import router as users_router

setup_logging()
settings = get_settings()


def _init_sentry() -> None:
    """خطا → Sentry — فقط وقتی SENTRY_DSN تنظیم شده باشد (فاز ۲ §۱۱)."""
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk  # noqa: PLC0415
    except ImportError:
        logger.warning("sentry_dsn is set but sentry-sdk is not installed")
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        traces_sample_rate=0.1,
    )
    logger.info("sentry initialized")


def _init_otel() -> None:
    """ردیابی توزیع‌شده → OpenTelemetry — فقط وقتی endpoint تنظیم شده باشد."""
    if not settings.otel_exporter_otlp_endpoint:
        return
    try:
        from opentelemetry import trace  # noqa: PLC0415
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: PLC0415
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
        from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: PLC0415
    except ImportError:
        logger.warning("otel endpoint is set but opentelemetry packages are not installed")
        return
    provider = TracerProvider()
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
        )
    )
    trace.set_tracer_provider(provider)
    logger.info("opentelemetry initialized -> %s", settings.otel_exporter_otlp_endpoint)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_sentry()
    _init_otel()
    await start_realtime(app)
    yield
    await stop_realtime(app)


app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
    docs_url="/docs" if settings.is_dev else None,
    lifespan=lifespan,
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
app.include_router(admin_router)
app.include_router(content_router)

# دروازهٔ بلادرنگ — دکوراتور @app.websocket (نه add_websocket_route استارلت)
# چون فقط مسیر APIWebSocketRoute وابستگی‌ها (Depends/get_db) را حل می‌کند.
@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket_endpoint(websocket, db)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}


@app.get("/api/v1/health")
async def health_v1():
    return {"status": "ok", "env": settings.app_env, "api": "v1"}
