"""تست‌های موقعیت پخش ویدیو — ادامهٔ تماشا (resume) در پلیر حرفه‌ای.

پوشش:
- بدون توکن ۴۰۱ (GET و PUT)
- GET قبل از هر ذخیره‌ای ۲۰۰ با position خالی برمی‌گرداند (نه ۴۰۴)
- PUT آپسرت است: ساخت + به‌روزرسانی همان ردیف، و GET مقدار ذخیره‌شده را می‌دهد
- جداسازی کاربرها: پیشرفت کاربر دیگر هرگز دیده نمی‌شود
- آیتم غیر ویدیویی (pdf) ۴۲۲ not_a_video و آیتم غایب ۴۰۴
- position منفی ۴۲۲ اعتبارسنجی
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select

BASE = "/api/v1"


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc):
    """کاربر تست ساده (بدون مجوز خاص) + هدر احراز — الگوی تست‌های ویدیو."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import User

    suffix = _uid()
    async with tc["maker"]() as db:
        user = User(
            full_name="کاربر تست پیشرفت",
            email=f"prog-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        token = create_access_token(str(user.id))
        user_id = str(user.id)
    return {"Authorization": f"Bearer {token}", "user_id": user_id}


async def _make_item(tc, *, kind: str = "video") -> str:
    from app.models.models import LibraryItem

    async with tc["maker"]() as db:
        item = LibraryItem(
            kind=kind,
            title=_L("ویدیوی تست پیشرفت"),
            description=_L("توضیح تست"),
            cover_media_key=f"library/covers/{_uid()}.jpg",
            media_key=f"library/{kind}/{_uid()}.mp4",
            topic_tags=[],
            visibility="public",
            workflow_status="published",
            duration_seconds=600,
        )
        db.add(item)
        await db.commit()
        return str(item.id)


def _url(item_id: str) -> str:
    return f"{BASE}/videos/{item_id}/progress"


async def test_progress_requires_auth(tc):
    client = tc["client"]
    item_id = await _make_item(tc)
    r = await client.get(_url(item_id))
    assert r.status_code == 401, r.text
    r = await client.put(_url(item_id), json={"position_seconds": 10})
    assert r.status_code == 401, r.text


async def test_progress_get_empty_returns_null_position(tc):
    client = tc["client"]
    user = await _make_user(tc)
    item_id = await _make_item(tc)
    r = await client.get(_url(item_id), headers=user)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item_id"] == item_id
    assert body["position_seconds"] is None
    assert body["duration_seconds"] is None
    assert body["updated_at"] is None


async def test_progress_upsert_create_update_and_get(tc):
    from app.models.models import UserVideoProgress

    client = tc["client"]
    user = await _make_user(tc)
    item_id = await _make_item(tc)

    r = await client.put(
        _url(item_id),
        json={"position_seconds": 42.5, "duration_seconds": 600},
        headers=user,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["position_seconds"] == 42.5
    assert body["duration_seconds"] == 600
    assert body["updated_at"] is not None

    # به‌روزرسانی همان ردیف — duration وقتی نفرستیم دست نمی‌خورد
    r = await client.put(
        _url(item_id), json={"position_seconds": 100}, headers=user
    )
    assert r.status_code == 200, r.text
    assert r.json()["position_seconds"] == 100
    assert r.json()["duration_seconds"] == 600

    r = await client.get(_url(item_id), headers=user)
    assert r.status_code == 200, r.text
    assert r.json()["position_seconds"] == 100

    async with tc["maker"]() as db:
        count = (
            await db.execute(
                select(func.count())
                .select_from(UserVideoProgress)
                .where(UserVideoProgress.item_id == uuid.UUID(item_id))
            )
        ).scalar_one()
    assert count == 1


async def test_progress_isolated_per_user(tc):
    client = tc["client"]
    alice = await _make_user(tc)
    bob = await _make_user(tc)
    item_id = await _make_item(tc)

    r = await client.put(
        _url(item_id), json={"position_seconds": 300}, headers=alice
    )
    assert r.status_code == 200, r.text

    # باب هیچ پیشرفتی ندارد — ردیف آلیس نباید لو برود
    r = await client.get(_url(item_id), headers=bob)
    assert r.status_code == 200, r.text
    assert r.json()["position_seconds"] is None

    r = await client.put(
        _url(item_id), json={"position_seconds": 10}, headers=bob
    )
    assert r.status_code == 200, r.text

    r = await client.get(_url(item_id), headers=alice)
    assert r.json()["position_seconds"] == 300
    r = await client.get(_url(item_id), headers=bob)
    assert r.json()["position_seconds"] == 10


async def test_progress_rejects_non_video_and_missing_item(tc):
    client = tc["client"]
    user = await _make_user(tc)
    pdf_id = await _make_item(tc, kind="pdf")

    r = await client.put(
        _url(pdf_id), json={"position_seconds": 5}, headers=user
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "not_a_video"
    r = await client.get(_url(pdf_id), headers=user)
    assert r.status_code == 422, r.text

    missing = str(uuid.uuid4())
    r = await client.put(
        _url(missing), json={"position_seconds": 5}, headers=user
    )
    assert r.status_code == 404, r.text
    r = await client.get(_url(missing), headers=user)
    assert r.status_code == 404, r.text


async def test_progress_rejects_negative_position(tc):
    client = tc["client"]
    user = await _make_user(tc)
    item_id = await _make_item(tc)
    r = await client.put(
        _url(item_id), json={"position_seconds": -1}, headers=user
    )
    assert r.status_code == 422, r.text
