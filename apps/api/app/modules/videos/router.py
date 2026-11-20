"""روتر بخش ویدیوها — فقط سیم‌کشی؛ منطق در service.py.

مسیرهای عمومی روی /api/v1/videos و مسیرهای مدیریت (library.manage)
روی /api/v1/admin/videos.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

from . import service
from .schemas import (
    AdminPlaylistOut,
    AdminSubtitleItemOut,
    CandidateOut,
    PlaylistCreateIn,
    PlaylistItemAddIn,
    PlaylistOrderIn,
    PlaylistOut,
    PlaylistUpdateIn,
    SubtitleGenerateOut,
    VideoItemOut,
    VideoListOut,
    VideoProgressIn,
    VideoProgressOut,
    WatchOut,
)

videos_router = APIRouter(prefix="/api/v1/videos", tags=["videos"])
admin_videos_router = APIRouter(
    prefix="/api/v1/admin/videos", tags=["admin-videos"]
)

_can_library = require_permission("library.manage")

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


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


# ---------------------------------------------------------------------------
# عمومی
# ---------------------------------------------------------------------------


@videos_router.get("", response_model=VideoListOut)
async def list_videos(
    after: str | None = Query(default=None, description="کرسر صفحه‌بندی"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """فهرست عمومی ویدیوها — همان قواعد انتشار/visibility کتابخانه."""
    items, next_cursor = await service.list_videos(
        db, user=user, cursor=after, limit=limit
    )
    return VideoListOut(
        items=[VideoItemOut(**d) for d in items], next_cursor=next_cursor
    )


@videos_router.get("/playlists", response_model=list[PlaylistOut])
async def list_playlists(
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """لیست‌های پخش منتشرشده به‌ترتیب sort_order + حداکثر ۴ آیتم اول هرکدام."""
    return await service.list_playlists(db, user=user)


@videos_router.get("/playlists/{playlist_id}", response_model=PlaylistOut)
async def get_playlist(
    playlist_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """جزئیات لیست پخش منتشرشده با همهٔ آیتم‌های قابل‌مشاهده به‌ترتیب."""
    return await service.get_playlist(db, playlist_id, user=user)


@videos_router.get("/{item_id}", response_model=WatchOut)
async def get_watch(
    item_id: uuid.UUID,
    playlist: uuid.UUID | None = Query(
        default=None, description="زمینهٔ لیست پخش (اختیاری)"
    ),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """جزئیات تماشا: آیتم + stream امضاشده + زمینهٔ لیست پخش + مشابه‌ها."""
    return await service.get_watch(db, item_id, user=user, playlist_id=playlist)


@videos_router.get("/{item_id}/subtitles/{lang}.vtt")
async def get_subtitle_file(
    item_id: uuid.UUID,
    lang: str,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """فایل WebVTT یک ترک ready — فقط برای آیتم عمومیِ قابل‌مشاهده."""
    vtt = await service.get_subtitle_vtt(db, item_id, lang, user=user)
    return Response(content=vtt, media_type="text/vtt")


@videos_router.get("/{item_id}/progress", response_model=VideoProgressOut)
async def get_video_progress(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """موقعیت پخش ذخیره‌شدهٔ کاربر جاری روی این ویدیو (یا position null)."""
    return await service.get_video_progress(db, user, item_id)


@videos_router.put("/{item_id}/progress", response_model=VideoProgressOut)
async def save_video_progress(
    item_id: uuid.UUID,
    body: VideoProgressIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """آپسرت موقعیت پخش کاربر جاری — برای ادامهٔ تماشا در پلیر."""
    return await service.save_video_progress(
        db,
        user,
        item_id,
        position_seconds=body.position_seconds,
        duration_seconds=body.duration_seconds,
    )


# ---------------------------------------------------------------------------
# مدیریت (library.manage)
# ---------------------------------------------------------------------------


@admin_videos_router.get("/playlists", response_model=list[AdminPlaylistOut])
async def admin_list_playlists(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """همهٔ لیست‌ها (پیش‌نویس‌ها هم) با آیتم‌های مرتب‌شده — نمای CRM."""
    return await service.admin_list_playlists(db)


@admin_videos_router.post(
    "/playlists", response_model=AdminPlaylistOut, status_code=201
)
async def admin_create_playlist(
    body: PlaylistCreateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    ip, ua = _client(request)
    return await service.create_playlist(
        db, body.model_dump(), actor=user, ip=ip, user_agent=ua
    )


@admin_videos_router.patch(
    "/playlists/{playlist_id}", response_model=AdminPlaylistOut
)
async def admin_update_playlist(
    playlist_id: uuid.UUID,
    body: PlaylistUpdateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    ip, ua = _client(request)
    return await service.update_playlist(
        db,
        playlist_id,
        body.model_dump(exclude_unset=True),
        actor=user,
        ip=ip,
        user_agent=ua,
    )


@admin_videos_router.delete(
    "/playlists/{playlist_id}", response_model=AdminPlaylistOut
)
async def admin_delete_playlist(
    playlist_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """حذف سخت لیست (عضویت‌ها آبشاری پاک می‌شوند؛ خود ویدیوها می‌مانند)."""
    ip, ua = _client(request)
    return await service.delete_playlist(
        db, playlist_id, actor=user, ip=ip, user_agent=ua
    )


@admin_videos_router.post(
    "/playlists/{playlist_id}/items",
    response_model=AdminPlaylistOut,
    status_code=201,
)
async def admin_add_playlist_item(
    playlist_id: uuid.UUID,
    body: PlaylistItemAddIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """افزودن ویدیو به لیست — position خالی یعنی انتهای لیست."""
    ip, ua = _client(request)
    return await service.add_playlist_item(
        db,
        playlist_id,
        body.item_id,
        body.position,
        actor=user,
        ip=ip,
        user_agent=ua,
    )


@admin_videos_router.delete(
    "/playlists/{playlist_id}/items/{item_id}",
    response_model=AdminPlaylistOut,
)
async def admin_remove_playlist_item(
    playlist_id: uuid.UUID,
    item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    ip, ua = _client(request)
    return await service.remove_playlist_item(
        db, playlist_id, item_id, actor=user, ip=ip, user_agent=ua
    )


@admin_videos_router.put(
    "/playlists/{playlist_id}/items/order", response_model=AdminPlaylistOut
)
async def admin_reorder_playlist_items(
    playlist_id: uuid.UUID,
    body: PlaylistOrderIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """بازترتیب کامل — item_ids باید دقیقاً مجموعهٔ فعلی باشد (وگرنه ۴۲۲)."""
    ip, ua = _client(request)
    return await service.reorder_playlist_items(
        db, playlist_id, body.item_ids, actor=user, ip=ip, user_agent=ua
    )


@admin_videos_router.get(
    "/subtitles", response_model=list[AdminSubtitleItemOut]
)
async def admin_subtitle_statuses(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """وضعیت زیرنویس تازه‌ترین ویدیوهای آپلودی برای کارت CRM."""
    return await service.admin_subtitle_statuses(db)


@admin_videos_router.post(
    "/{item_id}/subtitles/generate",
    response_model=SubtitleGenerateOut,
    status_code=202,
)
async def admin_generate_subtitles(
    item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """تریگر تولید زیرنویس: ردیف‌ها pending و جاب روی صف media می‌رود."""
    ip, ua = _client(request)
    return await service.request_subtitle_generation(
        db, item_id, actor=user, ip=ip, user_agent=ua
    )


@admin_videos_router.get("/candidates", response_model=list[CandidateOut])
async def admin_list_candidates(
    q: str | None = Query(default=None, description="جست‌وجو در عنوان/توضیح"),
    limit: int = Query(default=50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """آیتم‌های ویدیویی کتابخانه برای انتخاب‌گر CRM (شامل پیش‌نویس‌ها)."""
    return await service.list_candidates(db, q=q, limit=limit)
