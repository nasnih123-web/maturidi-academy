"""مدیریت انتشار به تلگرام — فاز ۱۱ (ADR-0008، §۹.۵).

- سیاست به‌ازای content_type: never | manual_approval | auto_publish |
  scheduled — پیش‌فرض never (get-or-create).
- لاگ telegram_published با idempotency_key یکتا:
  `{content_type}:{content_id}:{target}` — ارسال دوباره همان کلید، رکورد
  موجود را برمی‌گرداند، نه تکراری.
- auto-publish فقط وقتی policy صریحاً auto_publish باشد؛ محتوای
  واردشده از تلگرام (source_ref.origin == "telegram") هرگز auto-repost
  نمی‌شود مگر مدیر صریحاً policy بدهد (یعنی همان publish دستی).
- اعلان بازبینی فتوا: دکمه‌های inline با nonce یک‌بارمصرف
  (telegram_callbacks) که به (content, op, actor) بایند شده‌اند؛ گذار از
  همان مسیر مجوزدار submissions_service اجرا می‌شود.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.config import get_settings
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.logging import logger
from app.models.models import (
    LibraryItem,
    ReligiousPlace,
    TelegramCallback,
    TelegramDistributionPolicy,
    TelegramPublished,
    User,
)

from . import bot_service

POLICIES = ("never", "manual_approval", "auto_publish", "scheduled")
CALLBACK_TTL_HOURS = 24


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(expires_at: datetime) -> bool:
    """مقایسهٔ امن با SQLite (naive) و PostgreSQL (aware)."""
    exp = expires_at.replace(tzinfo=None) if expires_at.tzinfo is not None else expires_at
    return exp < _utcnow().replace(tzinfo=None)


def _idem_key(content_type: str, content_id: str, target: str) -> str:
    return f"{content_type}:{content_id}:{target}"


def _sign_nonce(nonce: str, op: str, content_id: str) -> str:
    key = get_settings().encryption_key.encode("utf-8")
    msg = f"{nonce}:{op}:{content_id}".encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# سیاست‌ها
# ---------------------------------------------------------------------------


async def get_policy(
    db: AsyncSession, content_type: str, *, create: bool = True
) -> TelegramDistributionPolicy | None:
    policy = (
        await db.execute(
            select(TelegramDistributionPolicy).where(
                TelegramDistributionPolicy.content_type == content_type
            )
        )
    ).scalar_one_or_none()
    if policy is None and create:
        policy = TelegramDistributionPolicy(
            content_type=content_type, policy="never", target_channels=[]
        )
        db.add(policy)
        await db.flush()
    return policy


async def list_policies(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(TelegramDistributionPolicy).order_by(
                TelegramDistributionPolicy.content_type
            )
        )
    ).scalars().all()
    return [_policy_out(p) for p in rows]


def _policy_out(p: TelegramDistributionPolicy) -> dict:
    return {
        "id": p.id,
        "content_type": p.content_type,
        "policy": p.policy,
        "message_template": p.message_template,
        "target_channels": p.target_channels or [],
        "spacing_seconds": p.spacing_seconds,
        "require_approval": p.require_approval,
        "schedule_config": p.schedule_config,
        "is_enabled": p.is_enabled,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


async def set_policy(
    db: AsyncSession,
    content_type: str,
    data: dict,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    policy_name = data.get("policy", "never")
    if policy_name not in POLICIES:
        raise APIError(422, "bad_policy", f"سیاست نامعتبر: {policy_name}")
    policy = await get_policy(db, content_type, create=True)
    old = _policy_out(policy)
    policy.policy = policy_name
    if "message_template" in data:
        policy.message_template = data["message_template"]
    if "target_channels" in data:
        channels = data["target_channels"] or []
        if not isinstance(channels, list):
            raise APIError(422, "bad_channels", "target_channels باید آرایه باشد")
        policy.target_channels = [str(c) for c in channels]
    if "spacing_seconds" in data:
        policy.spacing_seconds = max(0, int(data["spacing_seconds"]))
    if "require_approval" in data:
        policy.require_approval = bool(data["require_approval"])
    if "schedule_config" in data:
        policy.schedule_config = data["schedule_config"]
    if "is_enabled" in data:
        policy.is_enabled = bool(data["is_enabled"])
    policy.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.policy.set",
        entity_type="telegram_distribution_policy",
        entity_id=str(policy.id),
        old_values={"policy": old["policy"]},
        new_values={"policy": policy.policy, "content_type": content_type},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(policy)
    return _policy_out(policy)


# ---------------------------------------------------------------------------
# واکشی محتوا برای رندر پیام (lazy import — بدون چرخه)
# ---------------------------------------------------------------------------


async def fetch_content(
    db: AsyncSession, content_type: str, content_id: str
) -> dict | None:
    """برمی‌گرداند: {title, excerpt, url} یا None اگر محتوا یافت نشد."""
    try:
        if content_type == "fatwa_submission":
            from app.modules.fatwa import submissions_service  # noqa: PLC0415

            sub = await submissions_service.get_submission(
                db, uuid.UUID(content_id)
            )
            title = sub.title or {}
            body = sub.body or ""
            return {
                "title": title.get("fa") or title.get("ar") or title.get("en") or "",
                "excerpt": body[:500],
                "url": f"/fatwa/{content_id}",
            }
        if content_type == "religious_place":
            place = await db.get(ReligiousPlace, uuid.UUID(content_id))
            if place is None:
                return None
            name = place.name or {}
            desc = place.description or {}
            return {
                "title": name.get("fa") or name.get("ar") or name.get("en") or "",
                "excerpt": (desc.get("fa") or "")[:300],
                "url": f"/places/{content_id}",
            }
        if content_type == "library_item":
            item = await db.get(LibraryItem, uuid.UUID(content_id))
            if item is None:
                return None
            title = item.title or {}
            return {
                "title": title.get("fa") or title.get("ar") or title.get("en") or "",
                "excerpt": "",
                "url": f"/library/{content_id}",
            }
    except (ValueError, APIError):
        return None
    return None


def render_message(
    template: dict | None, content: dict, locale: str = "fa"
) -> str:
    tpl = (template or {}).get(locale) or (template or {}).get("fa")
    if not tpl:
        return f"📢 <b>{content.get('title', '')}</b>\n\n{content.get('excerpt', '')}".strip()
    try:
        return tpl.format(
            title=content.get("title", ""),
            excerpt=content.get("excerpt", ""),
            url=content.get("url", ""),
        )
    except (KeyError, IndexError, ValueError):
        return tpl


async def is_telegram_imported(
    db: AsyncSession, content_type: str, content_id: str
) -> bool:
    """آیا این محتوا از تلگرام وارد شده؟ — محافظه‌کارانه: هر
    `source_type="telegram_import"` (واردشدهٔ واقعی یا برنامه‌ریزی‌شدهٔ فاز ۹)
    از auto-repost مستثناست (§۹.۵)."""
    if content_type != "library_item":
        return False
    try:
        item = await db.get(LibraryItem, uuid.UUID(content_id))
    except ValueError:
        return False
    if item is None:
        return False
    return item.source_type == "telegram_import"


# ---------------------------------------------------------------------------
# انتشار (دستی + خودکار) — idempotent
# ---------------------------------------------------------------------------


def _published_out(row: TelegramPublished) -> dict:
    return {
        "id": row.id,
        "source_content_type": row.source_content_type,
        "source_content_id": row.source_content_id,
        "distribution_target": row.distribution_target,
        "published_message_id": row.published_message_id,
        "idempotency_key": row.idempotency_key,
        "status": row.status,
        "retry_count": row.retry_count,
        "error": row.error,
        "created_at": row.created_at,
        "sent_at": row.sent_at,
    }


async def _enqueue_telegram_job(job_name: str, **kwargs) -> bool:
    """گذاشتن جاب در صف telegram — صادقانه False اگر ورکر/Redis نباشد."""
    try:
        from arq import create_pool  # noqa: PLC0415
        from arq.connections import RedisSettings  # noqa: PLC0415

        pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
        await pool.enqueue_job(job_name, _queue_name="telegram", **kwargs)
        await pool.close()
        return True
    except Exception:  # noqa: BLE001 — worker آفلاین؛ رکورد pending می‌ماند
        logger.warning("telegram queue unavailable — job %s not enqueued", job_name)
        return False


async def request_publish(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: str,
    actor: User,
    targets: list[str] | None = None,
    idempotency_key: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> list[dict]:
    """انتشار دستی ادمین — idempotent روی idempotency_key."""
    policy = await get_policy(db, content_type, create=True)
    channel_targets = targets or policy.target_channels or []
    if not channel_targets:
        default = await bot_service.default_channel(db)
        if default:
            channel_targets = [default]
    if not channel_targets:
        raise APIError(422, "no_target_channel", "کانال مقصد مشخص نشده است")

    content = await fetch_content(db, content_type, content_id)
    if content is None:
        raise APIError(404, "content_not_found", "محتوا یافت نشد")

    results: list[dict] = []
    for target in channel_targets:
        key = idempotency_key or _idem_key(content_type, content_id, str(target))
        existing = (
            await db.execute(
                select(TelegramPublished).where(
                    TelegramPublished.idempotency_key == key
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            # idempotency: همان رکورد — بدون ارسال دوباره (§۴)
            results.append(_published_out(existing))
            continue
        row = TelegramPublished(
            source_content_type=content_type,
            source_content_id=content_id,
            distribution_target=str(target),
            idempotency_key=key,
            status="pending",
        )
        db.add(row)
        await db.flush()
        await log_audit(
            db,
            actor_id=actor.id,
            actor_type="admin",
            action="telegram.publish.request",
            entity_type="telegram_published",
            entity_id=str(row.id),
            new_values={
                "content_type": content_type,
                "content_id": content_id,
                "target": str(target),
            },
            ip=ip,
            user_agent=user_agent,
        )
        enqueued = await _enqueue_telegram_job(
            "telegram_publish_message", published_id=str(row.id)
        )
        if not enqueued:
            row.error = "worker unavailable — retry later"
        await db.commit()
        await db.refresh(row)
        results.append(_published_out(row))
    # رندر و ارسال واقعی در جاب ARQ انجام می‌شود
    return results


async def send_pending(db: AsyncSession, published_id: uuid.UUID) -> dict:
    """بدنهٔ جاب ARQ — ارسال یک رکورد pending. idempotent."""
    row = await db.get(TelegramPublished, published_id)
    if row is None:
        raise APIError(404, "publish_not_found", "رکورد انتشار یافت نشد")
    if row.status == "sent":
        return _published_out(row)  # قبلاً ارسال شده — اثر تکراری ندارد

    policy = await get_policy(db, row.source_content_type, create=False)
    template = policy.message_template if policy else None
    content = await fetch_content(
        db, row.source_content_type, row.source_content_id
    )
    if content is None:
        row.status = "failed"
        row.error = "content not found"
        await db.commit()
        return _published_out(row)

    text = render_message(template, content)
    message_id = await bot_service.send_message(db, row.distribution_target, text)
    if message_id is None:
        row.status = "failed"
        row.retry_count = (row.retry_count or 0) + 1
        row.error = "bot unavailable or send failed"
    else:
        row.status = "sent"
        row.published_message_id = message_id
        row.sent_at = _utcnow()
        row.error = None
    await emit_event(
        db,
        aggregate_type="telegram_published",
        aggregate_id=str(row.id),
        event_type=f"telegram.published.{row.status}",
        payload={
            "content_type": row.source_content_type,
            "content_id": row.source_content_id,
            "target": row.distribution_target,
        },
    )
    await log_audit(
        db,
        actor_id=None,
        actor_type="system",
        action="telegram.publish.send",
        entity_type="telegram_published",
        entity_id=str(row.id),
        new_values={"status": row.status, "message_id": row.published_message_id},
    )
    await db.commit()
    await db.refresh(row)
    return _published_out(row)


async def retry_publish(
    db: AsyncSession, published_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    row = await db.get(TelegramPublished, published_id)
    if row is None:
        raise APIError(404, "publish_not_found", "رکورد انتشار یافت نشد")
    if row.status == "sent":
        return _published_out(row)
    row.status = "pending"
    row.error = None
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.publish.retry",
        entity_type="telegram_published",
        entity_id=str(row.id),
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    enqueued = await _enqueue_telegram_job(
        "telegram_publish_message", published_id=str(row.id)
    )
    if not enqueued:
        row.error = "worker unavailable — retry later"
        await db.commit()
    await db.refresh(row)
    return _published_out(row)


async def revoke_publish(
    db: AsyncSession, published_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """لغو/حذف پیام منتشرشده (در صورت امکان provider) — §۹.۵."""
    row = await db.get(TelegramPublished, published_id)
    if row is None:
        raise APIError(404, "publish_not_found", "رکورد انتشار یافت نشد")
    deleted = False
    if row.published_message_id:
        deleted = await bot_service.delete_message(
            db, row.distribution_target, int(row.published_message_id)
        )
    if deleted:
        row.status = "deleted"
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.publish.revoke",
        entity_type="telegram_published",
        entity_id=str(row.id),
        new_values={"deleted": deleted, "status": row.status},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(row)
    return _published_out(row)


async def list_published(
    db: AsyncSession,
    *,
    content_type: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> tuple[list[dict], int]:
    stmt = select(TelegramPublished).order_by(TelegramPublished.created_at.desc())
    count_stmt = select(func.count()).select_from(TelegramPublished)
    if content_type:
        stmt = stmt.where(TelegramPublished.source_content_type == content_type)
        count_stmt = count_stmt.where(
            TelegramPublished.source_content_type == content_type
        )
    if status:
        stmt = stmt.where(TelegramPublished.status == status)
        count_stmt = count_stmt.where(TelegramPublished.status == status)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.limit(limit))).scalars().all()
    return [_published_out(r) for r in rows], total


async def auto_publish_if_policy(
    db: AsyncSession, content_type: str, content_id: str
) -> list[dict] | None:
    """هوک انتشار خودکار — فقط وقتی policy صریحاً auto_publish باشد.

    محتوای واردشده از تلگرام هرگز auto-repost نمی‌شود.
    از هوک submissions_service.transition صدا زده می‌شود (lazy + guarded).
    """
    policy = await get_policy(db, content_type, create=False)
    if policy is None or not policy.is_enabled:
        return None
    if policy.policy != "auto_publish":
        return None
    if await is_telegram_imported(db, content_type, content_id):
        logger.info(
            "telegram auto-publish skipped for telegram-imported %s:%s",
            content_type, content_id,
        )
        return None
    # انتشار خودکار با actor سیستمی — رکوردها idempotent هستند
    system = await _system_actor(db)
    return await request_publish(
        db, content_type=content_type, content_id=content_id, actor=system
    )


async def _system_actor(db: AsyncSession) -> User:
    """کاربر سیستمی برای انتشار خودکار — اولین super_admin فعال."""
    from app.models.models import Role, UserRole  # noqa: PLC0415

    stmt = (
        select(User)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.name == "super_admin")
        .where(User.is_active.is_(True))
        .order_by(User.created_at)
        .limit(1)
    )
    user = (await db.execute(stmt)).scalars().first()
    if user is None:
        raise APIError(503, "no_system_actor", "کاربر سیستمی برای انتشار یافت نشد")
    return user


# ---------------------------------------------------------------------------
# اعلان بازبینی فتوا با دکمه‌های inline
# ---------------------------------------------------------------------------


async def notify_review_request(
    db: AsyncSession, content_type: str, content_id: str, *, actor: User
) -> dict | None:
    """ارسال اعلان بازبینی با دکمه‌های تأیید/رد — idempotent.

    actor: کاربری که اعلان به نام او ارسال می‌شود؛ nonceها به او بایند‌اند تا
    گذارِ وبهوک از مسیر مجوزدار واقعی (is_approver) اجرا شود.
    """
    if content_type != "fatwa_submission":
        return None
    if not await bot_service.bot_enabled(db):
        return None

    key = f"review:{content_type}:{content_id}"
    existing = (
        await db.execute(
            select(TelegramPublished).where(TelegramPublished.idempotency_key == key)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _published_out(existing)

    content = await fetch_content(db, content_type, content_id)
    if content is None:
        return None

    policy = await get_policy(db, content_type, create=True)
    targets = policy.target_channels or []
    default = await bot_service.default_channel(db)
    if default and default not in targets:
        targets = [default, *targets]
    if not targets:
        logger.info("telegram review notify: no target channel configured")
        return None

    expires_at = _utcnow() + timedelta(hours=CALLBACK_TTL_HOURS)
    nonces = {}
    for op in ("approve", "reject"):
        nonce = secrets.token_hex(8)
        sig = _sign_nonce(nonce, op, content_id)
        db.add(
            TelegramCallback(
                nonce=nonce,
                source_content_type=content_type,
                source_content_id=content_id,
                op=op,
                actor_user_id=actor.id,
                signature=sig,
                expires_at=expires_at,
            )
        )
        nonces[op] = nonce
    await db.flush()

    message_id: int | None = None
    for target in targets:
        message_id = await bot_service.send_fatwa_review_request(
            db,
            chat_id=target,
            title=content["title"],
            excerpt=content["excerpt"][:400],
            approve_nonce=nonces["approve"],
            reject_nonce=nonces["reject"],
            template=policy.message_template,
        )
        if message_id is not None:
            break

    row = TelegramPublished(
        source_content_type=content_type,
        source_content_id=content_id,
        distribution_target=targets[0],
        published_message_id=message_id,
        idempotency_key=key,
        status="notified" if message_id else "failed",
        error=None if message_id else "bot unavailable",
        sent_at=_utcnow() if message_id else None,
    )
    db.add(row)
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="telegram.review.notify",
        entity_type="telegram_published",
        entity_id=str(row.id),
        new_values={"content_type": content_type, "content_id": content_id,
                     "notified": message_id is not None},
    )
    await db.commit()
    await db.refresh(row)
    return _published_out(row)


async def verify_webhook_secret(db: AsyncSession, provided: str | None) -> bool:
    """احراز هویت وبهوک تلگرام — هدر X-Telegram-Bot-Api-Secret-Token."""
    from app.core.platform_settings import get_setting as _gs  # noqa: PLC0415

    expected = await _gs(db, "telegram.webhook_secret")
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided, expected)


async def apply_callback(
    db: AsyncSession, *, nonce: str, callback_query_id: str | None = None
) -> dict:
    """اجرای callback دکمهٔ inline — یک‌بارمصرف، امضادار، مجوزدار."""
    cb = await db.get(TelegramCallback, nonce)
    if cb is None:
        raise APIError(404, "callback_not_found", "دکمه نامعتبر است")
    if cb.used_at is not None:
        raise APIError(409, "callback_used", "این دکمه قبلاً استفاده شده است")
    if _is_expired(cb.expires_at):
        raise APIError(410, "callback_expired", "این دکمه منقضی شده است")
    expected_sig = _sign_nonce(cb.nonce, cb.op, cb.source_content_id)
    if not hmac.compare_digest(expected_sig, cb.signature):
        raise APIError(403, "callback_tampered", "امضای دکمه نامعتبر است")

    actor = await db.get(User, cb.actor_user_id)
    if actor is None:
        raise APIError(404, "actor_not_found", "کاربر اجراکننده یافت نشد")

    result: dict
    if cb.source_content_type == "fatwa_submission":
        from app.modules.fatwa import submissions_service  # noqa: PLC0415

        target = {"approve": "approved", "reject": "rejected"}.get(cb.op)
        if target is None:
            raise APIError(422, "bad_callback_op", "عملیات نامعتبر است")
        submission = await submissions_service.get_submission(
            db, uuid.UUID(cb.source_content_id)
        )
        # گذار از مسیر مجوزدار واقعی — is_approver روی actor چک می‌شود
        await submissions_service.transition(
            db, submission=submission, target=target, actor=actor
        )
        result = {"content_type": cb.source_content_type,
                  "content_id": cb.source_content_id, "op": cb.op, "to": target}
    else:
        raise APIError(422, "callback_unsupported",
                       f"نوع محتوای {cb.source_content_type} پشتیبانی نمی‌شود")

    cb.used_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="telegram",
        action="telegram.callback.apply",
        entity_type="telegram_callback",
        entity_id=cb.nonce,
        new_values=result,
    )
    await db.commit()
    if callback_query_id:
        await bot_service.answer_callback_query(
            db, callback_query_id,
            "✅ تأیید شد" if cb.op == "approve" else "❌ رد شد",
        )
    return result
