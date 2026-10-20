"""لایهٔ سرویس کاربران — پروفایل، نشست‌ها، رضایت، export/delete، لیست ادمین."""
from __future__ import annotations

import base64
import json
import secrets as pysecrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.security import hash_password
from app.models.models import (
    Donation,
    FatwaMessage,
    FatwaSession,
    Notification,
    NotificationPreference,
    RefreshToken,
    Session,
    User,
    UserAyahNote,
    UserConsent,
    UserDevice,
    WebPushSubscription,
)
from app.modules.users.schemas import MeUpdate


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def register_device(
    db: AsyncSession, user: User, device_id: str,
    platform: str | None, push_token: str | None,
) -> dict:
    """ثبت/به‌روزرسانی دستگاه کاربر + توکن FCM (upsert — آخرین مقدار برنده).

    خود توکن در audit log ذخیره نمی‌شود (فاز ۰ §۱۴) — فقط «تغییر کرد».
    """
    if not device_id or len(device_id) > 64:
        raise APIError(422, "validation_error", "شناسهٔ دستگاه نامعتبر است")
    if platform and platform not in ("android", "ios", "web", "desktop"):
        raise APIError(422, "validation_error", "پلتفرم نامعتبر است")
    row = (
        await db.execute(
            select(UserDevice).where(
                UserDevice.user_id == user.id,
                UserDevice.device_id == device_id,
            )
        )
    ).scalar_one_or_none()
    now = _utcnow()
    if row is None:
        row = UserDevice(
            user_id=user.id, device_id=device_id,
            platform=platform, push_token=push_token, last_seen=now,
        )
        db.add(row)
    else:
        row.platform = platform or row.platform
        if push_token is not None:
            row.push_token = push_token
        row.last_seen = now
    await db.flush()
    await log_audit(
        db, actor_id=user.id, actor_type="user", action="device.register",
        entity_type="user_device", entity_id=str(row.id),
        old_values=None,
        new_values={"device_id": device_id, "push_token": {"changed": push_token is not None}},
        ip=None, user_agent=None,
    )
    await db.commit()
    return {"device_id": device_id, "platform": row.platform, "registered": True}


