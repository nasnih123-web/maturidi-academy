"""سرویس کتابخانهٔ چندرسانه‌ای (DMS) — فاز ۹.

قراردادها:
- گردش‌کار: ماشین مشترک app.core.workflow (§۹) — هرگز پیاده‌سازی جدا.
- Storage: انتزاع app.core.storage (§۶) — فقط signed URL کوتاه‌مدت، هرگز
  کلید خام storage یا URL عمومی قابل‌حدس در پاسخ‌ها.
- آپلود: اعتبارسنجی پسوند + magic-byte (§۷) پیش از هر پردازش.
- نسخه‌بندی: ویرایش، نسخهٔ قبلی را در library_item_versions بایگانی می‌کند.
- AI indexing جدا از publication: فقط با اقدام صریح index-ai و فقط روی
  آیتم approved/published (RAG هرگز draft نمی‌بیند — §۱۰).
- جست‌وجوی واژگانی (§۸) جدا از جست‌وجوی معنایی فاز ۶ است.
"""
from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.audit import log_audit
from app.core.config import get_settings
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.storage import get_storage
from app.models.models import (
    LibraryItem,
    LibraryItemVersion,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)

from .schemas import AI_SCOPES

# ---------------------------------------------------------------------------
# ثابت‌های اعتبارسنجی آپلود (§۷)
# ---------------------------------------------------------------------------

KIND_EXTENSIONS: dict[str, set[str]] = {
    "video": {".mp4", ".webm", ".mov", ".mkv"},
    "video_360": {".mp4", ".webm", ".mov", ".mkv"},
    "pdf": {".pdf"},
    "audio": {".mp3", ".wav", ".ogg", ".m4a", ".flac"},
    "mindmap": {".mm", ".json", ".xmind"},
}
COVER_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png", ".webp"}

EXT_MIME: dict[str, str] = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".pdf": "application/pdf",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".mm": "application/xml",
    ".json": "application/json",
    ".xmind": "application/zip",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

# سقف حجم به‌ازای نوع — مستند و صریح.
MAX_BYTES: dict[str, int] = {
    "video": 512 * 1024 * 1024,
    "video_360": 512 * 1024 * 1024,
    "pdf": 100 * 1024 * 1024,
    "audio": 200 * 1024 * 1024,
    "mindmap": 20 * 1024 * 1024,
    "cover": 5 * 1024 * 1024,
}

SIGNED_URL_EXPIRY_S = 300  # §۶: انقضای کوتاه
DOWNLOAD_PATH = "/api/v1/library/download-by-ref"

_PRIVILEGED_ROLES = frozenset({"scholar", "admin", "super_admin"})


# ---------------------------------------------------------------------------
# ابزارهای داخلی
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(UTC)


# قرارداد §۷ — «بررسی امنیتی PDF (بدون اجرای JavaScript جاسازی‌شده)».
#
# محدودهٔ صادقانهٔ این کنترل (عمداً یک «اسکن امنیتی کامل» نیست و هیچ‌جا
# چنین ادعایی نمی‌شود):
# - فقط اکشن‌های جاوااسکریپت (/JavaScript و مخفف /JS) را در بایت‌های خام
#   شناسایی و با 422 رد می‌کند؛ سرور PDF را parse نمی‌کند.
# - پوشش نمی‌دهد: /OpenAction و /AA بدون JS، فایل‌های جاسازی‌شده
#   (/EmbeddedFiles)، XFA، و بدافزار عمومی — این‌ها نیازمند اسکنر واقعی‌اند.
# - اسکن ویروس کامل (ClamAV) جداگانه در ADR-0007 به فاز استقرار موکول شده
#   است؛ تا آن زمان هیچ ادعای «اسکن شد» در کد/UI وجود ندارد.
# عمداً محدود به JavaScript است (نه /OpenAction یا /AA که در PDFهای سالم
# هم رایج‌اند) تا false-positive ندهد.
_PDF_JS_ACTION_RE = re.compile(rb"/(JavaScript|JS)(?![A-Za-z0-9_])")


def _check_magic(content: bytes, ext: str) -> bool:
    """magic-byte در برابر پسوند — پسوند به‌تنهایی قابل جعل است (§۷)."""
    head = content[:16]
    if ext in (".mp4", ".m4a", ".mov"):
        return len(content) >= 8 and content[4:8] == b"ftyp"
    if ext in (".webm", ".mkv"):
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if ext == ".pdf":
        return head.startswith(b"%PDF-")
    if ext == ".mp3":
        return head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")
    if ext == ".wav":
        return head.startswith(b"RIFF") and len(content) >= 12 and content[8:12] == b"WAVE"
    if ext == ".ogg":
        return head.startswith(b"OggS")
    if ext == ".flac":
        return head.startswith(b"fLaC")
    if ext == ".mm":
        return content.lstrip()[:4] == b"<map"
    if ext == ".json":
        stripped = content.lstrip()
        return stripped[:1] in (b"{", b"[")
    if ext == ".xmind":
        return head.startswith(b"PK\x03\x04")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".webp":
        return head.startswith(b"RIFF") and len(content) >= 12 and content[8:12] == b"WEBP"
    return False


