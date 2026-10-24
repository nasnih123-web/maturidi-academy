"""لایهٔ سرویس احراز هویت — تنها جایی که منطق auth زندگی می‌کند (فاز ۰ §۱۵، قانون ۶).

روتر هرگز مستقیم به دیتابیس دسترسی ندارد؛ همهٔ نوشتن‌های حساس امنیتی هم
domain_event (outbox) و هم audit log تولید می‌کنند.
"""
from __future__ import annotations

import hmac
import json
import secrets as pysecrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_mod
from app.core import sms as sms_mod
from app.core.audit import log_audit
from app.core.database import ensure_aware
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.rate_limit import get_rate_limiter
from app.core.secrets import decrypt_value, encrypt_value
from app.core.security import (
    SCOPE_2FA_SETUP,
    SCOPE_FULL,
    create_access_token,
    generate_recovery_codes,
    generate_refresh_token,
    generate_totp_secret,
    hash_password,
    hash_token,
    totp_provisioning_uri,
    verify_password,
    verify_totp_step,
)
from app.models.models import (
    NotificationPreference,
    PasswordResetToken,
    PhoneVerificationCode,
    RecoveryCode,
    RefreshToken,
    Role,
    Session,
    User,
    UserConsent,
    UserRole,
    WsTicket,
)
from app.modules.auth.schemas import (
    LoginIn,
    PhoneCodeRequestIn,
    PhoneVerifyIn,
    RegisterIn,
    TwoFAEnableIn,
    TwoFAReauthIn,
    TwoFARecoverIn,
)
from app.modules.content.legal import LEGAL_TEXT_VERSION

REFRESH_EXPIRE_DAYS = 30
EMAIL_VERIFY_EXPIRE_HOURS = 24
PHONE_CODE_EXPIRE_MINUTES = 5
RESET_TOKEN_EXPIRE_HOURS = 1
# بلیط وب‌سوکت: کوتاه‌مدت و یک‌بارمصرف — جایگزین JWT در query string
WS_TICKET_EXPIRE_SECONDS = 60
# تشخیص استفادهٔ مجدد از رفرش‌توکن سخت‌گیرانه است (B-02 — ADR-0024،
# جانشین تصمیم ۲ ADR-0020): هیچ پنجرهٔ اغماضی وجود ندارد. هر ارائهٔ
# توکنِ باطل‌شده — حتی یک ثانیه بعد از چرخش — سرقت تلقی می‌شود: ابطال
# فوری کل نشست + رویداد token.reuse_detected + audit + پاسخ 401.
# race مشروعِ دو تب با قفل رفرش سمت کلاینت (Web Locks + single-flight
# در کلاینت‌های وب/CRM) حل می‌شود، نه با تضعیف سرور.


# ---------- ابزارهای Track 1 (§۵/§۷/§۸/§۹) ----------


def public_url(path: str) -> str:
    """ساخت لینک عمومی از `app_base_url` با اعتبارسنجی (§۸).

    هاست هرگز از هدرهای درخواست (Host/X-Forwarded-Host) خوانده نمی‌شود —
    فقط از تنظیمات سرور؛ پس poisoning هدر Host و open redirect ممکن نیست.
    scheme باید http/https و hostname معتبر باشد (بدون userinfo).
    """
    from urllib.parse import urlparse

    from app.core.config import get_settings

    base = (get_settings().app_base_url or "").strip().rstrip("/")
    parsed = urlparse(base)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise APIError(500, "bad_base_url", "آدرس پایهٔ عمومی نامعتبر است")
    if not path.startswith("/"):
        path = "/" + path
    return f"{base}{path}"


async def _claim_totp_step(
    db: AsyncSession, user: User, step: int, *, error_status: int = 401
) -> None:
    """ثبت اتمیک گام زمانی TOTP — ضد replay (§۵).

    UPDATE مشروط در سطح DB: فقط اگر این گام جدیدتر از آخرین گام مصرف‌شده
    باشد موفق است؛ دو درخواست هم‌زمان با یک کد → فقط یکی `rowcount=1`
    می‌گیرد و دیگری «کد تکراری» می‌خورد. بدون commit صریح — با تراکنش
    فراخواننده می‌ماند.
    """
    res = cast(
        CursorResult[Any],
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .where((User.totp_last_step.is_(None)) | (User.totp_last_step < step))
            .values(totp_last_step=step)
        ),
    )
    if res.rowcount != 1:
        raise APIError(
            error_status, "code_reused", "این کد تأیید قبلاً استفاده شده است"
        )


