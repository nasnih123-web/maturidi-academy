"""تست‌های فاز ۱۷ (Track 2) — GDPR واقعی: export کامل + حذف واقعی.

نه فقط 200 OK: محتوای export و اثر حذف مستقیم در DB راستی‌آزمایی می‌شود.

- export: پروفایل/نشست‌ها/رضایت‌ها/ترجیحات اعلان کامل و بدون password_hash؛
  برای ماژول‌هایی که export پوشش نمی‌دهد، تست xfail با دلیل دقیق ثبت شده
  (شکاف مستند برای Track 1) — نه پنهان، نه سبزِ جعلی.
- delete: ناشناس‌سازی واقعی — email/phone به NULL، نام جایگزین، توکن‌ها و
  نشست‌ها revoke؛ audit و رویداد دامنه (بدون دادهٔ شخصی) می‌مانند — تصمیم
  طراحی مستند در service.delete_account.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import func, select

BASE = "/api/v1"


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str, full_name: str = "کاربر حریم خصوصی") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": full_name,
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, email: str) -> str:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _make_user_with_data(tc):
    """کاربر + داده در چند ماژول: نشست، رضایت، ترجیحات، یادداشت قرآن، فتوا."""
    from app.modules.fatwa.service import reset_ai_limits

    client = tc["client"]
    suffix = uuid.uuid4().hex[:8]
    email = f"p17gdpr-{suffix}@example.com"
    me = await _register(client, email)
    token = await _login(client, email)
    headers = {"Authorization": f"Bearer {token}"}

    # یادداشت قرآن
    r = await client.post(
        f"{BASE}/quran/notes",
        json={"surah": 2, "ayah": 152, "note_text": "یادداشت حریم خصوصی",
              "is_private": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text

    # نشست فتوا (ask ناشناسِ بدون کاربر کافی نیست — با توکن می‌پرسیم تا user_id ثبت شود)
    reset_ai_limits()
    r = await client.post(
        f"{BASE}/fatwa/ask",
        json={"question": "پرسش حریم خصوصی p17gdpr", "locale": "fa", "top_k": 3},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return me, token, headers


# --- export --------------------------------------------------------------------


async def test_export_contains_core_personal_data(tc):
    me, token, headers = await _make_user_with_data(tc)
    client = tc["client"]

    r = await client.post(f"{BASE}/users/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()

    # پروفایل کامل
    assert data["profile"]["id"] == me["id"]
    assert data["profile"]["email"] == me["email"]
    assert data["profile"]["full_name"] == "کاربر حریم خصوصی"
    assert data["profile"]["locale"] == "fa"

    # نشست‌ها: حداقل نشست لاگین فعلی
    assert len(data["sessions"]) >= 1

    # رضایت‌ها: terms + privacy از ثبت‌نام
    consent_types = {c["consent_type"] for c in data["consents"]}
    assert {"terms", "privacy"} <= consent_types

    # ترجیحات اعلان: ۵ کانال × ۳ نوع از ثبت‌نام
    assert len(data["notification_preferences"]) == 15

    # هیچ secretای در خروجی نیست
    blob = json.dumps(data, ensure_ascii=False)
    assert "password_hash" not in blob
    assert "$argon2" not in blob


async def test_export_event_and_audit_logged(tc):
    from app.models.models import AuditLog, DomainEvent

    me, token, headers = await _make_user_with_data(tc)
    await tc["client"].post(f"{BASE}/users/me/export", headers=headers)

    async with tc["maker"]() as db:
        ev = (
            await db.execute(
                select(DomainEvent).where(
                    DomainEvent.event_type == "user.data_exported",
                    DomainEvent.aggregate_id == me["id"],
                )
            )
        ).scalar_one_or_none()
        assert ev is not None
        log = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "user.data_export",
                    AuditLog.entity_id == me["id"],
                )
            )
        ).scalar_one_or_none()
        assert log is not None


# --- شکاف‌های مستند export (xfail صریح — برای Track 1) ---------------------------
# export فعلی فقط profile/sessions/consents/notification_preferences را
# برمی‌گرداند. این تست‌ها دقیقاً مشخص می‌کنند کدام ماژول جا مانده است.


@pytest.mark.xfail(
    strict=False,
    reason="GAP-P17-GDPR-1: export شامل fatwa_sessions/messages کاربر نیست — "
    "نیاز به الحاق ماژول فتوا در users.service.export_data (Track 1)",
)
async def test_export_includes_fatwa_history(tc):
    me, token, headers = await _make_user_with_data(tc)
    r = await tc["client"].post(f"{BASE}/users/me/export", headers=headers)
    data = r.json()
    assert "fatwa_sessions" in data and len(data["fatwa_sessions"]) >= 1


@pytest.mark.xfail(
    strict=False,
    reason="GAP-P17-GDPR-2: export شامل یادداشت‌های قرآن کاربر نیست — "
    "نیاز به الحاق ماژول quran در users.service.export_data (Track 1)",
)
async def test_export_includes_quran_notes(tc):
    me, token, headers = await _make_user_with_data(tc)
    r = await tc["client"].post(f"{BASE}/users/me/export", headers=headers)
    data = r.json()
    assert "quran_notes" in data and any(
        "حریم خصوصی" in (n.get("note_text") or "") for n in data["quran_notes"]
    )


@pytest.mark.xfail(
    strict=False,
    reason="GAP-P17-GDPR-3: export شامل اهداها/رسیدهای کاربر نیست — "
    "نیاز به الحاق ماژول finance در users.service.export_data (Track 1)",
)
async def test_export_includes_donations(tc):
    me, token, headers = await _make_user_with_data(tc)
    r = await tc["client"].post(f"{BASE}/users/me/export", headers=headers)
    data = r.json()
    assert "donations" in data


# --- delete: ناشناس‌سازی واقعی، راستی‌آزمایی در DB ---------------------------------


async def test_delete_anonymizes_personal_data_in_db(tc):
    from app.models.models import (
        AuditLog,
        DomainEvent,
        RefreshToken,
        Session,
        User,
    )

    me, token, headers = await _make_user_with_data(tc)
    client = tc["client"]
    user_id = uuid.UUID(me["id"])

    r = await client.delete(f"{BASE}/users/me", headers=headers)
    assert r.status_code == 200, r.text

    async with tc["maker"]() as db:
        user = await db.get(User, user_id)
        # شناسه‌های شخصی واقعاً رفته‌اند — نه فقط در پاسخ API
        assert user.email is None
        assert user.phone is None
        assert user.full_name == "حساب حذف‌شده"
        assert user.is_active is False
        assert user.is_verified is False
        assert user.totp_secret is None
        assert user.avatar_media_id is None

        # توکن‌ها و نشست‌ها revoke شده‌اند
        live_tokens = (
            await db.execute(
                select(func.count()).select_from(RefreshToken).where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked.is_(False),
                )
            )
        ).scalar()
        assert live_tokens == 0
        live_sessions = (
            await db.execute(
                select(func.count()).select_from(Session).where(
                    Session.user_id == user_id, Session.revoked.is_(False)
                )
            )
        ).scalar()
        assert live_sessions == 0

        # پاسخ‌گویی می‌ماند ولی بدون دادهٔ شخصی (§۱۴ — تصمیم طراحی مستند)
        log = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.action == "user.delete",
                    AuditLog.entity_id == str(user_id),
                )
            )
        ).scalar_one_or_none()
        assert log is not None
        assert log.new_values.get("anonymized") is True
        ev = (
            await db.execute(
                select(DomainEvent).where(
                    DomainEvent.event_type == "user.deleted",
                    DomainEvent.aggregate_id == str(user_id),
                )
            )
        ).scalar_one_or_none()
        assert ev is not None

    # توکن قبلی دیگر کار نمی‌کند
    r = await client.get(f"{BASE}/users/me", headers=headers)
    assert r.status_code in (401, 403)


async def test_delete_twice_is_safe(tc):
    me, token, headers = await _make_user_with_data(tc)
    client = tc["client"]
    r1 = await client.delete(f"{BASE}/users/me", headers=headers)
    assert r1.status_code == 200, r1.text
    # حذف دوم: یا 200 (idempotent) یا 401 (توکن باطل) — هر دو قابل‌قبول، نه 500
    r2 = await client.delete(f"{BASE}/users/me", headers=headers)
    assert r2.status_code in (200, 401), r2.text
