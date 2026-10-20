"""سرویس مرکز اعلان چندکاناله — فاز ۱۴.

- پخش گروهی با fan-out به‌ازای هر کاربر طبق `notification_preferences` (فاز ۱):
  کانال مؤثر هر کاربر = کانال‌های درخواستی ∩ ترجیحات فعال او
  (`notif_type="product"`). ردیف غایب = غیرفعال، به‌جز in_app که پیش‌فرض فعال است.
- تنزل صادقانه (§۱۵.۹): اگر provider یک کانال پیکربندی نشده باشد
  (مثلاً `sms_api_key` خالی یا نبود FCM sender)، تحویل آن کانال `skipped`
  می‌شود با دلیل — هرگز موفقیت جعلی.
- `notification_deliveries`: لاگ تحویل per-user/per-channel؛ audit برای سرجمع.
- نقاط تزریق `CHANNEL_SENDERS` / `CHANNEL_CONFIGURED` برای تست قابل
  monkeypatch‌اند؛ در مسیر عملیاتی هیچ mockای نیست.
"""
from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import get_settings
from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import (
    Notification,
    NotificationBroadcast,
    NotificationDelivery,
    NotificationPreference,
    Role,
    User,
    UserRole,
)

BROADCAST_NOTIF_TYPE = "product"
CHANNELS = ("email", "sms", "push", "in_app")

# پیش‌فرض کانال وقتی کاربر هیچ ترجیحی ثبت نکرده است
DEFAULT_CHANNEL_ENABLED: dict[str, bool] = {
    "email": False, "sms": False, "push": False, "in_app": True,
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# providerها — واقعی؛ CHANNEL_CONFIGURED/SENDERS در تست monkeypatch می‌شوند
# ---------------------------------------------------------------------------


def _email_configured() -> bool:
    return bool(get_settings().smtp_host)


def _sms_configured() -> bool:
    s = get_settings()
    return bool(s.sms_api_key and s.sms_api_key.strip())


def _push_configured() -> bool:
    # هنوز هیچ FCM senderای در کدبیس سیم‌کشی نشده — صادقانه False
    return False


def _in_app_configured() -> bool:
    return True


CHANNEL_CONFIGURED: dict[str, Callable[[], bool]] = {
    "email": _email_configured,
    "sms": _sms_configured,
    "push": _push_configured,
    "in_app": _in_app_configured,
}


async def _send_email(db: AsyncSession, user: User, title: str,
                      body: str) -> tuple[bool, str | None]:
    if not user.email:
        return False, "no_email_address"
    from app.core import email as email_mod

    try:
        ok = await email_mod.send_email(user.email, title, body)
        return bool(ok), None
    except Exception as exc:  # noqa: BLE001
        return False, f"email_error: {str(exc)[:200]}"


async def _send_sms(db: AsyncSession, user: User, title: str,
                    body: str) -> tuple[bool, str | None]:
    if not user.phone:
        return False, "no_phone_number"
    from app.core import sms as sms_mod

    try:
        ok = await sms_mod.send_sms(user.phone, f"{title}\n{body}"[:500])
        return bool(ok), None
    except Exception as exc:  # noqa: BLE001
        return False, f"sms_error: {str(exc)[:200]}"


async def _send_push(db: AsyncSession, user: User, title: str,
                     body: str) -> tuple[bool, str | None]:
    return False, "push_not_configured"


async def _send_in_app(db: AsyncSession, user: User, title: str,
                       body: str) -> tuple[bool, str | None]:
    db.add(Notification(
        user_id=user.id, notif_type=BROADCAST_NOTIF_TYPE,
        title={"fa": title, "ar": title, "en": title}, body=body,
        data={"source": "admin_broadcast"},
    ))
    await db.flush()
    return True, None


CHANNEL_SENDERS: dict[str, Callable[
    [AsyncSession, User, str, str], Awaitable[tuple[bool, str | None]]
]] = {
    "email": _send_email,
    "sms": _send_sms,
    "push": _send_push,
    "in_app": _send_in_app,
}


# ---------------------------------------------------------------------------
# ترجیحات کاربر
# ---------------------------------------------------------------------------


async def effective_channels(
    db: AsyncSession, user: User, requested: list[str]
) -> list[str]:
    """کانال‌های مؤثر = درخواستی ∩ ترجیحات فعال کاربر."""
    rows = (
        await db.execute(
            select(NotificationPreference).where(
                NotificationPreference.user_id == user.id,
                NotificationPreference.notif_type == BROADCAST_NOTIF_TYPE,
            )
        )
    ).scalars().all()
    pref = {r.channel: r.enabled for r in rows}
    out = []
    for ch in requested:
        if ch not in CHANNELS:
            continue
        enabled = pref.get(ch, DEFAULT_CHANNEL_ENABLED[ch])
        if enabled:
            out.append(ch)
    return out


# ---------------------------------------------------------------------------
# cohort
# ---------------------------------------------------------------------------


async def _resolve_cohort(db: AsyncSession, cohort: dict) -> list[User]:
    ctype = (cohort or {}).get("type", "all")
    if ctype == "all":
        stmt = select(User).where(User.is_active.is_(True)).order_by(User.created_at)
        return list((await db.execute(stmt.limit(10000))).scalars().all())
    if ctype == "roles":
        roles = (cohort.get("roles") or [])
        if not roles:
            raise APIError(422, "bad_cohort", "cohort.roles خالی است")
        stmt = (
            select(User)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.name.in_(roles), User.is_active.is_(True))
            .order_by(User.created_at)
        )
        return list((await db.execute(stmt.limit(10000))).scalars().all())
    if ctype == "users":
        ids = []
        for raw in (cohort.get("user_ids") or []):
            try:
                ids.append(uuid.UUID(str(raw)))
            except ValueError:
                raise APIError(422, "bad_cohort", f"user_id نامعتبر: {raw}")
        if not ids:
            raise APIError(422, "bad_cohort", "cohort.user_ids خالی است")
        stmt = select(User).where(User.id.in_(ids), User.is_active.is_(True))
        return list((await db.execute(stmt)).scalars().all())
    raise APIError(422, "bad_cohort", f"نوع cohort نامعتبر: {ctype}")


