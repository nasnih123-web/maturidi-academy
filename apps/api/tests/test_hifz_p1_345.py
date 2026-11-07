"""تست‌های P1-3 / P1-4 / P1-5 — مأموریت تکمیلی بازطراحی حفاظ.

- P1-3: limiter توزیع‌شده روی fakeredis (مسیر fallback بدون EVAL —
  fakeredis در این venv دستور EVAL ندارد؛ مسیر Lua فقط روی Redis
  واقعی می‌رود) + دروازهٔ fail-closed + fallback محلی.
- P1-4: سیاست نگهداری پیکربندی‌پذیر — پیش‌فرضِ همه null (خاموش).
- P1-5: حذف یک‌جای دادهٔ حفظ (فقط دامنهٔ hifz_only) — فقط در محیط
  تست، با دادهٔ مصنوعی؛ هرگز دادهٔ واقعی.

یادداشت صداقت: سرور Redis واقعی در sandbox نیست؛ تست‌های توزیع‌شده
روی fakeredis اجرا می‌شوند (همان semantic دستورهای ZSET واقعی).
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.hifz_live_limiter import (
    DistributedLiveStreamLimiter,
    LiveAcquire,
    LiveStreamLimiterGateway,
)
from app.models.models import (
    AuditLog,
    DomainEvent,
    HifzAttempt,
    HifzMistake,
    HifzPlan,
    HifzPlanItem,
    HifzReview,
    HifzTasmiSession,
    HifzTest,
    HifzTestQuestion,
    HifzUserSettings,
    HifzWordScore,
    User,
)

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"

NOW = datetime.now(UTC)
OLD = NOW - timedelta(days=40)
YOUNG = NOW - timedelta(days=10)


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _user_token(client, email: str) -> str:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست",
            "email": email,
            "password": "TestPass123",
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _user_id(tc, email: str) -> uuid.UUID:
    async with tc["maker"]() as db:
        row = (await db.execute(select(User).where(User.email == email))).scalar_one()
        return row.id


def _fake_redis():
    import fakeredis.aioredis as fake_aioredis

    return fake_aioredis.FakeRedis()


def _limiter(client, **kwargs):
    return DistributedLiveStreamLimiter(
        client, max_per_user=1, max_total=4, lease_s=60, **kwargs
    )


async def _seed_full(db, user_id: uuid.UUID, tag: str) -> dict[str, int]:
    """دادهٔ کامل در هر ۱۰ جدول برای یک کاربر — با رشته‌های نگهبان یکتا."""
    attempt = HifzAttempt(
        user_id=user_id, surah=1, status="completed", completed_at=OLD
    )
    db.add(attempt)
    await db.flush()
    db.add(
        HifzWordScore(
            attempt_id=attempt.id,
            surah=1,
            ayah=1,
            word_index=0,
            expected_text="بِسْمِ",
            status="correct",
            heard=f"SENTINEL_HEARD_{tag}",
        )
    )
    db.add(
        HifzMistake(
            attempt_id=attempt.id,
            user_id=user_id,
            surah=1,
            ayah=1,
            word_index=0,
            mistake_type="wrong_word",
            expected_text="بِسْمِ",
            heard=f"SENTINEL_HEARD_{tag}",
        )
    )
    plan = HifzPlan(
        user_id=user_id,
        title=f"SENTINEL_TITLE_{tag}",
        kind="memorize",
        start_surah=1,
        start_ayah=1,
        end_surah=1,
        end_ayah=7,
        status="active",
    )
    db.add(plan)
    await db.flush()
    db.add(
        HifzPlanItem(
            plan_id=plan.id, user_id=user_id, surah=1, ayah=1, position=0
        )
    )
    db.add(HifzReview(user_id=user_id, surah=1, ayah=1))
    test = HifzTest(
        user_id=user_id,
        surah_start=1,
        surah_end=1,
        status="completed",
        completed_at=OLD,
    )
    db.add(test)
    await db.flush()
    db.add(
        HifzTestQuestion(
            test_id=test.id,
            position=0,
            surah=1,
            ayah_start=1,
            ayah_end=1,
            raw_events=[{"heard": f"SENTINEL_HEARD_{tag}"}],
        )
    )
    db.add(
        HifzTasmiSession(
            user_id=user_id,
            method="tasmi8",
            start_surah=1,
            start_ayah=1,
            end_surah=1,
            end_ayah=7,
            reflection=f"SENTINEL_REFLECTION_{tag}",
            status="completed",
            completed_at=OLD,
        )
    )
    db.add(HifzUserSettings(user_id=user_id))
    await db.commit()
    return {
        "hifz_word_scores": 1,
        "hifz_mistakes": 1,
        "hifz_test_questions": 1,
        "hifz_plan_items": 1,
        "hifz_attempts": 1,
        "hifz_tests": 1,
        "hifz_plans": 1,
        "hifz_reviews": 1,
        "hifz_tasmi_sessions": 1,
        "hifz_user_settings": 1,
    }


async def _counts_for(db, user_id: uuid.UUID) -> dict[str, int]:
    from app.modules.quran import hifz_purge

    return await hifz_purge.preview_hifz_data_counts(db, user_id)


# ---------------------------------------------------------------------------
# P1-3 — limiter توزیع‌شده
# ---------------------------------------------------------------------------


async def test_distributed_limiter_cap_release_and_per_user():
    client = _fake_redis()
    limiter = _limiter(client)
    u1, u2, u3, u4, u5 = (uuid.uuid4() for _ in range(5))
    s = [uuid.uuid4() for _ in range(5)]
    assert await limiter.try_acquire(u1, s[0]) is True
    assert await limiter.try_acquire(u1, s[1]) is False  # سقف هر کاربر: ۱
    assert await limiter.try_acquire(u2, s[2]) is True
    assert await limiter.try_acquire(u3, s[3]) is True
    assert await limiter.try_acquire(u4, s[4]) is True
    assert await limiter.try_acquire(u5, uuid.uuid4()) is False  # سقف کل: ۴
    assert await limiter.active_total() == 4
    assert await limiter.active_for(u1) == 1
    await limiter.release(u1, s[0])
    assert await limiter.active_total() == 3
    assert await limiter.try_acquire(u5, uuid.uuid4()) is True
    await limiter.release(u5, s[0])  # release با session اشتباه، بی‌اثر
    assert await limiter.active_total() == 4


async def test_distributed_limiter_two_instances_share_one_cap():
    """دو نمونه روی یک Redis مشترک (شبیه‌سازی دو worker): مجموع هرگز از ۴ نمی‌گذرد."""
    client = _fake_redis()
    w1 = _limiter(client)
    w2 = _limiter(client)
    users = [uuid.uuid4() for _ in range(5)]
    assert await w1.try_acquire(users[0], uuid.uuid4()) is True
    assert await w1.try_acquire(users[1], uuid.uuid4()) is True
    assert await w2.try_acquire(users[2], uuid.uuid4()) is True
    assert await w2.try_acquire(users[3], uuid.uuid4()) is True
    # سقف کل پر است — نمونهٔ دوم هم جا ندارد
    assert await w2.try_acquire(users[4], uuid.uuid4()) is False
    assert await w1.try_acquire(users[4], uuid.uuid4()) is False
    # کاربرِ دارای اتصال روی worker اول، روی worker دوم هم رد می‌شود
    assert await w2.try_acquire(users[0], uuid.uuid4()) is False
    await w1.release(users[0], uuid.uuid4())  # release اشتباه، بی‌اثر
    assert await w2.active_total() == 4


async def test_distributed_limiter_concurrent_acquires_exactly_four():
    client = _fake_redis()
    limiter = _limiter(client)
    results = await asyncio.gather(
        *(
            limiter.try_acquire(uuid.uuid4(), uuid.uuid4())
            for _ in range(20)
        )
    )
    assert sum(1 for r in results if r) == 4
    assert sum(1 for r in results if not r) == 16
    assert await limiter.active_total() == 4


async def test_distributed_limiter_lease_expiry_without_release():
    """مرگ بدون release: پس از lease اسلات آزاد می‌شود؛ heartbeat مرده زنده نمی‌کند."""
    client = _fake_redis()
    limiter = DistributedLiveStreamLimiter(
        client, max_per_user=1, max_total=2, lease_s=60
    )
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    # now_ms صریح تا تست قطعی باشد (بدون sleep واقعی)
    assert await limiter.try_acquire(u1, s1, now_ms=0) is True
    assert await limiter.try_acquire(u2, s2, now_ms=0) is True
    # heartbeat در ثانیهٔ ۵۹ lease را تا ۱۱۹ تمدید می‌کند
    assert await limiter.heartbeat(u1, s1, now_ms=59_000) is True
    # ثانیهٔ ۶۱: lease دوم منقضی شده، اولی هنوز زنده است
    assert await limiter.try_acquire(u2, uuid.uuid4(), now_ms=61_000) is True
    assert await limiter.try_acquire(uuid.uuid4(), uuid.uuid4(), now_ms=61_000) is False
    # ثانیهٔ ۱۲۰: lease اولی هم منقضی شده
    assert await limiter.try_acquire(uuid.uuid4(), uuid.uuid4(), now_ms=120_000) is True
    # heartbeat پس از release بی‌اثر است
    await limiter.release(u1, s1)
    assert await limiter.heartbeat(u1, s1, now_ms=121_000) is False


class _DeadRedis:
    """کلاینت Redis مرده — هر دستوری خطای اتصال می‌دهد."""

    async def _boom(self, *args, **kwargs):
        raise ConnectionError("redis down (test double)")

    def __getattr__(self, name):
        return self._boom


async def test_gateway_fail_closed_on_redis_outage():
    from app.modules.quran.hifz_ws_contract import LiveStreamLimiter

    local = LiveStreamLimiter(max_per_user=1, max_total=4)
    dead = _DeadRedis()
    gateway = LiveStreamLimiterGateway(
        local=local, redis_client=dead, fail_closed=True, retry_cooldown_s=3600
    )
    u = uuid.uuid4()
    # اتصال تازه در production هنگام قطع → UNAVAILABLE (fail-closed)
    assert await gateway.try_acquire(u, uuid.uuid4()) is LiveAcquire.UNAVAILABLE
    assert local.active_total() == 0  # fallback محلی هم اتفاق نیفتاده

    # همان وضعیت در dev (fail_closed=False) → fallback محلی
    gateway_dev = LiveStreamLimiterGateway(
        local=local, redis_client=dead, fail_closed=False, retry_cooldown_s=3600
    )
    assert await gateway_dev.try_acquire(u, uuid.uuid4()) is LiveAcquire.OK
    assert local.active_total() == 1
    await gateway_dev.release(u, uuid.uuid4())
    assert local.active_total() == 0


async def test_gateway_existing_connection_not_cut_on_outage():
    """اتصالِ از قبل برقرار هنگام قطع Redis قطع نمی‌شود: heartbeat فقط False می‌دهد."""
    client = _fake_redis()
    limiter = _limiter(client)
    from app.modules.quran.hifz_ws_contract import LiveStreamLimiter

    local = LiveStreamLimiter(max_per_user=1, max_total=4)
    gateway = LiveStreamLimiterGateway(
        local=local, redis_client=client, fail_closed=True, retry_cooldown_s=30
    )
    u = uuid.uuid4()
    s = uuid.uuid4()
    assert await gateway.try_acquire(u, s) is LiveAcquire.OK
    # Redis می‌میرد (کلاینت عوض می‌شود)
    gateway._dist._client = _DeadRedis()
    assert await gateway.heartbeat(u, s) is False  # نه استثنا، نه قطع اتصال
    await gateway.release(u, s)  # best-effort، بدون استثنا
    assert await limiter.active_total() == 1  # lease در Redis مرده مانده (60 ثانیه‌ای)


async def test_gateway_local_only_when_no_redis():
    from app.modules.quran.hifz_ws_contract import LiveStreamLimiter

    local = LiveStreamLimiter(max_per_user=1, max_total=2)
    gateway = LiveStreamLimiterGateway(local=local, redis_client=None)
    assert gateway.distributed is False
    u1, u2, u3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert await gateway.try_acquire(u1, uuid.uuid4()) is LiveAcquire.OK
    assert await gateway.try_acquire(u1, uuid.uuid4()) is LiveAcquire.TOO_MANY
    assert await gateway.try_acquire(u2, uuid.uuid4()) is LiveAcquire.OK
    assert await gateway.try_acquire(u3, uuid.uuid4()) is LiveAcquire.TOO_MANY
    assert await gateway.heartbeat(u1, uuid.uuid4()) is True  # محلی: همیشه True


async def test_gateway_two_workers_share_cap():
    """دو دروازه روی یک Redis مشترک: مجموع acquireها هرگز از ۴ نمی‌گذرد."""
    from app.modules.quran.hifz_ws_contract import LiveStreamLimiter

    client = _fake_redis()
    g1 = LiveStreamLimiterGateway(
        local=LiveStreamLimiter(max_per_user=1, max_total=4), redis_client=client
    )
    g2 = LiveStreamLimiterGateway(
        local=LiveStreamLimiter(max_per_user=1, max_total=4), redis_client=client
    )
    results = await asyncio.gather(
        *(g1.try_acquire(uuid.uuid4(), uuid.uuid4()) for _ in range(3)),
        *(g2.try_acquire(uuid.uuid4(), uuid.uuid4()) for _ in range(3)),
    )
    assert sum(1 for r in results if r is LiveAcquire.OK) == 4
    assert sum(1 for r in results if r is LiveAcquire.TOO_MANY) == 2


async def test_local_limiter_release_all():
    from app.modules.quran.hifz_ws_contract import LiveStreamLimiter

    limiter = LiveStreamLimiter(max_per_user=2, max_total=4)
    u = uuid.uuid4()
    assert await limiter.try_acquire(u) is True
    assert await limiter.try_acquire(u) is True
    assert limiter.active_for(u) == 2
    assert await limiter.release_all(u) == 2
    assert limiter.active_for(u) == 0
    assert limiter.active_total() == 0
    assert await limiter.release_all(u) == 0


def test_live_limiter_gateway_singleton_is_local_in_dev():
    """در dev (بدون production) دروازه توزیع‌شده نیست — رفتار امروز می‌ماند."""
    from app.modules.quran.hifz_ws_contract import (
        live_stream_gateway,
        live_stream_limiter,
    )

    assert live_stream_gateway.distributed is False
    assert live_stream_gateway.fail_closed is False
    assert live_stream_gateway.active_total_local() == live_stream_limiter.active_total()
    # توجه: reset_live_stream_limiter_for_tests این‌جا صدا زده
    # نمی‌شود — نمونهٔ سراسری را خالی می‌کند و دروازه‌ای که روتر
    # نگه داشته کهنه می‌شود (ساختهٔ تازه fallback محلیِ خودش را
    # می‌گیرد، نه live_stream_limiter واقعی).


# ---------------------------------------------------------------------------
# P1-4 — سیاست نگهداری
# ---------------------------------------------------------------------------


def test_retention_settings_registered_and_validated():
    from app.core.platform_settings import SETTING_DEFS, _validate_json_setting

    keys = [
        "quran.hifz_retention.attempts_days",
        "quran.hifz_retention.mistakes_days",
        "quran.hifz_retention.tests_days",
        "quran.hifz_retention.reviews_inactive_days",
        "quran.hifz_retention.tasmi_days",
        "quran.hifz_retention.plans_days",
    ]
    for key in keys:
        assert key in SETTING_DEFS, key  # درس PR #100: کلید تازه باید ثبت شود
        assert _validate_json_setting(key, None) is None
        assert _validate_json_setting(key, 30) == 30
        assert _validate_json_setting(key, 1) == 1
        assert _validate_json_setting(key, 3650) == 3650
        for bad in (0, -1, 3651):
            with pytest.raises(ValueError, match="hifz_retention"):
                _validate_json_setting(key, bad)
        for bad in ("30", 1.5, True, [], {}):
            # TRY004: نوعِ اشتباه TypeError می‌گیرد (مسیر PUT هر دو را 400 می‌کند).
            with pytest.raises(TypeError, match="hifz_retention"):
                _validate_json_setting(key, bad)


async def test_retention_defaults_are_unlimited(tc):
    """پیش‌فرضِ همه null است؛ purge با سیاستِ پیش‌فرض هیچ ردیفی نمی‌برد."""
    from app.modules.quran import hifz_retention

    async with tc["maker"]() as db:
        policy = await hifz_retention.get_retention_policy(db)
        assert policy == {k: None for k in hifz_retention.RETENTION_KEYS}

    email = f"p14-default-{uuid.uuid4().hex[:8]}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        expected = await _seed_full(db, uid, "DEF")
        counts = await hifz_retention.purge_expired_hifz_data(db)
        assert counts == {k: 0 for k in counts}
        after = await _counts_for(db, uid)
        assert after == expected  # همهٔ ردیف‌ها سر جایشان‌اند


async def test_retention_tests_rule_only_completed_old(tc):
    from app.modules.quran import hifz_retention

    email = f"p14-tests-{uuid.uuid4().hex[:8]}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        old_test = HifzTest(
            user_id=uid, surah_start=1, surah_end=1,
            status="completed", completed_at=OLD,
        )
        db.add(old_test)
        await db.flush()
        db.add(HifzTestQuestion(
            test_id=old_test.id, position=0, surah=1, ayah_start=1, ayah_end=1
        ))
        young_test = HifzTest(
            user_id=uid, surah_start=2, surah_end=2,
            status="completed", completed_at=YOUNG,
        )
        db.add(young_test)
        await db.flush()
        db.add(HifzTestQuestion(
            test_id=young_test.id, position=0, surah=2, ayah_start=1, ayah_end=1
        ))
        running_test = HifzTest(
            user_id=uid, surah_start=3, surah_end=3, status="in_progress"
        )
        db.add(running_test)
        await db.commit()

        policy = {"quran.hifz_retention.tests_days": 30}
        # dry-run: فقط شمارش، بدون حذف. شمارش سراسری است (همهٔ کاربران)
        # پس فقط «دست‌کم ۱» assert می‌شود؛ دقت با ردیف‌های همین کاربر است.
        dry = await hifz_retention.purge_expired_hifz_data(
            db, policy=policy, dry_run=True, now=NOW
        )
        assert dry["hifz_tests"] >= 1
        assert dry["hifz_test_questions"] >= 1
        assert (await db.execute(
            select(func.count()).select_from(HifzTest).where(HifzTest.user_id == uid)
        )).scalar_one() == 3
        # حذف واقعی: فقط آزمونِ قدیمیِ تکمیل‌شده + سؤال‌هایش
        real = await hifz_retention.purge_expired_hifz_data(
            db, policy=policy, dry_run=False, now=NOW
        )
        assert real["hifz_tests"] >= 1
        assert real["hifz_test_questions"] >= 1
        remaining = (await db.execute(
            select(HifzTest.status).where(HifzTest.user_id == uid)
        )).scalars().all()
        assert sorted(remaining) == ["completed", "in_progress"]
        gone = (await db.execute(
            select(HifzTest).where(HifzTest.id == old_test.id)
        )).scalar_one_or_none()
        assert gone is None
        assert (await db.execute(
            select(HifzTest).where(HifzTest.id == young_test.id)
        )).scalar_one_or_none() is not None


async def test_retention_attempts_rule_deletes_children_and_keeps_young(tc):
    from app.modules.quran import hifz_retention

    email = f"p14-attempts-{uuid.uuid4().hex[:8]}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        old_attempt = HifzAttempt(
            user_id=uid, surah=1, status="completed", completed_at=OLD
        )
        db.add(old_attempt)
        await db.flush()
        db.add(HifzWordScore(
            attempt_id=old_attempt.id, surah=1, ayah=1, word_index=0,
            expected_text="x", status="correct",
        ))
        db.add(HifzMistake(
            attempt_id=old_attempt.id, user_id=uid, surah=1, ayah=1,
            mistake_type="wrong_word", expected_text="x",
        ))
        young_attempt = HifzAttempt(
            user_id=uid, surah=2, status="completed", completed_at=YOUNG
        )
        db.add(young_attempt)
        await db.flush()
        db.add(HifzWordScore(
            attempt_id=young_attempt.id, surah=2, ayah=1, word_index=0,
            expected_text="y", status="correct",
        ))
        db.add(HifzAttempt(user_id=uid, surah=3, status="in_progress"))
        await db.commit()

        counts = await hifz_retention.purge_expired_hifz_data(
            db,
            policy={"quran.hifz_retention.attempts_days": 30},
            now=NOW,
        )
        # شمارش سراسری است — دقت با ردیف‌های همین کاربر سنجیده می‌شود.
        assert counts["hifz_attempts"] >= 1
        assert counts["hifz_word_scores"] >= 1
        assert counts["hifz_mistakes"] >= 1
        assert (await db.execute(
            select(HifzAttempt).where(HifzAttempt.id == old_attempt.id)
        )).scalar_one_or_none() is None
        left = (await db.execute(
            select(HifzAttempt.surah).where(HifzAttempt.user_id == uid)
        )).scalars().all()
        assert sorted(left) == [2, 3]  # جوان + در حال اجرا مانده‌اند
        own_scores = (await db.execute(
            select(func.count()).select_from(HifzWordScore).where(
                HifzWordScore.attempt_id.in_(
                    select(HifzAttempt.id).where(HifzAttempt.user_id == uid)
                )
            )
        )).scalar_one()
        assert own_scores == 1


async def test_retention_never_touches_active_or_settings(tc):
    """برنامهٔ فعال، نشستِ در حال اجرا و ترجیح‌ها هرگز با گذر زمان حذف نمی‌شوند."""
    from app.modules.quran import hifz_retention

    email = f"p14-active-{uuid.uuid4().hex[:8]}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        db.add(HifzPlan(
            user_id=uid, title="active plan", kind="memorize",
            start_surah=1, start_ayah=1, end_surah=1, end_ayah=7,
            status="active",
        ))
        db.add(HifzAttempt(user_id=uid, surah=1, status="in_progress"))
        db.add(HifzUserSettings(user_id=uid))
        db.add(HifzReview(user_id=uid, surah=1, ayah=1, last_reviewed_at=NOW))
        await db.commit()
        policy = {
            "quran.hifz_retention.plans_days": 30,
            "quran.hifz_retention.attempts_days": 30,
            "quran.hifz_retention.reviews_inactive_days": 30,
        }
        counts = await hifz_retention.purge_expired_hifz_data(
            db, policy=policy, now=NOW
        )
        assert sum(counts.values()) == 0
        assert (await db.execute(
            select(func.count()).select_from(HifzPlan).where(HifzPlan.user_id == uid)
        )).scalar_one() == 1


async def test_retention_reviews_inactive_rule(tc):
    from app.modules.quran import hifz_retention

    email = f"p14-srs-{uuid.uuid4().hex[:8]}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        db.add(HifzReview(
            user_id=uid, surah=1, ayah=1, last_reviewed_at=OLD,
        ))
        db.add(HifzReview(
            user_id=uid, surah=1, ayah=2, last_reviewed_at=YOUNG,
        ))
        db.add(HifzReview(user_id=uid, surah=1, ayah=3))  # هرگز مرور نشده
        await db.commit()
        counts = await hifz_retention.purge_expired_hifz_data(
            db,
            policy={"quran.hifz_retention.reviews_inactive_days": 30},
            now=NOW,
        )
        # قدیمی حذف می‌شود؛ جوان می‌ماند؛ «هرگز مرور نشده» ساعت
        # انقضایش created_at است (الآن) پس می‌ماند. شمارش سراسری است.
        assert counts["hifz_reviews"] >= 1
        left = (await db.execute(
            select(HifzReview.ayah).where(HifzReview.user_id == uid)
        )).scalars().all()
        assert sorted(left) == [2, 3]


# ---------------------------------------------------------------------------
# P1-5 — حذف یک‌جا (فقط دامنهٔ hifz_only)
# ---------------------------------------------------------------------------


async def test_purge_preview_matches_deleted_and_other_user_intact(tc):
    from app.modules.quran import hifz_purge

    tag_a = uuid.uuid4().hex[:8]
    tag_b = uuid.uuid4().hex[:8]
    email_a = f"p15-a-{tag_a}@example.com"
    email_b = f"p15-b-{tag_b}@example.com"
    await _user_token(tc["client"], email_a)
    await _user_token(tc["client"], email_b)
    uid_a = await _user_id(tc, email_a)
    uid_b = await _user_id(tc, email_b)
    async with tc["maker"]() as db:
        expected_a = await _seed_full(db, uid_a, tag_a)
        expected_b = await _seed_full(db, uid_b, tag_b)
        user_a = (await db.execute(select(User).where(User.id == uid_a))).scalar_one()
        preview = await hifz_purge.preview_hifz_data_counts(db, uid_a)
        assert preview == expected_a

        deleted = await hifz_purge.purge_hifz_data(
            db, user_a, idempotency_key=str(uuid.uuid4())
        )
        assert deleted == preview == expected_a
        assert await _counts_for(db, uid_a) == {k: 0 for k in expected_a}
        # کاربر B ردیف‌به‌ردیف دست‌نخورده
        assert await _counts_for(db, uid_b) == expected_b
        heard_b = (await db.execute(
            select(HifzWordScore.heard).where(
                HifzWordScore.heard == f"SENTINEL_HEARD_{tag_b}"
            )
        )).scalars().all()
        assert heard_b == [f"SENTINEL_HEARD_{tag_b}"]
        title_b = (await db.execute(
            select(HifzPlan.title).where(HifzPlan.user_id == uid_b)
        )).scalars().all()
        assert title_b == [f"SENTINEL_TITLE_{tag_b}"]


async def test_purge_audit_contains_counts_only(tc):
    from app.modules.quran import hifz_purge

    tag = uuid.uuid4().hex[:8]
    email = f"p15-audit-{tag}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        await _seed_full(db, uid, tag)
        user = (await db.execute(select(User).where(User.id == uid))).scalar_one()
        await hifz_purge.purge_hifz_data(
            db, user, idempotency_key=str(uuid.uuid4())
        )
        audits = (await db.execute(
            select(AuditLog).where(
                AuditLog.action == "hifz.data_purged",
                AuditLog.entity_id == str(uid),
            )
        )).scalars().all()
        assert len(audits) == 1
        blob = json.dumps(audits[0].new_values, ensure_ascii=False)
        # هیچ رشته‌ای از محتوای کاربر در audit نیست
        assert f"SENTINEL_HEARD_{tag}" not in blob
        assert f"SENTINEL_REFLECTION_{tag}" not in blob
        assert f"SENTINEL_TITLE_{tag}" not in blob
        assert audits[0].new_values["scope"] == "hifz_only"
        assert audits[0].new_values["deleted_counts"]["hifz_attempts"] == 1
        assert audits[0].new_values["deleted_counts"]["hifz_reviews"] == 1
        events = (await db.execute(
            select(DomainEvent).where(
                DomainEvent.event_type == "user.hifz_data_purged",
                DomainEvent.aggregate_id == str(uid),
            )
        )).scalars().all()
        assert len(events) == 1
        assert events[0].payload == {"scope": "hifz_only"}


async def test_purge_is_idempotent(tc):
    from app.modules.quran import hifz_purge

    tag = uuid.uuid4().hex[:8]
    email_a = f"p15-idem-a-{tag}@example.com"
    email_b = f"p15-idem-b-{tag}@example.com"
    await _user_token(tc["client"], email_a)
    await _user_token(tc["client"], email_b)
    uid_a = await _user_id(tc, email_a)
    uid_b = await _user_id(tc, email_b)
    async with tc["maker"]() as db:
        expected_b = await _seed_full(db, uid_b, tag)
        await _seed_full(db, uid_a, tag)
        user_a = (await db.execute(select(User).where(User.id == uid_a))).scalar_one()
        key = str(uuid.uuid4())
        first = await hifz_purge.purge_hifz_data(db, user_a, idempotency_key=key)
        assert sum(first.values()) == 10
        second = await hifz_purge.purge_hifz_data(db, user_a, idempotency_key=key)
        assert second == {k: 0 for k in first}
        assert await _counts_for(db, uid_b) == expected_b


async def test_purge_rollback_on_error(tc, monkeypatch):
    """خطا پیش از commit → همهٔ جدول‌های کاربر کامل برمی‌گردند."""
    from app.modules.quran import hifz_purge

    tag = uuid.uuid4().hex[:8]
    email = f"p15-rollback-{tag}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        expected = await _seed_full(db, uid, tag)
        user = (await db.execute(select(User).where(User.id == uid))).scalar_one()

        async def _boom(*args, **kwargs):
            raise RuntimeError("audit down (test double)")

        monkeypatch.setattr(hifz_purge, "log_audit", _boom)
        with pytest.raises(RuntimeError, match="audit down"):
            await hifz_purge.purge_hifz_data(
                db, user, idempotency_key=str(uuid.uuid4())
            )
        # هیچ جدولی نیمه‌حذف نیست
        assert await _counts_for(db, uid) == expected


async def test_purge_releases_live_slots(tc):
    from app.modules.quran.hifz_ws_contract import live_stream_gateway

    tag = uuid.uuid4().hex[:8]
    email = f"p15-slots-{tag}@example.com"
    await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    session_id = uuid.uuid4()
    assert await live_stream_gateway.try_acquire(uid, session_id) is LiveAcquire.OK
    assert live_stream_gateway.active_total_local() >= 1
    async with tc["maker"]() as db:
        from app.modules.quran import hifz_purge

        user = (await db.execute(select(User).where(User.id == uid))).scalar_one()
        await hifz_purge.purge_hifz_data(
            db, user, idempotency_key=str(uuid.uuid4())
        )
    assert live_stream_gateway.active_total_local() == 0


async def test_purge_http_preview_and_purge(tc):
    tag = uuid.uuid4().hex[:8]
    email = f"p15-http-{tag}@example.com"
    token = await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)
    async with tc["maker"]() as db:
        expected = await _seed_full(db, uid, tag)

    r = await tc["client"].get(f"{HIFZ}/data/preview", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "hifz_only"
    assert body["counts"] == expected
    assert body["total"] == 10

    r = await tc["client"].post(
        f"{HIFZ}/data/purge",
        json={"confirm": True, "idempotency_key": str(uuid.uuid4())},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == expected
    assert r.json()["total"] == 10

    r = await tc["client"].get(f"{HIFZ}/data/preview", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0


async def test_purge_http_requires_confirm_and_rejects_extras(tc):
    tag = uuid.uuid4().hex[:8]
    email = f"p15-http2-{tag}@example.com"
    token = await _user_token(tc["client"], email)
    uid = await _user_id(tc, email)

    # بدون تأیید صریح → ۴۲۲
    r = await tc["client"].post(
        f"{HIFZ}/data/purge",
        json={"confirm": False, "idempotency_key": str(uuid.uuid4())},
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text
    # user_id در body → ۴۲۲ (extra="forbid" — IDOR ناممکن است)
    r = await tc["client"].post(
        f"{HIFZ}/data/purge",
        json={
            "confirm": True,
            "idempotency_key": str(uuid.uuid4()),
            "user_id": str(uid),
        },
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text
    # scope=quran_all → ۴۲۲ (دامنهٔ B ساخته نشده است)
    r = await tc["client"].post(
        f"{HIFZ}/data/purge",
        json={
            "confirm": True,
            "idempotency_key": str(uuid.uuid4()),
            "scope": "quran_all",
        },
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text
    # بدون توکن → ۴۰۱
    r = await tc["client"].post(
        f"{HIFZ}/data/purge",
        json={"confirm": True, "idempotency_key": str(uuid.uuid4())},
    )
    assert r.status_code == 401, r.text


async def test_purge_http_rate_limit(tc):
    """purge چهارم در یک ساعت → 429 (۳ بار در ساعت به‌ازای هر نشست)."""
    tag = uuid.uuid4().hex[:8]
    email = f"p15-rl-{tag}@example.com"
    token = await _user_token(tc["client"], email)
    for i in range(3):
        r = await tc["client"].post(
            f"{HIFZ}/data/purge",
            json={"confirm": True, "idempotency_key": str(uuid.uuid4())},
            headers=_auth(token),
        )
        assert r.status_code == 200, f"purge {i+1}: {r.text}"
    r = await tc["client"].post(
        f"{HIFZ}/data/purge",
        json={"confirm": True, "idempotency_key": str(uuid.uuid4())},
        headers=_auth(token),
    )
    assert r.status_code == 429, r.text
