"""سرویس LMS — فاز ۸. قرارداد §۱۵.۲: کل منطق کسب‌وکار اینجاست؛ router هرگز به DB دست نمی‌زند.

- آزمون درس از موتور فاز ۶ (`app.modules.fatwa.service.quiz_generate/quiz_submit`)
  استفادهٔ مجدد می‌کند — بدون کپی منطق (§۱۵.۲، ADR-0006).
- study_reports جدول نیست؛ گزارش از user_progress + quiz_attempts محاسبه می‌شود.
"""
from __future__ import annotations

import base64
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import ensure_aware
from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import (
    Certificate,
    CohortEnrollment,
    Course,
    CourseCohort,
    CoursePrerequisite,
    Curriculum,
    Lesson,
    QuizAttempt,
    User,
    UserProgress,
)
from app.modules.fatwa import service as fatwa_service
from app.modules.lms import certificates as cert_pdf
from app.modules.sync.service import record_entity_change

LEVEL_ORDER = ["beginner", "intermediate", "advanced"]
_DEFAULT_LOCALE = "fa"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _L(texts: dict | None, locale: str = _DEFAULT_LOCALE) -> str:
    """متن محلی‌شده برای PDF (fa/ar/en) — fallback به اولین موجود."""
    if not texts:
        return ""
    return texts.get(locale) or texts.get("fa") or next(iter(texts.values()), "")


# ---------- cursor pagination (§۱) ----------


