"""تست‌های فاز ۵ (Track 1 — بک‌اند): قرآن / یادداشت آیه / تسبیح / اذان.

پوشش:
- قرآن: فهرست ۱۱۴ سوره؛ merge منطق provider (با _get ماک‌شده — بدون شبکه)؛
  خرابی provider → ۵۰۳ با پاکت یکدست (نه ۵۰۰)؛ کش درون‌فرایندی.
- یادداشت‌ها: CRUD + ایزولاسیون حریم خصوصی (کاربر B هیچ‌چیز از A نمی‌بیند،
  حتی با حدس شناسه → ۴۰۴) + صفحه‌بندی cursor + domain event.
- تسبیح: شروع/شمارش/تکمیل نشست، تجمیع روزانه، idempotency شمارش، domain eventها.
- اذان: صحت محاسبات در برابر مقادیر مرجع aladhan (تهران ۲۰۲۶-۱۰-۱۹، MWL، شافعی)
  با تلورانس ۲ دقیقه؛ اعتبارسنجی ورودی‌ها؛ حنفی دیرتر از شافعی.
- مناجات: منطق پنجرهٔ زمانی.
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

BASE = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/register",
        json={
            "full_name": "کاربر تست",
            "email": email,
            "password": password,
            "locale": "fa",
            "accept_terms": True,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _login(client, identifier: str, password: str = "TestPass123") -> dict:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": identifier, "password": password}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _user_token(client, email: str) -> str:
    await _register(client, email)
    return await _login(client, email)


# ---------------------------------------------------------------------------
# قرآن: سوره‌ها (بدون نیاز به provider)
# ---------------------------------------------------------------------------


async def test_surah_list_has_114(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/quran/surahs")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 114
    assert len(body["items"]) == 114
    first, last = body["items"][0], body["items"][-1]
    assert first["number"] == 1 and first["ayahs"] == 7
    assert first["name_ar"] == "الفاتحة"
    assert last["number"] == 114 and last["name_en"] == "An-Nas"
    # بقره ۲۸۶ آیه
    baqarah = next(s for s in body["items"] if s["number"] == 2)
    assert baqarah["ayahs"] == 286


async def test_surah_meta_validation(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/quran/surah/0")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "surah_not_found"
    r = await client.get(f"{BASE}/quran/surah/115")
    assert r.status_code == 404
    r = await client.get(f"{BASE}/quran/ayah/112/99")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ayah_not_found"


# ---------------------------------------------------------------------------
# قرآن: provider — merge منطق + کش + graceful degradation (ماک‌شده)
# ---------------------------------------------------------------------------

_FAKE_EDITIONS_PAYLOAD = [
    {
        "edition": {"identifier": "quran-uthmani"},
        "ayahs": [
            {"numberInSurah": 1, "text": "قُلْ هُوَ اللَّهُ أَحَدٌ",
             "audio": None, "juz": 30, "page": 604},
            {"numberInSurah": 2, "text": "اللَّهُ الصَّمَدُ",
             "audio": None, "juz": 30, "page": 604},
        ],
    },
    {
        "edition": {"identifier": "en.sahih"},
        "ayahs": [
            {"numberInSurah": 1, "text": "Say, He is Allah, One,", "audio": None},
            {"numberInSurah": 2, "text": "Allah, the Eternal Refuge.", "audio": None},
        ],
    },
    {
        "edition": {"identifier": "ar.alafasy"},
        "ayahs": [
            {"numberInSurah": 1, "text": "قُلْ هُوَ اللَّهُ أَحَدٌ",
             "audio": "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3"},
            {"numberInSurah": 2, "text": "اللَّهُ الصَّمَدُ",
             "audio": "https://cdn.islamic.network/quran/audio/128/ar.alafasy/2.mp3"},
        ],
    },
]


def _patch_provider_get(monkeypatch, payload=None, exc=None):
    """ماک _get در سطح provider — بدون شبکه."""
    from app.modules.quran import providers as prov

    calls = {"n": 0}

    async def _fake(self, path: str):
        calls["n"] += 1
        if exc is not None:
            raise exc
        return payload

    monkeypatch.setattr(prov.AlQuranCloudProvider, "_get", _fake)
    prov.clear_quran_cache()
    return calls


async def test_provider_merge_and_cache(tc, monkeypatch):
    from app.modules.quran import providers as prov

    calls = _patch_provider_get(monkeypatch, payload=_FAKE_EDITIONS_PAYLOAD)
    p = prov.AlQuranCloudProvider()
    data = await p.fetch_surah(
        112, text_edition="quran-uthmani",
        translation_edition="en.sahih", reciter_edition="ar.alafasy",
    )
    assert len(data["ayahs"]) == 2
    first = data["ayahs"][0]
    assert first["editions"]["quran-uthmani"].text == "قُلْ هُوَ اللَّهُ أَحَدٌ"
    assert first["editions"]["en.sahih"].text.startswith("Say,")
    assert first["editions"]["ar.alafasy"].audio_url.startswith("https://cdn.islamic.network")
    # فراخوانی دوم از کش می‌آید — _get فقط یک‌بار صدا زده شده
    await p.fetch_surah(
        112, text_edition="quran-uthmani",
        translation_edition="en.sahih", reciter_edition="ar.alafasy",
    )
    assert calls["n"] == 1


async def test_provider_failure_graceful_503(tc, monkeypatch):
    """خرابی provider → ۵۰۳ با پاکت یکدست؛ هرگز ۵۰۰ با traceback."""
    from app.modules.quran import providers as prov

    _patch_provider_get(
        monkeypatch,
        exc=prov.QuranProviderError("boom", provider_id="alquran_cloud"),
    )
    client = tc["client"]
    r = await client.get(f"{BASE}/quran/surah/112")
    assert r.status_code == 503, r.text
    body = r.json()
    assert body["error"]["code"] == "quran_provider_unavailable"
    assert "request_id" in body
    assert "traceback" not in r.text

    r = await client.get(f"{BASE}/quran/ayah/112/1")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "quran_provider_unavailable"


async def test_providers_endpoint_settings_driven(tc):
    client = tc["client"]
    r = await client.get(f"{BASE}/quran/providers")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["active_provider"] == "alquran_cloud"
    assert any(p["id"] == "alquran_cloud" and p["active"] for p in body["providers"])
    assert "en.sahih" in body["translations"]
    assert body["highlight_mode"] in ("word", "ayah", "off")


# ---------------------------------------------------------------------------
# یادداشت‌های آیه: CRUD + حریم خصوصی + cursor + event
# ---------------------------------------------------------------------------


async def _note(client, token, surah=112, ayah=1, text="یادداشت تست", private=True):
    r = await client.post(
        f"{BASE}/quran/notes",
        json={"surah": surah, "ayah": ayah, "note_text": text, "is_private": private},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_notes_crud(tc):
    client = tc["client"]
    token = await _user_token(client, "note1@example.com")

    note = await _note(client, token)
    assert note["surah"] == 112 and note["ayah"] == 1
    assert note["is_private"] is True
    assert note["created_at"].endswith("+00:00")  # ISO 8601 با افست UTC

    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token))
    assert r.status_code == 200
    assert len(r.json()["items"]) == 1

    # فیلتر سوره/آیه
    r = await client.get(f"{BASE}/quran/notes?surah=2", headers=_auth(token))
    assert r.json()["items"] == []

    # ویرایش
    r = await client.put(
        f"{BASE}/quran/notes/{note['id']}",
        json={"note_text": "ویرایش‌شده", "is_private": False},
        headers=_auth(token),
    )
    assert r.status_code == 200
    assert r.json()["note_text"] == "ویرایش‌شده"
    assert r.json()["is_private"] is False

    # حذف
    r = await client.delete(
        f"{BASE}/quran/notes/{note['id']}", headers=_auth(token)
    )
    assert r.status_code == 204
    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token))
    assert r.json()["items"] == []


async def test_notes_privacy_isolation(tc):
    """کاربر B یادداشت خصوصی A را نمی‌بیند — حتی با حدس شناسه → ۴۰۴."""
    client = tc["client"]
    token_a = await _user_token(client, "noteA@example.com")
    token_b = await _user_token(client, "noteB@example.com")

    note = await _note(client, token_a, text="محرمانه")

    r = await client.get(f"{BASE}/quran/notes", headers=_auth(token_b))
    assert r.status_code == 200
    assert r.json()["items"] == []

    for method in ("put", "delete"):
        r = await getattr(client, method)(
            f"{BASE}/quran/notes/{note['id']}",
            **({"json": {"note_text": "x"}} if method == "put" else {}),
            headers=_auth(token_b),
        )
        assert r.status_code == 404, (method, r.text)
        assert r.json()["error"]["code"] == "note_not_found"

    # بدون توکن → ۴۰۱
    r = await client.get(f"{BASE}/quran/notes")
    assert r.status_code == 401


async def test_notes_cursor_pagination(tc):
    client = tc["client"]
    token = await _user_token(client, "noteC@example.com")
    for i in range(3):
        await _note(client, token, ayah=i + 1, text=f"یادداشت {i}")

    r = await client.get(f"{BASE}/quran/notes?limit=2", headers=_auth(token))
    page1 = r.json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"]

    r = await client.get(
        f"{BASE}/quran/notes?limit=2&after={page1['next_cursor']}",
        headers=_auth(token),
    )
    page2 = r.json()
    assert len(page2["items"]) == 1
    assert page2["next_cursor"] is None
    # بدون تکرار
    ids = [n["id"] for n in page1["items"]] + [n["id"] for n in page2["items"]]
    assert len(set(ids)) == 3

    r = await client.get(
        f"{BASE}/quran/notes?after=bogus", headers=_auth(token)
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_cursor"


async def test_note_created_emits_domain_event(tc, db_session):
    from sqlalchemy import select

    from app.models.models import DomainEvent

    client = tc["client"]
    token = await _user_token(client, "noteE@example.com")
    note = await _note(client, token)

    rows = (
        await db_session.execute(
            select(DomainEvent).where(
                DomainEvent.aggregate_type == "quran_note",
                DomainEvent.aggregate_id == note["id"],
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].event_type == "quran.note_created"
    assert rows[0].payload["surah"] == 112


# ---------------------------------------------------------------------------
# تسبیح
# ---------------------------------------------------------------------------


async def _start(client, token, dhikr="سبحان الله", target=None):
    body = {"dhikr_text": dhikr}
    if target is not None:
        body["target_count"] = target
    r = await client.post(f"{BASE}/tasbih/sessions", json=body, headers=_auth(token))
    assert r.status_code == 201, r.text
    return r.json()


async def test_tasbih_session_count_and_today(tc):
    client = tc["client"]
    token = await _user_token(client, "tasbih1@example.com")

    s = await _start(client, token)
    assert s["count"] == 0 and s["completed"] is False

    for _ in range(3):
        r = await client.post(
            f"{BASE}/tasbih/sessions/{s['id']}/count",
            json={"amount": 1},
            headers=_auth(token),
        )
        assert r.status_code == 200, r.text
    assert r.json()["count"] == 3

    # نشست دوم با همان ذکر → تجمیع روزانه جمع می‌شود
    s2 = await _start(client, token)
    r = await client.post(
        f"{BASE}/tasbih/sessions/{s2['id']}/count",
        json={"amount": 2},
        headers=_auth(token),
    )
    assert r.json()["count"] == 2

    r = await client.get(f"{BASE}/tasbih/today", headers=_auth(token))
    assert r.status_code == 200
    totals = {t["dhikr_text"]: t["total_count"] for t in r.json()["totals"]}
    assert totals["سبحان الله"] == 5


async def test_tasbih_completion_and_idempotent_count(tc):
    client = tc["client"]
    token = await _user_token(client, "tasbih2@example.com")

    s = await _start(client, token, dhikr="الحمد لله", target=2)
    r = await client.post(
        f"{BASE}/tasbih/sessions/{s['id']}/count",
        json={"amount": 1, "idempotency_key": "k1"},
        headers=_auth(token),
    )
    assert r.json()["count"] == 1
    # کلید تکراری → بدون افزایش دوباره
    r = await client.post(
        f"{BASE}/tasbih/sessions/{s['id']}/count",
        json={"amount": 1, "idempotency_key": "k1"},
        headers=_auth(token),
    )
    assert r.json()["count"] == 1

    r = await client.post(
        f"{BASE}/tasbih/sessions/{s['id']}/count",
        json={"amount": 1, "idempotency_key": "k2"},
        headers=_auth(token),
    )
    body = r.json()
    assert body["count"] == 2
    assert body["completed"] is True
    assert body["ended_at"] is not None

    # نشست تمام‌شده → ۴۰۹
    r = await client.post(
        f"{BASE}/tasbih/sessions/{s['id']}/count",
        json={"amount": 1},
        headers=_auth(token),
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "session_ended"


async def test_tasbih_session_events(tc, db_session):
    from sqlalchemy import select

    from app.models.models import DomainEvent

    client = tc["client"]
    token = await _user_token(client, "tasbih3@example.com")
    s = await _start(client, token, target=1)
    r = await client.post(
        f"{BASE}/tasbih/sessions/{s['id']}/count",
        json={"amount": 1},
        headers=_auth(token),
    )
    assert r.json()["completed"] is True

    rows = (
        await db_session.execute(
            select(DomainEvent).where(
                DomainEvent.aggregate_type == "dhikr_session",
                DomainEvent.aggregate_id == s["id"],
            )
        )
    ).scalars().all()
    types = {row.event_type for row in rows}
    assert {"tasbih.session_started", "tasbih.session_completed"} <= types


async def test_tasbih_requires_auth_and_ownership(tc):
    client = tc["client"]
    r = await client.post(
        f"{BASE}/tasbih/sessions", json={"dhikr_text": "x"}
    )
    assert r.status_code == 401

    token_a = await _user_token(client, "tasbihA@example.com")
    token_b = await _user_token(client, "tasbihB@example.com")
    s = await _start(client, token_a)
    r = await client.post(
        f"{BASE}/tasbih/sessions/{s['id']}/count",
        json={"amount": 1},
        headers=_auth(token_b),
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# اذان — صحت در برابر مقادیر مرجع (تهران، ۲۰۲۶-۱۰-۱۹، MWL، شافعی)
# ---------------------------------------------------------------------------

# مقادیر مرجع: api.aladhan.com (method=3 MWL)، بازبینی‌شده ۲۰۲۶-۱۰-۱۹
_ADHAN_REF = {
    "fajr": "04:49", "sunrise": "06:14", "dhuhr": "11:49",
    "asr": "14:59", "maghrib": "17:24", "isha": "18:44",
}


def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


async def test_adhan_matches_reference(tc):
    client = tc["client"]
    r = await client.get(
        f"{BASE}/adhan/times",
        params={
            "lat": 35.6892, "lng": 51.3890, "method": "mwl",
            "madhab": "shafi", "day": "2026-10-19", "tz": 3.5,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["method"] == "mwl"
    assert body["madhab"] == "shafi"
    assert body["timezone_offset"] == 3.5
    for key, ref in _ADHAN_REF.items():
        diff = abs(_to_min(body["times"][key]) - _to_min(ref))
        assert diff <= 2, f"{key}: got {body['times'][key]}, ref {ref}"


async def test_adhan_hanafi_later_than_shafi(tc):
    client = tc["client"]
    params = {"lat": 35.6892, "lng": 51.3890, "method": "mwl",
              "day": "2026-10-19", "tz": 3.5}
    shafi = (await client.get(f"{BASE}/adhan/times",
                              params={**params, "madhab": "shafi"})).json()["times"]["asr"]
    hanafi = (await client.get(f"{BASE}/adhan/times",
                               params={**params, "madhab": "hanafi"})).json()["times"]["asr"]
    assert _to_min(hanafi) > _to_min(shafi)


async def test_adhan_validation(tc):
    client = tc["client"]
    base = {"lat": 35.6892, "lng": 51.3890}
    r = await client.get(f"{BASE}/adhan/times", params={**base, "lat": 91})
    assert r.status_code == 422
    r = await client.get(f"{BASE}/adhan/times", params={**base, "method": "nope"})
    assert r.status_code == 422
    # پاکت خطای یکدست حتی برای ۴۲۲
    assert r.json()["error"]["code"] == "validation_error"
    r = await client.get(f"{BASE}/adhan/times", params={**base, "tz": 20})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# مناجات شبانه
# ---------------------------------------------------------------------------


async def test_munajat_window_logic(tc, db_session):
    from app.modules.quran import service as qsvc

    # ۰۳:۳۰ به وقت تهران (+۳:۳۰) = ۰۰:۰۰ UTC → داخل پنجرهٔ ۰۲:۰۰–۰۵:۰۰
    inside = datetime(2026, 10, 19, 0, 0, tzinfo=UTC)
    st = await qsvc.get_munajat_status(db_session, tz_offset=3.5, now_utc=inside)
    assert st["enabled"] is True
    assert st["in_window"] is True
    assert st["window"] == {"start": "02:00", "end": "05:00"}

    # ۱۲:۰۰ UTC → خارج از پنجره
    outside = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
    st = await qsvc.get_munajat_status(db_session, tz_offset=3.5, now_utc=outside)
    assert st["in_window"] is False

    # endpoint هم کار می‌کند
    client = tc["client"]
    r = await client.get(f"{BASE}/quran/munajat/status", params={"tz": 3.5})
    assert r.status_code == 200
    assert "in_window" in r.json()


# ---------------------------------------------------------------------------
# تنظیمات فاز ۵: اعتبارسنجی کلیدهای json
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,value,ok",
    [
        ("quran.provider", "alquran_cloud", True),
        ("quran.provider", "nope", False),
        ("quran.highlight_mode", "ayah", True),
        ("quran.highlight_mode", "line", False),
        ("quran.font_size", 20, True),
        ("quran.font_size", 200, False),
        ("quran.playback", {"autoplay": True, "repeat": "surah"}, True),
        ("quran.playback", {"repeat": "forever"}, False),
        ("munajat.window", {"start": "02:00", "end": "05:00"}, True),
        ("munajat.window", {"start": "25:00", "end": "05:00"}, False),
        ("quran.translations", ["en.sahih", "fa.makarem"], True),
        ("quran.translations", ["en.sahih", "en.sahih"], False),
        ("quran.show_translation", True, True),
        ("quran.show_translation", "yes", False),
        ("munajat.enabled", False, True),
    ],
)
def test_quran_settings_validation(key, value, ok):
    from app.core.platform_settings import encode_setting_value

    if ok:
        encode_setting_value("json", value, key)
    else:
        with pytest.raises(ValueError):
            encode_setting_value("json", value, key)


def test_quran_settings_seed_defaults():
    """seed پیش‌فرض‌ها را دارد — بدون نیاز به DB (رگرسیون)."""
    import inspect

    from app import seed as seed_mod

    src = inspect.getsource(seed_mod.seed_platform_settings_defaults)
    for key in (
        "quran.provider", "quran.translations", "quran.tafsirs", "quran.reciters",
        "quran.active_languages", "quran.show_translation", "quran.show_tafsir",
        "quran.highlight_mode", "quran.font_size", "quran.playback",
        "munajat.enabled", "munajat.window", "adhan.defaults",
    ):
        assert f'"{key}"' in src, key


# ---------------------------------------------------------------------------
# یکپارچه‌سازی coordinator: adhan.defaults، تحمل رشتهٔ JSON، override قاری
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,value,ok",
    [
        ("adhan.defaults", {"calculation_method": "mwl", "madhab": "shafi"}, True),
        ("adhan.defaults", {"calculation_method": "makkah", "madhab": "hanafi"}, True),
        ("adhan.defaults", {}, True),  # پیش‌فرض‌ها اعمال می‌شود
        ("adhan.defaults", {"calculation_method": "nope", "madhab": "shafi"}, False),
        ("adhan.defaults", {"calculation_method": "mwl", "madhab": "maliki"}, False),
        ("adhan.defaults", {"calculation_method": "mwl", "foo": 1}, False),
        ("adhan.defaults", "mwl", False),
    ],
)
def test_adhan_defaults_validation(key, value, ok):
    from app.core.platform_settings import encode_setting_value

    if ok:
        out = encode_setting_value("json", value, key)
        import json as _json

        parsed = _json.loads(out)
        assert parsed["calculation_method"] in (
            "isna", "mwl", "egypt", "karachi", "makkah", "jafari",
        )
        assert parsed["madhab"] in ("shafi", "hanafi")
    else:
        with pytest.raises(ValueError):
            encode_setting_value("json", value, key)


def test_json_string_values_accepted():
    """کلاینت‌هایی که مقدار json را stringify می‌کنند (مثل Appearance.tsx
    در polish) نباید ۴۰۰ بگیرند — بک‌اند رشتهٔ JSON معتبر را parse می‌کند."""
    import json as _json

    from app.core.platform_settings import encode_setting_value

    out = encode_setting_value(
        "json", '{"autoplay": true, "repeat": "off"}', "quran.playback"
    )
    assert _json.loads(out) == {"autoplay": True, "repeat": "off"}

    out = encode_setting_value(
        "json",
        '{"enabled": true, "count": 50, "speed": 1, "parallax": 0.05, "lines": false}',
        "particles",
    )
    assert _json.loads(out)["count"] == 50

    # رشتهٔ نامعتبر JSON → به اعتبارسنج سپرده می‌شود و خطای واضح می‌دهد
    with pytest.raises(ValueError):
        encode_setting_value("json", "{not-json", "quran.playback")
    with pytest.raises(ValueError):
        encode_setting_value("json", '"just-a-string"', "quran.playback")


async def test_reciter_override_honored_only_if_enabled(db_session):
    """?reciter= فقط از میان قاری‌های فعال (quran.reciters) پذیرفته می‌شود."""
    from app.core.platform_settings import encode_setting_value, stage_setting
    from app.modules.quran import service as qsvc

    await stage_setting(
        db_session,
        "quran.reciters",
        encode_setting_value("json", ["ar.alafasy", "ar.hudhaify"], "quran.reciters"),
    )
    await db_session.commit()

    sel = await qsvc._edition_selection(db_session, reciter="ar.hudhaify")
    assert sel["reciter_edition"] == "ar.hudhaify"

    # قاری غیرفعال → fallback به پیش‌فرض اول
    sel = await qsvc._edition_selection(db_session, reciter="ar.evil")
    assert sel["reciter_edition"] == "ar.alafasy"

    # بدون override → پیش‌فرض اول
    sel = await qsvc._edition_selection(db_session)
    assert sel["reciter_edition"] == "ar.alafasy"
