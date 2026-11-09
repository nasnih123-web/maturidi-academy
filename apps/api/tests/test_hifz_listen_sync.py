"""تست‌های موقعیت شنیدنِ سرور-side — مأموریت تکمیلی حفاظ، بخش ۵.

پوشش:
- GET بدون ردیف → null (نه ۴۰۴)؛ بدون توکن → ۴۰۱.
- PUT ساخت + GET بازخوانی (همهٔ فیلدها: قاری، سوره+آیه، میلی‌ثانیه،
  سرعت، حالت تکرار و بازه).
- اعتبارسنجی: قاری ناشناخته، سرعت خارج از شش‌تایی ترتیل، سوره/آیهٔ
  خارج از بازه، حالت تکرار نامعتبر، بازهٔ ناقص/وارونه/بی‌جا → ۴۲۲.
- قانون ادغام last-write-wins: نوشتهٔ کهنه (updated_at قدیمی‌تر)
  رد می‌شود و حالت سرور برمی‌گردد؛ نوشتهٔ تازه‌تر (یا بدون
  updated_at) اعمال می‌شود.
- ایزولاسیون کاربر: کاربر دوم null می‌بیند و نوشتنش ردیف کاربر اول
  را عوض نمی‌کند.
- سناریوی کامل دودستگاهی: دستگاه ۱ ذخیره می‌کند، دستگاه ۲ (ورود دومِ
  همان کاربر) همان موقعیت را می‌خواند و از همان‌جا ادامه می‌دهد؛
  سپس دستگاه ۲ تازه‌تر می‌نویسد و دستگاه ۱ آن را می‌بیند.
- جدایی از نشست تمرین: ثبت موقعیت نشست، موقعیت شنیدن را عوض نمی‌کند.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

BASE = "/api/v1"
HIFZ = f"{BASE}/quran/hifz"
LISTEN = f"{HIFZ}/listen-position"


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


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


def _pos(**overrides) -> dict:
    body = {
        "reciter": "alafasy",
        "surah": 2,
        "ayah": 5,
        "progress_ms": 12345,
        "speed": 1.25,
        "repeat_mode": "ayah",
        "repeat_ayah": 3,
        "repeat_range_count": 1,
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_listen_position_unauthenticated(tc):
    client = tc["client"]
    r = await client.get(LISTEN)
    assert r.status_code == 401, r.text
    r = await client.put(LISTEN, json=_pos())
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_listen_position_empty_then_roundtrip(tc):
    client = tc["client"]
    token = await _user_token(client, "listen-a@test.example")
    r = await client.get(LISTEN, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json() is None

    r = await client.put(LISTEN, json=_pos(), headers=_auth(token))
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["applied"] is True
    assert saved["conflict"] is False
    pos = saved["position"]
    assert pos["reciter"] == "alafasy"
    assert pos["surah"] == 2 and pos["ayah"] == 5
    assert pos["progress_ms"] == 12345
    assert pos["speed"] == 1.25
    assert pos["repeat_mode"] == "ayah" and pos["repeat_ayah"] == 3
    assert pos["updated_at"] is not None

    r = await client.get(LISTEN, headers=_auth(token))
    assert r.status_code == 200, r.text
    got = r.json()
    assert got is not None
    assert got["surah"] == 2 and got["ayah"] == 5
    assert got["progress_ms"] == 12345 and got["speed"] == 1.25


@pytest.mark.asyncio
async def test_listen_position_range_roundtrip(tc):
    client = tc["client"]
    token = await _user_token(client, "listen-b@test.example")
    r = await client.put(
        LISTEN,
        json=_pos(
            repeat_mode="range",
            repeat_ayah=2,
            repeat_range_start=3,
            repeat_range_end=7,
            repeat_range_count=4,
        ),
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    pos = r.json()["position"]
    assert pos["repeat_mode"] == "range"
    assert pos["repeat_range_start"] == 3
    assert pos["repeat_range_end"] == 7
    assert pos["repeat_range_count"] == 4


@pytest.mark.asyncio
async def test_listen_position_validation(tc):
    client = tc["client"]
    token = await _user_token(client, "listen-c@test.example")
    bad = [
        _pos(reciter="no_such_reciter"),
        _pos(speed=2.0),
        _pos(speed=0.9),
        _pos(surah=115),
        _pos(surah=0),
        _pos(ayah=287),
        _pos(progress_ms=-1),
        _pos(repeat_mode="forever"),
        _pos(repeat_mode="range"),  # بازهٔ ناقص
        _pos(repeat_mode="range", repeat_range_start=7, repeat_range_end=3),
        _pos(repeat_mode="off", repeat_range_start=1, repeat_range_end=2),
        _pos(repeat_ayah=21),
    ]
    for body in bad:
        r = await client.put(LISTEN, json=body, headers=_auth(token))
        assert r.status_code == 422, (body, r.text)


@pytest.mark.asyncio
async def test_listen_position_last_write_wins(tc):
    client = tc["client"]
    token = await _user_token(client, "listen-d@test.example")
    now = datetime.now(UTC)
    # نوشتهٔ تازه با مُهر زمانی صریح.
    r = await client.put(
        LISTEN,
        json=_pos(surah=2, ayah=5, updated_at=_iso(now)),
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    # نوشتهٔ کهنه‌تر رد می‌شود و حالت سرور برمی‌گردد.
    r = await client.put(
        LISTEN,
        json=_pos(surah=3, ayah=9, updated_at=_iso(now - timedelta(hours=1))),
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    stale = r.json()
    assert stale["applied"] is False
    assert stale["conflict"] is True
    assert stale["position"]["surah"] == 2
    assert stale["position"]["ayah"] == 5
    # نوشتهٔ تازه‌تر اعمال می‌شود.
    r = await client.put(
        LISTEN,
        json=_pos(surah=3, ayah=9, updated_at=_iso(now + timedelta(hours=1))),
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    assert r.json()["position"]["surah"] == 3
    # بدون updated_at یعنی «تازه‌ترین» و اعمال می‌شود.
    r = await client.put(
        LISTEN, json=_pos(surah=4, ayah=1), headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    assert r.json()["position"]["surah"] == 4


@pytest.mark.asyncio
async def test_listen_position_user_isolation(tc):
    client = tc["client"]
    token_a = await _user_token(client, "listen-e-a@test.example")
    token_b = await _user_token(client, "listen-e-b@test.example")
    r = await client.put(
        LISTEN, json=_pos(surah=2, ayah=5), headers=_auth(token_a)
    )
    assert r.status_code == 200, r.text
    # کاربر دوم هنوز چیزی ندارد — نه ۴۰۴ و نه دادهٔ کاربر اول.
    r = await client.get(LISTEN, headers=_auth(token_b))
    assert r.status_code == 200, r.text
    assert r.json() is None
    # نوشتن کاربر دوم، ردیف کاربر اول را عوض نمی‌کند.
    r = await client.put(
        LISTEN, json=_pos(surah=114, ayah=6), headers=_auth(token_b)
    )
    assert r.status_code == 200, r.text
    r = await client.get(LISTEN, headers=_auth(token_a))
    assert r.json()["surah"] == 2 and r.json()["ayah"] == 5


@pytest.mark.asyncio
async def test_listen_position_two_device_scenario(tc):
    """دستگاه ۱ متوقف می‌شود؛ دستگاه ۲ (ورود دوم همان کاربر) از همان
    موقعیت ادامه می‌دهد و بعد دستگاه ۱ تازه‌ترین را می‌بیند."""
    client = tc["client"]
    email = "listen-f@test.example"
    device1 = await _user_token(client, email)
    # ورود دوم = دستگاه دوم (توکن تازه برای همان کاربر).
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login",
        json={"identifier": email, "password": "TestPass123"},
    )
    assert r.status_code == 200, r.text
    device2 = r.json()["access_token"]
    assert device2 != device1

    # دستگاه ۱: سورهٔ ۳۶، آیهٔ ۱۲، دقیقهٔ ۲، سرعت ۱، تکرار خاموش.
    now = datetime.now(UTC)
    r = await client.put(
        LISTEN,
        json=_pos(
            reciter="husary",
            surah=36,
            ayah=12,
            progress_ms=120_000,
            speed=1.0,
            repeat_mode="off",
            repeat_ayah=1,
            updated_at=_iso(now),
        ),
        headers=_auth(device1),
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True

    # دستگاه ۲: همان موقعیت را می‌خواند — ازسرگیری از همان‌جا.
    r = await client.get(LISTEN, headers=_auth(device2))
    assert r.status_code == 200, r.text
    resumed = r.json()
    assert resumed is not None
    assert resumed["reciter"] == "husary"
    assert resumed["surah"] == 36 and resumed["ayah"] == 12
    assert resumed["progress_ms"] == 120_000

    # دستگاه ۲ جلو می‌رود و ذخیره می‌کند؛ دستگاه ۱ تازه‌ترین را می‌بیند.
    r = await client.put(
        LISTEN,
        json=_pos(
            reciter="husary",
            surah=36,
            ayah=13,
            progress_ms=5_000,
            speed=1.0,
            repeat_mode="off",
            repeat_ayah=1,
            updated_at=_iso(now + timedelta(minutes=5)),
        ),
        headers=_auth(device2),
    )
    assert r.json()["applied"] is True
    r = await client.get(LISTEN, headers=_auth(device1))
    assert r.json()["ayah"] == 13
    assert r.json()["progress_ms"] == 5_000


@pytest.mark.asyncio
async def test_listen_position_delete(tc):
    """حذف موقعیت (پایان سوره): ۴۰۱ بدون توکن؛ ۲۰۴ پس از حذف؛ GET
    بعد از حذف null؛ حذف دوباره هم ۲۰۴ (idempotent)؛ ذخیرهٔ دوباره
    پس از حذف کار می‌کند."""
    client = tc["client"]
    r = await client.delete(LISTEN)
    assert r.status_code == 401, r.text
    token = await _user_token(client, "listen-h@test.example")
    r = await client.delete(LISTEN, headers=_auth(token))
    assert r.status_code == 204, r.text
    r = await client.put(LISTEN, json=_pos(surah=2, ayah=5), headers=_auth(token))
    assert r.status_code == 200, r.text
    r = await client.delete(LISTEN, headers=_auth(token))
    assert r.status_code == 204, r.text
    r = await client.get(LISTEN, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json() is None
    r = await client.delete(LISTEN, headers=_auth(token))
    assert r.status_code == 204, r.text
    r = await client.put(LISTEN, json=_pos(surah=36, ayah=1), headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    r = await client.get(LISTEN, headers=_auth(token))
    assert r.json()["surah"] == 36


@pytest.mark.asyncio
async def test_listen_position_delete_isolation(tc):
    """حذف کاربر اول، ردیف کاربر دوم را دست نمی‌زند."""
    client = tc["client"]
    token_a = await _user_token(client, "listen-i-a@test.example")
    token_b = await _user_token(client, "listen-i-b@test.example")
    r = await client.put(LISTEN, json=_pos(surah=2, ayah=5), headers=_auth(token_a))
    assert r.status_code == 200, r.text
    r = await client.put(LISTEN, json=_pos(surah=114, ayah=6), headers=_auth(token_b))
    assert r.status_code == 200, r.text
    r = await client.delete(LISTEN, headers=_auth(token_a))
    assert r.status_code == 204, r.text
    r = await client.get(LISTEN, headers=_auth(token_a))
    assert r.json() is None
    r = await client.get(LISTEN, headers=_auth(token_b))
    assert r.json()["surah"] == 114 and r.json()["ayah"] == 6


@pytest.mark.asyncio
async def test_listen_position_separate_from_attempt_position(tc):
    """موقعیت نشست تمرین، موقعیت شنیدن را عوض نمی‌کند (و برعکس)."""
    client = tc["client"]
    token = await _user_token(client, "listen-g@test.example")
    r = await client.post(
        f"{HIFZ}/attempts", json={"surah": 112, "page": 604}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    attempt_id = r.json()["id"]
    r = await client.patch(
        f"{HIFZ}/attempts/{attempt_id}/position",
        json={"current_surah": 112, "current_ayah": 3, "current_word_index": 2},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    r = await client.get(LISTEN, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json() is None

    r = await client.put(
        LISTEN, json=_pos(surah=112, ayah=2), headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    r = await client.get(
        f"{HIFZ}/attempts/{attempt_id}", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["attempt"]["current_ayah"] == 3
