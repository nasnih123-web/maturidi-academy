"""لایهٔ سرویس کاربران — پروفایل، نشست‌ها، رضایت، export/delete، لیست ادمین."""
from __future__ import annotations

import base64
import json
import secrets as pysecrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.security import hash_password
from app.models.models import (
    AuditLog,
    NotificationPreference,
    RefreshToken,
    Session,
    User,
    UserConsent,
)
from app.modules.users.schemas import MeUpdate


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def update_me(
    db: AsyncSession,
    user: User,
    data: MeUpdate,
    ip: str | None,
    user_agent: str | None,
) -> User:
    old = {"full_name": user.full_name, "locale": user.locale}
    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.locale is not None:
        user.locale = data.locale
    if data.avatar_media_id is not None:
        user.avatar_media_id = data.avatar_media_id
    new = {"full_name": user.full_name, "locale": user.locale}
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.profile_updated",
        payload={"fields": [k for k in new if old[k] != new[k]]},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.profile_update",
        entity_type="user",
        entity_id=str(user.id),
        old_values=old,
        new_values=new,
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(user)
    return user


async def list_sessions(db: AsyncSession, user: User) -> list[Session]:
    stmt = (
        select(Session)
        .where(Session.user_id == user.id, Session.revoked.is_(False))
        .order_by(Session.last_active_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def revoke_session(
    db: AsyncSession, user: User, session_id: uuid.UUID, ip: str | None
) -> None:
    session = await db.get(Session, session_id)
    if not session or session.user_id != user.id or session.revoked:
        raise APIError(404, "not_found", "نشست یافت نشد")
    session.revoked = True
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.session_id == session.id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.session_revoked",
        payload={"session_id": str(session.id)},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.session_revoke",
        entity_type="session",
        entity_id=str(session.id),
        ip=ip,
    )
    await db.commit()


async def list_consents(db: AsyncSession, user: User) -> list[UserConsent]:
    stmt = (
        select(UserConsent)
        .where(UserConsent.user_id == user.id)
        .order_by(UserConsent.accepted_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def export_data(db: AsyncSession, user: User) -> dict:
    """خروجی JSON دادهٔ شخصی — GDPR از روز اول (فاز ۱). بدون password_hash."""
    sessions = await list_sessions(db, user)
    consents = await list_consents(db, user)
    prefs = list(
        (
            await db.execute(
                select(NotificationPreference).where(
                    NotificationPreference.user_id == user.id
                )
            )
        )
        .scalars()
        .all()
    )
    data = {
        "profile": {
            "id": str(user.id),
            "full_name": user.full_name,
            "email": user.email,
            "phone": user.phone,
            "locale": user.locale,
            "is_verified": user.is_verified,
            "created_at": user.created_at.isoformat(),
        },
        "sessions": [
            {
                "id": str(s.id),
                "device_info": s.device_info,
                "ip": s.ip,
                "last_active_at": s.last_active_at.isoformat(),
                "created_at": s.created_at.isoformat(),
            }
            for s in sessions
        ],
        "consents": [
            {
                "consent_type": c.consent_type,
                "text_version": c.text_version,
                "accepted_at": c.accepted_at.isoformat(),
            }
            for c in consents
        ],
        "notification_preferences": [
            {"channel": p.channel, "notif_type": p.notif_type, "enabled": p.enabled}
            for p in prefs
        ],
    }
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.data_exported",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.data_export",
        entity_type="user",
        entity_id=str(user.id),
    )
    await db.commit()
    return data


async def delete_account(
    db: AsyncSession, user: User, ip: str | None, user_agent: str | None
) -> None:
    """ناشناس‌سازی دادهٔ شخصی — GDPR از روز اول.

    audit logها (بدون secret) و domain_events برای پاسخ‌گویی نگه‌داری می‌شوند؛
    شناسه‌ها دیگر به هویت واقعی قابل اتصال نیستند.
    """
    user.full_name = "حساب حذف‌شده"
    user.email = None
    user.phone = None
    user.password_hash = hash_password(pysecrets.token_hex(32))
    user.totp_secret = None
    user.avatar_media_id = None
    user.is_active = False
    user.is_verified = False
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )
    await db.execute(
        update(Session)
        .where(Session.user_id == user.id, Session.revoked.is_(False))
        .values(revoked=True)
    )
    await emit_event(
        db,
        aggregate_type="user",
        aggregate_id=str(user.id),
        event_type="user.deleted",
        payload={},
    )
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="user.delete",
        entity_type="user",
        entity_id=str(user.id),
        new_values={"anonymized": True},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()


# ---------- ادمین: لیست کاربران با صفحه‌بندی cursor-based (فاز ۰ §۱) ----------

_CURSOR_LIMIT = 50


def _encode_cursor(created_at: datetime, uid: uuid.UUID) -> str:
    raw = json.dumps({"t": created_at.isoformat(), "id": str(uid)})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(raw["t"]), uuid.UUID(raw["id"])
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


async def admin_list_users(
    db: AsyncSession, cursor: str | None, limit: int
) -> tuple[list[User], str | None]:
    limit = min(max(limit, 1), _CURSOR_LIMIT)
    stmt = select(User).order_by(User.created_at.asc(), User.id.asc())
    if cursor:
        ts, uid = _decode_cursor(cursor)
        stmt = stmt.where(
            (User.created_at > ts)
            | ((User.created_at == ts) & (User.id > uid))
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor
