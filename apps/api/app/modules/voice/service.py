"""منطق کسب‌وکار دستیار صوتی — فاز ۱۲.

قرارداد §۱۵.۶: روتر هرگز مستقیم به دیتابیس دسترسی ندارد — همه‌چیز اینجاست.
قاعدهٔ سخت: صوت آیهٔ قرآن هرگز سنتز (TTS) نمی‌شود — فقط URL تلاوت واقعی
از provider فاز ۵؛ اگر URL نبود، متنی با audio_kind="none".
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import (
    bump_settings_version,
    get_typed_setting,
    stage_setting,
)
from app.models.models import User, VoiceSession, VoiceUsageLog

from . import intents, stt, tts
from app.modules.fatwa import service as fatwa_service
from app.modules.quran import service as quran_service
from app.modules.quran.surahs import get_surah

# ---------------------------------------------------------------------------
# تنظیمات (platform_settings با پیش‌فرض — الگوی quran/service.py)
# ---------------------------------------------------------------------------

DEFAULTS: dict[str, object] = {
    "voice.stt_provider": "auto",  # auto | faster_whisper | none
    "voice.tts_provider": "none",  # none | coqui | cloud | auto
    "voice.max_audio_seconds": 120,
    "voice.max_audio_mb": 25,
    "voice.tts_voice_fa": "default",
    "voice.tts_voice_ar": "default",
    "voice.tts_cloud_endpoint": "",
}

SETTING_KEYS = tuple(DEFAULTS)


async def _voice_setting(db: AsyncSession, key: str):
    return await get_typed_setting(db, key, DEFAULTS[key])


async def _int_setting(db: AsyncSession, key: str) -> int:
    try:
        return int(await _voice_setting(db, key))
    except (TypeError, ValueError):
        return int(DEFAULTS[key])


# ---------------------------------------------------------------------------
# کدهای پیام (i18n — قرارداد §۱۵.۴: بدون هاردکد تک‌زبانهٔ پراکنده)
# ---------------------------------------------------------------------------

MESSAGES: dict[str, dict[str, str]] = {
    "voice.general_ack": {
        "fa": "درخواست شما دریافت شد. می‌توانید سوال فقهی بپرسید یا بخواهید آیه‌ای برایتان بخوانم.",
        "ar": "تم استلام طلبك. يمكنك طرح سؤال فقهي أو طلب تلاوة آية.",
    },
    "voice.quran_unresolved": {
        "fa": "نتوانستم آیهٔ موردنظر را پیدا کنم؛ لطفاً شمارهٔ سوره و آیه را بگویید (مثلاً: بقره ۱۵۳).",
        "ar": "لم أتمكن من تحديد الآية المطلوبة؛ يرجى ذكر رقم السورة والآية (مثلاً: البقرة 153).",
    },
    "voice.quran_no_audio": {
        "fa": "صوت تلاوت این آیه در دسترس نیست؛ متن و ترجمهٔ آن را می‌خوانید.",
        "ar": "تلاوة هذه الآية غير متاحة حالياً؛ يمكنك قراءة النص والترجمة.",
    },
    "voice.tts_unavailable": {
        "fa": "پاسخ صوتی در دسترس نیست؛ متن پاسخ:",
        "ar": "الرد الصوتي غير متاح؛ نص الرد:",
    },
}


def _msg(code: str, lang: str) -> str:
    return MESSAGES[code].get(lang, MESSAGES[code]["fa"])


# ---------------------------------------------------------------------------
# اعتبارسنجی آپلود صوتی — قرارداد §۷ (پسوند + magic-byte + سقف حجم)
# ---------------------------------------------------------------------------

_AUDIO_MAGIC: dict[str, tuple[bytes, ...]] = {
    # webm/opus
    "webm": (b"\x1a\x45\xdf\xa3",),
    # mp4/m4a: ....ftyp
    "mp4": (b"ftyp",),
    "m4a": (b"ftyp",),
    # wav: RIFF....WAVE
    "wav": (b"RIFF",),
    # ogg/opus
    "ogg": (b"OggS",),
    "opus": (b"OggS",),
}
_ALLOWED_EXTS = tuple(_AUDIO_MAGIC)


def _ext_of(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def validate_audio_upload(content: bytes, filename: str | None, max_mb: int) -> str:
    """پسوند مجاز + magic-byte + سقف حجم؛ خروجی: ext. خطا → ۴۲۲ پاکت یکدست."""
    ext = _ext_of(filename)
    if ext not in _ALLOWED_EXTS:
        raise APIError(
            422, "invalid_audio",
            "فرمت صوتی پشتیبانی نمی‌شود",
            {"allowed": sorted(_ALLOWED_EXTS), "filename": filename},
        )
    if len(content) > max_mb * 1024 * 1024:
        raise APIError(
            422, "audio_too_large",
            "حجم فایل صوتی بیش از حد مجاز است",
            {"max_mb": max_mb},
        )
    if ext in ("mp4", "m4a"):
        ok = len(content) >= 12 and content[4:8] == b"ftyp"
    elif ext == "wav":
        ok = (
            len(content) >= 12
            and content[:4] == b"RIFF"
            and content[8:12] == b"WAVE"
        )
    else:
        magic = _AUDIO_MAGIC[ext]
        ok = len(content) >= 4 and any(content.startswith(m) for m in magic)
    if not ok:
        raise APIError(
            422, "invalid_audio",
            "محتوای فایل با فرمت صوتی اعلام‌شده سازگار نیست",
            {"ext": ext},
        )
    return ext


# ---------------------------------------------------------------------------
# رونویسی
# ---------------------------------------------------------------------------


async def transcribe(
    db: AsyncSession, *, content: bytes, filename: str | None, lang: str | None
) -> dict:
    max_mb = await _int_setting(db, "voice.max_audio_mb")
    validate_audio_upload(content, filename, max_mb)
    configured = str(await _voice_setting(db, "voice.stt_provider"))
    max_seconds = await _int_setting(db, "voice.max_audio_seconds")
    return await stt.transcribe_bytes(
        content,
        lang=lang,
        configured_provider=configured,
        max_audio_seconds=max_seconds,
    )


# ---------------------------------------------------------------------------
# پاسخ متنی (هستهٔ pipeline — بدون نیاز به STT، قابل تست مستقیم)
# ---------------------------------------------------------------------------


_SURAH_NUM_TO_FA: dict[int, str] = {
    num: name for name, num in intents.SURAH_FA_NAMES.items()
}


def _surah_label(number: int, lang: str) -> str:
    if lang == "fa":
        return _SURAH_NUM_TO_FA.get(number) or get_surah(number).name_ar
    return get_surah(number).name_ar


async def _resolve_quran_ayah(db: AsyncSession, text: str, lang: str) -> dict | None:
    """حل ارجاع آیه و گرفتن بستهٔ واقعی از سرویس فاز ۵. None = قابل‌حل نیست."""
    ref = intents.extract_ayah_reference(text)
    if ref is None:
        return None
    surah_num, ayah_num = ref
    try:
        bundle = await quran_service.get_ayah_bundle(db, surah_num, ayah_num)
    except APIError:
        return None
    editions: dict[str, dict] = {e["edition"]: e for e in bundle["editions"]}
    text_ar = (editions.get("quran-uthmani") or {}).get("text")
    translation = None
    translation_edition = None
    for eid, e in editions.items():
        if eid == "quran-uthmani":
            continue
        if eid.startswith(f"{lang}."):
            translation, translation_edition = e.get("text"), eid
            break
    if translation is None:
        for eid, e in editions.items():
            if eid == "quran-uthmani" or e.get("audio_url"):
                continue
            translation, translation_edition = e.get("text"), eid
            break
    # ⛔ قاعدهٔ سخت: فقط URL تلاوت واقعی؛ هرگز سنتز.
    audio_url = next(
        (e.get("audio_url") for e in editions.values() if e.get("audio_url")),
        None,
    )
    return {
        "surah": surah_num,
        "ayah": ayah_num,
        "surah_label": _surah_label(surah_num, lang),
        "text_ar": text_ar,
        "translation": translation,
        "translation_edition": translation_edition,
        "audio_url": audio_url,  # None → متنی (هرگز TTS)
    }


async def answer_text(
    db: AsyncSession,
    *,
    text: str,
    lang: str | None,
    user: User | None,
    client_ip: str | None,
    stt_ms: int | None = None,
) -> dict:
    """متن → قصد → پاسخ (متن + صوت).

    خروجی dict با کلیدهای: intent, lang, text, audio_kind
    ("recitation" | "tts" | "none"), audio_url?, audio_base64?, audio_mime?,
    notice?, ayah?, citations?, session_id.
    """
    text = (text or "").strip()
    if not text:
        raise APIError(400, "empty_text", "متن ورودی خالی است")
    resolved_lang = lang or intents.detect_language(text)
    if resolved_lang not in intents.SUPPORTED_LANGS:
        raise APIError(
            400, "unsupported_language",
            "فقط فارسی و عربی پشتیبانی می‌شوند",
            {"detected": resolved_lang},
        )
    lang = resolved_lang
    intent = intents.classify_intent(text)

    session = VoiceSession(user_id=user.id if user else None, lang=lang)
    db.add(session)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="voice_session",
        aggregate_id=str(session.id),
        event_type="voice.asked",
        payload={"lang": lang, "intent": intent, "text_chars": len(text)},
        source_client="api",
    )

    audio_kind = "none"
    audio_url: str | None = None
    audio_base64: str | None = None
    audio_mime: str | None = None
    notice: str | None = None
    tts_provider_name: str | None = None
    ayah: dict | None = None
    citations: list[dict] = []
    answer_status: str | None = None

    if intent == intents.QURAN:
        ayah = await _resolve_quran_ayah(db, text, lang)
        if ayah is None:
            answer = _msg("voice.quran_unresolved", lang)
        else:
            # ⛔ قاعدهٔ سخت فاز ۱۲: صوت آیه هرگز سنتز نمی‌شود — فقط URL
            # تلاوت واقعی؛ هیچ مسیری در این شاخه به tts.py نمی‌رسد.
            audio_url = ayah["audio_url"]
            if audio_url:
                audio_kind = "recitation"
            else:
                notice = "voice.quran_no_audio"
            parts = [f"{ayah['surah_label']}، آیهٔ {ayah['ayah']}"]
            if ayah["translation"]:
                parts.append(ayah["translation"])
            answer = "\n".join(parts)
        # assert ساختاری نامتغیر NEVER-TTS-Quran
        assert audio_base64 is None and tts_provider_name is None, (
            "quran intent must never synthesize audio"
        )
    elif intent == intents.FATWA:
        result = await fatwa_service.ask(
            db,
            question=text,
            session_id=None,
            locale=lang,
            top_k=3,
            user=user,
            client_ip=client_ip,
        )
        answer = result["answer"]
        citations = result.get("citations") or []
        answer_status = result.get("status")
        voice_name = str(await _voice_setting(db, f"voice.tts_voice_{lang}"))
        configured_tts = str(await _voice_setting(db, "voice.tts_provider"))
        cloud_endpoint = str(await _voice_setting(db, "voice.tts_cloud_endpoint"))
        raw, mime, tts_notice = await tts.synthesize_or_degrade(
            answer,
            lang=lang,
            voice=voice_name,
            configured_provider=configured_tts,
            cloud_endpoint=cloud_endpoint,
        )
        if raw is not None:
            audio_kind = "tts"
            audio_base64 = base64.b64encode(raw).decode()
            audio_mime = mime
            tts_provider_name = configured_tts
        else:
            notice = tts_notice  # "tts_unavailable" — صادقانه، با متن کامل
            answer = f"{_msg('voice.tts_unavailable', lang)}\n{answer}"
    else:
        answer = _msg("voice.general_ack", lang)
        voice_name = str(await _voice_setting(db, f"voice.tts_voice_{lang}"))
        configured_tts = str(await _voice_setting(db, "voice.tts_provider"))
        cloud_endpoint = str(await _voice_setting(db, "voice.tts_cloud_endpoint"))
        raw, mime, tts_notice = await tts.synthesize_or_degrade(
            answer,
            lang=lang,
            voice=voice_name,
            configured_provider=configured_tts,
            cloud_endpoint=cloud_endpoint,
        )
        if raw is not None:
            audio_kind = "tts"
            audio_base64 = base64.b64encode(raw).decode()
            audio_mime = mime
            tts_provider_name = configured_tts
        else:
            notice = tts_notice

    db.add(
        VoiceUsageLog(
            session_id=session.id,
            intent=intent,
            lang=lang,
            stt_ms=stt_ms,
            tts_provider=tts_provider_name,
        )
    )
    await emit_event(
        db,
        aggregate_type="voice_session",
        aggregate_id=str(session.id),
        event_type="voice.answered",
        payload={
            "lang": lang,
            "intent": intent,
            "audio_kind": audio_kind,
            "tts_provider": tts_provider_name,
            "stt_ms": stt_ms,
        },
        source_client="api",
    )
    await db.commit()

    out: dict = {
        "intent": intent,
        "lang": lang,
        "text": answer,
        "audio_kind": audio_kind,
        "notice": notice,
        "session_id": str(session.id),
    }
    if audio_url:
        out["audio_url"] = audio_url
    if audio_base64:
        out["audio_base64"] = audio_base64
        out["audio_mime"] = audio_mime
    if ayah:
        out["ayah"] = {
            "surah": ayah["surah"],
            "ayah": ayah["ayah"],
            "surah_label": ayah["surah_label"],
            "text_ar": ayah["text_ar"],
            "translation": ayah["translation"],
            "translation_edition": ayah["translation_edition"],
        }
    if citations:
        out["citations"] = citations
    if answer_status:
        out["fatwa_status"] = answer_status
    return out


async def ask_audio(
    db: AsyncSession,
    *,
    content: bytes,
    filename: str | None,
    lang: str | None,
    user: User | None,
    client_ip: str | None,
) -> dict:
    """صوت → رونویسی → pipeline متنی."""
    tr = await transcribe(db, content=content, filename=filename, lang=lang)
    detected = tr.get("language") or None
    if lang is None and detected:
        # هیوریستیک اسکریپت روی متن، مکمل تشخیص whisper
        heuristic = intents.detect_language(tr["text"])
        lang = detected if detected in intents.SUPPORTED_LANGS else None
        if lang is None:
            lang = heuristic if heuristic in intents.SUPPORTED_LANGS else None
    result = await answer_text(
        db,
        text=tr["text"],
        lang=lang,
        user=user,
        client_ip=client_ip,
        stt_ms=tr.get("stt_ms"),
    )
    result["transcript"] = tr["text"]
    result["stt_provider"] = tr.get("provider")
    return result


# ---------------------------------------------------------------------------
# ادمین — تنظیمات
# ---------------------------------------------------------------------------


async def get_voice_settings(db: AsyncSession) -> dict:
    values = {}
    for key in SETTING_KEYS:
        values[key] = await _voice_setting(db, key)
    return {"settings": values}


_VALID_PROVIDERS = {
    "voice.stt_provider": {"auto", "faster_whisper", "none"},
    "voice.tts_provider": {"none", "coqui", "cloud", "auto"},
}
_INT_KEYS = {"voice.max_audio_seconds", "voice.max_audio_mb"}


async def update_voice_settings(
    db: AsyncSession, user: User, patch: dict, ip: str | None, user_agent: str | None
) -> dict:
    changed: list[str] = []
    for key, value in patch.items():
        if key not in SETTING_KEYS:
            raise APIError(400, "unknown_setting", f"کلید ناشناخته: {key}")
        if key in _VALID_PROVIDERS:
            if str(value) not in _VALID_PROVIDERS[key]:
                raise APIError(
                    400, "invalid_setting_value",
                    f"مقدار نامعتبر برای {key}",
                    {"allowed": sorted(_VALID_PROVIDERS[key])},
                )
            plaintext = str(value)
        elif key in _INT_KEYS:
            try:
                iv = int(value)
            except (TypeError, ValueError):
                raise APIError(400, "invalid_setting_value", f"{key} باید عدد باشد")
            if not 1 <= iv <= 3600:
                raise APIError(400, "invalid_setting_value", f"{key} خارج از بازه است")
            plaintext = str(iv)
        else:
            plaintext = str(value)
        await stage_setting(db, key, plaintext)
        changed.append(key)
    if changed:
        bump_settings_version(changed)  # ابطال کش hot-reload
        await emit_event(
            db,
            aggregate_type="voice_settings",
            aggregate_id="voice",
            event_type="voice.settings_updated",
            payload={"keys": changed, "updated_by": str(user.id)},
            source_client="crm",
        )
        await log_audit(
            db,
            actor_id=user.id,
            actor_type="admin",
            action="voice.settings_update",
            entity_type="voice_settings",
            entity_id="voice",
            new_values={"keys": changed},
            ip=ip,
            user_agent=user_agent,
        )
    await db.commit()
    return {"updated": changed}


# ---------------------------------------------------------------------------
# ادمین — لاگ مصرف (صفحه‌بندی cursor)
# ---------------------------------------------------------------------------

_USAGE_LIMIT = 50


def _encode_cursor(created_at: datetime, lid: uuid.UUID) -> str:
    raw = json.dumps({"t": created_at.astimezone(timezone.utc).isoformat(), "id": str(lid)})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(raw["t"]), uuid.UUID(raw["id"])
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


async def list_usage(
    db: AsyncSession, *, cursor: str | None, limit: int, intent: str | None
) -> tuple[list[dict], str | None]:
    limit = min(max(limit, 1), _USAGE_LIMIT)
    stmt = (
        select(VoiceUsageLog)
        .order_by(VoiceUsageLog.created_at.desc(), VoiceUsageLog.id.desc())
    )
    if intent:
        if intent not in intents.INTENTS:
            raise APIError(400, "invalid_intent", "قصد نامعتبر است")
        stmt = stmt.where(VoiceUsageLog.intent == intent)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            (VoiceUsageLog.created_at < ts)
            | ((VoiceUsageLog.created_at == ts) & (VoiceUsageLog.id < lid))
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    items = [
        {
            "id": str(r.id),
            "session_id": str(r.session_id),
            "intent": r.intent,
            "lang": r.lang,
            "stt_ms": r.stt_ms,
            "tts_provider": r.tts_provider,
            "created_at": r.created_at.astimezone(timezone.utc).isoformat(),
        }
        for r in rows
    ]
    return items, next_cursor
