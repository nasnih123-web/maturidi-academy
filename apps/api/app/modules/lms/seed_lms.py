"""سید نمایشی LMS — فاز ۸ (idempotent).

یک برنامهٔ درسی نمایشی «آشنایی با فقه حنفی» با یک دورهٔ مقدماتی و سه درس کوتاه.
درس‌ها **هیچ متن فقهی اختراعی** ندارند: body هر درس فقط بلاک‌های ارجاع به
محتوای واقعیِ موجود در DB است (fiqh_topics / scholar_quotes / quiz_questions
تأییدشده). همهٔ رشته‌ها LocalizedText و همه‌چیز با برچسب «نمایشی» مشخص است.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Course,
    Curriculum,
    FiqhTopic,
    Lesson,
    Permission,
    QuizQuestion,
    Role,
    RolePermission,
    ScholarQuote,
)


def _L(fa: str, ar: str, en: str) -> dict:
    return {"fa": fa, "ar": ar, "en": en}


DEMO_CURRICULUM_FA = "آشنایی با فقه حنفی (نمایشی)"
DEMO_COURSE_FA = "گام‌های نخست در فقه حنفی (نمایشی)"


async def _get_or_create_permission(db: AsyncSession, key: str, description: str):
    perm = (
        await db.execute(select(Permission).where(Permission.key == key))
    ).scalar_one_or_none()
    if not perm:
        perm = Permission(key=key, description=description)
        db.add(perm)
        await db.flush()
    return perm


async def seed_lms_demo(db: AsyncSession) -> dict[str, int]:
    """idempotent: برنامهٔ درسی نمایشی تکراری ساخته نمی‌شود."""
    # مجوز LMS برای RBAC واقعی (§۲)
    perm = await _get_or_create_permission(
        db, "lms.manage", "مدیریت LMS — دوره‌ها، درس‌ها، هم‌گروهی‌ها (فاز ۸)"
    )
    super_admin = (
        await db.execute(select(Role).where(Role.name == "super_admin"))
    ).scalar_one_or_none()
    granted = 0
    if super_admin:
        exists = (
            await db.execute(
                select(RolePermission).where(
                    RolePermission.role_id == super_admin.id,
                    RolePermission.permission_id == perm.id,
                )
            )
        ).first()
        if not exists:
            db.add(
                RolePermission(role_id=super_admin.id, permission_id=perm.id)
            )
            granted = 1

    curricula = (await db.execute(select(Curriculum))).scalars().all()
    if any((c.title or {}).get("fa") == DEMO_CURRICULUM_FA for c in curricula):
        return {"curricula": 0, "courses": 0, "lessons": 0, "lms_permission_granted": granted}

    # ارجاع‌های واقعی به محتوای تأییدشدهٔ موجود — بدون اختراع محتوا
    topics = (
        await db.execute(
            select(FiqhTopic)
            .where(FiqhTopic.workflow_status.in_(("approved", "published")))
            .limit(3)
        )
    ).scalars().all()
    quotes = (
        await db.execute(select(ScholarQuote).limit(3))
    ).scalars().all()
    quiz_qs = (
        await db.execute(
            select(QuizQuestion)
            .where(QuizQuestion.workflow_status.in_(("approved", "published")))
            .limit(3)
        )
    ).scalars().all()

    curriculum = Curriculum(
        title=_L(
            DEMO_CURRICULUM_FA,
            "التعرف على الفقه الحنفي (تجريبي)",
            "Introduction to Hanafi Fiqh (demo)",
        ),
        description="برنامهٔ درسی نمایشی فاز ۸ — درس‌ها فقط به محتوای واقعی DB ارجاع می‌دهند.",
        sort_order=0,
        is_active=True,
    )
    db.add(curriculum)
    await db.flush()

    course = Course(
        curriculum_id=curriculum.id,
        title=_L(
            DEMO_COURSE_FA,
            "الخطوات الأولى في الفقه الحنفي (تجريبي)",
            "First Steps in Hanafi Fiqh (demo)",
        ),
        description=_L(
            "دورهٔ نمایشی: سه درس کوتاه با ارجاع به موضوعات فقهی و نقل‌قول‌های تأییدشدهٔ پلتفرم.",
            "دورة تجريبية: ثلاثة دروس قصيرة تشير إلى المواضيع الفقهية والاقتباسات المعتمدة.",
            "Demo course: three short lessons referencing the platform's approved fiqh topics and quotes.",
        ),
        level="beginner",
        visibility="public",
        sort_order=0,
        is_active=True,
    )
    db.add(course)
    await db.flush()

    def _topic_ref(i: int) -> dict:
        if i < len(topics):
            t = topics[i]
            return {
                "type": "fiqh_topic_ref",
                "topic_id": str(t.id),
                "title": t.title,
                "note": "ارجاع به موضوع فقهی تأییدشدهٔ موجود در پایگاه دانش (سید نمایشی)",
            }
        return {"type": "text", "text": _L("ارجاع نمایشی — موضوعی یافت نشد.", "مرجع تجريبي.", "Demo ref.")}

    def _quote_ref(i: int) -> dict:
        if i < len(quotes):
            q = quotes[i]
            return {
                "type": "scholar_quote_ref",
                "quote_id": str(q.id),
                "text": q.text,
                "scholar": q.scholar,
                "note": "نقل‌قول واقعی از محتوای پلتفرم (سید نمایشی)",
            }
        return {"type": "text", "text": _L("ارجاع نمایشی — نقل‌قولی یافت نشد.", "مرجع تجريبي.", "Demo ref.")}

    quiz_ref = {
        "type": "quiz_ref",
        "question_ids": [str(q.id) for q in quiz_qs],
        "note": "سؤال‌های واقعیِ تأییدشده برای آزمون درس (سید نمایشی)",
    }

    lesson_titles = [
        _L("درس ۱ — آشنایی با منابع فقهی (نمایشی)", "الدرس ١ — التعرف على المصادر (تجريبي)", "Lesson 1 — Sources (demo)"),
        _L("درس ۲ — نقل‌قول‌های علما (نمایشی)", "الدرس ٢ — اقتباسات العلماء (تجريبي)", "Lesson 2 — Scholar Quotes (demo)"),
        _L("درس ۳ — مرور و آزمون (نمایشی)", "الدرس ٣ — مراجعة واختبار (تجريبي)", "Lesson 3 — Review & Quiz (demo)"),
    ]
    bodies = [
        [_topic_ref(0), _quote_ref(0)],
        [_topic_ref(1), _quote_ref(1)],
        [_topic_ref(2), _quote_ref(2), quiz_ref],
    ]
    for i, (title, body) in enumerate(zip(lesson_titles, bodies)):
        db.add(
            Lesson(
                course_id=course.id,
                title=title,
                body=body,
                duration_minutes=5,
                sort_order=i,
                is_free_preview=(i == 0),
            )
        )
    await db.flush()
    return {
        "curricula": 1,
        "courses": 1,
        "lessons": 3,
        "lms_permission_granted": granted,
    }
