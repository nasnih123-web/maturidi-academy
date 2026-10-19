"""تست‌های فاز ۱۲ (Track 1 — بک‌اند): دستیار صوتی دوزبانه.

پوشش:
- ماتریس طبقه‌بندی قصد (fa/ar: quran/fatwa/general) + استخراج ارجاع آیه
- تشخیص زبان fa/ar/unknown
- نامتغیر NEVER-TTS-Quran: پاسخ آیه همیشه recitation واقعی است، هرگز TTS
- degradation صادقانه: stt_unavailable / tts_unavailable (هرگز بایت جعلی)
- unsupported_language، رد magic-byte فایل جعلی
- ادمین: GET/PUT تنظیمات + لاگ مصرف (cursor)
"""
from __future__ import annotations

import uuid

import pytest

from app.core.errors import APIError
from app.modules.voice import intents, service, tts as tts_mod

BASE = "/api/v1"


# ---------------------------------------------------------------------------
# کمک‌ها
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_limits() -> None:
    from app.core.security import rate_limiter

    rate_limiter.reset("register:127.0.0.1")
    rate_limiter.reset("login:127.0.0.1")


async def _register(client, email: str) -> dict:
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
    return r.json()


async def _login(client, email: str) -> str:
    _reset_limits()
    r = await client.post(
        f"{BASE}/auth/login", json={"identifier": email, "password": "TestPass123"}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _voice_admin_token(client, db_session, email: str) -> str:
    """کاربر با مجوز voice.manage."""
    from sqlalchemy import select

    from app.core.platform_settings import reset_settings_cache
    from app.models.models import Permission, Role, RolePermission, UserRole

    reset_settings_cache()
    me = await _register(client, email)
    token = await _login(client, email)
    role = (
        await db_session.execute(select(Role).where(Role.name == "super_admin"))
    ).scalar_one_or_none()
    if role is None:
        role = Role(name="super_admin", description="test")
        db_session.add(role)
        await db_session.flush()
    perm = (
        await db_session.execute(
            select(Permission).where(Permission.key == "voice.manage")
        )
    ).scalar_one_or_none()
    if perm is None:
        perm = Permission(key="voice.manage", description="test")
        db_session.add(perm)
        await db_session.flush()
    exists = (
        await db_session.execute(
            select(RolePermission).where(
                RolePermission.role_id == role.id,
                RolePermission.permission_id == perm.id,
            )
        )
    ).first()
    if not exists:
        db_session.add(RolePermission(role_id=role.id, permission_id=perm.id))
        await db_session.flush()
    db_session.add(UserRole(user_id=uuid.UUID(me["id"]), role_id=role.id))

    # remediation-pass-2 Track 1 (§۵): نقش ممتاز بدون TOTP با هیچ توکنی به
    # endpoint ادمین نمی‌رسد؛ helper سکرت TOTP هم می‌نشاند.
    import json

    import pyotp

    from app.core.secrets import encrypt_value
    from app.models.models import User as _T1User

    _t1u = (
        await db_session.execute(select(_T1User).where(_T1User.id == uuid.UUID(me["id"])))
    ).scalar_one()
    _t1u.totp_secret = json.dumps(encrypt_value(pyotp.random_base32()))
    await db_session.commit()
    reset_settings_cache()
    return token


_FAKE_AYAH_PAYLOAD = [
    {
        "edition": {"identifier": "quran-uthmani"},
        "text": "يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
        "audio": None, "juz": 2, "page": 23,
    },
    {
        "edition": {"identifier": "fa.makarem"},
        "text": "ای کسانی که ایمان آورده‌اید، از صبر و نماز یاری جویید",
        "audio": None,
    },
    {
        "edition": {"identifier": "ar.alafasy"},
        "text": "يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",
        "audio": "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1234.mp3",
    },
]


def _patch_quran_ayah(monkeypatch, payload):
    """ماک _get در سطح provider فاز ۵ — بدون شبکه."""
    from app.modules.quran import providers as prov

    async def _fake(self, path: str):
        return payload

    monkeypatch.setattr(prov.AlQuranCloudProvider, "_get", _fake)
    prov.clear_quran_cache()


def _wav_bytes() -> bytes:
    # هدر WAV واقعی (RIFF....WAVE) با چند بایت داده
    return b"RIFF" + (44).to_bytes(4, "little") + b"WAVE" + b"\x00" * 64


# ---------------------------------------------------------------------------
# ۱) ماتریس قصد
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        # --- quran: فارسی ---
        ("آیه‌ای درباره صبر بخوان", "quran"),
        ("سوره یس را بخوان", "quran"),
        ("تلاوت آیه الکرسی", "quran"),
        ("لطفاً آیه‌ای از قرآن بخوان", "quran"),
        ("سوره بقره آیه ۲۵۵ را بخوان", "quran"),
        ("2:153 را بخوان", "quran"),
        # --- quran: عربی ---
        ("اقرأ آية الكرسي", "quran"),
        ("سورة الفاتحة", "quran"),
        ("تلاوة سورة يس", "quran"),
        # --- fatwa: فارسی ---
        ("آیا روزه مسافر جایز است؟", "fatwa"),
        ("حکم نماز مسافر چیست؟", "fatwa"),
        ("آیا این معامله حلال است", "fatwa"),
        # --- fatwa: عربی ---
        ("هل الصوم يجوز للمسافر؟", "fatwa"),
        ("ما حكم الصلاة؟", "fatwa"),
        # --- general ---
        ("سلام", "general"),
        ("امروز هوا چطور است؟", "general"),
        ("hello", "general"),
    ],
)
def test_intent_matrix(text, expected):
    assert intents.classify_intent(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("بقره ۱۵۳", (2, 153)),
        ("سوره بقره آیه ۱۵۳", (2, 153)),
        ("2:153", (2, 153)),
        ("آیه‌ای درباره صبر بخوان", (2, 153)),
        ("سورة الفاتحة", (1, 1)),
        ("سوره یس را بخوان", (36, 1)),
        ("اقرأ آية الكرسي", (2, 255)),
        ("آیه‌ای درباره رحمت بخوان", (39, 53)),
        ("تلاوت سوره کوثر", (108, 1)),
        ("سلام", None),
    ],
)
def test_ayah_reference_extraction(text, expected):
    assert intents.extract_ayah_reference(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("آیه‌ای درباره صبر بخوان", "fa"),
        ("آیا روزه جایز است؟", "fa"),
        ("اقرأ آية الكرسي", "ar"),
        ("هل الصوم يجوز؟", "ar"),
        ("ما حكم الصلاة", "ar"),
        ("hello world", "unknown"),
        ("", "unknown"),
    ],
)
def test_language_detection(text, expected):
    assert intents.detect_language(text) == expected


