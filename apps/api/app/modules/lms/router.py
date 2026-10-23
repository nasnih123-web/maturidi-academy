"""روترهای LMS — فاز ۸.

- router هرگز مستقیم به دیتابیس دسترسی ندارد (§۱۵.۶) — همه‌چیز از service.
- آزمون درس از اسکیماها و موتور فاز ۶ استفادهٔ مجدد می‌کند (بدون کپی).
- استعلام گواهی عمومی است اما rate-limited.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.rate_limit import get_rate_limiter
from app.core.storage import get_storage
from app.models.models import Permission, RolePermission, User, UserRole
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.fatwa.schemas import (
    QuizGenerateOut,
    QuizQuestionOut,
    QuizSubmitIn,
    QuizSubmitOut,
)
from app.modules.lms import service
from app.modules.lms.schemas import (
    CertificateAdminOut,
    CertificateOut,
    CertificateVerifyOut,
    CohortCreateIn,
    CohortEnrollmentAdminOut,
    CohortOut,
    CohortUpdateIn,
    CourseCreateIn,
    CourseDetailOut,
    CourseOut,
    CourseUpdateIn,
    CurriculumCreateIn,
    CurriculumOut,
    CurriculumUpdateIn,
    CursorPage,
    EnrollmentOut,
    LessonCreateIn,
    LessonOut,
    LessonUpdateIn,
    PrerequisiteCreateIn,
    PrerequisiteOut,
    ProgressIn,
    ProgressOut,
    RecommendationOut,
    StudyReportOut,
    UserProgressAdminOut,
)

lms_router = APIRouter(prefix="/api/v1/lms", tags=["lms"])
public_cert_router = APIRouter(prefix="/api/v1/certificates", tags=["certificates"])
admin_lms_router = APIRouter(prefix="/api/v1/admin/lms", tags=["admin-lms"])

_can_lms = require_permission("lms.manage")

_optional_bearer = HTTPBearer(auto_error=False)


async def _optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials, db)
    except APIError:
        return None


async def _is_lms_manager(db: AsyncSession, user: User) -> bool:
    stmt = (
        select(Permission.id)
        .select_from(UserRole)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(UserRole.user_id == user.id, Permission.key == "lms.manage")
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _course_out(c: dict) -> CourseOut:
    return CourseOut(**c)


def _lesson_out(item: dict) -> LessonOut:
    return LessonOut(**item)


def _cohort_out(c: dict) -> CohortOut:
    return CohortOut(**c)


# ---------- courses ----------


@lms_router.get("/courses", response_model=CursorPage)
async def list_courses(
    level: str | None = Query(default=None, pattern="^(beginner|intermediate|advanced)$"),
    curriculum_id: uuid.UUID | None = None,
    after: str | None = Query(default=None, description="کرسر صفحه‌بندی"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """فهرست دوره‌ها — cursor-based (§۱)؛ دوره‌های خصوصی فقط برای مدیر LMS."""
    include_private = bool(user and await _is_lms_manager(db, user))
    items, next_cursor = await service.list_courses(
        db,
        level=level,
        curriculum_id=curriculum_id,
        include_private=include_private,
        user_id=user.id if user else None,
        cursor=after,
        limit=limit,
    )
    return CursorPage(items=[_course_out(c) for c in items], next_cursor=next_cursor)


@lms_router.get("/courses/{course_id}", response_model=CourseDetailOut)
async def get_course(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    data = await service.get_course_detail(db, course_id, user)
    if data["course"]["visibility"] == "private" and not (
        user and await _is_lms_manager(db, user)
    ):
        raise APIError(404, "course_not_found", "دوره یافت نشد")
    return CourseDetailOut(
        course=_course_out(data["course"]),
        lessons=[_lesson_out(l) for l in data["lessons"]],
        completed_lessons=data["completed_lessons"],
        total_lessons=data["total_lessons"],
        progress_pct=data["progress_pct"],
        has_certificate=data["has_certificate"],
    )


# ---------- lesson (shareable URL) ----------


@lms_router.get("/lessons/{lesson_id}", response_model=LessonOut)
async def get_lesson(
    lesson_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """یک درس با شناسه — URL قابل‌اشتراک‌گذاری؛ درس دورهٔ خصوصی فقط برای مدیر LMS."""
    data = await service.get_lesson(db, lesson_id, user)
    if data["course_visibility"] == "private" and not (
        user and await _is_lms_manager(db, user)
    ):
        raise APIError(404, "lesson_not_found", "درس یافت نشد")
    return LessonOut(**data["lesson"])


# ---------- progress ----------


@lms_router.post("/lessons/{lesson_id}/progress", response_model=ProgressOut)
async def update_progress(
    lesson_id: uuid.UUID,
    body: ProgressIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """به‌روزرسانی موقعیت/وضعیت درس؛ تکمیل همهٔ درس‌ها → صدور خودکار گواهی."""
    data = await service.update_progress(
        db, user, lesson_id, status=body.status, position_seconds=body.position_seconds
    )
    return ProgressOut(**data)


# ---------- lesson quiz (Phase-6 engine) ----------


# نکتهٔ ترتیب: /quiz/submit باید قبل از /quiz/{lesson_id} تعریف شود
# وگرنه "submit" به‌عنوان lesson_id (UUID) parse می‌شود.


@lms_router.post("/quiz/submit", response_model=QuizSubmitOut)
async def submit_lesson_quiz(
    body: QuizSubmitIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await service.submit_lesson_quiz(
        db, user, attempt_id=body.attempt_id, answers=body.answers
    )
    return QuizSubmitOut(**data)


@lms_router.post("/quiz/{lesson_id}", response_model=QuizGenerateOut)
async def generate_lesson_quiz(
    request: Request,
    lesson_id: uuid.UUID,
    count: int = Query(default=5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """آزمون درس — موتور فاز ۶؛ attempt با lesson_id برچسب می‌خورد."""
    data = await service.generate_lesson_quiz(
        db, user, lesson_id, count=count, client_ip=_ip(request)
    )
    return QuizGenerateOut(
        attempt_id=data["attempt_id"],
        questions=[QuizQuestionOut(**q) for q in data["questions"]],
    )


# ---------- reports & recommendations ----------


@lms_router.get("/reports/me", response_model=StudyReportOut)
async def study_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """گزارش مطالعه — محاسبه‌شده از user_progress + quiz_attempts (نه جدول)."""
    return StudyReportOut(**await service.study_report(db, user))


@lms_router.get("/recommendations", response_model=list[RecommendationOut])
async def recommendations(
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await service.recommendations(db, user, limit=limit)
    return [
        RecommendationOut(
            lesson=_lesson_out(r["lesson"]),
            course_title=r["course_title"],
            level=r["level"],
            reason=r["reason"],
        )
        for r in items
    ]


# ---------- cohorts ----------


@lms_router.get("/cohorts", response_model=CursorPage)
async def list_cohorts(
    course_id: uuid.UUID | None = None,
    after: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    items, next_cursor = await service.list_cohorts(
        db, user, course_id=course_id, cursor=after, limit=limit
    )
    return CursorPage(items=[_cohort_out(c) for c in items], next_cursor=next_cursor)


@lms_router.post("/cohorts/{cohort_id}/enroll", response_model=EnrollmentOut)
async def enroll_cohort(
    cohort_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await service.enroll_cohort(db, user, cohort_id)
    return EnrollmentOut(**data)


# ---------- certificates ----------


@lms_router.get("/certificates/mine", response_model=CertificateOut | None)
async def my_certificate(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await service.get_user_certificate(db, user, course_id)
    return CertificateOut(**data) if data else None


@lms_router.get("/certificates/{code}/download")
async def download_certificate(
    code: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """دانلود PDF گواهی — فقط دارنده یا مدیر LMS (§۶: بدون URL عمومی قابل‌حدس)."""
    from app.models.models import Certificate

    cert = (
        await db.execute(
            select(Certificate).where(Certificate.code == code.strip().upper())
        )
    ).scalar_one_or_none()
    if cert is None or not cert.pdf_storage_ref:
        raise APIError(404, "certificate_not_found", "گواهی یافت نشد")
    if cert.user_id != user.id and not await _is_lms_manager(db, user):
        raise APIError(403, "forbidden", "دسترسی کافی نیست")
    storage = get_storage()
    read_bytes = getattr(storage, "read_bytes", None)
    if read_bytes is None:
        raise APIError(501, "download_unsupported", "دانلود در این provider پشتیبانی نمی‌شود")
    data = await read_bytes(cert.pdf_storage_ref)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="certificate-{cert.code}.pdf"'},
    )


@lms_router.get("/certificates/download-by-ref")
async def download_certificate_by_ref(
    key: str,
    exp: int,
    sig: str,
    purpose: str = "",
    db: AsyncSession = Depends(get_db),
):
    """دانلود با URL امضاشدهٔ کوتاه‌مدت (§۶) — امضا جای احراز هویت را می‌گیرد.

    FIX2-08: پیش از این هر امضای معتبر برای هر کلیدی پذیرفته می‌شد.
    حالا دو شرط اضافه است: (۱) امضا باید هم‌منظور گواهی باشد
    (purpose=lms-certificate)؛ (۲) کلید باید واقعاً pdf_storage_ref
    یک رکورد Certificate در دیتابیس باشد — کلیدِ فایل دیگری (کتابخانه،
    صدا، بیلد) با امضای خودش هم از این در رد می‌شود.
    """
    from app.core.storage import SIGNED_PURPOSE_CERTIFICATE
    from app.models.models import Certificate

    storage = get_storage()
    verify = getattr(storage, "verify_download_sig", None)
    read_bytes = getattr(storage, "read_bytes", None)
    if (
        verify is None
        or read_bytes is None
        or purpose != SIGNED_PURPOSE_CERTIFICATE
        or not verify(key, exp, sig, purpose)
    ):
        raise APIError(403, "invalid_signature", "امضای دانلود نامعتبر یا منقضی است")
    cert = (
        await db.execute(
            select(Certificate).where(Certificate.pdf_storage_ref == key)
        )
    ).scalar_one_or_none()
    if cert is None:
        raise APIError(404, "certificate_not_found", "گواهی یافت نشد")
    data = await read_bytes(key)
    return Response(content=data, media_type="application/pdf")


async def _verify_impl(request: Request, code: str, db: AsyncSession) -> CertificateVerifyOut:
    ip = _ip(request) or "unknown"
    # FIX3-03 (ADR-0050): استعلام عمومی گواهی روی limiter توزیع‌شده
    # (Redis) است — سقف ۳۰/دقیقه سقفِ کل سیستم است، نه هر worker.
    # auth=True: در production با Redisِ قطع fail-closed (429).
    if not await get_rate_limiter().is_allowed(
        f"cert_verify:{ip}", limit=30, window_s=60, auth=True
    ):
        raise APIError(429, "rate_limited", "تعداد درخواست بیش از حد مجاز است")
    return CertificateVerifyOut(**await service.verify_certificate(db, code))


@public_cert_router.get("/{code}/verify", response_model=CertificateVerifyOut)
async def verify_certificate_public(
    request: Request,
    code: str,
    db: AsyncSession = Depends(get_db),
):
    """استعلام عمومی اعتبار گواهی — بدون احراز هویت، rate-limited."""
    return await _verify_impl(request, code, db)


@lms_router.get("/certificates/{code}/verify", response_model=CertificateVerifyOut)
async def verify_certificate_alias(
    request: Request,
    code: str,
    db: AsyncSession = Depends(get_db),
):
    return await _verify_impl(request, code, db)


# ---------- admin ----------


@admin_lms_router.post("/curricula", response_model=CurriculumOut, status_code=201)
async def admin_create_curriculum(
    body: CurriculumCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    row = await service.admin_create_curriculum(db, body.model_dump())
    return CurriculumOut(
        id=row.id, title=row.title, description=row.description,
        sort_order=row.sort_order, is_active=row.is_active,
    )


@admin_lms_router.patch("/curricula/{mid}", response_model=CurriculumOut)
async def admin_update_curriculum(
    mid: uuid.UUID,
    body: CurriculumUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    row = await service.admin_update_curriculum(
        db, mid, body.model_dump(exclude_unset=True)
    )
    return CurriculumOut(
        id=row.id, title=row.title, description=row.description,
        sort_order=row.sort_order, is_active=row.is_active,
    )


@admin_lms_router.get("/curricula", response_model=list[CurriculumOut])
async def admin_list_curricula(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    from app.models.models import Curriculum

    rows = (
        await db.execute(select(Curriculum).order_by(Curriculum.sort_order, Curriculum.id))
    ).scalars().all()
    return [
        CurriculumOut(
            id=r.id, title=r.title, description=r.description,
            sort_order=r.sort_order, is_active=r.is_active,
        )
        for r in rows
    ]


def _course_admin_out(row) -> CourseOut:
    return CourseOut(
        id=row.id, curriculum_id=row.curriculum_id, title=row.title,
        description=row.description, level=row.level, visibility=row.visibility,
        sort_order=row.sort_order, is_active=row.is_active, lesson_count=0,
        progress_pct=None,
    )


@admin_lms_router.post("/courses", response_model=CourseOut, status_code=201)
async def admin_create_course(
    body: CourseCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    return _course_admin_out(await service.admin_create_course(db, body.model_dump()))


@admin_lms_router.patch("/courses/{mid}", response_model=CourseOut)
async def admin_update_course(
    mid: uuid.UUID,
    body: CourseUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    return _course_admin_out(
        await service.admin_update_course(db, mid, body.model_dump(exclude_unset=True))
    )


def _lesson_admin_out(row) -> LessonOut:
    return LessonOut(
        id=row.id, course_id=row.course_id, title=row.title, body=row.body,
        duration_minutes=row.duration_minutes, sort_order=row.sort_order,
        is_free_preview=row.is_free_preview, status=None, position_seconds=0,
    )


@admin_lms_router.post("/lessons", response_model=LessonOut, status_code=201)
async def admin_create_lesson(
    body: LessonCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    return _lesson_admin_out(await service.admin_create_lesson(db, body.model_dump()))


@admin_lms_router.patch("/lessons/{mid}", response_model=LessonOut)
async def admin_update_lesson(
    mid: uuid.UUID,
    body: LessonUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    return _lesson_admin_out(
        await service.admin_update_lesson(db, mid, body.model_dump(exclude_unset=True))
    )


@admin_lms_router.post("/cohorts", response_model=CohortOut, status_code=201)
async def admin_create_cohort(
    body: CohortCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    row = await service.admin_create_cohort(db, body.model_dump())
    return _cohort_out(
        {
            "id": row.id, "course_id": row.course_id, "title": row.title,
            "starts_at": row.starts_at, "ends_at": row.ends_at,
            "max_seats": row.max_seats, "is_open": row.is_open,
            "enrolled_count": 0, "seats_left": row.max_seats, "user_enrolled": False,
        }
    )


@admin_lms_router.patch("/cohorts/{mid}", response_model=CohortOut)
async def admin_update_cohort(
    mid: uuid.UUID,
    body: CohortUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    row = await service.admin_update_cohort(db, mid, body.model_dump(exclude_unset=True))
    return _cohort_out(
        {
            "id": row.id, "course_id": row.course_id, "title": row.title,
            "starts_at": row.starts_at, "ends_at": row.ends_at,
            "max_seats": row.max_seats, "is_open": row.is_open,
            "enrolled_count": 0, "seats_left": row.max_seats, "user_enrolled": False,
        }
    )


@admin_lms_router.post(
    "/prerequisites", response_model=PrerequisiteOut, status_code=201
)
async def admin_add_prerequisite(
    body: PrerequisiteCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    row = await service.admin_add_prerequisite(
        db, body.course_id, body.requires_course_id
    )
    return PrerequisiteOut(
        id=row.id, course_id=row.course_id, requires_course_id=row.requires_course_id
    )


@admin_lms_router.delete("/prerequisites", status_code=204)
async def admin_remove_prerequisite(
    course_id: uuid.UUID,
    requires_course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    await service.admin_remove_prerequisite(db, course_id, requires_course_id)


# ---------- admin reads & deletes (CRM پیشخوان یادگیری) ----------


@admin_lms_router.get("/courses", response_model=list[CourseOut])
async def admin_list_courses(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    rows = await service.admin_list_courses(db)
    return [_course_admin_out(r) for r in rows]


@admin_lms_router.get("/courses/{course_id}/lessons", response_model=list[LessonOut])
async def admin_list_lessons(
    course_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    rows = await service.admin_list_lessons(db, course_id)
    return [_lesson_admin_out(r) for r in rows]


@admin_lms_router.get("/cohorts", response_model=list[CohortOut])
async def admin_list_cohorts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    return [_cohort_out(c) for c in await service.admin_list_cohorts(db)]


@admin_lms_router.get(
    "/cohorts/{cohort_id}/enrollments", response_model=list[CohortEnrollmentAdminOut]
)
async def admin_list_cohort_enrollments(
    cohort_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    rows = await service.admin_list_cohort_enrollments(db, cohort_id)
    return [CohortEnrollmentAdminOut(**r) for r in rows]


@admin_lms_router.get("/users/{user_id}/progress", response_model=UserProgressAdminOut)
async def admin_user_progress(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    return UserProgressAdminOut(**await service.admin_user_progress(db, user_id))


@admin_lms_router.get("/certificates", response_model=list[CertificateAdminOut])
async def admin_list_certificates(
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    rows = await service.admin_list_certificates(db, limit=limit)
    return [CertificateAdminOut(**r) for r in rows]


@admin_lms_router.get("/prerequisites", response_model=list[PrerequisiteOut])
async def admin_list_prerequisites(
    course_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    rows = await service.admin_list_prerequisites(db, course_id)
    return [
        PrerequisiteOut(id=r.id, course_id=r.course_id, requires_course_id=r.requires_course_id)
        for r in rows
    ]


@admin_lms_router.delete("/curricula/{mid}", status_code=204)
async def admin_delete_curriculum(
    mid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    await service.admin_delete_curriculum(db, mid)


@admin_lms_router.delete("/courses/{mid}", status_code=204)
async def admin_delete_course(
    mid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    await service.admin_delete_course(db, mid)


@admin_lms_router.delete("/lessons/{mid}", status_code=204)
async def admin_delete_lesson(
    mid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    await service.admin_delete_lesson(db, mid)


@admin_lms_router.delete("/cohorts/{mid}", status_code=204)
async def admin_delete_cohort(
    mid: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_lms),
):
    await service.admin_delete_cohort(db, mid)
