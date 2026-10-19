"""تست‌های فاز ۱۰ — شبکهٔ اجتماعی، نظارت، پنل مؤلفین فتوا، تجمیع سوالات.

پوشش معیارهای پذیرش فاز ۱۰:
(a) پست/کامنت حاوی کلمهٔ ممنوعه پیش از انتشار فیلتر می‌شود (۴۲۲، بدون بازتاب واژه)
(b) گزارش پست → صف نظارت با sla_due_at + گذارهای وضعیت با timestamp
(c) گردش‌کار ثبت فتوا draft→published سرتاسری + add-to-rag
(d) ۳ سوال مشابه از ۳ کاربر → ۱ خوشه؛ پاسخ یک‌باره → هر ۳ نفر اعلان می‌گیرند
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select

BASE = "/api/v1"

BANNED = "واژه‌ممنوعه‌تست"

Q1 = "آیا نماز مسافر در سفر قصر می‌شود؟"
Q2 = "نماز مسافر در سفر قصر می‌شود؟"
Q3 = "آیا در سفر نماز مسافر قصر می‌شود؟"
Q_OTHER = "حکم روزهٔ مسافر در ماه رمضان چیست؟"


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


async def _make_user(tc, permissions: tuple[str, ...] = ()):
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
        role = Role(name=f"social_test_role_{suffix}", description="social test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست اجتماعی",
            email=f"social-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


async def _add_banned_word(client, admin_headers, word=BANNED):
    r = await client.post(
        f"{BASE}/moderation/banned-words", json={"word": word}, headers=admin_headers
    )
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# (a) فیلتر کلمات ممنوعه
# ---------------------------------------------------------------------------


async def test_banned_word_blocks_post_and_comment(tc):
    admin = await _make_user(tc, ("moderation.words",))
    user = await _make_user(tc)
    client = tc["client"]

    await _add_banned_word(client, admin)

    # پست حاوی واژهٔ ممنوعه → ۴۲۲ پیش از انتشار
    r = await client.post(
        f"{BASE}/social/posts",
        json={"body": f"این یک متن آزمایشی با {BANNED} است"},
        headers=user,
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["error"]["code"] == "content_policy_violation"
    assert BANNED not in r.text, "واژهٔ ممنوعه نباید در پاسخ بازتاب شود"

    # پست سالم → موفق
    r = await client.post(
        f"{BASE}/social/posts",
        json={"body": "این یک پست کاملاً سالم و علمی است"},
        headers=user,
    )
    assert r.status_code == 201, r.text
    post_id = r.json()["id"]

    # کامنت حاوی واژهٔ ممنوعه → ۴۲۲
    r = await client.post(
        f"{BASE}/social/posts/{post_id}/comments",
        json={"body": f"کامنت بد با {BANNED}"},
        headers=user,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "content_policy_violation"
    assert BANNED not in r.text

    # کامنت سالم → موفق
    r = await client.post(
        f"{BASE}/social/posts/{post_id}/comments",
        json={"body": "کامنت سالم"},
        headers=user,
    )
    assert r.status_code == 201, r.text


async def test_banned_word_management_requires_permission(tc):
    user = await _make_user(tc)
    client = tc["client"]
    r = await client.post(
        f"{BASE}/moderation/banned-words", json={"word": "x"}, headers=user
    )
    assert r.status_code == 403, r.text
    r = await client.get(f"{BASE}/moderation/banned-words", headers=user)
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# (b) صف نظارت با SLA
# ---------------------------------------------------------------------------


async def test_report_queue_sla_and_status_transitions(tc):
    reporter = await _make_user(tc)
    author = await _make_user(tc)
    moderator = await _make_user(tc, ("social.moderate",))
    client = tc["client"]

    r = await client.post(
        f"{BASE}/social/posts", json={"body": "پستی که گزارش می‌شود"}, headers=author
    )
    assert r.status_code == 201, r.text
    post_id = r.json()["id"]

    before = datetime.now(timezone.utc)
    r = await client.post(
        f"{BASE}/social/report",
        json={"target_type": "post", "target_id": post_id, "reason": "محتوای نامناسب"},
        headers=reporter,
    )
    assert r.status_code == 201, r.text
    report = r.json()
    assert report["status"] == "new"
    assert report["triaged_at"] is None
    assert report["actioned_at"] is None
    sla_due = datetime.fromisoformat(report["sla_due_at"])
    reported_at = datetime.fromisoformat(report["reported_at"])
    assert reported_at >= before
    # SLA پیش‌فرض ۲۴ ساعت
    assert 23 * 3600 < (sla_due - reported_at).total_seconds() <= 24 * 3600

    # صف نظارت
    r = await client.get(f"{BASE}/admin/social/reports", headers=moderator)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    # مقایسهٔ مقداری (روی SQLite پسوند Z پس از بازخوانی می‌افتد؛ روی Postgres هست)
    assert items[0]["sla_due_at"].rstrip("Z") == report["sla_due_at"].rstrip("Z")

    report_id = report["id"]

    # triage
    r = await client.post(
        f"{BASE}/admin/social/reports/{report_id}/action",
        json={"action": "triage", "note": "در حال بررسی"},
        headers=moderator,
    )
    assert r.status_code == 200, r.text
    triaged = r.json()
    assert triaged["status"] == "triaged"
    assert triaged["triaged_at"] is not None
    assert triaged["actioned_at"] is None

    # remove_content → پست حذف می‌شود
    r = await client.post(
        f"{BASE}/admin/social/reports/{report_id}/action",
        json={"action": "remove_content", "note": "نقض قوانین"},
        headers=moderator,
    )
    assert r.status_code == 200, r.text
    actioned = r.json()
    assert actioned["status"] == "actioned"
    assert actioned["actioned_at"] is not None
    assert actioned["action"] == "remove_content"

    r = await client.get(f"{BASE}/social/posts/{post_id}", headers=author)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "removed"

    # رد گزارش دیگر
    r = await client.post(
        f"{BASE}/social/posts", json={"body": "پست سالم دوم"}, headers=author
    )
    post2 = r.json()["id"]
    r = await client.post(
        f"{BASE}/social/report",
        json={"target_type": "post", "target_id": post2, "reason": "اشتباهی"},
        headers=reporter,
    )
    rep2 = r.json()["id"]
    r = await client.post(
        f"{BASE}/admin/social/reports/{rep2}/action",
        json={"action": "dismiss", "note": "بی‌مورد"},
        headers=moderator,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "dismissed"
    assert r.json()["actioned_at"] is not None


async def test_report_requires_permission_for_queue(tc):
    user = await _make_user(tc)
    client = tc["client"]
    r = await client.get(f"{BASE}/admin/social/reports", headers=user)
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# گروه‌ها، فید، دنبال‌کردن
# ---------------------------------------------------------------------------


async def test_groups_join_feed_follow(tc):
    admin = await _make_user(tc, ("social.moderate",))
    user = await _make_user(tc)
    client = tc["client"]

    r = await client.post(
        f"{BASE}/social/groups",
        json={"name": _L("گروه تست"), "slug": f"test-group-{_uid()}"},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    group = r.json()
    group_id = group["id"]
    assert group["member_count"] == 1  # سازنده عضو است

    r = await client.post(f"{BASE}/social/groups/{group_id}/join", headers=user)
    assert r.status_code == 200, r.text
    assert r.json()["is_member"] is True
    assert r.json()["member_count"] == 2

    r = await client.post(
        f"{BASE}/social/posts",
        json={"body": "پست گروهی", "group_id": group_id},
        headers=user,
    )
    assert r.status_code == 201, r.text

    r = await client.get(f"{BASE}/social/feed", headers=user)
    assert r.status_code == 200, r.text
    feed = r.json()
    assert feed["items"], "فید باید پست را نشان دهد"
    assert feed["items"][0]["body"] == "پست گروهی"

    r = await client.post(
        f"{BASE}/social/follows",
        json={"followed_id": admin["user_id"]},
        headers=user,
    )
    assert r.status_code == 201, r.text

    r = await client.post(
        f"{BASE}/social/follows",
        json={"followed_id": user["user_id"]},
        headers=user,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "self_follow"


# ---------------------------------------------------------------------------
# (c) گردش‌کار ثبت فتوا + افزودن به RAG
# ---------------------------------------------------------------------------


async def test_fatwa_submission_workflow_end_to_end(tc):
    author = await _make_user(tc, ("fatwa.submit",))
    approver = await _make_user(tc, ("fatwa.approve", "knowledge.manage"))
    plain = await _make_user(tc)
    client = tc["client"]

    # کاربر عادی نمی‌تواند ثبت کند
    r = await client.post(
        f"{BASE}/fatwa/submissions",
        json={"title": _L("فتوا"), "body": "متن"},
        headers=plain,
    )
    assert r.status_code == 403, r.text

    # ثبت → draft
    r = await client.post(
        f"{BASE}/fatwa/submissions",
        json={
            "title": _L("حکم نماز مسافر"),
            "body": "متن فتوای آزمایشی دربارهٔ نماز مسافر",
            "madhab": "hanafi",
            "evidence": "دلیل آزمایشی",
        },
        headers=author,
    )
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["workflow_status"] == "draft"
    sub_id = sub["id"]

    # جهش مستقیم draft→published ممنوع
    r = await client.post(f"{BASE}/fatwa/submissions/{sub_id}/publish", headers=approver)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_transition"

    # submit → in_review
    r = await client.post(f"{BASE}/fatwa/submissions/{sub_id}/submit", headers=author)
    assert r.status_code == 200, r.text
    assert r.json()["workflow_status"] == "in_review"

    # نویسنده نمی‌تواند تأیید کند (RBAC)
    r = await client.post(f"{BASE}/fatwa/submissions/{sub_id}/approve", headers=author)
    assert r.status_code == 403, r.text

    # approve → approved
    r = await client.post(f"{BASE}/fatwa/submissions/{sub_id}/approve", headers=approver)
    assert r.status_code == 200, r.text
    assert r.json()["workflow_status"] == "approved"

    # publish → published
    r = await client.post(f"{BASE}/fatwa/submissions/{sub_id}/publish", headers=approver)
    assert r.status_code == 200, r.text
    assert r.json()["workflow_status"] == "published"
    assert r.json()["published_at"] is not None

    # add-to-rag → chunk ساخته می‌شود
    r = await client.post(
        f"{BASE}/fatwa/submissions/{sub_id}/add-to-rag", headers=approver
    )
    assert r.status_code == 201, r.text
    chunk_id = r.json()["chunk_id"]

    from app.models.models import FiqhKnowledgeChunk

    async with tc["maker"]() as db:
        chunk = (
            await db.execute(
                select(FiqhKnowledgeChunk).where(FiqhKnowledgeChunk.id == uuid.UUID(chunk_id))
            )
        ).scalar_one()
        assert chunk.source_type == "fatwa_submission"
        assert chunk.workflow_status == "approved"
        assert "fatwa" in (chunk.ai_scopes or [])
        assert chunk.embedding, "chunk باید embedding داشته باشد"
        assert "نماز مسافر" in chunk.chunk_text

    # افزودن تکراری → ۴۰۹
    r = await client.post(
        f"{BASE}/fatwa/submissions/{sub_id}/add-to-rag", headers=approver
    )
    assert r.status_code == 409, r.text

    # فتوای منتشرنشده را نمی‌توان به RAG افزود
    r = await client.post(
        f"{BASE}/fatwa/submissions",
        json={"title": _L("فتوای دوم"), "body": "متن دوم"},
        headers=author,
    )
    sub2 = r.json()["id"]
    r = await client.post(f"{BASE}/fatwa/submissions/{sub2}/add-to-rag", headers=approver)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "submission_not_published"


# ---------------------------------------------------------------------------
# (d) تجمیع سوالات
# ---------------------------------------------------------------------------


async def test_three_similar_questions_one_cluster_all_notified(tc):
    u1 = await _make_user(tc)
    u2 = await _make_user(tc)
    u3 = await _make_user(tc)
    mufti = await _make_user(tc, ("fatwa.answer_cluster",))
    client = tc["client"]

    async def ask(user, text):
        r = await client.post(
            f"{BASE}/fatwa/questions", json={"text": text}, headers=user
        )
        assert r.status_code == 201, r.text
        return r.json()

    r1 = await ask(u1, Q1)
    r2 = await ask(u2, Q2)
    r3 = await ask(u3, Q3)

    assert r1["matched"] is False
    assert r2["matched"] is True
    assert r3["matched"] is True
    assert r1["cluster_id"] == r2["cluster_id"] == r3["cluster_id"]
    cluster_id = r1["cluster_id"]

    # خوشهٔ متفاوت برای سوال نامرتبط
    r_other = await ask(u1, Q_OTHER)
    assert r_other["cluster_id"] != cluster_id

    # پنل مفتی: یک خوشه با ۳ عضو
    r = await client.get(f"{BASE}/fatwa/clusters/{cluster_id}", headers=mufti)
    assert r.status_code == 200, r.text
    cluster = r.json()
    assert cluster["status"] == "open"
    assert cluster["member_count"] == 3
    assert {m["user_id"] for m in cluster["members"]} == {
        u1["user_id"],
        u2["user_id"],
        u3["user_id"],
    }

    # پاسخ یک‌باره → هر ۳ نفر اعلان می‌گیرند
    answer_text = "پاسخ مفتی: نماز مسافر در سفر قصر می‌شود."
    r = await client.post(
        f"{BASE}/fatwa/clusters/{cluster_id}/answer",
        json={"answer": answer_text},
        headers=mufti,
    )
    assert r.status_code == 200, r.text
    assert r.json()["notified_count"] == 3
    assert r.json()["status"] == "answered"

    for u in (u1, u2, u3):
        r = await client.get(f"{BASE}/social/notifications", headers=u)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        matches = [n for n in items if n["notif_type"] == "fatwa.cluster_answered"]
        assert len(matches) == 1, f"کاربر باید دقیقاً یک اعلان گرفته باشد: {items}"
        assert matches[0]["body"] == answer_text
        assert matches[0]["data"]["cluster_id"] == cluster_id

    # رویداد دامنه ثبت شده
    from app.models.models import DomainEvent

    async with tc["maker"]() as db:
        ev = (
            await db.execute(
                select(DomainEvent).where(
                    DomainEvent.event_type == "fatwa.cluster_answered",
                    DomainEvent.aggregate_id == cluster_id,
                )
            )
        ).scalar_one_or_none()
        assert ev is not None
        assert ev.payload["notified_count"] == 3

    # سوال مشابهِ بعدی → پیشنهاد فوریِ پاسخ موجود
    u4 = await _make_user(tc)
    r4 = await ask(u4, "آیا نماز مسافر در سفر شکسته می‌شود؟")
    # ممکن است match شود یا نه؛ اگر شد باید suggestion داشته باشد
    if r4["matched"] and r4["cluster_id"] == cluster_id:
        assert r4["suggestion"] is not None
        assert r4["suggestion"]["answer"] == answer_text


async def test_cluster_answer_requires_mufti_permission(tc):
    user = await _make_user(tc)
    mufti = await _make_user(tc, ("fatwa.answer_cluster",))
    client = tc["client"]

    r = await client.post(f"{BASE}/fatwa/questions", json={"text": Q1}, headers=user)
    cluster_id = r.json()["cluster_id"]

    r = await client.post(
        f"{BASE}/fatwa/clusters/{cluster_id}/answer",
        json={"answer": "x"},
        headers=user,
    )
    assert r.status_code == 403, r.text

    r = await client.get(f"{BASE}/fatwa/clusters", headers=user)
    assert r.status_code == 403, r.text

    r = await client.get(f"{BASE}/fatwa/clusters", headers=mufti)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# رگرسیون: مقدار json-codeشدهٔ ai.embedding_provider
# ---------------------------------------------------------------------------


async def test_embedding_provider_tolerates_json_encoded_setting(tc):
    """رگرسیون فاز ۶: مقدار setting از نوع json («"hash"» با گیومه) نباید
    انتخاب provider را بشکند — در seed واقعی همین شکل ذخیره می‌شود."""
    from sqlalchemy import delete

    from app.core.platform_settings import (
        encode_setting_value,
        reset_settings_cache,
        stage_setting,
    )
    from app.models.models import PlatformSetting
    from app.modules.fatwa.embeddings import get_embedding_provider

    user = await _make_user(tc)
    client = tc["client"]
    async with tc["maker"]() as db:
        await stage_setting(
            db,
            "ai.embedding_provider",
            encode_setting_value("json", "hash", "ai.embedding_provider"),
        )
        await db.commit()
        reset_settings_cache()
        try:
            provider = await get_embedding_provider(db)
            assert provider.name == "hash"
            # سرتاسری از مسیر API
            r = await client.post(
                f"{BASE}/fatwa/questions", json={"text": Q1}, headers=user
            )
            assert r.status_code == 201, r.text
        finally:
            await db.execute(
                delete(PlatformSetting).where(
                    PlatformSetting.key == "ai.embedding_provider"
                )
            )
            await db.commit()
            reset_settings_cache()


# ---------------------------------------------------------------------------
# seed فاز ۱۰ — idempotent
# ---------------------------------------------------------------------------


async def test_seed_social_idempotent(tc):
    from app.seed_social import seed_social

    async with tc["maker"]() as db:
        first = await seed_social(db)
        await db.commit()
        second = await seed_social(db)
        await db.commit()

    assert "scholar_author" in first["rbac"]["roles"]
    assert set(first["rbac"]["permissions"]) >= {
        "social.moderate",
        "moderation.words",
        "fatwa.submit",
        "fatwa.answer_cluster",
    }
    assert first["guidelines"] in ("created", "updated")
    assert second["guidelines"] == "updated"

    # صفحهٔ قوانین انجمن منتشرشده است
    from app.models.models import Page

    async with tc["maker"]() as db:
        page = (
            await db.execute(
                select(Page).where(Page.slug == "community-guidelines")
            )
        ).scalar_one()
        assert page.workflow_status == "published"
        assert page.blocks, "صفحه باید بلاک محتوا داشته باشد"


# ---------------------------------------------------------------------------
# (e) لایک/آنلایک پست — idempotent (الحاقیهٔ integration)
# ---------------------------------------------------------------------------


async def test_like_unlike_post_idempotent(tc):
    user = await _make_user(tc)
    other = await _make_user(tc)
    client = tc["client"]

    r = await client.post(
        f"{BASE}/social/posts", json={"body": "پست قابل لایک"}, headers=user
    )
    assert r.status_code == 201, r.text
    post_id = r.json()["id"]
    assert r.json()["likes_count"] == 0
    assert r.json()["liked"] is False

    # لایک
    r = await client.post(f"{BASE}/social/posts/{post_id}/like", headers=other)
    assert r.status_code == 200, r.text
    assert r.json() == {"liked": True, "likes_count": 1}

    # لایک تکراری — همان وضعیت، شمارش دو برابر نمی‌شود
    r = await client.post(f"{BASE}/social/posts/{post_id}/like", headers=other)
    assert r.status_code == 200, r.text
    assert r.json() == {"liked": True, "likes_count": 1}

    # فلگ liked در فید برای لایک‌کننده true، برای بقیه false
    r = await client.get(f"{BASE}/social/posts/{post_id}", headers=other)
    assert r.json()["liked"] is True
    r = await client.get(f"{BASE}/social/posts/{post_id}", headers=user)
    assert r.json()["liked"] is False
    assert r.json()["likes_count"] == 1

    # آنلایک
    r = await client.request("DELETE", f"{BASE}/social/posts/{post_id}/like", headers=other)
    assert r.status_code == 200, r.text
    assert r.json() == {"liked": False, "likes_count": 0}

    # آنلایک تکراری — خطا نیست
    r = await client.request("DELETE", f"{BASE}/social/posts/{post_id}/like", headers=other)
    assert r.status_code == 200, r.text
    assert r.json()["likes_count"] == 0


async def test_unfollow_idempotent(tc):
    user = await _make_user(tc)
    target = await _make_user(tc)
    client = tc["client"]

    r = await client.post(
        f"{BASE}/social/follows",
        json={"followed_id": target["user_id"]},
        headers=user,
    )
    assert r.status_code == 201, r.text

    r = await client.request(
        "DELETE", f"{BASE}/social/follows/{target['user_id']}", headers=user
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"unfollowed": True}

    r = await client.request(
        "DELETE", f"{BASE}/social/follows/{target['user_id']}", headers=user
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"unfollowed": False}
