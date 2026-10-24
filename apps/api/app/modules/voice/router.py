"""روتر دستیار صوتی — فاز ۱۲.

- عمومی `/api/v1/voice`: transcribe و ask (ناشناس هم مجاز، مثل fatwa.ask).
- ادمین `/api/v1/admin/voice`: تنظیمات STT/TTS + لاگ مصرف (مجوز voice.manage).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.storage import get_storage, read_capped_upload
from app.models.models import AIUsageLog, User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.fatwa.service import check_quota

from . import schemas, service

voice_router = APIRouter(prefix="/api/v1/voice", tags=["voice"])
admin_voice_router = APIRouter(prefix="/api/v1/admin/voice", tags=["admin-voice"])

_voice_admin = require_permission("voice.manage")

_optional_bearer = HTTPBearer(auto_error=False)


async def _optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if not credentials:
        return None
    try:
        return await get_current_user(credentials, db)
    except APIError:
        return None


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ---------------------------------------------------------------------------
# عمومی
# ---------------------------------------------------------------------------


@voice_router.post("/transcribe", response_model=schemas.TranscribeOut)
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    lang: str | None = Form(default=None),
    user: User | None = Depends(_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """رونویسی فایل صوتی (webm/mp4/m4a/wav/ogg). بدون STT → ۵۰۳ صادقانه.

    سهمیهٔ AI (دقیقه‌ای + روزانه) پیش از هر پردازش هزینه‌بر اعمال می‌شود —
    یافتهٔ امنیتی فاز ۱۷ (SEC-17-03): این مسیر عمومی بود و بدون هیچ سقفی
    STT مصرف می‌کرد.
    """
    await check_quota(db, user, _client_ip(request), "voice.transcribe")
    content = await read_capped_upload(
        file,
        await service.max_audio_bytes(db),
        too_large_code="audio_too_large",
        too_large_status=422,
        too_large_message="حجم فایل صوتی بیش از حد مجاز است",
    )
    out = await service.transcribe(
        db, content=content, filename=file.filename, lang=lang
    )
    db.add(
        AIUsageLog(
            user_id=user.id if user else None,
            endpoint="voice.transcribe",
            model="stt",
        )
    )
    await db.commit()
    return out


@voice_router.post("/ask", response_model=schemas.AskOut)
async def ask_voice(
    request: Request,
    file: UploadFile = File(...),
    lang: str | None = Form(default=None),
    user: User | None = Depends(_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """صوت در → متن+صوت بیرون: رونویسی → تشخیص زبان/قصد → قرآن/فتوا/عمومی.

    قصد قرآن → فقط URL تلاوت واقعی (`audio_kind="recitation"`)؛ آیه هرگز TTS
    نمی‌شود. بدون TTS پیکربندی‌شده → متن با `audio_kind="none"` و اعلان صادقانه.

    سهمیهٔ AI پیش از پردازش اعمال می‌شود (یافتهٔ امنیتی فاز ۱۷ SEC-17-03).
    """
    await check_quota(db, user, _client_ip(request), "voice.ask")
    content = await read_capped_upload(
        file,
        await service.max_audio_bytes(db),
        too_large_code="audio_too_large",
        too_large_status=422,
        too_large_message="حجم فایل صوتی بیش از حد مجاز است",
    )
    out = await service.ask_audio(
        db,
        content=content,
        filename=file.filename,
        lang=lang,
        user=user,
        client_ip=_client_ip(request),
    )
    db.add(
        AIUsageLog(
            user_id=user.id if user else None,
            endpoint="voice.ask",
            model="voice",
        )
    )
    await db.commit()
    return out


@voice_router.get("/tts-audio-by-ref")
async def tts_audio_by_ref(
    key: str,
    exp: int,
    sig: str,
    purpose: str = "",
    db: AsyncSession = Depends(get_db),
):
    """دانلود صوت TTS با URL امضاشدهٔ کوتاه‌مدت (Pass 4 / A3).

    مدل احراز هویت همان مدل library/cert است: امضای کوتاه‌عمرِ
    هم‌منظور (voice-tts) جای احراز هویت را می‌گیرد — رکورد مالکیت
    جداگانه‌ای برای صوت TTS در DB وجود ندارد، پس URL خودش bearer
    است (۳۰۰ ثانیه). در عوض، کلید به‌شدت محدود است: فقط
    `voice/tts/<uuid>.<mp3|bin>`؛ کلید گواهی یا کتابخانه این‌جا
    ۴۰۳/۴۰۴ می‌گیرد و گواهی این‌جا هرگز سرو نمی‌شود.
    """
    import re

    from app.core.storage import SIGNED_PURPOSE_VOICE_TTS

    storage = get_storage()
    verify = getattr(storage, "verify_download_sig", None)
    read_bytes = getattr(storage, "read_bytes", None)
    if (
        verify is None
        or read_bytes is None
        or purpose != SIGNED_PURPOSE_VOICE_TTS
        or not verify(key, exp, sig, purpose)
        or not re.fullmatch(
            r"voice/tts/[0-9a-fA-F-]{36}\.(mp3|bin)", key or ""
        )
    ):
        raise APIError(403, "invalid_signature", "امضای دانلود نامعتبر یا منقضی است")
    data = await read_bytes(key)
    mime = "audio/mpeg" if key.endswith(".mp3") else "application/octet-stream"
    return Response(content=data, media_type=mime)


# ---------------------------------------------------------------------------
# ادمین
# ---------------------------------------------------------------------------


@admin_voice_router.get("/settings", response_model=schemas.VoiceSettingsOut)
async def get_voice_settings(
    user: User = Depends(_voice_admin),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_voice_settings(db)


@admin_voice_router.put("/settings", response_model=schemas.VoiceSettingsUpdateOut)
async def update_voice_settings(
    request: Request,
    body: schemas.VoiceSettingsUpdate,
    user: User = Depends(_voice_admin),
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return await service.update_voice_settings(db, user, body.settings, ip, ua)


@admin_voice_router.get("/usage", response_model=schemas.UsageLogPage)
async def list_voice_usage(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    intent: str | None = Query(default=None),
    user: User = Depends(_voice_admin),
    db: AsyncSession = Depends(get_db),
):
    items, next_cursor = await service.list_usage(
        db, cursor=cursor, limit=limit, intent=intent
    )
    return {"items": items, "next_cursor": next_cursor}
