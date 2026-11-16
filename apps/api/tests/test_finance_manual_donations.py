"""تست‌های حمایت دستی + رفع باگ درگاه آیدی‌پی.

پوشش:
- build_gateway: آیدی‌پی ساخته می‌شود (قبل از رفع باگ GatewayError می‌داد)،
  نام ناشناس همچنان صادقانه خطا می‌دهد.
- جریان کامل آیدی‌پی: donate → callback فرم POST → verify → donation.
- وبهوک آیدی‌پی با payload واقعی آیدی‌پی (id/order_id/track_id).
- فهرست روش‌های عمومی دقیقاً وضعیت روشن/خاموش و کامل‌بودن CRM را نشان می‌دهد.
- حمایت دستی: ثبت → pending → تأیید ادمین (Donation/Ledger/کمپین) و رد.
- روش خاموش: نه نمایش، نه پذیرش ارسال. پرداخت آنلاین خاموش → ۴۰۳.
- کریپتو: هش تکراری در تأیید دوم → ۴۰۹؛ مبلغ ارزی هنگام تأیید با نرخ
  (دستی یا لحظه‌ای) به ریال تبدیل و وارد مجموع کمپین می‌شود؛ نبود نرخ
  → ۴۲۲ و حمایت pending می‌ماند. endpoint نرخ لحظه‌ای ادمین هم پوشش دارد.
- تصویر رسید: اعتبارسنجی نوع/حجم + نمایش فقط برای finance.manage.
- اعتبارسنج تنظیمات کیف پول‌ها و پرچم‌ها در platform_settings.
"""
from __future__ import annotations

import json
import uuid

import httpx
import pytest

from app.modules.finance import gateways, service

BASE = "/api/v1"

_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


# ---------------------------------------------------------------------------
# کمک‌ها (الگوی test_finance_phase15)
# ---------------------------------------------------------------------------


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
            "full_name": "کاربر تست",
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


