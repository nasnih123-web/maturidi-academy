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
    HifzListenPosition,
    HifzTasmiSession,
    HifzTest,
    LibraryItem,
    MediaAsset,
    Notification,
    PasswordResetToken,
    QuestionCluster,
    Role,
    Session,
    SocialComment,
    SocialPost,
    SocialReport,
    User,
    UserActivityEvent,
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


async def _avatar_url(db: AsyncSession, user: User) -> str | None:
    """URL امضاشدهٔ کوتاه‌مدت عکس پروفایل — همان سازوکار کتابخانه (§۶).

    آواتار MediaAsset با visibility=public است ولی فایل خام هرگز URL
    عمومیِ قابل‌حدس ندارد؛ امضا هم‌منظور avatar است و endpoint
    /users/avatar-by-ref آن را بررسی می‌کند. هر خطای storage یعنی
    «عکس نیست» (None) — نمای ۳۶۰° نباید به‌خاطر عکس ۵۰۰ بدهد.
    """
    if user.avatar_media_id is None:
        return None
    asset = await db.get(MediaAsset, user.avatar_media_id)
    if asset is None:
        return None
    try:
        from app.core.storage import SIGNED_PURPOSE_AVATAR, get_storage

        storage = get_storage()
        return await storage.get_presigned_url(
            asset.storage_key,
            expires_seconds=3600,
            download_path="/api/v1/users/avatar-by-ref",
            purpose=SIGNED_PURPOSE_AVATAR,
        )
    except Exception:
        return None


