"""تست‌های TTS ابری واقعی (C-03 — ADR-0030).

provider با MockTransport (بایت‌های صوتی واقعی از endpoint ساختگیِ
تست — در تست مجاز است) اثبات می‌شود: سنتز → ذخیره در StorageProvider
→ URL امضاشده به کلاینت. نگهبان NEVER-TTS-Quran با provider ابریِ
پیکربندی‌شده هم دوباره اثبات می‌شود: برای قصد قرآن، provider هرگز
صدا زده نمی‌شود.
"""
from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import delete

from app.core.platform_settings import reset_settings_cache, stage_setting
from app.core.storage import get_storage
from app.models.models import PlatformSetting
from app.modules.voice import service
from app.modules.voice import tts as tts_mod

pytestmark = pytest.mark.asyncio

AUDIO_BYTES = b"\xff\xfb\x90\x64" + b"fake-but-real-bytes-mp3-frame" * 4
ENDPOINT = "https://tts.example.test/v1/audio/speech"


def _client_factory(handler, calls: list):
    def factory() -> httpx.AsyncClient:
        def _h(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return handler(request)

        return httpx.AsyncClient(transport=httpx.MockTransport(_h))

    return factory


_CLOUD_KEYS = (
    "voice.tts_provider",
    "voice.tts_cloud_endpoint",
    "voice.tts_cloud_api_key",
    "voice.tts_cloud_model",
)


@pytest.fixture(autouse=True)
async def _cleanup_cloud_settings(db_session):
    """تنظیمات staged این فایل نباید به تست‌های دیگر نشت کند (DB اشتراکی)."""
    yield
    await db_session.execute(
        delete(PlatformSetting).where(PlatformSetting.key.in_(_CLOUD_KEYS))
    )
    await db_session.commit()
    reset_settings_cache()


async def _configure_cloud(db, monkeypatch, handler, calls) -> None:
    await stage_setting(db, "voice.tts_provider", "cloud")
    await stage_setting(db, "voice.tts_cloud_endpoint", ENDPOINT)
    await stage_setting(db, "voice.tts_cloud_api_key", "sk-test-123")
    await stage_setting(db, "voice.tts_cloud_model", "tts-1")
    await db.commit()
    reset_settings_cache()
    monkeypatch.setattr(tts_mod, "_make_client", _client_factory(handler, calls))


def _ok_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=AUDIO_BYTES, headers={"content-type": "audio/mpeg"})


# ---------------------------------------------------------------------------
# واحد: CloudTTS
# ---------------------------------------------------------------------------


async def test_cloud_tts_posts_openai_shape_and_returns_bytes(monkeypatch):
    calls: list = []
    monkeypatch.setattr(tts_mod, "_make_client", _client_factory(_ok_handler, calls))
    provider = tts_mod.CloudTTS(endpoint=ENDPOINT, api_key="sk-test-123", model="tts-1")
    out = await provider.synthesize("سلام دنیا", lang="fa", voice="alloy")
    assert out["audio_bytes"] == AUDIO_BYTES
    assert out["mime"] == "audio/mpeg"
    assert len(calls) == 1
    body = json.loads(calls[0].content)
    assert body == {
        "model": "tts-1",
        "input": "سلام دنیا",
        "voice": "alloy",
        "response_format": "mp3",
    }
    assert calls[0].headers.get("authorization") == "Bearer " + "sk-test-123"


async def test_cloud_tts_upstream_error_degrades_honestly(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        tts_mod,
        "_make_client",
        _client_factory(lambda r: httpx.Response(500, text="boom"), calls),
    )
    raw, mime, notice = await tts_mod.synthesize_or_degrade(
        "متن",
        lang="fa",
        voice="alloy",
        configured_provider="cloud",
        cloud_endpoint=ENDPOINT,
        cloud_api_key="k",
    )
    assert raw is None and mime is None and notice == "tts_unavailable"


async def test_cloud_tts_unconfigured_endpoint_stays_unavailable():
    raw, mime, notice = await tts_mod.synthesize_or_degrade(
        "متن", lang="fa", voice="v", configured_provider="cloud", cloud_endpoint=""
    )
    assert (raw, mime, notice) == (None, None, "tts_unavailable")


# ---------------------------------------------------------------------------
# انتها‌به‌انتها در سرویس: ذخیره + URL + نگهبان قرآن
# ---------------------------------------------------------------------------


async def test_ask_synthesizes_stores_and_returns_signed_url(db_session, monkeypatch):
    calls: list = []
    await _configure_cloud(db_session, monkeypatch, _ok_handler, calls)
    out = await service.answer_text(
        db_session, text="سلام", lang="fa", user=None, client_ip=None
    )
    assert out["audio_kind"] == "tts"
    assert out["audio_url"], out
    assert "audio_base64" not in out or out.get("audio_base64") is None
    assert len(calls) == 1  # provider دقیقاً یک‌بار صدا زده شد
    # شیء ذخیره‌شده همان بایت‌های provider است (کلید قطعی از session_id)
    key = f"voice/tts/{out['session_id']}.mp3"
    assert key in out["audio_url"]
    stored = await get_storage().read_bytes(key)
    assert stored == AUDIO_BYTES


async def test_quran_intent_never_calls_cloud_tts(db_session, monkeypatch):
    calls: list = []
    await _configure_cloud(db_session, monkeypatch, _ok_handler, calls)

    async def fake_resolve(db, text, lang):
        return {
            "surah": 2,
            "ayah": 153,
            "surah_label": "بقره",
            "text_ar": "يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ",
            "translation": "ای مؤمنان، از صبر یاری بجویید",
            "translation_edition": "fa.ansarian",
            "audio_url": "https://cdn.example.test/recitation/2-153.mp3",
        }

    monkeypatch.setattr(service, "_resolve_quran_ayah", fake_resolve)
    out = await service.answer_text(
        db_session, text="آیه‌ای درباره صبر بخوان", lang="fa", user=None, client_ip=None
    )
    assert out["intent"] == "quran"
    assert out["audio_kind"] == "recitation"
    assert out["audio_url"] == "https://cdn.example.test/recitation/2-153.mp3"
    assert calls == [], "TTS ابری برای آیه هرگز نباید صدا زده شود"


async def test_provider_outage_degrades_to_text_with_notice(db_session, monkeypatch):
    calls: list = []
    await _configure_cloud(
        db_session, monkeypatch, lambda r: httpx.Response(503, text="down"), calls
    )
    out = await service.answer_text(
        db_session, text="سلام", lang="fa", user=None, client_ip=None
    )
    assert out["audio_kind"] == "none"
    assert out["notice"] == "tts_unavailable"
    assert out["text"]  # پاسخ متنی از دست نرفته است