async def _consume_single_use_token(
    db: AsyncSession, model, row_id, *, error: APIError
) -> None:
    """مصرف اتمیک توکن/کد یک‌بارمصرف در سطح DB (§۹).

    الگوی «بخوان بعد علامت بزن» در پایتون (`if not used: used=True`)
    زیر race هم‌زمان دو بار مصرف می‌شود؛ UPDATE مشروط با `rowcount`
    این را در خود دیتابیس اتمیک می‌کند. بدون commit صریح.
    """
    res = cast(
        CursorResult[Any],
        await db.execute(
            update(model).where(model.id == row_id, model.used.is_(False)).values(used=True)
        ),
    )
    if res.rowcount != 1:
        raise error


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------- helpers ----------

async def _get_user_by_identifier(db: AsyncSession, identifier: str) -> User | None:
    identifier = identifier.strip()
    stmt = select(User).where(
        (User.email == identifier) | (User.phone == identifier)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _revoke_user_tokens(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )
    await db.execute(
        update(Session)
        .where(Session.user_id == user_id, Session.revoked.is_(False))
        .values(revoked=True)
    )


async def _revoke_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    """ابطال یک نشست خاص: همهٔ رفرش‌توکن‌هایش + خود نشست (الگوی turbo — reuse)."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.session_id == session_id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )
    await db.execute(
        update(Session).where(Session.id == session_id).values(revoked=True)
    )


# نقش‌هایی که طبق قرارداد فاز ۰ §۲ ثبت‌نام 2FA برایشان اجباری است
PRIVILEGED_ROLE_NAMES = frozenset({"admin", "super_admin"})


async def user_role_names(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    """نام نقش‌های کاربر — همیشه از user_roles، هرگز از ستون role (که نداریم)."""
    rows = await db.execute(
        select(Role.name)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
    )
    return set(rows.scalars().all())


async def must_enroll_2fa(db: AsyncSession, user: User) -> bool:
    """ادمین/super_admin بدون TOTP باید 2FA ثبت‌نام کند (قرارداد §۲، الگوی turbo).

    فقط یک پرچم برمی‌گرداند — تصمیمِ «وارد CRM نشود» با کلاینت (CRM) است؛
    قرارداد API با افزودن همین فیلد دست‌نخورده می‌ماند.
    """
    if user.totp_secret:
        return False
    return bool(await user_role_names(db, user.id) & PRIVILEGED_ROLE_NAMES)


# ---------- register ----------

async def register(
    db: AsyncSession, data: RegisterIn, ip: str | None, user_agent: str | None
) -> User:
    # گیت کپچا (C-02 — ADR-0029): پیش از هر کاری، طبق ماشین وضعیت
    # app/core/captcha.py — active یعنی توکن معتبر Turnstile الزامی.
    from app.core.captcha import enforce_captcha

    await enforce_captcha(data.captcha_token, ip)
    if not data.accept_terms:
        raise APIError(422, "terms_required", "پذیرش قوانین و حریم‌خصوصی الزامی است")
    if not data.email and not data.phone:
        raise APIError(422, "contact_required", "ایمیل یا شماره تلفن الزامی است")
    rl = get_rate_limiter()
    if not await rl.is_allowed(f"register:{ip or 'unknown'}", limit=10, window_s=3600, auth=True):
        raise APIError(429, "rate_limited", "تعداد درخواست بیش از حد مجاز است")

    if data.email and await _get_user_by_identifier(db, data.email):
        raise APIError(409, "email_taken", "این ایمیل قبلاً ثبت شده است")
    if data.phone and await _get_user_by_identifier(db, data.phone):
        raise APIError(409, "phone_taken", "این شماره قبلاً ثبت شده است")

    user = User(
        full_name=data.full_name.strip(),
        email=data.email,
        phone=data.phone,
        password_hash=hash_password(data.password),
        locale=data.locale,
    )
    db.add(user)
    await db.flush()

    # رضایت صریح — GDPR از روز اول (فاز ۱).
    # نسخهٔ متن حقوقی همان LEGAL_TEXT_VERSION است که صفحه‌های terms/privacy
    # در CMS با آن seed می‌شوند — تا ثابت شود کاربر کدام نسخه را پذیرفته است.
    for consent_type in ("terms", "privacy"):
        db.add(
            UserConsent(
                user_id=user.id,
                consent_type=consent_type,
                text_version=LEGAL_TEXT_VERSION,
                accepted_at=_utcnow(),
                ip=ip,
            )
        )

    # ترجیحات اعلان پیش‌فرض — فاز ۱۳: web_push کانال مجزا از push (FCM) است
    for channel in ("email", "sms", "push", "web_push", "in_app"):
        for notif_type in ("security", "product", "marketing"):
            enabled = not (
                channel in ("sms", "push", "web_push") and notif_type == "marketing"
            )
            db.add(
                NotificationPreference(
                    user_id=user.id, channel=channel, notif_type=notif_type, enabled=enabled
                )
            )

    # توکن تأیید ایمیل
    if user.email:
        token = pysecrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(token),
                purpose="email_verify",
                expires_at=_utcnow() + timedelta(hours=EMAIL_VERIFY_EXPIRE_HOURS),
            )
        )
        await email_mod.send_email(
            user.email,
            "تأیید ایمیل — آکادمی ماتریدی",
            "برای تأیید ایمیل خود روی لینک زیر کلیک کنید:\n"
            + public_url(f"/verify-email?token={token}")
            + "\n"
            f"verify_token={token}",
        )

    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.registered",
        payload={"email": user.email, "phone_set": bool(user.phone), "locale": user.locale},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.register",
        entity_type="user",
        entity_id=str(user.id),
        new_values={"email": user.email, "locale": user.locale},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(user)
    return user


# ---------- login / session ----------

async def authenticate(db: AsyncSession, data: LoginIn, ip: str | None) -> User:
    rl = get_rate_limiter()
    if not await rl.is_allowed(f"login:{ip or 'unknown'}", limit=20, window_s=300, auth=True):
        raise APIError(429, "rate_limited", "تعداد تلاش بیش از حد مجاز؛ دقایقی صبر کنید")
    user = await _get_user_by_identifier(db, data.identifier)
    if not user or not user.is_active or not verify_password(user.password_hash, data.password):
        raise APIError(401, "invalid_credentials", "ایمیل/شماره یا رمز عبور نادرست است")
    if user.totp_secret:
        secret = decrypt_value(json.loads(user.totp_secret))
        step = verify_totp_step(secret, data.totp_code or "")
        if step is None:
            raise APIError(
                401,
                "requires_2fa",
                "کد تأیید دوعاملی لازم است",
                {"requires_2fa": True},
            )
        # ضد replay (§۵): همین کد در همین پنجرهٔ زمانی دوباره پذیرفته نیست
        await _claim_totp_step(db, user, step)
    await rl.reset(f"login:{ip or 'unknown'}")
    return user


async def create_session_pair(
    db: AsyncSession, user: User, device_info: str | None, ip: str | None
) -> tuple[str, str]:
    session = Session(
        user_id=user.id, device_info=device_info, ip=ip, last_active_at=_utcnow()
    )
    db.add(session)
    await db.flush()
    plain = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            session_id=session.id,
            token_hash=hash_token(plain),
            expires_at=_utcnow() + timedelta(days=REFRESH_EXPIRE_DAYS),
        )
    )
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.logged_in",
        payload={"session_id": str(session.id)},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.login",
        entity_type="session",
        entity_id=str(session.id),
        new_values={"ip": ip},
        ip=ip,
        user_agent=device_info,
    )
    await db.commit()
    # اجرای سمت-سرور الزام TOTP برای نقش‌های ممتاز (قرارداد فاز ۰ §۲):
    # ادمین/super_admin بدون TOTP فقط توکن عامل-اول (2fa_setup) می‌گیرد که
    # هیچ endpoint نیازمند مجوز را باز نمی‌کند — تا وقتی 2FA را ثبت‌نام کند.
    scope = SCOPE_2FA_SETUP if await must_enroll_2fa(db, user) else SCOPE_FULL
    # sid در access token می‌نشیند تا get_current_user بتواند ابطال نشست را
    # بی‌درنگ اعمال کند (الگوی turbo — وگرنه توکن تا ۱۵ دقیقه زنده می‌ماند).
    return (
        create_access_token(str(user.id), extra={"sid": str(session.id)}, scope=scope),
        plain,
    )


async def _handle_token_reuse(db: AsyncSession, row: RefreshToken) -> None:
    """پاسخ سخت‌گیرانه به ارائهٔ توکن باطل‌شده (B-02 — ADR-0024).

    همیشه با APIError(401) خاتمه می‌یابد: کل نشست (و برای توکن‌های
    بی‌نشست قدیمی، همهٔ نشست‌ها/توکن‌های کاربر) باطل می‌شود، رویداد
    `token.reuse_detected` در outbox و audit log ثبت و commit می‌شود —
    بدون هیچ پنجرهٔ اغماض زمانی.
    """
    if row.session_id is not None:
        await _revoke_session(db, row.session_id)
    else:
        await _revoke_user_tokens(db, row.user_id)
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(row.user_id),
        event_type="token.reuse_detected",
        payload={"session_id": str(row.session_id) if row.session_id else None},
    )
    await log_audit(
        db,
        actor_id=row.user_id,
        actor_type="user",
        action="token.reuse_detected",
        entity_type="refresh_token",
        entity_id=str(row.id),
        new_values={"session_revoked": True},
    )
    await db.commit()
    raise APIError(401, "invalid_token", "رفرش‌توکن نامعتبر یا منقضی است")


async def _rotate_token(db: AsyncSession, row: RefreshToken) -> tuple[str, str]:
    """چرخش استاندارد: توکن فعلی باطل، توکن جدید صادر می‌شود (فاز ۰ §۲).

    ادعای اتمیک (§۹): `UPDATE ... WHERE revoked=FALSE` تضمین می‌کند در
    رفرشِ هم‌زمان فقط یک رشته برنده شود. بازنده یعنی همان توکن برای
    بار دوم ارائه شده است — طبق B-02/ADR-0024 بدون اغماض «استفادهٔ
    مجدد» است و کل نشست باطل می‌شود؛ کلاینت‌های مشروع با قفل رفرش
    سمت کلاینت (single-flight + Web Locks بین تب‌ها) هرگز توکنی را
    دوبار ارائه نمی‌کنند.

    دامنهٔ access token هم‌زمان با وضعیت TOTP کاربر تعیین می‌شود تا
    ارتقای غیرمجاز از توکن محدود به کامل ممکن نباشد.
    """
    user = await db.get(User, row.user_id)
    if not user or not user.is_active:
        raise APIError(401, "invalid_token", "رفرش‌توکن نامعتبر است")

    # دروازهٔ اتمیک: فقط اگر هنوز باطل نشده بود علامت بزن. دو رفرش
    # هم‌زمان روی یک سطر → فقط یکی rowcount=1 می‌گیرد؛ دومی reuse است.
    claim = cast(
        CursorResult[Any],
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.id == row.id, RefreshToken.revoked.is_(False))
            .values(revoked=True)
        ),
    )
    if claim.rowcount != 1:
        await _handle_token_reuse(db, row)
    row.revoked = True  # همگام‌سازی شیء ORM با UPDATE مشروط بالا

    new_plain = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            session_id=row.session_id,
            token_hash=hash_token(new_plain),
            rotated_from=row.id,
            expires_at=_utcnow() + timedelta(days=REFRESH_EXPIRE_DAYS),
        )
    )
    if row.session_id:
        await db.execute(
            update(Session)
            .where(Session.id == row.session_id)
            .values(last_active_at=_utcnow())
        )
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="token.refreshed",
        payload={"rotated_from": str(row.id)},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="token.refresh",
        entity_type="refresh_token",
        entity_id=str(row.id),
    )
    await db.commit()
    scope = SCOPE_2FA_SETUP if await must_enroll_2fa(db, user) else SCOPE_FULL
    extra = {"sid": str(row.session_id)} if row.session_id else None
    return create_access_token(str(user.id), extra=extra, scope=scope), new_plain


async def refresh_pair(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
    row = (
        await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token))
        )
    ).scalar_one_or_none()
    if not row or ensure_aware(row.expires_at) < _utcnow():
        raise APIError(401, "invalid_token", "رفرش‌توکن نامعتبر یا منقضی است")

    if row.revoked:
        # تشخیص استفادهٔ مجدد — سخت‌گیرانه و بدون پنجرهٔ اغماض
        # (B-02 — ADR-0024): هر ارائهٔ توکن باطل‌شده سرقت تلقی می‌شود.
        await _handle_token_reuse(db, row)

    return await _rotate_token(db, row)


async def logout(db: AsyncSession, user: User, refresh_token: str) -> None:
    token = (
        await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token))
        )
    ).scalar_one_or_none()
    if token and token.user_id == user.id:
        token.revoked = True
        # خروج از یک دستگاه = پایان همان نشست؛ access token هم بی‌درنگ می‌میرد
        # (الگوی turbo — وگرنه تا ۱۵ دقیقه زنده می‌ماند).
        if token.session_id:
            await _revoke_session(db, token.session_id)
        await emit_event(
            db,
            aggregate_type="user",
            aggregate_id=str(user.id),
            event_type="user.logged_out",
            payload={"token_id": str(token.id)},
        )
        await log_audit(
            db,
            actor_id=user.id,
            actor_type="user",
            action="user.logout",
            entity_type="refresh_token",
            entity_id=str(token.id),
        )
    await db.commit()


async def logout_all(db: AsyncSession, user: User) -> None:
    await _revoke_user_tokens(db, user.id)
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.logged_out_all",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.logout_all",
        entity_type="user",
        entity_id=str(user.id),
    )
    await db.commit()


# ---------- verify email / phone ----------

async def verify_email(db: AsyncSession, token: str) -> User:
    row = (
        await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == hash_token(token),
                PasswordResetToken.purpose == "email_verify",
                PasswordResetToken.used.is_(False),
            )
        )
    ).scalar_one_or_none()
    if not row or ensure_aware(row.expires_at) < _utcnow():
        raise APIError(400, "invalid_token", "توکن تأیید نامعتبر یا منقضی است")
    user = await db.get(User, row.user_id)
    if not user:
        raise APIError(400, "invalid_token", "توکن تأیید نامعتبر است")
    # مصرف اتمیک در سطح DB (§۹) — نه «بخوان بعد علامت بزن» در پایتون
    await _consume_single_use_token(
        db,
        PasswordResetToken,
        row.id,
        error=APIError(400, "invalid_token", "توکن تأیید نامعتبر یا منقضی است"),
    )
    user.is_verified = True
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.email_verified",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.verify_email",
        entity_type="user",
        entity_id=str(user.id),
    )
    await db.commit()
    await db.refresh(user)
    return user


async def request_phone_code(
    db: AsyncSession, user: User, data: PhoneCodeRequestIn
) -> None:
    rl = get_rate_limiter()
    if not await rl.is_allowed(f"sms:{user.id}", limit=5, window_s=3600, auth=True):
        raise APIError(429, "rate_limited", "تعداد درخواست کد بیش از حد مجاز است")
    code = f"{pysecrets.randbelow(900000) + 100000:06d}"
    db.add(
        PhoneVerificationCode(
            user_id=user.id,
            phone=data.phone,
            code_hash=hash_token(code),
            expires_at=_utcnow() + timedelta(minutes=PHONE_CODE_EXPIRE_MINUTES),
        )
    )
    await db.commit()
    await sms_mod.send_sms(data.phone, f"کد تأیید آکادمی ماتریدی: {code}")


async def verify_phone_code(db: AsyncSession, user: User, data: PhoneVerifyIn) -> None:
    row = (
        await db.execute(
            select(PhoneVerificationCode)
            .where(
                PhoneVerificationCode.user_id == user.id,
                PhoneVerificationCode.phone == data.phone,
                PhoneVerificationCode.used.is_(False),
            )
            .order_by(PhoneVerificationCode.created_at.desc())
        )
    ).scalars().first()
    if (
        not row
        or ensure_aware(row.expires_at) < _utcnow()
        or not hmac.compare_digest(row.code_hash, hash_token(data.code))
    ):
        raise APIError(400, "invalid_code", "کد تأیید نامعتبر یا منقضی است")
    # مصرف اتمیک در سطح DB (§۹)
    await _consume_single_use_token(
        db,
        PhoneVerificationCode,
        row.id,
        error=APIError(400, "invalid_code", "کد تأیید نامعتبر یا منقضی است"),
    )
    user.phone = data.phone
    user.is_verified = True
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.phone_verified",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.verify_phone",
        entity_type="user",
        entity_id=str(user.id),
    )
    await db.commit()


# ---------- password reset ----------

async def request_password_reset(
    db: AsyncSession, email: str, ip: str | None
) -> None:
    # همیشه 200 — جلوگیری از شمارش ایمیل‌های ثبت‌شده (anti-enumeration).
    # ضد اسپم (§۸): سقف جدا برای IP و برای ایمیلِ نرمالیزه‌شده.
    rl = get_rate_limiter()
    normalized = (email or "").strip().lower()
    if not await rl.is_allowed(
        f"pwreset:ip:{ip or 'unknown'}", limit=10, window_s=3600, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد درخواست بیش از حد مجاز است")
    if normalized and not await rl.is_allowed(
        f"pwreset:email:{normalized}", limit=3, window_s=3600, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد درخواست بیش از حد مجاز است")
    user = await _get_user_by_identifier(db, email)
    if user and user.email:
        token = pysecrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(token),
                purpose="reset",
                expires_at=_utcnow() + timedelta(hours=RESET_TOKEN_EXPIRE_HOURS),
            )
        )
        await db.commit()
        await email_mod.send_email(
            user.email,
            "بازیابی رمز عبور — آکادمی ماتریدی",
            "برای تعیین رمز جدید:\n"
            + public_url(f"/reset-password?token={token}")
            + "\n"
            f"reset_token={token}\n"
            "این لینک یک ساعت اعتبار دارد.",
        )


async def confirm_password_reset(db: AsyncSession, token: str, new_password: str) -> None:
    row = (
        await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == hash_token(token),
                PasswordResetToken.purpose == "reset",
                PasswordResetToken.used.is_(False),
            )
        )
    ).scalar_one_or_none()
    if not row or ensure_aware(row.expires_at) < _utcnow():
        raise APIError(400, "invalid_token", "توکن بازیابی نامعتبر یا منقضی است")
    user = await db.get(User, row.user_id)
    if not user or not user.is_active:
        raise APIError(400, "invalid_token", "توکن بازیابی نامعتبر است")
    # مصرف اتمیک در سطح DB (§۹) — استفادهٔ هم‌زمان دو بار ممکن نیست
    await _consume_single_use_token(
        db,
        PasswordResetToken,
        row.id,
        error=APIError(400, "invalid_token", "توکن بازیابی نامعتبر یا منقضی است"),
    )
    user.password_hash = hash_password(new_password)
    # بعد از تغییر رمز، همهٔ نشست‌ها باطل می‌شوند (امنیتی)
    await _revoke_user_tokens(db, user.id)
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.password_reset",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.password_reset",
        entity_type="user",
        entity_id=str(user.id),
        new_values={"password": {"changed": True}},
    )
    await db.commit()


# ---------- 2FA (TOTP) ----------

async def setup_2fa(db: AsyncSession, user: User) -> tuple[str, str]:
    """سکرت و URI را برمی‌گرداند ولی هنوز ذخیره نمی‌کند — ذخیره بعد از تأیید کد."""
    secret = generate_totp_secret()
    account = user.email or user.phone or str(user.id)
    return secret, totp_provisioning_uri(secret, account)


async def enable_2fa(
    db: AsyncSession, user: User, data: TwoFAEnableIn, ip: str | None
) -> list[str]:
    rl = get_rate_limiter()
    if not await rl.is_allowed(
        f"2fa:enable:{user.id}", limit=20, window_s=600, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد تلاش بیش از حد مجاز است")
    step = verify_totp_step(data.secret, data.code)
    if step is None:
        raise APIError(400, "invalid_code", "کد تأیید دوعاملی نادرست است")
    # ضد replay (§۵): همین کد در همین پنجره دوباره پذیرفته نیست
    await _claim_totp_step(db, user, step, error_status=400)
    user.totp_secret = json.dumps(encrypt_value(data.secret))
    user.totp_enabled_at = _utcnow()
    # فعال‌سازی مجدد (مثلاً تعویض گوشی): مجموعهٔ قبلی کدهای بازیابی در همان
    # تراکنش باطل می‌شود تا کدهای قدیمی کنار مجموعهٔ تازه معتبر نمانند.
    await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = generate_recovery_codes()
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=hash_token(code)))
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.2fa_enabled",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.2fa_enable",
        entity_type="user",
        entity_id=str(user.id),
        ip=ip,
    )
    await db.commit()
    return codes


async def recover_2fa(db: AsyncSession, data: TwoFARecoverIn, ip: str | None) -> None:
    rl = get_rate_limiter()
    if not await rl.is_allowed(
        f"2fa:recover:{ip or 'unknown'}", limit=10, window_s=3600, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد تلاش بیش از حد مجاز است")
    user = await _get_user_by_identifier(db, data.email)
    if not user or not user.is_active or not verify_password(user.password_hash, data.password):
        raise APIError(401, "invalid_credentials", "ایمیل یا رمز عبور نادرست است")
    if not user.totp_secret:
        raise APIError(400, "no_2fa", "احراز دوعاملی برای این حساب فعال نیست")
    wanted = hash_token(data.recovery_code.strip().upper())
    row = (
        await db.execute(
            select(RecoveryCode).where(
                RecoveryCode.user_id == user.id, RecoveryCode.used.is_(False)
            )
        )
    ).scalars().all()
    match = next(
        (r for r in row if hmac.compare_digest(r.code_hash, wanted)), None
    )
    if not match:
        raise APIError(400, "invalid_code", "کد بازیابی نامعتبر است")
    # مصرف اتمیک کد بازیابی در سطح DB (§۹) — دو درخواست هم‌زمان با یک کد،
    # فقط یکی موفق می‌شود
    await _consume_single_use_token(
        db,
        RecoveryCode,
        match.id,
        error=APIError(400, "invalid_code", "کد بازیابی نامعتبر است"),
    )
    user.totp_secret = None
    user.totp_last_step = None
    user.totp_enabled_at = None
    # غیرفعال شدن 2FA رویداد امنیتی حساس است (§۵/§۹): همهٔ نشست‌ها
    # و رفرش‌توکن‌ها باطل می‌شوند تا توکن‌های صادرشدهٔ قبلی — که با
    # وضعیت TOTP قدیمی ساخته شده‌اند — بی‌اعتبار شوند.
    await _revoke_user_tokens(db, user.id)
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.2fa_recovered",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.2fa_recover",
        entity_type="user",
        entity_id=str(user.id),
        ip=ip,
    )
    await db.commit()


# ---------- چرخهٔ حیات 2FA (فاز ۲ — F-02: status / disable / regenerate) ----------


async def get_2fa_status(db: AsyncSession, user: User) -> dict[str, Any]:
    """وضعیت فعلی 2FA کاربر: فعال بودن، زمان فعال‌سازی، کدهای باقی‌مانده."""
    remaining = (
        await db.execute(
            select(func.count())
            .select_from(RecoveryCode)
            .where(RecoveryCode.user_id == user.id, RecoveryCode.used.is_(False))
        )
    ).scalar_one()
    return {
        "enabled": user.totp_secret is not None,
        "enrolled_at": user.totp_enabled_at,
        "recovery_codes_remaining": int(remaining),
    }


async def _verify_second_factor(
    db: AsyncSession,
    user: User,
    *,
    password: str,
    code: str | None,
    recovery_code: str | None,
) -> str:
    """احراز مجدد برای عملیات حساس 2FA: رمز عبور فعلی + عامل دوم.

    عامل دوم یا کد TOTP فعلی است (با ضد replay اتمیکِ `_claim_totp_step`)
    یا یک کد بازیابیِ مصرف‌نشده (مصرف اتمیکِ تک‌بار در همان تراکنش).
    برمی‌گرداند: "totp" یا "recovery" (فقط برای audit — هرگز خود کد/سکرت).
    """
    if not verify_password(user.password_hash, password):
        raise APIError(401, "invalid_credentials", "رمز عبور نادرست است")
    if not user.totp_secret:
        raise APIError(400, "no_2fa", "احراز دوعاملی برای این حساب فعال نیست")
    if code:
        secret = decrypt_value(json.loads(user.totp_secret))
        step = verify_totp_step(secret, code)
        if step is None:
            raise APIError(400, "invalid_code", "کد تأیید دوعاملی نادرست است")
        # ضد replay (§۵): همین کد در همین پنجره دوباره پذیرفته نیست
        await _claim_totp_step(db, user, step, error_status=400)
        return "totp"
    if recovery_code:
        wanted = hash_token(recovery_code.strip().upper())
        rows = (
            await db.execute(
                select(RecoveryCode).where(
                    RecoveryCode.user_id == user.id, RecoveryCode.used.is_(False)
                )
            )
        ).scalars().all()
        match = next(
            (r for r in rows if hmac.compare_digest(r.code_hash, wanted)), None
        )
        if not match:
            raise APIError(400, "invalid_code", "کد بازیابی نامعتبر است")
        # مصرف اتمیک در سطح DB (§۹) — replay همان کد در درخواست دوم رد می‌شود
        await _consume_single_use_token(
            db,
            RecoveryCode,
            match.id,
            error=APIError(400, "invalid_code", "کد بازیابی نامعتبر است"),
        )
        return "recovery"
    raise APIError(
        400, "second_factor_required", "کد تأیید دوعاملی یا کد بازیابی لازم است"
    )


async def _revoke_other_sessions(
    db: AsyncSession, user_id: uuid.UUID, keep_session_id: uuid.UUID | None
) -> None:
    """ابطال همهٔ نشست‌ها/رفرش‌توکن‌های کاربر به‌جز نشست جاری (فاز ۲).

    رفرش‌توکن‌های بدون نشست (session_id=NULL) هم باطل می‌شوند — نمی‌توان
    ثابت کرد متعلق به نشست جاری‌اند. بدون commit صریح.
    """
    session_stmt = update(Session).where(
        Session.user_id == user_id, Session.revoked.is_(False)
    )
    token_stmt = update(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)
    )
    if keep_session_id is not None:
        session_stmt = session_stmt.where(Session.id != keep_session_id)
        token_stmt = token_stmt.where(
            or_(
                RefreshToken.session_id.is_(None),
                RefreshToken.session_id != keep_session_id,
            )
        )
    await db.execute(session_stmt.values(revoked=True))
    await db.execute(token_stmt.values(revoked=True))


async def disable_2fa(
    db: AsyncSession,
    user: User,
    data: TwoFAReauthIn,
    ip: str | None,
    current_session_id: uuid.UUID | None,
) -> None:
    """غیرفعال‌سازی احرازشدهٔ 2FA (فاز ۲ — F-02).

    نیازمند احراز مجدد کامل (رمز عبور + TOTP یا کد بازیابی). سکرت و همهٔ
    کدهای بازیابی پاک می‌شوند و نشست‌های دیگر باطل می‌شوند تا توکن‌هایی
    که با وضعیت TOTP قبلی صادر شده‌اند زنده نمانند.
    """
    rl = get_rate_limiter()
    if not await rl.is_allowed(
        f"2fa:disable:{user.id}", limit=10, window_s=600, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد تلاش بیش از حد مجاز است")
    method = await _verify_second_factor(
        db,
        user,
        password=data.password,
        code=data.code,
        recovery_code=data.recovery_code,
    )
    user.totp_secret = None
    user.totp_last_step = None
    user.totp_enabled_at = None
    await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    await _revoke_other_sessions(db, user.id, current_session_id)
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.2fa_disabled",
        payload={"method": method},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.2fa_disable",
        entity_type="user",
        entity_id=str(user.id),
        new_values={"method": method},
        ip=ip,
    )
    await db.commit()


async def regenerate_recovery_codes(
    db: AsyncSession, user: User, data: TwoFAReauthIn, ip: str | None
) -> list[str]:
    """صدور مجدد کدهای بازیابی با احراز مجدد (فاز ۲ — F-02).

    مجموعهٔ قبلی در همان تراکنش حذف و مجموعهٔ تازه درج می‌شود؛ از لحظهٔ
    commit، کدهای قدیمی بی‌اعتبارند (جایگزینی اتمیک). کدها فقط هش‌شده
    ذخیره می‌شوند؛ متن ساده فقط همین یک بار در پاسخ برمی‌گردد.
    """
    rl = get_rate_limiter()
    if not await rl.is_allowed(
        f"2fa:regenerate:{user.id}", limit=10, window_s=600, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد تلاش بیش از حد مجاز است")
    method = await _verify_second_factor(
        db,
        user,
        password=data.password,
        code=data.code,
        recovery_code=data.recovery_code,
    )
    await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = generate_recovery_codes()
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=hash_token(code)))
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.2fa_recovery_regenerated",
        payload={"method": method},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.2fa_recovery_regenerate",
        entity_type="user",
        entity_id=str(user.id),
        new_values={"method": method, "count": len(codes)},
        ip=ip,
    )
    await db.commit()
    return codes


# ---------- بلیط یک‌بارمصرف WebSocket (hardening/audit-pass-1) ----------

async def issue_ws_ticket(
    db: AsyncSession, user: User, session_id: uuid.UUID | None = None
) -> tuple[str, int]:
    """صدور بلیط ۶۰ ثانیه‌ای و یک‌بارمصرف برای handshake وب‌سوکت.

    فقط هش بلیط در DB می‌ماند. بلیط جای JWT بلندمدت در query string
    می‌نشیند تا توکن در لاگ‌ها/تاریخچهٔ مرورگر لو نرود.

    بلیط به نشست صادرکننده گره می‌خورد (remediation-pass-2 Track 1):
    اگر نشست پیش از مصرف بلیط باطل شود، بلیط هم مرده است.
    """
    ticket = pysecrets.token_urlsafe(32)
    db.add(
        WsTicket(
            user_id=user.id,
            session_id=session_id,
            ticket_hash=hash_token(ticket),
            expires_at=_utcnow() + timedelta(seconds=WS_TICKET_EXPIRE_SECONDS),
        )
    )
    await db.commit()
    return ticket, WS_TICKET_EXPIRE_SECONDS


async def redeem_ws_ticket(db: AsyncSession, ticket: str) -> User | None:
    """مصرف اتمیک بلیط — یک‌بارمصرف بودن با UPDATE مشروط تضمین می‌شود.

    None یعنی بلیط نامعتبر، منقضی، قبلاً مصرف‌شده، نشستِ گره‌خورده باطل،
    یا کاربر غیرفعال — در همهٔ این حالت‌ها handshake رد می‌شود.
    """
    row = (
        await db.execute(
            select(WsTicket).where(WsTicket.ticket_hash == hash_token(ticket))
        )
    ).scalar_one_or_none()
    if row is None or row.used_at is not None:
        return None
    if ensure_aware(row.expires_at) <= _utcnow():
        return None
    # گره‌خوردن به نشست: ابطال نشست، بلیطِ هنوزمصرف‌نشده را هم می‌میراند
    if row.session_id is not None:
        session = await db.get(Session, row.session_id)
        if (
            session is None
            or session.revoked
            or session.user_id != row.user_id
        ):
            return None
    # دروازهٔ اتمیک تک‌مصرفی: فقط اگر هنوز مصرف نشده بود علامت بزن
    res = cast(
        CursorResult[Any],
        await db.execute(
            update(WsTicket)
            .where(WsTicket.id == row.id, WsTicket.used_at.is_(None))
            .values(used_at=_utcnow())
        ),
    )
    await db.commit()
    if res.rowcount != 1:
        return None
    user = await db.get(User, row.user_id)
    if not user or not user.is_active:
        return None
    return user
