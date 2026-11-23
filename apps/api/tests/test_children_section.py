"""تست‌های بخش کودکان قرآن — فاز ۴.

پوشش:
- مدیریت بدون توکن ۴۰۱ و بدون مجوز platform.settings ۴۰۳ می‌دهد
- ویدیوی سوره: لینک/حذف/ترتیب + نمای عمومی (پیش‌نویس نامرئی) + تکراری ۴۰۹
- سؤال چندگزینه‌ای خودکار: قطعی، از متن کانونیک، سه سؤال برای هر سوره
- ثبت آزمون: ستاره‌ها فقط در اولین کامل‌شدن اضافه می‌شوند
- جورکردنی از CRM + اعتبارسنجی payload
- پیشرفت شنیدن و داشبورد (ستاره، streak، جزءها)
- بستهٔ آفلاین: مانیفست با متن خودمیزبان؛ زمان‌بندیِ ناموجود صادقانه False
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

BASE = "/api/v1/quran/children"
ADMIN = "/api/v1/admin/quran/children"


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    """کاربر تست + هدر احراز — همان الگوی تست‌های ویدیو."""
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
        role = Role(name=f"child_test_role_{suffix}", description="children test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست کودکان",
            email=f"child-{suffix}@example.com",
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
        user_id = str(user.id)
    return {"Authorization": f"Bearer {token}", "user_id": user_id}


async def _make_item(
    tc,
    *,
    kind: str = "video",
    title: str = "ویدیوی تست",
    external_url: str | None = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    visibility: str = "public",
    workflow_status: str = "published",
) -> str:
    from app.models.models import LibraryItem

    async with tc["maker"]() as db:
        item = LibraryItem(
            kind=kind,
            title=_L(title),
            description=_L("توضیح تست"),
            external_url=external_url,
            visibility=visibility,
            workflow_status=workflow_status,
            duration_seconds=200,
        )
        db.add(item)
        await db.commit()
        return str(item.id)


async def _admin(tc):
    return await _make_user(tc, ("platform.settings",))


# ---------------------------------------------------------------------------
# احراز مدیریت
# ---------------------------------------------------------------------------


async def test_admin_endpoints_require_auth_and_permission(tc):
    client = tc["client"]
    r = await client.get(f"{ADMIN}/questions")
    assert r.status_code == 401, r.text

    plain = await _make_user(tc)
    r = await client.get(f"{ADMIN}/questions", headers=plain)
    assert r.status_code == 403, r.text


async def test_invalid_surah_404(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/surahs/999/videos")
    assert r.status_code == 404, r.text
    r = await client.get(f"{BASE}/surahs/0/quiz")
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# ویدیوهای سوره
# ---------------------------------------------------------------------------


async def test_surah_videos_link_list_visibility(tc):
    client = tc["client"]
    admin = await _admin(tc)
    item = await _make_item(tc)
    draft = await _make_item(
        tc, title="پیش‌نویس", workflow_status="draft", external_url=None
    )

    r = await client.post(
        f"{ADMIN}/surahs/112/videos", json={"item_id": item}, headers=admin
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "youtube"
    assert body["source_label"] == "یوتیوب"
    assert body["embed_url"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"

    # تکراری ۴۰۹
    r = await client.post(
        f"{ADMIN}/surahs/112/videos", json={"item_id": item}, headers=admin
    )
    assert r.status_code == 409, r.text

    # پیش‌نویس در نمای عمومی دیده نمی‌شود
    r = await client.post(
        f"{ADMIN}/surahs/112/videos", json={"item_id": draft}, headers=admin
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/surahs/112/videos")
    assert r.status_code == 200, r.text
    assert [v["item_id"] for v in r.json()] == [item]

    # نوع نامعتبر ۴۲۲
    pdf = await _make_item(tc, kind="pdf", title="pdf", external_url=None)
    r = await client.post(
        f"{ADMIN}/surahs/112/videos", json={"item_id": pdf}, headers=admin
    )
    assert r.status_code == 422, r.text

    # لینک مستقیم
    direct = await _make_item(
        tc,
        title="مستقیم",
        external_url="https://example.com/clip.mp4",
    )
    r = await client.post(
        f"{ADMIN}/surahs/113/videos", json={"item_id": direct}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "direct"
    assert r.json()["stream_url"] == "https://example.com/clip.mp4"
    assert r.json()["embed_url"] is None


async def test_videos_reorder_and_unlink(tc):
    client = tc["client"]
    admin = await _admin(tc)
    a = await _make_item(tc, title="الف")
    b = await _make_item(
        tc, title="ب", external_url="https://youtu.be/dQw4w9WgXcQ"
    )
    for item in (a, b):
        r = await client.post(
            f"{ADMIN}/surahs/114/videos", json={"item_id": item}, headers=admin
        )
        assert r.status_code == 200, r.text

    # مجموعهٔ ناهمخوان ۴۲۲
    r = await client.put(
        f"{ADMIN}/surahs/114/videos/order", json={"item_ids": [a]}, headers=admin
    )
    assert r.status_code == 422, r.text

    r = await client.put(
        f"{ADMIN}/surahs/114/videos/order", json={"item_ids": [b, a]}, headers=admin
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/surahs/114/videos")
    assert [v["item_id"] for v in r.json()] == [b, a]

    r = await client.delete(f"{ADMIN}/surahs/114/videos/{a}", headers=admin)
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/surahs/114/videos")
    assert [v["item_id"] for v in r.json()] == [b]


# ---------------------------------------------------------------------------
# سؤال چندگزینه‌ای خودکار
# ---------------------------------------------------------------------------


async def test_auto_mcq_questions_deterministic(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/surahs/112/quiz?question_type=mcq")
    assert r.status_code == 200, r.text
    questions = r.json()
    assert [q["id"] for q in questions] == [
        "auto-mcq-112-count",
        "auto-mcq-112-first-word",
        "auto-mcq-112-number",
    ]
    assert all(q["source"] == "auto" for q in questions)
    # جواب درست سؤال تعداد آیات، «4» است
    count_q = questions[0]
    assert count_q["payload"]["options"][count_q["payload"]["correct_index"]]["fa"] == "4"
    # کلمهٔ اول اخلاص «قُلْ» است
    first_q = questions[1]
    assert first_q["payload"]["options"][first_q["payload"]["correct_index"]]["fa"] == "قُلْ"
    # فراخوانی دوباره همان سؤال‌ها را می‌دهد (قطعی)
    r2 = await client.get(f"{BASE}/surahs/112/quiz?question_type=mcq")
    assert r2.json() == questions


# ---------------------------------------------------------------------------
# ثبت آزمون و ستاره‌ها
# ---------------------------------------------------------------------------


async def _correct_mcq_answers(tc):
    r = await tc["client"].get(f"{BASE}/surahs/112/quiz?question_type=mcq")
    return {
        q["id"]: q["payload"]["correct_index"] for q in r.json()
    }


async def test_quiz_submit_stars_first_completion_only(tc):
    client = tc["client"]
    user = await _make_user(tc)
    answers = await _correct_mcq_answers(tc)

    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={"question_type": "mcq", "answers": answers},
        headers=user,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "correct_count": 3,
        "total": 3,
        "stars": 3,
        "stars_added": 3,
        "completed": False,
    }

    # تکرار آزمون تلاش ثبت می‌کند ولی ستاره نمی‌دهد
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={"question_type": "mcq", "answers": answers},
        headers=user,
    )
    assert r.json()["stars_added"] == 0, r.text

    r = await client.get(f"{BASE}/progress", headers=user)
    assert r.status_code == 200, r.text
    (row,) = [p for p in r.json() if p["surah"] == 112]
    assert row["stars"] == 3 and row["quiz_done"] is True
    assert row["status"] == "learning"


async def test_quiz_submit_unknown_question_422(tc):
    client = tc["client"]
    user = await _make_user(tc)
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={"question_type": "mcq", "answers": {"bogus": 0}},
        headers=user,
    )
    assert r.status_code == 422, r.text
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={"question_type": "mcq", "answers": {}},
        headers=user,
    )
    assert r.status_code == 422, r.text


async def _make_matching(tc, admin, surah=112):
    body = {
        "surah": surah,
        "question_type": "matching",
        "payload": {
            "pairs": [
                {"word": "أَحَدٌ", "meaning": _L("یگانه")},
                {"word": "الصَّمَدُ", "meaning": _L("بی‌نیاز")},
            ]
        },
    }
    r = await tc["client"].post(f"{ADMIN}/questions", json=body, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


async def test_matching_crm_question_and_submit(tc):
    client = tc["client"]
    admin = await _admin(tc)
    user = await _make_user(tc)
    q = await _make_matching(tc, admin)

    r = await client.get(f"{BASE}/surahs/112/quiz?question_type=matching")
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()] == [q["id"]]
    assert r.json()[0]["source"] == "crm"

    # همه درست → ۱ ستاره
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={
            "question_type": "matching",
            "answers": {q["id"]: {"أَحَدٌ": "یگانه", "الصَّمَدُ": "بی‌نیاز"}},
        },
        headers=user,
    )
    assert r.status_code == 200, r.text
    assert r.json()["stars"] == 1 and r.json()["stars_added"] == 1, r.text

    # یک جفت غلط → ۰ ستاره
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={
            "question_type": "matching",
            "answers": {q["id"]: {"أَحَدٌ": "بزرگ", "الصَّمَدُ": "بی‌نیاز"}},
        },
        headers=user,
    )
    assert r.json()["stars"] == 0 and r.json()["correct_count"] == 0, r.text

    r = await client.get(f"{BASE}/progress", headers=user)
    (row,) = [p for p in r.json() if p["surah"] == 112]
    assert row["match_done"] is True and row["stars"] == 1


async def test_crm_question_validation_and_soft_delete(tc):
    client = tc["client"]
    admin = await _admin(tc)

    # گزینهٔ کمتر از ۲ → ۴۲۲
    r = await client.post(
        f"{ADMIN}/questions",
        json={
            "surah": 112,
            "question_type": "mcq",
            "payload": {
                "question": _L("؟"),
                "options": [_L("الف")],
                "correct_index": 0,
            },
        },
        headers=admin,
    )
    assert r.status_code == 422, r.text

    # نوع نامعتبر → ۴۲۲
    r = await client.post(
        f"{ADMIN}/questions",
        json={"surah": 112, "question_type": "essay", "payload": {}},
        headers=admin,
    )
    assert r.status_code == 422, r.text

    # سورهٔ ۱۱۳ تا با سؤال جورکردنی ۱۱۲ در تست قبلی تداخل نکند
    q = await _make_matching(tc, admin, surah=113)
    # فهرست مدیریت پرچم is_active را می‌دهد (CRM برای دکمهٔ فعال/غیرفعال)
    r = await client.get(f"{ADMIN}/questions?surah=113", headers=admin)
    assert r.status_code == 200, r.text
    listed = [row for row in r.json() if row["id"] == q["id"]]
    assert len(listed) == 1 and listed[0]["is_active"] is True
    # غیرفعال‌کردن از آزمون عمومی پنهانش می‌کند
    r = await client.patch(
        f"{ADMIN}/questions/{q['id']}", json={"is_active": False}, headers=admin
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"{BASE}/surahs/113/quiz?question_type=matching")
    assert r.json() == []
    r = await client.get(f"{ADMIN}/questions?surah=113", headers=admin)
    listed = [row for row in r.json() if row["id"] == q["id"]]
    assert len(listed) == 1 and listed[0]["is_active"] is False
    # حذف نرم
    r = await client.delete(f"{ADMIN}/questions/{q['id']}", headers=admin)
    assert r.status_code == 200, r.text
    r = await client.patch(
        f"{ADMIN}/questions/{q['id']}", json={"is_active": True}, headers=admin
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# پیشرفت شنیدن و داشبورد
# ---------------------------------------------------------------------------


async def test_listen_and_progress(tc):
    client = tc["client"]
    user = await _make_user(tc)
    r = await client.post(
        f"{BASE}/progress/listen",
        json={"surah": 112, "last_ayah": 2},
        headers=user,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "learning"
    assert r.json()["listened_ayahs"] == 2
    assert r.json()["last_ayah"] == 2

    r = await client.post(
        f"{BASE}/progress/listen",
        json={"surah": 112, "last_ayah": 5},
        headers=user,
    )
    assert r.status_code == 422, r.text  # اخلاص ۴ آیه دارد


async def test_dashboard_aggregates(tc):
    client = tc["client"]
    admin = await _admin(tc)
    user = await _make_user(tc)

    # اخلاص را کامل کن: چندگزینه‌ای ۳ ستاره + جورکردنی ۱ ستاره
    answers = await _correct_mcq_answers(tc)
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={"question_type": "mcq", "answers": answers},
        headers=user,
    )
    assert r.status_code == 200, r.text
    q = await _make_matching(tc, admin)
    r = await client.post(
        f"{BASE}/surahs/112/quiz/submit",
        json={
            "question_type": "matching",
            "answers": {q["id"]: {"أَحَدٌ": "یگانه", "الصَّمَدُ": "بی‌نیاز"}},
        },
        headers=user,
    )
    assert r.status_code == 200, r.text

    # فلق را فقط گوش بده (در حال یادگیری)
    r = await client.post(
        f"{BASE}/progress/listen",
        json={"surah": 113, "last_ayah": 1},
        headers=user,
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"{BASE}/dashboard", headers=user)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total_stars"] == 4, d
    assert d["learned_count"] == 1
    assert d["goal_today_surahs"] >= 1
    assert d["streak_current"] >= 1
    assert len(d["week"]) == 7
    assert d["week"][-1]["is_today"] is True
    assert d["week"][-1]["active"] is True
    assert d["continue_surah"]["surah"] == 113
    juz30 = [j for j in d["juz_progress"] if j["juz"] == 30][0]
    assert juz30["total_surahs"] == 37
    assert juz30["completed_surahs"] == 1
    assert juz30["state"] == "current"
    assert d["progress"][0]["surah"] == 112


# ---------------------------------------------------------------------------
# بستهٔ آفلاین
# ---------------------------------------------------------------------------


async def test_offline_pack_manifest(tc, monkeypatch):
    from app.modules.quran.children import service as children_service
    from app.modules.quran.recitation_timing import RecitationTimingError

    client = tc["client"]

    async def _boom(*args, **kwargs):
        raise RecitationTimingError("no network in test")

    monkeypatch.setattr(children_service, "get_recitation_timing", _boom)
    r = await client.get(f"{BASE}/offline-pack?surah=112&reciter=minshawi")
    assert r.status_code == 200, r.text
    pack = r.json()
    assert pack["surah"] == 112 and pack["reciter"] == "minshawi"
    assert pack["timing_available"] is False
    assert pack["audio_url"] is None
    assert len(pack["ayahs"]) == 4
    # در متن عثمانی خودمیزبان بسمله به ابتدای آیهٔ ۱ چسبیده است
    assert "قُلْ هُوَ" in pack["ayahs"][0]["text"]

    async def _fake(*args, **kwargs):
        return {
            "reciter": "minshawi",
            "surah": 112,
            "audio_url": "https://example.com/audio/112.mp3",
            "ayahs": [],
        }

    monkeypatch.setattr(children_service, "get_recitation_timing", _fake)
    r = await client.get(f"{BASE}/offline-pack?surah=112&reciter=minshawi")
    assert r.json()["timing_available"] is True
    assert r.json()["audio_url"] == "https://example.com/audio/112.mp3"

    r = await client.get(f"{BASE}/offline-pack?surah=112&reciter=nope")
    assert r.status_code == 422, r.text

    r = await client.get(f"{BASE}/offline-pack/whole-quran?reciter=minshawi")
    assert r.status_code == 200, r.text
    assert len(r.json()["surahs"]) == 114
    assert r.json()["surahs"][111]["surah"] == 112
    assert "surah=112" in r.json()["surahs"][111]["pack_url"]
