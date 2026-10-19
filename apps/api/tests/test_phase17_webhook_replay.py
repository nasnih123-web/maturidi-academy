"""تست‌های فاز ۱۷ (Track 2) — replay وبهوک پرداخت: موارد گمشده.

مکمل تست‌های فاز ۱۵ (تکراری نیست):
- وبهوکِ جلوتر از نیت (out-of-order): authority معتبر در درگاه ولی بدون نیت
  داخلی → 404 intent_not_found، بدون ساخت donation
- وبهوک دست‌کاری‌شده (مبلغ متفاوت از نیت) → حقیقت سمت‌سرور (مبلغ نیت) ثبت
  می‌شود، نه مبلغ وبهوک
- طوفان retry: ۱۲ بازپخش یکسان → دقیقاً ۱ donation، ۱ ردیف ledger، ۱ فراخوان
  verify، ۱ بار افزایش raised_amount کمپین
- وبهوک بعد از کال‌بک موفق → already_processed، بدون اثر دوم

همهٔ فراخوان‌های زرین‌پال با httpx موک شده‌اند (hermetic)؛ قرارداد ADR-0013.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import func, select

from app.modules.finance import service

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str) -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست وبهوک",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _stage_pay_settings(db_session) -> None:
    from app.core.platform_settings import reset_settings_cache, stage_setting

    await stage_setting(db_session, "payment.zarinpal_key", "test-merchant-key-xyz")
    await stage_setting(db_session, "payment.callback_url", "http://test/finance/callback")
    await stage_setting(db_session, "payment.zarinpal_sandbox", "true")
    await db_session.commit()
    reset_settings_cache()


class _ZarinPalFake:
    """httpx موک برای sandbox زرین‌پال — شمارش فراخوان‌ها."""

    def __init__(self):
        self.box = {
            "authority": "AUTH-TEST",
            "ref_id": "REF-TEST",
            "verify_code": 100,
            "calls": {"request": 0, "verify": 0},
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/pg/v4/payment/request.json"):
            self.box["calls"]["request"] += 1
            return httpx.Response(
                200,
                json={"data": {"code": 100, "authority": self.box["authority"]}, "errors": []},
            )
        if path.endswith("/pg/v4/payment/verify.json"):
            self.box["calls"]["verify"] += 1
            if self.box["verify_code"] != 100:
                return httpx.Response(
                    200, json={"data": {"code": self.box["verify_code"]}, "errors": {"e": 1}}
                )
            return httpx.Response(
                200,
                json={
                    "data": {"code": 100, "ref_id": self.box["ref_id"], "card_pan": "6037-****-1234"},
                    "errors": [],
                },
            )
        return httpx.Response(404, json={})


@pytest.fixture()
def zfake(monkeypatch):
    fake = _ZarinPalFake()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    old = service._TEST_HTTP_CLIENT
    service._TEST_HTTP_CLIENT = client
    yield fake
    service._TEST_HTTP_CLIENT = old


async def _donate(client, zfake, amount: int, authority: str, ref_id: str) -> dict:
    zfake.box["authority"] = authority
    zfake.box["ref_id"] = ref_id
    zfake.box["verify_code"] = 100
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"p17wh-{uuid.uuid4()}"},
        json={"amount": amount, "callback_url": "http://test/finance/callback"},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _donation_count(db_session, ref_id: str) -> int:
    from app.models.models import Donation

    return (
        await db_session.execute(
            select(func.count()).select_from(Donation).where(
                Donation.gateway_reference == ref_id
            )
        )
    ).scalar()


async def _ledger_rows_for_ref(db_session, ref_id: str):
    from app.models.models import Donation, LedgerEntry

    return (
        await db_session.execute(
            select(LedgerEntry)
            .join(Donation, LedgerEntry.donation_id == Donation.id)
            .where(Donation.gateway_reference == ref_id)
        )
    ).scalars().all()


# --- ۱) وبهوک جلوتر از نیت (out-of-order) -------------------------------------


async def test_webhook_before_intent_404_no_donation(tc, db_session, zfake):
    """درگاه authority را تأیید می‌کند ولی نیتی در DB نیست → 404 و هیچ donationای."""
    from app.models.models import Donation

    client = tc["client"]
    await _stage_pay_settings(db_session)
    zfake.box["authority"] = "AUTH-ORDER-1"
    zfake.box["ref_id"] = "REF-ORDER-1"
    zfake.box["verify_code"] = 100

    before = (await db_session.execute(select(func.count()).select_from(Donation))).scalar()
    r = await client.post(
        f"{BASE}/finance/webhook/zarinpal",
        json={"authority": "AUTH-ORDER-1", "amount": 250_000},
    )
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "intent_not_found"
    after = (await db_session.execute(select(func.count()).select_from(Donation))).scalar()
    assert after == before  # هیچ ردیفی ساخته نشد
    assert zfake.box["calls"]["verify"] == 1  # verify صدا زده شد ولی ثبت نشد


# --- ۲) وبهوک دست‌کاری‌شده: مبلغ وبهوک ≠ مبلغ نیت --------------------------------


async def test_webhook_tampered_amount_server_truth_wins(tc, db_session, zfake):
    """مهاجم مبلغ وبهوک را ۱ ریال می‌فرستد؛ ثبت با مبلغ واقعی نیت انجام می‌شود."""
    client = tc["client"]
    await _stage_pay_settings(db_session)
    await _donate(client, zfake, 300_000, "AUTH-TAMPER-1", "REF-TAMPER-1")

    r = await client.post(
        f"{BASE}/finance/webhook/zarinpal",
        json={"authority": "AUTH-TAMPER-1", "amount": 1},  # دست‌کاری‌شده
    )
    assert r.status_code == 200, r.text
    assert r.json()["already_processed"] is False

    rows = await _ledger_rows_for_ref(db_session, "REF-TAMPER-1")
    assert len(rows) == 1
    assert rows[0].amount == 300_000  # مبلغ نیت، نه مبلغ وبهوک


# --- ۳) طوفان retry: دقیقاً یک‌بار ثبت -------------------------------------------


async def test_webhook_retry_storm_exactly_once(tc, db_session, zfake):
    from app.models.models import PaymentIntent

    client = tc["client"]
    await _stage_pay_settings(db_session)

    # کمپین فعال — مستقیم در DB تا به مجوز ادمین نیاز نباشد
    from app.models.models import DonationCampaign, PaymentIntent

    async with tc["maker"]() as db:
        camp = DonationCampaign(
            title={"fa": "کمپین طوفان", "ar": "حملة", "en": "Storm"},
            description={"fa": "تست", "ar": "ت", "en": "t"},
            goal_amount=10_000_000,
            raised_amount=0,
            status="active",
        )
        db.add(camp)
        await db.commit()
        campaign_id = camp.id

    intent_json = await _donate(client, zfake, 150_000, "AUTH-STORM-1", "REF-STORM-1")
    async with tc["maker"]() as db:
        intent = await db.get(PaymentIntent, uuid.UUID(intent_json["intent_id"]))
        intent.campaign_id = campaign_id
        await db.commit()

    payload = {"authority": "AUTH-STORM-1", "amount": 150_000}
    results = []
    for _ in range(12):
        r = await client.post(f"{BASE}/finance/webhook/zarinpal", json=payload)
        assert r.status_code == 200, r.text
        results.append(r.json())

    assert results[0]["already_processed"] is False
    assert all(x["already_processed"] is True for x in results[1:])
    assert await _donation_count(db_session, "REF-STORM-1") == 1
    rows = await _ledger_rows_for_ref(db_session, "REF-STORM-1")
    assert len(rows) == 1 and rows[0].amount == 150_000
    assert zfake.box["calls"]["verify"] == 1  # فقط یک‌بار به درگاه برگشتیم
    async with tc["maker"]() as db:
        camp = await db.get(DonationCampaign, campaign_id)
        assert camp.raised_amount == 150_000  # فقط یک‌بار افزایش


# --- ۴) وبهوک بعد از کال‌بک موفق --------------------------------------------------


async def test_webhook_after_successful_callback_is_duplicate(tc, db_session, zfake):
    client = tc["client"]
    await _stage_pay_settings(db_session)
    await _donate(client, zfake, 200_000, "AUTH-CBWH-1", "REF-CBWH-1")

    cb = await client.get(
        f"{BASE}/finance/callback",
        params={"Authority": "AUTH-CBWH-1", "Status": "OK"},
    )
    assert cb.status_code == 200, cb.text
    assert cb.json()["status"] == "succeeded"
    donation_id = cb.json()["donation_id"]

    w = await client.post(
        f"{BASE}/finance/webhook/zarinpal",
        json={"authority": "AUTH-CBWH-1", "amount": 200_000},
    )
    assert w.status_code == 200, w.text
    # وبهوک بعد از کال‌بک: payload جدید است پس «processed» برمی‌گردد، ولی
    # _finalize_success re-entrant است — donation دوم ساخته نمی‌شود
    assert w.json()["status"] == "processed"

    assert await _donation_count(db_session, "REF-CBWH-1") == 1
    rows = await _ledger_rows_for_ref(db_session, "REF-CBWH-1")
    assert len(rows) == 1
    assert str(rows[0].donation_id) == donation_id

    # بازپخش همان وبهوک → این‌بار واقعاً duplicate
    w2 = await client.post(
        f"{BASE}/finance/webhook/zarinpal",
        json={"authority": "AUTH-CBWH-1", "amount": 200_000},
    )
    assert w2.status_code == 200, w2.text
    assert w2.json()["already_processed"] is True
    assert await _donation_count(db_session, "REF-CBWH-1") == 1
