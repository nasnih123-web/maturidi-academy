"""لایهٔ سرویس فاز ۱۵ — مالی، اهدا و درگاه پرداخت (ADR-0013).

§۱۵.۶: router هرگز مستقیم به دیتابیس دسترسی ندارد — همهٔ کوئری‌ها اینجاست.
§۱۵.۲: منطق کسب‌وکار فقط در این لایه تکرار می‌شود.

قراردادهای idempotency (§۴):
- Idempotency-Key (هدر HTTP) → فرمانِ «ایجاد نیت پرداخت» را idempotent می‌کند:
  کلید تکراری → همان ردیف `payment_intents` برمی‌گردد، بدون تراکنش جدید.
- event_id هویت رویداد `donation.completed` است؛ idempotency_key آن رویداد از
  کلیدِ درخواست مشتق می‌شود تا consumerها دوبار پردازش نکنند.
- gateway_reference (زرین‌پال: ref_id) هویت پرداختِ سمت درگاه است؛ تکرار
  کال‌بک/وبهوک هرگز ردیف دوم donation/ledger نمی‌سازد.
"""
from __future__ import annotations

import base64
import hashlib
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import get_setting, get_typed_setting
from app.core.storage import get_storage
from app.models.models import (
    Donation,
    DonationCampaign,
    LedgerEntry,
    ManualDonationProof,
    PaymentIntent,
    PaymentWebhookLog,
    RecurringDonation,
    User,
)

from . import fx, gateways, receipts, schemas

_MAX_DONATE_IRR = 100_000_000_000  # سقف هر تراکنش: ۱۰^۱۱ ریال
_CURSOR_LIMIT = 50

# قلاب تزریق برای تست: کلاینت httpx موک‌شده (MockTransport).
# در مسیر عملیاتی همیشه None است (§۱۵.۹ — بدون mock در production path).
_TEST_HTTP_CLIENT: httpx.AsyncClient | None = None


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# cursor
# ---------------------------------------------------------------------------


def _encode_cursor(ts: datetime, lid: UUID) -> str:
    raw = f"{ts.astimezone(UTC).isoformat()}|{lid}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts_s, id_s = raw.rsplit("|", 1)
        return datetime.fromisoformat(ts_s), UUID(id_s)
    except Exception:
        raise APIError(400, "bad_cursor", "نشانگر صفحه‌بندی نامعتبر است")


# ---------------------------------------------------------------------------
# درگاه
# ---------------------------------------------------------------------------


async def _gateway_config(db: AsyncSession, gateway_name: str) -> tuple[str, bool]:
    """(merchant_key, sandbox) — کلید همیشه از platform_settings (§۳)."""
    if gateway_name == "zarinpal":
        key = await get_setting(db, "payment.zarinpal_key")
        sandbox = await get_typed_setting(db, "payment.zarinpal_sandbox", True)
        sandbox = bool(sandbox) if sandbox is not None else True
    elif gateway_name == "idpay":
        key = await get_setting(db, "payment.idpay_key")
        sandbox = await get_typed_setting(db, "payment.idpay_sandbox", True)
        sandbox = bool(sandbox) if sandbox is not None else True
    else:
        raise APIError(400, "unknown_gateway", "درگاه پرداخت نامعتبر است")
    if not key:
        raise APIError(
            503,
            "payment_not_configured",
            "درگاه پرداخت پیکربندی نشده است",
            {"gateway": gateway_name},
        )
    return key, sandbox


def _get_gateway(gateway_name: str, *, sandbox: bool) -> gateways.PaymentGateway:
    """نقطهٔ تزریق: تست‌ها می‌توانند این تابع را monkeypatch کنند."""
    try:
        return gateways.build_gateway(
            gateway_name, sandbox=sandbox, client=_TEST_HTTP_CLIENT
        )
    except gateways.GatewayError as exc:
        raise APIError(400, "unknown_gateway", str(exc))


# ---------------------------------------------------------------------------
# ثبت نهایی موفقیت — قلب idempotency (کال‌بک و وبهوک هر دو از اینجا می‌گذرند)
# ---------------------------------------------------------------------------


async def _finalize_success(
    db: AsyncSession,
    intent: PaymentIntent,
    *,
    ref_id: str,
    actor_type: str = "system",
    actor_id: UUID | None = None,
    ip: str | None = None,
    ua: str | None = None,
    campaign_credit_irr: int | None = None,
) -> Donation:
    """نیت را موفق ثبت می‌کند: donation + ledger + کمپین + رویداد + audit.

    Re-entrant: اگر نیت قبلاً موفق شده، همان donation موجود برمی‌گردد و
    هیچ ردیف تکراری‌ای ساخته نمی‌شود.
    """
    existing = (
        await db.execute(
            select(Donation).where(Donation.payment_intent_id == intent.id)
        )
    ).scalar_one_or_none()
    if existing is not None or intent.status == "succeeded":
        return existing or (
            await db.execute(
                select(Donation).where(Donation.gateway_reference == ref_id)
            )
        ).scalar_one()

    intent.status = "succeeded"
    intent.updated_at = _utcnow()

    donation = Donation(
        donor_id=intent.donor_id,
        payment_intent_id=intent.id,
        campaign_id=intent.campaign_id,
        gateway=intent.gateway,
        gateway_reference=ref_id,
        status="succeeded",
        amount=intent.amount,
        currency=intent.currency,
        donor_name=intent.donor_name,
    )
    db.add(donation)
    await db.flush()  # تا donation.id برای ledger/audit آماده باشد

    db.add(
        LedgerEntry(
            entry_type="donation_in",
            amount=intent.amount,
            currency=intent.currency,
            reference=f"donation:{donation.id}",
            donation_id=donation.id,
        )
    )
    if intent.campaign_id:
        # مجموع کمپین ریالی است. مسیر پیش‌فرض (درگاه): فقط اهدای IRR شمرده
        # می‌شود. مسیر حمایت دستی هنگام تأیید، اعتبار ریالی را صریح می‌دهد:
        # برای ریالی همان مبلغ و برای ارزی معادلِ تبدیل‌شده با نرخ لحظه‌ای —
        # پس مجموع و درصد کمپین همهٔ ارزها را پوشش می‌دهد (درخواست مالک).
        credit = campaign_credit_irr
        if credit is None and intent.currency == "IRR":
            credit = intent.amount
        if credit:
            campaign = await db.get(DonationCampaign, intent.campaign_id)
            if campaign is not None:
                campaign.raised_amount = (campaign.raised_amount or 0) + credit
                campaign.updated_at = _utcnow()

    await log_audit(
        db,
        actor_id=actor_id,
        actor_type=actor_type,
        action="finance.donation_succeeded",
        entity_type="donation",
        entity_id=str(donation.id),
        new_values={
            "amount": intent.amount,
            "currency": intent.currency,
            "gateway": intent.gateway,
            "gateway_reference": ref_id,  # کد مرجع — نه secret
            "campaign_id": str(intent.campaign_id) if intent.campaign_id else None,
        },
        ip=ip,
        user_agent=ua,
    )
    # §۴: idempotency_key رویداد از کلیدِ فرمان مشتق می‌شود — نه همان event_id.
    await emit_event(
        db,
        aggregate_type="donation",
        aggregate_id=str(donation.id),
        event_type="donation.completed",
        payload={
            "donation_id": str(donation.id),
            "intent_id": str(intent.id),
            "amount": intent.amount,
            "currency": intent.currency,
            "gateway": intent.gateway,
            "gateway_reference": ref_id,
            "campaign_id": str(intent.campaign_id) if intent.campaign_id else None,
        },
        idempotency_key=f"donate:{intent.idempotency_key}",
    )
    await db.commit()
    return donation