def validate_upload_content(
    kind: str, filename: str | None, content: bytes
) -> tuple[str, str]:
    """نسخهٔ عمومی اعتبارسنج آپلود (§۷) برای مصرف ماژول‌های دیگر
    (مثل درون‌ریزی تلگرام فاز ۱۱): پسوند + magic-byte + سقف حجم.
    برمی‌گرداند: (ext, mime). خطا: APIError."""
    return _validate_upload(kind, filename, content)


def upload_limit_for_kind(kind: str) -> int:
    """سقف حجم آپلود به‌ازای نوع — برای خواندن جریانیِ محدود در روتر."""
    limit = MAX_BYTES.get(kind)
    if limit is None:
        raise APIError(422, "invalid_kind", "نوع فایل نامعتبر است")
    return limit


async def read_upload_capped(upload, max_bytes: int) -> bytes:
    """خواندن جریانیِ UploadFile با سقف حجم — §۷.

    (پیاده‌سازی مشترک در app.core.storage.read_capped_upload؛ این wrapper
    برای سازگاری فراخوان‌های موجود نگه داشته شده.)
    """
    from app.core.storage import read_capped_upload

    return await read_capped_upload(upload, max_bytes)


async def get_item_kind(db: AsyncSession, item_id: uuid.UUID) -> str:
    """نوع آیتم — برای تعیین سقف حجم پیش از خواندن فایل جایگزین."""
    item = await _get_admin_item(db, item_id)
    return item.kind


def _validate_upload(kind: str, filename: str | None, content: bytes) -> tuple[str, str]:
    """اعتبارسنجی پسوند + magic-byte + سقف حجم. برمی‌گرداند: (ext, mime)."""
    ext = Path(filename or "").suffix.lower()
    allowed = KIND_EXTENSIONS.get(kind, set())
    if ext not in allowed:
        raise APIError(
            422,
            "invalid_file_extension",
            f"پسوند «{ext}» برای نوع «{kind}» مجاز نیست",
            {"allowed": sorted(allowed)},
        )
    limit = MAX_BYTES[kind]
    if len(content) > limit:
        raise APIError(
            413, "file_too_large", "حجم فایل بیش از سقف مجاز است",
            {"max_bytes": limit, "kind": kind},
        )
    if not content or not _check_magic(content, ext):
        raise APIError(
            422,
            "file_content_mismatch",
            "محتوای فایل با پسوند اعلام‌شده سازگار نیست (magic-byte نامعتبر)",
            {"extension": ext},
        )
    if ext == ".pdf" and _PDF_JS_ACTION_RE.search(content):
        raise APIError(
            422,
            "pdf_active_content",
            "فایل PDF حاوی کد جاوااسکریپت جاسازی‌شده است و پذیرفته نمی‌شود",
            {"extension": ext},
        )
    return ext, EXT_MIME[ext]


def _validate_cover(filename: str | None, content: bytes) -> tuple[str, str]:
    ext = Path(filename or "").suffix.lower()
    if ext not in COVER_EXTENSIONS:
        raise APIError(
            422, "invalid_cover_extension", "پسوند کاور باید jpg/png/webp باشد",
            {"allowed": sorted(COVER_EXTENSIONS)},
        )
    if len(content) > MAX_BYTES["cover"]:
        raise APIError(413, "cover_too_large", "حجم کاور بیش از ۵ مگابایت است")
    if not content or not _check_magic(content, ext):
        raise APIError(422, "cover_content_mismatch", "محتوای کاور با پسوند سازگار نیست")
    return ext, EXT_MIME[ext]


