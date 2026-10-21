"""وابستگی‌های احراز هویت و مجوز — فاز ۰ §۲.

نقش همیشه از user_roles خوانده می‌شود، هرگز از ستون role (که وجود ندارد).
access token به نشست (sid) گره خورده است: اگر نشست باطل شده باشد، توکن —
حتی پیش از انقضای ۱۵ دقیقه‌ای — مرده است (الگوی turbo).
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import ensure_aware, get_db
from app.core.errors import APIError
from app.core.security import SCOPE_FULL, decode_access_token
from app.models.models import Permission, RolePermission, Session, User, UserRole
from app.modules.auth.service import must_enroll_2fa

_bearer = HTTPBearer(auto_error=False)

_LAST_ACTIVE_TOUCH_SECONDS = 60

# تنها مسیرهایی که توکن عامل-اول (2fa_setup) حق صدازدنشان را دارد (فاز ۲):
# چرخهٔ ثبت‌نام 2FA + خروج. هر مسیر دیگری — از جمله endpointهای عادیِ
# get_current_user مثل /users/me — برای این دامنه 403 است؛ تا پیش از فاز ۲
# فقط require_permission/require_full_scope دامنه را چک می‌کردند و مسیرهای
# ساده (پروفایل، export، حذف حساب، نشست‌ها…) با توکن محدود باز بودند.
_2FA_SETUP_ALLOWED_PATHS = frozenset(
    {
        "/api/v1/auth/2fa/setup",
        "/api/v1/auth/2fa/enable",
        "/api/v1/auth/2fa/status",
        "/api/v1/auth/logout",
    }
)


async def _reject_privileged_without_2fa(db: AsyncSession, user: User) -> None:
    """بازبینی لحظه‌ای الزام TOTP برای نقش‌های ممتاز (§۵، defense-in-depth).

    دامنهٔ توکن (`scope`) در لحظهٔ صدور تعیین می‌شود؛ اگر بعداً نقش کاربر
    ارتقا یابد (admin شود) یا TOTPش غیرفعال شود، توکنِ قدیمیِ `full` نباید
    همچنان درهای مدیریتی را باز کند. این چک در هر درخواستِ نیازمند مجوز،
    وضعیتِ فعلیِ کاربر را از DB می‌خواند — مستقل از scope توکن.
    """
    if await must_enroll_2fa(db, user):
        raise APIError(
            403,
            "requires_2fa",
            "برای این عملیات باید احراز دوعاملی کامل شده باشد",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
    # نکتهٔ FastAPI: پارامتر Request باید دقیقاً با همین annotation بیاید؛
    # شکل `Request | None` توسط FastAPI به‌عنوان Query-param عادی تلقی و
    # ساخت اپ با FastAPIError می‌شکند. دیفالت None فقط برای فراخوانی‌های
    # مستقیم (_optional_user در روترها) است؛ در مسیر Depends همیشه request واقعی تزریق می‌شود.
    request: Request = None,  # type: ignore[assignment]
) -> User:
    if not credentials:
        raise APIError(401, "unauthorized", "توکن احراز هویت ارسال نشده است")
    payload = decode_access_token(credentials.credentials)
    scope = payload.get("scope", SCOPE_FULL)
    # دامنهٔ توکن برای تصمیم‌های پایین‌دستی (require_permission) نگه داشته می‌شود
    if request is not None:
        request.state.token_scope = scope
    if scope != SCOPE_FULL:
        # توکن عامل-اول فقط برای تکمیل ثبت‌نام 2FA صادر می‌شود (فاز ۲):
        # خارج از فهرست سفیدِ چرخهٔ 2FA هیچ مسیری باز نیست. فراخوانی‌های
        # مستقیم بدون request (کمکی‌های optional-auth روترهای عمومی) هم
        # رد می‌شوند و آن‌ها APIError را به «کاربر ناشناس» ترجمه می‌کنند.
        path = request.url.path if request is not None else ""
        if path not in _2FA_SETUP_ALLOWED_PATHS:
            raise APIError(
                403,
                "requires_2fa",
                "برای این عملیات باید احراز دوعاملی کامل شده باشد",
            )
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise APIError(401, "invalid_token", "توکن نامعتبر است")

    sid = payload.get("sid")
    if sid:
        try:
            session_id = uuid.UUID(sid)
        except ValueError:
            raise APIError(401, "invalid_token", "توکن نامعتبر است")
        session = await db.get(Session, session_id)
        if session is None or session.revoked:
            raise APIError(401, "session_revoked", "نشست پایان یافته است")
        # نشست برای مصرف‌کننده‌های پایین‌دستی (مثل صدور بلیط WS) نگه داشته می‌شود
        if request is not None:
            request.state.session_id = session_id
        # لمس throttled آخرین فعالیت — بدون commit صریح در dependency
        # (برخلاف turbo که در dep کامیت می‌کند؛ نوشتن با تراکنش درخواست می‌ماند).
        now = datetime.now(UTC)
        if (now - ensure_aware(session.last_active_at)).total_seconds() > _LAST_ACTIVE_TOUCH_SECONDS:
            session.last_active_at = now

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise APIError(401, "unauthorized", "کاربر یافت نشد یا غیرفعال است")
    return user


def require_full_scope():
    """توکن عامل-اول (2fa_setup) را رد می‌کند — برای endpointهایی که
    احراز هویتِ کامل (شامل 2FA نقش‌های ممتاز) لازم دارند ولی مجوز
    خاصی چک نمی‌کنند (مثل صدور بلیط وب‌سوکت)."""

    async def _check_scope(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
        request: Request = None,  # type: ignore[assignment]  # FastAPI تزریق می‌کند
    ) -> User:
        scope = (
            getattr(request.state, "token_scope", SCOPE_FULL)
            if request is not None
            else SCOPE_FULL
        )
        if scope != SCOPE_FULL:
            raise APIError(
                403,
                "requires_2fa",
                "برای این عملیات باید احراز دوعاملی کامل شده باشد",
            )
        # بازبینی لحظه‌ای: ارتقای نقش/غیرفعال‌سازی TOTP پس از صدور توکن (§۵)
        await _reject_privileged_without_2fa(db, user)
        return user

    return _check_scope


def require_permission(permission_key: str):
    """فکتوری dependency — بررسی مجوز واقعی از روی جدول‌ها، نه enum."""

    async def _check(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
        request: Request = None,  # type: ignore[assignment]  # FastAPI تزریق می‌کند
    ) -> User:
        # توکن عامل-اول (2fa_setup) هیچ دسترسی نیازمند مجوز ندارد —
        # اجرای سمت-سرور الزام TOTP برای نقش‌های ممتاز (قرارداد فاز ۰ §۲).
        scope = (
            getattr(request.state, "token_scope", SCOPE_FULL)
            if request is not None
            else SCOPE_FULL
        )
        if scope != SCOPE_FULL:
            raise APIError(
                403,
                "requires_2fa",
                "برای این عملیات باید احراز دوعاملی کامل شده باشد",
            )
        # بازبینی لحظه‌ای: ارتقای نقش/غیرفعال‌سازی TOTP پس از صدور توکن (§۵)
        await _reject_privileged_without_2fa(db, user)
        stmt = (
            select(Permission.id)
            .select_from(UserRole)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(UserRole.user_id == user.id, Permission.key == permission_key)
            .limit(1)
        )
        if not (await db.execute(stmt)).first():
            raise APIError(403, "forbidden", "دسترسی کافی نیست")
        return user

    return _check