async def _finance_admin_token(client, db_session, email: str) -> str:
    from sqlalchemy import select

    from app.core.platform_settings import reset_settings_cache
    from app.models.models import Permission, Role, RolePermission, UserRole

    reset_settings_cache()
    me = await _register(client, email)
    token = await _login(client, email)
    role = (
        await db_session.execute(select(Role).where(Role.name == "super_admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="super_admin", description="test")
        db_session.add(role)
        await db_session.flush()
    perm = (
        await db_session.execute(
            select(Permission).where(Permission.key == "finance.manage")
        )
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="finance.manage", description="test")
        db_session.add(perm)
        await db_session.flush()
    exists = (
        await db_session.execute(
            select(UserRole).where(
                UserRole.user_id == uuid.UUID(me["id"]), UserRole.role_id == role.id
            )
        )
    ).first()
    if not exists:
        db_session.add(UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id))
    rp = (
        await db_session.execute(
            select(RolePermission).where(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == perm.id,
            )
        )
    ).first()
    if not rp:
        db_session.add(RolePermission(role_id=role.id, permission_id=perm.id))

    import pyotp

    from app.core.secrets import encrypt_value
    from app.models.models import User as _User

    u = (
        await db_session.execute(
            select(_User).where(_User.id == uuid.UUID(me["id"]))
        )
    ).scalar_one()
    u.totp_secret = json.dumps(encrypt_value(pyotp.random_base32()))
    await db_session.commit()
    return token


async def _stage(db_session, pairs: dict[str, str]) -> None:
    from app.core.platform_settings import reset_settings_cache, stage_setting

    for key, value in pairs.items():
        await stage_setting(db_session, key, value)
    await db_session.commit()
    reset_settings_cache()


async def _stage_card(db_session) -> None:
    await _stage(
        db_session,
        {
            "donation.card_enabled": "true",
            "donation.card_number": "6037-9911-1234-5678",
            "donation.card_holder": "آکادمی ماتریدی",
            "donation.card_instructions": json.dumps(
                {"fa": "رسید را بفرستید", "ar": "أرسل الإيصال", "en": "Send the receipt"}
            ),
        },
    )


async def _make_campaign(client, admin_headers) -> dict:
    r = await client.post(
        f"{BASE}/admin/finance/campaigns",
        headers=admin_headers,
        json={
            "title": {"fa": "کمپین تست دستی", "ar": "حملة", "en": "Manual Campaign"},
            "description": {"fa": "توضیح", "ar": "وصف", "en": "desc"},
            "goal_amount": 1_000_000_000,
            "status": "active",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


class _IdpayFake:
    """httpx موک برای API آیدی‌پی v1.1 — ساخت + verify."""

    def __init__(self):
        self.box = {
            "tx_id": f"TX-{uuid.uuid4().hex[:12]}",
            "track_id": str(uuid.uuid4().int % 10**9),
            "verify_status": 100,
            "calls": {"request": 0, "verify": 0},
            "last_headers": {},
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.box["last_headers"] = dict(request.headers)
        path = request.url.path
        if path.endswith("/v1.1/payment"):
            self.box["calls"]["request"] += 1
            tx = self.box["tx_id"]
            return httpx.Response(
                201, json={"id": tx, "link": f"https://idpay.ir/p/ws-sandbox/{tx}"}
            )
        if path.endswith("/v1.1/payment/verify"):
            self.box["calls"]["verify"] += 1
            if self.box["verify_status"] not in (100, 101):
                return httpx.Response(
                    200,
                    json={
                        "status": self.box["verify_status"],
                        "error_code": 53,
                        "error_message": "not paid",
                    },
                )
            return httpx.Response(
                200,
                json={
                    "status": 100,
                    "track_id": int(self.box["track_id"]),
                    "payment": {"card_no": "6037-****-1111"},
                },
            )
        return httpx.Response(404, json={})


@pytest.fixture()
def ifake(monkeypatch):
    fake = _IdpayFake()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    old = service._TEST_HTTP_CLIENT
    service._TEST_HTTP_CLIENT = client
    yield fake
    service._TEST_HTTP_CLIENT = old


# ---------------------------------------------------------------------------
# رفع باگ درگاه: build_gateway باید آیدی‌پی را بسازد
# ---------------------------------------------------------------------------


def test_build_gateway_idpay_constructible():
    """قبل از رفع باگ: «configured» بود ولی build_gateway خطای unknown می‌داد."""
    gw = gateways.build_gateway("idpay", sandbox=True)
    assert isinstance(gw, gateways.IdpayGateway)
    assert gw.name == "idpay"
    assert isinstance(gateways.build_gateway("zarinpal"), gateways.ZarinPalGateway)
    with pytest.raises(gateways.GatewayError):
        gateways.build_gateway("no-such-gateway")


@pytest.mark.asyncio
async def test_idpay_gateway_request_verify_unit(ifake):
    gw = gateways.IdpayGateway(sandbox=True, client=service._TEST_HTTP_CLIENT)
    req = await gw.request_payment(
        amount=120_000,
        description="Donation",
        callback_url="http://test/cb",
        merchant_key="idpay-key-1",
    )
    tx_id, order_id = gateways.IdpayGateway.split_authority(req.authority)
    assert tx_id == ifake.box["tx_id"]
    assert order_id and order_id != tx_id
    assert req.pay_url == f"https://idpay.ir/p/ws-sandbox/{tx_id}"
    # هدرهای قرارداد آیدی‌پی
    assert ifake.box["last_headers"].get("x-api-key") == "idpay-key-1"
    assert ifake.box["last_headers"].get("x-sandbox") == "1"

    res = await gw.verify_payment(
        authority=req.authority, amount=120_000, merchant_key="idpay-key-1"
    )
    assert res.ref_id == ifake.box["track_id"]
    assert res.card_pan == "6037-****-1111"

    ifake.box["verify_status"] = 2
    with pytest.raises(gateways.GatewayError):
        await gw.verify_payment(
            authority=req.authority, amount=120_000, merchant_key="idpay-key-1"
        )


@pytest.mark.asyncio
async def test_donate_idpay_full_flow(tc, db_session, ifake):
    """donate با gateway=idpay (قبلاً schema رد می‌کرد) → callback → donation."""
    client = tc["client"]
    await _stage(
        db_session,
        {
            "payment.idpay_key": "idpay-key-1",
            "payment.callback_url": "http://test/finance/callback",
        },
    )
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"key-{uuid.uuid4()}"},
        json={"amount": 400_000, "gateway": "idpay", "donor_name": "اهداکننده"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["pay_url"].startswith("https://idpay.ir/p/ws-sandbox/")
    tx_id, order_id = body["authority"].split(":", 1)

    cb = await client.post(
        f"{BASE}/finance/callback/idpay",
        data={"id": tx_id, "order_id": order_id, "status": "1", "track_id": "x"},
    )
    assert cb.status_code == 200, cb.text
    assert cb.json()["status"] == "succeeded"
    assert cb.json()["gateway_reference"] == ifake.box["track_id"]

    # کال‌بک تکراری → همان donation
    cb2 = await client.post(
        f"{BASE}/finance/callback/idpay",
        data={"id": tx_id, "order_id": order_id, "status": "1", "track_id": "x"},
    )
    assert cb2.json()["donation_id"] == cb.json()["donation_id"]
    assert ifake.box["calls"]["verify"] == 1


@pytest.mark.asyncio
async def test_idpay_webhook_flow(tc, db_session, ifake):
    """وبهوک با payload واقعی آیدی‌پی (id/order_id) — verify سمت‌سرور."""
    client = tc["client"]
    await _stage(
        db_session,
        {
            "payment.idpay_key": "idpay-key-1",
            "payment.callback_url": "http://test/finance/callback",
        },
    )
    ifake.box["tx_id"] = f"TX-WH-{uuid.uuid4().hex[:10]}"
    ifake.box["track_id"] = str(uuid.uuid4().int % 10**9)
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"key-{uuid.uuid4()}"},
        json={"amount": 150_000, "gateway": "idpay"},
    )
    assert r.status_code == 201, r.text
    tx_id, order_id = r.json()["authority"].split(":", 1)

    w = await client.post(
        f"{BASE}/finance/webhook/idpay",
        json={"id": tx_id, "order_id": order_id, "track_id": ifake.box["track_id"]},
    )
    assert w.status_code == 200, w.text
    assert w.json() == {"already_processed": False, "status": "processed"}


@pytest.mark.asyncio
async def test_gateway_statuses_idpay_sandbox(tc, db_session):
    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "gw-status@example.com")
    await _stage(
        db_session,
        {"payment.idpay_key": "idpay-key-1", "payment.idpay_sandbox": "false"},
    )
    r = await client.get(f"{BASE}/admin/finance/gateways", headers=_auth(admin_tok))
    assert r.status_code == 200, r.text
    assert r.json()["idpay"] == {"configured": True, "sandbox": False}


# ---------------------------------------------------------------------------
# فهرست روش‌ها: بازتاب دقیق روشن/خاموش + کامل‌بودن
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_methods_listing_toggles(tc, db_session):
    client = tc["client"]
    # همه‌چیز صریحاً خاموش/خالی → هیچ روشی نیست
    await _stage(
        db_session,
        {
            "donation.online_enabled": "false",
            "donation.card_enabled": "false",
            "donation.crypto_enabled": "false",
            "donation.paypal_enabled": "false",
        },
    )
    r = await client.get(f"{BASE}/finance/donation-methods")
    assert r.status_code == 200
    assert r.json()["methods"] == []

    # آنلاین روشن + کلید زرین‌پال → online با zarinpal
    # (کلید آیدی‌پی صریحاً خالی: دیتابیس تست بین تست‌ها مشترک است)
    await _stage(
        db_session,
        {
            "donation.online_enabled": "true",
            "payment.zarinpal_key": "zk-test",
            "payment.idpay_key": "",
        },
    )
    r = await client.get(f"{BASE}/finance/donation-methods")
    methods = {m["method"]: m for m in r.json()["methods"]}
    assert methods["online"]["gateways"] == ["zarinpal"]

    # کارت روشن ولی بدون شماره → هنوز غایب (ناقص = نمایش داده نمی‌شود)
    await _stage(db_session, {"donation.card_enabled": "true", "donation.card_number": ""})
    r = await client.get(f"{BASE}/finance/donation-methods")
    assert "card" not in {m["method"] for m in r.json()["methods"]}

    # کارت کامل → حاضر با شماره و صاحب کارت
    await _stage_card(db_session)
    r = await client.get(f"{BASE}/finance/donation-methods")
    methods = {m["method"]: m for m in r.json()["methods"]}
    assert methods["card"]["card_number"] == "6037-9911-1234-5678"
    assert methods["card"]["card_holder"] == "آکادمی ماتریدی"
    assert methods["card"]["instructions"]["fa"] == "رسید را بفرستید"

    # خاموش‌کردن کارت → دوباره غایب
    await _stage(db_session, {"donation.card_enabled": "false"})
    r = await client.get(f"{BASE}/finance/donation-methods")
    assert "card" not in {m["method"] for m in r.json()["methods"]}


# ---------------------------------------------------------------------------
# حمایت دستی: چرخهٔ کامل کارت‌به‌کارت
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_card_submit_approve_flow(tc, db_session):
    from sqlalchemy import select

    from app.models.models import Donation, DonationCampaign, LedgerEntry

    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-admin@example.com")
    admin_h = _auth(admin_tok)
    await _stage_card(db_session)
    camp = await _make_campaign(client, admin_h)

    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={
            "method": "card",
            "amount": "2500000",
            "campaign_id": camp["id"],
            "donor_name": "حامی کارت",
            "proof_text": "TRACK-998877",
        },
    )
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["status"] == "pending"
    assert sub["currency"] == "IRR"
    proof_id = sub["id"]

    # هنوز هیچ Donation/Ledgerای نیست — پول ثبت نهایی نشده
    don = (
        await db_session.execute(
            select(Donation).where(Donation.payment_intent_id == uuid.UUID(sub["intent_id"]))
        )
    ).scalar_one_or_none()
    assert don is None

    # فهرست ادمین: pending با اثبات
    lst = await client.get(
        f"{BASE}/admin/finance/manual-donations",
        params={"status": "pending"},
        headers=admin_h,
    )
    assert lst.status_code == 200
    mine = [i for i in lst.json()["items"] if i["id"] == proof_id]
    assert len(mine) == 1
    assert mine[0]["proof_text"] == "TRACK-998877"
    assert mine[0]["donor_name"] == "حامی کارت"
    assert mine[0]["has_proof_image"] is False

    # تأیید → Donation + Ledger + افزایش کمپین (ریالی)
    ap = await client.post(
        f"{BASE}/admin/finance/manual-donations/{proof_id}/approve",
        headers=admin_h,
        json={"note": "رسید بررسی شد"},
    )
    assert ap.status_code == 200, ap.text
    assert ap.json()["status"] == "approved"

    don = (
        await db_session.execute(
            select(Donation).where(Donation.payment_intent_id == uuid.UUID(sub["intent_id"]))
        )
    ).scalar_one()
    assert don.gateway == "card"
    assert don.gateway_reference == "TRACK-998877"
    assert don.amount == 2_500_000

    led = (
        await db_session.execute(
            select(LedgerEntry).where(LedgerEntry.donation_id == don.id)
        )
    ).scalar_one()
    assert led.entry_type == "donation_in" and led.amount == 2_500_000

    camp_row = await db_session.get(DonationCampaign, uuid.UUID(camp["id"]))
    await db_session.refresh(camp_row)
    assert camp_row.raised_amount == 2_500_000

    # بازبینی دوباره → ۴۰۹
    again = await client.post(
        f"{BASE}/admin/finance/manual-donations/{proof_id}/approve",
        headers=admin_h,
        json={},
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_reviewed"


@pytest.mark.asyncio
async def test_manual_reject_flow(tc, db_session):
    from sqlalchemy import select

    from app.models.models import Donation, PaymentIntent

    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-rej@example.com")
    admin_h = _auth(admin_tok)
    await _stage_card(db_session)

    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "card", "amount": "100000", "proof_text": "TRACK-REJ-1"},
    )
    assert r.status_code == 201
    proof_id = r.json()["id"]
    intent_id = r.json()["intent_id"]

    rj = await client.post(
        f"{BASE}/admin/finance/manual-donations/{proof_id}/reject",
        headers=admin_h,
        json={"note": "رسید خوانا نیست"},
    )
    assert rj.status_code == 200, rj.text
    assert rj.json()["status"] == "rejected"
    assert rj.json()["review_note"] == "رسید خوانا نیست"

    intent = await db_session.get(PaymentIntent, uuid.UUID(intent_id))
    await db_session.refresh(intent)
    assert intent.status == "cancelled"
    don = (
        await db_session.execute(
            select(Donation).where(Donation.payment_intent_id == intent.id)
        )
    ).scalar_one_or_none()
    assert don is None