# ---------------------------------------------------------------------------
# ۲) نامتغیر NEVER-TTS-Quran
# ---------------------------------------------------------------------------


async def test_quran_answer_never_tts(db_session, monkeypatch):
    """آیه → recitation واقعی؛ tts.py هرگز صدا زده نمی‌شود."""
    _patch_quran_ayah(monkeypatch, _FAKE_AYAH_PAYLOAD)

    async def _boom(*a, **k):
        raise AssertionError("TTS must never be called for quran intent")

    monkeypatch.setattr(tts_mod, "synthesize_or_degrade", _boom)

    out = await service.answer_text(
        db_session,
        text="آیه‌ای درباره صبر بخوان",
        lang="fa",
        user=None,
        client_ip=None,
    )
    assert out["intent"] == "quran"
    assert out["audio_kind"] == "recitation"
    assert out["audio_url"] == (
        "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1234.mp3"
    )
    assert "audio_base64" not in out
    assert out["ayah"]["surah"] == 2
    assert out["ayah"]["ayah"] == 153
    assert out["ayah"]["translation"] is not None


async def test_quran_answer_missing_audio_degrades_to_text(db_session, monkeypatch):
    """اگر URL تلاوت نبود → متنی صادقانه، نه TTS."""
    payload = [
        {**e, "audio": None} for e in _FAKE_AYAH_PAYLOAD
    ]
    _patch_quran_ayah(monkeypatch, payload)

    async def _boom(*a, **k):
        raise AssertionError("TTS must never be called for quran intent")

    monkeypatch.setattr(tts_mod, "synthesize_or_degrade", _boom)

    out = await service.answer_text(
        db_session,
        text="اقرأ آية الكرسي",
        lang="ar",
        user=None,
        client_ip=None,
    )
    assert out["intent"] == "quran"
    assert out["audio_kind"] == "none"
    assert "audio_url" not in out
    assert "audio_base64" not in out
    assert out["notice"] == "voice.quran_no_audio"
    assert out["text"]  # متن و ترجمه همچنان هست


