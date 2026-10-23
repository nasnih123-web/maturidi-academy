"""FIX2-11 — نگهداری انتشارها بر اساس گروه انتشار، نه تک‌رکورد.

باگ: prune_releases ده رکورد آخر را نگه می‌داشت؛ هر فایل یک رکورد
است، پس انتشار desktop سه‌فایلی (نصب‌کننده + امضا + مانیفست) سه
سهمیه می‌سوزاند و زودتر از انتشارهای تک‌فایلی پاک می‌شد.

قرارداد جدید: گروه = (platform, version, build_number)؛ ده گروه آخر
با همهٔ فایل‌هایشان می‌مانند؛ حذف فایل از storage همچنان best-effort.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select

from app.core.storage import LocalStorageProvider
from app.models.models import BuildRelease
from app.modules.admin.builds_service import prune_releases

_BASE = datetime(2026, 1, 1, tzinfo=UTC)


# پارتیشن پلتفرم اختصاصی این فایل: prune پلتفرم‌محور است و دیتابیس
# تست بین فایل‌ها مشترک؛ این مقدار جدا، شمارش را از انتشارهای
# فایل‌های دیگر مصون می‌کند (ستون platform در ORM آزاد است).
PLATFORM = "desktop-fix2"


@pytest.fixture(autouse=True)
async def _cleanup(tc):
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(BuildRelease).where(BuildRelease.platform == PLATFORM)
        )
        await db.commit()


async def _release(db, storage, *, version, build, fname, day):
    key = f"builds/{version}/{fname}"
    await storage.put_object(key, b"payload", "application/octet-stream")
    rel = BuildRelease(
        platform=PLATFORM,
        version=version,
        build_number=build,
        artifact_key=key,
        created_at=_BASE + timedelta(days=day),
    )
    db.add(rel)
    await db.flush()
    return rel


async def _remaining_versions(db) -> list[str]:
    rows = (
        await db.execute(
            select(BuildRelease)
            .where(BuildRelease.platform == PLATFORM)
            .order_by(BuildRelease.created_at)
        )
    ).scalars().all()
    return [(r.version, r.build_number, r.artifact_key) for r in rows]


async def test_three_file_release_consumes_one_slot(tc, tmp_path):
    storage = LocalStorageProvider(str(tmp_path))
    async with tc["maker"]() as db:
        # تازه‌ترین گروه: انتشار سه‌فایلی desktop
        await _release(db, storage, version="g3", build="30", fname="app.msi", day=3)
        await _release(db, storage, version="g3", build="30", fname="app.msi.sig", day=3)
        await _release(db, storage, version="g3", build="30", fname="manifest.json", day=3)
        await _release(db, storage, version="g2", build="20", fname="app.msi", day=2)
        await _release(db, storage, version="g1", build="10", fname="app.msi", day=1)
        await db.commit()

        deleted = await prune_releases(db, platform=PLATFORM, keep=2, storage=storage)

        # فقط گروه g1 (یک رکورد) حذف می‌شود — نه دو رکورد از ته فهرست
        assert deleted == 1
        remaining = await _remaining_versions(db)
        assert len(remaining) == 4
        assert {v for v, _, _ in remaining} == {"g3", "g2"}
        # هر سه فایل گروه نگه‌داشته‌شده سر جایش است
        for _, _, key in remaining:
            assert await storage.read_bytes(key) == b"payload"


async def test_mixed_groups_prune_correctly_and_delete_files(tc, tmp_path):
    storage = LocalStorageProvider(str(tmp_path))
    async with tc["maker"]() as db:
        await _release(db, storage, version="g3", build="30", fname="a.bin", day=3)
        await _release(db, storage, version="g3", build="30", fname="b.bin", day=3)
        await _release(db, storage, version="g2", build="20", fname="a.bin", day=2)
        await _release(db, storage, version="g2", build="20", fname="b.bin", day=2)
        await _release(db, storage, version="g2", build="20", fname="c.bin", day=2)
        await _release(db, storage, version="g1", build="10", fname="a.bin", day=1)
        await db.commit()

        deleted = await prune_releases(db, platform=PLATFORM, keep=1, storage=storage)

        assert deleted == 4  # سه فایل g2 + یک فایل g1
        remaining = await _remaining_versions(db)
        assert {v for v, _, _ in remaining} == {"g3"}
        # فایل‌های حذف‌شده از storage هم رفته‌اند (best-effort ولی موفق)
        import os

        for gone in ("g2/a.bin", "g2/b.bin", "g2/c.bin", "g1/a.bin"):
            assert not os.path.exists(tmp_path / "builds" / gone)
        for kept in ("g3/a.bin", "g3/b.bin"):
            assert os.path.exists(tmp_path / "builds" / kept)
