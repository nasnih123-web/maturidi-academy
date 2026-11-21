"""روتر «ذخیرهٔ فتوا» روی /api/v1/fatwas — فقط سیم‌کشی؛ منطق در
saved_service.py. هم‌الگوی روتر ذخیرهٔ ویدیوها (modules/videos)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import get_current_user

from . import saved_service as service
from .schemas import FatwaSavedListOut, FatwaSavedOut, PublicTopicOut

fatwas_router = APIRouter(prefix="/api/v1/fatwas", tags=["fatwas"])

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


@fatwas_router.get("/saved", response_model=FatwaSavedListOut)
async def list_saved_fatwas(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """فتواهای ذخیره‌شدهٔ کاربر جاری (تازه‌ترین ذخیره اول)."""
    items = await service.list_saved_fatwas(db, user)
    return FatwaSavedListOut(
        items=[PublicTopicOut(**d) for d in items]
    )


@fatwas_router.get("/{fatwa_id}/saved", response_model=FatwaSavedOut)
async def get_saved_state(
    fatwa_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """وضعیت نشانک «ذخیره» کاربر جاری روی این فتوا (مهمان: False)."""
    return await service.get_saved_state(db, user, fatwa_id)


@fatwas_router.post("/{fatwa_id}/saved", response_model=FatwaSavedOut)
async def save_fatwa(
    fatwa_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ذخیرهٔ فتوا برای کاربر جاری (idempotent)."""
    return await service.save_fatwa(db, user, fatwa_id)


@fatwas_router.delete("/{fatwa_id}/saved", response_model=FatwaSavedOut)
async def unsave_fatwa(
    fatwa_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """حذف فتوا از ذخیره‌های کاربر جاری (idempotent)."""
    return await service.unsave_fatwa(db, user, fatwa_id)