def _excerpt(text: str | None, limit: int = 90) -> str:
    """برش کوتاه متن برای خط زمانی — بدون شکستن کلمه تا حد امکان."""
    if not text:
        return ""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def _activity_timeline(db: AsyncSession, user: User) -> list[dict]:
    """خط زمانی فعالیت کل سامانه — ادغام فقط‌خواندنی از همهٔ ماژول‌ها.

    هر رویداد: {kind, module, at, data}؛ رندر متن با CRM است (i18n).
    منابع: حساب/نشست، حفظ (نشست، آزمون، تسميع، شنیدن)، LMS (تکمیل
    درس، گواهی)، کتابخانه (آپلود)، اجتماعی (پست/نظر)، فتوا (پرسش
    خوشه‌ای، نشست، اثر ارسالی)، مالی (حمایت) و رویدادهای رفتاری
    ثبت‌شده (پخش صوت/ویدیو و…) از user_activity_events.
    """
    events: list[dict] = []

    def add(event_kind: str, module: str, at, **data) -> None:
        if at is not None:
            events.append(
                {"kind": event_kind, "module": module, "at": _iso(at), "data": data}
            )

    add("account_created", "account", user.created_at)

    sessions = (
        await db.execute(
            select(Session).where(Session.user_id == user.id)
            .order_by(Session.created_at.desc()).limit(10)
        )
    ).scalars().all()
    for s in sessions:
        block = device_block(s.ip, s.device_info, s.created_at) or {}
        add(
            "login", "account", s.created_at,
            summary=block.get("summary"), ip=s.ip,
        )

    attempts = (
        await db.execute(
            select(HifzAttempt).where(HifzAttempt.user_id == user.id)
            .order_by(HifzAttempt.created_at.desc()).limit(15)
        )
    ).scalars().all()
    for a in attempts:
        add(
            "hifz_attempt", "hifz", a.created_at,
            surah=a.surah, status=a.status, engine=a.engine,
        )

    tests = (
        await db.execute(
            select(HifzTest).where(HifzTest.user_id == user.id)
            .order_by(HifzTest.started_at.desc()).limit(10)
        )
    ).scalars().all()
    for t in tests:
        add(
            "hifz_test", "hifz", t.started_at,
            surah_start=t.surah_start, surah_end=t.surah_end, status=t.status,
        )

    tasmi = (
        await db.execute(
            select(HifzTasmiSession).where(HifzTasmiSession.user_id == user.id)
            .order_by(HifzTasmiSession.created_at.desc()).limit(10)
        )
    ).scalars().all()
    for ts in tasmi:
        add(
            "hifz_tasmi", "hifz", ts.created_at,
            start_surah=ts.start_surah, start_ayah=ts.start_ayah,
            end_surah=ts.end_surah, end_ayah=ts.end_ayah, status=ts.status,
        )

    listen = await db.get(HifzListenPosition, user.id)
    if listen is not None and listen.updated_at is not None:
        add(
            "hifz_listen", "hifz", listen.updated_at,
            surah=listen.surah, ayah=listen.ayah, reciter=listen.reciter,
            progress_ms=listen.progress_ms,
        )

    completed = (
        await db.execute(
            select(UserProgress).where(
                UserProgress.user_id == user.id,
                UserProgress.completed_at.is_not(None),
            )
            .order_by(UserProgress.completed_at.desc()).limit(10)
        )
    ).scalars().all()
    for p in completed:
        add("lms_completed", "lms", p.completed_at, lesson_id=str(p.lesson_id))

    certs = (
        await db.execute(
            select(Certificate).where(Certificate.user_id == user.id)
            .order_by(Certificate.issued_at.desc()).limit(5)
        )
    ).scalars().all()
    for c in certs:
        add("lms_certificate", "lms", c.issued_at, code=c.code)

    lib_items = (
        await db.execute(
            select(LibraryItem).where(LibraryItem.created_by == user.id)
            .order_by(LibraryItem.created_at.desc()).limit(10)
        )
    ).scalars().all()
    for i in lib_items:
        add(
            "library_upload", "library", i.created_at,
            title=(i.title or {}).get("fa") or "", kind=i.kind,
        )

    posts = (
        await db.execute(
            select(SocialPost).where(SocialPost.author_id == user.id)
            .order_by(SocialPost.created_at.desc()).limit(5)
        )
    ).scalars().all()
    for sp in posts:
        add("social_post", "social", sp.created_at, excerpt=_excerpt(sp.body))

    comments = (
        await db.execute(
            select(SocialComment).where(SocialComment.author_id == user.id)
            .order_by(SocialComment.created_at.desc()).limit(5)
        )
    ).scalars().all()
    for sc in comments:
        add("social_comment", "social", sc.created_at, excerpt=_excerpt(sc.body))

    questions = (
        await db.execute(
            select(ClusterMember).where(ClusterMember.user_id == user.id)
            .order_by(ClusterMember.created_at.desc()).limit(10)
        )
    ).scalars().all()
    for q in questions:
        add(
            "fatwa_question", "fatwa", q.created_at,
            excerpt=_excerpt(q.question_text), source=q.source,
        )

    fatwa_sessions_rows = (
        await db.execute(
            select(FatwaSession).where(FatwaSession.user_id == user.id)
            .order_by(FatwaSession.created_at.desc()).limit(5)
        )
    ).scalars().all()
    for fs in fatwa_sessions_rows:
        add("fatwa_session", "fatwa", fs.created_at)

    subs = (
        await db.execute(
            select(FatwaSubmission).where(FatwaSubmission.author_id == user.id)
            .order_by(FatwaSubmission.created_at.desc()).limit(5)
        )
    ).scalars().all()
    for sub in subs:
        add(
            "fatwa_submission", "fatwa", sub.created_at,
            title=(sub.title or {}).get("fa") or "",
            status=sub.workflow_status,
        )

    donations = (
        await db.execute(
            select(Donation).where(Donation.donor_id == user.id)
            .order_by(Donation.created_at.desc()).limit(10)
        )
    ).scalars().all()
    for d in donations:
        add(
            "donation", "finance", d.created_at,
            amount=d.amount, currency=d.currency,
            status=d.status, gateway=d.gateway,
        )

    recorded = (
        await db.execute(
            select(UserActivityEvent)
            .where(UserActivityEvent.user_id == user.id)
            .order_by(UserActivityEvent.created_at.desc()).limit(40)
        )
    ).scalars().all()
    for e in recorded:
        data = dict(e.meta or {})
        if e.title:
            data["title"] = e.title
        if e.ref_id:
            data["ref_id"] = e.ref_id
        module = "media" if e.kind.startswith("media_") else "library"
        add(e.kind, module, e.created_at, **data)

    events.sort(key=lambda e: e["at"] or "", reverse=True)
    return events[:80]