async def subscribe_web_push(
    db: AsyncSession, user: User, endpoint: str, p256dh: str, auth: str,
) -> dict:
    """اشتراک web push مرورگر (VAPID) — upsert روی (user_id, endpoint)."""
    if not endpoint.startswith("https://"):
        raise APIError(422, "validation_error", "endpoint باید https باشد")
    row = (
        await db.execute(
            select(WebPushSubscription).where(
                WebPushSubscription.user_id == user.id,
                WebPushSubscription.endpoint == endpoint,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = WebPushSubscription(
            user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth,
        )
        db.add(row)
    else:
        row.p256dh = p256dh
        row.auth = auth
    await db.commit()
    return {"subscribed": True}


async def unsubscribe_web_push(db: AsyncSession, user: User, endpoint: str) -> dict:
    row = (
        await db.execute(
            select(WebPushSubscription).where(
                WebPushSubscription.user_id == user.id,
                WebPushSubscription.endpoint == endpoint,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return {"subscribed": False}


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


async def _export_fatwa_sessions(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """نشست‌های فتوا + پیام‌ها — فقط مالک (GAP-P17-GDPR-1). دو کوئری دسته‌ای، بدون N+1."""
    sessions = list(
        (
            await db.execute(
                select(FatwaSession)
                .where(FatwaSession.user_id == user_id)
                .order_by(FatwaSession.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    by_session: dict[uuid.UUID, list[dict]] = {s.id: [] for s in sessions}
    if sessions:
        messages = (
            await db.execute(
                select(FatwaMessage)
                .where(FatwaMessage.session_id.in_([s.id for s in sessions]))
                .order_by(FatwaMessage.created_at.asc())
            )
        ).scalars().all()
        for m in messages:
            by_session[m.session_id].append(
                {
                    "id": str(m.id),
                    "role": m.role,
                    "content": m.content,
                    "citations": m.citations,
                    "status": m.status,
                    "created_at": m.created_at.isoformat(),
                }
            )
    return [
        {
            "id": str(s.id),
            "locale": s.locale,
            "created_at": s.created_at.isoformat(),
            "messages": by_session[s.id],
        }
        for s in sessions
    ]


async def _export_quran_notes(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """یادداشت‌های آیهٔ کاربر — فقط مالک (GAP-P17-GDPR-2)."""
    notes = (
        await db.execute(
            select(UserAyahNote)
            .where(UserAyahNote.user_id == user_id)
            .order_by(UserAyahNote.created_at.asc())
        )
    ).scalars().all()
    return [
        {
            "id": str(n.id),
            "surah": n.surah,
            "ayah": n.ayah,
            "note_text": n.note_text,
            "is_private": n.is_private,
            "version": n.version,
            "created_at": n.created_at.isoformat(),
            "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        }
        for n in notes
    ]


async def _export_donations(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """اهداهای ثبت‌شدهٔ کاربر — فقط مالک (GAP-P17-GDPR-3).

    رسید PDF دادهٔ ذخیره‌شدهٔ جداگانه ندارد؛ از همین ردیف رندر می‌شود،
    پس همین بخش، پوشش رسید را هم کامل می‌کند.
    """
    donations = (
        await db.execute(
            select(Donation)
            .where(Donation.donor_id == user_id)
            .order_by(Donation.created_at.asc())
        )
    ).scalars().all()
    return [
        {
            "id": str(d.id),
            "amount": d.amount,
            "currency": d.currency,
            "gateway": d.gateway,
            "gateway_reference": d.gateway_reference,
            "status": d.status,
            "donor_name": d.donor_name,
            "campaign_id": str(d.campaign_id) if d.campaign_id else None,
            "created_at": d.created_at.isoformat(),
        }
        for d in donations
    ]


async def export_data(db: AsyncSession, user: User) -> dict:
    """خروجی JSON دادهٔ شخصی — GDPR از روز اول (فاز ۱). بدون password_hash.

    شامل دادهٔ ماژول‌های کاربرمحور با اسکوپ مالک (Track 3 — remediation
    pass 2، رفع شکاف‌های GAP-P17-GDPR-1/2/3):
    - fatwa_sessions: نشست‌های گفتگوی فتوا + پیام‌هایشان (فقط user_id=self؛
      پرسش‌های ناشناس عمومی user_id ندارند و دادهٔ شخصی نیستند)
    - quran_notes: یادداشت‌های آیهٔ کاربر
    - donations: اهداهای ثبت‌شدهٔ کاربر. رسید PDF دادهٔ ذخیره‌شدهٔ جداگانه‌ای
      ندارد — به‌صورت قطعی از همین ردیف اهدا رندر می‌شود (get_receipt_pdf)،
      پس درج اهداها پوشش رسید را هم کامل می‌کند.
    """
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
    fatwa_sessions = await _export_fatwa_sessions(db, user.id)
    quran_notes = await _export_quran_notes(db, user.id)
    donations = await _export_donations(db, user.id)
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
        "fatwa_sessions": fatwa_sessions,
        "quran_notes": quran_notes,
        "donations": donations,
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


# ---------- اعلان‌های دریافتی کاربر (فاز ۲ §۵ — وب/CRM از API می‌خوانند) ----------

async def list_my_notifications(
    db: AsyncSession,
    user: User,
    unread_only: bool,
    cursor: str | None,
    limit: int,
) -> tuple[list[Notification], int, str | None]:
    """اعلان‌های خودِ کاربر — جدیدترین اول، cursor-based (§۱)."""
    limit = min(max(limit, 1), _CURSOR_LIMIT)
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    if cursor:
        ts, uid = _decode_cursor(cursor)
        stmt = stmt.where(
            (Notification.created_at < ts)
            | ((Notification.created_at == ts) & (Notification.id < uid))
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = (
        _encode_cursor(rows[limit].created_at, rows[limit].id)
        if len(rows) > limit
        else None
    )
    items = rows[:limit]
    unread_count = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user.id,
                Notification.read_at.is_(None),
            )
        )
    ).scalar_one()
    return items, unread_count, next_cursor


async def mark_notification_read(
    db: AsyncSession, user: User, notification_id: uuid.UUID
) -> Notification:
    """خوانده‌شدن اعلان — فقط مال خودِ کاربر (idempotent)."""
    row = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise APIError(404, "not_found", "اعلان یافت نشد")
    if row.read_at is None:
        row.read_at = _utcnow()
        await db.commit()
    return row
