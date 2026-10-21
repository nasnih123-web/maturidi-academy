"""سرویس شبکهٔ اجتماعی و نظارت — فاز ۱۰.

همهٔ منطق کسب‌وکار اینجاست (§۱۵.۶): routerها فقط اعتبارسنجی ورودی و
فراخوانی service می‌کنند.

- فیلتر کلمات ممنوعه روی پست و کامنت **پیش از insert** اعمال می‌شود؛
  تخلف → ۴۲۲ با کد content_policy_violation و **بدون بازتاب واژهٔ منطبق**.
- گزارش‌ها با sla_due_at از روی سیاست platform_settings ساخته می‌شوند
  (کلید social.moderation.sla_hours، پیش‌فرض ۲۴ ساعت).
"""
from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import get_setting
from app.models.models import (
    GroupMembership,
    ModerationBannedWord,
    Notification,
    PostLike,
    RefreshToken,
    Role,
    Session,
    SocialComment,
    SocialFollow,
    SocialGroup,
    SocialPost,
    SocialReport,
    User,
    UserRole,
)

# ---------------------------------------------------------------------------
# ابزارها
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _L(fa: str, ar: str, en: str) -> dict:
    return {"fa": fa, "ar": ar, "en": en}


def _encode_cursor(created_at: datetime, lid: uuid.UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(lid)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        ts, lid = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(ts), uuid.UUID(lid)
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


async def _sla_hours(db: AsyncSession) -> int:
    raw = await get_setting(db, "social.moderation.sla_hours")
    try:
        return max(1, int(raw)) if raw else 24
    except (TypeError, ValueError):
        return 24


# ---------------------------------------------------------------------------
# فیلتر کلمات ممنوعه (§فاز ۱۰: پیش از انتشار، روی پست و کامنت)
# ---------------------------------------------------------------------------


def _normalize_for_match(text_value: str) -> str:
    """نرمال‌سازی برای تطبیق واژهٔ ممنوعه: اعراب/تشکیلات، ی/ک، حروف کوچک."""
    t = text_value.strip().lower()
    t = re.sub(r"[\u064b-\u0652\u0670]", "", t)
    t = t.replace("ي", "ی").replace("ك", "ک")
    return re.sub(r"\s+", " ", t)


async def _banned_words(db: AsyncSession) -> list[str]:
    rows = (await db.execute(select(ModerationBannedWord.word))).scalars().all()
    return [_normalize_for_match(w) for w in rows if w]


async def check_content_policy(db: AsyncSession, text_value: str) -> None:
    """تخلف از سیاست محتوا → ۴۲۲ content_policy_violation (بدون بازتاب واژه)."""
    if not text_value:
        return
    normalized = _normalize_for_match(text_value)
    for word in await _banned_words(db):
        if word and word in normalized:
            raise APIError(
                422,
                "content_policy_violation",
                "متن با سیاست محتوای انجمن سازگار نیست",
            )


# ---------------------------------------------------------------------------
# گروه‌ها
# ---------------------------------------------------------------------------


def _slugify(name: dict) -> str:
    base = name.get("fa") or name.get("en") or "group"
    slug = re.sub(r"[^\w\u0600-\u06FF]+", "-", base).strip("-")
    return (slug or "group")[:100]


async def create_group(
    db: AsyncSession, *, name: dict, description: dict | None, slug: str | None,
    is_public: bool, creator: User,
) -> SocialGroup:
    final_slug = slug or _slugify(name)
    exists = (
        await db.execute(select(SocialGroup).where(SocialGroup.slug == final_slug))
    ).scalar_one_or_none()
    if exists:
        raise APIError(409, "duplicate_group_slug", "نامک گروه تکراری است")
    group = SocialGroup(
        name=name,
        description=description,
        slug=final_slug,
        is_public=is_public,
        created_by=creator.id,
    )
    db.add(group)
    await db.flush()
    db.add(GroupMembership(group_id=group.id, user_id=creator.id, role="moderator"))
    group.member_count = 1
    await db.flush()
    await db.commit()
    return group


async def list_groups(
    db: AsyncSession, *, cursor: str | None, limit: int, user_id: uuid.UUID | None
) -> tuple[list[SocialGroup], str | None]:
    stmt = select(SocialGroup).order_by(
        SocialGroup.created_at.desc(), SocialGroup.id.desc()
    )
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                SocialGroup.created_at < ts,
                and_(SocialGroup.created_at == ts, SocialGroup.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor


async def get_group(db: AsyncSession, group_id: uuid.UUID) -> SocialGroup:
    group = await db.get(SocialGroup, group_id)
    if not group:
        raise APIError(404, "group_not_found", "گروه یافت نشد")
    return group


async def is_member(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    stmt = (
        select(GroupMembership.id)
        .where(
            GroupMembership.group_id == group_id,
            GroupMembership.user_id == user_id,
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def join_group(db: AsyncSession, group: SocialGroup, user: User) -> None:
    if await is_member(db, group.id, user.id):
        return
    db.add(GroupMembership(group_id=group.id, user_id=user.id, role="member"))
    group.member_count = (group.member_count or 0) + 1
    await db.flush()
    await db.commit()


async def leave_group(db: AsyncSession, group: SocialGroup, user: User) -> None:
    membership = (
        await db.execute(
            select(GroupMembership).where(
                GroupMembership.group_id == group.id,
                GroupMembership.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not membership:
        return
    await db.delete(membership)
    group.member_count = max(0, (group.member_count or 1) - 1)
    await db.flush()
    await db.commit()


# ---------------------------------------------------------------------------
# پست، فید، کامنت
# ---------------------------------------------------------------------------


async def create_post(
    db: AsyncSession, *, author: User, body: str, group_id: uuid.UUID | None
) -> SocialPost:
    await check_content_policy(db, body)
    if group_id:
        group = await get_group(db, group_id)
        if not group.is_public and not await is_member(db, group.id, author.id):
            raise APIError(403, "group_not_joined", "برای انتشار در گروه خصوصی باید عضو باشید")
    post = SocialPost(author_id=author.id, body=body, group_id=group_id)
    db.add(post)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="social_post",
        aggregate_id=str(post.id),
        event_type="social.post_created",
        payload={"author_id": str(author.id), "group_id": str(group_id) if group_id else None},
    )
    await db.commit()
    return post


async def get_post(db: AsyncSession, post_id: uuid.UUID) -> SocialPost:
    post = await db.get(SocialPost, post_id)
    if not post:
        raise APIError(404, "post_not_found", "پست یافت نشد")
    return post


async def liked_post_ids(
    db: AsyncSession, user_id: uuid.UUID, post_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """شناسهٔ پست‌هایی از فهرست که کاربر لایک کرده — یک کوئری."""
    if not post_ids:
        return set()
    rows = (
        await db.execute(
            select(PostLike.post_id).where(
                PostLike.user_id == user_id, PostLike.post_id.in_(post_ids)
            )
        )
    ).scalars().all()
    return set(rows)


async def like_post(
    db: AsyncSession, *, post: SocialPost, user: User
) -> tuple[bool, int]:
    """لایک idempotent — لایک تکراری همان وضعیت را برمی‌گرداند."""
    if post.status != "published":
        raise APIError(404, "post_not_found", "پست یافت نشد")
    existing = await db.execute(
        select(PostLike).where(
            PostLike.post_id == post.id, PostLike.user_id == user.id
        )
    )
    if existing.scalar_one_or_none():
        return True, post.likes_count or 0
    db.add(PostLike(post_id=post.id, user_id=user.id))
    post.likes_count = (post.likes_count or 0) + 1
    await db.flush()
    await emit_event(
        db,
        aggregate_type="social_post",
        aggregate_id=str(post.id),
        event_type="social.post_liked",
        payload={"user_id": str(user.id)},
    )
    await db.commit()
    return True, post.likes_count or 0


async def unlike_post(
    db: AsyncSession, *, post: SocialPost, user: User
) -> tuple[bool, int]:
    existing = await db.execute(
        select(PostLike).where(
            PostLike.post_id == post.id, PostLike.user_id == user.id
        )
    )
    like = existing.scalar_one_or_none()
    if like:
        await db.delete(like)
        post.likes_count = max((post.likes_count or 1) - 1, 0)
        await db.flush()
        await db.commit()
    return False, post.likes_count or 0


async def list_feed(
    db: AsyncSession, *, cursor: str | None, limit: int,
    group_id: uuid.UUID | None = None,
) -> tuple[list[SocialPost], str | None]:
    stmt = (
        select(SocialPost)
        .where(SocialPost.status == "published")
        .order_by(SocialPost.created_at.desc(), SocialPost.id.desc())
    )
    if group_id:
        stmt = stmt.where(SocialPost.group_id == group_id)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                SocialPost.created_at < ts,
                and_(SocialPost.created_at == ts, SocialPost.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor


async def create_comment(
    db: AsyncSession, *, author: User, post: SocialPost, body: str
) -> SocialComment:
    if post.status != "published":
        raise APIError(404, "post_not_found", "پست یافت نشد")
    await check_content_policy(db, body)
    comment = SocialComment(post_id=post.id, author_id=author.id, body=body)
    db.add(comment)
    post.comment_count = (post.comment_count or 0) + 1
    await db.flush()
    await db.commit()
    return comment


async def list_comments(
    db: AsyncSession, post: SocialPost, *, cursor: str | None, limit: int
) -> tuple[list[SocialComment], str | None]:
    stmt = (
        select(SocialComment)
        .where(
            SocialComment.post_id == post.id,
            SocialComment.status == "published",
        )
        .order_by(SocialComment.created_at.asc(), SocialComment.id.asc())
    )
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                SocialComment.created_at > ts,
                and_(SocialComment.created_at == ts, SocialComment.id > lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor


async def follow_user(db: AsyncSession, *, follower: User, followed_id: uuid.UUID) -> SocialFollow:
    if follower.id == followed_id:
        raise APIError(422, "self_follow", "نمی‌توانید خودتان را دنبال کنید")
    target = await db.get(User, followed_id)
    if not target:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    existing = (
        await db.execute(
            select(SocialFollow).where(
                SocialFollow.follower_id == follower.id,
                SocialFollow.followed_id == followed_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    follow = SocialFollow(follower_id=follower.id, followed_id=followed_id)
    db.add(follow)
    await db.flush()
    await db.commit()
    return follow


async def unfollow_user(db: AsyncSession, *, follower: User, followed_id: uuid.UUID) -> bool:
    """آنفالو idempotent — نبودن رکورد خطا نیست."""
    existing = (
        await db.execute(
            select(SocialFollow).where(
                SocialFollow.follower_id == follower.id,
                SocialFollow.followed_id == followed_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()
        return True
    return False


# ---------------------------------------------------------------------------
# گزارش‌ها و صف نظارت
# ---------------------------------------------------------------------------

REPORT_TARGETS = ("post", "comment", "user")


async def _target_exists(db: AsyncSession, target_type: str, target_id: uuid.UUID) -> bool:
    if target_type == "post":
        return await db.get(SocialPost, target_id) is not None
    if target_type == "comment":
        return await db.get(SocialComment, target_id) is not None
    if target_type == "user":
        return await db.get(User, target_id) is not None
    return False


async def create_report(
    db: AsyncSession, *, reporter: User, target_type: str, target_id: uuid.UUID, reason: str
) -> SocialReport:
    if target_type not in REPORT_TARGETS:
        raise APIError(422, "invalid_target_type", "نوع هدف گزارش نامعتبر است")
    if not await _target_exists(db, target_type, target_id):
        raise APIError(404, "report_target_not_found", "هدف گزارش یافت نشد")
    now = _utcnow()
    hours = await _sla_hours(db)
    report = SocialReport(
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        reported_by=reporter.id,
        reported_at=now,
        sla_due_at=now + timedelta(hours=hours),
    )
    db.add(report)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="social_report",
        aggregate_id=str(report.id),
        event_type="social.report_created",
        payload={
            "target_type": target_type,
            "target_id": str(target_id),
            "reported_by": str(reporter.id),
            "sla_due_at": report.sla_due_at.isoformat(),
        },
    )
    await db.commit()
    return report


async def list_reports(
    db: AsyncSession, *, status: str | None, cursor: str | None, limit: int
) -> tuple[list[SocialReport], str | None]:
    stmt = select(SocialReport).order_by(
        SocialReport.reported_at.desc(), SocialReport.id.desc()
    )
    if status:
        stmt = stmt.where(SocialReport.status == status)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                SocialReport.reported_at < ts,
                and_(SocialReport.reported_at == ts, SocialReport.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.reported_at, last.id)
    return rows, next_cursor


async def get_report(db: AsyncSession, report_id: uuid.UUID) -> SocialReport:
    report = await db.get(SocialReport, report_id)
    if not report:
        raise APIError(404, "report_not_found", "گزارش یافت نشد")
    return report


async def _remove_reported_content(db: AsyncSession, report: SocialReport) -> None:
    """حذف محتوای گزارش‌شده — فقط post/comment؛ برای user فقط اخطار ثبت می‌شود."""
    if report.target_type == "post":
        post = await db.get(SocialPost, report.target_id)
        if post:
            post.status = "removed"
    elif report.target_type == "comment":
        comment = await db.get(SocialComment, report.target_id)
        if comment:
            comment.status = "removed"


async def _is_protected(db: AsyncSession, target: User) -> bool:
    """کاربر دارای نقش super_admin قابل بن نیست."""
    rows = (
        await db.execute(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == target.id)
        )
    ).scalars().all()
    return "super_admin" in rows


async def _revoke_user_sessions(db: AsyncSession, target: User) -> None:
    """ابطال همهٔ نشست‌ها و توکن‌های کاربر بن‌شده."""
    await db.execute(
        update(Session)
        .where(Session.user_id == target.id, Session.revoked.is_(False))
        .values(revoked=True)
    )
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == target.id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )


async def action_report(
    db: AsyncSession, *, report: SocialReport, action: str, note: str | None, actor: User
) -> SocialReport:
    now = _utcnow()
    if action == "triage":
        if report.status != "new":
            raise APIError(422, "invalid_report_state", "فقط گزارش تازه را می‌توان triage کرد")
        report.status = "triaged"
        report.triaged_at = now
    elif action == "dismiss":
        report.status = "dismissed"
        report.actioned_at = now
    elif action == "remove_content":
        await _remove_reported_content(db, report)
        report.status = "actioned"
        report.actioned_at = now
    elif action == "warn_user":
        report.status = "actioned"
        report.actioned_at = now
        # اعلان اخطار به نویسندهٔ محتوا/کاربر گزارش‌شده (در صورت قابل‌شناسایی بودن)
        warned_id: uuid.UUID | None = None
        if report.target_type == "post":
            post = await db.get(SocialPost, report.target_id)
            warned_id = post.author_id if post else None
        elif report.target_type == "comment":
            comment = await db.get(SocialComment, report.target_id)
            warned_id = comment.author_id if comment else None
        elif report.target_type == "user":
            warned_id = report.target_id
        if warned_id:
            await notify_user(
                db,
                user_id=warned_id,
                notif_type="social.warning",
                title=_L("اخطار نظارت", "تحذير الإشراف", "Moderation warning"),
                body=note,
                data={"report_id": str(report.id)},
            )
    elif action == "ban_user":
        ban_id: uuid.UUID | None = None
        if report.target_type == "post":
            post = await db.get(SocialPost, report.target_id)
            ban_id = post.author_id if post else None
        elif report.target_type == "comment":
            comment = await db.get(SocialComment, report.target_id)
            ban_id = comment.author_id if comment else None
        elif report.target_type == "user":
            ban_id = report.target_id
        if ban_id:
            target_user = await db.get(User, ban_id)
            if target_user and not await _is_protected(db, target_user):
                target_user.is_active = False
                await _revoke_user_sessions(db, target_user)
        report.status = "actioned"
        report.actioned_at = now
    else:  # pragma: no cover — اعتبارسنجی Literal در اسکیما
        raise APIError(422, "invalid_action", "اقدام نامعتبر است")
    report.action = action
    report.note = note
    report.actioned_by = actor.id
    await db.flush()
    await db.commit()
    return report


# ---------------------------------------------------------------------------
# کلمات ممنوعه (مدیریت)
# ---------------------------------------------------------------------------


async def list_banned_words(db: AsyncSession) -> list[ModerationBannedWord]:
    rows = (
        await db.execute(
            select(ModerationBannedWord).order_by(ModerationBannedWord.created_at.asc())
        )
    ).scalars().all()
    return list(rows)


async def add_banned_word(
    db: AsyncSession, *, word: str, added_by: User
) -> ModerationBannedWord:
    cleaned = word.strip()
    if not cleaned:
        raise APIError(422, "empty_word", "واژه نمی‌تواند خالی باشد")
    exists = (
        await db.execute(
            select(ModerationBannedWord).where(ModerationBannedWord.word == cleaned)
        )
    ).scalar_one_or_none()
    if exists:
        raise APIError(409, "duplicate_banned_word", "این واژه قبلاً ثبت شده است")
    obj = ModerationBannedWord(word=cleaned, added_by=added_by.id)
    db.add(obj)
    await db.flush()
    await db.commit()
    return obj


async def delete_banned_word(db: AsyncSession, word_id: uuid.UUID) -> None:
    obj = await db.get(ModerationBannedWord, word_id)
    if not obj:
        raise APIError(404, "banned_word_not_found", "واژه یافت نشد")
    await db.delete(obj)
    await db.flush()
    await db.commit()


# ---------------------------------------------------------------------------
# اعلان‌ها (ذخیره‌سازی — وب/CRM از API می‌خوانند)
# ---------------------------------------------------------------------------


async def notify_user(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    notif_type: str,
    title: dict,
    body: str | None = None,
    data: dict | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        notif_type=notif_type,
        title=title,
        body=body,
        data=data,
    )
    db.add(notif)
    await db.flush()
    return notif


async def list_notifications(
    db: AsyncSession, user: User, *, cursor: str | None, limit: int
) -> tuple[list[Notification], str | None]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Notification.created_at < ts,
                and_(Notification.created_at == ts, Notification.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor


async def mark_notification_read(db: AsyncSession, user: User, notif_id: uuid.UUID) -> Notification:
    notif = await db.get(Notification, notif_id)
    if not notif or notif.user_id != user.id:
        raise APIError(404, "notification_not_found", "اعلان یافت نشد")
    if not notif.read_at:
        notif.read_at = _utcnow()
        await db.flush()
    return notif


async def unread_count(db: AsyncSession, user: User) -> int:
    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return int((await db.execute(stmt)).scalar_one())
