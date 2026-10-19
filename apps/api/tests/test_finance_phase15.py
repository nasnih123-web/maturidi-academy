"""تست‌های فاز ۱۵ (Track 1 — بک‌اند): مالی، اهدا و درگاه پرداخت.

پوشش:
(a) کلیک دوبارهٔ «پرداخت» با همان Idempotency-Key → دقیقاً ۱ نیت و ۱ فراخوان درگاه
(b) replay تکراری وبهوک → مبلغ فقط یک‌بار ثبت می‌شود
(c) وبهوک با امضای نامعتبر → 4xx رد می‌شود
(d) جریان کامل sandbox زرین‌پال (request → callback → verify → donation+ledger+رسید PDF)
(e) reconcile مغایرت تزریق‌شده را تشخیص می‌دهد
(f) نبود Idempotency-Key → 422
+ CRUD کمپین، audit لاگ بدون secret، کنترل دسترسی رسید، cursor اهداها/دفتر
"""
from __future__ import annotations

import hashlib
import hmac
import uuid

import httpx
import pytest

from app.modules.finance import gateways, receipts, schemas, service

BASE = "/api/v1"


# ---------------------------------------------------------------------------
# کمک‌ها
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
        db_session.add(
            UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id)
        )
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
    await db_session.commit()
    return token


async def _stage_pay_settings(db_session) -> None:
    """کلیدهای پرداخت در platform_settings (رمزنگاری‌شده، §۳)."""
    from app.core.platform_settings import reset_settings_cache, stage_setting

    await stage_setting(db_session, "payment.zarinpal_key", "test-merchant-key-xyz")
    await stage_setting(db_session, "payment.callback_url", "http://test/finance/callback")
    await stage_setting(db_session, "payment.zarinpal_sandbox", "true")
    await db_session.commit()
    reset_settings_cache()


class _ZarinPalFake:
    """httpx موک برای sandbox زرین‌پال — شمارش فراخوان‌ها برای تست idempotency."""

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
    """نصب کلاینت موک در service — بعد از تست خودکار برمی‌گردد."""
    fake = _ZarinPalFake()
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    old = service._TEST_HTTP_CLIENT
    service._TEST_HTTP_CLIENT = client
    yield fake
    service._TEST_HTTP_CLIENT = old


