"""جاب‌های صف media بخش ویدیوها — فاز ۳ (زیرنویس زمان‌دار).

generate_subtitles: ساخت WebVTT با faster-whisper روی همان صف و
ماشین‌آلات transcribe_media (صف media، مدل پین‌شدهٔ media_tools):
- سگمنت‌های زبانِ منبع (تشخیص خودکار whisper) → ترک زبان منبع.
- انگلیسی: پاس دوم whisper با task="translate" (ترجمهٔ داخلی مدل).
- بقیهٔ زبان‌های هدف (videos.subtitle_langs): ترجمهٔ متنی سگمنت‌ها با
  provider واقعی سامانه (fatwa providers) و تایمینگ منبع؛ provider
  تنظیم نشده باشد ردیف آن زبان با دلیل صریح
  translation_provider_not_configured به failed می‌رود.

قاعدهٔ صداقت عیناً مثل رونویسی کتابخانه: شکست هر زبان با دلیل نام‌دار
روی ردیف خودش ثبت می‌شود؛ زیرنویس جعلی هرگز ساخته نمی‌شود. دری مثل
بقیهٔ زبان‌های ترجمه است — کپی خاموش از فارسی انجام نمی‌شود.

آیتم «لینک مستقیم فایل» (external_url غیرِ یوتیوب) هم همین خط لوله را
دارد: فایل اول با سقف حجم/مهلت به فایل موقت دانلود می‌شود و بعد دقیقاً
همان استخراج صدا + whisper آپلودها رویش می‌رود. یوتیوب همچنان
not_applicable است (کپشن داخل خود یوتیوب است).

تابع مستقیم هم تست‌پذیر است (بدون ARQ).
"""
from __future__ import annotations

import asyncio
import tempfile
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.queues import register_task
from app.models.models import ItemSubtitle, LibraryItem

from . import subtitles as subs
from .schemas import VIDEO_KINDS

# پاس منبع سقف رونویسی کتابخانه را دارد (۱۵۰۰ ثانیه)؛ پاس ترجمهٔ
# انگلیسی کوتاه‌تر است تا مجموع دو پاس از job_timeout صف media نگذرد.
_SOURCE_TIMEOUT_S = 1500
_TRANSLATE_TIMEOUT_S = 900

# دانلود فایل «لینک مستقیم»: سقف حجم سخت و مهلت کلی، تا جاب media
# (job_timeout=۱۸۰۰ ثانیه) پیش از پاس‌های whisper تمام نشود.
_DOWNLOAD_MAX_BYTES = 600 * 1024 * 1024
_DOWNLOAD_TIMEOUT_S = 600.0


