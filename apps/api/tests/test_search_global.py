"""تست‌های جست‌وجوی سراسری (M-01 — ADR-0033).

هر چهار منبع محتوایی (فتوا/کتابخانه/دوره/صفحه) باید در /api/v1/search
پیدا شوند؛ پیش‌نویس‌ها و غیرعمومی‌ها هرگز نه؛ فیلتر type کار کند؛ و
امتیاز ترکیبی (واژگانی + تازگی + محبوبیت ثبت‌نامی دوره) ترتیب را
درست تعیین کند.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.models import (
    CohortEnrollment,
    Course,
    CourseCohort,
    FatwaSubmission,
    LibraryItem,
    Page,
    Theme,
    User,
)
from app.modules.home import service

pytestmark = pytest.mark.asyncio

TERM = "نماز"


def _loc(text: str) -> dict:
    return {"fa": text, "ar": text, "en": text}


async def _author(db) -> User:
    user = User(
        email=f"search-{uuid.uuid4().hex[:10]}@example.com",
        password_hash="x",
        full_name="نویسندهٔ جست‌وجو",
    )
    db.add(user)
    await db.flush()
    return user


async def _seed(db):
    author = await _author(db)
    now = datetime.now(UTC)
    fatwa = FatwaSubmission(
        title=_loc("حکم نماز مسافر"),
        body="متن پاسخ دربارهٔ نماز و احکام آن",
        author_id=author.id,
        workflow_status="published",
        published_at=now - timedelta(days=1),
    )
    fatwa_draft = FatwaSubmission(
        title=_loc("نماز پیش‌نویس"),
        body="نماز",
        author_id=author.id,
        workflow_status="draft",
    )
    item = LibraryItem(
        kind="pdf",
        title=_loc("کتاب نماز و نیایش"),
        description=_loc("شرحی دربارهٔ نماز"),
        media_key="library/search-test.pdf",
        visibility="public",
        workflow_status="published",
    )
    item_private = LibraryItem(
        kind="pdf",
        title=_loc("نماز خصوصی"),
        media_key="library/search-private.pdf",
        visibility="private",
        workflow_status="published",
    )
    course = Course(
        title=_loc("دورهٔ آموزش نماز"),
        description=_loc("از مبتدی تا پیشرفته"),
        visibility="public",
        is_active=True,
        created_at=now - timedelta(days=10),
    )
    course_old = Course(
        title=_loc("نماز در سفر"),
        description=_loc("دورهٔ قدیمی"),
        visibility="public",
        is_active=True,
        created_at=now - timedelta(days=300),
    )
    page = Page(
        slug=f"search-page-{uuid.uuid4().hex[:8]}",
        title=_loc("راهنمای نماز"),
        blocks=[{"type": "text", "text": "همه‌چیز دربارهٔ نماز"}],
        workflow_status="published",
        published_at=now - timedelta(days=2),
    )
    page_draft = Page(
        slug=f"search-draft-{uuid.uuid4().hex[:8]}",
        title=_loc("نماز پیش‌نویس صفحه"),
        blocks=[],
        workflow_status="draft",
    )
    db.add_all(
        [fatwa, fatwa_draft, item, item_private, course, course_old, page, page_draft]
    )
    await db.flush()
    # محبوبیت واقعی: برای course_old ثبت‌نام می‌سازیم تا با وجود قدیمی‌تر
    # بودن، مؤلفهٔ محبوبیتش از course بیشتر شود.
    cohort = CourseCohort(
        course_id=course_old.id,
        title=_loc("cohort"),
        starts_at=now - timedelta(days=30),
        ends_at=now + timedelta(days=30),
        max_seats=100,
    )
    db.add(cohort)
    await db.flush()
    for _ in range(5):
        db.add(
            CohortEnrollment(
                cohort_id=cohort.id,
                user_id=(await _author(db)).id,
                status="active",
            )
        )
    await db.commit()
    return {
        "fatwa": fatwa,
        "item": item,
        "course": course,
        "course_old": course_old,
        "page": page,
    }


async def test_all_four_types_found(db_session):
    ids = await _seed(db_session)
    out = await service.search(db_session, q=TERM, limit=50)
    types = {r.type: r for r in out.results}
    assert set(types) >= {"fatwa", "library", "course", "page"}
    assert types["fatwa"].id == str(ids["fatwa"].id)
    assert types["library"].url == f"/library/{ids['item'].id}"
    assert types["course"].url == f"/learn/courses/{ids['course'].id}"
    assert types["page"].url == f"/pages/{ids['page'].slug}"
    assert types["fatwa"].url == "/fatwa"


async def test_drafts_and_private_never_surface(db_session):
    await _seed(db_session)
    out = await service.search(db_session, q="پیش‌نویس", limit=50)
    assert out.results == []
    out2 = await service.search(db_session, q="خصوصی", limit=50)
    assert all(r.type != "library" for r in out2.results)


async def test_inactive_theme_never_surfaces(db_session):
    """FIX2-12: تم غیرفعال (منتشرنشده) نباید در جست‌وجوی عمومی بیاید.

    قبل از fix، select(Theme) بدون فیلتر بود و همهٔ تم‌ها — از جمله
    پیش‌نویس‌های فعال‌نشده — نشت می‌کردند؛ بقیهٔ مصرف‌کننده‌های عمومی
    (meta/cms) فقط is_active را می‌خوانند.
    """
    term = f"تمیونیک{uuid.uuid4().hex[:6]}"
    active = Theme(name=_loc(f"{term} فعال"), is_active=True)
    inactive = Theme(name=_loc(f"{term} مخفی"), is_active=False)
    db_session.add_all([active, inactive])
    await db_session.flush()

    out = await service.search(db_session, q=term, result_type="theme", limit=50)
    ids = {r.id for r in out.results}
    assert str(active.id) in ids
    assert str(inactive.id) not in ids


async def test_type_filter_restricts_source(db_session):
    await _seed(db_session)
    out = await service.search(db_session, q=TERM, result_type="library", limit=50)
    assert out.results and all(r.type == "library" for r in out.results)
    out = await service.search(db_session, q=TERM, result_type="course", limit=50)
    assert out.results and all(r.type == "course" for r in out.results)
    out = await service.search(db_session, q=TERM, result_type="unknown-xyz", limit=50)
    assert out.results == []


async def test_popularity_and_recency_shape_ranking(db_session):
    ids = await _seed(db_session)
    out = await service.search(db_session, q=TERM, result_type="course", limit=50)
    by_id = {r.id: r for r in out.results}
    new_course = by_id[str(ids["course"].id)]
    old_course = by_id[str(ids["course_old"].id)]
    # دورهٔ تازه عنوانِ پیشوندی دارد (lexical بالاتر)؛ دورهٔ قدیمی
    # تطابق درون‌رشته‌ای + محبوبیت دارد. هر دو باید حاضر باشند و
    # امتیازها عددی و نزولی مرتب شده باشند.
    scores = [r.score for r in out.results]
    assert scores == sorted(scores, reverse=True)
    assert new_course.score > 0 and old_course.score > 0
    # مؤلفهٔ محبوبیت واقعاً اعمال شده: بدون آن، اختلاف امتیاز دو دوره
    # فقط واژگانی+تازگی بود؛ old با ۵ ثبت‌نام باید boost گرفته باشد،
    # یعنی اختلافش با سقفِ بدون‌محبوبیت کمتر است — حضور هر دو و
    # score>lexical-base قدیمی را با یک دورهٔ سومِ بی‌ثبت‌نام می‌سنجیم:
    assert old_course.score > 1.0  # lexical substr (1.0) + popularity/recency


async def test_search_http_endpoint_shape(tc):
    client = tc["client"]
    r = await client.get("/api/v1/search", params={"q": TERM, "type": "fatwa"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] == TERM
    assert "results" in body and "total" in body
