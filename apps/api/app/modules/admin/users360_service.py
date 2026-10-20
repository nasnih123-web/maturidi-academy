"""سرویس نمای ۳۶۰° کاربر — فاز ۱۴.

تجمیع فقط‌خواندنی از سرویس‌ها/جدول‌های موجود — هیچ نوشتن‌ای این‌جا انجام
نمی‌شود. مجوز: `users.view360`.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import ensure_aware
from app.core.errors import APIError
from app.models.models import (
    AuditLog,
    Certificate,
    ClusterMember,
    FatwaMessage,
    FatwaSession,
    FatwaSubmission,
    LibraryItem,
    Notification,
    QuestionCluster,
    Role,
    SocialComment,
    SocialPost,
    SocialReport,
    User,
    UserProgress,
    UserRole,
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _iso(dt) -> str | None:
    return ensure_aware(dt).isoformat() if dt is not None else None


async def get_overview(db: AsyncSession, user_id: uuid.UUID) -> dict:
    user = await db.get(User, user_id)
    if user is None:
        raise APIError(404, "not_found", "کاربر یافت نشد")

    roles = (
        await db.execute(
            select(Role.name).select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id == user.id)
        )
    ).scalars().all()

    # LMS
    prog_rows = (
        await db.execute(
            select(UserProgress.status, func.count())
            .where(UserProgress.user_id == user.id)
            .group_by(UserProgress.status)
        )
    ).all()
    certs = (
        await db.execute(
            select(Certificate).where(Certificate.user_id == user.id)
            .order_by(Certificate.issued_at.desc()).limit(10)
        )
    ).scalars().all()

    # کتابخانه
    lib_count = (
        await db.execute(
            select(func.count()).select_from(LibraryItem)
            .where(LibraryItem.created_by == user.id)
        )
    ).scalar_one()
    lib_recent = (
        await db.execute(
            select(LibraryItem).where(LibraryItem.created_by == user.id)
            .order_by(LibraryItem.created_at.desc()).limit(5)
        )
    ).scalars().all()

    # اجتماعی
    post_count = (
        await db.execute(
            select(func.count()).select_from(SocialPost)
            .where(SocialPost.author_id == user.id)
        )
    ).scalar_one()
    comment_count = (
        await db.execute(
            select(func.count()).select_from(SocialComment)
            .where(SocialComment.author_id == user.id)
        )
    ).scalar_one()
    reports_filed = (
        await db.execute(
            select(func.count()).select_from(SocialReport)
            .where(SocialReport.reported_by == user.id)
        )
    ).scalar_one()

    # فتوا
    fatwa_sessions = (
        await db.execute(
            select(func.count()).select_from(FatwaSession)
            .where(FatwaSession.user_id == user.id)
        )
    ).scalar_one()
    fatwa_messages = (
        await db.execute(
            select(func.count()).select_from(FatwaMessage)
            .where(FatwaMessage.session_id.in_(
                select(FatwaSession.id).where(FatwaSession.user_id == user.id)
            ))
        )
    ).scalar_one()
    submissions = (
        await db.execute(
            select(FatwaSubmission).where(FatwaSubmission.author_id == user.id)
            .order_by(FatwaSubmission.created_at.desc()).limit(10)
        )
    ).scalars().all()
    clusters_answered = (
        await db.execute(
            select(func.count()).select_from(QuestionCluster)
            .where(QuestionCluster.answered_by == user.id)
        )
    ).scalar_one()
    cluster_questions = (
        await db.execute(
            select(func.count()).select_from(ClusterMember)
            .where(ClusterMember.user_id == user.id)
        )
    ).scalar_one()

    # اعلان‌ها
    notifs = (
        await db.execute(
            select(Notification).where(Notification.user_id == user.id)
            .order_by(Notification.created_at.desc()).limit(10)
        )
    ).scalars().all()
    unread = (
        await db.execute(
            select(func.count()).select_from(Notification)
            .where(Notification.user_id == user.id,
                   Notification.read_at.is_(None))
        )
    ).scalar_one()

    # audit trail
    audits = (
        await db.execute(
            select(AuditLog).where(AuditLog.actor_id == user.id)
            .order_by(AuditLog.created_at.desc()).limit(20)
        )
    ).scalars().all()

    return {
        "profile": {
            "id": str(user.id), "full_name": user.full_name,
            "email": user.email, "phone": user.phone, "locale": user.locale,
            "is_active": user.is_active, "is_verified": user.is_verified,
            "created_at": _iso(user.created_at),
        },
        "roles": list(roles),
        "lms": {
            "progress_by_status": {s: c for s, c in prog_rows},
            "certificates": [
                {"id": str(c.id), "course_id": str(c.course_id),
                 "code": c.code, "issued_at": _iso(c.issued_at)} for c in certs
            ],
        },
        "library": {
            "items_created": lib_count,
            "recent": [{"id": str(i.id),
                        "title": (i.title or {}).get("fa") or "",
                        "kind": i.kind, "workflow_status": i.workflow_status,
                        "created_at": _iso(i.created_at)} for i in lib_recent],
        },
        "social": {
            "posts": post_count, "comments": comment_count,
            "reports_filed": reports_filed,
        },
        "fatwa": {
            "sessions": fatwa_sessions, "messages": fatwa_messages,
            "clusters_answered": clusters_answered,
            "cluster_questions_asked": cluster_questions,
            "submissions": [
                {"id": str(s.id),
                 "title": (s.title or {}).get("fa") or "",
                 "workflow_status": s.workflow_status,
                 "created_at": _iso(s.created_at)} for s in submissions
            ],
        },
        "notifications": {
            "unread": unread,
            "recent": [
                {"id": str(n.id), "notif_type": n.notif_type,
                 "title": (n.title or {}).get("fa") or "",
                 "read_at": _iso(n.read_at), "created_at": _iso(n.created_at)}
                for n in notifs
            ],
        },
        "audit_trail": [
            {"id": str(a.id), "action": a.action,
             "entity_type": a.entity_type, "entity_id": a.entity_id,
             "created_at": _iso(a.created_at)} for a in audits
        ],
        "generated_at": _utcnow().isoformat(),
    }
