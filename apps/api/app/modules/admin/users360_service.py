"""سرویس نمای ۳۶۰° کاربر — فاز ۱۴.

تجمیع فقط‌خواندنی از سرویس‌ها/جدول‌های موجود — هیچ نوشتن‌ای این‌جا انجام
نمی‌شود. مجوز: `users.view360`.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import ensure_aware
from app.core.errors import APIError
from app.models.models import (
    AuditLog,
    Certificate,
    ClusterMember,
    Donation,
    FatwaMessage,
    FatwaSession,
    FatwaSubmission,
    HifzAttempt,
    HifzTasmiSession,
    HifzTest,
    LibraryItem,
    Notification,
    PasswordResetToken,
    QuestionCluster,
    Role,
    Session,
    SocialComment,
    SocialPost,
    SocialReport,
    User,
    UserProgress,
    UserRole,
)
from app.modules.admin.users_dashboard_service import device_block, effective_country
from app.modules.users.service import missing_profile_fields


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _iso(dt) -> str | None:
    return ensure_aware(dt).isoformat() if dt is not None else None


def _session_entry(sess: Session) -> dict:
    """یک نشست برای نمای ۳۶۰° — device_info همان UA خام هدر است."""
    block = device_block(sess.ip, sess.device_info, sess.last_active_at) or {
        "ip": sess.ip,
        "user_agent": sess.device_info,
        "browser": None,
        "os": None,
        "device": "unknown",
        "summary": None,
        "at": _iso(sess.last_active_at),
    }
    return {
        "id": str(sess.id),
        **block,
        "created_at": _iso(sess.created_at),
        "revoked": sess.revoked,
        "state": "revoked" if sess.revoked else "active",
    }


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

    # فاز C: وضعیت ثبت‌نام (نشانگر password_setup فاز A) + تکمیل پروفایل
    # (فاز B) + کشور مؤثر (پروفایل، وگرنه شمارهٔ تأییدشده).
    pending = (
        await db.execute(
            select(PasswordResetToken.id).where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.purpose == "password_setup",
                PasswordResetToken.used.is_(False),
            )
        )
    ).first() is not None
    missing_fields = missing_profile_fields(user)
    country_code, country_source = effective_country(user)

    # فاز C: نشست‌ها با IP و دستگاه (device_info = UA خام).
    sessions = (
        await db.execute(
            select(Session).where(Session.user_id == user.id)
            .order_by(Session.created_at.desc()).limit(50)
        )
    ).scalars().all()

    # فاز C: IP/مرورگر لحظهٔ ثبت‌نام — ردیف auditِ user.register.
    register_row = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.actor_id == user.id, AuditLog.action == "user.register")
            .order_by(AuditLog.created_at.asc()).limit(1)
        )
    ).scalars().first()

    # فاز C: حمایت‌های مالی کاربر (donations.donor_id).
    donation_count = (
        await db.execute(
            select(func.count()).select_from(Donation)
            .where(Donation.donor_id == user.id)
        )
    ).scalar_one()
    donation_total = (
        await db.execute(
            select(func.coalesce(func.sum(Donation.amount), 0))
            .where(Donation.donor_id == user.id, Donation.status == "succeeded")
        )
    ).scalar_one()
    donations_recent = (
        await db.execute(
            select(Donation).where(Donation.donor_id == user.id)
            .order_by(Donation.created_at.desc()).limit(10)
        )
    ).scalars().all()

    # فاز C: فعالیت حفظ — نشست تمرین، آزمون، تسمیع + آخرین تمرین‌ها.
    hifz_attempt_count = (
        await db.execute(
            select(func.count()).select_from(HifzAttempt)
            .where(HifzAttempt.user_id == user.id)
        )
    ).scalar_one()
    hifz_test_count = (
        await db.execute(
            select(func.count()).select_from(HifzTest)
            .where(HifzTest.user_id == user.id)
        )
    ).scalar_one()
    hifz_tasmi_count = (
        await db.execute(
            select(func.count()).select_from(HifzTasmiSession)
            .where(HifzTasmiSession.user_id == user.id)
        )
    ).scalar_one()
    hifz_recent = (
        await db.execute(
            select(HifzAttempt).where(HifzAttempt.user_id == user.id)
            .order_by(HifzAttempt.created_at.desc()).limit(5)
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

    # audit trail — هم کنش‌های خود کاربر، هم کنش‌های ادمین روی این کاربر
    audits = (
        await db.execute(
            select(AuditLog).where(
                or_(
                    AuditLog.actor_id == user.id,
                    and_(
                        AuditLog.entity_type == "user",
                        AuditLog.entity_id == str(user.id),
                    ),
                )
            )
            .order_by(AuditLog.created_at.desc()).limit(20)
        )
    ).scalars().all()

    return {
        "profile": {
            "id": str(user.id), "full_name": user.full_name,
            "email": user.email, "phone": user.phone, "locale": user.locale,
            "is_active": user.is_active, "is_verified": user.is_verified,
            "created_at": _iso(user.created_at),
            # فاز C: فیلدهای هویتی فاز B + وضعیت ثبت‌نام/پروفایل + کشور
            "date_of_birth": (
                user.date_of_birth.isoformat() if user.date_of_birth else None
            ),
            "gender": user.gender,
            "country_code": country_code,
            "country_source": country_source,
            "avatar_media_id": (
                str(user.avatar_media_id) if user.avatar_media_id else None
            ),
            "registration_status": "pending" if pending else "completed",
            "profile_complete": not missing_fields,
            "missing_profile_fields": missing_fields,
        },
        "roles": list(roles),
        # فاز C: لحظهٔ ثبت‌نام (IP + دستگاه از audit) و نشست‌ها
        "registration": (
            device_block(
                register_row.ip, register_row.user_agent, register_row.created_at
            )
            if register_row is not None
            else None
        ),
        "sessions": [_session_entry(s) for s in sessions],
        "donations": {
            "count": donation_count,
            "total_succeeded_irr": int(donation_total or 0),
            "recent": [
                {"id": str(d.id), "amount": d.amount, "currency": d.currency,
                 "gateway": d.gateway, "status": d.status,
                 "created_at": _iso(d.created_at)}
                for d in donations_recent
            ],
        },
        "hifz": {
            "attempts": hifz_attempt_count,
            "tests": hifz_test_count,
            "tasmi_sessions": hifz_tasmi_count,
            "recent_attempts": [
                {"id": str(a.id), "surah": a.surah, "status": a.status,
                 "engine": a.engine, "created_at": _iso(a.created_at)}
                for a in hifz_recent
            ],
        },
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
             "ip": a.ip, "user_agent": a.user_agent,
             "created_at": _iso(a.created_at)} for a in audits
        ],
        "generated_at": _utcnow().isoformat(),
    }
