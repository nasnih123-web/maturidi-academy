"""FIX2-07 — اعتبارسنجی download_url دستی + اعمال انقضا روی مسیر سرو.

باگ: ReleaseCreateIn.download_url هر رشته‌ای را می‌پذیرفت و
_release_out آن را بدون بررسی scheme/host و بدون اعمال
download_expires_at برمی‌گرداند — لینک خارجی دلخواه برای همیشه
به‌عنوان دانلود رسمی بیلد امضاشده در CRM نمایش داده می‌شد.

قرارداد جدید (ADR-0045):
- فقط https (http فقط localhost) و فقط میزبان‌های شناخته‌شدهٔ پروژه
  (S3_ENDPOINT_PUBLIC / BUILDS_S3_ENDPOINT_PUBLIC / APP_BASE_URL).
- لینک منقضی دیگر سرو نمی‌شود: download_url=None و
  download_expired=True.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete

from app.core.errors import APIError
from app.models.models import BuildRelease
from app.modules.admin.builds_service import create_release, list_releases

_ALLOWED = "https://localhost:8000/builds/app.apk"  # localhost از APP_BASE_URL


@pytest.fixture(autouse=True)
async def _cleanup_releases(tc):
    """دیتابیس تست بین فایل‌ها مشترک است — releaseهای این فایل پاک شوند."""
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(BuildRelease).where(BuildRelease.version == "9.9.9")
        )
        await db.commit()


async def _create(db, **kwargs):
    kwargs.setdefault("platform", "android")
    kwargs.setdefault("version", "9.9.9")
    kwargs.setdefault("signed", True)
    return await create_release(db, actor=None, **kwargs)


async def test_arbitrary_external_url_rejected_at_create(tc):
    async with tc["maker"]() as db:
        with pytest.raises(APIError) as excinfo:
            await _create(db, download_url="https://evil.example.net/app.apk")
        assert excinfo.value.status_code == 422
        assert excinfo.value.code == "bad_download_url"


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://storage.example.org/app.apk",  # http غیر localhost
        "ftp://localhost:8000/app.apk",
        "javascript:alert(1)",
        "https://user:pass@localhost:8000/app.apk",
        "https://storage.example.org/app.apk",
        "not-a-url",
    ],
)
async def test_bad_download_urls_rejected(tc, bad_url):
    async with tc["maker"]() as db:
        with pytest.raises(APIError) as excinfo:
            await _create(db, download_url=bad_url)
        assert excinfo.value.code == "bad_download_url"


async def test_allowed_host_url_accepted_and_served(tc):
    async with tc["maker"]() as db:
        out = await _create(db, download_url=_ALLOWED)
        assert out["download_url"] == _ALLOWED
        assert out["download_expired"] is False


async def test_expired_release_is_not_served(tc):
    past = datetime.now(UTC) - timedelta(hours=1)
    async with tc["maker"]() as db:
        out = await _create(
            db, download_url=_ALLOWED, download_expires_at=past
        )
        assert out["download_url"] is None
        assert out["download_expired"] is True
        # مسیر فهرست (همان _release_out) هم لینک منقضی نمی‌دهد
        rows = await list_releases(db, platform="android")
        mine = [r for r in rows if r["version"] == "9.9.9"]
        assert mine and mine[0]["download_url"] is None
        assert mine[0]["download_expired"] is True


async def test_future_expiry_still_served(tc):
    future = datetime.now(UTC) + timedelta(days=1)
    async with tc["maker"]() as db:
        out = await _create(
            db, download_url=_ALLOWED, download_expires_at=future
        )
        assert out["download_url"] == _ALLOWED
        assert out["download_expired"] is False
