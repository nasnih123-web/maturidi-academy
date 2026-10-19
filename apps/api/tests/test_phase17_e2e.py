"""تست‌های فاز ۱۷ (Track 2) — E2E smoke: سفرهای بحرانی کاربر، سرتاسری.

یک کاربر واقعی از ثبت‌نام تا رسید اهدا — hermetic:
- دیتابیس تست جدا (tc)، بدون شبکهٔ خارجی
- زرین‌پال با httpx موک (sandbox، بدون پول واقعی)
- chunk نمایشی فتوا از seed_fatwa_demo (approved)

مراحل: ثبت‌نام → ورود → مرور خانه → پرسش فتوا → ثبت‌نام در هم‌گروهی →
اهدا (donate → callback → verify) → دانلود رسید PDF.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app.modules.finance import service as finance_service

BASE = "/api/v1"


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


class _ZarinPalFake:
    def __init__(self):
        self.box = {
            "authority": "AUTH-E2E-1",
            "ref_id": "REF-E2E-1",
            "verify_code": 100,
            "calls": {"request": 0, "verify": 0},
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/pg/v4/payment/request.json"):
            self.box["calls"]["request"] += 1
            return httpx.Response(
                200,
                json={"data": {"code": 100, "authority": self.box["authority"]},
                      "errors": []},
            )
        if path.endswith("/pg/v4/payment/verify.json"):
            self.box["calls"]["verify"] += 1
            return httpx.Response(
                200,
                json={"data": {"code": 100, "ref_id": self.box["ref_id"],
                               "card_pan": "6037-****-1234"}, "errors": []},
            )
        return httpx.Response(404, json={})


@pytest.fixture()
def zfake(monkeypatch):
    fake = _ZarinPalFake()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    old = finance_service._TEST_HTTP_CLIENT
    finance_service._TEST_HTTP_CLIENT = client
    yield fake
    finance_service._TEST_HTTP_CLIENT = old


async def _stage_pay_settings(db_session) -> None:
    from app.core.platform_settings import reset_settings_cache, stage_setting

    await stage_setting(db_session, "payment.zarinpal_key", "test-merchant-key-xyz")
    await stage_setting(db_session, "payment.callback_url", "http://test/finance/callback")
    await stage_setting(db_session, "payment.zarinpal_sandbox", "true")
    await db_session.commit()
    reset_settings_cache()


async def test_e2e_full_user_journey(tc, db_session, zfake):
    from app.modules.fatwa.service import reset_ai_limits
    from app.seed_fatwa import seed_fatwa_demo
    from app.models.models import Course, CourseCohort, Donation

    client = tc["client"]
    suffix = uuid.uuid4().hex[:8]
    email = f"p17e2e-{suffix}@example.com"

    # ۱) ثبت‌نام
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={"full_name": "مسافر سرتاسری", "email": email,
              "password": "TestPass123", "locale": "fa", "accept_terms": True},
    )
    assert r.status_code == 201, r.text
    user_id = r.json()["id"]

    # ۲) ورود
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # ۳) مرور خانه (بخش‌های واقعی از API)
    r = await client.get(f"{BASE}/home/sections")
    assert r.status_code == 200, r.text
    assert isinstance(r.json().get("sections"), list)

    # ۴) پرسش فتوا (chunk نمایشی تأییدشده)
    async with tc["maker"]() as db:
        await seed_fatwa_demo(db)
        await db.commit()
    reset_ai_limits()
    r = await client.post(
        f"{BASE}/fatwa/ask",
        json={"question": "پاسخ‌های فقهی (فتوا) بر مبنای کدام مذهب و کلام تهیه می‌شوند؟",
              "locale": "fa", "top_k": 5},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    ask = r.json()
    assert ask["citations"], "فتوا باید منبع بازیابی کند"
    assert ask["status"] == "llm_unavailable"
    assert ask["answer"] is None

    # ۵) ثبت‌نام در هم‌گروهی (course + cohort مستقیم در DB)
    async with tc["maker"]() as db:
        course = Course(title={"fa": "دوره E2E"})
        db.add(course)
        await db.flush()
        cohort = CourseCohort(
            course_id=course.id,
            title={"fa": "هم‌گروهی E2E"},
            starts_at=datetime.now(timezone.utc) + timedelta(days=1),
            ends_at=datetime.now(timezone.utc) + timedelta(days=30),
            max_seats=50,
            is_open=True,
        )
        db.add(cohort)
        await db.commit()
        cohort_id = str(cohort.id)
    r = await client.post(f"{BASE}/lms/cohorts/{cohort_id}/enroll", headers=headers)
    assert r.status_code in (200, 201), r.text
    assert r.json()["cohort_id"] == cohort_id

    # ۶) اهدا: donate → callback → verify (موک)
    await _stage_pay_settings(db_session)
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"p17e2e-{suffix}", **headers},
        json={"amount": 500_000, "callback_url": "http://test/finance/callback",
              "donor_name": "مسافر سرتاسری"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["pay_url"].startswith("https://sandbox.zarinpal.com/pg/StartPay/")

    cb = await client.get(
        f"{BASE}/finance/callback",
        params={"Authority": "AUTH-E2E-1", "Status": "OK"},
    )
    assert cb.status_code == 200, cb.text
    assert cb.json()["status"] == "succeeded"
    donation_id = cb.json()["donation_id"]
    assert donation_id

    # پیوند سرتاسری: donation متعلق به همین کاربر است
    async with tc["maker"]() as db:
        donation = await db.get(Donation, uuid.UUID(donation_id))
        assert str(donation.donor_id) == user_id
        assert donation.amount == 500_000
        assert donation.gateway_reference == "REF-E2E-1"

    # ۷) دانلود رسید PDF
    rec = await client.get(f"{BASE}/finance/receipts/{donation_id}", headers=headers)
    assert rec.status_code == 200, rec.text
    assert rec.headers["content-type"] == "application/pdf"
    assert rec.content[:4] == b"%PDF"
    assert len(rec.content) > 1000  # رسید واقعی، نه placeholder


async def test_e2e_donate_requires_idempotency_key(tc, db_session, zfake):
    """در سفر واقعی هم کلید idempotency اجباری است (قرارداد §۱)."""
    await _stage_pay_settings(db_session)
    r = await tc["client"].post(
        f"{BASE}/finance/donate",
        json={"amount": 10_000, "callback_url": "http://test/finance/callback"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "missing_idempotency_key"