async def _download_external_media(url: str) -> bytes:
    """دانلود استریمی فایل لینک مستقیم به فایل موقت و برگرداندن بایت‌ها
    برای همان خط لولهٔ whisper آپلودها.

    سقف حجم هنگام استریم اعمال می‌شود (نه بعد از دانلود کامل)؛ فایل
    موقت در همهٔ حالت‌ها پاک می‌شود؛ هر خطا raise می‌شود و فراخواننده
    آن را به failed صادقانهٔ ردیف‌ها تبدیل می‌کند.
    """
    import httpx

    deadline = time.monotonic() + _DOWNLOAD_TIMEOUT_S
    tmp_path: Path | None = None
    try:
        timeout = httpx.Timeout(
            connect=15.0, read=120.0, write=30.0, pool=15.0
        )
        async with (
            httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client,
            client.stream("GET", url) as resp,
        ):
            resp.raise_for_status()
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=".media"
            ) as fh:
                tmp_path = Path(fh.name)
                total = 0
                async for chunk in resp.aiter_bytes(1 << 20):
                    total += len(chunk)
                    if total > _DOWNLOAD_MAX_BYTES:
                        raise ValueError(
                            "file_too_large: حجم فایل از سقف "
                            "۶۰۰ مگابایت گذشت"
                        )
                    if time.monotonic() > deadline:
                        raise ValueError(
                            "download_timeout: مهلت دانلود تمام شد"
                        )
                    fh.write(chunk)
        return await asyncio.to_thread(tmp_path.read_bytes)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def _set_row(
    db: AsyncSession,
    item_id: uuid.UUID,
    lang: str,
    *,
    status: str,
    vtt: str | None = None,
    error: str | None = None,
) -> ItemSubtitle:
    row = (
        await db.execute(
            select(ItemSubtitle).where(
                ItemSubtitle.item_id == item_id, ItemSubtitle.lang == lang
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = ItemSubtitle(item_id=item_id, lang=lang, status=status)
        db.add(row)
    row.status = status
    row.vtt = vtt
    row.error = error
    row.updated_at = _utcnow()
    await db.flush()
    return row


async def _all_rows(
    db: AsyncSession, item_id: uuid.UUID
) -> list[ItemSubtitle]:
    stmt = select(ItemSubtitle).where(ItemSubtitle.item_id == item_id)
    return list((await db.execute(stmt)).scalars().all())


async def _fail_all(
    db: AsyncSession, item_id: uuid.UUID, reason: str
) -> None:
    for row in await _all_rows(db, item_id):
        row.status = "failed"
        row.error = reason[:500]
        row.updated_at = _utcnow()
    await db.commit()


@register_task("media")
async def generate_subtitles(ctx: dict, item_id: str) -> dict:
    """ساخت زیرنویس‌های زمان‌دار ویدیوی آپلودی یا لینک مستقیم فایل
    (صف media — فاز ۳)."""
    from app.core.database import SessionLocal
    from app.core.errors import APIError
    from app.core.media_tools import FASTER_WHISPER_MODEL, faster_whisper_installed
    from app.modules.library import tasks as library_tasks
    from app.modules.voice.stt import FasterWhisperSTT

    async with SessionLocal() as db:
        item: LibraryItem = await library_tasks._load_item(db, item_id)
        direct_file = subs.is_direct_file_external(item)
        if (
            item.kind not in VIDEO_KINDS
            or subs.is_youtube_external(item)
            or (not direct_file and not item.media_key)
        ):
            # یوتیوب/غیرویدیویی/بدون فایل زیرنویس ندارد — trigger این را
            # ۴۲۲ می‌کند؛ این‌جا فقط صادقانه رد می‌شویم.
            return {"ok": False, "reason": "not_applicable"}

        langs = await subs.target_langs(db)
        await subs.reset_rows(db, item.id, langs)
        await db.commit()

        if not faster_whisper_installed():
            reason = (
                "stt_unavailable: پکیج faster-whisper نصب نیست؛ "
                "زیرنویس ساخته نشد (متن جعلی ساخته نشد)"
            )
            await _fail_all(db, item.id, reason)
            return {"ok": False, "reason": reason}

        try:
            if direct_file:
                data = await _download_external_media(item.external_url)
            else:
                data = await library_tasks._read_media_bytes(item)
        except Exception as exc:  # noqa: BLE001
            if direct_file:
                reason = (
                    f"download_failed: دانلود فایل لینک مستقیم "
                    f"ناموفق بود: {exc}"
                )
            else:
                reason = f"read_failed: خواندن فایل از storage ناموفق بود: {exc}"
            await _fail_all(db, item.id, reason)
            return {"ok": False, "reason": reason}

        for row in await _all_rows(db, item.id):
            row.status = "processing"
            row.updated_at = _utcnow()
        await db.commit()

        engine = FasterWhisperSTT(model_size=FASTER_WHISPER_MODEL)
        try:
            src = await engine.transcribe_segments(
                data, lang=None, task="transcribe", timeout_s=_SOURCE_TIMEOUT_S
            )
        except APIError as exc:
            reason = (
                f"{exc.code}: موتور رونویسی در دسترس نیست یا مدل "
                f"{FASTER_WHISPER_MODEL} بارگذاری نشد ({exc.message})"
            )
            await _fail_all(db, item.id, reason)
            return {"ok": False, "reason": reason}

        segments = [
            s for s in (src.get("segments") or []) if (s.get("text") or "").strip()
        ]
        source_lang = str(src.get("language") or "").strip().lower()
        if not segments:
            reason = "stt_empty: خروجی رونویسی خالی بود"
            await _fail_all(db, item.id, reason)
            return {"ok": False, "reason": reason}
        if not source_lang:
            reason = "stt_no_language: زبان منبع تشخیص داده نشد"
            await _fail_all(db, item.id, reason)
            return {"ok": False, "reason": reason}

        ready: list[str] = []
        failed: dict[str, str] = {}

        # --- ترک زبان منبع ---
        await _set_row(
            db, item.id, source_lang,
            status="ready", vtt=subs.build_vtt(segments),
        )
        await db.commit()
        ready.append(source_lang)

        # --- انگلیسی: ترجمهٔ داخلی whisper (اگر هدف است و منبع نیست) ---
        if "en" in langs and source_lang != "en":
            try:
                en_out = await engine.transcribe_segments(
                    data,
                    lang=None,
                    task="translate",
                    timeout_s=_TRANSLATE_TIMEOUT_S,
                )
                en_segments = [
                    s
                    for s in (en_out.get("segments") or [])
                    if (s.get("text") or "").strip()
                ]
                if not en_segments:
                    raise APIError(503, "stt_empty", "خروجی ترجمهٔ whisper خالی بود")
                await _set_row(
                    db, item.id, "en",
                    status="ready", vtt=subs.build_vtt(en_segments),
                )
                ready.append("en")
            except APIError as exc:
                reason = f"{exc.code}: ترجمهٔ انگلیسی whisper ناموفق بود ({exc.message})"
                await _set_row(
                    db, item.id, "en", status="failed", error=reason[:500]
                )
                failed["en"] = reason
            await db.commit()

        # --- بقیهٔ زبان‌های هدف: ترجمهٔ متنی با provider سامانه ---
        remaining = [
            lang for lang in langs if lang not in (source_lang, "en")
        ]
        if remaining:
            provider = await subs.resolve_translation_provider(db)
            for lang in remaining:
                if provider is None:
                    reason = "translation_provider_not_configured"
                    await _set_row(
                        db, item.id, lang, status="failed", error=reason
                    )
                    failed[lang] = reason
                    await db.commit()
                    continue
                try:
                    translated = await subs.translate_segments(
                        db, segments, lang, provider=provider
                    )
                    await _set_row(
                        db, item.id, lang,
                        status="ready", vtt=subs.build_vtt(translated),
                    )
                    ready.append(lang)
                except subs.TranslationFailed as exc:
                    reason = f"translation_failed: {exc}"[:500]
                    await _set_row(
                        db, item.id, lang, status="failed", error=reason
                    )
                    failed[lang] = reason
                await db.commit()

        return {
            "ok": True,
            "source_lang": source_lang,
            "ready": ready,
            "failed": failed,
        }