def _encode_cursor(created_at: datetime, lid: uuid.UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(lid)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        ts, lid = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(ts), uuid.UUID(lid)
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


async def _user_role_names(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    stmt = (
        select(Role.name)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id == user_id)
    )
    return set((await db.execute(stmt)).scalars().all())


async def _has_permission(db: AsyncSession, user_id: uuid.UUID, key: str) -> bool:
    stmt = (
        select(Permission.id)
        .select_from(UserRole)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(UserRole.user_id == user_id, Permission.key == key)
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def is_privileged(db: AsyncSession, user: User | None) -> bool:
    """دسترسی کامل کتابخانه: مجوز library.manage یا نقش عالم/ادمین."""
    if user is None:
        return False
    if await _has_permission(db, user.id, "library.manage"):
        return True
    return bool(await _user_role_names(db, user.id) & _PRIVILEGED_ROLES)


def _may_access(item: LibraryItem, user: User | None, privileged: bool) -> bool:
    """آیا فراخواننده می‌تواند این آیتم منتشرشده را ببیند/دانلود کند؟"""
    if privileged:
        return True
    if item.visibility == "public":
        return True
    if item.visibility == "registered":
        return user is not None
    return False  # scholars_only


async def _signed_url(key: str | None) -> str | None:
    """signed URL کوتاه‌مدت — هرگز کلید خام یا URL عمومی."""
    if not key or key.startswith("pending:"):
        return None
    storage = get_storage()
    return await storage.get_presigned_url(
        key, expires_seconds=SIGNED_URL_EXPIRY_S, download_path=DOWNLOAD_PATH
    )


def _snapshot_of(item: LibraryItem) -> dict:
    return {
        "kind": item.kind,
        "title": item.title,
        "description": item.description,
        "topic_tags": item.topic_tags,
        "media_key": item.media_key,
        "cover_media_key": item.cover_media_key,
        "visibility": item.visibility,
        "scholar_id": str(item.scholar_id) if item.scholar_id else None,
        "ai_scopes": item.ai_scopes,
        "include_in_fatwa_rag": item.include_in_fatwa_rag,
        "download_policy": item.download_policy,
        "duration_seconds": item.duration_seconds,
    }


def _to_out(item: LibraryItem, *, media_url: str | None, cover_url: str | None) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "title": item.title,
        "description": item.description,
        "scholar_id": item.scholar_id,
        "topic_tags": item.topic_tags or [],
        "related_lesson_id": item.related_lesson_id,
        "religious_place_ref": item.religious_place_ref,
        "visibility": item.visibility,
        "workflow_status": item.workflow_status,
        "version": item.version,
        "ai_scopes": item.ai_scopes or [],
        "include_in_fatwa_rag": item.include_in_fatwa_rag,
        "ai_indexed": item.ai_indexed,
        "download_policy": item.download_policy,
        "transcript_status": item.transcript_status,
        "ocr_status": item.ocr_status,
        "has_transcript": bool(item.transcript),
        "duration_seconds": item.duration_seconds,
        "file_size_bytes": item.file_size_bytes,
        "mime_type": item.mime_type,
        "source_type": item.source_type,
        "source_ref": item.source_ref,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "published_at": item.published_at,
        "media_url": media_url,
        "cover_url": cover_url,
        # فیلدهای مدیریتی — در نمای عمومی نادیده گرفته می‌شوند (اسکیما آن‌ها را ندارد)
        "transcript": item.transcript,
        "ocr_text": item.ocr_text,
        "processing_error": item.processing_error,
    }


async def _item_out_with_urls(
    db: AsyncSession, item: LibraryItem, user: User | None
) -> dict:
    privileged = await is_privileged(db, user)
    if _may_access(item, user, privileged):
        media_url = await _signed_url(item.media_key)
        cover_url = await _signed_url(item.cover_media_key)
    else:
        media_url, cover_url = None, None
    return _to_out(item, media_url=media_url, cover_url=cover_url)


async def _enqueue_media_job(job_name: str, item_id: uuid.UUID) -> bool:
    """صف ARQ — اگر Redis/ورکر در دسترس نبود، صادقانه False (نه خطای پنهان)."""
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
        await pool.enqueue_job(job_name, str(item_id), _queue_name="media")
        await pool.close()
        return True
    except Exception:  # noqa: BLE001 — worker آفلاین؛ وضعیت pending می‌ماند
        return False


async def _auto_pipeline_enabled(db: AsyncSession) -> bool:
    from app.core.platform_settings import get_setting

    raw = await get_setting(db, "media.auto_pipeline")
    if raw is None:
        return True
    try:
        return bool(json.loads(raw))
    except Exception:
        return raw.strip().lower() in ("true", "1", "yes")


async def _maybe_enqueue_pipeline(db: AsyncSession, item: LibraryItem) -> None:
    """پس از آپلود: transcribe برای صوت/ویدیو، OCR برای PDF (با پرچم پیکربندی)."""
    if not await _auto_pipeline_enabled(db):
        return
    if item.kind in ("audio", "video", "video_360"):
        item.transcript_status = "pending"
        await _enqueue_media_job("transcribe_media", item.id)
    elif item.kind == "pdf":
        item.ocr_status = "pending"
        await _enqueue_media_job("ocr_pdf", item.id)


# ---------------------------------------------------------------------------
# ایجاد (آپلود)
# ---------------------------------------------------------------------------


async def create_item(
    db: AsyncSession,
    meta: dict,
    content: bytes,
    filename: str | None,
    *,
    actor: User,
    cover_content: bytes | None = None,
    cover_filename: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    # --- فاز ۱۱: درون‌ریزی تلگرام — مقادیر صریح، پیش‌فرض‌ها بدون تغییر ---
    initial_status: str = workflow.DRAFT,
    source_type: str = "upload",
    source_ref: dict | None = None,
) -> dict:
    kind = meta["kind"]
    ext, mime = _validate_upload(kind, filename, content)

    storage = get_storage()
    media_key = f"library/{kind}/{uuid.uuid4().hex}{ext}"
    await storage.put_object(media_key, content, mime)

    cover_key: str | None = None
    if cover_content:
        cext, cmime = _validate_cover(cover_filename, cover_content)
        cover_key = f"library/covers/{uuid.uuid4().hex}{cext}"
        await storage.put_object(cover_key, cover_content, cmime)

    item = LibraryItem(
        kind=kind,
        title=meta["title"],
        description=meta.get("description"),
        cover_media_key=cover_key,
        media_key=media_key,
        scholar_id=meta.get("scholar_id"),
        topic_tags=list(meta.get("topic_tags") or []),
        related_lesson_id=meta.get("related_lesson_id"),
        religious_place_ref=meta.get("religious_place_ref"),
        visibility=meta.get("visibility", "registered"),
        workflow_status=initial_status,
        version=1,
        ai_scopes=list(meta.get("ai_scopes") or []),
        include_in_fatwa_rag=bool(meta.get("include_in_fatwa_rag", False)),
        download_policy=meta.get("download_policy"),
        duration_seconds=meta.get("duration_seconds"),
        file_size_bytes=len(content),
        mime_type=mime,
        source_type=source_type,
        source_ref=source_ref,
        created_by=actor.id,
    )
    db.add(item)
    await db.flush()

    await _maybe_enqueue_pipeline(db, item)

    await emit_event(
        db,
        aggregate_type="library_item",
        aggregate_id=str(item.id),
        event_type="library.item.created",
        payload={"kind": kind, "visibility": item.visibility, "source_type": source_type,
                 "file_size_bytes": len(content)},
    )
    await log_audit(
        db,
        actor_id=actor.id,
        actor_type="admin",
        action="library.item.create",
        entity_type="library_item",
        entity_id=str(item.id),
        new_values={
            "kind": kind, "visibility": item.visibility,
            "file_size_bytes": len(content), "mime_type": mime,
        },
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return await _item_out_with_urls(db, item, actor)


# ---------------------------------------------------------------------------
# فهرست عمومی + جزئیات
# ---------------------------------------------------------------------------


def _public_base_stmt(privileged: bool, user: User | None):
    stmt = select(LibraryItem).where(LibraryItem.workflow_status == workflow.PUBLISHED)
    if not privileged:
        if user is None:
            stmt = stmt.where(LibraryItem.visibility == "public")
        else:
            stmt = stmt.where(LibraryItem.visibility.in_(["public", "registered"]))
    return stmt


async def list_items(
    db: AsyncSession,
    *,
    user: User | None,
    kind: str | None = None,
    scholar_id: uuid.UUID | None = None,
    tag: str | None = None,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[dict], str | None]:
    privileged = await is_privileged(db, user)
    stmt = _public_base_stmt(privileged, user)
    if kind:
        stmt = stmt.where(LibraryItem.kind == kind)
    if scholar_id:
        stmt = stmt.where(LibraryItem.scholar_id == scholar_id)
    if tag:
        stmt = stmt.where(func.lower(cast(LibraryItem.topic_tags, Text)).like(f"%{tag.lower()}%"))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(cast(LibraryItem.title, Text)).like(like),
                func.lower(cast(LibraryItem.description, Text)).like(like),
                func.lower(cast(LibraryItem.topic_tags, Text)).like(like),
            )
        )
    stmt = stmt.order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
    if cursor:
        ts, lid = _decode_cursor(cursor)
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
        next_cursor = _encode_cursor(last.created_at, last.id)
        rows = rows[:limit]
    items = [await _item_out_with_urls(db, r, user) for r in rows]
    return items, next_cursor