@pytest.mark.asyncio
async def test_manual_disabled_and_online_disabled_reject(tc, db_session):
    client = tc["client"]
    # کارت خاموش → ارسال ۴۰۳
    await _stage(db_session, {"donation.card_enabled": "false"})
    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "card", "amount": "100000", "proof_text": "X"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "donation_method_disabled"

    # روش ناشناس → ۴۰۰
    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "barter", "amount": "1", "proof_text": "X"},
    )
    assert r.status_code == 400

    # آنلاین خاموش → /donate هم رد می‌شود (با وجود کلید معتبر)
    await _stage(
        db_session,
        {
            "donation.online_enabled": "false",
            "payment.zarinpal_key": "zk-test",
            "payment.callback_url": "http://test/finance/callback",
        },
    )
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"key-{uuid.uuid4()}"},
        json={"amount": 10_000},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "donation_method_disabled"
    await _stage(db_session, {"donation.online_enabled": "true"})


# ---------------------------------------------------------------------------
# کریپتو و PayPal
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_crypto_duplicate_hash(tc, db_session):
    from sqlalchemy import select

    from app.models.models import Donation, DonationCampaign

    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-crypto@example.com")
    admin_h = _auth(admin_tok)
    await _stage(
        db_session,
        {
            "donation.crypto_enabled": "true",
            "donation.crypto_wallets": json.dumps(
                [{"currency": "USDT", "network": "TRC20", "address": "TXYZabc123"}]
            ),
        },
    )
    camp = await _make_campaign(client, admin_h)
    tx_hash = f"hash-{uuid.uuid4().hex}"

    async def _submit() -> dict:
        r = await client.post(
            f"{BASE}/finance/donate/manual",
            data={
                "method": "crypto",
                "amount": "50",
                "campaign_id": camp["id"],
                "wallet_currency": "USDT",
                "wallet_network": "TRC20",
                "proof_text": tx_hash,
            },
        )
        assert r.status_code == 201, r.text
        return r.json()

    first = await _submit()
    assert first["currency"] == "USDT"
    ap = await client.post(
        f"{BASE}/admin/finance/manual-donations/{first['id']}/approve",
        headers=admin_h,
        json={"rate_irr": 2_000_000},
    )
    assert ap.status_code == 200, ap.text
    # تبدیل دستی: ۵۰ تتر × نرخ ۲٬۰۰۰٬۰۰۰ ریال روی خود رکورد می‌ماند
    assert ap.json()["amount_irr"] == 100_000_000
    assert ap.json()["fx_rate_irr"] == 2_000_000
    assert ap.json()["fx_source"] == "manual"

    don = (
        await db_session.execute(
            select(Donation).where(Donation.gateway_reference == tx_hash)
        )
    ).scalar_one()
    assert don.gateway == "crypto" and don.amount == 50 and don.currency == "USDT"

    # معادل ریالیِ تبدیل‌شده به مجموع کمپین رفته است
    camp_row = await db_session.get(DonationCampaign, uuid.UUID(camp["id"]))
    await db_session.refresh(camp_row)
    assert camp_row.raised_amount == 100_000_000

    # همان هش برای ارسال دوم → تأیید ۴۰۹ (یکتایی مرجع)
    second = await _submit()
    ap2 = await client.post(
        f"{BASE}/admin/finance/manual-donations/{second['id']}/approve",
        headers=admin_h,
        json={"rate_irr": 2_000_000},
    )
    assert ap2.status_code == 409
    assert ap2.json()["error"]["code"] == "duplicate_reference"

    # کیف پولِ پیکربندی‌نشده → ۴۰۰
    bad = await client.post(
        f"{BASE}/finance/donate/manual",
        data={
            "method": "crypto",
            "amount": "5",
            "wallet_currency": "BTC",
            "wallet_network": "",
            "proof_text": "whatever",
        },
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "wallet_not_available"


@pytest.mark.asyncio
async def test_manual_paypal_flow(tc, db_session):
    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-pp@example.com")
    admin_h = _auth(admin_tok)
    await _stage(
        db_session,
        {
            "donation.paypal_enabled": "true",
            "donation.paypal_account": "donate@example.org",
        },
    )
    r = await client.get(f"{BASE}/finance/donation-methods")
    methods = {m["method"]: m for m in r.json()["methods"]}
    assert methods["paypal"]["paypal_account"] == "donate@example.org"
    assert methods["paypal"]["currency"] == "USD"

    sub = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "paypal", "amount": "25", "proof_text": "PP-TXN-1"},
    )
    assert sub.status_code == 201, sub.text
    assert sub.json()["currency"] == "USD"
    ap = await client.post(
        f"{BASE}/admin/finance/manual-donations/{sub.json()['id']}/approve",
        headers=admin_h,
        json={"rate_irr": 2_500_000},
    )
    assert ap.status_code == 200
    assert ap.json()["amount_irr"] == 62_500_000
    assert ap.json()["fx_source"] == "manual"