def _encode_cursor(sort_order: int, lid: uuid.UUID) -> str:
    raw = json.dumps([sort_order, str(lid)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[int, uuid.UUID]:
    try:
        sort_order, lid = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return int(sort_order), uuid.UUID(lid)
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


# ---------- courses ----------


async def list_courses(
    db: AsyncSession,
    *,
    level: str | None = None,
    curriculum_id: uuid.UUID | None = None,
    include_private: bool = False,
    user_id: uuid.UUID | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[dict], str | None]:
    limit = max(1, min(limit, 100))
    stmt = (
        select(Course)
        .where(Course.is_active.is_(True))
        .order_by(Course.sort_order, Course.id)
    )
    if not include_private:
        stmt = stmt.where(Course.visibility == "public")
    if level:
        stmt = stmt.where(Course.level == level)
    if curriculum_id:
        stmt = stmt.where(Course.curriculum_id == curriculum_id)
    if cursor:
        s, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            (Course.sort_order > s)
            | ((Course.sort_order == s) & (Course.id > lid))
        )
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = _encode_cursor(last.sort_order, last.id)
        rows = rows[:limit]

    progress_map: dict[uuid.UUID, float] = {}
    if user_id:
        lesson_counts = {
            c.id: (
                await db.execute(
                    select(func.count(Lesson.id)).where(Lesson.course_id == c.id)
                )
            ).scalar()
            for c in rows
        }
        for c in rows:
            total = lesson_counts.get(c.id, 0) or 0
            if total:
                done = (
                    await db.execute(
                        select(func.count(UserProgress.id))
                        .join(Lesson, Lesson.id == UserProgress.lesson_id)
                        .where(
                            Lesson.course_id == c.id,
                            UserProgress.user_id == user_id,
                            UserProgress.status == "completed",
                        )
                    )
                ).scalar() or 0
                progress_map[c.id] = round(done / total * 100, 1)

    out = []
    for c in rows:
        total = (
            await db.execute(select(func.count(Lesson.id)).where(Lesson.course_id == c.id))
        ).scalar() or 0
        out.append(
            {
                "id": c.id,
                "curriculum_id": c.curriculum_id,
                "title": c.title,
                "description": c.description,
                "level": c.level,
                "visibility": c.visibility,
                "sort_order": c.sort_order,
                "is_active": c.is_active,
                "lesson_count": total,
                "progress_pct": progress_map.get(c.id),
            }
        )
    return out, next_cursor


async def get_course_detail(
    db: AsyncSession, course_id: uuid.UUID, user: User | None
) -> dict:
    course = await db.get(Course, course_id)
    if course is None or not course.is_active:
        raise APIError(404, "course_not_found", "دوره یافت نشد")
    lessons = (
        await db.execute(
            select(Lesson)
            .where(Lesson.course_id == course.id)
            .order_by(Lesson.sort_order, Lesson.id)
        )
    ).scalars().all()

    prog: dict[uuid.UUID, UserProgress] = {}
    if user:
        rows = (
            await db.execute(
                select(UserProgress).where(
                    UserProgress.user_id == user.id,
                    UserProgress.lesson_id.in_([l.id for l in lessons] or [uuid.uuid4()]),
                )
            )
        ).scalars().all()
        prog = {r.lesson_id: r for r in rows}

    lesson_out = [
        {
            "id": l.id,
            "course_id": l.course_id,
            "title": l.title,
            "body": l.body,
            "duration_minutes": l.duration_minutes,
            "sort_order": l.sort_order,
            "is_free_preview": l.is_free_preview,
            "status": prog[l.id].status if l.id in prog else None,
            "position_seconds": prog[l.id].position_seconds if l.id in prog else 0,
        }
        for l in lessons
    ]
    total = len(lessons)
    done = sum(1 for l in lessons if l.id in prog and prog[l.id].status == "completed")
    has_cert = False
    if user and total and done == total:
        has_cert = (
            await db.execute(
                select(Certificate.id).where(
                    Certificate.user_id == user.id, Certificate.course_id == course.id
                )
            )
        ).first() is not None
    return {
        "course": {
            "id": course.id,
            "curriculum_id": course.curriculum_id,
            "title": course.title,
            "description": course.description,
            "level": course.level,
            "visibility": course.visibility,
            "sort_order": course.sort_order,
            "is_active": course.is_active,
            "lesson_count": total,
            "progress_pct": round(done / total * 100, 1) if total else 0.0,
        },
        "lessons": lesson_out,
        "completed_lessons": done,
        "total_lessons": total,
        "progress_pct": round(done / total * 100, 1) if total else 0.0,
        "has_certificate": has_cert,
    }


# ---------- progress ----------


async def get_lesson(
    db: AsyncSession, lesson_id: uuid.UUID, user: User | None
) -> dict:
    """یک درس با شناسه — برای URLهای قابل‌اشتراک‌گذاری (نیازی به context دوره نیست)."""
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None:
        raise APIError(404, "lesson_not_found", "درس یافت نشد")
    course = await db.get(Course, lesson.course_id)
    if course is None or not course.is_active:
        raise APIError(404, "lesson_not_found", "درس یافت نشد")

    status: str | None = None
    position = 0
    if user:
        row = (
            await db.execute(
                select(UserProgress).where(
                    UserProgress.user_id == user.id,
                    UserProgress.lesson_id == lesson.id,
                )
            )
        ).scalar_one_or_none()
        if row:
            status, position = row.status, row.position_seconds

    ordered = (
        await db.execute(
            select(Lesson.id)
            .where(Lesson.course_id == course.id)
            .order_by(Lesson.sort_order, Lesson.id)
        )
    ).scalars().all()
    ids = list(ordered)
    idx = ids.index(lesson.id)
    return {
        "lesson": {
            "id": lesson.id,
            "course_id": lesson.course_id,
            "title": lesson.title,
            "body": lesson.body,
            "duration_minutes": lesson.duration_minutes,
            "sort_order": lesson.sort_order,
            "is_free_preview": lesson.is_free_preview,
            "status": status,
            "position_seconds": position,
            "prev_lesson_id": ids[idx - 1] if idx > 0 else None,
            "next_lesson_id": ids[idx + 1] if idx < len(ids) - 1 else None,
        },
        "course_visibility": course.visibility,
    }


async def update_progress(
    db: AsyncSession,
    user: User,
    lesson_id: uuid.UUID,
    *,
    status: str,
    position_seconds: int,
) -> dict:
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None:
        raise APIError(404, "lesson_not_found", "درس یافت نشد")

    prog = (
        await db.execute(
            select(UserProgress).where(
                UserProgress.user_id == user.id, UserProgress.lesson_id == lesson_id
            )
        )
    ).scalar_one_or_none()
    now = _utcnow()
    if prog is None:
        prog = UserProgress(user_id=user.id, lesson_id=lesson_id)
        db.add(prog)
    else:
        # فاز ۱۳: نسخهٔ خوش‌بینانه برای sync آفلاین
        prog.version = (prog.version or 1) + 1
    prog.status = status
    prog.position_seconds = max(0, position_seconds)
    prog.updated_at = now
    if status == "completed" and prog.completed_at is None:
        prog.completed_at = now
    if status != "completed":
        prog.completed_at = None
    await db.flush()
    # فاز ۱۳: ثبت در ژورنال sync تا pull دستگاه‌ها کامل بماند
    await record_entity_change(
        db, user_id=user.id, device_id="api",
        entity_type="user_progress", entity_id=str(lesson_id),
        op_type="upsert",
        payload={"lesson_id": str(lesson_id), "status": prog.status,
                 "position_seconds": prog.position_seconds,
                 "version": prog.version or 1},
        version=prog.version or 1,
    )

    course_completed = False
    certificate_code: str | None = None
    if status == "completed":
        await emit_event(
            db,
            aggregate_type="user_progress",
            aggregate_id=str(prog.id),
            event_type="lms.lesson_completed",
            payload={
                "user_id": str(user.id),
                "lesson_id": str(lesson_id),
                "course_id": str(lesson.course_id),
            },
        )
        cert = await _maybe_issue_certificate(db, user, lesson.course_id)
        if cert is not None:
            course_completed = True
            certificate_code = cert.code
    await db.commit()
    return {
        "lesson_id": lesson_id,
        "status": prog.status,
        "position_seconds": prog.position_seconds,
        "completed_at": prog.completed_at,
        "course_completed": course_completed,
        "certificate_code": certificate_code,
    }


async def prerequisites_satisfied(
    db: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> tuple[bool, list[uuid.UUID]]:
    """آیا کاربر همهٔ پیش‌نیازهای دوره را گذرانده؟ (گواهی برای هر پیش‌نیاز)"""
    required = (
        await db.execute(
            select(CoursePrerequisite.requires_course_id).where(
                CoursePrerequisite.course_id == course_id
            )
        )
    ).scalars().all()
    missing: list[uuid.UUID] = []
    for req in required:
        has = (
            await db.execute(
                select(Certificate.id).where(
                    Certificate.user_id == user_id, Certificate.course_id == req
                )
            )
        ).first()
        if not has:
            missing.append(req)
    return (not missing), missing


async def _maybe_issue_certificate(
    db: AsyncSession, user: User, course_id: uuid.UUID
) -> Certificate | None:
    """تکمیل همهٔ درس‌ها + زنجیرهٔ پیش‌نیاز → صدور خودکار گواهی (idempotent)."""
    lesson_ids = (
        await db.execute(select(Lesson.id).where(Lesson.course_id == course_id))
    ).scalars().all()
    if not lesson_ids:
        return None
    done = (
        await db.execute(
            select(func.count(UserProgress.id)).where(
                UserProgress.user_id == user.id,
                UserProgress.lesson_id.in_(lesson_ids),
                UserProgress.status == "completed",
            )
        )
    ).scalar() or 0
    if done < len(lesson_ids):
        return None

    ok, _missing = await prerequisites_satisfied(db, user.id, course_id)
    if not ok:
        return None

    existing = (
        await db.execute(
            select(Certificate).where(
                Certificate.user_id == user.id, Certificate.course_id == course_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return None  # قبلاً صادر شده — idempotent

    course = await db.get(Course, course_id)
    code = await _unique_cert_code(db)
    cert = Certificate(
        user_id=user.id,
        course_id=course_id,
        code=code,
        issued_at=_utcnow(),
        locale=user.locale or _DEFAULT_LOCALE,
    )
    db.add(cert)
    await db.flush()

    pdf_bytes = cert_pdf.render_certificate_pdf(
        holder_name=user.full_name,
        course_title_fa=_L(course.title, "fa"),
        course_title_ar=_L(course.title, "ar"),
        course_title_en=_L(course.title, "en"),
        code=code,
        issued_date_iso=cert.issued_at.date().isoformat(),
    )
    from app.core.storage import get_storage

    key = f"certificates/{code}.pdf"
    await get_storage().put_object(key, pdf_bytes, "application/pdf")
    cert.pdf_storage_ref = key
    await db.flush()

    await emit_event(
        db,
        aggregate_type="course",
        aggregate_id=str(course_id),
        event_type="lms.course_completed",
        payload={"user_id": str(user.id), "course_id": str(course_id)},
    )
    await emit_event(
        db,
        aggregate_type="certificate",
        aggregate_id=str(cert.id),
        event_type="lms.certificate_issued",
        payload={
            "user_id": str(user.id),
            "course_id": str(course_id),
            "code": code,
        },
    )
    return cert


async def _unique_cert_code(db: AsyncSession) -> str:
    for _ in range(5):
        code = f"MA-{_utcnow().year}-{secrets.token_hex(4).upper()}"
        exists = (
            await db.execute(select(Certificate.id).where(Certificate.code == code))
        ).first()
        if not exists:
            return code
    raise APIError(500, "cert_code_failed", "تولید کد یکتای گواهی ناموفق بود")


# ---------- lesson quiz (Phase-6 engine reuse — §۱۵.۲) ----------


async def generate_lesson_quiz(
    db: AsyncSession,
    user: User,
    lesson_id: uuid.UUID,
    *,
    count: int = 5,
    client_ip: str | None = None,
) -> dict:
    lesson = await db.get(Lesson, lesson_id)
    if lesson is None:
        raise APIError(404, "lesson_not_found", "درس یافت نشد")
    # موتور فاز ۶ — بدون کپی منطق؛ فقط برچسب lesson_id بعد از ساخت.
    data = await fatwa_service.quiz_generate(
        db, user, count=count, locale=user.locale or _DEFAULT_LOCALE, client_ip=client_ip
    )
    attempt = await db.get(QuizAttempt, data["attempt_id"])
    attempt.lesson_id = lesson_id
    await db.commit()
    return data


async def submit_lesson_quiz(
    db: AsyncSession,
    user: User,
    *,
    attempt_id: uuid.UUID,
    answers: dict[str, int],
) -> dict:
    attempt = await db.get(QuizAttempt, attempt_id)
    if attempt is None or attempt.lesson_id is None:
        raise APIError(404, "lms_attempt_not_found", "تلاش آزمون درس یافت نشد")
    # مالکیت و نمره‌دهی همان موتور فاز ۶.
    return await fatwa_service.quiz_submit(
        db, user, attempt_id=attempt_id, answers=answers
    )


# ---------- reports & recommendations (computed — ADR-0006) ----------


async def _course_lesson_ids(db: AsyncSession, course_id: uuid.UUID) -> list[uuid.UUID]:
    return (
        await db.execute(select(Lesson.id).where(Lesson.course_id == course_id))
    ).scalars().all()


async def _quiz_stats(
    db: AsyncSession, user_id: uuid.UUID, lesson_ids: list[uuid.UUID]
) -> tuple[float | None, int]:
    if not lesson_ids:
        return None, 0
    rows = (
        await db.execute(
            select(QuizAttempt.score).where(
                QuizAttempt.user_id == user_id,
                QuizAttempt.lesson_id.in_(lesson_ids),
                QuizAttempt.answers != {},
            )
        )
    ).scalars().all()
    if not rows:
        return None, 0
    return round(sum(rows) / len(rows), 1), len(rows)


def _streak_days(progresses: list[UserProgress]) -> int:
    days = sorted(
        {ensure_aware(p.updated_at).date() for p in progresses}, reverse=True
    )
    if not days:
        return 0
    streak = 0
    expected = days[0]  # از آخرین روز فعالیت به عقب
    for d in days:
        if d == expected:
            streak += 1
            expected -= timedelta(days=1)
        elif d < expected:
            break
    return streak


async def study_report(db: AsyncSession, user: User) -> dict:
    progresses = (
        await db.execute(select(UserProgress).where(UserProgress.user_id == user.id))
    ).scalars().all()
    completed_by_lesson = {
        p.lesson_id for p in progresses if p.status == "completed"
    }

    # دوره‌هایی که کاربر با آن‌ها تعامل داشته
    lesson_ids = [p.lesson_id for p in progresses]
    course_ids: list[uuid.UUID] = []
    if lesson_ids:
        course_ids = (
            await db.execute(
                select(Lesson.course_id)
                .where(Lesson.id.in_(lesson_ids))
                .distinct()
            )
        ).scalars().all()

    courses_out = []
    total_done = 0
    total_lessons = 0
    quiz_avgs: list[float] = []
    for cid in course_ids:
        course = await db.get(Course, cid)
        if course is None:
            continue
        lids = await _course_lesson_ids(db, cid)
        done = sum(1 for lid in lids if lid in completed_by_lesson)
        quiz_avg, quiz_n = await _quiz_stats(db, user.id, lids)
        total_done += done
        total_lessons += len(lids)
        if quiz_avg is not None:
            quiz_avgs.append(quiz_avg)
        courses_out.append(
            {
                "course_id": cid,
                "course_title": course.title,
                "level": course.level,
                "total_lessons": len(lids),
                "completed_lessons": done,
                "progress_pct": round(done / len(lids) * 100, 1) if lids else 0.0,
                "quiz_avg": quiz_avg,
                "quiz_attempts": quiz_n,
            }
        )
    courses_out.sort(key=lambda c: -c["progress_pct"])
    quiz_overall_avg = (
        round(sum(quiz_avgs) / len(quiz_avgs), 1) if quiz_avgs else None
    )
    return {
        "courses": courses_out,
        "total_completed_lessons": total_done,
        "total_lessons": total_lessons,
        "overall_progress_pct": round(total_done / total_lessons * 100, 1)
        if total_lessons
        else 0.0,
        "quiz_overall_avg": quiz_overall_avg,
        "streak_days": _streak_days(list(progresses)),
    }


async def recommendations(db: AsyncSession, user: User, limit: int = 10) -> list[dict]:
    """قوانین پیشنهاد (مستند در ADR-0006):
    ۱) سطح کاربر = سطح آخرین دورهٔ فعال او (پیش‌فرض beginner).
    ۲) دروس ناتمام همان سطح، به ترتیب (sort_order دوره، sort_order درس).
    ۳) دروس دوره‌هایی که پیش‌نیازشان برآورده نشده رد می‌شوند.
    ۴) اگر جا ماند، از سطح بعدی (beginner→intermediate→advanced).
    """
    limit = max(1, min(limit, 50))
    progresses = (
        await db.execute(
            select(UserProgress, Lesson.course_id)
            .join(Lesson, Lesson.id == UserProgress.lesson_id)
            .where(UserProgress.user_id == user.id)
            .order_by(UserProgress.updated_at.desc())
        )
    ).all()
    completed = {p.lesson_id for p, _ in progresses if p.status == "completed"}

    user_level = "beginner"
    if progresses:
        last_course_id = progresses[0][1]
        last_course = await db.get(Course, last_course_id)
        if last_course:
            user_level = last_course.level

    level_idx = LEVEL_ORDER.index(user_level) if user_level in LEVEL_ORDER else 0
    ordered_levels = LEVEL_ORDER[level_idx:] + LEVEL_ORDER[:level_idx]

    out: list[dict] = []
    seen_lessons: set[uuid.UUID] = set()
    for idx, level in enumerate(ordered_levels):
        courses = (
            await db.execute(
                select(Course)
                .where(
                    Course.is_active.is_(True),
                    Course.visibility == "public",
                    Course.level == level,
                )
                .order_by(Course.sort_order, Course.id)
            )
        ).scalars().all()
        for course in courses:
            ok, _ = await prerequisites_satisfied(db, user.id, course.id)
            if not ok:
                continue
            lessons = (
                await db.execute(
                    select(Lesson)
                    .where(Lesson.course_id == course.id)
                    .order_by(Lesson.sort_order, Lesson.id)
                )
            ).scalars().all()
            for lesson in lessons:
                if lesson.id in completed or lesson.id in seen_lessons:
                    continue
                seen_lessons.add(lesson.id)
                reason = "level_next_incomplete" if idx == 0 else "next_level"
                out.append(
                    {
                        "lesson": {
                            "id": lesson.id,
                            "course_id": lesson.course_id,
                            "title": lesson.title,
                            "body": lesson.body,
                            "duration_minutes": lesson.duration_minutes,
                            "sort_order": lesson.sort_order,
                            "is_free_preview": lesson.is_free_preview,
                            "status": None,
                            "position_seconds": 0,
                        },
                        "course_title": course.title,
                        "level": level,
                        "reason": reason,
                    }
                )
                if len(out) >= limit:
                    return out
    return out


# ---------- cohorts ----------


async def list_cohorts(
    db: AsyncSession,
    user: User | None,
    *,
    course_id: uuid.UUID | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[dict], str | None]:
    limit = max(1, min(limit, 100))
    stmt = select(CourseCohort).order_by(CourseCohort.starts_at, CourseCohort.id)
    if course_id:
        stmt = stmt.where(CourseCohort.course_id == course_id)
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = _encode_cursor(0, rows[-1].id)  # کرسر ساده بر اساس id

    out = []
    for c in rows:
        enrolled = (
            await db.execute(
                select(func.count(CohortEnrollment.id)).where(
                    CohortEnrollment.cohort_id == c.id,
                    CohortEnrollment.status == "active",
                )
            )
        ).scalar() or 0
        mine = False
        if user:
            mine = (
                await db.execute(
                    select(CohortEnrollment.id).where(
                        CohortEnrollment.cohort_id == c.id,
                        CohortEnrollment.user_id == user.id,
                        CohortEnrollment.status == "active",
                    )
                )
            ).first() is not None
        out.append(
            {
                "id": c.id,
                "course_id": c.course_id,
                "title": c.title,
                "starts_at": c.starts_at,
                "ends_at": c.ends_at,
                "max_seats": c.max_seats,
                "is_open": c.is_open,
                "enrolled_count": enrolled,
                "seats_left": max(0, c.max_seats - enrolled),
                "user_enrolled": mine,
            }
        )
    return out, next_cursor


async def enroll_cohort(db: AsyncSession, user: User, cohort_id: uuid.UUID) -> dict:
    cohort = await db.get(CourseCohort, cohort_id)
    if cohort is None:
        raise APIError(404, "cohort_not_found", "هم‌گروهی یافت نشد")
    now = _utcnow()
    if not cohort.is_open:
        raise APIError(409, "cohort_closed", "ثبت‌نام این هم‌گروهی بسته است")
    if now > ensure_aware(cohort.ends_at):
        raise APIError(409, "cohort_ended", "این هم‌گروهی به پایان رسیده است")

    existing = (
        await db.execute(
            select(CohortEnrollment).where(
                CohortEnrollment.cohort_id == cohort_id,
                CohortEnrollment.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None and existing.status == "active":
        raise APIError(409, "already_enrolled", "پیش‌تر در این هم‌گروهی ثبت‌نام کرده‌اید")

    enrolled = (
        await db.execute(
            select(func.count(CohortEnrollment.id)).where(
                CohortEnrollment.cohort_id == cohort_id,
                CohortEnrollment.status == "active",
            )
        )
    ).scalar() or 0
    if enrolled >= cohort.max_seats:
        raise APIError(409, "cohort_full", "ظرفیت این هم‌گروهی تکمیل است")

    ok, missing = await prerequisites_satisfied(db, user.id, cohort.course_id)
    if not ok:
        raise APIError(
            409,
            "prerequisite_not_met",
            "پیش‌نیازهای این دوره هنوز گذرانده نشده‌اند",
            details={"missing_course_ids": [str(m) for m in missing]},
        )

    try:
        if existing is not None:
            existing.status = "active"
            existing.enrolled_at = now
            enrollment = existing
        else:
            enrollment = CohortEnrollment(
                cohort_id=cohort_id, user_id=user.id, enrolled_at=now
            )
            db.add(enrollment)
        await db.flush()
        await emit_event(
            db,
            aggregate_type="cohort",
            aggregate_id=str(cohort_id),
            event_type="lms.cohort_enrolled",
            payload={
                "user_id": str(user.id),
                "cohort_id": str(cohort_id),
                "course_id": str(cohort.course_id),
            },
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise APIError(409, "already_enrolled", "پیش‌تر در این هم‌گروهی ثبت‌نام کرده‌اید")

    return {
        "cohort_id": cohort_id,
        "status": enrollment.status,
        "enrolled_at": enrollment.enrolled_at,
        "seats_left": max(0, cohort.max_seats - enrolled - 1),
    }


# ---------- certificates ----------


async def verify_certificate(db: AsyncSession, code: str) -> dict:
    code = (code or "").strip().upper()
    cert = (
        await db.execute(select(Certificate).where(Certificate.code == code))
    ).scalar_one_or_none()
    if cert is None:
        return {"valid": False, "code": code}
    holder = await db.get(User, cert.user_id)
    course = await db.get(Course, cert.course_id)
    return {
        "valid": True,
        "code": cert.code,
        "holder_name": holder.full_name if holder else None,
        "course_title": course.title if course else None,
        "issued_at": cert.issued_at,
        "locale": cert.locale,
    }


async def get_user_certificate(
    db: AsyncSession, user: User, course_id: uuid.UUID
) -> dict | None:
    cert = (
        await db.execute(
            select(Certificate).where(
                Certificate.user_id == user.id, Certificate.course_id == course_id
            )
        )
    ).scalar_one_or_none()
    if cert is None:
        return None
    course = await db.get(Course, course_id)
    return {
        "id": cert.id,
        "code": cert.code,
        "course_id": cert.course_id,
        "course_title": course.title if course else {},
        "issued_at": cert.issued_at,
        "download_url": f"/api/v1/lms/certificates/{cert.code}/download",
    }


# ---------- admin ----------


async def _get_or_404(db: AsyncSession, model, mid: uuid.UUID, name: str):
    row = await db.get(model, mid)
    if row is None:
        raise APIError(404, f"{name}_not_found", f"{name} یافت نشد")
    return row


async def admin_create_curriculum(db: AsyncSession, data: dict) -> Curriculum:
    row = Curriculum(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_update_curriculum(
    db: AsyncSession, mid: uuid.UUID, data: dict
) -> Curriculum:
    row = await _get_or_404(db, Curriculum, mid, "curriculum")
    for k, v in data.items():
        if v is not None:
            setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_create_course(db: AsyncSession, data: dict) -> Course:
    if data.get("curriculum_id"):
        await _get_or_404(db, Curriculum, data["curriculum_id"], "curriculum")
    row = Course(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_update_course(db: AsyncSession, mid: uuid.UUID, data: dict) -> Course:
    row = await _get_or_404(db, Course, mid, "course")
    for k, v in data.items():
        if v is not None:
            setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_create_lesson(db: AsyncSession, data: dict) -> Lesson:
    await _get_or_404(db, Course, data["course_id"], "course")
    row = Lesson(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_update_lesson(db: AsyncSession, mid: uuid.UUID, data: dict) -> Lesson:
    row = await _get_or_404(db, Lesson, mid, "lesson")
    for k, v in data.items():
        if v is not None:
            setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_create_cohort(db: AsyncSession, data: dict) -> CourseCohort:
    await _get_or_404(db, Course, data["course_id"], "course")
    if data["ends_at"] <= data["starts_at"]:
        raise APIError(422, "bad_cohort_window", "پایان هم‌گروهی باید بعد از شروع باشد")
    row = CourseCohort(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def admin_update_cohort(
    db: AsyncSession, mid: uuid.UUID, data: dict
) -> CourseCohort:
    row = await _get_or_404(db, CourseCohort, mid, "cohort")
    for k, v in data.items():
        if v is not None:
            setattr(row, k, v)
    if ensure_aware(row.ends_at) <= ensure_aware(row.starts_at):
        raise APIError(422, "bad_cohort_window", "پایان هم‌گروهی باید بعد از شروع باشد")
    await db.commit()
    await db.refresh(row)
    return row


async def _would_create_cycle(
    db: AsyncSession, course_id: uuid.UUID, requires_course_id: uuid.UUID
) -> bool:
    """آیا افزودن (course_id نیازمند requires_course_id) چرخه می‌سازد؟"""
    seen: set[uuid.UUID] = set()
    stack = [requires_course_id]
    while stack:
        cur = stack.pop()
        if cur == course_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        nxt = (
            await db.execute(
                select(CoursePrerequisite.requires_course_id).where(
                    CoursePrerequisite.course_id == cur
                )
            )
        ).scalars().all()
        stack.extend(nxt)
    return False


async def admin_add_prerequisite(
    db: AsyncSession, course_id: uuid.UUID, requires_course_id: uuid.UUID
) -> CoursePrerequisite:
    await _get_or_404(db, Course, course_id, "course")
    await _get_or_404(db, Course, requires_course_id, "required course")
    if course_id == requires_course_id:
        raise APIError(422, "self_prerequisite", "یک دوره نمی‌تواند پیش‌نیاز خودش باشد")
    if await _would_create_cycle(db, course_id, requires_course_id):
        raise APIError(422, "prerequisite_cycle", "این پیش‌نیاز چرخه می‌سازد")
    row = CoursePrerequisite(course_id=course_id, requires_course_id=requires_course_id)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise APIError(409, "prerequisite_exists", "این پیش‌نیاز قبلاً ثبت شده است")
    await db.refresh(row)
    return row


async def admin_remove_prerequisite(
    db: AsyncSession, course_id: uuid.UUID, requires_course_id: uuid.UUID
) -> None:
    row = (
        await db.execute(
            select(CoursePrerequisite).where(
                CoursePrerequisite.course_id == course_id,
                CoursePrerequisite.requires_course_id == requires_course_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise APIError(404, "prerequisite_not_found", "پیش‌نیاز یافت نشد")
    await db.delete(row)
    await db.commit()


# ---------- admin reads (CRM پیشخوان یادگیری) ----------


async def admin_list_courses(db: AsyncSession) -> list[Course]:
    """همهٔ دوره‌ها برای CRM (شامل غیرفعال‌ها)، مرتب بر اساس sort_order."""
    rows = (
        await db.execute(select(Course).order_by(Course.sort_order, Course.id))
    ).scalars().all()
    return list(rows)


async def admin_list_lessons(db: AsyncSession, course_id: uuid.UUID) -> list[Lesson]:
    await _get_or_404(db, Course, course_id, "course")
    rows = (
        await db.execute(
            select(Lesson)
            .where(Lesson.course_id == course_id)
            .order_by(Lesson.sort_order, Lesson.id)
        )
    ).scalars().all()
    return list(rows)


async def admin_list_cohorts(db: AsyncSession) -> list[dict]:
    """همهٔ هم‌گروهی‌ها برای CRM با شمار ثبت‌نام."""
    rows = (
        await db.execute(
            select(CourseCohort).order_by(CourseCohort.starts_at, CourseCohort.id)
        )
    ).scalars().all()
    out = []
    for c in rows:
        enrolled = (
            await db.execute(
                select(func.count(CohortEnrollment.id)).where(
                    CohortEnrollment.cohort_id == c.id,
                    CohortEnrollment.status == "active",
                )
            )
        ).scalar() or 0
        out.append(
            {
                "id": c.id,
                "course_id": c.course_id,
                "title": c.title,
                "starts_at": c.starts_at,
                "ends_at": c.ends_at,
                "max_seats": c.max_seats,
                "is_open": c.is_open,
                "enrolled_count": enrolled,
                "seats_left": max(0, c.max_seats - enrolled),
                "user_enrolled": False,
            }
        )
    return out


def _user_display(u: User) -> str:
    return u.full_name or u.email or u.phone or str(u.id)


async def admin_list_cohort_enrollments(
    db: AsyncSession, cohort_id: uuid.UUID
) -> list[dict]:
    await _get_or_404(db, CourseCohort, cohort_id, "cohort")
    rows = (
        await db.execute(
            select(CohortEnrollment, User)
            .join(User, User.id == CohortEnrollment.user_id)
            .where(CohortEnrollment.cohort_id == cohort_id)
            .order_by(CohortEnrollment.enrolled_at, CohortEnrollment.id)
        )
    ).all()
    return [
        {
            "id": e.id,
            "cohort_id": e.cohort_id,
            "user_id": e.user_id,
            "user_display": _user_display(u),
            "enrolled_at": e.enrolled_at,
            "status": e.status,
        }
        for e, u in rows
    ]


async def admin_list_certificates(db: AsyncSession, limit: int = 100) -> list[dict]:
    limit = max(1, min(limit, 500))
    rows = (
        await db.execute(
            select(Certificate, User, Course)
            .join(User, User.id == Certificate.user_id)
            .join(Course, Course.id == Certificate.course_id)
            .order_by(Certificate.issued_at.desc(), Certificate.id)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": cert.id,
            "code": cert.code,
            "user_id": cert.user_id,
            "user_display": _user_display(u),
            "course_id": cert.course_id,
            "course_title": course.title,
            "issued_at": cert.issued_at,
        }
        for cert, u, course in rows
    ]


async def admin_user_progress(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """نظارت ادمین بر پیشرفت یک کاربر: به‌ازای هر دوره، تکمیل درس‌به‌درس."""
    user = await db.get(User, user_id)
    if user is None:
        raise APIError(404, "user_not_found", "کاربر یافت نشد")
    progresses = (
        await db.execute(select(UserProgress).where(UserProgress.user_id == user_id))
    ).scalars().all()
    by_lesson = {p.lesson_id: p for p in progresses}
    lesson_ids = [p.lesson_id for p in progresses]
    course_ids: list[uuid.UUID] = []
    if lesson_ids:
        course_ids = (
            await db.execute(
                select(Lesson.course_id).where(Lesson.id.in_(lesson_ids)).distinct()
            )
        ).scalars().all()
    courses_out = []
    for cid in course_ids:
        course = await db.get(Course, cid)
        if course is None:
            continue
        lessons = await admin_list_lessons(db, cid)
        items = []
        done = 0
        for les in lessons:
            p = by_lesson.get(les.id)
            completed = p is not None and p.status == "completed"
            if completed:
                done += 1
            items.append(
                {
                    "lesson_id": les.id,
                    "lesson_title": les.title,
                    "sort_order": les.sort_order,
                    "completed": completed,
                    "completed_at": p.completed_at if p else None,
                }
            )
        total = len(lessons)
        courses_out.append(
            {
                "course_id": cid,
                "course_title": course.title,
                "total_lessons": total,
                "completed_lessons": done,
                "progress_pct": round(done / total * 100, 1) if total else 0.0,
                "lessons": items,
            }
        )
    courses_out.sort(key=lambda c: -c["progress_pct"])
    return {"user_id": user_id, "courses": courses_out}


async def admin_list_prerequisites(
    db: AsyncSession, course_id: uuid.UUID | None = None
) -> list[CoursePrerequisite]:
    stmt = select(CoursePrerequisite).order_by(
        CoursePrerequisite.course_id, CoursePrerequisite.requires_course_id
    )
    if course_id is not None:
        stmt = stmt.where(CoursePrerequisite.course_id == course_id)
    return list((await db.execute(stmt)).scalars().all())


# ---------- admin deletes ----------


async def admin_delete_curriculum(db: AsyncSession, mid: uuid.UUID) -> None:
    row = await _get_or_404(db, Curriculum, mid, "curriculum")
    # دوره‌ها یتیم نمی‌مانند — curriculum_id آن‌ها NULL می‌شود.
    await db.execute(
        update(Course).where(Course.curriculum_id == mid).values(curriculum_id=None)
    )
    await db.delete(row)
    await db.commit()


async def admin_delete_lesson(db: AsyncSession, mid: uuid.UUID) -> None:
    row = await _get_or_404(db, Lesson, mid, "lesson")
    await db.execute(delete(UserProgress).where(UserProgress.lesson_id == mid))
    await db.execute(
        update(QuizAttempt).where(QuizAttempt.lesson_id == mid).values(lesson_id=None)
    )
    await db.delete(row)
    await db.commit()


async def admin_delete_course(db: AsyncSession, mid: uuid.UUID) -> None:
    row = await _get_or_404(db, Course, mid, "course")
    cert_count = (
        await db.execute(
            select(func.count(Certificate.id)).where(Certificate.course_id == mid)
        )
    ).scalar() or 0
    if cert_count:
        raise APIError(
            409, "course_has_certificates", "دوره گواهی صادرشده دارد و حذف نمی‌شود"
        )
    lesson_ids = select(Lesson.id).where(Lesson.course_id == mid)
    await db.execute(delete(UserProgress).where(UserProgress.lesson_id.in_(lesson_ids)))
    await db.execute(
        update(QuizAttempt).where(QuizAttempt.lesson_id.in_(lesson_ids)).values(
            lesson_id=None
        )
    )
    await db.execute(delete(Lesson).where(Lesson.course_id == mid))
    await db.execute(
        delete(CoursePrerequisite).where(
            (CoursePrerequisite.course_id == mid)
            | (CoursePrerequisite.requires_course_id == mid)
        )
    )
    cohort_ids = select(CourseCohort.id).where(CourseCohort.course_id == mid)
    await db.execute(
        delete(CohortEnrollment).where(CohortEnrollment.cohort_id.in_(cohort_ids))
    )
    await db.execute(delete(CourseCohort).where(CourseCohort.course_id == mid))
    await db.delete(row)
    await db.commit()


async def admin_delete_cohort(db: AsyncSession, mid: uuid.UUID) -> None:
    row = await _get_or_404(db, CourseCohort, mid, "cohort")
    await db.execute(delete(CohortEnrollment).where(CohortEnrollment.cohort_id == mid))
    await db.delete(row)
    await db.commit()