async def get_item_detail(
    db: AsyncSession, item_id: uuid.UUID, user: User | None
) -> dict:
    item = await db.get(LibraryItem, item_id)
    if item is None or item.workflow_status != workflow.PUBLISHED:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    privileged = await is_privileged(db, user)
    if not _may_access(item, user, privileged):
        # scholars_only برای غیرمجاز نامرئی است — ۴۰۴ نه ۴۰۳ (عدم افشای وجود)
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    return await _item_out_with_urls(db, item, user)


# ---------------------------------------------------------------------------
# جست‌وجوی واژگانی (§۸ — جدا از جست‌وجوی معنایی فاز ۶)
# ---------------------------------------------------------------------------


def _lexical_rank(query: str, item: LibraryItem) -> tuple[float, list[str]]:
    """امتیازدهی سادهٔ واژگانی با وزن: عنوان > برچسب > توضیح > transcript/ocr.

    مستند: این جست‌وجوی واژگانی است (LIKE-based)؛ جست‌وجوی معنایی از طریق
    scope=semantic_search فاز ۶ انجام می‌شود (§۸: lexical جدا از semantic).
    """
    toks = [t for t in re.split(r"\s+", query.strip().lower()) if t]
    if not toks:
        return 0.0, []
    score = 0.0
    matched: list[str] = []

    def blob(*parts: str | None) -> str:
        return " ".join(p for p in parts if p).lower()

    title_b = blob(json.dumps(item.title, ensure_ascii=False))
    desc_b = blob(json.dumps(item.description, ensure_ascii=False) if item.description else None)
    tags_b = blob(" ".join(item.topic_tags or []))
    text_b = blob(item.transcript, item.ocr_text)

    for t in toks:
        if t in title_b:
            score += 3.0; matched.append("title")
        if t in tags_b:
            score += 2.0; matched.append("tags")
        if t in desc_b:
            score += 1.5; matched.append("description")
        if t in text_b:
            score += 1.0
            in_transcript = bool(item.transcript) and t in item.transcript.lower()
            matched.append("transcript" if in_transcript else "ocr")
    return score, sorted(set(matched))