async def _make_campaign(client, admin_headers) -> dict:
    r = await client.post(
        f"{BASE}/admin/finance/campaigns",
        headers=admin_headers,
        json={
            "title": {"fa": "کمپین تست", "ar": "حملة اختبار", "en": "Test Campaign"},
            "description": {"fa": "توضیح", "ar": "وصف", "en": "desc"},
            "goal_amount": 1_000_000_000,
            "status": "active",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# (f) نبود Idempotency-Key → 422
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_donate_missing_idempotency_key(tc, db_session):
    client = tc["client"]
    await _stage_pay_settings(db_session)
    r = await client.post(
        f"{BASE}/finance/donate",
        json={"amount": 100_000, "callback_url": "http://test/finance/callback"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "missing_idempotency_key"


# ---------------------------------------------------------------------------
# (a) کلید تکراری → ۱ نیت، ۱ فراخوان درگاه
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_donate_idempotent_same_key(tc, db_session, zfake):
    from sqlalchemy import func, select

    from app.models.models import PaymentIntent

    client = tc["client"]
    await _stage_pay_settings(db_session)
    zfake.box["authority"] = "AUTH-IDEMP-A"
    key = f"key-{uuid.uuid4()}"

    r1 = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": key},
        json={"amount": 250_000, "donor_name": "تست", "callback_url": "http://test/finance/callback"},
    )
    assert r1.status_code == 201, r1.text
    r2 = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": key},
        json={"amount": 250_000, "donor_name": "تست", "callback_url": "http://test/finance/callback"},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["intent_id"] == r1.json()["intent_id"]
    assert r2.json()["authority"] == "AUTH-IDEMP-A"
    # دقیقاً یک فراخوان به درگاه، علی‌رغم دو POST
    assert zfake.box["calls"]["request"] == 1
    count = (
        await db_session.execute(
            select(func.count()).select_from(PaymentIntent).where(
                PaymentIntent.idempotency_key == key
            )
        )
    ).scalar()
    assert count == 1


# ---------------------------------------------------------------------------
# (d) جریان کامل sandbox: request → callback → verify → donation+ledger+رسید
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_zarinpal_flow_with_receipt(tc, db_session, zfake):
    from sqlalchemy import func, select

    from app.models.models import AuditLog, Donation, DonationCampaign, LedgerEntry

    client = tc["client"]
    await _stage_pay_settings(db_session)
    admin_tok = await _finance_admin_token(client, db_session, "fin-admin@example.com")
    admin_h = _auth(admin_tok)
    await _register(client, "donor@example.com")
    user_tok = await _login(client, "donor@example.com")

    campaign = await _make_campaign(client, admin_h)

    zfake.box["authority"] = "AUTH-FULL-1"
    zfake.box["ref_id"] = "REF-FULL-1"
    key = f"key-{uuid.uuid4()}"
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={**_auth(user_tok), "Idempotency-Key": key},
        json={
            "amount": 500_000,
            "campaign_id": campaign["id"],
            "donor_name": "حسینه",
            "callback_url": "http://test/finance/callback",
        },
    )
    assert r.status_code == 201, r.text
    intent_id = r.json()["intent_id"]
    assert r.json()["pay_url"].startswith("https://sandbox.zarinpal.com/pg/StartPay/")

    # audit: ساخت نیت — بدون secret (§۱۴)
    audit = (
        await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "finance.intent_created",
                AuditLog.entity_id == intent_id,
            )
        )
    ).scalar_one()
    assert "test-merchant-key-xyz" not in str(audit.new_values)

    # کال‌بک درگاه
    cb = await client.get(
        f"{BASE}/finance/callback",
        params={"Authority": "AUTH-FULL-1", "Status": "OK"},
    )
    assert cb.status_code == 200, cb.text
    assert cb.json()["status"] == "succeeded"
    donation_id = cb.json()["donation_id"]

    # کال‌بک تکراری → همان donation، بدون اثر دوم
    cb2 = await client.get(
        f"{BASE}/finance/callback",
        params={"Authority": "AUTH-FULL-1", "Status": "OK"},
    )
    assert cb2.json()["donation_id"] == donation_id
    assert zfake.box["calls"]["verify"] == 1

    donation = (
        await db_session.execute(select(Donation).where(Donation.id == uuid.UUID(donation_id)))
    ).scalar_one()
    assert donation.gateway_reference == "REF-FULL-1"
    assert donation.amount == 500_000

    ledger = (
        await db_session.execute(
            select(func.count(), func.sum(LedgerEntry.amount)).where(
                LedgerEntry.donation_id == donation.id,
                LedgerEntry.entry_type == "donation_in",
            )
        )
    ).one()
    assert ledger[0] == 1 and ledger[1] == 500_000

    camp = await db_session.get(DonationCampaign, uuid.UUID(campaign["id"]))
    assert camp.raised_amount == 500_000

    # رسید PDF — مالک
    rec = await client.get(f"{BASE}/finance/receipts/{donation_id}", headers=_auth(user_tok))
    assert rec.status_code == 200, rec.text
    assert rec.headers["content-type"] == "application/pdf"
    assert rec.content[:4] == b"%PDF"

    # رسید — ادمین finance.manage
    rec_admin = await client.get(f"{BASE}/finance/receipts/{donation_id}", headers=admin_h)
    assert rec_admin.status_code == 200

    # رسید — کاربر بیگانه → 403
    await _register(client, "stranger@example.com")
    stranger_tok = await _login(client, "stranger@example.com")
    rec_no = await client.get(f"{BASE}/finance/receipts/{donation_id}", headers=_auth(stranger_tok))
    assert rec_no.status_code == 403


# ---------------------------------------------------------------------------
# کال‌بک لغو (Status != OK)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_callback_cancelled(tc, db_session, zfake):
    client = tc["client"]
    await _stage_pay_settings(db_session)
    zfake.box["authority"] = "AUTH-CANCEL-1"
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"key-{uuid.uuid4()}"},
        json={"amount": 100_000, "callback_url": "http://test/finance/callback"},
    )
    assert r.status_code == 201
    cb = await client.get(
        f"{BASE}/finance/callback",
        params={"Authority": "AUTH-CANCEL-1", "Status": "NOK"},
    )
    assert cb.status_code == 200
    assert cb.json()["status"] == "failed"
    assert cb.json()["donation_id"] is None