# ---------------------------------------------------------------------------
# تبدیل ارزی لحظه‌ای هنگام تأیید (مجموع کمپین چندارزی)
# ---------------------------------------------------------------------------


async def _stage_crypto_usdt(db_session) -> None:
    await _stage(
        db_session,
        {
            "donation.crypto_enabled": "true",
            "donation.crypto_wallets": json.dumps(
                [{"currency": "USDT", "network": "TRC20", "address": "TXYZabc123"}]
            ),
        },
    )


async def _submit_usdt(client, camp_id: str, amount: str = "10") -> dict:
    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={
            "method": "crypto",
            "amount": amount,
            "campaign_id": camp_id,
            "wallet_currency": "USDT",
            "wallet_network": "TRC20",
            "proof_text": f"fx-hash-{uuid.uuid4().hex}",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_manual_fx_auto_rate_counts_campaign(tc, db_session, monkeypatch):
    from app.models.models import DonationCampaign
    from app.modules.finance import fx as fx_mod

    async def fake_rate(currency: str):
        assert currency == "USDT"
        return 3_000_000, "wallex"

    monkeypatch.setattr(fx_mod, "get_rate_irr", fake_rate)

    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-fx@example.com")
    admin_h = _auth(admin_tok)
    await _stage_crypto_usdt(db_session)
    camp = await _make_campaign(client, admin_h)
    sub = await _submit_usdt(client, camp["id"], "10")

    # بدون نرخ دستی → نرخ لحظه‌ای خودکار (مونکی‌پچ‌شده) اعمال می‌شود
    ap = await client.post(
        f"{BASE}/admin/finance/manual-donations/{sub['id']}/approve",
        headers=admin_h,
        json={},
    )
    assert ap.status_code == 200, ap.text
    body = ap.json()
    assert body["amount_irr"] == 30_000_000
    assert body["fx_rate_irr"] == 3_000_000
    assert body["fx_source"] == "wallex"

    camp_row = await db_session.get(DonationCampaign, uuid.UUID(camp["id"]))
    await db_session.refresh(camp_row)
    assert camp_row.raised_amount == 30_000_000


@pytest.mark.asyncio
async def test_manual_fx_unavailable_requires_manual_rate(tc, db_session, monkeypatch):
    from app.models.models import DonationCampaign
    from app.modules.finance import fx as fx_mod

    async def dead_rate(currency: str):
        raise fx_mod.FxUnavailable(currency)

    monkeypatch.setattr(fx_mod, "get_rate_irr", dead_rate)

    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-fx2@example.com")
    admin_h = _auth(admin_tok)
    await _stage_crypto_usdt(db_session)
    camp = await _make_campaign(client, admin_h)
    sub = await _submit_usdt(client, camp["id"], "10")

    # نه نرخ لحظه‌ای، نه نرخ دستی → ۴۲۲ و حمایت pending می‌ماند
    ap = await client.post(
        f"{BASE}/admin/finance/manual-donations/{sub['id']}/approve",
        headers=admin_h,
        json={},
    )
    assert ap.status_code == 422, ap.text
    assert ap.json()["error"]["code"] == "fx_rate_required"

    camp_row = await db_session.get(DonationCampaign, uuid.UUID(camp["id"]))
    await db_session.refresh(camp_row)
    assert camp_row.raised_amount == 0

    # همان حمایت با نرخ دستی تأیید می‌شود
    ap2 = await client.post(
        f"{BASE}/admin/finance/manual-donations/{sub['id']}/approve",
        headers=admin_h,
        json={"rate_irr": 1_500_000},
    )
    assert ap2.status_code == 200, ap2.text
    assert ap2.json()["amount_irr"] == 15_000_000
    await db_session.refresh(camp_row)
    assert camp_row.raised_amount == 15_000_000


@pytest.mark.asyncio
async def test_fx_rate_endpoint(tc, db_session, monkeypatch):
    from app.modules.finance import fx as fx_mod

    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-fx3@example.com")
    admin_h = _auth(admin_tok)

    async def fake_rate(currency: str):
        return 2_700_000, "wallex"

    monkeypatch.setattr(fx_mod, "get_rate_irr", fake_rate)
    r = await client.get(f"{BASE}/admin/finance/fx-rate", params={"currency": "USDT"}, headers=admin_h)
    assert r.status_code == 200, r.text
    assert r.json() == {"currency": "USDT", "rate_irr": 2_700_000, "source": "wallex"}

    async def dead_rate(currency: str):
        raise fx_mod.FxUnavailable(currency)

    monkeypatch.setattr(fx_mod, "get_rate_irr", dead_rate)
    r = await client.get(f"{BASE}/admin/finance/fx-rate", params={"currency": "USDT"}, headers=admin_h)
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "fx_unavailable"

    # بدون دسترسی مالی → رد
    r = await client.get(f"{BASE}/admin/finance/fx-rate", params={"currency": "USDT"})
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# تصویر رسید: اعتبارسنجی + دسترسی
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_receipt_image_rules(tc, db_session):
    client = tc["client"]
    admin_tok = await _finance_admin_token(client, db_session, "manual-img@example.com")
    admin_h = _auth(admin_tok)
    await _stage_card(db_session)

    # بدون هیچ رسیدی → ۴۲۲
    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "card", "amount": "100000"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "proof_required"

    # فایل غیرتصویر → ۴۱۵
    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "card", "amount": "100000"},
        files={"receipt": ("note.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "unsupported_receipt_image"

    # تصویر معتبر → ۲۰۱ و نمایش فقط برای ادمین مالی
    r = await client.post(
        f"{BASE}/finance/donate/manual",
        data={"method": "card", "amount": "100000", "donor_name": "حامی تصویر"},
        files={"receipt": ("receipt.png", _PNG, "image/png")},
    )
    assert r.status_code == 201, r.text
    proof_id = r.json()["id"]

    img = await client.get(
        f"{BASE}/admin/finance/manual-donations/{proof_id}/proof-image",
        headers=admin_h,
    )
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert img.content == _PNG

    # کاربر عادی → ۴۰۳
    await _register(client, "img-stranger@example.com")
    tok = await _login(client, "img-stranger@example.com")
    denied = await client.get(
        f"{BASE}/admin/finance/manual-donations/{proof_id}/proof-image",
        headers=_auth(tok),
    )
    assert denied.status_code == 403


# ---------------------------------------------------------------------------
# اعتبارسنج تنظیمات تازه (platform_settings)
# ---------------------------------------------------------------------------


def test_settings_validation_for_donation_keys():
    from app.core.platform_settings import encode_setting_value

    # پرچم باید bool باشد
    with pytest.raises(ValueError):
        encode_setting_value("json", "yes", "donation.card_enabled")
    assert encode_setting_value("json", True, "donation.card_enabled") == "true"

    # کیف پول‌ها: canonical (حروف بزرگ ارز/شبکه) + رد شکل‌های خراب
    out = json.loads(
        encode_setting_value(
            "json",
            [{"currency": "usdt", "network": "trc20", "address": " TAddr "}],
            "donation.crypto_wallets",
        )
    )
    assert out == [{"currency": "USDT", "network": "TRC20", "address": "TAddr"}]
    # نوع اشتباه → TypeError (قرارداد TRY004 کدبیس)؛ مقدار اشتباه → ValueError
    with pytest.raises(TypeError):
        encode_setting_value(
            "json", [{"currency": "USDT"}], "donation.crypto_wallets"
        )
    with pytest.raises(TypeError):
        encode_setting_value("json", {"currency": "USDT"}, "donation.crypto_wallets")
    with pytest.raises(ValueError):
        encode_setting_value(
            "json",
            [{"currency": "USDT", "network": "TRC20", "address": "A", "extra": 1}],
            "donation.crypto_wallets",
        )
    with pytest.raises(ValueError):
        encode_setting_value(
            "json",
            [{"currency": "  ", "network": "", "address": "A"}],
            "donation.crypto_wallets",
        )
