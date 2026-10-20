"""سرویس مرکز بیلدها — فاز ۱۴.

- GET /releases: نسخه‌های منتشرشدهٔ هر پلتفرم با download URL (امضاشده).
- POST /rebuild: ثبت درخواست بازسازی — در dev/sandbox فقط رکورد می‌شود؛
  امضای واقعی و بیلد نهایی با CI انجام می‌شود (GitHub Secrets → pipeline).
- GET /prereqs: کدام secretهای امضا حاضرند — صادقانه؛ هرگز ادعای بیلد
  امضاشده‌ای که وجود ندارد نمی‌شود (§۱۵.۹).
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.platform_settings import get_setting
from app.models.models import BuildRelease, BuildRequest, User

PLATFORMS = ("android", "ios", "desktop")

_SIGNING_KEYS: dict[str, tuple[str, str]] = {
    # platform-group → (کلید setting, کلید انقضا)
    "apple_developer": ("signing.apple_developer", "signing.apple_developer_expires_at"),
    "google_play": ("signing.google_play", "signing.google_play_expires_at"),
    "cafebazaar": ("signing.cafebazaar", "signing.cafebazaar_expires_at"),
    "windows_cert": ("signing.windows_cert", "signing.windows_cert_expires_at"),
    "macos_cert": ("signing.macos_cert", "signing.macos_cert_expires_at"),
}

# هر پلتفرم به کدام گواهی‌ها نیاز دارد
_PLATFORM_PREREQS: dict[str, tuple[str, ...]] = {
    "android": ("google_play", "cafebazaar"),
    "ios": ("apple_developer",),
    "desktop": ("windows_cert", "macos_cert"),
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _release_out(r: BuildRelease) -> dict:
    return {
        "id": str(r.id),
        "platform": r.platform,
        "version": r.version,
        "build_number": r.build_number,
        # URL دانلود فقط وقتی معتبر است که بیلد امضاشده و منقضی نشده باشد —
        # در غیر این صورت null صادقانه، نه لینک خراب.
        "download_url": r.download_url if (r.signed and r.download_url) else None,
        "download_expires_at": r.download_expires_at.isoformat()
        if r.download_expires_at else None,
        "signed": r.signed,
        "build_metadata": r.build_metadata or {},
        "created_at": r.created_at.isoformat(),
    }


async def list_releases(
    db: AsyncSession, *, platform: str | None = None, limit: int = 50
) -> list[dict]:
    if platform and platform not in PLATFORMS:
        raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
    stmt = select(BuildRelease).order_by(BuildRelease.created_at.desc())
    if platform:
        stmt = stmt.where(BuildRelease.platform == platform)
    rows = (await db.execute(stmt.limit(min(limit, 200)))).scalars().all()
    return [_release_out(r) for r in rows]


async def get_prereqs(db: AsyncSession) -> dict:
    """پیش‌نیازهای امضا — کدام secret حاضر است؟ صادقانه."""
    signing: dict[str, dict] = {}
    for name, (key, expiry_key) in _SIGNING_KEYS.items():
        value = await get_setting(db, key)
        signing[name] = {
            "present": bool(value and value.strip()),
            "expires_at": await get_setting(db, expiry_key),
        }
    platforms: dict[str, dict] = {}
    for plat, needs in _PLATFORM_PREREQS.items():
        missing = [n for n in needs if not signing[n]["present"]]
        platforms[plat] = {
            "required": list(needs),
            "missing": missing,
            "ready": not missing,
        }
    return {"signing": signing, "platforms": platforms}


async def request_rebuild(
    db: AsyncSession,
    *,
    actor: User,
    platform: str,
    version: str | None = None,
    ref: str | None = None,
    note: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """ثبت درخواست بازسازی — صف درخواست؛ CI بیلد/امضای واقعی را انجام می‌دهد."""
    if platform not in PLATFORMS:
        raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
    prereqs = await get_prereqs(db)
    ready = prereqs["platforms"][platform]["ready"]

    req = BuildRequest(
        platform=platform, version=version, ref=ref,
        status="queued", note=note, requested_by=actor.id,
    )
    db.add(req)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="builds.rebuild.request",
        entity_type="build_request", entity_id=str(req.id),
        new_values={"platform": platform, "version": version, "ref": ref,
                    "signing_ready": ready,
                    "missing_signing": prereqs["platforms"][platform]["missing"]},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(req)
    return {
        "id": str(req.id), "platform": req.platform, "version": req.version,
        "ref": req.ref, "status": req.status,
        "signing_ready": ready,
        "missing_signing": prereqs["platforms"][platform]["missing"],
        "note": ("بیلد واقعی و امضا توسط CI انجام می‌شود؛ "
                 "secretهای امضا را در GitHub Secrets وارد کنید."),
        "created_at": req.created_at.isoformat(),
    }


async def list_requests(
    db: AsyncSession, *, platform: str | None = None, limit: int = 50
) -> list[dict]:
    stmt = select(BuildRequest).order_by(BuildRequest.created_at.desc())
    if platform:
        if platform not in PLATFORMS:
            raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
        stmt = stmt.where(BuildRequest.platform == platform)
    rows = (await db.execute(stmt.limit(min(limit, 200)))).scalars().all()
    return [{
        "id": str(r.id), "platform": r.platform, "version": r.version,
        "ref": r.ref, "status": r.status, "note": r.note,
        "created_at": r.created_at.isoformat(),
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
    } for r in rows]


async def create_release(
    db: AsyncSession,
    *,
    actor: User,
    platform: str,
    version: str,
    build_number: str | None = None,
    download_url: str | None = None,
    download_expires_at: datetime | None = None,
    signed: bool = False,
    build_metadata: dict | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """ثبت نسخهٔ منتشرشده — معمولاً توسط CI صدا زده می‌شود، نه دستی.

    signed فقط وقتی true می‌شود که بیلد واقعاً امضاشده باشد (§۱۵.۹).
    """
    if platform not in PLATFORMS:
        raise APIError(422, "bad_platform", f"پلتفرم نامعتبر: {platform}")
    if not version:
        raise APIError(422, "missing_version", "version الزامی است")
    rel = BuildRelease(
        platform=platform, version=version, build_number=build_number,
        download_url=download_url if signed else None,
        download_expires_at=download_expires_at,
        signed=signed, build_metadata=build_metadata or {},
        released_by=actor.id,
    )
    db.add(rel)
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="builds.release.create",
        entity_type="build_release", entity_id=str(rel.id),
        new_values={"platform": platform, "version": version,
                    "build_number": build_number, "signed": signed},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(rel)
    return _release_out(rel)
