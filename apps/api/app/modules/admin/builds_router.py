"""روتر مرکز بیلدها — فاز ۱۴. مجوز: `builds.manage`.

استثنا (B-01 — ADR-0025): POST /releases علاوه بر کاربرِ دارای مجوز،
توکن سرویس اختصاصی CI (هدر X-Build-Service-Token) را هم می‌پذیرد تا
workflow پس از آپلود فایل به باکت builds، انتشار را ثبت کند.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.admin import builds_service as svc
from app.modules.admin.control_schemas import (
    BuildPrereqsOut,
    BuildReleaseOut,
    BuildRequestOut,
    RebuildIn,
    RebuildOut,
    ReleaseCreateIn,
)
from app.modules.auth.dependencies import get_current_user, require_permission

router = APIRouter(prefix="/api/v1/admin/builds", tags=["admin-builds"])
_perm = require_permission("builds.manage")
_bearer = HTTPBearer(auto_error=False)


async def _release_actor(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """احراز ثبت انتشار: توکن سرویس CI (actor=None) یا کاربرِ مجاز.

    اول توکن سرویس بررسی می‌شود (فقط وقتی در محیط API تنظیم شده باشد)؛
    در غیر این صورت مسیر عادیِ کاربر + مجوز builds.manage طی می‌شود و
    خطاهای 401/403 آن دست‌نخورده می‌ماند.
    """
    if svc.service_token_ok(request.headers.get(svc.SERVICE_TOKEN_HEADER)):
        return None
    user = await get_current_user(credentials=credentials, db=db, request=request)
    return await _perm(user=user, db=db, request=request)


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.get("/releases", response_model=list[BuildReleaseOut])
async def get_releases(
    platform: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """فهرست نسخه‌های منتشرشدهٔ هر پلتفرم با لینک دانلود (امضاشده)."""
    return await svc.list_releases(db, platform=platform, limit=limit)


@router.get("/prereqs", response_model=BuildPrereqsOut)
async def get_prereqs(
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """پیش‌نیازهای امضا: کدام secret حاضر است و کدام نه — صادقانه."""
    return await svc.get_prereqs(db)


@router.post("/rebuild", response_model=RebuildOut)
async def post_rebuild(
    data: RebuildIn,
    request: Request,
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """«بازسازی اپ‌ها» — ساخت درخواست + dispatch واقعی به GitHub Actions.

    بدون ارائه‌دهندهٔ پیکربندی‌شده: 503 build_provider_not_configured.
    """
    ip, ua = _client(request)
    return await svc.request_rebuild(
        db, actor=user, platform=data.platform, version=data.version,
        ref=data.ref, note=data.note, app_name=data.app_name,
        package_id=data.package_id, version_code=data.version_code,
        api_url=data.api_url, environment=data.environment,
        ip=ip, user_agent=ua,
    )


@router.get("/requests", response_model=list[BuildRequestOut])
async def get_requests(
    platform: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(_perm),
    db: AsyncSession = Depends(get_db),
):
    """صف درخواست‌های بازسازی."""
    return await svc.list_requests(db, platform=platform, limit=limit)


@router.post("/releases", response_model=BuildReleaseOut, status_code=201)
async def post_release(
    data: ReleaseCreateIn,
    request: Request,
    actor: User | None = Depends(_release_actor),
    db: AsyncSession = Depends(get_db),
):
    """ثبت نسخهٔ منتشرشده (معمولاً توسط CI) — `signed` فقط برای بیلد واقعی امضاشده.

    احراز: کاربرِ دارای builds.manage یا توکن سرویس CI (B-01).
    """
    ip, ua = _client(request)
    return await svc.create_release(
        db, actor=actor, platform=data.platform, version=data.version,
        build_number=data.build_number, download_url=data.download_url,
        download_expires_at=data.download_expires_at, signed=data.signed,
        build_metadata=data.build_metadata, artifact_key=data.artifact_key,
        file_size_bytes=data.file_size_bytes, sha256=data.sha256,
        ip=ip, user_agent=ua,
    )
