"""تست‌های نشانک «ذخیره» فتوا (موضوع‌های منتشرشدهٔ FiqhTopic).

پوشش:
- GET وضعیت برای مهمان ۲۰۰ با saved=False (نه ۴۰۱)
- POST/DELETE و فهرست ذخیره‌ها بدون توکن ۴۰۱
- ذخیره → وضعیت True → فهرست ذخیره‌ها فتوا را دارد → حذف → False
- idempotent بودن ذخیره و حذف دوباره
- جداسازی کاربرها: ذخیرهٔ کاربر دیگر دیده نمی‌شود
- فتوای منتشرنشده (draft) و فتوای غایب ۴۰۴ — ذخیره بازدید هم نمی‌شمارد
"""
from __future__ import annotations

import uuid

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
            full_name="کاربر تست ذخیره فتوا",
            email=f"fatwa-saved-{suffix}@example.com",
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


async def _make_topic(tc, *, published: bool = True) -> str:
    from app.models.models import FiqhTopic

    async with tc["maker"]() as db:
        topic = FiqhTopic(
            title=_L("فتوای تست ذخیره"),
            description=_L("توضیح فتوای تست"),
            workflow_status="published" if published else "draft",
        )
        db.add(topic)
        await db.commit()
        return str(topic.id)


def _url(fatwa_id: str) -> str:
    return f"{BASE}/fatwas/{fatwa_id}/saved"


async def test_saved_state_guest_is_false(tc):
    client = tc["client"]
    fatwa_id = await _make_topic(tc)
    r = await client.get(_url(fatwa_id))
    assert r.status_code == 200, r.text
    assert r.json() == {"fatwa_id": fatwa_id, "saved": False}


async def test_saved_writes_require_auth(tc):
    client = tc["client"]
    fatwa_id = await _make_topic(tc)
    r = await client.post(_url(fatwa_id))
    assert r.status_code == 401, r.text
    r = await client.delete(_url(fatwa_id))
    assert r.status_code == 401, r.text
    r = await client.get(f"{BASE}/fatwas/saved")
    assert r.status_code == 401, r.text


async def test_save_unsave_flow_and_isolation(tc):
    client = tc["client"]
    me = await _make_user(tc)
    other = await _make_user(tc)
    fatwa_id = await _make_topic(tc)

    r = await client.post(_url(fatwa_id), headers=me)
    assert r.status_code == 200, r.text
    assert r.json() == {"fatwa_id": fatwa_id, "saved": True}

    # ذخیرهٔ دوباره idempotent است
    r = await client.post(_url(fatwa_id), headers=me)
    assert r.status_code == 200, r.text
    assert r.json()["saved"] is True

    r = await client.get(_url(fatwa_id), headers=me)
    assert r.json()["saved"] is True

    # کاربر دیگر ذخیرهٔ من را نمی‌بیند
    r = await client.get(_url(fatwa_id), headers=other)
    assert r.json()["saved"] is False

    # فهرست ذخیره‌های من فتوا را (با عنوانش) دارد؛ مال کاربر دیگر ندارد
    r = await client.get(f"{BASE}/fatwas/saved", headers=me)
    assert r.status_code == 200, r.text
    mine = [i for i in r.json()["items"] if i["id"] == fatwa_id]
    assert len(mine) == 1
    assert mine[0]["title"]["fa"] == "فتوای تست ذخیره"
    r = await client.get(f"{BASE}/fatwas/saved", headers=other)
    assert fatwa_id not in [i["id"] for i in r.json()["items"]]

    r = await client.delete(_url(fatwa_id), headers=me)
    assert r.status_code == 200, r.text
    assert r.json() == {"fatwa_id": fatwa_id, "saved": False}

    # حذف دوباره هم idempotent است و فهرست دیگر فتوا را ندارد
    r = await client.delete(_url(fatwa_id), headers=me)
    assert r.status_code == 200, r.text
    r = await client.get(_url(fatwa_id), headers=me)
    assert r.json()["saved"] is False
    r = await client.get(f"{BASE}/fatwas/saved", headers=me)
    assert fatwa_id not in [i["id"] for i in r.json()["items"]]


async def test_save_unpublished_or_missing_is_404(tc):
    client = tc["client"]
    me = await _make_user(tc)
    draft_id = await _make_topic(tc, published=False)
    r = await client.post(_url(draft_id), headers=me)
    assert r.status_code == 404, r.text
    r = await client.delete(_url(draft_id), headers=me)
    assert r.status_code == 404, r.text
    missing = str(uuid.uuid4())
    r = await client.post(_url(missing), headers=me)
    assert r.status_code == 404, r.text


async def test_save_does_not_count_a_view(tc):
    """ذخیره‌کردن بازدید نیست: view_count فتوا نباید بالا برود."""
    from app.models.models import FiqhTopic

    client = tc["client"]
    me = await _make_user(tc)
    fatwa_id = await _make_topic(tc)
    r = await client.post(_url(fatwa_id), headers=me)
    assert r.status_code == 200, r.text
    async with tc["maker"]() as db:
        topic = await db.get(FiqhTopic, uuid.UUID(fatwa_id))
        assert topic.view_count == 0