async def _activity_heatmap(db: AsyncSession, user: User) -> list[dict]:
    """نقشهٔ فعالیت ۸۴ روز اخیر: [{date, count}] صعودی، روزهای خالی صفر.

    شمارش از همان منابع خط زمانی است (نشست، حفظ، LMS، کتابخانه،
    اجتماعی، فتوا، مالی، رویدادهای رفتاری) — فقط ستون زمان خوانده
    می‌شود تا کوئری سبک بماند.
    """
    from datetime import timedelta

    today = _utcnow().date()
    start = today - timedelta(days=83)
    start_dt = datetime(start.year, start.month, start.day, tzinfo=UTC)
    counts: dict[str, int] = {}

    sources = (
        (Session.created_at, Session.user_id),
        (HifzAttempt.created_at, HifzAttempt.user_id),
        (HifzTest.started_at, HifzTest.user_id),
        (HifzTasmiSession.created_at, HifzTasmiSession.user_id),
        (UserProgress.updated_at, UserProgress.user_id),
        (Certificate.issued_at, Certificate.user_id),
        (LibraryItem.created_at, LibraryItem.created_by),
        (SocialPost.created_at, SocialPost.author_id),
        (SocialComment.created_at, SocialComment.author_id),
        (ClusterMember.created_at, ClusterMember.user_id),
        (FatwaSession.created_at, FatwaSession.user_id),
        (Donation.created_at, Donation.donor_id),
        (UserActivityEvent.created_at, UserActivityEvent.user_id),
    )
    for ts_col, user_col in sources:
        rows = (
            await db.execute(
                select(ts_col).where(user_col == user.id, ts_col >= start_dt)
            )
        ).scalars().all()
        for ts in rows:
            if ts is None:
                continue
            day = ensure_aware(ts).date().isoformat()
            counts[day] = counts.get(day, 0) + 1

    out: list[dict] = []
    for i in range(84):
        day = (start + timedelta(days=i)).isoformat()
        out.append({"date": day, "count": counts.get(day, 0)})
    return out


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

    avatar_url = await _avatar_url(db, user)
    activity_timeline = await _activity_timeline(db, user)
    activity_heatmap = await _activity_heatmap(db, user)

    # تجمیع رسانه/کتابخانه از رویدادهای رفتاری ثبت‌شده (پخش/دانلود)
    media_plays = (
        await db.execute(
            select(func.count()).select_from(UserActivityEvent)
            .where(
                UserActivityEvent.user_id == user.id,
                UserActivityEvent.kind == "media_play",
            )
        )
    ).scalar_one()
    media_downloads = (
        await db.execute(
            select(func.count()).select_from(UserActivityEvent)
            .where(
                UserActivityEvent.user_id == user.id,
                UserActivityEvent.kind == "library_download",
            )
        )
    ).scalar_one()
    progress_metas = (
        await db.execute(
            select(UserActivityEvent.meta).where(
                UserActivityEvent.user_id == user.id,
                UserActivityEvent.kind == "media_progress",
            )
        )
    ).scalars().all()
    media_seconds = 0
    for meta in progress_metas:
        if isinstance(meta, dict):
            delta = meta.get("seconds_delta")
            if isinstance(delta, (int, float)) and delta > 0:
                media_seconds += int(delta)

    return {
        "profile": {
            "id": str(user.id), "full_name": user.full_name,
            "email": user.email, "phone": user.phone, "locale": user.locale,
            "is_active": user.is_active, "is_verified": user.is_verified,
            "created_at": _iso(user.created_at),
            "avatar_url": avatar_url,
            "deleted_at": _iso(user.deleted_at),
            "deleted_by": str(user.deleted_by) if user.deleted_by else None,
            "is_trashed": user.deleted_at is not None,
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
            "enrolled": sum(c for _s, c in prog_rows),
            "completed": {s: c for s, c in prog_rows}.get("completed", 0),
            "certificates_count": len(certs),
            "certificates": [
                {"id": str(c.id), "course_id": str(c.course_id),
                 "code": c.code, "issued_at": _iso(c.issued_at)} for c in certs
            ],
        },
        "media": {
            "plays": media_plays,
            "seconds": media_seconds,
            "downloads": media_downloads,
        },
        "library": {
            "items_created": lib_count,
            "uploads": lib_count,
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
            "questions": cluster_questions,
            "answers": clusters_answered,
            "submissions_count": len(submissions),
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
        "activity_timeline": activity_timeline,
        "activity_heatmap": activity_heatmap,
        "generated_at": _utcnow().isoformat(),
    }