# ---------------------------------------------------------------------------
# POST /donate
# ---------------------------------------------------------------------------


async def create_donation_intent(
    db: AsyncSession,
    *,
    idempotency_key: str,
    body: schemas.DonateIn,
    user: User | None,
    ip: str | None,
    ua: str | None,
) -> tuple[schemas.DonateOut, bool]:
    """ایجاد (یا بازیابی) نیت پرداخت.

    برمی‌گرداند (DonateOut, created): اگر کلید تکراری باشد، created=False و
    همان نیتِ موجود — بدون فراخوان جدید به درگاه (§۱).
    """
    if not idempotency_key or not idempotency_key.strip():
        raise APIError(
            422, "missing_idempotency_key", "هدر Idempotency-Key اجباری است"
        )
    if body.amount > _MAX_DONATE_IRR:
        raise APIError(400, "amount_too_large", "مبلغ از سقف مجاز بیشتر است")

    # ۱) نیتِ موجود با همین کلید؟
    existing = (
        await db.execute(
            select(PaymentIntent).where(
                PaymentIntent.idempotency_key == idempotency_key.strip()
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return await _intent_out(db, existing), False

    # روش آنلاین از CRM قابل خاموش‌شدن است (donation.online_enabled)؛
    # نیتِ تازه با روش خاموش ساخته نمی‌شود — replay نیتِ موجود (بالا)
    # همچنان همان رکورد را برمی‌گرداند.
    online_enabled = await get_typed_setting(db, "donation.online_enabled", True)
    if online_enabled is not None and not bool(online_enabled):
        raise APIError(
            403, "donation_method_disabled", "پرداخت آنلاین در حال حاضر غیرفعال است"
        )

    # ۲) کمپین معتبر؟
    campaign_id = body.campaign_id
    if campaign_id is not None:
        campaign = await db.get(DonationCampaign, campaign_id)
        if campaign is None or campaign.status != "active":
            raise APIError(404, "campaign_not_found", "کمپین فعال یافت نشد")

    merchant_key, sandbox = await _gateway_config(db, body.gateway)
    callback_url = body.callback_url or await get_setting(db, "payment.callback_url")
    if not callback_url:
        raise APIError(
            503, "payment_not_configured", "آدرس بازگشت درگاه پیکربندی نشده است"
        )

    intent = PaymentIntent(
        idempotency_key=idempotency_key.strip(),
        amount=body.amount,
        currency=body.currency,
        campaign_id=campaign_id,
        donor_id=user.id if user else None,
        donor_name=body.donor_name,
        status="pending",
        gateway=body.gateway,
    )
    db.add(intent)
    try:
        await db.flush()
    except IntegrityError:
        # مسابقهٔ هم‌زمان با همان کلید — ردیفِ برنده را برگردان
        await db.rollback()
        winner = (
            await db.execute(
                select(PaymentIntent).where(
                    PaymentIntent.idempotency_key == idempotency_key.strip()
                )
            )
        ).scalar_one()
        return await _intent_out(db, winner), False

    gateway = _get_gateway(body.gateway, sandbox=sandbox)
    description = "Donation to Maturidi Academy"  # توضیح فنی درگاه — لاتین طبق API زرین‌پال
    try:
        req = await gateway.request_payment(
            amount=body.amount,
            description=description,
            callback_url=callback_url,
            merchant_key=merchant_key,
        )
    except gateways.GatewayError as exc:
        intent.status = "failed"
        intent.updated_at = _utcnow()
        await db.commit()
        raise APIError(502, "gateway_request_failed", "درخواست پرداخت به درگاه ناموفق بود") from exc

    intent.authority = req.authority
    intent.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=user.id if user else None,
        actor_type="user" if user else "anonymous",
        action="finance.intent_created",
        entity_type="payment_intent",
        entity_id=str(intent.id),
        new_values={
            "amount": body.amount,
            "currency": body.currency,
            "gateway": body.gateway,
            "campaign_id": str(campaign_id) if campaign_id else None,
            # authority/ref در لاگ امن‌اند؛ merchant_key هرگز (§۱۴)
        },
        ip=ip,
        user_agent=ua,
    )
    await db.commit()
    return await _intent_out(db, intent, sandbox=sandbox), True


async def _intent_sandbox(db: AsyncSession, gateway_name: str) -> bool:
    key = (
        "payment.idpay_sandbox"
        if gateway_name == "idpay"
        else "payment.zarinpal_sandbox"
    )
    value = await get_typed_setting(db, key, True)
    return bool(value) if value is not None else True


async def _intent_out(
    db: AsyncSession, intent: PaymentIntent, *, sandbox: bool | None = None
) -> schemas.DonateOut:
    if not intent.authority:
        raise APIError(500, "intent_broken", "نیت پرداخت ناقص است")
    if sandbox is None:
        sandbox = await _intent_sandbox(db, intent.gateway)
    if intent.gateway == "idpay":
        pay_url = gateways.IdpayGateway(sandbox=sandbox).pay_url_for(intent.authority)
    else:
        pay_base = (
            gateways.ZARINPAL_SANDBOX_PAY if sandbox else gateways.ZARINPAL_PROD_PAY
        )
        pay_url = f"{pay_base}/{intent.authority}"
    return schemas.DonateOut(
        intent_id=intent.id,
        authority=intent.authority,
        pay_url=pay_url,
        status=intent.status,
        amount=intent.amount,
        currency=intent.currency,
    )


# ---------------------------------------------------------------------------
# GET /callback — مقصد redirect زرین‌پال
# ---------------------------------------------------------------------------


async def handle_callback(
    db: AsyncSession,
    *,
    authority: str,
    status: str,
    ip: str | None,
    ua: str | None,
) -> dict:
    """پردازش بازگشت از درگاه. Re-entrant: تکرار همان کال‌بک امن است."""
    intent = (
        await db.execute(
            select(PaymentIntent).where(PaymentIntent.authority == authority)
        )
    ).scalar_one_or_none()
    if intent is None:
        raise APIError(404, "intent_not_found", "نیت پرداختی با این شناسه یافت نشد")

    if intent.status == "succeeded":
        donation = (
            await db.execute(
                select(Donation).where(Donation.payment_intent_id == intent.id)
            )
        ).scalar_one_or_none()
        return {
            "intent_id": str(intent.id),
            "status": "succeeded",
            "donation_id": str(donation.id) if donation else None,
        }

    if status.upper() != "OK":
        # کاربر پرداخت را لغو کرد یا درگاه خطا داد
        if intent.status == "pending":
            intent.status = "failed"
            intent.updated_at = _utcnow()
            await log_audit(
                db,
                actor_id=None,
                actor_type="system",
                action="finance.intent_failed",
                entity_type="payment_intent",
                entity_id=str(intent.id),
                new_values={"status": "failed", "gateway_status": status},
                ip=ip,
                user_agent=ua,
            )
            await db.commit()
        return {"intent_id": str(intent.id), "status": intent.status, "donation_id": None}

    if intent.status in ("failed", "cancelled"):
        raise APIError(409, "intent_closed", "این نیت پرداخت بسته شده است")

    merchant_key, sandbox = await _gateway_config(db, intent.gateway)
    gateway = _get_gateway(intent.gateway, sandbox=sandbox)
    try:
        result = await gateway.verify_payment(
            authority=authority, amount=intent.amount, merchant_key=merchant_key
        )
    except gateways.GatewayError as exc:
        raise APIError(
            502, "payment_verification_failed", "تأیید پرداخت در درگاه ناموفق بود"
        ) from exc

    donation = await _finalize_success(
        db, intent, ref_id=result.ref_id, ip=ip, ua=ua
    )
    return {
        "intent_id": str(intent.id),
        "status": "succeeded",
        "donation_id": str(donation.id),
        "gateway_reference": donation.gateway_reference,
    }


# ---------------------------------------------------------------------------
# POST /callback/idpay — بازگشت مرورگر از آیدی‌پی (فرم POST)
# ---------------------------------------------------------------------------

# وضعیت‌های تراکنش آیدی‌پی که یعنی «پول پرداخت شده، منتظر verify»:
# ۱ پرداخت‌شده | ۱۰ در انتظار تأیید | ۱۰۰/۱۰۱ تأییدشده
_IDPAY_PAID_STATUSES = {"1", "10", "100", "101"}


async def handle_idpay_callback(
    db: AsyncSession,
    *,
    fields: dict,
    ip: str | None,
    ua: str | None,
) -> dict:
    """پردازش بازگشت آیدی‌پی. اصالت فقط با verify سمت‌سرور ثابت می‌شود —
    فیلدهای فرم به‌تنهایی هرگز مبنای ثبت اهدا نیستند. Re-entrant."""
    tx_id = str(fields.get("id") or "")
    order_id = str(fields.get("order_id") or "")
    status = str(fields.get("status") or "")
    if not tx_id:
        raise APIError(400, "bad_callback_payload", "فیلد id اجباری است")

    authority = f"{tx_id}:{order_id}" if order_id else tx_id
    intent = (
        await db.execute(
            select(PaymentIntent).where(PaymentIntent.authority == authority)
        )
    ).scalar_one_or_none()
    if intent is None and order_id:
        # رکوردهای قدیمی‌تر ممکن است authority ساده (فقط tx_id) داشته باشند
        intent = (
            await db.execute(
                select(PaymentIntent).where(PaymentIntent.authority == tx_id)
            )
        ).scalar_one_or_none()
    if intent is None:
        raise APIError(404, "intent_not_found", "نیت پرداختی با این شناسه یافت نشد")

    if intent.status == "succeeded":
        donation = (
            await db.execute(
                select(Donation).where(Donation.payment_intent_id == intent.id)
            )
        ).scalar_one_or_none()
        return {
            "intent_id": str(intent.id),
            "status": "succeeded",
            "donation_id": str(donation.id) if donation else None,
        }

    if status not in _IDPAY_PAID_STATUSES:
        if intent.status == "pending":
            intent.status = "failed"
            intent.updated_at = _utcnow()
            await log_audit(
                db,
                actor_id=None,
                actor_type="system",
                action="finance.intent_failed",
                entity_type="payment_intent",
                entity_id=str(intent.id),
                new_values={"status": "failed", "gateway_status": status},
                ip=ip,
                user_agent=ua,
            )
            await db.commit()
        return {"intent_id": str(intent.id), "status": intent.status, "donation_id": None}

    if intent.status in ("failed", "cancelled"):
        raise APIError(409, "intent_closed", "این نیت پرداخت بسته شده است")

    merchant_key, sandbox = await _gateway_config(db, "idpay")
    gateway = _get_gateway("idpay", sandbox=sandbox)
    try:
        result = await gateway.verify_payment(
            authority=intent.authority or authority,
            amount=intent.amount,
            merchant_key=merchant_key,
        )
    except gateways.GatewayError as exc:
        raise APIError(
            502, "payment_verification_failed", "تأیید پرداخت در درگاه ناموفق بود"
        ) from exc

    donation = await _finalize_success(
        db, intent, ref_id=result.ref_id, ip=ip, ua=ua
    )
    return {
        "intent_id": str(intent.id),
        "status": "succeeded",
        "donation_id": str(donation.id),
        "gateway_reference": donation.gateway_reference,
    }


# ---------------------------------------------------------------------------
# POST /webhook/{gateway}
# ---------------------------------------------------------------------------


def _webhook_signature_header(headers: dict, gateway_name: str) -> str | None:
    # IDPay و درگاه‌های مشابه: X-Webhook-Signature
    for key in ("x-webhook-signature", "x-signature", "signature"):
        if headers.get(key):
            return headers[key]
    return None


async def handle_webhook(
    db: AsyncSession,
    *,
    gateway_name: str,
    raw_body: bytes,
    headers: dict,
    ip: str | None,
) -> schemas.WebhookOut:
    """پردازش idempotent وبهوک.

    ۱) dedupe با payload_hash (هر payload فقط یک‌بار).
    ۲) احراز اصالت: درگاه‌های امضادار → HMAC؛ زرین‌پال → فراخوان verify
       سمت‌سرور روی authority (ADR-0013 §وبهوک).
    ۳) ثبت نهایی از مسیر مشترک `_finalize_success` (re-entrant).
    """
    payload_hash = hashlib.sha256(raw_body).hexdigest()
    seen = (
        await db.execute(
            select(PaymentWebhookLog).where(
                PaymentWebhookLog.payload_hash == payload_hash,
                PaymentWebhookLog.status.in_(("processed", "duplicate")),
            )
        )
    ).scalar_one_or_none()
    if seen is not None:
        # replay تکراری — ۲۰۰ بدون اثر دوم
        dup = PaymentWebhookLog(
            gateway=gateway_name,
            payload_hash=payload_hash
            + ":dup:"
            + hashlib.sha256(str(_utcnow()).encode()).hexdigest()[:8],
            status="duplicate",
            processed_at=_utcnow(),
        )
        db.add(dup)
        await db.commit()
        return schemas.WebhookOut(already_processed=True, status="duplicate")

    try:
        import json as _json

        payload = _json.loads(raw_body.decode("utf-8") or "{}")
    except Exception:
        await _log_webhook_rejected(db, gateway_name, raw_body, "bad_json")
        raise APIError(400, "bad_webhook_payload", "بدنهٔ وبهوک نامعتبر است")

    merchant_key, sandbox = await _gateway_config(db, gateway_name)
    gateway = _get_gateway(gateway_name, sandbox=sandbox)

    if gateway_name in ("zarinpal", "idpay"):
        # زرین‌پال و آیدی‌پی امضا نمی‌فرستند؛ اصالت = verify سمت‌سرور
        if gateway_name == "zarinpal":
            authority = payload.get("authority")
            amount = payload.get("amount")
        else:
            # payload آیدی‌پی: id + order_id جدا می‌آیند؛ authority ذخیره‌شده
            # قالب «<id>:<order_id>» دارد (قرارداد IdpayGateway).
            tx_id = payload.get("id")
            order_id = payload.get("order_id")
            authority = f"{tx_id}:{order_id}" if tx_id and order_id else tx_id
            amount = 0  # verify آیدی‌پی مبلغ را از رکورد خودش می‌خواند
        if not authority:
            await _log_webhook_rejected(db, gateway_name, raw_body, "missing_authority")
            raise APIError(400, "bad_webhook_payload", "فیلد authority اجباری است")
        try:
            result = await gateway.verify_payment(
                authority=str(authority),
                amount=int(amount) if amount else 0,
                merchant_key=merchant_key,
            )
        except (gateways.GatewayError, ValueError) as exc:
            await _log_webhook_rejected(db, gateway_name, raw_body, "verify_failed")
            raise APIError(401, "webhook_verification_failed", "تأیید وبهوک ناموفق بود") from exc
        ref_id = result.ref_id
    else:
        webhook_secret = await get_setting(db, "payment.webhook_secret")
        signature = _webhook_signature_header(headers, gateway_name)
        if not gateway.verify_webhook_signature(
            raw_body=raw_body, signature=signature, webhook_secret=webhook_secret
        ):
            await _log_webhook_rejected(db, gateway_name, raw_body, "bad_signature")
            raise APIError(401, "bad_webhook_signature", "امضای وبهوک نامعتبر است")
        authority = payload.get("authority")
        ref_id = payload.get("gateway_reference") or payload.get("ref_id")
        if not authority or not ref_id:
            await _log_webhook_rejected(db, gateway_name, raw_body, "missing_fields")
            raise APIError(400, "bad_webhook_payload", "فیلدهای وبهوک ناقص است")

    intent = (
        await db.execute(
            select(PaymentIntent).where(PaymentIntent.authority == str(authority))
        )
    ).scalar_one_or_none()
    if intent is None:
        await _log_webhook_rejected(db, gateway_name, raw_body, "intent_not_found")
        raise APIError(404, "intent_not_found", "نیت پرداختی با این شناسه یافت نشد")

    try:
        donation = await _finalize_success(
            db, intent, ref_id=str(ref_id), ip=ip
        )
    except IntegrityError:
        # مسابقهٔ هم‌زمان دو وبهوک یکسان — ردیف برنده قبلاً ثبت شده
        await db.rollback()
        return schemas.WebhookOut(already_processed=True, status="duplicate")

    db.add(
        PaymentWebhookLog(
            gateway=gateway_name,
            payload_hash=payload_hash,
            status="processed",
            processed_at=_utcnow(),
        )
    )
    await log_audit(
        db,
        actor_id=None,
        actor_type="system",
        action="finance.webhook_received",
        entity_type="donation",
        entity_id=str(donation.id),
        new_values={"gateway": gateway_name, "gateway_reference": str(ref_id)},
        ip=ip,
    )
    await db.commit()
    return schemas.WebhookOut(already_processed=False, status="processed")


async def _log_webhook_rejected(
    db: AsyncSession, gateway_name: str, raw_body: bytes, reason: str
) -> None:
    # هشِ rejected نمک‌دار است تا retry مشروعِ بعدی با همان payload
    # با ردیف rejected برخورد نکند (dedupe فقط روی processed/duplicate است).
    salt = hashlib.sha256((str(_utcnow()) + reason).encode()).hexdigest()[:12]
    db.add(
        PaymentWebhookLog(
            gateway=gateway_name,
            payload_hash=hashlib.sha256(raw_body).hexdigest() + ":rej:" + salt,
            status="rejected",
            processed_at=_utcnow(),
        )
    )
    await db.commit()


# ---------------------------------------------------------------------------
# رسید PDF
# ---------------------------------------------------------------------------


async def get_receipt_pdf(
    db: AsyncSession, *, donation_id: UUID, requester: User
) -> tuple[bytes, str]:
    """رسید سه‌زبانه — دسترسی: مالک اهدا یا finance.manage (§۱۴/حریم خصوصی)."""
    from app.models.models import Permission, RolePermission, UserRole

    donation = await db.get(Donation, donation_id)
    if donation is None:
        raise APIError(404, "donation_not_found", "اهدا یافت نشد")

    is_owner = donation.donor_id is not None and donation.donor_id == requester.id
    if not is_owner:
        has_perm = (
            await db.execute(
                select(Permission.id)
                .select_from(UserRole)
                .join(RolePermission, RolePermission.role_id == UserRole.role_id)
                .join(Permission, Permission.id == RolePermission.permission_id)
                .where(
                    UserRole.user_id == requester.id,
                    Permission.key == "finance.manage",
                )
                .limit(1)
            )
        ).first()
        if not has_perm:
            raise APIError(403, "forbidden", "دسترسی کافی نیست")

    campaign = (
        await db.get(DonationCampaign, donation.campaign_id)
        if donation.campaign_id
        else None
    )
    title = (campaign.title if campaign else None) or {"fa": "—", "ar": "—", "en": "—"}
    pdf = receipts.render_receipt_pdf(
        donor_name=donation.donor_name or "اهداکنندهٔ گرامی",
        campaign_title_fa=title.get("fa", "—"),
        campaign_title_ar=title.get("ar", "—"),
        campaign_title_en=title.get("en", "—"),
        amount_irr=donation.amount,
        gateway=donation.gateway,
        gateway_reference=donation.gateway_reference,
        intent_id=str(donation.payment_intent_id),
        receipt_id=str(donation.id),
        paid_at_iso=donation.created_at.astimezone(UTC).isoformat(),
    )
    filename = f"receipt-{donation.id}.pdf"
    return pdf, filename


# ---------------------------------------------------------------------------
# کمپین‌ها
# ---------------------------------------------------------------------------


def _campaign_out(c: DonationCampaign) -> schemas.CampaignOut:
    progress = (c.raised_amount / c.goal_amount) if c.goal_amount else 0.0
    return schemas.CampaignOut(
        id=c.id,
        title=schemas.LocalizedText(**c.title),
        description=schemas.LocalizedText(**c.description) if c.description else None,
        goal_amount=c.goal_amount,
        raised_amount=c.raised_amount,
        progress=round(progress, 4),
        status=c.status,
        cover=c.cover,
        created_at=c.created_at,
    )


async def list_campaigns(
    db: AsyncSession, *, active_only: bool = True
) -> list[schemas.CampaignOut]:
    stmt = select(DonationCampaign).order_by(DonationCampaign.created_at.desc())
    if active_only:
        stmt = stmt.where(DonationCampaign.status == "active")
    rows = (await db.execute(stmt)).scalars().all()
    return [_campaign_out(c) for c in rows]


async def get_campaign(db: AsyncSession, campaign_id: UUID) -> schemas.CampaignOut:
    campaign = await db.get(DonationCampaign, campaign_id)
    if campaign is None or campaign.status != "active":
        raise APIError(404, "campaign_not_found", "کمپین فعال یافت نشد")
    return _campaign_out(campaign)


async def create_campaign(
    db: AsyncSession,
    *,
    body: schemas.CampaignIn,
    admin: User,
    ip: str | None,
    ua: str | None,
) -> schemas.CampaignOut:
    campaign = DonationCampaign(
        title=body.title.model_dump(),
        description=body.description.model_dump() if body.description else None,
        goal_amount=body.goal_amount,
        raised_amount=0,
        status=body.status,
        cover=body.cover,
    )
    db.add(campaign)
    await db.flush()
    await log_audit(
        db,
        actor_id=admin.id,
        actor_type="user",
        action="finance.campaign_created",
        entity_type="donation_campaign",
        entity_id=str(campaign.id),
        new_values={"title": body.title.model_dump(), "goal_amount": body.goal_amount},
        ip=ip,
        user_agent=ua,
    )
    await db.commit()
    return _campaign_out(campaign)


async def update_campaign(
    db: AsyncSession,
    *,
    campaign_id: UUID,
    body: schemas.CampaignIn,
    admin: User,
    ip: str | None,
    ua: str | None,
) -> schemas.CampaignOut:
    campaign = await db.get(DonationCampaign, campaign_id)
    if campaign is None:
        raise APIError(404, "campaign_not_found", "کمپین یافت نشد")
    old = {"status": campaign.status, "goal_amount": campaign.goal_amount}
    campaign.title = body.title.model_dump()
    campaign.description = body.description.model_dump() if body.description else None
    campaign.goal_amount = body.goal_amount
    campaign.status = body.status
    campaign.cover = body.cover
    campaign.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=admin.id,
        actor_type="user",
        action="finance.campaign_updated",
        entity_type="donation_campaign",
        entity_id=str(campaign.id),
        old_values=old,
        new_values={"status": body.status, "goal_amount": body.goal_amount},
        ip=ip,
        user_agent=ua,
    )
    await db.commit()
    return _campaign_out(campaign)


async def delete_campaign(
    db: AsyncSession,
    *,
    campaign_id: UUID,
    admin: User,
    ip: str | None,
    ua: str | None,
) -> None:
    campaign = await db.get(DonationCampaign, campaign_id)
    if campaign is None:
        raise APIError(404, "campaign_not_found", "کمپین یافت نشد")
    old = {"title": campaign.title, "goal_amount": campaign.goal_amount}
    has_donations = (
        await db.execute(
            select(Donation.id)
            .where(Donation.campaign_id == campaign_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if has_donations is not None:
        raise APIError(
            409, "campaign_has_donations",
            "این کمپین اهدا دارد و نمی‌توان آن را حذف کرد",
        )
    await db.delete(campaign)
    await log_audit(
        db,
        actor_id=admin.id,
        actor_type="user",
        action="finance.campaign_deleted",
        entity_type="donation_campaign",
        entity_id=str(campaign.id),
        old_values=old,
        ip=ip,
        user_agent=ua,
    )
    await db.commit()


# ---------------------------------------------------------------------------
# لیست اهداها و دفتر (cursor)
# ---------------------------------------------------------------------------


def _donation_out(d: Donation) -> schemas.DonationOut:
    return schemas.DonationOut(
        id=d.id,
        intent_id=d.payment_intent_id,
        gateway=d.gateway,
        gateway_reference=d.gateway_reference,
        status=d.status,
        amount=d.amount,
        currency=d.currency,
        campaign_id=d.campaign_id,
        donor_name=d.donor_name,
        created_at=d.created_at,
    )


async def list_donations(
    db: AsyncSession, *, cursor: str | None, limit: int
) -> tuple[list[schemas.DonationOut], str | None]:
    limit = min(max(limit, 1), _CURSOR_LIMIT)
    stmt = select(Donation).order_by(desc(Donation.created_at), desc(Donation.id))
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Donation.created_at < ts,
                (Donation.created_at == ts) & (Donation.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return [_donation_out(d) for d in rows], next_cursor


async def list_ledger(
    db: AsyncSession, *, cursor: str | None, limit: int
) -> tuple[list[schemas.LedgerOut], str | None]:
    limit = min(max(limit, 1), _CURSOR_LIMIT)
    stmt = select(LedgerEntry).order_by(desc(LedgerEntry.created_at), desc(LedgerEntry.id))
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                LedgerEntry.created_at < ts,
                (LedgerEntry.created_at == ts) & (LedgerEntry.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    items = [
        schemas.LedgerOut(
            id=r.id,
            entry_type=r.entry_type,
            amount=r.amount,
            currency=r.currency,
            reference=r.reference,
            donation_id=r.donation_id,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return items, next_cursor


# ---------------------------------------------------------------------------
# تطبیق (reconciliation)
# ---------------------------------------------------------------------------


async def reconcile(
    db: AsyncSession, *, gateway_name: str
) -> schemas.ReconcileOut:
    """مقایسهٔ نیت‌های موفق داخلی با گزارش درگاه؛ لیست مغایرت‌ها.

    اگر درگاه گزارش تراکنش ندهد (زرین‌پال API عمومی ندارد)، خطای صادقانهٔ
    ۵۰۳ برمی‌گردد — نه دادهٔ ساختگی (ADR-0013).
    """
    merchant_key, sandbox = await _gateway_config(db, gateway_name)
    gateway = _get_gateway(gateway_name, sandbox=sandbox)
    try:
        report = await gateway.fetch_report(merchant_key=merchant_key)
    except gateways.GatewayError as exc:
        raise APIError(
            503, "gateway_report_unavailable", "گزارش تراکنش این درگاه در دسترس نیست"
        ) from exc

    intents = (
        await db.execute(
            select(PaymentIntent).where(
                PaymentIntent.gateway == gateway_name,
                PaymentIntent.status == "succeeded",
            )
        )
    ).scalars().all()

    donations_by_ref = {
        d.gateway_reference: d
        for d in (
            await db.execute(
                select(Donation).where(Donation.gateway == gateway_name)
            )
        ).scalars().all()
    }
    report_by_ref = {e.ref_id: e for e in report}

    mismatches: list[schemas.ReconcileMismatch] = []
    lt = lambda fa, ar, en: schemas.LocalizedText(fa=fa, ar=ar, en=en)

    for intent in intents:
        donation = next(
            (d for d in donations_by_ref.values() if d.payment_intent_id == intent.id),
            None,
        )
        ref = donation.gateway_reference if donation else None
        entry = report_by_ref.get(ref) if ref else None
        if entry is None:
            mismatches.append(
                schemas.ReconcileMismatch(
                    kind="internal_without_gateway",
                    intent_id=intent.id,
                    gateway_reference=ref,
                    internal_amount=intent.amount,
                    gateway_amount=None,
                    detail=lt(
                        "نیت موفق داخلی در گزارش درگاه نیست",
                        "نية ناجحة داخلية غير موجودة في تقرير البوابة",
                        "Internal succeeded intent missing from gateway report",
                    ),
                )
            )
        elif entry.amount != intent.amount:
            mismatches.append(
                schemas.ReconcileMismatch(
                    kind="amount_mismatch",
                    intent_id=intent.id,
                    gateway_reference=ref,
                    internal_amount=intent.amount,
                    gateway_amount=entry.amount,
                    detail=lt(
                        "مغایرت مبلغ بین رکورد داخلی و درگاه",
                        "عدم تطابق المبلغ بين السجل الداخلي والبوابة",
                        "Amount mismatch between internal record and gateway",
                    ),
                )
            )

    for ref, entry in report_by_ref.items():
        if ref not in donations_by_ref:
            mismatches.append(
                schemas.ReconcileMismatch(
                    kind="gateway_without_internal",
                    intent_id=None,
                    gateway_reference=ref,
                    internal_amount=None,
                    gateway_amount=entry.amount,
                    detail=lt(
                        "تراکنش درگاه بدون رکورد داخلی",
                        "معاملة بوابة بدون سجل داخلي",
                        "Gateway transaction without internal record",
                    ),
                )
            )

    return schemas.ReconcileOut(
        gateway=gateway_name,
        internal_succeeded=len(intents),
        gateway_succeeded=len(report),
        mismatches=mismatches,
    )


# ---------------------------------------------------------------------------
# اهدای مکرر (ثبت؛ اجرای شارژ با فاز ۱۶)
# ---------------------------------------------------------------------------


async def create_recurring(
    db: AsyncSession,
    *,
    body: schemas.RecurringIn,
    user: User,
    ip: str | None,
    ua: str | None,
) -> schemas.RecurringOut:
    if body.campaign_id is not None:
        campaign = await db.get(DonationCampaign, body.campaign_id)
        if campaign is None or campaign.status != "active":
            raise APIError(404, "campaign_not_found", "کمپین فعال یافت نشد")
    rec = RecurringDonation(
        donor_id=user.id,
        campaign_id=body.campaign_id,
        amount=body.amount,
        currency=body.currency,
        interval=body.interval,
        status="active",
        next_charge_at=None,  # شارژ دوره‌ای با صف ARQ فاز ۱۶ زمان‌بندی می‌شود
    )
    db.add(rec)
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="finance.recurring_created",
        entity_type="recurring_donation",
        entity_id=str(rec.id),
        new_values={"amount": body.amount, "interval": body.interval},
        ip=ip,
        user_agent=ua,
    )
    await db.commit()
    return schemas.RecurringOut(
        id=rec.id,
        amount=rec.amount,
        currency=rec.currency,
        campaign_id=rec.campaign_id,
        interval=rec.interval,
        status=rec.status,
        next_charge_at=rec.next_charge_at,
    )


# ---------------------------------------------------------------------------
# وضعیت درگاه‌ها (داشبورد اتصالات — فقط configured، هرگز مقدار secret)
# ---------------------------------------------------------------------------


async def gateway_statuses(db: AsyncSession) -> schemas.GatewayStatusOut:
    """وضعیت پیکربندی درگاه‌ها برای CRM — مقادیر کلید هرگز برنمی‌گردند (§۳)."""
    z_key = await get_setting(db, "payment.zarinpal_key")
    z_sandbox = await get_typed_setting(db, "payment.zarinpal_sandbox", True)
    i_key = await get_setting(db, "payment.idpay_key")
    i_sandbox = await get_typed_setting(db, "payment.idpay_sandbox", True)
    return schemas.GatewayStatusOut(
        zarinpal=schemas.GatewayStatus(
            configured=bool(z_key),
            sandbox=bool(z_sandbox) if z_sandbox is not None else True,
        ),
        idpay=schemas.GatewayStatus(
            configured=bool(i_key),
            sandbox=bool(i_sandbox) if i_sandbox is not None else True,
        ),
    )


# ---------------------------------------------------------------------------
# روش‌های حمایت + حمایت دستی (کارت‌به‌کارت / کریپتو / PayPal)
#
# هر روش جداگانه از CRM (platform_settings: donation.*) روشن/خاموش و
# پیکربندی می‌شود. روش دستی فقط وقتی «در دسترس» است که هم فعال باشد و
# هم مشخصاتش کامل باشد؛ روشِ در دسترس‌نبودن نه در فهرست عمومی می‌آید و
# نه ارسالی می‌پذیرد. ارسال موفق = PaymentIntent(pending) + ردیف اثبات؛
# پول فقط با تأیید ادمین (approve → _finalize_success) ثبت نهایی می‌شود.
# ---------------------------------------------------------------------------

MANUAL_METHODS = ("card", "crypto", "paypal")

_MAX_MANUAL_OTHER = 1_000_000_000_000  # سقف مبلغ روش‌های ارزی (واحد کامل ارز)
RECEIPT_IMAGE_MAX_BYTES = 5 * 1024 * 1024  # سقف تصویر رسید: ۵MB


def _lt(fa: str, ar: str, en: str) -> schemas.LocalizedText:
    return schemas.LocalizedText(fa=fa, ar=ar, en=en)


_METHOD_TITLES = {
    "online": _lt("پرداخت آنلاین (درگاه)", "الدفع عبر الإنترنت (البوابة)", "Online payment (gateway)"),
    "card": _lt("کارت‌به‌کارت", "تحويل من بطاقة إلى بطاقة", "Card-to-card transfer"),
    "crypto": _lt("ارز دیجیتال", "العملات الرقمية", "Cryptocurrency"),
    "paypal": _lt("حمایت خارجی (PayPal)", "الدعم الدولي (PayPal)", "International support (PayPal)"),
}


async def _flag(db: AsyncSession, key: str, default: bool) -> bool:
    value = await get_typed_setting(db, key, default)
    return bool(value) if value is not None else default


async def _localized_setting(db: AsyncSession, key: str) -> schemas.LocalizedText | None:
    raw = await get_typed_setting(db, key, None)
    if not isinstance(raw, dict) or not raw:
        return None
    return schemas.LocalizedText(
        fa=str(raw.get("fa") or ""),
        ar=str(raw.get("ar") or ""),
        en=str(raw.get("en") or ""),
    )


async def _crypto_wallets(db: AsyncSession) -> list[dict]:
    raw = await get_typed_setting(db, "donation.crypto_wallets", None)
    if not isinstance(raw, list):
        return []
    wallets: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        currency = str(item.get("currency") or "").strip()
        address = str(item.get("address") or "").strip()
        network = str(item.get("network") or "").strip()
        if currency and address:
            wallets.append(
                {"currency": currency, "network": network, "address": address}
            )
    return wallets


async def _manual_method_config(db: AsyncSession, method: str) -> dict[str, Any] | None:
    """پیکربندی روش دستی — None یعنی روش در دسترس نیست (خاموش یا ناقص)."""
    if method == "card":
        if not await _flag(db, "donation.card_enabled", False):
            return None
        number = await get_setting(db, "donation.card_number")
        if not number or not number.strip():
            return None
        return {
            "currency": "IRR",
            "card_number": number.strip(),
            "card_holder": await get_setting(db, "donation.card_holder"),
            "instructions": await _localized_setting(db, "donation.card_instructions"),
        }
    if method == "crypto":
        if not await _flag(db, "donation.crypto_enabled", False):
            return None
        wallets = await _crypto_wallets(db)
        if not wallets:
            return None
        return {
            "wallets": wallets,
            "instructions": await _localized_setting(db, "donation.crypto_instructions"),
        }
    if method == "paypal":
        if not await _flag(db, "donation.paypal_enabled", False):
            return None
        account = await get_setting(db, "donation.paypal_account")
        if not account or not account.strip():
            return None
        return {
            "currency": "USD",
            "paypal_account": account.strip(),
            "instructions": await _localized_setting(db, "donation.paypal_instructions"),
        }
    return None


async def donation_methods(db: AsyncSession) -> schemas.DonationMethodsOut:
    """فهرست عمومی روش‌های پرداخت — فقط روش‌های فعال و کامل."""
    methods: list[schemas.DonationMethodOut] = []

    if await _flag(db, "donation.online_enabled", True):
        configured: list[str] = []
        if await get_setting(db, "payment.zarinpal_key"):
            configured.append("zarinpal")
        if await get_setting(db, "payment.idpay_key"):
            configured.append("idpay")
        if configured:
            methods.append(
                schemas.DonationMethodOut(
                    method="online",
                    title=_METHOD_TITLES["online"],
                    gateways=configured,
                )
            )

    card = await _manual_method_config(db, "card")
    if card is not None:
        methods.append(
            schemas.DonationMethodOut(
                method="card",
                title=_METHOD_TITLES["card"],
                instructions=card["instructions"],
                currency="IRR",
                card_number=card["card_number"],
                card_holder=card["card_holder"],
            )
        )

    crypto = await _manual_method_config(db, "crypto")
    if crypto is not None:
        methods.append(
            schemas.DonationMethodOut(
                method="crypto",
                title=_METHOD_TITLES["crypto"],
                instructions=crypto["instructions"],
                wallets=[
                    schemas.CryptoWalletOut(
                        currency=w["currency"],
                        network=w["network"],
                        address=w["address"],
                    )
                    for w in crypto["wallets"]
                ],
            )
        )

    paypal = await _manual_method_config(db, "paypal")
    if paypal is not None:
        methods.append(
            schemas.DonationMethodOut(
                method="paypal",
                title=_METHOD_TITLES["paypal"],
                instructions=paypal["instructions"],
                currency="USD",
                paypal_account=paypal["paypal_account"],
            )
        )

    return schemas.DonationMethodsOut(methods=methods)


def _sniff_receipt_image(data: bytes) -> tuple[str, str] | None:
    """تشخیص نوع تصویر رسید از magic bytes — به mime کلاینت اعتماد نمی‌شود."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


async def submit_manual_donation(
    db: AsyncSession,
    *,
    method: str,
    amount: int,
    campaign_id: UUID | None,
    donor_name: str | None,
    proof_text: str | None,
    image_data: bytes | None,
    wallet_currency: str | None,
    wallet_network: str | None,
    user: User | None,
    ip: str | None,
    ua: str | None,
) -> schemas.ManualDonationOut:
    """ثبت حمایت دستی در وضعیت pending — پول هنوز ثبت نهایی نشده است."""
    if method not in MANUAL_METHODS:
        raise APIError(400, "unknown_method", "روش پرداخت نامعتبر است")
    cfg = await _manual_method_config(db, method)
    if cfg is None:
        raise APIError(
            403, "donation_method_disabled", "این روش پرداخت در حال حاضر فعال نیست"
        )
    if amount <= 0:
        raise APIError(400, "invalid_amount", "مبلغ باید بزرگ‌تر از صفر باشد")
    cap = _MAX_DONATE_IRR if method == "card" else _MAX_MANUAL_OTHER
    if amount > cap:
        raise APIError(400, "amount_too_large", "مبلغ از سقف مجاز بیشتر است")

    if campaign_id is not None:
        campaign = await db.get(DonationCampaign, campaign_id)
        if campaign is None or campaign.status != "active":
            raise APIError(404, "campaign_not_found", "کمپین فعال یافت نشد")

    currency = str(cfg.get("currency") or "")
    wallet_label: str | None = None
    if method == "crypto":
        want_currency = (wallet_currency or "").strip().upper()
        want_network = (wallet_network or "").strip().upper()
        wallet = next(
            (
                w
                for w in cfg["wallets"]
                if w["currency"].upper() == want_currency
                and w["network"].upper() == want_network
            ),
            None,
        )
        if wallet is None:
            raise APIError(
                400, "wallet_not_available", "کیف پول انتخاب‌شده در دسترس نیست"
            )
        currency = wallet["currency"].upper()
        wallet_label = (
            f"{wallet['currency']} · {wallet['network']}"
            if wallet["network"]
            else wallet["currency"]
        )

    proof_text_clean = (proof_text or "").strip() or None
    image_mime: str | None = None
    image_ext: str | None = None
    if image_data:
        sniffed = _sniff_receipt_image(image_data)
        if sniffed is None:
            raise APIError(
                415,
                "unsupported_receipt_image",
                "تصویر رسید باید PNG یا JPG یا WEBP باشد",
            )
        image_mime, image_ext = sniffed
    if proof_text_clean is None and not image_data:
        raise APIError(
            422, "proof_required", "ارسال رسید (تصویر یا متن/کد رهگیری) الزامی است"
        )

    intent = PaymentIntent(
        idempotency_key=f"manual:{uuid.uuid4().hex}",
        amount=amount,
        currency=currency,
        campaign_id=campaign_id,
        donor_id=user.id if user else None,
        donor_name=donor_name,
        status="pending",
        gateway=method,
    )
    db.add(intent)
    await db.flush()

    image_key: str | None = None
    if image_data and image_ext:
        image_key = f"donation-receipts/{intent.id}/{uuid.uuid4().hex}.{image_ext}"
        await get_storage().put_object(image_key, image_data, image_mime or "")

    proof = ManualDonationProof(
        payment_intent_id=intent.id,
        method=method,
        proof_text=proof_text_clean,
        proof_image_key=image_key,
        proof_image_mime=image_mime,
        wallet_label=wallet_label,
        review_status="pending",
    )
    db.add(proof)
    await db.flush()

    await log_audit(
        db,
        actor_id=user.id if user else None,
        actor_type="user" if user else "anonymous",
        action="finance.manual_donation_submitted",
        entity_type="payment_intent",
        entity_id=str(intent.id),
        new_values={
            "method": method,
            "amount": amount,
            "currency": currency,
            "campaign_id": str(campaign_id) if campaign_id else None,
            "has_proof_image": bool(image_key),
            "has_proof_text": bool(proof_text_clean),
            # خودِ متن رسید/شماره کارت در لاگ نمی‌آید (§۱۴)
        },
        ip=ip,
        user_agent=ua,
    )
    await db.commit()
    return schemas.ManualDonationOut(
        id=proof.id,
        intent_id=intent.id,
        method=method,
        status="pending",
        amount=amount,
        currency=currency,
        created_at=proof.created_at,
    )


def _manual_admin_out(
    proof: ManualDonationProof, intent: PaymentIntent
) -> schemas.ManualDonationAdminOut:
    return schemas.ManualDonationAdminOut(
        id=proof.id,
        intent_id=intent.id,
        method=proof.method,
        status=proof.review_status,
        amount=intent.amount,
        currency=intent.currency,
        campaign_id=intent.campaign_id,
        donor_name=intent.donor_name,
        proof_text=proof.proof_text,
        has_proof_image=bool(proof.proof_image_key),
        wallet_label=proof.wallet_label,
        review_note=proof.review_note,
        reviewed_at=proof.reviewed_at,
        created_at=proof.created_at,
        amount_irr=proof.amount_irr,
        fx_rate_irr=proof.fx_rate_irr,
        fx_source=proof.fx_source,
    )


async def list_manual_donations(
    db: AsyncSession,
    *,
    status: str | None,
    cursor: str | None,
    limit: int,
) -> tuple[list[schemas.ManualDonationAdminOut], str | None]:
    limit = min(max(limit, 1), _CURSOR_LIMIT)
    stmt = (
        select(ManualDonationProof, PaymentIntent)
        .join(PaymentIntent, ManualDonationProof.payment_intent_id == PaymentIntent.id)
        .order_by(desc(ManualDonationProof.created_at), desc(ManualDonationProof.id))
    )
    if status:
        stmt = stmt.where(ManualDonationProof.review_status == status)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                ManualDonationProof.created_at < ts,
                (ManualDonationProof.created_at == ts)
                & (ManualDonationProof.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last_proof = rows[-1][0]
        next_cursor = _encode_cursor(last_proof.created_at, last_proof.id)
    return [_manual_admin_out(p, i) for p, i in rows], next_cursor


async def get_manual_proof_image(
    db: AsyncSession, *, proof_id: UUID
) -> tuple[bytes, str]:
    """بایت‌های تصویر رسید برای نمایش در CRM (فقط finance.manage)."""
    proof = await db.get(ManualDonationProof, proof_id)
    if proof is None:
        raise APIError(404, "manual_donation_not_found", "حمایت دستی یافت نشد")
    if not proof.proof_image_key:
        raise APIError(404, "proof_image_not_found", "برای این حمایت تصویر رسید ثبت نشده است")
    storage = get_storage()
    read_bytes = getattr(storage, "read_bytes", None)
    if read_bytes is None:
        raise APIError(503, "storage_unavailable", "خواندن فایل از storage ممکن نیست")
    data = await read_bytes(proof.proof_image_key)
    return data, proof.proof_image_mime or "application/octet-stream"


async def get_fx_rate(currency: str) -> schemas.FxRateOut:
    """نرخ لحظه‌ای برای نمایش پیش از تأیید در CRM — ۵۰۲ اگر منبعی جواب نداد."""
    cur = (currency or "").strip().upper()
    if not cur or len(cur) > 10 or not cur.isalnum():
        raise APIError(400, "invalid_currency", "ارز نامعتبر است")
    try:
        rate, source = await fx.get_rate_irr(cur)
    except fx.FxUnavailable as exc:
        raise APIError(
            502, "fx_unavailable", "نرخ لحظه‌ای ارز در دسترس نیست؛ نرخ را دستی وارد کنید"
        ) from exc
    return schemas.FxRateOut(currency=cur, rate_irr=rate, source=source)


async def review_manual_donation(
    db: AsyncSession,
    *,
    proof_id: UUID,
    approve: bool,
    note: str | None,
    rate_irr: int | None = None,
    admin: User,
    ip: str | None,
    ua: str | None,
) -> schemas.ManualDonationAdminOut:
    """تأیید/رد حمایت دستی.

    تأیید → _finalize_success (Donation + Ledger + رویداد + audit) با
    مرجعِ متن رسید (هش/کد رهگیری) یا «manual:<intent_id>». هش تکراری
    (همان تراکنش برای دو ارسال) با یکتایی gateway_reference به ۴۰۹
    می‌رسد و ارسال دوم pending می‌ماند.
    رد → intent.cancelled؛ هیچ رکورد مالی‌ای ساخته نمی‌شود.

    حمایت ارزی هنگام تأیید با نرخ لحظه‌ای (یا نرخ دستیِ rate_irr) به
    ریال تبدیل می‌شود و معادلش به مجموع کمپین می‌رود؛ نرخ و منبعش روی
    رکورد اثبات می‌ماند. نبود هر دو نرخ → ۴۲۲ و حمایت pending می‌ماند.
    """
    proof = await db.get(ManualDonationProof, proof_id)
    if proof is None:
        raise APIError(404, "manual_donation_not_found", "حمایت دستی یافت نشد")
    if proof.review_status != "pending":
        raise APIError(409, "already_reviewed", "این حمایت قبلاً بازبینی شده است")
    intent = await db.get(PaymentIntent, proof.payment_intent_id)
    if intent is None:
        raise APIError(404, "intent_not_found", "نیت پرداخت یافت نشد")

    # تبدیل ارزی پیش از هر تغییری حساب می‌شود تا اگر نرخ لحظه‌ای در
    # دسترس نبود و نرخ دستی هم داده نشده بود، حمایت همچنان pending
    # بماند (۴۲۲) و هیچ رکورد نیمه‌کاره‌ای ثبت نشود.
    credit_irr: int | None = None
    fx_rate: int | None = None
    fx_source: str | None = None
    if approve:
        if intent.currency == "IRR":
            credit_irr = intent.amount
        elif rate_irr is not None:
            fx_rate, fx_source = rate_irr, "manual"
            credit_irr = intent.amount * rate_irr
        else:
            try:
                fx_rate, fx_source = await fx.get_rate_irr(intent.currency)
            except fx.FxUnavailable as exc:
                raise APIError(
                    422,
                    "fx_rate_required",
                    "نرخ لحظه‌ای ارز در دسترس نیست؛ نرخ هر واحد را دستی وارد کنید",
                ) from exc
            credit_irr = intent.amount * fx_rate

    proof.reviewed_by = admin.id
    proof.reviewed_at = _utcnow()
    proof.review_note = note
    proof.updated_at = _utcnow()

    if not approve:
        proof.review_status = "rejected"
        intent.status = "cancelled"
        intent.updated_at = _utcnow()
        out = _manual_admin_out(proof, intent)
        await log_audit(
            db,
            actor_id=admin.id,
            actor_type="user",
            action="finance.manual_donation_rejected",
            entity_type="payment_intent",
            entity_id=str(intent.id),
            new_values={"method": proof.method, "note": note},
            ip=ip,
            user_agent=ua,
        )
        await db.commit()
        return out

    proof.review_status = "approved"
    proof.amount_irr = credit_irr
    proof.fx_rate_irr = fx_rate
    proof.fx_source = fx_source
    ref = (
        proof.proof_text
        if proof.proof_text and len(proof.proof_text) <= 100
        else f"manual:{intent.id}"
    )
    out = _manual_admin_out(proof, intent)
    await log_audit(
        db,
        actor_id=admin.id,
        actor_type="user",
        action="finance.manual_donation_approved",
        entity_type="payment_intent",
        entity_id=str(intent.id),
        new_values={
            "method": proof.method,
            "gateway_reference": ref,
            "note": note,
            "amount_irr": credit_irr,
            "fx_rate_irr": fx_rate,
            "fx_source": fx_source,
        },
        ip=ip,
        user_agent=ua,
    )
    try:
        await _finalize_success(
            db,
            intent,
            ref_id=ref,
            actor_type="user",
            actor_id=admin.id,
            ip=ip,
            ua=ua,
            campaign_credit_irr=credit_irr,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise APIError(
            409,
            "duplicate_reference",
            "این رسید/هش قبلاً برای اهدای دیگری ثبت شده است",
        ) from exc
    return out
