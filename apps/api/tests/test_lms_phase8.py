"""تست‌های فاز ۸ (LMS) — پیشرفت، گواهی، هم‌گروهی، پیشنهادها، آزمون درس، RBAC."""
from __future__ import annotations

import uuid

from sqlalchemy import select


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...]):
    """کاربر تست + توکن؛ با مجوزهای داده‌شده (RBAC واقعی از جدول‌ها)."""
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role = Role(name=f"lms_test_role_{suffix}", description="lms test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست LMS",
            email=f"lms-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(user_id=str(user.id))
        return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


async def _make_course(tc, headers, level="beginner", n_lessons=3, **overrides):
    client = tc["client"]
    body = {
        "title": {"fa": f"دوره تست {_uid()}", "ar": "دورة تجريبية", "en": "Test course"},
        "description": {"fa": "توضیح", "ar": "وصف", "en": "Desc"},
        "level": level,
        "visibility": "public",
    }
    body.update(overrides)
    r = await client.post("/api/v1/admin/lms/courses", json=body, headers=headers)
    assert r.status_code == 201, r.text
    course = r.json()
    lessons = []
    for i in range(n_lessons):
        rl = await client.post(
            "/api/v1/admin/lms/lessons",
            json={
                "course_id": course["id"],
                "title": {"fa": f"درس {i}", "ar": f"درس {i}", "en": f"Lesson {i}"},
                "body": [],
                "duration_minutes": 5,
                "sort_order": i,
                "is_free_preview": i == 0,
            },
            headers=headers,
        )
        assert rl.status_code == 201, rl.text
        lessons.append(rl.json())
    return course, lessons


async def _complete_lesson(tc, headers, lesson_id):
    client = tc["client"]
    r = await client.post(
        f"/api/v1/lms/lessons/{lesson_id}/progress",
        json={"status": "completed", "position_seconds": 300},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# پیشرفت و جزئیات دوره
# ---------------------------------------------------------------------------


async def test_progress_tracking_and_course_detail(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    user = await _make_user(tc, ())
    course, lessons = await _make_course(tc, {"Authorization": admin["Authorization"]})

    r = await client.get(
        f"/api/v1/lms/courses/{course['id']}",
        headers={"Authorization": user["Authorization"]},
    )
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["total_lessons"] == 3
    assert detail["progress_pct"] == 0.0
    assert detail["has_certificate"] is False

    await _complete_lesson(tc, {"Authorization": user["Authorization"]}, lessons[0]["id"])

    r2 = await client.get(
        f"/api/v1/lms/courses/{course['id']}",
        headers={"Authorization": user["Authorization"]},
    )
    d2 = r2.json()
    assert d2["completed_lessons"] == 1
    assert d2["progress_pct"] == round(1 / 3 * 100, 1)
    assert d2["lessons"][0]["status"] == "completed"

    # موقعیت ذخیره می‌شود
    rp = await client.post(
        f"/api/v1/lms/lessons/{lessons[1]['id']}/progress",
        json={"status": "in_progress", "position_seconds": 90},
        headers={"Authorization": user["Authorization"]},
    )
    assert rp.json()["position_seconds"] == 90
    assert rp.json()["status"] == "in_progress"


async def test_courses_cursor_pagination(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    h = {"Authorization": admin["Authorization"]}
    for _ in range(3):
        await _make_course(tc, h, n_lessons=0)
    r1 = await client.get("/api/v1/lms/courses", params={"limit": 2})
    assert r1.status_code == 200, r1.text
    p1 = r1.json()
    assert len(p1["items"]) == 2
    assert p1["next_cursor"]
    r2 = await client.get(
        "/api/v1/lms/courses", params={"limit": 2, "after": p1["next_cursor"]}
    )
    p2 = r2.json()
    ids1 = {i["id"] for i in p1["items"]}
    ids2 = {i["id"] for i in p2["items"]}
    assert not (ids1 & ids2), "صفحه‌ها نباید هم‌پوشانی داشته باشند"


# ---------------------------------------------------------------------------
# تکمیل دوره → گواهی + استعلام عمومی
# ---------------------------------------------------------------------------


async def test_course_completion_issues_certificate(tc):
    from app.models.models import Certificate, DomainEvent

    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}
    course, lessons = await _make_course(tc, {"Authorization": admin["Authorization"]})

    last = None
    for lesson in lessons:
        last = await _complete_lesson(tc, uh, lesson["id"])
    assert last["course_completed"] is True
    code = last["certificate_code"]
    assert code and code.startswith("MA-")

    # گواهی در DB + PDF ذخیره شده
    async with tc["maker"]() as db:
        cert = (
            await db.execute(select(Certificate).where(Certificate.code == code))
        ).scalar_one_or_none()
        assert cert is not None
        assert cert.pdf_storage_ref and cert.pdf_storage_ref.endswith(".pdf")
        import os

        assert os.path.exists(os.path.join("./storage", cert.pdf_storage_ref)), (
            "فایل PDF گواهی باید در storage موجود باشد"
        )
        with open(os.path.join("./storage", cert.pdf_storage_ref), "rb") as fh:
            assert fh.read(4) == b"%PDF"

        # رویدادهای دامنه صادر شده‌اند (§۴)
        types = (
            await db.execute(
                select(DomainEvent.event_type).where(
                    DomainEvent.aggregate_id.in_(
                        [str(cert.course_id), str(cert.id)]
                    )
                )
            )
        ).scalars().all()
        assert "lms.course_completed" in types
        assert "lms.certificate_issued" in types

    # استعلام عمومی معتبر
    rv = await client.get(f"/api/v1/certificates/{code}/verify")
    assert rv.status_code == 200, rv.text
    body = rv.json()
    assert body["valid"] is True
    assert body["holder_name"] == "کاربر تست LMS"
    assert body["course_title"]["fa"].startswith("دوره تست")

    # alias زیر /api/v1/lms هم کار می‌کند
    rv2 = await client.get(f"/api/v1/lms/certificates/{code}/verify")
    assert rv2.json()["valid"] is True

    # کد نامعتبر → valid=false (نه ۴۰۴)
    rv3 = await client.get("/api/v1/certificates/MA-2099-DEADBEEF/verify")
    assert rv3.status_code == 200
    assert rv3.json()["valid"] is False

    # idempotent: تکمیل دوباره گواهی دوم نمی‌سازد
    again = await _complete_lesson(tc, uh, lessons[0]["id"])
    assert again["course_completed"] is False  # قبلاً صادر شده
    async with tc["maker"]() as db:
        n = (
            await db.execute(
                select(Certificate).where(Certificate.user_id == uuid.UUID(user["user_id"]))
            )
        ).scalars().all()
        assert len(n) == 1

    # دانلود PDF برای دارنده
    dl = await client.get(f"/api/v1/lms/certificates/{code}/download", headers=uh)
    assert dl.status_code == 200, dl.text
    assert dl.headers["content-type"] == "application/pdf"


async def test_prerequisite_blocks_certificate_and_enrollment(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}

    base, base_lessons = await _make_course(tc, ah, n_lessons=1)
    adv, adv_lessons = await _make_course(tc, ah, level="intermediate", n_lessons=1)

    # adv نیازمند base
    r = await client.post(
        "/api/v1/admin/lms/prerequisites",
        json={"course_id": adv["id"], "requires_course_id": base["id"]},
        headers=ah,
    )
    assert r.status_code == 201, r.text

    # تکمیل دورهٔ پیشرفته بدون گذراندن پایه → گواهی صادر نمی‌شود
    done = await _complete_lesson(tc, uh, adv_lessons[0]["id"])
    assert done["course_completed"] is False
    assert done["certificate_code"] is None

    # حالا پایه را هم بگذران → گواهی پایه صادر می‌شود
    await _complete_lesson(tc, uh, base_lessons[0]["id"])
    # و دورهٔ پیشرفته هم باید دوباره «تکمیل» حساب شود — چون همهٔ درس‌ها
    # تکمیل‌اند و پیش‌نیاز برآورده شده، فراخوان بعدی گواهی می‌دهد
    again = await _complete_lesson(tc, uh, adv_lessons[0]["id"])
    assert again["course_completed"] is True
    assert again["certificate_code"]

    # چرخه رد می‌شود: base نیازمند adv (درحالی‌که adv نیازمند base است)
    rc = await client.post(
        "/api/v1/admin/lms/prerequisites",
        json={"course_id": base["id"], "requires_course_id": adv["id"]},
        headers=ah,
    )
    assert rc.status_code == 422, rc.text
    assert rc.json()["error"]["code"] == "prerequisite_cycle"

    # خودارجاع رد می‌شود
    rs = await client.post(
        "/api/v1/admin/lms/prerequisites",
        json={"course_id": base["id"], "requires_course_id": base["id"]},
        headers=ah,
    )
    assert rs.status_code == 422
    assert rs.json()["error"]["code"] == "self_prerequisite"


# ---------------------------------------------------------------------------
# هم‌گروهی
# ---------------------------------------------------------------------------


async def _make_cohort(tc, headers, course_id, **overrides):
    from datetime import datetime, timedelta, timezone

    client = tc["client"]
    now = datetime.now(timezone.utc)
    body = {
        "course_id": course_id,
        "title": {"fa": f"هم‌گروهی {_uid()}", "ar": "مجموعة", "en": "Cohort"},
        "starts_at": (now + timedelta(days=7)).isoformat(),
        "ends_at": (now + timedelta(days=37)).isoformat(),
        "max_seats": 10,
        "is_open": True,
    }
    body.update(overrides)
    r = await client.post("/api/v1/admin/lms/cohorts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_cohort_enrollment_happy_path(tc):
    from app.models.models import DomainEvent

    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    user = await _make_user(tc, ())
    course, _ = await _make_course(tc, ah, n_lessons=1)
    cohort = await _make_cohort(tc, ah, course["id"])

    r = await client.post(
        f"/api/v1/lms/cohorts/{cohort['id']}/enroll",
        headers={"Authorization": user["Authorization"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["seats_left"] == 9

    # ثبت‌نام تکراری → ۴۰۹
    r2 = await client.post(
        f"/api/v1/lms/cohorts/{cohort['id']}/enroll",
        headers={"Authorization": user["Authorization"]},
    )
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "already_enrolled"

    # رویداد صادر شده
    async with tc["maker"]() as db:
        types = (
            await db.execute(
                select(DomainEvent.event_type).where(
                    DomainEvent.aggregate_id == cohort["id"]
                )
            )
        ).scalars().all()
        assert "lms.cohort_enrolled" in types

    # در فهرست، user_enrolled=true
    rl = await client.get(
        "/api/v1/lms/cohorts",
        params={"course_id": course["id"]},
        headers={"Authorization": user["Authorization"]},
    )
    assert rl.json()["items"][0]["user_enrolled"] is True


async def test_cohort_full_closed_and_prerequisite_blocked(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    u1 = await _make_user(tc, ())
    u2 = await _make_user(tc, ())

    # ظرفیت ۱
    course, _ = await _make_course(tc, ah, n_lessons=1)
    small = await _make_cohort(tc, ah, course["id"], max_seats=1)
    r1 = await client.post(
        f"/api/v1/lms/cohorts/{small['id']}/enroll",
        headers={"Authorization": u1["Authorization"]},
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/api/v1/lms/cohorts/{small['id']}/enroll",
        headers={"Authorization": u2["Authorization"]},
    )
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "cohort_full"

    # بسته
    closed = await _make_cohort(tc, ah, course["id"], is_open=False)
    r3 = await client.post(
        f"/api/v1/lms/cohorts/{closed['id']}/enroll",
        headers={"Authorization": u2["Authorization"]},
    )
    assert r3.status_code == 409
    assert r3.json()["error"]["code"] == "cohort_closed"

    # پیش‌نیاز برآورده‌نشده
    base, _ = await _make_course(tc, ah, n_lessons=1)
    adv, _ = await _make_course(tc, ah, level="intermediate", n_lessons=1)
    rp = await client.post(
        "/api/v1/admin/lms/prerequisites",
        json={"course_id": adv["id"], "requires_course_id": base["id"]},
        headers=ah,
    )
    assert rp.status_code == 201
    gated = await _make_cohort(tc, ah, adv["id"])
    r4 = await client.post(
        f"/api/v1/lms/cohorts/{gated['id']}/enroll",
        headers={"Authorization": u2["Authorization"]},
    )
    assert r4.status_code == 409
    assert r4.json()["error"]["code"] == "prerequisite_not_met"


# ---------------------------------------------------------------------------
# گزارش و پیشنهادها
# ---------------------------------------------------------------------------


async def test_study_report_computed(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}
    course, lessons = await _make_course(tc, ah, n_lessons=2)

    await _complete_lesson(tc, uh, lessons[0]["id"])
    r = await client.get("/api/v1/lms/reports/me", headers=uh)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["total_completed_lessons"] == 1
    assert rep["total_lessons"] == 2
    assert rep["overall_progress_pct"] == 50.0
    assert rep["streak_days"] >= 1
    assert len(rep["courses"]) == 1
    assert rep["courses"][0]["progress_pct"] == 50.0


async def test_recommendations_level_appropriate(tc):
    """مستقل از دادهٔ تست‌های دیگر: فقط روی درس‌های همین تست assert می‌کند."""
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}

    beg, beg_lessons = await _make_course(tc, ah, level="beginner", n_lessons=2)
    inter, inter_lessons = await _make_course(tc, ah, level="intermediate", n_lessons=2)
    beg_ids = {l["id"] for l in beg_lessons}
    inter_ids = {l["id"] for l in inter_lessons}

    # کاربر تازه → دروس مقدماتیِ همین دوره با دلیل سطح جاری، قبل از سطح بعدی
    r = await client.get("/api/v1/lms/recommendations", params={"limit": 50}, headers=uh)
    assert r.status_code == 200, r.text
    recs = r.json()
    rec_ids = [x["lesson"]["id"] for x in recs]
    assert beg_ids <= set(rec_ids), "همهٔ دروس مقدماتی باید پیشنهاد شوند"
    for x in recs:
        if x["lesson"]["id"] in beg_ids:
            assert x["level"] == "beginner"
            assert x["reason"] == "level_next_incomplete"
    first_inter = next(
        (i for i, x in enumerate(recs) if x["lesson"]["id"] in inter_ids), None
    )
    if first_inter is not None:
        assert all(
            recs[i]["lesson"]["id"] not in beg_ids for i in range(first_inter, len(recs))
        ), "درس سطح بعدی نباید قبل از دروس ناتمام سطح جاری بیاید"

    # بعد از اتمام مقدماتی → دروس تکمیل‌شده حذف، سطح بعدی با دلیل next_level
    for lesson in beg_lessons:
        await _complete_lesson(tc, uh, lesson["id"])
    r2 = await client.get(
        "/api/v1/lms/recommendations", params={"limit": 50}, headers=uh
    )
    recs2 = r2.json()
    rec2_ids = {x["lesson"]["id"] for x in recs2}
    assert not (beg_ids & rec2_ids), "درس تکمیل‌شده نباید پیشنهاد شود"
    assert inter_ids <= rec2_ids, "درس‌های سطح بعدی باید پیشنهاد شوند"
    for x in recs2:
        if x["lesson"]["id"] in inter_ids:
            assert x["reason"] == "next_level"


# ---------------------------------------------------------------------------
# آزمون درس از موتور فاز ۶
# ---------------------------------------------------------------------------


async def _make_approved_question(tc, admin_headers):
    """chunk تأییدشده + سؤال تأییدشده (الگوی test_fatwa_phase6)."""
    from app.models.models import QuizQuestion

    client = tc["client"]
    rc = await client.post(
        "/api/v1/admin/fatwa/chunks",
        json={
            "chunk_text": "متن chunk تأییدشده برای آزمون درس LMS",
            "source_type": "manual",
            "source_citation": {"fa": "منبع تست LMS"},
            "topic_category": "lms_test",
            "ai_scopes": ["fatwa", "quiz", "verification"],
        },
        headers=admin_headers,
    )
    assert rc.status_code == 201, rc.text
    chunk = rc.json()
    for target in ("in_review", "approved"):
        rp = await client.patch(
            f"/api/v1/admin/fatwa/chunks/{chunk['id']}/status",
            json={"status": target},
            headers=admin_headers,
        )
        assert rp.status_code == 200, rp.text
    rq = await client.post(
        "/api/v1/admin/fatwa/quiz/questions",
        json={
            "question_text": {"fa": "سؤال درس LMS؟"},
            "options": [{"fa": "الف"}, {"fa": "ب"}],
            "correct_option": 1,
            "source_chunk_id": chunk["id"],
            "difficulty": "easy",
        },
        headers=admin_headers,
    )
    assert rq.status_code == 201, rq.text
    qid = rq.json()["id"]
    async with tc["maker"]() as db:
        q = await db.get(QuizQuestion, uuid.UUID(qid))
        q.workflow_status = "approved"
        await db.commit()
    return qid


async def test_lesson_quiz_goes_through_phase6_engine(tc):
    from app.models.models import QuizAttempt, QuizQuestion
    from app.modules.fatwa.service import reset_ai_limits

    reset_ai_limits()
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage", "fatwa.approve", "knowledge.manage"))
    ah = {"Authorization": admin["Authorization"]}
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}

    await _make_approved_question(tc, ah)
    course, lessons = await _make_course(tc, ah, n_lessons=1)
    lesson_id = lessons[0]["id"]

    # کاربر درس را شروع کرده تا در گزارش بیاید
    rp = await client.post(
        f"/api/v1/lms/lessons/{lesson_id}/progress",
        json={"status": "in_progress", "position_seconds": 10},
        headers=uh,
    )
    assert rp.status_code == 200, rp.text

    gen = await client.post(f"/api/v1/lms/quiz/{lesson_id}", params={"count": 1}, headers=uh)
    assert gen.status_code == 200, gen.text
    attempt_id = gen.json()["attempt_id"]
    assert len(gen.json()["questions"]) == 1

    # attempt با lesson_id برچسب خورده (همان جدول فاز ۶)
    async with tc["maker"]() as db:
        attempt = await db.get(QuizAttempt, uuid.UUID(attempt_id))
        assert attempt is not None
        assert str(attempt.lesson_id) == lesson_id

    # submit از موتور فاز ۶ — پاسخ صحیح واقعی سؤال انتخاب‌شده (دیتابیس تست
    # بین فایل‌ها مشترک است و سؤال تصادفی ممکن است مال تست دیگری باشد)
    qid = gen.json()["questions"][0]["id"]
    async with tc["maker"]() as db:
        picked = await db.get(QuizQuestion, uuid.UUID(qid))
        correct = picked.correct_option
    sub = await client.post(
        "/api/v1/lms/quiz/submit",
        json={"attempt_id": attempt_id, "answers": {qid: correct}},
        headers=uh,
    )
    assert sub.status_code == 200, sub.text
    assert sub.json()["score"] == 100.0

    # گزارش، میانگین آزمون را نشان می‌دهد
    rep = await client.get("/api/v1/lms/reports/me", headers=uh)
    assert rep.json()["quiz_overall_avg"] == 100.0


# ---------------------------------------------------------------------------
# RBAC ادمین
# ---------------------------------------------------------------------------


async def test_admin_rbac(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    plain = await _make_user(tc, ())
    ah = {"Authorization": admin["Authorization"]}
    ph = {"Authorization": plain["Authorization"]}

    body = {"title": {"fa": "x", "ar": "x", "en": "x"}}

    r = await client.post("/api/v1/admin/lms/curricula", json=body)
    assert r.status_code == 401

    r2 = await client.post("/api/v1/admin/lms/curricula", json=body, headers=ph)
    assert r2.status_code == 403
    assert r2.json()["error"]["code"] == "forbidden"

    r3 = await client.post("/api/v1/admin/lms/curricula", json=body, headers=ah)
    assert r3.status_code == 201, r3.text
    assert r3.json()["title"]["fa"] == "x"


async def test_private_course_hidden_from_public_list(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    plain = await _make_user(tc, ())

    r = await client.post(
        "/api/v1/admin/lms/courses",
        json={
            "title": {"fa": "خصوصی", "ar": "خاص", "en": "Private"},
            "level": "beginner",
            "visibility": "private",
        },
        headers=ah,
    )
    assert r.status_code == 201
    pid = r.json()["id"]

    pub = await client.get(
        "/api/v1/lms/courses", headers={"Authorization": plain["Authorization"]}
    )
    assert all(i["id"] != pid for i in pub.json()["items"])

    adm = await client.get("/api/v1/lms/courses", headers=ah)
    assert any(i["id"] == pid for i in adm.json()["items"])


# ---------------------------------------------------------------------------
# خوانش‌ها و حذف‌های ادمین (CRM پیشخوان یادگیری)
# ---------------------------------------------------------------------------


async def test_admin_list_endpoints(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}

    rc = await client.post(
        "/api/v1/admin/lms/curricula",
        json={"title": {"fa": "ب", "ar": "ب", "en": "b"}, "description": "توضیح ب"},
        headers=ah,
    )
    assert rc.status_code == 201, rc.text
    cur = rc.json()
    assert cur["description"] == "توضیح ب"

    course, lessons = await _make_course(tc, ah, n_lessons=2)
    cohort = await _make_cohort(tc, ah, course["id"])

    rl = await client.get("/api/v1/admin/lms/courses", headers=ah)
    assert rl.status_code == 200, rl.text
    assert any(c["id"] == course["id"] for c in rl.json())

    rless = await client.get(
        f"/api/v1/admin/lms/courses/{course['id']}/lessons", headers=ah
    )
    assert rless.status_code == 200, rless.text
    assert len(rless.json()) == 2
    assert isinstance(rless.json()[0]["body"], list)

    rcoh = await client.get("/api/v1/admin/lms/cohorts", headers=ah)
    assert rcoh.status_code == 200, rcoh.text
    assert any(c["id"] == cohort["id"] for c in rcoh.json())

    rpre = await client.get("/api/v1/admin/lms/prerequisites", headers=ah)
    assert rpre.status_code == 200, rpre.text
    assert isinstance(rpre.json(), list)

    # بدون مجوز → 403
    plain = await _make_user(tc, ())
    rforbid = await client.get(
        "/api/v1/admin/lms/courses",
        headers={"Authorization": plain["Authorization"]},
    )
    assert rforbid.status_code == 403


async def test_admin_prerequisite_crud_and_cycle(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    c1, _ = await _make_course(tc, ah, n_lessons=0)
    c2, _ = await _make_course(tc, ah, n_lessons=0)

    r = await client.post(
        "/api/v1/admin/lms/prerequisites",
        json={"course_id": c2["id"], "requires_course_id": c1["id"]},
        headers=ah,
    )
    assert r.status_code == 201, r.text

    rl = await client.get(
        "/api/v1/admin/lms/prerequisites",
        params={"course_id": c2["id"]},
        headers=ah,
    )
    assert rl.status_code == 200, rl.text
    assert len(rl.json()) == 1
    assert rl.json()[0]["requires_course_id"] == c1["id"]

    # چرخه معکوس رد می‌شود (۴۲۲)
    rcyc = await client.post(
        "/api/v1/admin/lms/prerequisites",
        json={"course_id": c1["id"], "requires_course_id": c2["id"]},
        headers=ah,
    )
    assert rcyc.status_code == 422
    assert rcyc.json()["error"]["code"] == "prerequisite_cycle"

    rd = await client.delete(
        "/api/v1/admin/lms/prerequisites",
        params={"course_id": c2["id"], "requires_course_id": c1["id"]},
        headers=ah,
    )
    assert rd.status_code == 204, rd.text
    rl2 = await client.get(
        "/api/v1/admin/lms/prerequisites",
        params={"course_id": c2["id"]},
        headers=ah,
    )
    assert rl2.json() == []


async def test_admin_deletes(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}

    rc = await client.post(
        "/api/v1/admin/lms/curricula",
        json={"title": {"fa": "ح", "ar": "ح", "en": "h"}},
        headers=ah,
    )
    cur_id = rc.json()["id"]
    course, lessons = await _make_course(tc, ah, n_lessons=1)
    # اتصال دوره به برنامه
    rp = await client.patch(
        f"/api/v1/admin/lms/courses/{course['id']}",
        json={"curriculum_id": cur_id},
        headers=ah,
    )
    assert rp.status_code == 200, rp.text

    # حذف درس
    rd = await client.delete(
        f"/api/v1/admin/lms/lessons/{lessons[0]['id']}", headers=ah
    )
    assert rd.status_code == 204, rd.text
    rl = await client.get(
        f"/api/v1/admin/lms/courses/{course['id']}/lessons", headers=ah
    )
    assert rl.json() == []

    # حذف برنامه: curriculum_id دوره‌ها NULL می‌شود
    rdc = await client.delete(f"/api/v1/admin/lms/curricula/{cur_id}", headers=ah)
    assert rdc.status_code == 204, rdc.text
    rc2 = await client.get("/api/v1/admin/lms/courses", headers=ah)
    mine = [c for c in rc2.json() if c["id"] == course["id"]]
    assert mine and mine[0]["curriculum_id"] is None

    # حذف دوره
    rdel = await client.delete(
        f"/api/v1/admin/lms/courses/{course['id']}", headers=ah
    )
    assert rdel.status_code == 204, rdel.text
    rc3 = await client.get("/api/v1/admin/lms/courses", headers=ah)
    assert all(c["id"] != course["id"] for c in rc3.json())


async def test_admin_cohort_enrollments_progress_certificates(tc):
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    ah = {"Authorization": admin["Authorization"]}
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}

    course, lessons = await _make_course(tc, ah, n_lessons=2)
    cohort = await _make_cohort(tc, ah, course["id"])
    re_ = await client.post(
        f"/api/v1/lms/cohorts/{cohort['id']}/enroll", headers=uh
    )
    assert re_.status_code == 200, re_.text

    renr = await client.get(
        f"/api/v1/admin/lms/cohorts/{cohort['id']}/enrollments", headers=ah
    )
    assert renr.status_code == 200, renr.text
    assert len(renr.json()) == 1
    assert renr.json()[0]["user_id"] == user["user_id"]
    assert renr.json()[0]["user_display"]

    # تکمیل همهٔ درس‌ها → گواهی
    for les in lessons:
        await _complete_lesson(tc, uh, les["id"])

    rcert = await client.get("/api/v1/admin/lms/certificates", headers=ah)
    assert rcert.status_code == 200, rcert.text
    certs = [c for c in rcert.json() if c["course_id"] == course["id"]]
    assert len(certs) == 1
    assert certs[0]["code"].startswith("MA-")
    assert certs[0]["user_display"]

    rprog = await client.get(
        f"/api/v1/admin/lms/users/{user['user_id']}/progress", headers=ah
    )
    assert rprog.status_code == 200, rprog.text
    prog = rprog.json()
    assert prog["user_id"] == user["user_id"]
    mine = [c for c in prog["courses"] if c["course_id"] == course["id"]]
    assert mine and mine[0]["progress_pct"] == 100.0
    assert all(l["completed"] for l in mine[0]["lessons"])

    # حذف دوره‌ای که گواهی دارد → ۴۰۹
    rdel = await client.delete(
        f"/api/v1/admin/lms/courses/{course['id']}", headers=ah
    )
    assert rdel.status_code == 409
    assert rdel.json()["error"]["code"] == "course_has_certificates"


async def test_get_lesson_by_id_shareable(tc):
    """GET /lms/lessons/{id} — درس قابل‌اشتراک‌گذاری با ناوبری قبلی/بعدی."""
    client = tc["client"]
    admin = await _make_user(tc, ("lms.manage",))
    course, lessons = await _make_course(tc, admin, n_lessons=3)

    # عمومی: بدون احرازهویت هم درس پیش‌نمایش آزاد دیده می‌شود
    r = await client.get(f"/api/v1/lms/lessons/{lessons[1]['id']}")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["id"] == lessons[1]["id"]
    assert data["course_id"] == course["id"]
    assert data["prev_lesson_id"] == lessons[0]["id"]
    assert data["next_lesson_id"] == lessons[2]["id"]
    assert data["status"] is None  # مهمان → بدون وضعیت پیشرفت

    # درس اول/آخر: ناوبری یک‌طرفه
    r0 = await client.get(f"/api/v1/lms/lessons/{lessons[0]['id']}")
    assert r0.json()["prev_lesson_id"] is None
    assert r0.json()["next_lesson_id"] == lessons[1]["id"]

    # کاربر احرازهویت‌شده: وضعیت پیشرفت برمی‌گردد
    user = await _make_user(tc, ())
    uh = {"Authorization": user["Authorization"]}
    await _complete_lesson(tc, uh, lessons[1]["id"])
    ru = await client.get(f"/api/v1/lms/lessons/{lessons[1]['id']}", headers=uh)
    assert ru.json()["status"] == "completed"

    # شناسهٔ ناموجود → ۴۰۴
    r404 = await client.get(f"/api/v1/lms/lessons/{uuid.uuid4()}")
    assert r404.status_code == 404
    assert r404.json()["error"]["code"] == "lesson_not_found"

    # دورهٔ خصوصی → ۴۰۴ برای غیرمدیر
    priv, priv_lessons = await _make_course(tc, admin, n_lessons=1, visibility="private")
    rp = await client.get(f"/api/v1/lms/lessons/{priv_lessons[0]['id']}")
    assert rp.status_code == 404
    ra = await client.get(f"/api/v1/lms/lessons/{priv_lessons[0]['id']}", headers=admin)
    assert ra.status_code == 200