# ---------------------------------------------------------------------------
# پخش
# ---------------------------------------------------------------------------


def _broadcast_out(b: NotificationBroadcast) -> dict:
    return {
        "id": str(b.id), "title": b.title, "body": b.body,
        "cohort": b.cohort or {}, "channels_requested": b.channels_requested or [],
        "status": b.status, "total_recipients": b.total_recipients,
        "total_sent": b.total_sent, "total_skipped": b.total_skipped,
        "total_failed": b.total_failed,
        "created_at": b.created_at.isoformat(),
        "finished_at": b.finished_at.isoformat() if b.finished_at else None,
    }


async def create_broadcast(
    db: AsyncSession,
    *,
    actor: User,
    title: str,
    body: str,
    cohort: dict,
    channels: list[str],
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """ساخت + اجرای فوری پخش چندکاناله."""
    if not title or not body:
        raise APIError(422, "missing_content", "title و body الزامی‌اند")
    bad = [c for c in channels if c not in CHANNELS]
    if bad:
        raise APIError(422, "bad_channel", f"کانال نامعتبر: {bad}")
    if not channels:
        raise APIError(422, "no_channels", "حداقل یک کانال لازم است")

    users = await _resolve_cohort(db, cohort)
    if not users:
        raise APIError(422, "empty_cohort", "هیچ کاربر فعالی در cohort نیست")

    b = NotificationBroadcast(
        title=title, body=body, cohort=cohort, channels_requested=channels,
        status="sending", total_recipients=len(users), created_by=actor.id,
    )
    db.add(b)
    await db.flush()

    sent = skipped = failed = 0
    for user in users:
        eff = await effective_channels(db, user, channels)
        # کانال‌های درخواستی که ترجیح کاربر نیست → skipped صریح
        for ch in channels:
            if ch in eff:
                continue
            db.add(NotificationDelivery(
                broadcast_id=b.id, user_id=user.id, channel=ch,
                status="skipped", skip_reason="preference_disabled",
            ))
            skipped += 1
        for ch in eff:
            if not CHANNEL_CONFIGURED[ch]():
                db.add(NotificationDelivery(
                    broadcast_id=b.id, user_id=user.id, channel=ch,
                    status="skipped", skip_reason=f"{ch}_not_configured",
                ))
                skipped += 1
                continue
            ok, error = await CHANNEL_SENDERS[ch](db, user, title, body)
            if ok:
                db.add(NotificationDelivery(
                    broadcast_id=b.id, user_id=user.id, channel=ch,
                    status="sent", sent_at=_utcnow(),
                ))
                sent += 1
            else:
                db.add(NotificationDelivery(
                    broadcast_id=b.id, user_id=user.id, channel=ch,
                    status="failed", error=error,
                ))
                failed += 1

    b.total_sent = sent
    b.total_skipped = skipped
    b.total_failed = failed
    b.status = "done"
    b.finished_at = _utcnow()
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="notifications.broadcast",
        entity_type="notification_broadcast", entity_id=str(b.id),
        new_values={"title": title, "channels": channels, "cohort": cohort,
                    "recipients": len(users), "sent": sent,
                    "skipped": skipped, "failed": failed},
        ip=ip, user_agent=user_agent,
    )
    await emit_event(
        db, aggregate_type="notification_broadcast", aggregate_id=str(b.id),
        event_type="notification.broadcast.done",
        payload={"title": title, "recipients": len(users),
                 "sent": sent, "skipped": skipped, "failed": failed},
    )
    await db.commit()
    await db.refresh(b)
    return _broadcast_out(b)


