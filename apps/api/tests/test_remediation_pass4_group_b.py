"""Remediation Pass 4 — Group B2: idempotent POST /releases.

- Same artifact_key + same metadata → the existing record, no duplicate.
- Same artifact_key + different metadata → 409 release_conflict.
- A rerun after a partial success recovers: succeeded files are not
  re-registered, only the missing ones are added.
"""
from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.core.errors import APIError
from app.models.models import BuildRelease
from app.modules.admin import builds_service as svc

pytestmark = pytest.mark.asyncio

_SHA = "ab" * 32


class _FakeStorage:
    async def get_presigned_url(self, key, expires_seconds=None):
        return f"https://storage.example.test/{key}"


@pytest.fixture(autouse=True)
async def _cleanup(tc):
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(BuildRelease).where(BuildRelease.version == "9.9.9-pass4")
        )
        await db.commit()


async def _create(db, **kwargs):
    kwargs.setdefault("platform", "android")
    kwargs.setdefault("version", "9.9.9-pass4")
    kwargs.setdefault("build_number", "42")
    kwargs.setdefault("storage", _FakeStorage())
    return await svc.create_release(db, actor=None, **kwargs)


async def _count(db, artifact_key):
    rows = (
        await db.execute(
            select(BuildRelease).where(BuildRelease.artifact_key == artifact_key)
        )
    ).scalars().all()
    return len(rows)


async def test_b2_duplicate_post_returns_existing_without_duplicate(tc):
    async with tc["maker"]() as db:
        first = await _create(
            db, artifact_key="builds/android/9.9.9-pass4/42/app.apk",
            file_size_bytes=1234, sha256=_SHA, signed=False,
        )
        second = await _create(
            db, artifact_key="builds/android/9.9.9-pass4/42/app.apk",
            file_size_bytes=1234, sha256=_SHA, signed=False,
            # per-run values differ on a rerun — must NOT conflict:
            build_metadata={"workflow_run": "runs/999"},
        )
        assert second["id"] == first["id"]
        assert await _count(db, "builds/android/9.9.9-pass4/42/app.apk") == 1


async def test_b2_same_key_different_sha_is_409(tc):
    async with tc["maker"]() as db:
        await _create(
            db, artifact_key="builds/android/9.9.9-pass4/42/app.apk",
            file_size_bytes=1234, sha256=_SHA, signed=False,
        )
        with pytest.raises(APIError) as excinfo:
            await _create(
                db, artifact_key="builds/android/9.9.9-pass4/42/app.apk",
                file_size_bytes=1234, sha256="cd" * 32, signed=False,
            )
        assert excinfo.value.status_code == 409
        assert excinfo.value.code == "release_conflict"
        assert await _count(db, "builds/android/9.9.9-pass4/42/app.apk") == 1


async def test_b2_partial_rerun_recovers_only_missing_files(tc):
    """شبیه‌سازی rerun اسکریپت پس از موفقیت نصفه: فایل اول از قبل
    ثبت شده، فایل دوم تازه است — هر دو در پایان دقیقاً یک رکورد دارند."""
    async with tc["maker"]() as db:
        await _create(
            db, artifact_key="builds/android/9.9.9-pass4/42/app.apk",
            file_size_bytes=100, sha256=_SHA, signed=False,
        )
        # rerun: فایل اول (replay) + فایل دوم (جدید)
        await _create(
            db, artifact_key="builds/android/9.9.9-pass4/42/app.apk",
            file_size_bytes=100, sha256=_SHA, signed=False,
        )
        await _create(
            db, artifact_key="builds/android/9.9.9-pass4/42/app.aab",
            file_size_bytes=200, sha256="ef" * 32, signed=False,
        )
        assert await _count(db, "builds/android/9.9.9-pass4/42/app.apk") == 1
        assert await _count(db, "builds/android/9.9.9-pass4/42/app.aab") == 1
