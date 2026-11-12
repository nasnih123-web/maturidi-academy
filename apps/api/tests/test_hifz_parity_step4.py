"""تست‌های گام ۴ برابری با ترتیل — ایراد ۸ (ابزارهای انگیزشی/مروری).

پوشش:
- هدف روزانه در تنظیم‌های کاربر: پیش‌فرض ۰ (بدون هدف)، به‌روزرسانی
  جزئی بدون دست‌خوردن بقیهٔ کلیدها، اعتبارسنجی بازه (۴۲۲).
- فعالیت روزانه (نقشهٔ مرور): شمارش واقعی نشست/کلمه/مرور و آیه‌های
  متمایز هر روز از ردیف‌های کاشته‌شده با زمان‌های کنترل‌شده.
- رکورد پیوستگی: جاری از امروز/دیروز شمرده می‌شود و با یک روز
  خالی می‌شکند؛ بهترین رکورد روی کل تاریخچه است، نه بازهٔ نمایش.
- پیشرفت هدف امروز: اجتماع آیه‌های نمره‌گرفته و مرورشدهٔ امروز؛
  goal_met فقط وقتی هدف > ۰ و پیشرفت به آن رسیده باشد.
- داشبورد همان رکورد و هدف را در فیلدهای تازه‌اش برمی‌گرداند.
- بدون توکن: ۴۰۱.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.models import HifzAttempt, HifzReview, HifzWordScore, User

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"


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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _at(days_ago: int, hour: int = 10) -> datetime:
    base = datetime.now(UTC) - timedelta(days=days_ago)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


async def _seed_activity(tc, email: str) -> None:
    """فعالیت کنترل‌شده: امروز، دیروز (فقط مرور)، ۳ و ۴ و ۵ روز پیش.

    روزهای فعال: {۰، ۱، ۳، ۴، ۵} روز پیش → رکورد جاری ۲ (امروز و
    دیروز)، بهترین رکورد ۳ (سه روز پیاپیِ ۳ تا ۵ روز پیش)، و روز
    ۲ روز پیش خالی است و رکورد را می‌شکند.
    آیه‌های امروز: نمره روی ۱۱۲:۱ و ۱۱۲:۲ + مرورِ امروز روی ۱۱۲:۲
    → اجتماع = ۲ آیه.
    """
    async with tc["maker"]() as session:
        user = (
            await session.execute(select(User).where(User.email == email))
        ).scalars().first()
        assert user is not None

        def attempt(days_ago: int) -> HifzAttempt:
            row = HifzAttempt(
                user_id=user.id,
                surah=112,
                status="completed",
                created_at=_at(days_ago),
                updated_at=_at(days_ago),
            )
            session.add(row)
            return row

        def words(att: HifzAttempt, ayah: int, count: int, days_ago: int):
            for i in range(count):
                session.add(
                    HifzWordScore(
                        attempt_id=att.id,
                        surah=112,
                        ayah=ayah,
                        word_index=i,
                        expected_text="x",
                        status="correct",
                        created_at=_at(days_ago, 11),
                        updated_at=_at(days_ago, 11),
                    )
                )

        today_att = attempt(0)
        att3 = attempt(3)
        att4 = attempt(4)
        att5 = attempt(5)
        await session.flush()  # شناسهٔ نشست‌ها قبل از ارجاع نمره‌ها.
        words(today_att, 1, 3, 0)
        words(today_att, 2, 2, 0)
        words(att3, 3, 4, 3)
        words(att4, 4, 1, 4)
        words(att5, 1, 1, 5)
        # مرورها: دیروز (۱۱۲:۱) و امروز (۱۱۲:۱ — همان آیهٔ نمره‌گرفته).
        session.add(
            HifzReview(
                user_id=user.id, surah=112, ayah=1,
                last_reviewed_at=_at(1, 9),
            )
        )
        session.add(
            HifzReview(
                user_id=user.id, surah=112, ayah=2,
                last_reviewed_at=_at(0, 9),
            )
        )
        await session.commit()


async def test_daily_goal_settings_roundtrip(tc):
    token = await _user_token(tc["client"], "p4-goal@example.com")
    r = await tc["client"].get(f"{HIFZ}/settings", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["daily_goal_ayahs"] == 0
    # به‌روزرسانی جزئی: فقط هدف عوض می‌شود، بقیه دست نمی‌خورند.
    r = await tc["client"].put(
        f"{HIFZ}/settings",
        json={"daily_goal_ayahs": 5},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["daily_goal_ayahs"] == 5
    assert body["mistake_detection"] is True
    assert body["freeze_on_error"] is False
    r = await tc["client"].get(f"{HIFZ}/settings", headers=_auth(token))
    assert r.json()["daily_goal_ayahs"] == 5
    # بازهٔ نامعتبر → ۴۲۲.
    for bad in (-1, 6237):
        r = await tc["client"].put(
            f"{HIFZ}/settings",
            json={"daily_goal_ayahs": bad},
            headers=_auth(token),
        )
        assert r.status_code == 422, (bad, r.text)


async def test_activity_streaks_heatmap_and_goal(tc):
    token = await _user_token(tc["client"], "p4-activity@example.com")
    await _seed_activity(tc, "p4-activity@example.com")

    r = await tc["client"].get(f"{HIFZ}/activity?days=7", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["days"]) == 7
    assert body["streak_current"] == 2, body
    assert body["streak_best"] == 3, body
    assert body["goal_ayahs"] == 0
    assert body["today_ayahs"] == 2
    assert body["goal_met"] is False

    by_date = {d["date"]: d for d in body["days"]}
    today = datetime.now(UTC).date()
    t = by_date[str(today)]
    assert t["attempts"] == 1 and t["graded_words"] == 5 and t["reviews"] == 1
    assert t["ayahs"] == 2
    y = by_date[str(today - timedelta(days=1))]
    assert y["reviews"] == 1 and y["attempts"] == 0 and y["ayahs"] == 1
    gap = by_date[str(today - timedelta(days=2))]
    assert gap["attempts"] == 0 and gap["graded_words"] == 0 and gap["ayahs"] == 0
    d3 = by_date[str(today - timedelta(days=3))]
    assert d3["graded_words"] == 4 and d3["ayahs"] == 1

    # هدف ۲ آیه → امروز کامل است؛ هدف ۳ → نه.
    r = await tc["client"].put(
        f"{HIFZ}/settings", json={"daily_goal_ayahs": 2}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    r = await tc["client"].get(f"{HIFZ}/activity?days=7", headers=_auth(token))
    assert r.json()["goal_ayahs"] == 2 and r.json()["goal_met"] is True
    r = await tc["client"].put(
        f"{HIFZ}/settings", json={"daily_goal_ayahs": 3}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    r = await tc["client"].get(f"{HIFZ}/activity?days=7", headers=_auth(token))
    assert r.json()["goal_met"] is False

    # داشبورد همان اعداد را در فیلدهای تازه برمی‌گرداند.
    r = await tc["client"].get(f"{HIFZ}/dashboard", headers=_auth(token))
    assert r.status_code == 200, r.text
    dash = r.json()
    assert dash["streak_current"] == 2 and dash["streak_best"] == 3
    assert dash["goal_ayahs"] == 3 and dash["goal_today_ayahs"] == 2
    assert dash["goal_met"] is False


async def test_activity_requires_auth_and_empty_history(tc):
    r = await tc["client"].get(f"{HIFZ}/activity")
    assert r.status_code == 401
    token = await _user_token(tc["client"], "p4-empty@example.com")
    r = await tc["client"].get(f"{HIFZ}/activity", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["days"]) == 371
    assert body["streak_current"] == 0 and body["streak_best"] == 0
    assert body["today_ayahs"] == 0 and body["goal_met"] is False
    assert all(d["graded_words"] == 0 for d in body["days"])
