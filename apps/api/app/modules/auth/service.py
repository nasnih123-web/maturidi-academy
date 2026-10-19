"""لایهٔ سرویس احراز هویت — تنها جایی که منطق auth زندگی می‌کند (فاز ۰ §۱۵، قانون ۶).

روتر هرگز مستقیم به دیتابیس دسترسی ندارد؛ همهٔ نوشتن‌های حساس امنیتی هم
domain_event (outbox) و هم audit log تولید می‌کنند.
"""
from __future__ import annotations

import hmac
import json
import secrets as pysecrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_mod
from app.core import sms as sms_mod
from app.core.audit import log_audit
from app.core.database import ensure_aware
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.secrets import decrypt_value, encrypt_value
from app.core.security import (
    create_access_token,
    generate_recovery_codes,
    generate_refresh_token,
    generate_totp_secret,
    hash_password,
    hash_token,
    rate_limiter,
    totp_provisioning_uri,
    verify_password,
    verify_totp,
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
)
from app.modules.auth.schemas import (
    LoginIn,
    PhoneCodeRequestIn,
    PhoneVerifyIn,
    RegisterIn,
    TwoFAEnableIn,
    TwoFARecoverIn,
)
from app.modules.content.legal import LEGAL_TEXT_VERSION

REFRESH_EXPIRE_DAYS = 30
EMAIL_VERIFY_EXPIRE_HOURS = 24
PHONE_CODE_EXPIRE_MINUTES = 5
RESET_TOKEN_EXPIRE_HOURS = 1


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    if not data.accept_terms:
        raise APIError(422, "terms_required", "پذیرش قوانین و حریم‌خصوصی الزامی است")
    if not data.email and not data.phone:
        raise APIError(422, "contact_required", "ایمیل یا شماره تلفن الزامی است")
    if not rate_limiter.is_allowed(f"register:{ip}", limit=10, window_s=3600):
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
            f"https://example.com/verify-email?token={token}\n"
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
    if not rate_limiter.is_allowed(f"login:{ip}", limit=20, window_s=300):
        raise APIError(429, "rate_limited", "تعداد تلاش بیش از حد مجاز؛ دقایقی صبر کنید")
    user = await _get_user_by_identifier(db, data.identifier)
    if not user or not user.is_active or not verify_password(user.password_hash, data.password):
        raise APIError(401, "invalid_credentials", "ایمیل/شماره یا رمز عبور نادرست است")
    if user.totp_secret:
        secret = decrypt_value(json.loads(user.totp_secret))
        if not data.totp_code or not verify_totp(secret, data.totp_code):
            raise APIError(
                401,
                "requires_2fa",
                "کد تأیید دوعاملی لازم است",
                {"requires_2fa": True},
            )
    rate_limiter.reset(f"login:{ip}")
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
    # sid در access token می‌نشیند تا get_current_user بتواند ابطال نشست را
    # بی‌درنگ اعمال کند (الگوی turbo — وگرنه توکن تا ۱۵ دقیقه زنده می‌ماند).
    return create_access_token(str(user.id), extra={"sid": str(session.id)}), plain


async def refresh_pair(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
    row = (
        await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token))
        )
    ).scalar_one_or_none()
    if not row or ensure_aware(row.expires_at) < _utcnow():
        raise APIError(401, "invalid_token", "رفرش‌توکن نامعتبر یا منقضی است")

    if row.revoked:
        # تشخیص استفادهٔ مجدد (reuse detection — الگوی turbo):
        # اگر این توکن با rotation جایگزین شده (جانشین دارد) و دوباره ارائه شود،
        # یعنی توکن دزدیده شده؛ کل نشست باطل می‌شود. کد خطا همان invalid_token
        # می‌ماند تا قرارداد API نشکند.
        successor = (
            await db.execute(
                select(RefreshToken.id)
                .where(RefreshToken.rotated_from == row.id)
                .limit(1)
            )
        ).first()
        if successor is not None and row.session_id is not None:
            await _revoke_session(db, row.session_id)
            await emit_event(
                db,
                aggregate_type="user",
                aggregate_id=str(row.user_id),
                event_type="token.reuse_detected",
                payload={"session_id": str(row.session_id)},
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

    user = await db.get(User, row.user_id)
    if not user or not user.is_active:
        raise APIError(401, "invalid_token", "رفرش‌توکن نامعتبر است")

    # rotation: توکن قبلی باطل، توکن جدید صادر می‌شود (فاز ۰ §۲)
    row.revoked = True
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
    extra = {"sid": str(row.session_id)} if row.session_id else None
    return create_access_token(str(user.id), extra=extra), new_plain


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
    row.used = True
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
    if not rate_limiter.is_allowed(f"sms:{user.id}", limit=5, window_s=3600):
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
    row.used = True
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

async def request_password_reset(db: AsyncSession, email: str) -> None:
    # همیشه 200 — جلوگیری از شمارش ایمیل‌های ثبت‌شده
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
            f"https://example.com/reset-password?token={token}\n"
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
    row.used = True
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
    if not verify_totp(data.secret, data.code):
        raise APIError(400, "invalid_code", "کد تأیید دوعاملی نادرست است")
    user.totp_secret = json.dumps(encrypt_value(data.secret))
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
    match.used = True
    user.totp_secret = None
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