async def test_quran_unresolved_reference(db_session):
    out = await service.answer_text(
        db_session, text="آیه‌ای بخوان", lang="fa", user=None, client_ip=None
    )
    assert out["intent"] == "quran"
    assert out["audio_kind"] == "none"
    assert "بقره ۱۵۳" in out["text"] or "سوره" in out["text"]


# ---------------------------------------------------------------------------
# ۳) degradation صادقانهٔ STT/TTS
# ---------------------------------------------------------------------------


async def test_transcribe_unavailable_honest_503(tc):
    """بدون faster-whisper → ۵۰۳ با کد stt_unavailable (نه رونویسی جعلی)."""
    client = tc["client"]
    r = await client.post(
        f"{BASE}/voice/transcribe",
        files={"file": ("test.wav", _wav_bytes(), "audio/wav")},
    )
    assert r.status_code == 503, r.text
    body = r.json()
    assert body["error"]["code"] == "stt_unavailable"


async def test_tts_degrades_to_text_not_silence(db_session):
    """بدون TTS پیکربندی‌شده → متن کامل + audio_kind=none + اعلان صادقانه."""
    out = await service.answer_text(
        db_session, text="سلام", lang="fa", user=None, client_ip=None
    )
    assert out["intent"] == "general"
    assert out["audio_kind"] == "none"
    assert out["notice"] == "tts_unavailable"
    assert "audio_base64" not in out
    assert out["text"]  # هرگز سکوت


async def test_fatwa_intent_uses_fatwa_engine_and_degrades_tts(db_session, monkeypatch):
    """قصد فتوا → موتور فاز ۶ (ماک‌شده) + citationها؛ TTS ناموجود → متنی."""
    from app.modules.fatwa import service as fatwa_svc

    async def _fake_ask(db, **kwargs):
        return {
            "answer": "پاسخ آزمایشی فتوا",
            "citations": [
                {
                    "chunk_id": "00000000-0000-0000-0000-000000000000",
                    "excerpt": "گزیده",
                    "source_citation": "منبع",
                    "topic_category": "test",
                    "madhab_scope": "hanafi",
                    "score": 0.9,
                }
            ],
            "status": "answered",
            "session_id": uuid.uuid4(),
            "ai_label": "test",
            "model": "test",
        }

    monkeypatch.setattr(fatwa_svc, "ask", _fake_ask)
    out = await service.answer_text(
        db_session,
        text="آیا روزه مسافر جایز است؟",
        lang="fa",
        user=None,
        client_ip=None,
    )
    assert out["intent"] == "fatwa"
    assert "پاسخ آزمایشی فتوا" in out["text"]
    assert len(out["citations"]) == 1
    assert out["audio_kind"] == "none"  # TTS پیکربندی نشده
    assert out["notice"] == "tts_unavailable"


# ---------------------------------------------------------------------------
# ۴) زبان نامعتبر + magic-byte
# ---------------------------------------------------------------------------


async def test_unsupported_language_rejected(db_session):
    with pytest.raises(APIError) as exc:
        await service.answer_text(
            db_session, text="hello world", lang="en", user=None, client_ip=None
        )
    assert exc.value.code == "unsupported_language"
    assert exc.value.status_code == 400


async def test_unsupported_language_detected(db_session):
    with pytest.raises(APIError) as exc:
        await service.answer_text(
            db_session, text="hello world", lang=None, user=None, client_ip=None
        )
    assert exc.value.code == "unsupported_language"


