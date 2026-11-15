"""رگرسیون باگ ذخیرهٔ تنظیمات حمایت — سناریوی مالک.

باگ: مالک می‌خواست فقط «کارت‌به‌کارت» را روشن کند (card_enabled + شماره
کارت + صاحب کارت) در حالی که بقیهٔ فیلدهای بخش پرداخت خالی بودند؛ ذخیره
۴۰۰ می‌خورد و هیچ‌چیز ذخیره نمی‌شد، چون update_settings همه‌یا‌هیچ است و
مقدار خالی/null/متن ساده برای کلیدهای json/localized خطای اعتبارسنجی بود.

پوشش این فایل:
- ذخیرهٔ فقط-کارت با خواهربرادرهای خالی ("" و null) موفق است و
  GET /finance/donation-methods دقیقاً فقط کارت را فهرست می‌کند.
- crypto_wallets نامعتبرِ غیرخالی همچنان ۴۰۰ واضح و کلیددار می‌گیرد.
- پرچم رشته‌ای "True" پذیرفته و به bool تبدیل می‌شود.
- متن سادهٔ فیلد راهنما به {"fa": ...} تبدیل می‌شود.
- secret خالی، کلید ذخیره‌شده را پاک نمی‌کند.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

BASE = "/api/v1"
CARD_NUMBER = "6037991234567890"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _settings_admin(tc) -> dict:
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perm = (
            await db.execute(
                select(Permission).where(Permission.key == "platform.settings")
            )
        ).scalar_one_or_none()
        if perm is None:
            perm = Permission(key="platform.settings", description="test")
            db.add(perm)
            await db.flush()
        role = Role(name=f"settings_test_role_{suffix}", description="test")
        db.add(role)
        await db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        user = User(
            full_name="ادمین تنظیمات",
            email=f"settings-{suffix}@example.com",
            phone=f"+98912{_uid()[:7]}",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _clean_settings_cache():
    from app.core.platform_settings import reset_settings_cache

    reset_settings_cache()
    yield
    reset_settings_cache()


async def _put(client, headers, payload: dict):
    return await client.put(
        f"{BASE}/admin/settings", headers=headers, json={"settings": payload}
    )


async def _get_settings_map(client, headers) -> dict:
    r = await client.get(f"{BASE}/admin/settings", headers=headers)
    assert r.status_code == 200, r.text
    return {i["key"]: i["value"] for i in r.json()["settings"]}


async def test_card_only_save_with_empty_siblings(tc):
    """سناریوی دقیق مالک: فقط کارت پر است؛ بقیه "" یا null → ذخیره موفق."""
    client = tc["client"]
    headers = await _settings_admin(tc)

    r = await _put(client, headers, {
        "donation.card_enabled": True,
        "donation.card_number": CARD_NUMBER,
        "donation.card_holder": "حسین تست",
        # خواهربرادرهای خالی — قبل از fix هر کدام به‌تنهایی کل ذخیره را ۴۰۰ می‌کرد
        "donation.card_instructions": "",
        "donation.crypto_enabled": None,
        "donation.crypto_wallets": "",
        "donation.crypto_instructions": "",
        "donation.paypal_enabled": "",
        "donation.online_enabled": "",
        "payment.idpay_sandbox": "",
    })
    assert r.status_code == 200, r.text
    updated = set(r.json()["updated"])
    assert updated == {
        "donation.card_enabled",
        "donation.card_number",
        "donation.card_holder",
    }

    # جریان عمومی: دقیقاً فقط کارت‌به‌کارت فهرست می‌شود
    r = await client.get(f"{BASE}/finance/donation-methods")
    assert r.status_code == 200, r.text
    methods = r.json()["methods"]
    assert [m["method"] for m in methods] == ["card"]
    assert methods[0]["card_number"] == CARD_NUMBER
    assert methods[0]["card_holder"] == "حسین تست"


async def test_malformed_crypto_wallets_still_rejected(tc):
    """مقدار غیرخالیِ واقعاً نامعتبر همچنان خطای واضحِ کلیددار می‌گیرد."""
    client = tc["client"]
    headers = await _settings_admin(tc)

    r = await _put(client, headers, {"donation.crypto_wallets": "[{not json"})
    assert r.status_code == 400, r.text
    err = r.json()["error"]
    assert err["code"] == "invalid_setting_value"
    assert "donation.crypto_wallets" in err["message"]

    # JSON سالم ولی ساختار ناقص (آدرس ندارد) هم رد می‌شود
    r = await _put(client, headers, {
        "donation.crypto_wallets": [{"currency": "USDT", "network": "TRC20"}]
    })
    assert r.status_code == 400, r.text
    assert "donation.crypto_wallets" in r.json()["error"]["message"]

    # و JSON سالمِ کامل قبول می‌شود
    r = await _put(client, headers, {
        "donation.crypto_wallets": [
            {"currency": "USDT", "network": "TRC20", "address": "TXyz123"}
        ]
    })
    assert r.status_code == 200, r.text
    values = await _get_settings_map(client, headers)
    assert values["donation.crypto_wallets"] == [
        {"currency": "USDT", "network": "TRC20", "address": "TXyz123"}
    ]


async def test_flag_accepts_string_true_variants(tc):
    """پرچم تایپ‌شده با دست («True») نباید ذخیره را منفجر کند."""
    client = tc["client"]
    headers = await _settings_admin(tc)

    r = await _put(client, headers, {"donation.card_enabled": "True"})
    assert r.status_code == 200, r.text
    values = await _get_settings_map(client, headers)
    assert values["donation.card_enabled"] is True

    # مقدار واقعاً نامعتبر همچنان خطاست
    r = await _put(client, headers, {"donation.card_enabled": "yes-please"})
    assert r.status_code == 400, r.text
    assert "donation.card_enabled" in r.json()["error"]["message"]


async def test_plain_text_instructions_become_fa_localized(tc):
    """متن ساده در فیلد راهنما به آبجکت سه‌زبانه با fa تبدیل می‌شود."""
    client = tc["client"]
    headers = await _settings_admin(tc)

    r = await _put(client, headers, {
        "donation.card_instructions": "بعد از واریز، رسید را بفرستید"
    })
    assert r.status_code == 200, r.text
    values = await _get_settings_map(client, headers)
    assert values["donation.card_instructions"] == {
        "fa": "بعد از واریز، رسید را بفرستید"
    }


async def test_empty_secret_does_not_wipe_existing_key(tc):
    """secret خالی = بدون تغییر (تکمیل قرارداد MASKED) — پاک‌شدن ممنوع."""
    client = tc["client"]
    headers = await _settings_admin(tc)

    r = await _put(client, headers, {"payment.zarinpal_key": "sk-real-123"})
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == ["payment.zarinpal_key"]

    r = await _put(client, headers, {"payment.zarinpal_key": ""})
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == []

    from app.core.platform_settings import get_setting

    async with tc["maker"]() as db:
        assert await get_setting(db, "payment.zarinpal_key") == "sk-real-123"
