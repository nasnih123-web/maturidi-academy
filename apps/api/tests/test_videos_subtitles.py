"""تست‌های فاز ۳ ویدیوها — زیرنویس زمان‌دار (WebVTT) خودکار.

پوشش:
- سازندهٔ VTT: فرمت تایم‌استمپ، escape، رد سگمنت خالی، clamp end
- تسک تولید با whisper جعلی: منبع fa آماده؛ انگلیسی از پاس translate؛
  بقیهٔ زبان‌ها بدون provider پیکربندی‌شده → failed با دلیل صریح
  translation_provider_not_configured (متن جعلی ساخته نمی‌شود)
- همان تسک با provider جعلی: ترجمهٔ سگمنت‌ها آماده با تایمینگ منبع
- تسک روی آیتم خارجی → not_applicable و هیچ ردیفی ساخته نمی‌شود
- endpoint تریگر: بدون احراز ۴۰۱، آیتم ناموجود ۴۰۴، خارجی ۴۲۲
  external_video، غیرویدیو ۴۲۲ not_a_video، ویدیوی آپلودی ۲۰۲ + pending
- endpoint عمومی VTT: ترک ready → ۲۰۰ text/vtt؛ آماده‌نباشد → ۴۰۴؛
  payload تماشا فقط ترک‌های ready؛ با subtitles_enabled خاموش → خالی
- وضعیت‌های مدیریت برای کارت CRM: آیتم آپلودی با missingها؛ خارجی حذف
- لینک مستقیم فایل (غیر یوتیوب): تریگر ۲۰۲ می‌گیرد؛ تسک فایل را دانلود
  می‌کند و همان ترک‌های منبع+انگلیسی را می‌سازد؛ شکست دانلود → همهٔ
  ردیف‌ها failed با download_failed و تسک raise نمی‌کند؛ payload تماشا
  و endpoint VTT ترک‌های ready را می‌دهند؛ کارت CRM آن را نشان می‌دهد
  ولی یوتیوب همچنان بیرون است؛ دانلودر: سقف حجم و اتصال بایت‌ها
- آپارات (امبد خارجی): عیناً مثل یوتیوب مستثناست — تریگر ۴۲۲
  external_video، تسک not_applicable، کارت مدیریت و payload تماشا و
  endpoint VTT آن را ندارند

همهٔ تست‌ها آفلاین‌اند (whisper و provider و storage مانکی‌پچ می‌شوند).
"""
from __future__ import annotations

import json
import re
import uuid
from typing import ClassVar

import pytest
from sqlalchemy import select

BASE = "/api/v1"

FA_SEGMENTS = [
    {"start": 0.0, "end": 2.5, "text": "سلام و درود"},
    {"start": 2.5, "end": 5.0, "text": "به آکادمی ماتریدی خوش آمدید"},
]
EN_SEGMENTS = [
    {"start": 0.0, "end": 2.5, "text": "Hello and greetings"},
    {"start": 2.5, "end": 5.0, "text": "Welcome to Maturidi Academy"},
]


def _L(fa: str) -> dict:
    return {"fa": fa, "ar": fa, "en": fa}


def _uid() -> str:
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# VTT builder (واحدی)
# ---------------------------------------------------------------------------


def test_vtt_builder_formatting_escaping_and_clamps():
    from app.modules.videos.subtitles import build_vtt, format_vtt_timestamp

    assert format_vtt_timestamp(0) == "00:00:00.000"
    assert format_vtt_timestamp(3661.234) == "01:01:01.234"
    vtt = build_vtt(
        [
            {"start": 0.0, "end": 1.5, "text": "متن <b> & نشانه"},
            {"start": 2.0, "end": 2.0, "text": "پایان نامعتبر"},
            {"start": 3.0, "end": 4.0, "text": "   "},
        ]
    )
    assert vtt.startswith("WEBVTT\n\n")
    assert "00:00:00.000 --> 00:00:01.500" in vtt
    assert "متن &lt;b&gt; &amp; نشانه" in vtt
    # end ≤ start → نیم‌ثانیه بعد از start
    assert "00:00:02.000 --> 00:00:02.500" in vtt
    # سگمنت خالی cue نمی‌شود
    assert vtt.count("-->") == 2
    assert build_vtt([]) == "WEBVTT\n"