async def list_broadcasts(db: AsyncSession, limit: int = 50) -> list[dict]:
    rows = (
        await db.execute(
            select(NotificationBroadcast)
            .order_by(NotificationBroadcast.created_at.desc())
            .limit(min(limit, 200))
        )
    ).scalars().all()
    return [_broadcast_out(b) for b in rows]


async def get_broadcast(db: AsyncSession, broadcast_id: uuid.UUID) -> dict:
    b = await db.get(NotificationBroadcast, broadcast_id)
    if b is None:
        raise APIError(404, "not_found", "پخش یافت نشد")
    deliveries = (
        await db.execute(
            select(NotificationDelivery)
            .where(NotificationDelivery.broadcast_id == b.id)
            .order_by(NotificationDelivery.created_at.asc())
            .limit(2000)
        )
    ).scalars().all()
    out = _broadcast_out(b)
    out["deliveries"] = [{
        "user_id": str(d.user_id), "channel": d.channel, "status": d.status,
        "skip_reason": d.skip_reason, "error": d.error,
        "sent_at": d.sent_at.isoformat() if d.sent_at else None,
    } for d in deliveries]
    return out


async def delivery_stats(db: AsyncSession) -> dict:
    """آمار کلی تحویل‌ها — داشبورد مرکز اعلان."""
    rows = (
        await db.execute(
            select(NotificationDelivery.channel, NotificationDelivery.status,
                   func.count())
            .group_by(NotificationDelivery.channel, NotificationDelivery.status)
        )
    ).all()
    stats: dict[str, dict[str, int]] = {}
    for ch, st, cnt in rows:
        stats.setdefault(ch, {})[st] = cnt
    return stats


async def resolve_cohort_preview(db: AsyncSession, cohort: dict) -> list[User]:
    """نسخهٔ عمومی _resolve_cohort برای پیش‌نمایش پخش (بدون ارسال)."""
    return await _resolve_cohort(db, cohort)