async def test_transcribe_rejects_fake_audio(tc):
    client = tc["client"]
    # بایت متنی با نام wav → magic-byte رد می‌کند
    r = await client.post(
        f"{BASE}/voice/transcribe",
        files={"file": ("fake.wav", b"this is not audio at all", "audio/wav")},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_audio"


async def test_transcribe_rejects_bad_extension(tc):
    client = tc["client"]
    r = await client.post(
        f"{BASE}/voice/transcribe",
        files={"file": ("x.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "invalid_audio"


def test_validate_audio_upload_units():
    # wav واقعی
    assert service.validate_audio_upload(_wav_bytes(), "a.wav", 25) == "wav"
    # webm واقعی (magic اول فایل)
    assert service.validate_audio_upload(b"\x1a\x45\xdf\xa3" + b"\x00" * 16, "a.webm", 25) == "webm"
    # mp4 با ftyp
    assert service.validate_audio_upload(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 16, "a.m4a", 25) == "m4a"
    # جعلی
    with pytest.raises(APIError) as exc:
        service.validate_audio_upload(b"not audio", "a.wav", 25)
    assert exc.value.code == "invalid_audio"
    # سقف حجم
    with pytest.raises(APIError) as exc:
        service.validate_audio_upload(_wav_bytes(), "a.wav", 0)
    assert exc.value.code == "audio_too_large"


# ---------------------------------------------------------------------------
# ۵) ادمین: تنظیمات + لاگ مصرف
# ---------------------------------------------------------------------------


async def test_admin_settings_get_put(tc, db_session):
    client = tc["client"]
    token = await _voice_admin_token(client, db_session, "voice-admin1@example.com")

    r = await client.get(f"{BASE}/admin/voice/settings", headers=_auth(token))
    assert r.status_code == 200, r.text
    settings = r.json()["settings"]
    assert settings["voice.stt_provider"] == "auto"
    assert settings["voice.tts_provider"] == "none"

    r = await client.put(
        f"{BASE}/admin/voice/settings",
        headers=_auth(token),
        json={"settings": {"voice.max_audio_seconds": 60, "voice.tts_provider": "auto"}},
    )
    assert r.status_code == 200, r.text
    assert set(r.json()["updated"]) == {"voice.max_audio_seconds", "voice.tts_provider"}

    r = await client.get(f"{BASE}/admin/voice/settings", headers=_auth(token))
    assert r.json()["settings"]["voice.max_audio_seconds"] == "60"

    # مقدار نامعتبر
    r = await client.put(
        f"{BASE}/admin/voice/settings",
        headers=_auth(token),
        json={"settings": {"voice.tts_provider": "nope"}},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_setting_value"

    # کلید ناشناخته
    r = await client.put(
        f"{BASE}/admin/voice/settings",
        headers=_auth(token),
        json={"settings": {"voice.nope": "x"}},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "unknown_setting"


async def test_admin_settings_forbidden_without_permission(tc):
    client = tc["client"]
    await _register(client, "voice-plain@example.com")
    token = await _login(client, "voice-plain@example.com")
    r = await client.get(f"{BASE}/admin/voice/settings", headers=_auth(token))
    assert r.status_code == 403


async def test_admin_usage_log_lists_ask(tc, db_session):
    client = tc["client"]
    token = await _voice_admin_token(client, db_session, "voice-admin2@example.com")

    out = await service.answer_text(
        db_session, text="سلام", lang="fa", user=None, client_ip=None
    )
    assert out["intent"] == "general"

    r = await client.get(f"{BASE}/admin/voice/usage", headers=_auth(token))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) >= 1
    assert items[0]["intent"] == "general"
    assert items[0]["lang"] == "fa"
    assert items[0]["session_id"]

    r = await client.get(
        f"{BASE}/admin/voice/usage", params={"intent": "quran"}, headers=_auth(token)
    )
    assert r.status_code == 200
    assert all(i["intent"] == "quran" for i in r.json()["items"])
