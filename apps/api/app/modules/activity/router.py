"""رهگیری فعالیت رفتاری کاربر — رویدادهایی که جدول اختصاصی ندارند.

کلاینت وب هنگام پخش صوت/ویدیو و دانلود/بازکردن آیتم کتابخانه یک
رویداد سبک می‌فرستد تا در خط زمانی نمای ۳۶۰° (CRM) دیده شود.
قرارداد صداقت: kind فهرست بسته است، meta فقط اسکالرهای کوتاه نگه
داشته می‌شود و هیچ دادهٔ حساسی (متن کامل، توکن و…) پذیرفته نیست.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.core.rate_limit import get_client_ip, rate_limit, trusted_proxy_set
from app.models.models import User, UserActivityEvent
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/v1/activity", tags=["activity"])

EVENT_KINDS = frozenset(
    {
        "media_play",  # شروع پخش صوت/ویدیو (کتابخانه/LMS)
        "media_progress",  # گزارش پیشرفت پخش (با seconds در meta)
        "library_download",  # دانلود فایل کتابخانه
        "library_open",  # بازکردن آیتم کتابخانه
    }
)

_MAX_META_KEYS = 12
_MAX_META_STR = 120


class ActivityEventIn(BaseModel):
    kind: str = Field(max_length=48)
    title: str | None = Field(default=None, max_length=300)
    ref_type: str | None = Field(default=None, max_length=48)
    ref_id: str | None = Field(default=None, max_length=64)
    meta: dict | None = None


def _clean_meta(meta: dict | None) -> dict | None:
    """فقط اسکالرهای کوتاه — نه آبجکت تو در تو، نه رشتهٔ بلند."""
    if not meta:
        return None
    out: dict = {}
    for key, value in list(meta.items())[:_MAX_META_KEYS]:
        if isinstance(value, (bool, int, float)):
            out[str(key)[:48]] = value
        elif isinstance(value, str):
            out[str(key)[:48]] = value[:_MAX_META_STR]
    return out or None


def _rl_key(request: Request) -> str:
    from app.core.config import get_settings

    proxies = trusted_proxy_set(get_settings().trusted_proxies)
    return f"activity:{get_client_ip(request, proxies) or 'unknown'}"


@router.post("/events", response_model=dict, status_code=201)
@rate_limit(_rl_key, limit=240, window_s=60)
async def post_activity_event(
    body: ActivityEventIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ثبت یک رویداد رفتاری برای کاربر واردشده (مالک رویداد = توکن)."""
    if body.kind not in EVENT_KINDS:
        raise APIError(422, "bad_event_kind", "نوع رویداد ناشناخته است")
    row = UserActivityEvent(
        user_id=user.id,
        kind=body.kind,
        title=body.title,
        ref_type=body.ref_type,
        ref_id=body.ref_id,
        meta=_clean_meta(body.meta),
    )
    db.add(row)
    await db.commit()
    return {"id": str(row.id), "kind": row.kind}
