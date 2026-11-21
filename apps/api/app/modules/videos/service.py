"""سرویس بخش ویدیوها.

قراردادها:
- ویدیوها آیتم‌های کتابخانه‌اند (kind=video|video_360)؛ فیلتر عمومی
  (workflow_status=published + visibility بر اساس فراخواننده) عیناً از
  سرویس کتابخانه گرفته می‌شود تا فهرست ویدیوها هرگز از کتابخانه واگرا
  نشود.
- URLها فقط signed کوتاه‌مدت از مسیر کتابخانه‌اند (§۶)؛ کلید خام storage
  هرگز در پاسخ‌ها برنمی‌گردد.
- لیست پخش منتشرنشده در سطح عمومی نامرئی است (۴۰۴، نه ۴۰۳ — عدم افشا).
- آیتم‌های داخل لیست هم در نمای عمومی با همان قواعد دسترسی فیلتر
  می‌شوند؛ شمارنده و مجموع مدت فقط روی آیتم‌های قابل‌مشاهده حساب می‌شود.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.models.models import (
    ItemSubtitle,
    LibraryItem,
    User,
    UserSavedVideo,
    UserVideoProgress,
    VideoPlaylist,
    VideoPlaylistItem,
)
from app.modules.library import service as library_service

from . import aparat, youtube
from . import subtitles as subs
from .schemas import SUBTITLE_LANGS, VIDEO_KINDS

_RELATED_SCAN_CAP = 300
_SUBTITLE_STATUS_SCAN_CAP = 300


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# ابزارهای مشترک خروجی
# ---------------------------------------------------------------------------


async def _scholar_names(
    db: AsyncSession, scholar_ids: list[uuid.UUID | None]
) -> dict[uuid.UUID, str]:
    ids = {s for s in scholar_ids if s is not None}
    if not ids:
        return {}
    rows = (
        await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    ).all()
    return {row[0]: row[1] for row in rows}


async def _published_memberships(
    db: AsyncSession, item_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[dict]]:
    """عضویت‌های منتشرشدهٔ هر آیتم — فقط لیست‌های is_published."""
    if not item_ids:
        return {}
    stmt = (
        select(VideoPlaylistItem.item_id, VideoPlaylist.id, VideoPlaylist.title)
        .join(VideoPlaylist, VideoPlaylist.id == VideoPlaylistItem.playlist_id)
        .where(
            VideoPlaylistItem.item_id.in_(item_ids),
            VideoPlaylist.is_published.is_(True),
        )
        .order_by(VideoPlaylist.sort_order.asc(), VideoPlaylist.created_at.asc())
    )
    out: dict[uuid.UUID, list[dict]] = {}
    for item_id, playlist_id, title in (await db.execute(stmt)).all():
        out.setdefault(item_id, []).append({"id": playlist_id, "title": title})
    return out


def _external_fields(item: LibraryItem) -> tuple[str | None, str | None]:
    """(external_url کانونیک، embed_url) — برای آیتم آپلودی هر دو None."""
    if not item.external_url:
        return None, None
    video_id = youtube.parse_youtube_video_id(item.external_url)
    if video_id is not None:
        return item.external_url, youtube.embed_url(video_id)
    aparat_hash = aparat.parse_aparat_video_hash(item.external_url)
    if aparat_hash is not None:
        return item.external_url, aparat.embed_url(aparat_hash)
    # دادهٔ قدیمی/دستی یا لینک مستقیم فایل — لینک هست ولی امبد ندارد
    return item.external_url, None


def _watch_stream_url(item: LibraryItem, detail: dict) -> str | None:
    """منبع پخش پلیر بومی در payload تماشا: آیتم آپلودی ← media_url
    امضاشده؛ یوتیوب/آپارات ← None (پخش فقط از embed_url است)؛ لینک
    مستقیم فایل ← خود URL فایل تا پلیر بومی سایت پخشش کند."""
    if not item.external_url:
        return detail["media_url"]
    if subs.is_embed_external(item):
        return None
    return item.external_url


async def _cover_url(item: LibraryItem) -> str | None:
    """کاور امضاشده؛ برای آیتم یوتیوبیِ بدون کاور، بندانگشتی یوتیوب.

    آپارات بندانگشتیِ قطعی (قابل‌حدس از روی هش) ندارد و fallback
    ساخته نمی‌شود — کاور آپاراتی همان است که هنگام ساخت از og:image
    ذخیره شده (یا کاور آپلودی مدیر).
    """
    url = await library_service._signed_url(item.cover_media_key)
    if url is None and item.external_url:
        video_id = youtube.parse_youtube_video_id(item.external_url)
        if video_id is not None:
            url = youtube.thumbnail_url(video_id)
    return url


async def _items_out(db: AsyncSession, items: list[LibraryItem]) -> list[dict]:
    names = await _scholar_names(db, [i.scholar_id for i in items])
    memberships = await _published_memberships(db, [i.id for i in items])
    out: list[dict] = []
    for item in items:
        external_url, embed_url = _external_fields(item)
        out.append(
            {
                "id": item.id,
                "kind": item.kind,
                "title": item.title,
                "description": item.description,
                "cover_url": await _cover_url(item),
                "external_url": external_url,
                "embed_url": embed_url,
                "duration_seconds": item.duration_seconds,
                "scholar_id": item.scholar_id,
                "scholar_name": names.get(item.scholar_id) if item.scholar_id else None,
                "topic_tags": item.topic_tags or [],
                "visibility": item.visibility,
                "created_at": item.created_at,
                "published_at": item.published_at,
                "playlists": memberships.get(item.id, []),
            }
        )
    return out


async def _visible_items_by_ids(
    db: AsyncSession, user: User | None, item_ids: list[uuid.UUID]
) -> dict[uuid.UUID, LibraryItem]:
    """آیتم‌هایی از فهرست داده‌شده که برای این فراخواننده عمومی‌اند."""
    if not item_ids:
        return {}
    privileged = await library_service.is_privileged(db, user)
    stmt = library_service._public_base_stmt(privileged, user).where(
        LibraryItem.id.in_(item_ids)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {r.id: r for r in rows}


async def _playlist_items_ordered(
    db: AsyncSession, playlist_id: uuid.UUID
) -> list[VideoPlaylistItem]:
    stmt = (
        select(VideoPlaylistItem)
        .where(VideoPlaylistItem.playlist_id == playlist_id)
        .order_by(VideoPlaylistItem.position.asc(), VideoPlaylistItem.created_at.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


# ---------------------------------------------------------------------------
# عمومی: فهرست ویدیوها
# ---------------------------------------------------------------------------


async def list_videos(
    db: AsyncSession,
    *,
    user: User | None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[dict], str | None]:
    privileged = await library_service.is_privileged(db, user)
    stmt = library_service._public_base_stmt(privileged, user).where(
        LibraryItem.kind.in_(VIDEO_KINDS)
    )
    stmt = stmt.order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
    if cursor:
        ts, lid = library_service._decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                LibraryItem.created_at < ts,
                (LibraryItem.created_at == ts) & (LibraryItem.id < lid),
            )
        )
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = library_service._encode_cursor(last.created_at, last.id)
        rows = rows[:limit]
    return await _items_out(db, list(rows)), next_cursor


# ---------------------------------------------------------------------------
# عمومی: لیست‌های پخش
# ---------------------------------------------------------------------------


async def _playlist_out(
    db: AsyncSession,
    playlist: VideoPlaylist,
    user: User | None,
    *,
    item_limit: int | None = None,
) -> dict:
    memberships = await _playlist_items_ordered(db, playlist.id)
    visible = await _visible_items_by_ids(db, user, [m.item_id for m in memberships])
    ordered = [visible[m.item_id] for m in memberships if m.item_id in visible]
    shown = ordered if item_limit is None else ordered[:item_limit]
    cover_url = await library_service._signed_url(playlist.cover_media_key)
    if cover_url is None and ordered:
        cover_url = await _cover_url(ordered[0])
    names = await _scholar_names(db, [playlist.scholar_id])
    return {
        "id": playlist.id,
        "title": playlist.title,
        "description": playlist.description,
        "cover_url": cover_url,
        "scholar_id": playlist.scholar_id,
        "scholar_name": names.get(playlist.scholar_id) if playlist.scholar_id else None,
        "is_published": playlist.is_published,
        "sort_order": playlist.sort_order,
        "item_count": len(ordered),
        "total_duration_seconds": sum(i.duration_seconds or 0 for i in ordered),
        "items": await _items_out(db, shown),
        "created_at": playlist.created_at,
        "updated_at": playlist.updated_at,
    }


async def list_playlists(db: AsyncSession, *, user: User | None) -> list[dict]:
    stmt = (
        select(VideoPlaylist)
        .where(VideoPlaylist.is_published.is_(True))
        .order_by(VideoPlaylist.sort_order.asc(), VideoPlaylist.created_at.asc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [await _playlist_out(db, p, user, item_limit=4) for p in rows]


async def get_playlist(
    db: AsyncSession, playlist_id: uuid.UUID, *, user: User | None
) -> dict:
    playlist = await db.get(VideoPlaylist, playlist_id)
    if playlist is None or not playlist.is_published:
        raise APIError(404, "playlist_not_found", "لیست پخش یافت نشد")
    return await _playlist_out(db, playlist, user)


# ---------------------------------------------------------------------------
# عمومی: صفحهٔ تماشا
# ---------------------------------------------------------------------------


async def _playlist_context(
    db: AsyncSession,
    item: LibraryItem,
    user: User | None,
    requested_id: uuid.UUID | None,
) -> dict | None:
    stmt = (
        select(VideoPlaylist)
        .join(VideoPlaylistItem, VideoPlaylistItem.playlist_id == VideoPlaylist.id)
        .where(
            VideoPlaylistItem.item_id == item.id,
            VideoPlaylist.is_published.is_(True),
        )
        .order_by(VideoPlaylist.sort_order.asc(), VideoPlaylist.created_at.asc())
    )
    playlists = (await db.execute(stmt)).scalars().all()
    if not playlists:
        return None
    chosen = next((p for p in playlists if p.id == requested_id), playlists[0])
    memberships = await _playlist_items_ordered(db, chosen.id)
    visible = await _visible_items_by_ids(db, user, [m.item_id for m in memberships])
    ordered = [visible[m.item_id] for m in memberships if m.item_id in visible]
    ids = [i.id for i in ordered]
    if item.id not in ids:
        return None
    idx = ids.index(item.id)
    return {
        "playlist": {"id": chosen.id, "title": chosen.title},
        "position": idx + 1,
        "total": len(ordered),
        "prev_item_id": ids[idx - 1] if idx > 0 else None,
        "next_item_id": ids[idx + 1] if idx + 1 < len(ids) else None,
        "items": await _items_out(db, ordered),
    }


async def _related(
    db: AsyncSession, item: LibraryItem, user: User | None, limit: int = 8
) -> list[dict]:
    """مشابه‌ها: اول بیشترین برچسب مشترک، بعد تازه‌ترین‌ها — بدون خود آیتم."""
    privileged = await library_service.is_privileged(db, user)
    stmt = (
        library_service._public_base_stmt(privileged, user)
        .where(LibraryItem.kind.in_(VIDEO_KINDS), LibraryItem.id != item.id)
        .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
        .limit(_RELATED_SCAN_CAP)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    tags = {t.lower() for t in (item.topic_tags or [])}

    def shared(r: LibraryItem) -> int:
        return len(tags & {t.lower() for t in (r.topic_tags or [])})

    # sort پایدار است: درون هر گروهِ هم‌امتیاز، ترتیب created_at desc می‌ماند
    rows.sort(key=lambda r: -shared(r))
    return await _items_out(db, rows[:limit])


async def _subtitle_tracks(
    db: AsyncSession, item: LibraryItem
) -> list[dict]:
    """ترک‌های زیرنویس ready برای payload تماشا — آیتم آپلودی و لینک
    مستقیم فایل (یوتیوب و آپارات کپشن خودشان را دارند) و فقط وقتی
    سوییچ CRM (videos.subtitles_enabled) روشن است."""
    if subs.is_embed_external(item):
        return []
    if not await subs.subtitles_enabled(db):
        return []
    stmt = select(ItemSubtitle).where(
        ItemSubtitle.item_id == item.id, ItemSubtitle.status == "ready"
    )
    rows = list((await db.execute(stmt)).scalars().all())
    order = {lang: i for i, lang in enumerate(SUBTITLE_LANGS)}
    rows.sort(key=lambda r: order.get(r.lang, len(order)))
    return [
        {
            "lang": r.lang,
            "url": f"/api/v1/videos/{item.id}/subtitles/{r.lang}.vtt",
        }
        for r in rows
    ]


async def get_watch(
    db: AsyncSession,
    item_id: uuid.UUID,
    *,
    user: User | None,
    playlist_id: uuid.UUID | None = None,
) -> dict:
    # قواعد ۴۰۴ کتابخانه (منتشرنشده/غیرقابل‌دسترسی) عیناً اعمال می‌شود
    detail = await library_service.get_item_detail(db, item_id, user)
    item = await db.get(LibraryItem, item_id)
    if item is None:  # pragma: no cover — get_item_detail همین را ۴۰۴ کرده
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    base = (await _items_out(db, [item]))[0]
    return {
        "item": base,
        # یوتیوب/آپارات فایل ندارند و از embed_url پخش می‌شوند؛ آپلودی
        # و لینک مستقیم فایل از stream_url با پلیر بومی پخش می‌شوند
        "stream_url": _watch_stream_url(item, detail),
        "playlist": await _playlist_context(db, item, user, playlist_id),
        "related": await _related(db, item, user),
        "subtitles": await _subtitle_tracks(db, item),
    }


async def get_subtitle_vtt(
    db: AsyncSession,
    item_id: uuid.UUID,
    lang: str,
    *,
    user: User | None,
) -> str:
    """متن VTT یک ترک ready — آیتم باید برای همین فراخواننده عمومی باشد
    (همان قواعد visibility کتابخانه)؛ هر حالت دیگر ۴۰۴ است."""
    visible = await _visible_items_by_ids(db, user, [item_id])
    item = visible.get(item_id)
    if item is None or subs.is_embed_external(item):
        raise APIError(404, "subtitle_not_found", "زیرنویس یافت نشد")
    row = (
        await db.execute(
            select(ItemSubtitle).where(
                ItemSubtitle.item_id == item_id,
                ItemSubtitle.lang == lang,
                ItemSubtitle.status == "ready",
            )
        )
    ).scalar_one_or_none()
    if row is None or not row.vtt:
        raise APIError(404, "subtitle_not_found", "زیرنویس یافت نشد")
    return row.vtt


# ---------------------------------------------------------------------------
# عمومی: موقعیت پخش کاربر (ادامهٔ تماشا)
# ---------------------------------------------------------------------------


async def _get_video_item_or_error(
    db: AsyncSession, item_id: uuid.UUID
) -> LibraryItem:
    """آیتم باید وجود داشته باشد (۴۰۴) و ویدیویی باشد (۴۲۲ not_a_video)."""
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    if item.kind not in VIDEO_KINDS:
        raise APIError(
            422,
            "not_a_video",
            "موقعیت پخش فقط برای آیتم‌های ویدیویی است",
            {"kind": item.kind},
        )
    return item


async def _get_library_item_or_error(
    db: AsyncSession, item_id: uuid.UUID
) -> LibraryItem:
    """آیتم باید وجود داشته باشد (۴۰۴) — هر kind کتابخانه‌ای پذیرفته است.

    برای «ذخیره» استفاده می‌شود: نشانک روی همهٔ آیتم‌های کتابخانه
    (ویدیو، صوت/درس، pdf و…) معنا دارد، نه فقط ویدیو. موقعیت پخش اما
    همچنان فقط ویدیویی است و از _get_video_item_or_error می‌گذرد.
    """
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    return item


def _progress_out(row: UserVideoProgress | None, item_id: uuid.UUID) -> dict:
    if row is None:
        return {
            "item_id": item_id,
            "position_seconds": None,
            "duration_seconds": None,
            "updated_at": None,
        }
    return {
        "item_id": row.item_id,
        "position_seconds": row.position_seconds,
        "duration_seconds": row.duration_seconds,
        "updated_at": row.updated_at,
    }


async def _find_progress(
    db: AsyncSession, user: User, item_id: uuid.UUID
) -> UserVideoProgress | None:
    stmt = select(UserVideoProgress).where(
        UserVideoProgress.user_id == user.id,
        UserVideoProgress.item_id == item_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_video_progress(
    db: AsyncSession, user: User, item_id: uuid.UUID
) -> dict:
    """موقعیت ذخیره‌شدهٔ همین کاربر؛ نبود ردیف یعنی position null (نه ۴۰۴).

    ویدیوی خارجی (یوتیوب) هرگز ردیف پیشرفت ندارد — همان payload خالی.
    """
    item = await _get_video_item_or_error(db, item_id)
    if item.external_url:
        return _progress_out(None, item_id)
    return _progress_out(await _find_progress(db, user, item_id), item_id)


async def save_video_progress(
    db: AsyncSession,
    user: User,
    item_id: uuid.UUID,
    *,
    position_seconds: float,
    duration_seconds: float | None,
) -> dict:
    """آپسرت موقعیت پخش کاربر جاری روی ویدیو — ردیف برگشتی مال همین کاربر است."""
    item = await _get_video_item_or_error(db, item_id)
    if item.external_url:
        raise APIError(
            422,
            "external_video",
            "ویدیوی خارجی (یوتیوب) موقعیت پخش ذخیره نمی‌کند",
        )
    row = await _find_progress(db, user, item_id)
    if row is None:
        row = UserVideoProgress(
            user_id=user.id,
            item_id=item_id,
            position_seconds=position_seconds,
            duration_seconds=duration_seconds,
        )
        db.add(row)
    else:
        row.position_seconds = position_seconds
        if duration_seconds is not None:
            row.duration_seconds = duration_seconds
        row.updated_at = _utcnow()
    await db.commit()
    await db.refresh(row)
    return _progress_out(row, item_id)


async def _find_saved(
    db: AsyncSession, user: User, item_id: uuid.UUID
) -> UserSavedVideo | None:
    stmt = select(UserSavedVideo).where(
        UserSavedVideo.user_id == user.id,
        UserSavedVideo.item_id == item_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_saved_state(
    db: AsyncSession, user: User | None, item_id: uuid.UUID
) -> dict:
    """وضعیت نشانک کاربر جاری؛ مهمان همیشه False (بدون خطا)."""
    if user is None:
        return {"item_id": item_id, "saved": False}
    row = await _find_saved(db, user, item_id)
    return {"item_id": item_id, "saved": row is not None}


async def save_video(
    db: AsyncSession, user: User, item_id: uuid.UUID
) -> dict:
    """ذخیرهٔ آیتم کتابخانه برای کاربر جاری — idempotent.

    هر kind کتابخانه‌ای (ویدیو، صوت/درس، pdf…) قابل ذخیره است؛ جدول
    user_saved_videos در عمل «آیتم‌های ذخیره‌شدهٔ کتابخانه» است.
    """
    await _get_library_item_or_error(db, item_id)
    if await _find_saved(db, user, item_id) is None:
        db.add(UserSavedVideo(user_id=user.id, item_id=item_id))
        await db.commit()
    return {"item_id": item_id, "saved": True}


async def unsave_video(
    db: AsyncSession, user: User, item_id: uuid.UUID
) -> dict:
    """حذف نشانک کاربر جاری — idempotent (نبود ردیف خطا نیست)."""
    await _get_library_item_or_error(db, item_id)
    row = await _find_saved(db, user, item_id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return {"item_id": item_id, "saved": False}


async def list_saved_videos(
    db: AsyncSession, user: User
) -> list[dict]:
    """آیتم‌های ذخیره‌شدهٔ کاربر جاری، تازه‌ترین ذخیره اول.

    همهٔ kindها برمی‌گردند و هر ردیف kind خودش را دارد تا وب ذخیره‌ها
    را به «ویدیوها» و «درس‌ها و صوت‌ها» تفکیک کند. آیتم‌هایی که دیگر
    برای کاربر قابل‌مشاهده نیستند (حذف/محدودشده) بی‌صدا کنار گذاشته
    می‌شوند — همان قواعد visibility فهرست عمومی.
    """
    stmt = (
        select(UserSavedVideo.item_id)
        .where(UserSavedVideo.user_id == user.id)
        .order_by(UserSavedVideo.created_at.desc(), UserSavedVideo.id.desc())
    )
    ids = list((await db.execute(stmt)).scalars().all())
    if not ids:
        return []
    visible = await _visible_items_by_ids(db, user, ids)
    ordered = [visible[i] for i in ids if i in visible]
    return await _items_out(db, ordered)


# ---------------------------------------------------------------------------
# مدیریت (library.manage)
# ---------------------------------------------------------------------------


async def _get_playlist_or_404(
    db: AsyncSession, playlist_id: uuid.UUID
) -> VideoPlaylist:
    playlist = await db.get(VideoPlaylist, playlist_id)
    if playlist is None:
        raise APIError(404, "playlist_not_found", "لیست پخش یافت نشد")
    return playlist


async def _admin_playlist_out(db: AsyncSession, playlist: VideoPlaylist) -> dict:
    memberships = await _playlist_items_ordered(db, playlist.id)
    items_by_id: dict[uuid.UUID, LibraryItem] = {}
    if memberships:
        rows = (
            await db.execute(
                select(LibraryItem).where(
                    LibraryItem.id.in_([m.item_id for m in memberships])
                )
            )
        ).scalars().all()
        items_by_id = {r.id: r for r in rows}
    names = await _scholar_names(db, [playlist.scholar_id])
    out_items: list[dict] = []
    for m in memberships:
        it = items_by_id.get(m.item_id)
        if it is None:
            continue
        out_items.append(
            {
                "item_id": it.id,
                "position": m.position,
                "kind": it.kind,
                "title": it.title,
                "workflow_status": it.workflow_status,
                "visibility": it.visibility,
                "duration_seconds": it.duration_seconds,
                "created_at": it.created_at,
            }
        )
    return {
        "id": playlist.id,
        "title": playlist.title,
        "description": playlist.description,
        "cover_media_key": playlist.cover_media_key,
        "scholar_id": playlist.scholar_id,
        "scholar_name": names.get(playlist.scholar_id) if playlist.scholar_id else None,
        "is_published": playlist.is_published,
        "sort_order": playlist.sort_order,
        "item_count": len(out_items),
        "items": out_items,
        "created_at": playlist.created_at,
        "updated_at": playlist.updated_at,
    }


async def admin_list_playlists(db: AsyncSession) -> list[dict]:
    stmt = select(VideoPlaylist).order_by(
        VideoPlaylist.sort_order.asc(), VideoPlaylist.created_at.asc()
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [await _admin_playlist_out(db, p) for p in rows]


async def create_playlist(
    db: AsyncSession,
    data: dict,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    playlist = VideoPlaylist(
        title=data["title"],
        description=data.get("description"),
        cover_media_key=data.get("cover_media_key"),
        scholar_id=data.get("scholar_id"),
        is_published=bool(data.get("is_published", False)),
        sort_order=int(data.get("sort_order", 0)),
    )
    db.add(playlist)
    await db.flush()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.playlist.create",
        entity_type="video_playlist",
        entity_id=str(playlist.id),
        new_values={"is_published": playlist.is_published},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(playlist)
    return await _admin_playlist_out(db, playlist)


async def update_playlist(
    db: AsyncSession,
    playlist_id: uuid.UUID,
    patch: dict,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    playlist = await _get_playlist_or_404(db, playlist_id)
    for field in (
        "title",
        "description",
        "cover_media_key",
        "scholar_id",
        "is_published",
        "sort_order",
    ):
        if field in patch:
            setattr(playlist, field, patch[field])
    playlist.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.playlist.update",
        entity_type="video_playlist",
        entity_id=str(playlist.id),
        new_values={"fields": sorted(patch.keys())},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(playlist)
    return await _admin_playlist_out(db, playlist)


async def delete_playlist(
    db: AsyncSession,
    playlist_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    playlist = await _get_playlist_or_404(db, playlist_id)
    out = await _admin_playlist_out(db, playlist)
    # حذف سخت لیست؛ ردیف‌های عضویت صریحاً پاک می‌شوند تا روی SQLite
    # (بدون pragma آبشاری FK) هم یتیم نماند — در PG ondelete=CASCADE هم هست.
    memberships = await _playlist_items_ordered(db, playlist.id)
    for m in memberships:
        await db.delete(m)
    await db.delete(playlist)
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.playlist.delete",
        entity_type="video_playlist",
        entity_id=str(playlist.id),
        old_values={"item_count": len(memberships)},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    return out


async def _rewrite_positions(
    db: AsyncSession, playlist_id: uuid.UUID, ordered_item_ids: list[uuid.UUID]
) -> None:
    """positionها را دقیقاً مطابق ترتیب داده‌شده بازنویسی می‌کند (۰-based)."""
    existing = {
        m.item_id: m for m in await _playlist_items_ordered(db, playlist_id)
    }
    for idx, item_id in enumerate(ordered_item_ids):
        row = existing.get(item_id)
        if row is None:
            db.add(
                VideoPlaylistItem(
                    playlist_id=playlist_id, item_id=item_id, position=idx
                )
            )
        else:
            row.position = idx
    await db.flush()


async def add_playlist_item(
    db: AsyncSession,
    playlist_id: uuid.UUID,
    item_id: uuid.UUID,
    position: int | None,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    playlist = await _get_playlist_or_404(db, playlist_id)
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    if item.kind not in VIDEO_KINDS:
        raise APIError(
            422, "not_a_video", "فقط آیتم‌های ویدیویی می‌توانند عضو لیست پخش شوند",
            {"kind": item.kind},
        )
    memberships = await _playlist_items_ordered(db, playlist.id)
    ids = [m.item_id for m in memberships]
    if item_id in ids:
        raise APIError(409, "already_in_playlist", "این ویدیو از قبل در این لیست هست")
    if position is None:
        ids.append(item_id)
    else:
        ids.insert(min(position, len(ids)), item_id)
    await _rewrite_positions(db, playlist.id, ids)
    playlist.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.playlist.item_add",
        entity_type="video_playlist",
        entity_id=str(playlist.id),
        new_values={"item_id": str(item_id)},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(playlist)
    return await _admin_playlist_out(db, playlist)


async def remove_playlist_item(
    db: AsyncSession,
    playlist_id: uuid.UUID,
    item_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    playlist = await _get_playlist_or_404(db, playlist_id)
    memberships = await _playlist_items_ordered(db, playlist.id)
    target = next((m for m in memberships if m.item_id == item_id), None)
    if target is None:
        raise APIError(404, "playlist_item_not_found", "این ویدیو در لیست نیست")
    await db.delete(target)
    await db.flush()
    remaining = [m.item_id for m in memberships if m.item_id != item_id]
    await _rewrite_positions(db, playlist.id, remaining)
    playlist.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.playlist.item_remove",
        entity_type="video_playlist",
        entity_id=str(playlist.id),
        old_values={"item_id": str(item_id)},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(playlist)
    return await _admin_playlist_out(db, playlist)


async def reorder_playlist_items(
    db: AsyncSession,
    playlist_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    playlist = await _get_playlist_or_404(db, playlist_id)
    memberships = await _playlist_items_ordered(db, playlist.id)
    current = [m.item_id for m in memberships]
    if len(item_ids) != len(current) or set(item_ids) != set(current):
        raise APIError(
            422,
            "order_mismatch",
            "ترتیب ارسالی باید دقیقاً همان مجموعهٔ فعلی آیتم‌های لیست باشد",
        )
    await _rewrite_positions(db, playlist.id, item_ids)
    playlist.updated_at = _utcnow()
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.playlist.reorder",
        entity_type="video_playlist",
        entity_id=str(playlist.id),
        new_values={"count": len(item_ids)},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(playlist)
    return await _admin_playlist_out(db, playlist)


async def request_subtitle_generation(
    db: AsyncSession,
    item_id: uuid.UUID,
    *,
    actor: User,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """تریگر تولید زیرنویس (CRM): ردیف‌های زبان‌های هدف pending می‌شوند
    و جاب generate_subtitles روی صف media می‌رود. صف در دسترس نباشد
    enqueued=False برمی‌گردد و ردیف‌ها pending می‌مانند (نه خطای پنهان)."""
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    if item.kind not in VIDEO_KINDS:
        raise APIError(
            422,
            "not_a_video",
            "زیرنویس خودکار فقط برای آیتم‌های ویدیویی است",
            {"kind": item.kind},
        )
    if subs.is_embed_external(item):
        raise APIError(
            422,
            "external_video",
            "ویدیوی خارجی (یوتیوب/آپارات) زیرنویس خودکار ندارد؛ "
            "کپشن داخل خود منبع است",
        )
    if not item.external_url and not item.media_key:
        raise APIError(
            422, "no_media_file", "این آیتم فایل رسانه‌ای ندارد"
        )
    langs = await subs.target_langs(db)
    statuses = await subs.reset_rows(db, item.id, langs)
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="videos.subtitles.generate",
        entity_type="library_item",
        entity_id=str(item.id),
        new_values={"langs": langs},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()
    enqueued = await library_service._enqueue_media_job(
        "generate_subtitles", item.id
    )
    return {"item_id": item.id, "statuses": statuses, "enqueued": enqueued}


async def admin_subtitle_statuses(
    db: AsyncSession, *, limit: int = 30
) -> list[dict]:
    """تازه‌ترین ویدیوهای آپلودی و لینک مستقیم فایل + وضعیت زیرنویس هر
    پنج زبان — کارت CRM.

    آیتم خارجیِ امبدی (یوتیوب/آپارات) عمداً نیست: کپشن خودش را دارد.
    تشخیص منبع از روی URL است و در SQL شدنی نیست؛ اسکن تازه‌ترین‌ها
    در پایتون فیلتر می‌شود (همان الگوی list_candidates). نبود ردیف
    برای یک زبان یعنی "missing"؛ وضعیت ردیف عیناً گزارش می‌شود.
    """
    stmt = (
        select(LibraryItem)
        .where(
            LibraryItem.kind.in_(VIDEO_KINDS),
            or_(
                LibraryItem.media_key.is_not(None),
                LibraryItem.external_url.is_not(None),
            ),
        )
        .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
        .limit(_SUBTITLE_STATUS_SCAN_CAP)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    items = [i for i in rows if not subs.is_embed_external(i)][:limit]
    by_item: dict[uuid.UUID, dict[str, str]] = {}
    if items:
        sstmt = select(ItemSubtitle).where(
            ItemSubtitle.item_id.in_([i.id for i in items])
        )
        for row in (await db.execute(sstmt)).scalars().all():
            by_item.setdefault(row.item_id, {})[row.lang] = row.status
    out: list[dict] = []
    for item in items:
        have = by_item.get(item.id, {})
        out.append(
            {
                "id": item.id,
                "kind": item.kind,
                "title": item.title,
                "workflow_status": item.workflow_status,
                "visibility": item.visibility,
                "created_at": item.created_at,
                "subtitles": {
                    lang: have.get(lang, "missing") for lang in SUBTITLE_LANGS
                },
            }
        )
    return out


async def list_candidates(
    db: AsyncSession, *, q: str | None = None, limit: int = 50
) -> list[dict]:
    """آیتم‌های ویدیویی کتابخانه برای انتخاب‌گر CRM — همهٔ وضعیت‌ها.

    جست‌وجو در پایتون است، نه LIKE روی JSON: روی SQLite ستون‌های JSON
    به‌صورت unicode-escaped ذخیره می‌شوند و پیش‌فیلتر SQL روی متن
    فارسی/عربی قابل‌اتکا نیست (همان دلیل جست‌وجوی خانه — ADR-0033).
    """
    stmt = (
        select(LibraryItem)
        .where(LibraryItem.kind.in_(VIDEO_KINDS))
        .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
        .limit(500 if q else limit)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    if q:
        needle = q.lower()
        rows = [
            r
            for r in rows
            if needle
            in json.dumps(
                {"t": r.title, "d": r.description}, ensure_ascii=False
            ).lower()
        ][:limit]
    return [
        {
            "id": r.id,
            "kind": r.kind,
            "title": r.title,
            "workflow_status": r.workflow_status,
            "visibility": r.visibility,
            "duration_seconds": r.duration_seconds,
            "created_at": r.created_at,
        }
        for r in rows
    ]