# ---------------------------------------------------------------------------
# (b) replay وبهوک → مبلغ یک‌بار | (c) وبهوک بد → 4xx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_webhook_replay_idempotent(tc, db_session, zfake):
    from sqlalchemy import func, select

    from app.models.models import Donation, LedgerEntry

    client = tc["client"]
    await _stage_pay_settings(db_session)
    zfake.box["authority"] = "AUTH-WEB-1"
    zfake.box["ref_id"] = "REF-WEB-1"
    key = f"key-{uuid.uuid4()}"
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": key},
        json={"amount": 300_000, "callback_url": "http://test/finance/callback"},
    )
    assert r.status_code == 201, r.text

    payload = {"authority": "AUTH-WEB-1", "amount": 300_000}
    w1 = await client.post(f"{BASE}/finance/webhook/zarinpal", json=payload)
    assert w1.status_code == 200, w1.text
    assert w1.json() == {"already_processed": False, "status": "processed"}

    w2 = await client.post(f"{BASE}/finance/webhook/zarinpal", json=payload)
    assert w2.status_code == 200
    assert w2.json()["already_processed"] is True

    count = (
        await db_session.execute(
            select(func.count()).select_from(Donation).where(
                Donation.gateway_reference == "REF-WEB-1"
            )
        )
    ).scalar()
    assert count == 1
    total = (
        await db_session.execute(
            select(func.sum(LedgerEntry.amount)).where(
                LedgerEntry.reference.like("%"),
                LedgerEntry.entry_type == "donation_in",
            )
        )
    ).scalar()
    # فقط یک ردیف donation_in برای این ref
    rows = (
        await db_session.execute(
            select(LedgerEntry).join(Donation, LedgerEntry.donation_id == Donation.id).where(
                Donation.gateway_reference == "REF-WEB-1"
            )
        )
    ).scalars().all()
    assert len(rows) == 1 and rows[0].amount == 300_000
    assert zfake.box["calls"]["verify"] == 1  # replay به درگاه برنگشت


