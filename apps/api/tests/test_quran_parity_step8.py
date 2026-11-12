"""تست‌های گام ۸ توسعهٔ برابری با ترتیل — ایراد ۱۱ (همگام‌سازی حسابی).

پوشش:
- endpoint وضعیت خواندن احراز هویت می‌خواهد (بدون توکن ۴۰۱).
- کاربر تازه وضعیت خالی می‌گیرد (نه خطا)؛ PUT/GET رفت‌وبرگرد کامل.
- قانون تعارض «تازه‌ترین updated_at برنده است»: PUT کهنه‌تر ۴۰۹
  می‌گیرد و وضعیت ذخیره‌شده دست نمی‌خورد؛ PUT تازه‌تر اعمال می‌شود.
- ایزولاسیون: کاربر B وضعیت کاربر A را نمی‌بیند و نوشتنش روی آن
  اثری ندارد.
- اعتبارسنجی شکل نشان (kind نامعتبر → ۴۲۲).
"""

from __future__ import annotations

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


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


def _state(updated_at: int, label: str = "الفاتحة ١") -> dict:
    return {
        "bookmarks": [
            {
                "id": "hafs/kfqc:1:1",
                "kind": "ayah",
                "surah": 1,
                "ayah": 1,
                "page": None,
                "mushaf": "hafs/kfqc",
                "label": label,
                "favorite": False,
                "createdAt": updated_at,
            }
        ],
        "last_read": {
            "surah": 2,
            "view": "ayah",
            "target": None,
            "ayah": 255,
            "mushaf": "hafs/kfqc",
            "savedAt": updated_at,
        },
        "updated_at": updated_at,
    }


async def test_reading_state_requires_auth(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/quran/reading-state")
    assert r.status_code == 401
    r = await client.put(f"{BASE}/quran/reading-state", json=_state(1000))
    assert r.status_code == 401


async def test_reading_state_roundtrip_and_conflict_rule(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-a@example.com")
    h = _auth(token)

    # کاربر تازه: وضعیت خالی، نه خطا.
    r = await client.get(f"{BASE}/quran/reading-state", headers=h)
    assert r.status_code == 200
    assert r.json() == {"bookmarks": [], "last_read": None, "updated_at": 0}

    # نوشتن و خواندنِ همان وضعیت.
    r = await client.put(
        f"{BASE}/quran/reading-state", json=_state(1000), headers=h
    )
    assert r.status_code == 200, r.text
    assert r.json()["updated_at"] == 1000
    r = await client.get(f"{BASE}/quran/reading-state", headers=h)
    body = r.json()
    assert body["bookmarks"][0]["id"] == "hafs/kfqc:1:1"
    assert body["bookmarks"][0]["createdAt"] == 1000
    assert body["last_read"]["ayah"] == 255

    # PUT کهنه‌تر: ۴۰۹ + بدنهٔ وضعیت ذخیره‌شده؛ ذخیره دست نخورده.
    r = await client.put(
        f"{BASE}/quran/reading-state", json=_state(500, "کهنه"), headers=h
    )
    assert r.status_code == 409
    assert r.json()["updated_at"] == 1000
    assert r.json()["bookmarks"][0]["label"] == "الفاتحة ١"

    # PUT تازه‌تر اعمال می‌شود.
    r = await client.put(
        f"{BASE}/quran/reading-state", json=_state(2000, "تازه"), headers=h
    )
    assert r.status_code == 200
    r = await client.get(f"{BASE}/quran/reading-state", headers=h)
    assert r.json()["bookmarks"][0]["label"] == "تازه"
    assert r.json()["updated_at"] == 2000


async def test_reading_state_isolated_per_user(tc):
    client = tc["client"]
    token_a = await _user_token(client, "sync-iso-a@example.com")
    token_b = await _user_token(client, "sync-iso-b@example.com")
    r = await client.put(
        f"{BASE}/quran/reading-state",
        json=_state(3000),
        headers=_auth(token_a),
    )
    assert r.status_code == 200
    # B وضعیت A را نمی‌بیند.
    r = await client.get(f"{BASE}/quran/reading-state", headers=_auth(token_b))
    assert r.json() == {"bookmarks": [], "last_read": None, "updated_at": 0}
    # و نوشتن B روی A اثری ندارد.
    r = await client.put(
        f"{BASE}/quran/reading-state",
        json=_state(4000, "مال B"),
        headers=_auth(token_b),
    )
    assert r.status_code == 200
    r = await client.get(f"{BASE}/quran/reading-state", headers=_auth(token_a))
    assert r.json()["updated_at"] == 3000
    assert r.json()["bookmarks"][0]["label"] == "الفاتحة ١"


async def test_reading_state_validation(tc):
    client = tc["client"]
    token = await _user_token(client, "sync-val@example.com")
    bad = _state(1000)
    bad["bookmarks"][0]["kind"] = "chapter"
    r = await client.put(
        f"{BASE}/quran/reading-state", json=bad, headers=_auth(token)
    )
    assert r.status_code == 422
    bad2 = _state(1000)
    bad2["bookmarks"][0]["surah"] = 115
    r = await client.put(
        f"{BASE}/quran/reading-state", json=bad2, headers=_auth(token)
    )
    assert r.status_code == 422
