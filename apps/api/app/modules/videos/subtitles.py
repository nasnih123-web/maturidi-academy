"""ابزارهای زیرنویس زمان‌دار — فاز ۳ بخش ویدیوها.

- ساخت WebVTT از سگمنت‌های whisper (با escape و تایم‌استمپ استاندارد).
- زبان‌های هدف از تنظیم CRM (videos.subtitle_langs) خوانده می‌شوند.
- ترجمهٔ سگمنت‌ها فقط از مسیر provider واقعی سامانه است:
  app.modules.fatwa.providers.resolve_provider — وقتی کلید LLM در
  settings تنظیم نشده باشد None برمی‌گرداند و این‌جا
  TranslationNotConfigured بالا می‌آید تا ردیف آن زبان با دلیل صریح
  translation_provider_not_configured به failed برود؛ متن جعلی هرگز
  ساخته نمی‌شود.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_settings import get_typed_setting
from app.models.models import ItemSubtitle, LibraryItem

from . import aparat, youtube
from .schemas import SUBTITLE_LANGS

# نام زبان مقصد برای prompt ترجمه
_LANG_NAMES: dict[str, str] = {
    "fa": "Persian",
    "ar": "Arabic",
    "en": "English",
    "ur": "Urdu",
    "dari": "Dari (Afghan Persian)",
}

_TRANSLATE_BATCH = 30
_NUMBERED_LINE_RE = re.compile(r"\s*\[(\d+)\]\s*(.*)$")


class TranslationNotConfigured(Exception):
    """هیچ provider ترجمه‌ای در settings پیکربندی نشده است."""


class TranslationFailed(Exception):
    """provider خطا داد یا خروجی‌اش با سگمنت‌ها هم‌خوان نبود."""


# ---------------------------------------------------------------------------
# کلاس رسانه‌ای آیتم (آپلودی / امبدی: یوتیوب و آپارات / لینک مستقیم فایل)
# ---------------------------------------------------------------------------


def is_youtube_external(item: LibraryItem) -> bool:
    """آیتم خارجیِ یوتیوبی: external_url دارد و به شناسهٔ یوتیوب تجزیه
    می‌شود — کپشن داخل خود یوتیوب است و تولید زیرنویس ندارد."""
    return bool(item.external_url) and (
        youtube.parse_youtube_video_id(item.external_url) is not None
    )


def is_aparat_external(item: LibraryItem) -> bool:
    """آیتم خارجیِ آپاراتی: external_url دارد و به هش آپارات تجزیه
    می‌شود — کپشن داخل خود آپارات است و تولید زیرنویس ندارد."""
    return bool(item.external_url) and (
        aparat.parse_aparat_video_hash(item.external_url) is not None
    )


def is_embed_external(item: LibraryItem) -> bool:
    """آیتم خارجیِ امبدی (یوتیوب یا آپارات): پخش فقط از iframe منبع است
    و فایل قابل دانلودی ندارد — از تولید زیرنویس مستثناست."""
    return is_youtube_external(item) or is_aparat_external(item)


def is_direct_file_external(item: LibraryItem) -> bool:
    """آیتم «لینک مستقیم فایل» (PR #182): external_url دارد ولی امبدی
    (یوتیوب/آپارات) نیست — فایل از همان URL قابل دانلود است و تولید
    زیرنویس دارد."""
    return bool(item.external_url) and not is_embed_external(item)


# ---------------------------------------------------------------------------
# WebVTT
# ---------------------------------------------------------------------------


def format_vtt_timestamp(seconds: float) -> str:
    """ثانیه → HH:MM:SS.mmm (فرمت استاندارد WebVTT)."""
    total_ms = round(max(0.0, float(seconds)) * 1000)
    ms = total_ms % 1000
    total_s = total_ms // 1000
    return (
        f"{total_s // 3600:02d}:{(total_s // 60) % 60:02d}:"
        f"{total_s % 60:02d}.{ms:03d}"
    )


def build_vtt(segments: list[dict]) -> str:
    """سگمنت‌های [{start, end, text}] → متن کامل WebVTT.

    سگمنت‌های بی‌متن رد می‌شوند؛ متن escape می‌شود (& < >) تا cue خراب
    نشود؛ end نامعتبر (≤ start) به نیم‌ثانیه بعد از start clamp می‌شود.
    """
    cues: list[str] = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start") or 0.0)
        end = float(seg.get("end") or 0.0)
        if end <= start:
            end = start + 0.5
        escaped = (
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )
        cues.append(
            f"{format_vtt_timestamp(start)} --> {format_vtt_timestamp(end)}\n"
            f"{escaped}"
        )
    body = "\n\n".join(cues)
    return f"WEBVTT\n\n{body}\n" if body else "WEBVTT\n"


def _parse_vtt_timestamp(raw: str) -> float | None:
    """«HH:MM:SS.mmm» / «MM:SS.mmm» / «SS.mmm» → ثانیه (None اگر خراب)."""
    parts = raw.strip().replace(",", ".").split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 1:
            return float(parts[0])
    except ValueError:
        return None
    return None


def parse_vtt(vtt: str | None) -> list[dict]:
    """متن WebVTT → سگمنت‌های [{start, end, text}] — وارون build_vtt.

    برای ویرایشگر CRM: بلوک‌های بدون خط زمان یا با زمان خراب رد
    می‌شوند؛ escapeهای build_vtt (&lt; &gt; &amp;) به متن خام
    برمی‌گردند تا ویرایشگر متن واقعی را نشان دهد؛ خروجی بر اساس
    شروع مرتب است.
    """
    if not vtt:
        return []
    segments: list[dict] = []
    normalized = vtt.replace("\r\n", "\n").replace("\r", "\n")
    for block in re.split(r"\n[ \t]*\n", normalized):
        lines = block.split("\n")
        timing_idx = next(
            (i for i, line in enumerate(lines) if "-->" in line), None
        )
        if timing_idx is None:
            continue
        start_raw, _, end_raw = lines[timing_idx].partition("-->")
        # بعد از زمان پایان ممکن است cue settings بیاید — فقط خود زمان.
        end_token = end_raw.strip().split(" ")[0] if end_raw.strip() else ""
        start = _parse_vtt_timestamp(start_raw)
        end = _parse_vtt_timestamp(end_token)
        if start is None or end is None:
            continue
        text = "\n".join(lines[timing_idx + 1 :]).strip()
        text = (
            text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
        )
        if not text:
            continue
        segments.append({"start": start, "end": end, "text": text})
    segments.sort(key=lambda seg: seg["start"])
    return segments


# ---------------------------------------------------------------------------
# تنظیمات
# ---------------------------------------------------------------------------


async def subtitles_enabled(db: AsyncSession) -> bool:
    """سوییچ CRM videos.subtitles_enabled — پیش‌فرض روشن (مثل /settings/public)."""
    return bool(await get_typed_setting(db, "videos.subtitles_enabled", True))


async def target_langs(db: AsyncSession) -> list[str]:
    """زبان‌های هدف ساخت زیرنویس از videos.subtitle_langs (فقط مجازها)."""
    raw = await get_typed_setting(db, "videos.subtitle_langs", None)
    if not isinstance(raw, list):
        return list(SUBTITLE_LANGS)
    return [str(x) for x in raw if str(x) in SUBTITLE_LANGS]


# ---------------------------------------------------------------------------
# ردیف‌ها
# ---------------------------------------------------------------------------


async def reset_rows(
    db: AsyncSession, item_id: uuid.UUID, langs: list[str]
) -> dict[str, str]:
    """جایگزینی کامل ردیف‌های زیرنویس آیتم: قبلی‌ها پاک، تازه‌ها pending.

    commit با فراخواننده است. خروجی: {lang: "pending"} به ترتیب langs.
    """
    await db.execute(
        delete(ItemSubtitle).where(ItemSubtitle.item_id == item_id)
    )
    statuses: dict[str, str] = {}
    for lang in langs:
        db.add(ItemSubtitle(item_id=item_id, lang=lang, status="pending"))
        statuses[lang] = "pending"
    await db.flush()
    return statuses


# ---------------------------------------------------------------------------
# ترجمهٔ سگمنت‌ها با provider سامانه
# ---------------------------------------------------------------------------


async def resolve_translation_provider(db: AsyncSession):
    """provider فعال LLM سامانه (fatwa) — None یعنی هیچ کلیدی تنظیم نیست."""
    from app.modules.fatwa.providers import resolve_provider

    return await resolve_provider(db)


def _parse_numbered(text: str, expected: int) -> list[str] | None:
    """خطوط «[n] متن» خروجی provider → فهرست مرتب؛ ناهم‌خوانی → None."""
    found: dict[int, str] = {}
    for line in (text or "").splitlines():
        m = _NUMBERED_LINE_RE.match(line)
        if m:
            found[int(m.group(1))] = m.group(2).strip()
    if sorted(found) != list(range(1, expected + 1)):
        return None
    return [found[i] for i in range(1, expected + 1)]


async def translate_segments(
    db: AsyncSession,
    segments: list[dict],
    target_lang: str,
    *,
    provider=None,
) -> list[dict]:
    """ترجمهٔ متن سگمنت‌ها به زبان مقصد، با حفظ تایمینگ منبع.

    سگمنت‌های خالی دست‌نخورده می‌مانند. provider داده نشود از settings
    حل می‌شود؛ نبود provider → TranslationNotConfigured؛ خطای provider
    یا خروجی ناهم‌خوان → TranslationFailed. هرگز متن ساختگی برنمی‌گردد.
    """
    if provider is None:
        provider = await resolve_translation_provider(db)
    if provider is None:
        raise TranslationNotConfigured("translation_provider_not_configured")

    from app.modules.fatwa.providers import (
        LLMProviderError,
        PromptLayers,
        sanitize_user_input,
    )

    lang_name = _LANG_NAMES.get(target_lang, target_lang)
    work = [
        (i, seg)
        for i, seg in enumerate(segments)
        if (seg.get("text") or "").strip()
    ]
    translated: dict[int, str] = {}
    for offset in range(0, len(work), _TRANSLATE_BATCH):
        batch = work[offset : offset + _TRANSLATE_BATCH]
        numbered = "\n".join(
            f"[{n}] {sanitize_user_input(seg['text'], max_chars=1000)}"
            for n, (_, seg) in enumerate(batch, start=1)
        )
        layers = PromptLayers(
            system=(
                "You are a professional subtitle translator. Translate "
                f"each numbered subtitle line into {lang_name}. Keep each "
                "translation concise enough to fit a subtitle cue. Output "
                "ONLY the numbered lines, in the same order and "
                "numbering, with no extra commentary."
            ),
            safety=(
                "Translate faithfully; do not add, omit, merge, or split "
                "lines."
            ),
            context=numbered,
            user_input=(
                f"Translate the numbered subtitle lines into {lang_name}."
            ),
        )
        try:
            result = await provider.generate(
                layers, timeout_s=120.0, max_tokens=4096
            )
        except LLMProviderError as exc:
            raise TranslationFailed(str(exc)[:400]) from exc
        parsed = _parse_numbered(result.text, len(batch))
        if parsed is None:
            raise TranslationFailed("translation_output_mismatch")
        for (orig_idx, _seg), text in zip(batch, parsed, strict=True):
            translated[orig_idx] = text
    return [
        {
            "start": seg["start"],
            "end": seg["end"],
            "text": translated.get(i, ""),
        }
        for i, seg in enumerate(segments)
    ]