@pytest.mark.asyncio
async def test_webhook_rejected_cases(tc, db_session, zfake):
    client = tc["client"]
    await _stage_pay_settings(db_session)

    # بدون authority → 400
    r = await client.post(f"{BASE}/finance/webhook/zarinpal", json={"amount": 1})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "bad_webhook_payload"

    # verify ناموفق در درگاه → 401
    zfake.box["authority"] = "AUTH-WEB-BAD"
    zfake.box["verify_code"] = -9
    r = await client.post(
        f"{BASE}/finance/webhook/zarinpal",
        json={"authority": "AUTH-WEB-BAD", "amount": 100},
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "webhook_verification_failed"
    zfake.box["verify_code"] = 100


@pytest.mark.asyncio
async def test_hmac_signature_logic():
    """HMAC پایهٔ درگاه‌های وبهوک‌دار + مستندسازی رفتار زرین‌پال."""

    class _Signed(gateways.PaymentGateway):
        name = "signed"

        async def request_payment(self, **kw):
            raise NotImplementedError

        async def verify_payment(self, **kw):
            raise NotImplementedError

    s = _Signed()
    body = b'{"x": 1}'
    good = hmac.new(b"wh-secret", body, hashlib.sha256).hexdigest()
    assert s.verify_webhook_signature(raw_body=body, signature=good, webhook_secret="wh-secret")
    assert not s.verify_webhook_signature(raw_body=body, signature="bad", webhook_secret="wh-secret")
    assert not s.verify_webhook_signature(raw_body=body, signature=None, webhook_secret="wh-secret")

    # زرین‌پال: امضای وبهوک وجود ندارد — تأیید فقط با verify سمت‌سرور
    zp = gateways.ZarinPalGateway()
    assert zp.verify_webhook_signature(raw_body=body, signature=good, webhook_secret="wh-secret") is False


# ---------------------------------------------------------------------------
# (e) reconcile مغایرت را می‌بیند
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconcile_detects_mismatch(tc, db_session, zfake, monkeypatch):
    client = tc["client"]
    await _stage_pay_settings(db_session)
    admin_tok = await _finance_admin_token(client, db_session, "fin-admin2@example.com")
    admin_h = _auth(admin_tok)

    # دو پرداخت موفق داخلی
    for auth, ref in (("AUTH-REC-A", "REF-REC-A"), ("AUTH-REC-B", "REF-REC-B")):
        zfake.box["authority"] = auth
        zfake.box["ref_id"] = ref
        r = await client.post(
            f"{BASE}/finance/donate",
            headers={"Idempotency-Key": f"key-{uuid.uuid4()}"},
            json={"amount": 700_000, "callback_url": "http://test/finance/callback"},
        )
        assert r.status_code == 201, r.text
        cb = await client.get(
            f"{BASE}/finance/callback", params={"Authority": auth, "Status": "OK"}
        )
        assert cb.json()["status"] == "succeeded"

    # گزارش جعلی درگاه: A نیست، B با مبلغ اشتباه، GHOST اضافه
    class _FakeGW:
        name = "zarinpal"

        async def fetch_report(self, *, merchant_key: str):
            assert merchant_key == "test-merchant-key-xyz"
            return [
                gateways.GatewayReportEntry(ref_id="REF-REC-B", amount=1, status="succeeded"),
                gateways.GatewayReportEntry(ref_id="GHOST-9", amount=50_000, status="succeeded"),
            ]

    monkeypatch.setattr(service, "_get_gateway", lambda name, *, sandbox: _FakeGW())

    r = await client.get(f"{BASE}/admin/finance/reconcile", params={"gateway": "zarinpal"}, headers=admin_h)
    assert r.status_code == 200, r.text
    kinds = {m["kind"] for m in r.json()["mismatches"]}
    assert "internal_without_gateway" in kinds  # REF-REC-A در گزارش نیست
    assert "amount_mismatch" in kinds  # REF-REC-B مبلغ متفاوت
    assert "gateway_without_internal" in kinds  # GHOST-9 رکورد داخلی ندارد


@pytest.mark.asyncio
async def test_reconcile_unsupported_gateway_honest(tc, db_session, zfake):
    """زرین‌پال واقعی گزارش API ندارد → ۵۰۳ صادقانه، نه دادهٔ ساختگی."""
    client = tc["client"]
    await _stage_pay_settings(db_session)
    admin_tok = await _finance_admin_token(client, db_session, "fin-admin3@example.com")
    r = await client.get(
        f"{BASE}/admin/finance/reconcile", params={"gateway": "zarinpal"}, headers=_auth(admin_tok)
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "gateway_report_unavailable"


# ---------------------------------------------------------------------------
# ادمین: کمپین CRUD + لیست اهداها/دفتر (cursor)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_campaign_crud_and_lists(tc, db_session, zfake):
    client = tc["client"]
    await _stage_pay_settings(db_session)
    admin_tok = await _finance_admin_token(client, db_session, "fin-admin4@example.com")
    admin_h = _auth(admin_tok)

    camp = await _make_campaign(client, admin_h)
    # لیست عمومی فقط active
    pub = await client.get(f"{BASE}/finance/campaigns")
    assert pub.status_code == 200
    assert any(c["id"] == camp["id"] for c in pub.json())
    one = await client.get(f"{BASE}/finance/campaigns/{camp['id']}")
    assert one.json()["title"]["fa"] == "کمپین تست"

    # ویرایش ادمین
    upd = await client.put(
        f"{BASE}/admin/finance/campaigns/{camp['id']}",
        headers=admin_h,
        json={
            "title": {"fa": "کمپین ویراسته", "ar": "حملة", "en": "Campaign"},
            "description": None,
            "goal_amount": 2_000_000_000,
            "status": "active",
        },
    )
    assert upd.status_code == 200
    assert upd.json()["title"]["fa"] == "کمپین ویراسته"

    # یک اهدای موفق برای پرکردن لیست‌ها
    zfake.box["authority"] = "AUTH-LIST-1"
    zfake.box["ref_id"] = "REF-LIST-1"
    r = await client.post(
        f"{BASE}/finance/donate",
        headers={"Idempotency-Key": f"key-{uuid.uuid4()}"},
        json={"amount": 111_000, "campaign_id": camp["id"], "callback_url": "http://test/finance/callback"},
    )
    assert r.status_code == 201
    await client.get(f"{BASE}/finance/callback", params={"Authority": "AUTH-LIST-1", "Status": "OK"})

    d1 = await client.get(f"{BASE}/admin/finance/donations", params={"limit": 1}, headers=admin_h)
    assert d1.status_code == 200
    assert len(d1.json()["items"]) == 1
    assert d1.json()["next_cursor"]
    d2 = await client.get(
        f"{BASE}/admin/finance/donations",
        params={"limit": 1, "cursor": d1.json()["next_cursor"]},
        headers=admin_h,
    )
    assert d2.status_code == 200
    assert {d1.json()["items"][0]["id"]} != {i["id"] for i in d2.json()["items"]} or not d2.json()["items"]

    led = await client.get(f"{BASE}/admin/finance/ledger", params={"limit": 5}, headers=admin_h)
    assert led.status_code == 200
    assert any(i["entry_type"] == "donation_in" for i in led.json()["items"])

    # بدون مجوز → 403
    await _register(client, "noperm@example.com")
    no_tok = await _login(client, "noperm@example.com")
    denied = await client.get(f"{BASE}/admin/finance/donations", headers=_auth(no_tok))
    assert denied.status_code == 403


# ---------------------------------------------------------------------------
# رسید PDF: محتوای مجاز (بدون فقه)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_receipt_pdf_bytes_valid():
    pdf = receipts.render_receipt_pdf(
        donor_name="حسینه",
        campaign_title_fa="کمپین تست",
        campaign_title_ar="حملة اختبار",
        campaign_title_en="Test Campaign",
        amount_irr=500_000,
        gateway="zarinpal",
        gateway_reference="REF-X",
        intent_id=str(uuid.uuid4()),
        receipt_id=str(uuid.uuid4()),
        paid_at_iso="2026-10-19T09:00:00+00:00",
    )
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 2000


@pytest.mark.asyncio
async def test_receipt_schema_guard():
    """schemas اجازهٔ gateway ناشناس نمی‌دهد (قرارداد API صریح)."""
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        schemas.DonateIn(amount=100, gateway="nope")
