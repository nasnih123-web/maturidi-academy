"""داشبورد کاربران CRM — فاز C.

لیست تعاملی کاربران + آمار سربرگ برای پنل CRM (مجوز: `users.view360`).

منابع داده — همه از جدول‌های موجود، بدون migration:
- وضعیت ثبت‌نام: «در انتظار» ⇔ ردیف مصرف‌نشدهٔ `password_setup` در
  password_reset_tokens هست (همان نشانگر فاز A)؛ وگرنه «کامل‌شده».
- IP/مرورگر ثبت‌نام: ردیف audit با action='user.register' (در لحظهٔ
  ثبت‌نام با ip و user_agent واقعی ذخیره می‌شود — سرویس auth).
- آخرین فعالیت: تازه‌ترین ردیف sessions (ستون‌های ip و device_info؛
  device_info همان User-Agent خام هدر است — app/modules/auth/router).
- کشور: users.country_code؛ اگر خالی بود، کشور شمارهٔ تأییدشده از روی
  پیش‌شماره (verified_phone_country فاز B). منبع کشور هم برگردانده
  می‌شود تا CRM بداند مقدار «پروفایل» است یا «استخراج از شماره».
- شمارش‌ها: سوال فتوا = cluster_members، نشست حفظ = hifz_attempts،
  آزمون حفظ = hifz_tests، حمایت = donations (donor_id).
"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import ensure_aware
from app.core.user_agent import parse_user_agent
from app.models.models import (
    AuditLog,
    ClusterMember,
    Donation,
    HifzAttempt,
    HifzTest,
    PasswordResetToken,
    Session,
    User,
)
from app.modules.users.service import missing_profile_fields, verified_phone_country

# نام انگلیسی کشورها برای API — CRM نام فارسی را از جدول خودش می‌خواند.
COUNTRY_NAMES_EN: dict[str, str] = {
    "IR": "Iran", "AF": "Afghanistan", "IQ": "Iraq", "TR": "Türkiye",
    "AE": "United Arab Emirates", "SA": "Saudi Arabia", "QA": "Qatar",
    "KW": "Kuwait", "OM": "Oman", "BH": "Bahrain", "PK": "Pakistan",
    "IN": "India", "BD": "Bangladesh", "TJ": "Tajikistan",
    "UZ": "Uzbekistan", "TM": "Turkmenistan", "AZ": "Azerbaijan",
    "ID": "Indonesia", "MY": "Malaysia", "EG": "Egypt", "SY": "Syria",
    "LB": "Lebanon", "JO": "Jordan", "YE": "Yemen", "MA": "Morocco",
    "DZ": "Algeria", "TN": "Tunisia", "NG": "Nigeria",
    "GB": "United Kingdom", "DE": "Germany", "FR": "France",
    "NL": "Netherlands", "SE": "Sweden", "RU": "Russia", "CN": "China",
    "AU": "Australia", "CA": "Canada", "US": "United States",
}


def _iso(dt) -> str | None:
    return ensure_aware(dt).isoformat() if dt is not None else None


def pending_marker_exists():
    """عبارت EXISTS نشانگر «ثبت‌نام در انتظار تکمیل» (فاز A)."""
    return (
        select(PasswordResetToken.id)
        .where(
            PasswordResetToken.user_id == User.id,
            PasswordResetToken.purpose == "password_setup",
            PasswordResetToken.used.is_(False),
        )
        .exists()
    )


# معادل SQL تابع missing_profile_fields فاز B (نام غیرخالی + ۴ ستون غیرخالی).
PROFILE_COMPLETE_COND = and_(
    func.trim(User.full_name) != "",
    User.avatar_media_id.is_not(None),
    User.date_of_birth.is_not(None),
    User.gender.is_not(None),
    User.country_code.is_not(None),
)


def device_block(ip: str | None, user_agent: str | None, at=None) -> dict | None:
    """بلوک نمایش دستگاه: IP + UA خام + خلاصهٔ پارس‌شده. هر دو خالی → None."""
    if ip is None and not user_agent:
        return None
    parsed = parse_user_agent(user_agent)
    return {
        "ip": ip,
        "user_agent": user_agent,
        "browser": parsed["browser"],
        "os": parsed["os"],
        "device": parsed["device"],
        "summary": parsed["summary"],
        "at": _iso(at),
    }


def effective_country(user: User) -> tuple[str | None, str | None]:
    """(کد کشور، منبع) — پروفایل اول، بعد شمارهٔ تأییدشده."""
    if user.country_code:
        return user.country_code, "profile"
    phone_country = verified_phone_country(user)
    if phone_country:
        return phone_country, "phone"
    return None, None


async def _counts_by_user(db: AsyncSession, column, ids: list[uuid.UUID]) -> dict:
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(column, func.count()).where(column.in_(ids)).group_by(column)
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def _hydrate_rows(db: AsyncSession, users: list[User]) -> list[dict]:
    """غنی‌سازی یک صفحه از کاربران با کوئری‌های دسته‌ای (بدون N+1)."""
    ids = [u.id for u in users]
    if not ids:
        return []

    pending_ids = set(
        (
            await db.execute(
                select(PasswordResetToken.user_id)
                .where(
                    PasswordResetToken.user_id.in_(ids),
                    PasswordResetToken.purpose == "password_setup",
                    PasswordResetToken.used.is_(False),
                )
                .distinct()
            )
        ).scalars()
    )

    register_rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.actor_id.in_(ids), AuditLog.action == "user.register")
            .order_by(AuditLog.created_at.asc())
        )
    ).scalars().all()
    register_by_user: dict = {}
    for row in register_rows:
        register_by_user.setdefault(row.actor_id, row)

    session_rows = (
        await db.execute(
            select(Session)
            .where(Session.user_id.in_(ids))
            .order_by(Session.last_active_at.desc())
        )
    ).scalars().all()
    latest_session: dict = {}
    for sess in session_rows:
        latest_session.setdefault(sess.user_id, sess)

    fatwa_counts = await _counts_by_user(db, ClusterMember.user_id, ids)
    hifz_session_counts = await _counts_by_user(db, HifzAttempt.user_id, ids)
    hifz_test_counts = await _counts_by_user(db, HifzTest.user_id, ids)
    donation_counts = await _counts_by_user(db, Donation.donor_id, ids)

    out: list[dict] = []
    for user in users:
        country_code, country_source = effective_country(user)
        missing = missing_profile_fields(user)
        reg = register_by_user.get(user.id)
        last_sess = latest_session.get(user.id)
        out.append(
            {
                "id": str(user.id),
                "full_name": user.full_name,
                "email": user.email,
                "phone": user.phone,
                "locale": user.locale,
                "is_active": user.is_active,
                "is_verified": user.is_verified,
                "registration_status": (
                    "pending" if user.id in pending_ids else "completed"
                ),
                "profile_complete": not missing,
                "missing_profile_fields": missing,
                "country_code": country_code,
                "country_source": country_source,
                "country_name": COUNTRY_NAMES_EN.get(country_code or ""),
                "created_at": _iso(user.created_at),
                "registration": (
                    device_block(reg.ip, reg.user_agent, reg.created_at)
                    if reg is not None
                    else None
                ),
                "last_activity": (
                    device_block(
                        last_sess.ip, last_sess.device_info, last_sess.last_active_at
                    )
                    if last_sess is not None
                    else None
                ),
                "counts": {
                    "fatwa_questions": fatwa_counts.get(user.id, 0),
                    "hifz_sessions": hifz_session_counts.get(user.id, 0),
                    "hifz_tests": hifz_test_counts.get(user.id, 0),
                    "donations": donation_counts.get(user.id, 0),
                },
            }
        )
    return out


def _apply_filters(stmt, *, q, status, profile):
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                User.full_name.ilike(like),
                User.email.ilike(like),
                User.phone.ilike(like),
            )
        )
    if status == "pending":
        stmt = stmt.where(pending_marker_exists())
    elif status == "completed":
        stmt = stmt.where(not_(pending_marker_exists()))
    if profile == "complete":
        stmt = stmt.where(PROFILE_COMPLETE_COND)
    elif profile == "incomplete":
        stmt = stmt.where(not_(PROFILE_COMPLETE_COND))
    return stmt


def _order_clause(sort: str, order: str):
    if sort == "last_activity":
        key = (
            select(func.max(Session.last_active_at))
            .where(Session.user_id == User.id)
            .scalar_subquery()
        )
        return key.desc().nulls_last() if order == "desc" else key.asc().nulls_last()
    col = User.created_at
    return col.desc().nulls_last() if order == "desc" else col.asc().nulls_last()


async def list_dashboard_users(
    db: AsyncSession,
    *,
    q: str | None = None,
    status: str | None = None,
    profile: str | None = None,
    country: str | None = None,
    sort: str = "created_at",
    order: str = "desc",
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """صفحهٔ داشبورد: {items, total, limit, offset}.

    فیلتر کشور روی «کشور مؤثر» (پروفایل یا استخراج از شمارهٔ تأییدشده)
    اعمال می‌شود؛ استخراج از شماره منطق پایتونی دارد (تطبیق پیش‌شماره)،
    پس در این مسیر ترتیب SQL حفظ و برش در حافظه انجام می‌شود.
    """
    if country:
        id_stmt = _apply_filters(
            select(User.id, User.country_code, User.phone, User.is_verified),
            q=q, status=status, profile=profile,
        ).order_by(_order_clause(sort, order))
        candidates = (await db.execute(id_stmt)).all()
        matched_ids: list[uuid.UUID] = []
        for row in candidates:
            probe = User(
                country_code=row.country_code,
                phone=row.phone,
                is_verified=row.is_verified,
            )
            code, _src = effective_country(probe)
            if code == country:
                matched_ids.append(row.id)
        total = len(matched_ids)
        page_ids = matched_ids[offset : offset + limit]
        if not page_ids:
            return {"items": [], "total": total, "limit": limit, "offset": offset}
        users_by_id = {
            u.id: u
            for u in (
                await db.execute(select(User).where(User.id.in_(page_ids)))
            ).scalars()
        }
        page_users = [users_by_id[i] for i in page_ids if i in users_by_id]
        return {
            "items": await _hydrate_rows(db, page_users),
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    base = _apply_filters(select(User), q=q, status=status, profile=profile)
    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()
    page_users = list(
        (
            await db.execute(
                base.order_by(_order_clause(sort, order)).offset(offset).limit(limit)
            )
        ).scalars().all()
    )
    return {
        "items": await _hydrate_rows(db, page_users),
        "total": total,
        "limit": limit,
        "offset": offset,
    }


async def users_stats(db: AsyncSession) -> dict:
    """آمار سربرگ داشبورد: کل، در انتظار، کامل‌شده، تأییدشده، پروفایل کامل."""
    total = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    pending = (
        await db.execute(
            select(func.count()).select_from(User).where(pending_marker_exists())
        )
    ).scalar_one()
    verified = (
        await db.execute(
            select(func.count()).select_from(User).where(User.is_verified.is_(True))
        )
    ).scalar_one()
    complete = (
        await db.execute(
            select(func.count()).select_from(User).where(PROFILE_COMPLETE_COND)
        )
    ).scalar_one()
    return {
        "total_users": total,
        "pending": pending,
        "completed": total - pending,
        "verified": verified,
        "profile_complete": complete,
    }
