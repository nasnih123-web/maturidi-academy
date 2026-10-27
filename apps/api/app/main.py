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
    BodySizeLimitMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.realtime import websocket_endpoint
from app.core.storage import ensure_storage_ready, validate_builds_storage
from app.modules.admin.builds_router import router as admin_builds_router
from app.modules.admin.connections_router import router as admin_connections_router
from app.modules.admin.content_center_router import router as admin_content_router
from app.modules.admin.notifications_router import router as admin_notifications_router
from app.modules.admin.roles_router import router as admin_roles_router
from app.modules.admin.router import router as admin_router
from app.modules.admin.users_admin_router import router as admin_users_router
from app.modules.api_keys.router import api_keys_router
from app.modules.articles.router import (
    admin_articles_router,
    articles_router,
)
from app.modules.auth.router import router as auth_router
from app.modules.calculators.router import (
    admin_calc_router,
    calc_router,
)
from app.modules.content.cms_router import router as cms_router
from app.modules.content.router import router as content_router
from app.modules.fatwa.clusters_router import clusters_router
from app.modules.fatwa.router import (
    admin_fatwa_router,
    fatwa_router,
    verify_router,
)
from app.modules.fatwa.submissions_router import submissions_router
from app.modules.finance.router import (
    admin_finance_router,
    finance_router,
)
from app.modules.home.admin_router import router as home_admin_router
from app.modules.home.router import router as home_router
from app.modules.library.router import (
    admin_library_router,
    library_router,
)
from app.modules.lms.router import (
    admin_lms_router,
    lms_router,
    public_cert_router,
)
from app.modules.meta.router import router as meta_router
from app.modules.places.router import (
    admin_places_router,
    places_router,
)
from app.modules.projects import projects_router, staff_router
from app.modules.quran.router import (
    adhan_router,
    quran_router,
    tasbih_router,
)
from app.modules.social.router import (
    admin_social_router,
    moderation_router,
    social_router,
)
from app.modules.sync.router import sync_router
from app.modules.telegram.router import telegram_router
from app.modules.users.router import router as users_router
from app.modules.voice.router import (
    admin_voice_router,
    voice_router,
)
from app.modules.widgets.cors import WidgetCorsMiddleware
from app.modules.widgets.router import widgets_router

setup_logging()
settings = get_settings()


def _init_sentry() -> None:
    """خطا → Sentry — فقط وقتی SENTRY_DSN تنظیم شده باشد (فاز ۲ §۱۱)."""
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk
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
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
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
    # Track 1 (final) / یافته‌های ۲ و ۴: اعتبارسنجی storage + ساخت bucket در
    # startup؛ در production با config بد یا MinIOِ در دسترس‌نبودن، بوت با
    # خطای صریح فیل می‌شود (نه fallback خاموش).
    await ensure_storage_ready(settings)
    # FIX2-02 (ADR-0041): ناسازگاری باکت بیلدها (BUILDS_S3_* ناقص) همین‌جا
    # در startup با خطای واضح گرفته می‌شود — نه هنگام دانلود کاربر.
    validate_builds_storage(settings)
    _init_sentry()
    _init_otel()
    # M-07: وضعیت جست‌وجوی معنایی در startup صریح اعلام می‌شود — در
    # production اگر provider واقعی فعال نباشد CRITICAL لاگ می‌خورد
    # («semantic search disabled»)؛ هرگز بی‌صدا hash نمی‌ماند.
    try:
        from app.core.database import SessionLocal
        from app.modules.fatwa.embeddings import log_semantic_search_status

        async with SessionLocal() as _db:
            await log_semantic_search_status(_db)
    except Exception:  # noqa: BLE001 — هشدار نباید بوت را بشکند
        from app.core.logging import logger

        logger.warning("semantic search status check failed at startup", exc_info=True)
    await start_realtime(app)
    # C-06/F2: flush دوره‌ای شمارندهٔ مصرف ویجت‌ها به دیتابیس
    import asyncio as _asyncio

    from app.modules.api_keys.counter import run_usage_flush_loop

    flush_task = _asyncio.create_task(run_usage_flush_loop())
    yield
    flush_task.cancel()
    await stop_realtime(app)


app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
    docs_url="/docs" if settings.is_dev else None,
    lifespan=lifespan,
)


# ترتیب اجرا: RequestId (بیرونی‌ترین — اول) → BodySizeLimit → AccessLog → SecurityHeaders.
# add_middleware در ابتدای صف می‌نشاند، پس آخرین فراخوانی بیرونی‌ترین است.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AccessLogMiddleware)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
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
from app.modules.admin.service import STATIC_DIR

STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(meta_router)
app.include_router(admin_router)
app.include_router(admin_content_router)
app.include_router(admin_connections_router)
app.include_router(admin_builds_router)
app.include_router(admin_notifications_router)
app.include_router(admin_users_router)
app.include_router(admin_roles_router)
app.include_router(content_router)
app.include_router(cms_router)
app.include_router(home_router)
app.include_router(home_admin_router)
app.include_router(quran_router)
app.include_router(tasbih_router)
app.include_router(adhan_router)
app.include_router(fatwa_router)
app.include_router(verify_router)
app.include_router(admin_fatwa_router)
app.include_router(articles_router)
app.include_router(admin_articles_router)
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
app.include_router(places_router)
app.include_router(admin_places_router)
app.include_router(telegram_router)
app.include_router(api_keys_router)
app.include_router(widgets_router)
app.include_router(voice_router)
app.include_router(admin_voice_router)
app.include_router(finance_router)
app.include_router(admin_finance_router)
app.include_router(projects_router)
app.include_router(staff_router)
app.include_router(sync_router)

# CORS wildcard فقط برای /api/v1/widgets/* (§۹.۵ — بدون credential/cookie).
# این middleware فقط همان prefix را لمس می‌کند؛ هیچ endpoint
# احرازهویت‌شدهٔ دیگری هدر wildcard نمی‌گیرد.
app.add_middleware(WidgetCorsMiddleware)

# دروازهٔ بلادرنگ — دکوراتور @app.websocket (نه add_websocket_route استارلت)
# چون فقط مسیر APIWebSocketRoute وابستگی‌ها (Depends/get_db) را حل می‌کند.
@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket_endpoint(websocket, db)


@app.get("/health")
async def health():
    """Liveness خالص — فقط یعنی پردازه زنده است، نه این‌که آمادهٔ
    سرویس‌دهی است. برای readiness به /ready نگاه کنید (Pass 4 / C6)."""
    return {"status": "ok", "env": settings.app_env}


@app.get("/ready")
async def ready():
    """Readiness — Pass 4 / C6.

    /health پیش از این بدون هیچ بررسی وابستگی «ok» برمی‌گرداند،
    در حالی که healthcheck در docker-compose.prod.yml آن را
    readiness می‌خواند: کانتینری که DBاش پس از startup می‌مرد،
    همچنان healthy/readiness گزارش می‌شد. حالا:
    - DB با timeout صریحِ ۳ ثانیه probe می‌شود؛ خطا → 503.
    - Redis فقط گزارش می‌شود (ok/unavailable) و readiness را
      خراب نمی‌کند: API بدون Redis هم سرویس می‌دهد (degraded) و
      رویدادها در outboxِ DB durable می‌مانند؛ کشتن پردازه به‌خاطر
      Redis، readiness را به liveness گره می‌زد.
    """
    import asyncio

    from fastapi.responses import JSONResponse
    from sqlalchemy import text

    from app.core.database import SessionLocal

    db_ok = False
    try:
        async with SessionLocal() as db:
            await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=3)
        db_ok = True
    except Exception:  # noqa: BLE001 — هر خطای DB یعنی not-ready
        db_ok = False
    redis_status = "unknown"
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(
            settings.redis_url, socket_connect_timeout=2
        )
        try:
            await asyncio.wait_for(client.ping(), timeout=2)
            redis_status = "ok"
        finally:
            await client.aclose()
    except Exception:  # noqa: BLE001 — Redis فقط گزارشی است
        redis_status = "unavailable"
    if not db_ok:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "env": settings.app_env,
                "db": "unavailable",
                "redis": redis_status,
            },
        )
    return {
        "status": "ready",
        "env": settings.app_env,
        "db": "ok",
        "redis": redis_status,
    }


@app.get("/api/v1/health")
async def health_v1():
    # media_tools (B-04): وضعیت زنجیرهٔ ابزار رسانه در health دیده
    # می‌شود — ready=false یعنی صف media در این ایمیج کار نمی‌کند و
    # ورکر media هم با همان گیت بالا نمی‌آید (fail loud در startup).
    from app.core.media_tools import media_tools_status

    return {
        "status": "ok",
        "env": settings.app_env,
        "api": "v1",
        "media_tools": media_tools_status(),
    }


@app.get("/metrics", include_in_schema=False)
async def metrics():
    """خروجی Prometheus — فقط خواندنی، بدون PII (الگوی turbo، قرارداد §۱۱)."""
    return Response(
        content=METRICS.exposition(), media_type="text/plain; version=0.0.4"
    )
