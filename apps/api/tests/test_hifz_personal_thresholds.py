"""آستانه‌های شخصی حفاظ (پیشنهاد ۱۳).

کالیبراسیون فقط از اعتراضِ صریح مشتق می‌شود: کاربر باید دست‌کم
نیمی از «نزدیک»ها (یا «غلط»ها) را اعتراض کرده باشد، با دست‌کم
۱۰۰ کلمهٔ نمره‌خورده و ۱۰ کلمه در هر دسته. ضد رانش: هر
کالیبراسیون از کل تاریخچه از صفر حساب می‌شود.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.models import HifzAttempt, HifzUserSettings, HifzWordScore, User
from app.modules.quran import hifz_service

_PROB = {"correct": 0.95, "close": 0.65, "wrong": 0.30, "skipped": 0.0}


async def _seed(db, *, n_correct=0, n_close=0, n_close_disputed=0,
                n_wrong=0, n_wrong_disputed=0):
    """کاربر + نشست + نمره‌های کلمه با وضعیت/اعتراض دلخواه."""
    user = User(
        full_name="کاربر تست کالیبراسیون",
        email=f"cal-{uuid.uuid4().hex[:12]}@example.com",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    attempt = HifzAttempt(user_id=user.id, surah=112)
    db.add(attempt)
    await db.flush()
    idx = 0

    def _add(status, disputed):
        nonlocal idx
        db.add(
            HifzWordScore(
                attempt_id=attempt.id,
                surah=112,
                ayah=1,
                word_index=idx,
                expected_text="كلمه",
                status=status,
                prob=_PROB[status],
                disputed=disputed,
            )
        )
        idx += 1

    for _ in range(n_correct):
        _add("correct", False)
    for i in range(n_close):
        _add("close", i < n_close_disputed)
    for i in range(n_wrong):
        _add("wrong", i < n_wrong_disputed)
    await db.commit()
    return user, attempt


@pytest.mark.asyncio
async def test_no_calibration_below_minimum_history(db_session):
    """کمتر از ۱۰۰ کلمه: اعتراض‌ها نویزند — هیچ شخصی‌سازی‌ای."""
    user, _ = await _seed(
        db_session, n_correct=50, n_close=5, n_close_disputed=3
    )
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (None, None)
    row = await db_session.get(HifzUserSettings, user.id)
    assert row is not None
    assert row.green_threshold is None and row.amber_threshold is None


@pytest.mark.asyncio
async def test_close_disputes_calibrate_green(db_session):
    """۶۰٪ اعتراض روی «نزدیک»ها (۱۰ کلمه، ۱۰۰ کلمه کل) → green=۰٫۶۵."""
    user, _ = await _seed(
        db_session, n_correct=90, n_close=10, n_close_disputed=6
    )
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (0.65, None)
    green, amber = await hifz_service.get_thresholds(db_session, user.id)
    assert (green, amber) == (0.65, 0.5)


@pytest.mark.asyncio
async def test_wrong_disputes_calibrate_amber(db_session):
    """۵۰٪ اعتراض روی «غلط»ها (مرز) → amber=۰٫۳۰، green سر جایش."""
    user, _ = await _seed(
        db_session, n_correct=90, n_wrong=10, n_wrong_disputed=5
    )
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (None, 0.30)
    green, amber = await hifz_service.get_thresholds(db_session, user.id)
    assert (green, amber) == (0.8, 0.30)


@pytest.mark.asyncio
async def test_low_dispute_rate_keeps_global(db_session):
    """۴۰٪ اعتراض روی «نزدیک»ها — زیر آستانهٔ ۵۰٪ — سراسری می‌ماند."""
    user, _ = await _seed(
        db_session, n_correct=90, n_close=10, n_close_disputed=4
    )
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (None, None)


@pytest.mark.asyncio
async def test_recalibration_returns_to_global_when_disputes_fade(db_session):
    """ضد رانش: وقتی اعتراض‌ها با «نزدیک»های بی‌اعتراض رقیق شوند،
    کالیبراسیونِ بعدی به سراسری برمی‌گردد، نه اینکه پایین‌تر برود."""
    user, attempt = await _seed(
        db_session, n_correct=90, n_close=10, n_close_disputed=6
    )
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (0.65, None)
    # ۲۰ «نزدیک» تازهٔ بی‌اعتراض: سهم اعتراض ۶/۳۰ = ۲۰٪ می‌شود.
    for i in range(20):
        db_session.add(
            HifzWordScore(
                attempt_id=attempt.id,
                surah=112,
                ayah=1,
                word_index=100 + i,
                expected_text="كلمه",
                status="close",
                prob=0.65,
                disputed=False,
            )
        )
    await db_session.commit()
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (None, None)
    assert await hifz_service.get_thresholds(db_session, user.id) == (0.8, 0.5)


@pytest.mark.asyncio
async def test_global_thresholds_unaffected_by_other_users(db_session):
    """شخصی‌سازی یک کاربر، سراسری و کاربر دیگر را نمی‌خورد."""
    user, _ = await _seed(
        db_session, n_correct=90, n_close=10, n_close_disputed=6
    )
    other, _ = await _seed(db_session, n_correct=100)
    assert await hifz_service.calibrate_user_thresholds(
        db_session, user.id
    ) == (0.65, None)
    assert await hifz_service.get_thresholds(db_session) == (0.8, 0.5)
    assert await hifz_service.get_thresholds(db_session, other.id) == (0.8, 0.5)
    assert await hifz_service.get_thresholds(db_session, user.id) == (0.65, 0.5)


@pytest.mark.asyncio
async def test_invalid_stored_thresholds_fall_back_to_global(db_session):
    """مقدار شخصیِ خارج از باند مجاز (green زیر کف، amber وارونه)
    نادیده گرفته می‌شود — هرگز ۵۰۰ و هرگز آستانهٔ وارونه."""
    user, _ = await _seed(db_session, n_correct=100)
    row = HifzUserSettings(
        user_id=user.id, green_threshold=0.4, amber_threshold=0.9
    )
    db_session.add(row)
    await db_session.commit()
    assert await hifz_service.get_thresholds(db_session, user.id) == (0.8, 0.5)


@pytest.mark.asyncio
async def test_dispute_word_triggers_calibration(db_session):
    """اعتراضِ تازه، کالیبراسیون را می‌اندازد: پنجمین اعتراض از
    ۱۰ «نزدیک» (۵۰٪) پس از dispute_word، green را ۰٫۶۵ می‌کند."""
    user, attempt = await _seed(
        db_session, n_correct=90, n_close=10, n_close_disputed=4
    )
    assert await hifz_service.get_thresholds(db_session, user.id) == (0.8, 0.5)
    from sqlalchemy import select

    rows = (
        await db_session.execute(
            select(HifzWordScore).where(
                HifzWordScore.attempt_id == attempt.id,
                HifzWordScore.status == "close",
                HifzWordScore.disputed.is_(False),
            )
        )
    ).scalars().all()
    assert rows
    await hifz_service.dispute_word(db_session, user, attempt.id, rows[0].id)
    assert await hifz_service.get_thresholds(db_session, user.id) == (0.65, 0.5)