# ---------------------------------------------------------------------------
# کاربران و آیتم‌ها
# ---------------------------------------------------------------------------


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uid()
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (
                await db.execute(
                    select(Permission).where(Permission.key == key)
                )
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role = Role(name=f"sub_test_role_{suffix}", description="subtitle tests")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست زیرنویس",
            email=f"sub-{suffix}@example.com",
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
    return {"Authorization": f"Bearer {token}"}


async def _admin(tc):
    return await _make_user(tc, permissions=("library.manage",))


async def _make_item(tc, **over) -> str:
    from app.models.models import LibraryItem

    fields = {
        "kind": "video",
        "title": _L("ویدیوی تست زیرنویس"),
        "media_key": "library/test-video.mp4",
        "visibility": "public",
        "workflow_status": "published",
    }
    fields.update(over)
    async with tc["maker"]() as db:
        item = LibraryItem(**fields)
        db.add(item)
        await db.commit()
        return str(item.id)


async def _subtitle_rows(tc, item_id: str) -> dict[str, dict]:
    from app.models.models import ItemSubtitle

    async with tc["maker"]() as db:
        rows = (
            await db.execute(
                select(ItemSubtitle).where(
                    ItemSubtitle.item_id == uuid.UUID(item_id)
                )
            )
        ).scalars().all()
    return {
        r.lang: {"status": r.status, "vtt": r.vtt, "error": r.error}
        for r in rows
    }


# ---------------------------------------------------------------------------
# تسک تولید — whisper/provider جعلی
# ---------------------------------------------------------------------------


class _FakeWhisper:
    """FasterWhisperSTT جعلی: fa برای transcribe و en برای translate."""

    calls: ClassVar[list[str]] = []

    def __init__(self, model_size=None, device="cpu"):
        self.model_size = model_size

    async def transcribe_segments(
        self, data, *, lang=None, task="transcribe", timeout_s=None
    ):
        type(self).calls.append(task)
        if task == "translate":
            return {
                "segments": [dict(s) for s in EN_SEGMENTS],
                "language": "en",
                "duration_s": 5.0,
            }
        return {
            "segments": [dict(s) for s in FA_SEGMENTS],
            "language": "fa",
            "duration_s": 5.0,
        }


class _FakeProvider:
    """provider ترجمهٔ جعلی: هر خط شماره‌دار را با پیشوند T برمی‌گرداند."""

    name = "fake"

    async def generate(self, layers, *, timeout_s=60.0, max_tokens=1024):
        from app.modules.fatwa.providers import LLMResult

        out_lines = []
        for line in layers.context.splitlines():
            m = re.match(r"\[(\d+)\]\s*(.*)$", line)
            if m:
                out_lines.append(f"[{m.group(1)}] T:{m.group(2)}")
        return LLMResult(text="\n".join(out_lines), model="fake-1")


async def _pin_subtitle_langs(tc):
    """زبان‌های هدف را صریحاً هر پنج زبان می‌کنیم تا تست‌های تسک از
    ردیف‌های settings به‌جامانده از تست‌های دیگر مستقل باشند."""
    from app.core.platform_settings import reset_settings_cache, stage_setting

    async with tc["maker"]() as db:
        await stage_setting(
            db,
            "videos.subtitle_langs",
            json.dumps(["fa", "ar", "en", "ur", "dari"]),
        )
        await db.commit()
    reset_settings_cache()


@pytest.fixture
def patch_task_env(tc, monkeypatch):
    """محیط تسک: SessionLocal تست + whisper نصب‌شده + خواندن فایل جعلی."""
    monkeypatch.setattr("app.core.database.SessionLocal", tc["maker"])
    monkeypatch.setattr(
        "app.core.media_tools.faster_whisper_installed", lambda: True
    )
    monkeypatch.setattr(
        "app.modules.voice.stt.FasterWhisperSTT", _FakeWhisper
    )

    async def _fake_read(item):
        return b"fake-media-bytes"

    monkeypatch.setattr(
        "app.modules.library.tasks._read_media_bytes", _fake_read
    )
    _FakeWhisper.calls = []
    return tc


async def test_generate_subtitles_fa_source_unconfigured_provider(
    tc, patch_task_env, monkeypatch
):
    await _pin_subtitle_langs(tc)
    """منبع fa آماده، en از whisper، بقیه بدون provider → failed صریح."""
    monkeypatch.setattr(
        "app.modules.videos.subtitles.resolve_translation_provider",
        lambda db: _async_none(),
    )
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_item(tc)
    out = await generate_subtitles({}, item_id)
    assert out["ok"] is True
    assert out["source_lang"] == "fa"
    assert _FakeWhisper.calls == ["transcribe", "translate"]

    rows = await _subtitle_rows(tc, item_id)
    assert rows["fa"]["status"] == "ready"
    assert "سلام و درود" in rows["fa"]["vtt"]
    assert "00:00:00.000 --> 00:00:02.500" in rows["fa"]["vtt"]
    assert rows["en"]["status"] == "ready"
    assert "Hello and greetings" in rows["en"]["vtt"]
    for lang in ("ar", "ur", "dari"):
        assert rows[lang]["status"] == "failed", lang
        assert rows[lang]["error"] == "translation_provider_not_configured"
        assert rows[lang]["vtt"] is None


async def _async_none():
    return None


async def test_generate_subtitles_with_provider_translates(
    tc, patch_task_env, monkeypatch
):
    await _pin_subtitle_langs(tc)
    """با provider پیکربندی‌شده، زبان‌های دیگر با تایمینگ منبع آماده‌اند."""

    async def _fake_resolve(db):
        return _FakeProvider()

    monkeypatch.setattr(
        "app.modules.videos.subtitles.resolve_translation_provider",
        _fake_resolve,
    )
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_item(tc)
    out = await generate_subtitles({}, item_id)
    assert out["ok"] is True
    assert sorted(out["ready"]) == ["ar", "dari", "en", "fa", "ur"]
    assert out["failed"] == {}

    rows = await _subtitle_rows(tc, item_id)
    assert rows["ar"]["status"] == "ready"
    # متن ترجمه‌شده با همان تایمینگ سگمنت منبع
    assert "T:سلام و درود" in rows["ar"]["vtt"]
    assert "00:00:02.500 --> 00:00:05.000" in rows["ar"]["vtt"]


async def test_generate_subtitles_external_item_not_applicable(
    tc, patch_task_env
):
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_item(
        tc,
        media_key=None,
        external_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    out = await generate_subtitles({}, item_id)
    assert out == {"ok": False, "reason": "not_applicable"}
    assert await _subtitle_rows(tc, item_id) == {}


async def test_generate_subtitles_without_whisper_fails_honestly(
    tc, patch_task_env, monkeypatch
):
    await _pin_subtitle_langs(tc)
    monkeypatch.setattr(
        "app.core.media_tools.faster_whisper_installed", lambda: False
    )
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_item(tc)
    out = await generate_subtitles({}, item_id)
    assert out["ok"] is False
    assert out["reason"].startswith("stt_unavailable")
    rows = await _subtitle_rows(tc, item_id)
    assert rows and all(r["status"] == "failed" for r in rows.values())
    assert all("stt_unavailable" in (r["error"] or "") for r in rows.values())


# ---------------------------------------------------------------------------
# endpoint تریگر
# ---------------------------------------------------------------------------


async def test_trigger_requires_auth_and_admin(tc):
    client = tc["client"]
    item_id = await _make_item(tc)
    res = await client.post(
        f"{BASE}/admin/videos/{item_id}/subtitles/generate"
    )
    assert res.status_code in (401, 403)
    plain = await _make_user(tc)
    res = await client.post(
        f"{BASE}/admin/videos/{item_id}/subtitles/generate", headers=plain
    )
    assert res.status_code == 403


async def test_trigger_404_and_422s(tc):
    client = tc["client"]
    admin = await _admin(tc)

    res = await client.post(
        f"{BASE}/admin/videos/{uuid.uuid4()}/subtitles/generate",
        headers=admin,
    )
    assert res.status_code == 404

    external_id = await _make_item(
        tc,
        media_key=None,
        external_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    res = await client.post(
        f"{BASE}/admin/videos/{external_id}/subtitles/generate",
        headers=admin,
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "external_video"

    pdf_id = await _make_item(tc, kind="pdf", media_key="library/x.pdf")
    res = await client.post(
        f"{BASE}/admin/videos/{pdf_id}/subtitles/generate", headers=admin
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "not_a_video"


async def test_trigger_creates_pending_rows(tc):
    await _pin_subtitle_langs(tc)
    client = tc["client"]
    admin = await _admin(tc)
    item_id = await _make_item(tc)
    res = await client.post(
        f"{BASE}/admin/videos/{item_id}/subtitles/generate", headers=admin
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["item_id"] == item_id
    assert body["statuses"] == {
        lang: "pending" for lang in ("fa", "ar", "en", "ur", "dari")
    }
    # صف ARQ در تست در دسترس نیست → enqueued صادقانه False است
    assert body["enqueued"] is False
    rows = await _subtitle_rows(tc, item_id)
    assert all(r["status"] == "pending" for r in rows.values())


# ---------------------------------------------------------------------------
# endpoint عمومی VTT + payload تماشا
# ---------------------------------------------------------------------------


async def _seed_ready_subtitle(tc, item_id: str, lang: str, vtt: str):
    from app.models.models import ItemSubtitle

    async with tc["maker"]() as db:
        db.add(
            ItemSubtitle(
                item_id=uuid.UUID(item_id), lang=lang, status="ready", vtt=vtt
            )
        )
        await db.commit()


async def test_public_vtt_endpoint_and_watch_payload(tc):
    client = tc["client"]
    item_id = await _make_item(tc)
    vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nسلام و درود\n"
    await _seed_ready_subtitle(tc, item_id, "fa", vtt)
    async with tc["maker"]() as db:
        from app.models.models import ItemSubtitle

        db.add(
            ItemSubtitle(
                item_id=uuid.UUID(item_id), lang="ar", status="pending"
            )
        )
        await db.commit()

    watch = await client.get(f"{BASE}/videos/{item_id}")
    assert watch.status_code == 200, watch.text
    tracks = watch.json()["subtitles"]
    assert tracks == [
        {"lang": "fa", "url": f"/api/v1/videos/{item_id}/subtitles/fa.vtt"}
    ]

    res = await client.get(f"{BASE}/videos/{item_id}/subtitles/fa.vtt")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/vtt")
    assert res.text == vtt

    # ترک pending آماده نیست → ۴۰۴
    res = await client.get(f"{BASE}/videos/{item_id}/subtitles/ar.vtt")
    assert res.status_code == 404
    # زبان بی‌ربط → ۴۰۴
    res = await client.get(f"{BASE}/videos/{item_id}/subtitles/de.vtt")
    assert res.status_code == 404


async def test_watch_payload_empty_when_subtitles_disabled(tc):
    from app.core.platform_settings import (
        reset_settings_cache,
        stage_setting,
    )

    client = tc["client"]
    item_id = await _make_item(tc)
    await _seed_ready_subtitle(
        tc, item_id, "fa", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nx\n"
    )
    async with tc["maker"]() as db:
        await stage_setting(db, "videos.subtitles_enabled", json.dumps(False))
        await db.commit()
    reset_settings_cache()
    try:
        watch = await client.get(f"{BASE}/videos/{item_id}")
        assert watch.status_code == 200
        assert watch.json()["subtitles"] == []
    finally:
        async with tc["maker"]() as db:
            from app.models.models import PlatformSetting

            row = await db.get(PlatformSetting, "videos.subtitles_enabled")
            if row is not None:
                await db.delete(row)
                await db.commit()
        reset_settings_cache()


async def test_vtt_endpoint_respects_visibility(tc):
    """آیتم پیش‌نویس/مخفی برای مهمان ۴۰۴ است — حتی با ترک ready."""
    client = tc["client"]
    item_id = await _make_item(tc, workflow_status="draft")
    await _seed_ready_subtitle(
        tc, item_id, "fa", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nx\n"
    )
    res = await client.get(f"{BASE}/videos/{item_id}/subtitles/fa.vtt")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# وضعیت‌های مدیریت (کارت CRM)
# ---------------------------------------------------------------------------


async def test_admin_subtitle_statuses(tc):
    client = tc["client"]
    admin = await _admin(tc)
    item_id = await _make_item(tc)
    await _seed_ready_subtitle(
        tc, item_id, "fa", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nx\n"
    )
    external_id = await _make_item(
        tc,
        media_key=None,
        external_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title=_L("خارجی"),
    )

    res = await client.get(f"{BASE}/admin/videos/subtitles", headers=admin)
    assert res.status_code == 200, res.text
    by_id = {row["id"]: row for row in res.json()}
    assert item_id in by_id
    assert external_id not in by_id  # خارجی‌ها در کارت زیرنویس نیستند
    subs = by_id[item_id]["subtitles"]
    assert subs["fa"] == "ready"
    assert subs["ar"] == "missing"
    assert subs["en"] == "missing"
    assert subs["ur"] == "missing"
    assert subs["dari"] == "missing"
    # هیچ ردیف failedای نیست → errors خالی
    assert by_id[item_id]["errors"] == {}


async def _seed_subtitle_row(tc, item_id: str, lang: str, status: str, error=None):
    from app.models.models import ItemSubtitle

    async with tc["maker"]() as db:
        db.add(
            ItemSubtitle(
                item_id=uuid.UUID(item_id), lang=lang, status=status, error=error
            )
        )
        await db.commit()


async def test_admin_subtitle_statuses_include_errors(tc):
    client = tc["client"]
    admin = await _admin(tc)
    item_id = await _make_item(tc)
    # fa آماده، ar شکست با دلیل، en شکست بدون دلیل، ur در انتظار
    await _seed_ready_subtitle(tc, item_id, "fa", "WEBVTT\n\nx\n")
    await _seed_subtitle_row(
        tc, item_id, "ar", "failed", "translation_provider_not_configured"
    )
    await _seed_subtitle_row(tc, item_id, "en", "failed", None)
    await _seed_subtitle_row(tc, item_id, "ur", "pending")
    clean_id = await _make_item(tc, title=_L("بدون خطا"))

    res = await client.get(f"{BASE}/admin/videos/subtitles", headers=admin)
    assert res.status_code == 200, res.text
    by_id = {row["id"]: row for row in res.json()}

    subs = by_id[item_id]["subtitles"]
    assert subs["fa"] == "ready"
    assert subs["ar"] == "failed"
    assert subs["en"] == "failed"
    assert subs["ur"] == "pending"
    assert subs["dari"] == "missing"
    # فقط ردیف failed با error غیرخالی در errors می‌آید — با متن دقیق
    assert by_id[item_id]["errors"] == {
        "ar": "translation_provider_not_configured"
    }
    # آیتم بدون ردیف failed → errors خالی
    assert by_id[clean_id]["errors"] == {}


# ---------------------------------------------------------------------------
# لینک مستقیم فایل (external غیرِ یوتیوب)
# ---------------------------------------------------------------------------

DIRECT_FILE_URL = "https://cdn.example.com/talks/lecture.mp4"


async def _make_direct_file_item(tc, **over) -> str:
    over.setdefault("media_key", None)
    over.setdefault("external_url", DIRECT_FILE_URL)
    return await _make_item(tc, **over)


async def test_trigger_direct_file_item_accepted(tc):
    await _pin_subtitle_langs(tc)
    client = tc["client"]
    admin = await _admin(tc)
    item_id = await _make_direct_file_item(tc)
    res = await client.post(
        f"{BASE}/admin/videos/{item_id}/subtitles/generate", headers=admin
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["item_id"] == item_id
    assert body["statuses"] == {
        lang: "pending" for lang in ("fa", "ar", "en", "ur", "dari")
    }
    assert body["enqueued"] is False
    rows = await _subtitle_rows(tc, item_id)
    assert all(r["status"] == "pending" for r in rows.values())


async def test_generate_subtitles_direct_file_downloads_and_builds(
    tc, patch_task_env, monkeypatch
):
    await _pin_subtitle_langs(tc)
    """لینک مستقیم: دانلود از URL آیتم + همان خروجی آپلود (fa/en آماده)."""
    monkeypatch.setattr(
        "app.modules.videos.subtitles.resolve_translation_provider",
        lambda db: _async_none(),
    )
    downloads: list[str] = []

    async def _fake_download(url):
        downloads.append(url)
        return b"downloaded-media-bytes"

    monkeypatch.setattr(
        "app.modules.videos.tasks._download_external_media", _fake_download
    )

    async def _no_storage_read(item):  # مسیر storage نباید صدا زده شود
        raise AssertionError("storage read نباید برای لینک مستقیم بیاید")

    monkeypatch.setattr(
        "app.modules.library.tasks._read_media_bytes", _no_storage_read
    )
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_direct_file_item(tc)
    out = await generate_subtitles({}, item_id)
    assert out["ok"] is True
    assert out["source_lang"] == "fa"
    assert downloads == [DIRECT_FILE_URL]
    assert _FakeWhisper.calls == ["transcribe", "translate"]

    rows = await _subtitle_rows(tc, item_id)
    assert rows["fa"]["status"] == "ready"
    assert "سلام و درود" in rows["fa"]["vtt"]
    assert rows["en"]["status"] == "ready"
    assert "Hello and greetings" in rows["en"]["vtt"]
    for lang in ("ar", "ur", "dari"):
        assert rows[lang]["status"] == "failed", lang
        assert rows[lang]["error"] == "translation_provider_not_configured"


async def test_generate_subtitles_direct_file_download_failure(
    tc, patch_task_env, monkeypatch
):
    await _pin_subtitle_langs(tc)
    """شکست دانلود: تسک raise نمی‌کند؛ همهٔ ردیف‌ها failed صادقانه‌اند."""

    async def _boom_download(url):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(
        "app.modules.videos.tasks._download_external_media", _boom_download
    )
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_direct_file_item(tc)
    out = await generate_subtitles({}, item_id)
    assert out["ok"] is False
    assert out["reason"].startswith("download_failed")
    rows = await _subtitle_rows(tc, item_id)
    assert rows and all(r["status"] == "failed" for r in rows.values())
    assert all(
        "download_failed" in (r["error"] or "") for r in rows.values()
    )


async def test_watch_payload_and_vtt_for_direct_file_item(tc):
    client = tc["client"]
    item_id = await _make_direct_file_item(tc)
    vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nسلام و درود\n"
    await _seed_ready_subtitle(tc, item_id, "fa", vtt)

    watch = await client.get(f"{BASE}/videos/{item_id}")
    assert watch.status_code == 200, watch.text
    assert watch.json()["subtitles"] == [
        {"lang": "fa", "url": f"/api/v1/videos/{item_id}/subtitles/fa.vtt"}
    ]
    # پخش با پلیر بومی است (لینک فایل)، نه امبد یوتیوب
    assert watch.json()["item"]["embed_url"] is None
    assert watch.json()["stream_url"] == DIRECT_FILE_URL

    res = await client.get(f"{BASE}/videos/{item_id}/subtitles/fa.vtt")
    assert res.status_code == 200
    assert res.text == vtt

    # بدون تولید، ترک‌ها خالی می‌مانند
    bare_id = await _make_direct_file_item(tc, title=_L("بدون زیرنویس"))
    watch = await client.get(f"{BASE}/videos/{bare_id}")
    assert watch.status_code == 200
    assert watch.json()["subtitles"] == []

    # یوتیوب حتی با ردیف ready هم ترک نمی‌گیرد (رفتار قبلی)
    yt_id = await _make_item(
        tc,
        media_key=None,
        external_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title=_L("یوتیوبی"),
    )
    await _seed_ready_subtitle(tc, yt_id, "fa", vtt)
    watch = await client.get(f"{BASE}/videos/{yt_id}")
    assert watch.status_code == 200
    assert watch.json()["subtitles"] == []
    res = await client.get(f"{BASE}/videos/{yt_id}/subtitles/fa.vtt")
    assert res.status_code == 404


async def test_admin_statuses_include_direct_file_not_youtube(tc):
    client = tc["client"]
    admin = await _admin(tc)
    file_id = await _make_direct_file_item(tc)
    yt_id = await _make_item(
        tc,
        media_key=None,
        external_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title=_L("یوتیوبی"),
    )
    res = await client.get(f"{BASE}/admin/videos/subtitles", headers=admin)
    assert res.status_code == 200, res.text
    by_id = {row["id"]: row for row in res.json()}
    assert file_id in by_id  # لینک مستقیم در کارت زیرنویس هست
    assert yt_id not in by_id  # یوتیوب همچنان بیرون است
    subs = by_id[file_id]["subtitles"]
    assert all(s == "missing" for s in subs.values())


# ---------------------------------------------------------------------------
# دانلودر لینک مستقیم (واحدی — httpx جعلی)
# ---------------------------------------------------------------------------


class _FakeStreamResponse:
    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self, chunk_size: int):
        for chunk in self._chunks:
            yield chunk


class _FakeHTTPClient:
    chunks: ClassVar[list[bytes]] = []
    last_kwargs: ClassVar[dict] = {}

    def __init__(self, *args, **kwargs):
        type(self).last_kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method: str, url: str):
        resp = _FakeStreamResponse(type(self).chunks)

        class _Ctx:
            async def __aenter__(self):
                return resp

            async def __aexit__(self, *exc):
                return False

        return _Ctx()


async def test_download_external_media_joins_chunks(monkeypatch):
    from app.modules.videos.tasks import _download_external_media

    _FakeHTTPClient.chunks = [b"ab", b"cd", b"ef"]
    monkeypatch.setattr("httpx.AsyncClient", _FakeHTTPClient)
    data = await _download_external_media("https://cdn.example.com/x.mp4")
    assert data == b"abcdef"


async def test_download_external_media_sends_descriptive_user_agent(
    monkeypatch,
):
    # ویکی‌مدیا ایجنت پیش‌فرض httpx را ۴۰۳ می‌کند؛ دانلودر باید با
    # User-Agent توصیفی سامانه برود (رگرسیون خطای زندهٔ ۲۰۲۶-۱۱-۲۲).
    from app.modules.videos import tasks as video_tasks

    _FakeHTTPClient.chunks = [b"ab"]
    monkeypatch.setattr("httpx.AsyncClient", _FakeHTTPClient)
    data = await video_tasks._download_external_media(
        "https://upload.wikimedia.org/wikipedia/commons/transcoded/x.webm"
    )
    assert data == b"ab"
    headers = _FakeHTTPClient.last_kwargs.get("headers") or {}
    assert headers.get("User-Agent") == video_tasks._DOWNLOAD_USER_AGENT
    assert headers["User-Agent"].startswith("MaturidiAcademy/")
    assert "python-httpx" not in headers["User-Agent"]


async def test_download_external_media_enforces_size_cap(monkeypatch):
    from app.modules.videos import tasks as video_tasks

    _FakeHTTPClient.chunks = [b"12345678", b"90abcdef"]
    monkeypatch.setattr("httpx.AsyncClient", _FakeHTTPClient)
    monkeypatch.setattr(video_tasks, "_DOWNLOAD_MAX_BYTES", 10)
    with pytest.raises(ValueError, match="file_too_large"):
        await video_tasks._download_external_media(
            "https://cdn.example.com/big.mp4"
        )


# ---------------------------------------------------------------------------
# آپارات (امبد خارجی — عیناً مثل یوتیوب از زیرنویس مستثناست)
# ---------------------------------------------------------------------------

APARAT_URL = "https://www.aparat.com/v/cpuac8h"


async def test_trigger_generate_aparat_item_422(tc):
    client = tc["client"]
    admin = await _admin(tc)
    item_id = await _make_item(tc, media_key=None, external_url=APARAT_URL)
    res = await client.post(
        f"{BASE}/admin/videos/{item_id}/subtitles/generate", headers=admin
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "external_video"


async def test_generate_subtitles_aparat_item_not_applicable(
    tc, patch_task_env
):
    from app.modules.videos.tasks import generate_subtitles

    item_id = await _make_item(tc, media_key=None, external_url=APARAT_URL)
    out = await generate_subtitles({}, item_id)
    assert out == {"ok": False, "reason": "not_applicable"}
    assert await _subtitle_rows(tc, item_id) == {}


async def test_aparat_item_excluded_from_admin_statuses(tc):
    client = tc["client"]
    admin = await _admin(tc)
    aparat_id = await _make_item(
        tc, media_key=None, external_url=APARAT_URL, title=_L("آپاراتی")
    )
    res = await client.get(f"{BASE}/admin/videos/subtitles", headers=admin)
    assert res.status_code == 200, res.text
    by_id = {row["id"]: row for row in res.json()}
    assert aparat_id not in by_id  # امبدی‌ها در کارت زیرنویس نیستند


async def test_aparat_watch_payload_and_vtt_excluded(tc):
    """حتی با ترک ready دستی، payload تماشا برای امبدی خالی و VTT ۴۰۴ است."""
    client = tc["client"]
    item_id = await _make_item(tc, media_key=None, external_url=APARAT_URL)
    await _seed_ready_subtitle(
        tc, item_id, "fa", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nx\n"
    )
    watch = await client.get(f"{BASE}/videos/{item_id}")
    assert watch.status_code == 200, watch.text
    assert watch.json()["subtitles"] == []
    res = await client.get(f"{BASE}/videos/{item_id}/subtitles/fa.vtt")
    assert res.status_code == 404