async def search_items(
    db: AsyncSession, query: str, user: User | None, limit: int = 20
) -> dict:
    privileged = await is_privileged(db, user)
    stmt = _public_base_stmt(privileged, user).order_by(
        LibraryItem.created_at.desc(), LibraryItem.id.desc()
    ).limit(500)  # سقف اسکن واژگانی — مثل Backend B فاز ۶
    rows = (await db.execute(stmt)).scalars().all()
    hits: list[tuple[float, list[str], LibraryItem]] = []
    for r in rows:
        score, matched = _lexical_rank(query, r)
        if score > 0:
            hits.append((score, matched, r))
    hits.sort(key=lambda h: h[0], reverse=True)
    hits = hits[: max(1, min(limit, 50))]
    out = []
    for score, matched, r in hits:
        d = await _item_out_with_urls(db, r, user)
        out.append({"item": d, "score": round(score, 3), "matched_in": matched})
    return {"query": query, "hits": out}


# ---------------------------------------------------------------------------
# مدیریت ادمین
# ---------------------------------------------------------------------------


async def admin_list_items(
    db: AsyncSession,
    *,
    kind: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = 20,
) -> tuple[list[dict], str | None]:
    """فهرست مدیریتی CRM — همهٔ وضعیت‌های گردش‌کار (پیش‌نویس‌ها هم دیده می‌شوند)."""
    stmt = select(LibraryItem)
    if kind:
        stmt = stmt.where(LibraryItem.kind == kind)
    if status:
        stmt = stmt.where(LibraryItem.workflow_status == status)
    if source_type:
        stmt = stmt.where(LibraryItem.source_type == source_type)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(cast(LibraryItem.title, Text)).like(like),
                func.lower(cast(LibraryItem.description, Text)).like(like),
            )
        )
    stmt = stmt.order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
    if cursor:
        ts, lid = _decode_cursor(cursor)
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
        next_cursor = _encode_cursor(last.created_at, last.id)
        rows = rows[:limit]
    return [_to_out(r, media_url=None, cover_url=None) for r in rows], next_cursor


async def _get_admin_item(db: AsyncSession, item_id: uuid.UUID) -> LibraryItem:
    item = await db.get(LibraryItem, item_id)
    if item is None:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    return item


async def admin_get_item(db: AsyncSession, item_id: uuid.UUID, actor: User) -> dict:
    """جزئیات مدیریتی — همهٔ وضعیت‌ها + transcript/OCR (فقط library.manage)."""
    item = await _get_admin_item(db, item_id)
    return await _item_out_with_urls(db, item, actor)


async def _archive_version(
    db: AsyncSession, item: LibraryItem, actor_id: uuid.UUID | None, note: str | None
) -> None:
    db.add(
        LibraryItemVersion(
            item_id=item.id,
            version=item.version,
            snapshot=_snapshot_of(item),
            created_by=actor_id,
            note=note,
        )
    )
    await db.flush()


