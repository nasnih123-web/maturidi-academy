"""نقطهٔ ورود API — فاز ۲.

- پاکت خطای یکدست برای همهٔ خطاها (فاز ۰ §۱) + request_id در هدر و context
- میدل‌ویرها: request-id → لاگ دسترسی/متریک → هدرهای امنیتی
- روترها: auth، users، meta، admin، content — همه زیر /api/v1
- WebSocket بلادرنگ: /ws/events (احراز هویت JWT در handshake)
- lifespan: نگهبان secrets در production + راه‌اندازی/توقف dispatcher رویدادها + Sentry + OpenTelemetry
- لاگ ساختاریافته (text یا JSON با LOG_FORMAT=json) — فاز ۲ §۱۱
- /metrics: خروجی Prometheus (متریک درون‌حافظه‌ای، بدون وابستگی جدید)
"""
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import assert_production_secrets_ok, get_settings
from app.core.database import get_db
from app.core.dispatcher import start_realtime, stop_realtime
from app.core.errors import register_error_handlers
from app.core.logging import logger, setup_logging
from app.core.metrics import METRICS
from app.core.middleware import (
    AccessLogMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.realtime import websocket_endpoint
from app.modules.admin.router import router as admin_router
from app.modules.auth.router import router as auth_router
from app.modules.lms.router import (
    admin_lms_router,
    lms_router,
    public_cert_router,
)
from app.modules.library.router import (
    admin_library_router,
    library_router,
)
from app.modules.calculators.router import (
    admin_calc_router,
    calc_router,
)
from app.modules.content.cms_router import router as cms_router
from app.modules.content.router import router as content_router
from app.modules.fatwa.router import (
    admin_fatwa_router,
    fatwa_router,
    verify_router,
)
from app.modules.fatwa.clusters_router import clusters_router
from app.modules.fatwa.submissions_router import submissions_router
from app.modules.social.router import (
    admin_social_router,
    moderation_router,
    social_router,
)
from app.modules.home.router import router as home_router
from app.modules.meta.router import router as meta_router
from app.modules.quran.router import (
    adhan_router,
    quran_router,
    tasbih_router,
)
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
    assert_production_secrets_ok(settings)
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


# ترتیب اجرا: RequestId (بیرونی‌ترین — اول) → AccessLog → SecurityHeaders.
# add_middleware در ابتدای صف می‌نشاند، پس آخرین فراخوانی بیرونی‌ترین است.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AccessLogMiddleware)
app.add_middleware(RequestIdMiddleware)

# CORS فقط وقتی CORS_ALLOW_ORIGINS تنظیم شده باشد (پیش‌فرض: غیرفعال).
_cors = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
if _cors:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


register_error_handlers(app)

# فایل‌های static (فعلاً: فونت‌های سفارشی آپلودشده از CRM — میل‌استون polish).
# دایرکتوری runtime ساخته می‌شود و در git نیست؛ URLها به‌صورت /static/... برمی‌گردند.
from app.modules.admin.service import STATIC_DIR  # noqa: E402

STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(meta_router)
app.include_router(admin_router)
app.include_router(content_router)
app.include_router(cms_router)
app.include_router(home_router)
app.include_router(quran_router)
app.include_router(tasbih_router)
app.include_router(adhan_router)
app.include_router(fatwa_router)
app.include_router(verify_router)
app.include_router(admin_fatwa_router)
app.include_router(calc_router)
app.include_router(admin_calc_router)
app.include_router(lms_router)
app.include_router(public_cert_router)
app.include_router(admin_lms_router)
app.include_router(library_router)
app.include_router(admin_library_router)
app.include_router(social_router)
app.include_router(admin_social_router)
app.include_router(moderation_router)
app.include_router(submissions_router)
app.include_router(clusters_router)

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


@app.get("/metrics", include_in_schema=False)
async def metrics():
    """خروجی Prometheus — فقط خواندنی، بدون PII (الگوی turbo، قرارداد §۱۱)."""
    return Response(
        content=METRICS.exposition(), media_type="text/plain; version=0.0.4"
    )
