"""تست‌های نشانک «ذخیره» ویدیو + حضور published_at در خروجی عمومی.

پوشش:
- published_at آیتم منتشرشده در فهرست عمومی و جزئیات تماشا برمی‌گردد
- GET وضعیت برای مهمان ۲۰۰ با saved=False (نه ۴۰۱)
- POST/DELETE و فهرست ذخیره‌ها بدون توکن ۴۰۱
- ذخیره → وضعیت True → فهرست ذخیره‌ها آیتم را دارد → حذف → False
- idempotent بودن ذخیره و حذف دوباره
- جداسازی کاربرها: ذخیرهٔ کاربر دیگر دیده نمی‌شود
- آیتم‌های غیر ویدیویی کتابخانه (pdf و audio/درس) هم ذخیره می‌شوند و
  در فهرست با kind خودشان برمی‌گردند؛ آیتم غایب ۴۰۴
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

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
            full_name="کاربر تست ذخیره",
            email=f"saved-{suffix}@example.com",
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


async def _make_item(tc, *, kind: str = "video", published: bool = True) -> str:
    from app.models.models import LibraryItem

    async with tc["maker"]() as db:
        item = LibraryItem(
            kind=kind,
            title=_L("ویدیوی تست ذخیره"),
            description=_L("توضیح تست"),
            cover_media_key=f"library/covers/{_uid()}.jpg",
            media_key=f"library/{kind}/{_uid()}.mp4",
            topic_tags=[],
            visibility="public",
            workflow_status="published" if published else "draft",
            duration_seconds=600,
            published_at=datetime.now(UTC) if published else None,
        )
        db.add(item)
        await db.commit()
        return str(item.id)


def _url(item_id: str) -> str:
    return f"{BASE}/videos/{item_id}/saved"


async def test_published_at_in_public_payloads(tc):
    client = tc["client"]
    item_id = await _make_item(tc)
    r = await client.get(f"{BASE}/videos")
    assert r.status_code == 200, r.text
    mine = [i for i in r.json()["items"] if i["id"] == item_id]
    assert len(mine) == 1
    assert mine[0]["published_at"] is not None
    r = await client.get(f"{BASE}/videos/{item_id}")
    assert r.status_code == 200, r.text
    assert r.json()["item"]["published_at"] is not None


async def test_saved_state_guest_is_false(tc):
    client = tc["client"]
    item_id = await _make_item(tc)
    r = await client.get(_url(item_id))
    assert r.status_code == 200, r.text
    assert r.json() == {"item_id": item_id, "saved": False}


async def test_saved_writes_require_auth(tc):
    client = tc["client"]
    item_id = await _make_item(tc)
    r = await client.post(_url(item_id))
    assert r.status_code == 401, r.text
    r = await client.delete(_url(item_id))
    assert r.status_code == 401, r.text
    r = await client.get(f"{BASE}/videos/saved")
    assert r.status_code == 401, r.text


async def test_save_unsave_flow_and_isolation(tc):
    client = tc["client"]
    me = await _make_user(tc)
    other = await _make_user(tc)
    item_id = await _make_item(tc)

    r = await client.post(_url(item_id), headers=me)
    assert r.status_code == 200, r.text
    assert r.json() == {"item_id": item_id, "saved": True}

    # ذخیرهٔ دوباره idempotent است
    r = await client.post(_url(item_id), headers=me)
    assert r.status_code == 200, r.text
    assert r.json()["saved"] is True

    r = await client.get(_url(item_id), headers=me)
    assert r.json()["saved"] is True

    # کاربر دیگر ذخیرهٔ من را نمی‌بیند
    r = await client.get(_url(item_id), headers=other)
    assert r.json()["saved"] is False

    # فهرست ذخیره‌های من آیتم را دارد؛ مال کاربر دیگر ندارد
    r = await client.get(f"{BASE}/videos/saved", headers=me)
    assert r.status_code == 200, r.text
    assert item_id in [i["id"] for i in r.json()["items"]]
    r = await client.get(f"{BASE}/videos/saved", headers=other)
    assert item_id not in [i["id"] for i in r.json()["items"]]

    r = await client.delete(_url(item_id), headers=me)
    assert r.status_code == 200, r.text
    assert r.json() == {"item_id": item_id, "saved": False}

    # حذف دوباره هم idempotent است
    r = await client.delete(_url(item_id), headers=me)
    assert r.status_code == 200, r.text
    r = await client.get(_url(item_id), headers=me)
    assert r.json()["saved"] is False


async def test_save_accepts_non_video_library_items(tc):
    """ذخیره دیگر فقط ویدیویی نیست: pdf و audio (درس) هم ذخیره می‌شوند
    و در فهرست ذخیره‌ها با kind خودشان دیده می‌شوند."""
    client = tc["client"]
    me = await _make_user(tc)
    pdf_id = await _make_item(tc, kind="pdf")
    audio_id = await _make_item(tc, kind="audio")

    for item_id in (pdf_id, audio_id):
        r = await client.post(_url(item_id), headers=me)
        assert r.status_code == 200, r.text
        assert r.json() == {"item_id": item_id, "saved": True}
        r = await client.get(_url(item_id), headers=me)
        assert r.json()["saved"] is True

    r = await client.get(f"{BASE}/videos/saved", headers=me)
    assert r.status_code == 200, r.text
    by_id = {i["id"]: i for i in r.json()["items"]}
    assert pdf_id in by_id and by_id[pdf_id]["kind"] == "pdf"
    assert audio_id in by_id and by_id[audio_id]["kind"] == "audio"


async def test_save_missing_item_is_404(tc):
    client = tc["client"]
    me = await _make_user(tc)
    missing = str(uuid.uuid4())
    r = await client.post(_url(missing), headers=me)
    assert r.status_code == 404, r.text
    r = await client.delete(_url(missing), headers=me)
    assert r.status_code == 404, r.text