async def update_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    patch: dict,
    *,
    actor: User,
    new_content: bytes | None = None,
    new_filename: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """ویرایش — نسخهٔ قبلی بایگانی می‌شود، هرگز حذف. محتوای جدید اختیاری."""
    item = await _get_admin_item(db, item_id)
    old = {"version": item.version, "title": item.title, "visibility": item.visibility}

    await _archive_version(db, item, actor.id, patch.get("note"))

    if new_content is not None:
        ext, mime = _validate_upload(item.kind, new_filename, new_content)
        storage = get_storage()
        media_key = f"library/{item.kind}/{uuid.uuid4().hex}{ext}"
        await storage.put_object(media_key, new_content, mime)
        item.media_key = media_key
        item.file_size_bytes = len(new_content)
        item.mime_type = mime
        # محتوای عوض‌شده → transcript/OCR قبلی دیگر معتبر نیست؛ ایندکس AI کهنه می‌شود
        item.transcript = None
        item.transcript_status = "pending"
        item.ocr_text = None
        item.ocr_status = "pending"
        item.processing_error = None
        item.ai_indexed = False
        await _maybe_enqueue_pipeline(db, item)

    for field in (
        "title", "description", "scholar_id", "topic_tags", "related_lesson_id",
        "religious_place_ref", "visibility", "ai_scopes", "include_in_fatwa_rag",
        "download_policy", "duration_seconds",
    ):
        if field in patch and patch[field] is not None:
            setattr(item, field, patch[field])
        elif field in patch and field in ("description", "scholar_id", "related_lesson_id",
                                          "religious_place_ref", "download_policy",
                                          "duration_seconds"):
            setattr(item, field, None)  # پاک‌سازی صریح nullableها مجاز است

    item.version = (item.version or 0) + 1
    item.updated_at = _utcnow()
    await db.flush()

    await emit_event(
        db, aggregate_type="library_item", aggregate_id=str(item.id),
        event_type="library.item.updated",
        payload={"version": item.version, "previous_version": old["version"]},
    )
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="library.item.update",
        entity_type="library_item", entity_id=str(item.id),
        old_values=old,
        new_values={"version": item.version, "title": item.title, "visibility": item.visibility},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return await _item_out_with_urls(db, item, actor)


async def transition_item(
    db: AsyncSession, item_id: uuid.UUID, to: str, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
    note: str | None = None,
) -> dict:
    """گذار روی ماشین مشترک §۹ — نامعتبر → 422 (الگوی cms_service)."""
    item = await _get_admin_item(db, item_id)
    current = item.workflow_status
    workflow.validate_transition(current, to)  # نامعتبر → 422
    item.workflow_status = to
    item.updated_at = _utcnow()
    if to == workflow.PUBLISHED and item.published_at is None:
        item.published_at = _utcnow()
    await db.flush()

    event_type = "library.item.published" if to == workflow.PUBLISHED else "library.item.transition"
    await emit_event(
        db, aggregate_type="library_item", aggregate_id=str(item.id),
        event_type=event_type,
        payload={"from": current, "to": to, "version": item.version, "note": bool(note)},
    )
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="library.item.transition",
        entity_type="library_item", entity_id=str(item.id),
        old_values={"workflow_status": current},
        new_values={"workflow_status": to, "version": item.version, **({"note": note} if note else {})},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return await _item_out_with_urls(db, item, actor)


