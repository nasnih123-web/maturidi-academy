"""روتر دستیار صوتی — فاز ۱۲.

- عمومی `/api/v1/voice`: transcribe و ask (ناشناس هم مجاز، مثل fatwa.ask).
- ادمین `/api/v1/admin/voice`: تنظیمات STT/TTS + لاگ مصرف (مجوز voice.manage).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

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
    db: AsyncSession = Depends(get_db),
):
    """رونویسی فایل صوتی (webm/mp4/m4a/wav/ogg). بدون STT → ۵۰۳ صادقانه."""
    content = await file.read()
    return await service.transcribe(
        db, content=content, filename=file.filename, lang=lang
    )


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
    """
    content = await file.read()
    return await service.ask_audio(
        db,
        content=content,
        filename=file.filename,
        lang=lang,
        user=user,
        client_ip=_client_ip(request),
    )


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