async def reprocess_item(
    db: AsyncSession, item_id: uuid.UUID, job: str, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """صف‌بندی مجدد STT/OCR — وضعیت pending و job در صف media (آفلاین بودن ورکر خطا نیست)."""
    item = await _get_admin_item(db, item_id)
    if job == "transcribe":
        item.transcript_status = "pending"
        item.processing_error = None
        enqueued = await _enqueue_media_job("transcribe_media", item.id)
    elif job == "ocr":
        item.ocr_status = "pending"
        item.processing_error = None
        enqueued = await _enqueue_media_job("ocr_pdf", item.id)
    else:
        raise APIError(422, "bad_job", "job باید transcribe یا ocr باشد")
    item.updated_at = _utcnow()
    await db.flush()
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="library.item.reprocess",
        entity_type="library_item", entity_id=str(item.id),
        new_values={"job": job, "enqueued": enqueued},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return await _item_out_with_urls(db, item, actor)


async def archive_item(
    db: AsyncSession, item_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """حذف = بایگانی (وضعیت archived) — رکورد هرگز فیزیکی حذف نمی‌شود (§۹.۵)."""
    return await transition_item(db, item_id, workflow.ARCHIVED, actor=actor, ip=ip, user_agent=user_agent)


async def list_versions(db: AsyncSession, item_id: uuid.UUID) -> list[dict]:
    await _get_admin_item(db, item_id)
    stmt = (
        select(LibraryItemVersion)
        .where(LibraryItemVersion.item_id == item_id)
        .order_by(LibraryItemVersion.version.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "version": r.version, "snapshot": r.snapshot,
            "created_by": r.created_by, "created_at": r.created_at, "note": r.note,
        }
        for r in rows
    ]


async def revert_version(
    db: AsyncSession, item_id: uuid.UUID, version: int, *, actor: User,
    note: str | None = None, ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """بازگشت به نسخهٔ قبلی — اول وضعیت فعلی بایگانی می‌شود."""
    item = await _get_admin_item(db, item_id)
    stmt = select(LibraryItemVersion).where(
        LibraryItemVersion.item_id == item_id, LibraryItemVersion.version == version
    )
    target = (await db.execute(stmt)).scalar_one_or_none()
    if target is None:
        raise APIError(404, "version_not_found", "نسخهٔ درخواستی یافت نشد")

    await _archive_version(db, item, actor.id, note or f"revert → v{version}")

    snap = target.snapshot or {}
    item.title = snap.get("title", item.title)
    item.description = snap.get("description", item.description)
    item.topic_tags = snap.get("topic_tags", item.topic_tags)
    item.media_key = snap.get("media_key", item.media_key)
    item.cover_media_key = snap.get("cover_media_key", item.cover_media_key)
    item.visibility = snap.get("visibility", item.visibility)
    item.scholar_id = uuid.UUID(snap["scholar_id"]) if snap.get("scholar_id") else None
    item.ai_scopes = snap.get("ai_scopes", item.ai_scopes)
    item.include_in_fatwa_rag = snap.get("include_in_fatwa_rag", item.include_in_fatwa_rag)
    item.download_policy = snap.get("download_policy", item.download_policy)
    item.duration_seconds = snap.get("duration_seconds", item.duration_seconds)
    item.version = (item.version or 0) + 1
    item.ai_indexed = False  # محتوا برگشت خورده → ایندکس کهنه است
    item.updated_at = _utcnow()
    await db.flush()

    await emit_event(
        db, aggregate_type="library_item", aggregate_id=str(item.id),
        event_type="library.item.reverted",
        payload={"to_version": version, "new_version": item.version},
    )
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="library.item.revert",
        entity_type="library_item", entity_id=str(item.id),
        new_values={"reverted_to": version, "version": item.version},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return await _item_out_with_urls(db, item, actor)


# ---------------------------------------------------------------------------
# درون‌ریزی برنامه‌ریزی‌شده (آمادهٔ تلگرام)
# ---------------------------------------------------------------------------


async def import_item(
    db: AsyncSession, body: dict, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """ایجاد برنامه‌ریزی‌شده (مثلاً از تلگرام — فاز ۱۱): همیشه در in_review
    می‌نشیند و بدون بازبینی انسانی منتشر نمی‌شود."""
    item = LibraryItem(
        kind=body["kind"],
        title=body["title"],
        description=body.get("description"),
        media_key=f"pending:telegram/{uuid.uuid4().hex}",  # فایل هنوز الصاق نشده
        scholar_id=body.get("scholar_id"),
        topic_tags=list(body.get("topic_tags") or []),
        visibility=body.get("visibility", "registered"),
        workflow_status=workflow.IN_REVIEW,
        version=1,
        ai_scopes=list(body.get("ai_scopes") or []),
        include_in_fatwa_rag=bool(body.get("include_in_fatwa_rag", False)),
        download_policy=body.get("download_policy"),
        duration_seconds=body.get("duration_seconds"),
        file_size_bytes=body.get("file_size_bytes"),
        mime_type=body.get("mime_type"),
        source_type="telegram_import",
        source_ref=dict(body.get("source_ref") or {}),
        created_by=actor.id,
    )
    db.add(item)
    await db.flush()
    await emit_event(
        db, aggregate_type="library_item", aggregate_id=str(item.id),
        event_type="library.item.created",
        payload={"source_type": "telegram_import", "workflow_status": "in_review",
                 "source_ref": item.source_ref},
    )
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="library.item.import",
        entity_type="library_item", entity_id=str(item.id),
        new_values={"kind": item.kind, "source_type": "telegram_import",
                    "workflow_status": "in_review",
                    "source_ref": {k: v for k, v in (item.source_ref or {}).items()
                                   if "session" not in str(k).lower()}},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return await _item_out_with_urls(db, item, actor)


# ---------------------------------------------------------------------------
# ایندکس AI — صریح و جدا از انتشار
# ---------------------------------------------------------------------------


def _indexable_text(item: LibraryItem) -> str:
    parts: list[str] = []
    for loc in ("fa", "ar", "en"):
        t = (item.title or {}).get(loc)
        if t:
            parts.append(t)
        d = (item.description or {}).get(loc)
        if d:
            parts.append(d)
    if item.transcript:
        parts.append(item.transcript)
    if item.ocr_text:
        parts.append(item.ocr_text)
    return "\n\n".join(parts).strip()


async def index_ai(
    db: AsyncSession, item_id: uuid.UUID, *, actor: User,
    ip: str | None = None, user_agent: str | None = None,
) -> dict:
    """اقدام صریح ایندکس AI (جدا از انتشار).

    - فقط روی آیتم approved/published (RAG هرگز draft نمی‌بیند — §۱۰).
    - chunkها با source_ref={type: library_item, id, version} و
      source_library_item_ref (فیلد رزروشدهٔ ADR-0005) ثبت می‌شوند؛
      استناد (citation) شامل url صفحهٔ آیتم کتابخانه است.
    - تأیید chunkها تابع مجوز fatwa.approve است (حاکمیت ADR-0005): اگر
      فراخواننده این مجوز را نداشته باشد، chunkها draft می‌مانند و
      ai_indexed=false برمی‌گردد تا بازبینی فقهی انجام شود.
    """
    from app.models.models import FiqhKnowledgeChunk, IngestionRun

    item = await _get_admin_item(db, item_id)
    if item.workflow_status not in (workflow.APPROVED, workflow.PUBLISHED):
        raise APIError(
            422, "item_not_indexable",
            "ایندکس AI فقط روی آیتم تأییدشده/منتشرشده مجاز است (RAG هرگز draft نمی‌بیند)",
            {"workflow_status": item.workflow_status},
        )

    scopes = [s for s in (item.ai_scopes or []) if s in AI_SCOPES]
    if item.include_in_fatwa_rag and "fatwa" not in scopes:
        scopes.append("fatwa")
    if not scopes:
        raise APIError(
            422, "no_ai_scopes",
            "برای این آیتم هیچ scope هوش مصنوعی فعالی نیست (ai_scopes خالی و include_in_fatwa_rag=false)",
        )

    text = _indexable_text(item)
    if not text:
        raise APIError(422, "nothing_to_index", "متن قابل‌ایندکسی (عنوان/توضیح/transcript/OCR) وجود ندارد")

    # حاکمیت ADR-0005: تأیید chunk فقط با fatwa.approve
    can_approve_chunks = await _has_permission(db, actor.id, "fatwa.approve")

    run = IngestionRun(
        source_type="library_item",
        status="queued",
        stats={"run_config": {"item_id": str(item.id)}},
    )
    db.add(run)
    await db.flush()

    from app.modules.fatwa.ingestion import run_ingestion

    title = item.title or {}
    citation = {
        "fa": title.get("fa"), "ar": title.get("ar"), "en": title.get("en"),
        "url": f"/library/items/{item.id}",  # صفحهٔ آیتم در وب (مسیر نسبی — Track 2)
        "library_item_id": str(item.id),
        "kind": item.kind,
    }
    stats = await run_ingestion(
        db,
        run.id,
        source_type="library_item",
        payload={
            "text": text,
            "source_id": str(item.id),       # → source_ref.type/id
            "source_version": str(item.version),
        },
        ai_scopes=scopes,
        source_citation=citation,
        created_by=actor.id,
    )
    chunk_ids: list[str] = stats["stages"]["index"]["chunk_ids"]

    approved_count = 0
    for cid in chunk_ids:
        ch = await db.get(FiqhKnowledgeChunk, uuid.UUID(cid))
        if ch is None:
            continue
        ch.source_library_item_ref = str(item.id)  # فیلد رزروشدهٔ فاز ۹ در ADR-0005
        if can_approve_chunks:
            ch.workflow_status = "approved"
            ch.approved_by = actor.id
            approved_count += 1

    item.ai_indexed = approved_count == len(chunk_ids) and len(chunk_ids) > 0
    item.updated_at = _utcnow()
    await db.flush()

    detail = (
        "chunkها تأیید و در RAG قابل‌استناد شدند"
        if item.ai_indexed
        else "chunkها ساخته شدند ولی draft ماندند — تأیید نهایی با مجوز fatwa.approve لازم است"
    )
    await emit_event(
        db, aggregate_type="library_item", aggregate_id=str(item.id),
        event_type="library.item.ai_indexed",
        payload={"chunks": len(chunk_ids), "approved": approved_count,
                 "scopes": scopes, "ai_indexed": item.ai_indexed},
    )
    await log_audit(
        db, actor_id=actor.id, actor_type="admin", action="library.item.index_ai",
        entity_type="library_item", entity_id=str(item.id),
        new_values={"ai_indexed": item.ai_indexed, "chunks": len(chunk_ids),
                    "chunks_approved": approved_count, "scopes": scopes},
        ip=ip, user_agent=user_agent,
    )
    await db.commit()

    return {
        "item_id": item.id,
        "ai_indexed": item.ai_indexed,
        "chunks_created": len(chunk_ids),
        "chunks_approved": approved_count,
        "chunk_ids": chunk_ids,
        "scopes": scopes,
        "detail": detail,
    }


# ---------------------------------------------------------------------------
# دانلود با URL امضاشده (§۶)
# ---------------------------------------------------------------------------


async def resolve_download_key(db: AsyncSession, key: str) -> tuple[LibraryItem, str]:
    """کلید storage → (آیتم، mime). کلید ناشناس → ۴۰۴."""
    stmt = select(LibraryItem).where(
        or_(LibraryItem.media_key == key, LibraryItem.cover_media_key == key)
    ).limit(1)
    item = (await db.execute(stmt)).scalar_one_or_none()
    if item is None:
        raise APIError(404, "key_not_found", "فایل یافت نشد")
    if item.cover_media_key == key:
        mime = EXT_MIME.get(Path(key).suffix.lower(), "application/octet-stream")
        return item, mime
    return item, item.mime_type or "application/octet-stream"
