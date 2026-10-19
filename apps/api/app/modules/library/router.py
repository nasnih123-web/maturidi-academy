"""روتر کتابخانهٔ چندرسانه‌ای — فاز ۹.

فاز ۰ §۱۵ قانون ۶: روتر فقط سیم‌کشی است؛ منطق در service.py.
قرارداد مسیرها دقیقاً همان است که web/CRM روی آن ساخته می‌شوند، به‌علاوهٔ
یک فهرست مدیریتی (GET /api/v1/admin/library/items) که CRM برای مدیریت
پیش‌نویس‌ها لازم دارد (در ADR-0007 مستند شده).
"""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import RedirectResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.database import get_db
from app.core.errors import APIError
from app.core.security import rate_limiter
from app.core.storage import get_storage
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

from . import service
from .schemas import (
    CursorPage,
    ImportIn,
    IndexAiOut,
    LibraryItemAdminOut,
    LibraryItemMetaIn,
    LibraryItemOut,
    LibraryItemUpdateIn,
    ReprocessIn,
    RevertIn,
    SearchOut,
    TransitionIn,
    VersionOut,
)

library_router = APIRouter(prefix="/api/v1/library", tags=["library"])
admin_library_router = APIRouter(prefix="/api/v1/admin/library", tags=["admin-library"])

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


def _out(d: dict) -> LibraryItemOut:
    return LibraryItemOut(**d)


def _admin_out(d: dict) -> LibraryItemAdminOut:
    return LibraryItemAdminOut(**d)


# ---------------------------------------------------------------------------
# عمومی
# ---------------------------------------------------------------------------


@library_router.get("/items", response_model=CursorPage)
async def list_items(
    kind: str | None = Query(default=None, pattern="^(video|video_360|pdf|audio|mindmap)$"),
    scholar_id: uuid.UUID | None = None,
    tag: str | None = None,
    q: str | None = None,
    after: str | None = Query(default=None, description="کرسر صفحه‌بندی"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """فهرست آیتم‌های منتشرشده — visibility بر اساس احراز هویت اعمال می‌شود
    (ناشناس: فقط public؛ کاربر: public+registered؛ عالم/مدیر: همه)."""
    items, next_cursor = await service.list_items(
        db, user=user, kind=kind, scholar_id=scholar_id, tag=tag, q=q,
        cursor=after, limit=limit,
    )
    return CursorPage(items=[_out(d) for d in items], next_cursor=next_cursor)


@library_router.get("/search", response_model=SearchOut)
async def search_items(
    q: str = Query(min_length=2, description="عبارت جست‌وجو"),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """جست‌وجوی واژگانی روی عنوان/برچسب/transcript/OCR (§۸ — جدا از معنایی فاز ۶)."""
    result = await service.search_items(db, q, user, limit=limit)
    return SearchOut(
        query=result["query"],
        hits=[
            {"item": _out(h["item"]), "score": h["score"], "matched_in": h["matched_in"]}
            for h in result["hits"]
        ],
    )


@library_router.get("/items/{item_id}/stream", response_class=RedirectResponse)
async def stream_item(
    item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """استریم — 302 به signed URL کوتاه‌مدت؛ visibility اعمال و دسترسی لاگ می‌شود."""
    ip, ua = _client(request)
    if not rate_limiter.is_allowed(f"library_stream:{ip or 'unknown'}", limit=60, window_s=60):
        raise APIError(429, "rate_limited", "تعداد درخواست بیش از حد مجاز است")
    detail = await service.get_item_detail(db, item_id, user)
    media_url = detail["media_url"]
    if not media_url:
        raise APIError(404, "item_not_found", "آیتم یافت نشد")
    await log_audit(
        db,
        actor_id=user.id if user else None,
        actor_type="user" if user else "anonymous",
        action="library.item.stream",
        entity_type="library_item",
        entity_id=str(item_id),
        new_values={"kind": detail["kind"]},
        ip=ip, user_agent=ua,
    )
    await db.commit()
    return RedirectResponse(url=media_url, status_code=302)


@library_router.get("/items/{item_id}", response_model=LibraryItemOut)
async def get_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """جزئیات آیتم — media_url/cover_url فقط signed و فقط اگر فراخواننده مجاز باشد.
    scholars_only برای غیرمجاز ۴۰۴ است (نه ۴۰۳) تا وجود آیتم لو نرود."""
    return _out(await service.get_item_detail(db, item_id, user))


@library_router.get("/download-by-ref")
async def download_by_ref(
    key: str,
    exp: int,
    sig: str,
    db: AsyncSession = Depends(get_db),
):
    """دانلود با URL امضاشدهٔ کوتاه‌مدت (§۶) — امضا جای احراز هویت را می‌گیرد."""
    storage = get_storage()
    verify = getattr(storage, "verify_download_sig", None)
    read_bytes = getattr(storage, "read_bytes", None)
    if verify is None or read_bytes is None or not verify(key, exp, sig):
        raise APIError(403, "invalid_signature", "امضای دانلود نامعتبر یا منقضی است")
    _, mime = await service.resolve_download_key(db, key)
    data = await read_bytes(key)
    return Response(content=data, media_type=mime)


# ---------------------------------------------------------------------------
# ادمین (library.manage)
# ---------------------------------------------------------------------------


@admin_library_router.get("/items", response_model=CursorPage)
async def admin_list_items(
    kind: str | None = Query(default=None, pattern="^(video|video_360|pdf|audio|mindmap)$"),
    status: str | None = Query(default=None, pattern="^(draft|in_review|approved|published|rejected|archived)$"),
    q: str | None = None,
    after: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """فهرست مدیریتی CRM — همهٔ وضعیت‌ها (پیش‌نویس‌ها هم دیده می‌شوند)."""
    items, next_cursor = await service.admin_list_items(
        db, kind=kind, status=status, q=q, cursor=after, limit=limit
    )
    return CursorPage(items=[_out(d) for d in items], next_cursor=next_cursor)


@admin_library_router.get("/items/{item_id}", response_model=LibraryItemAdminOut)
async def admin_get_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """جزئیات مدیریتی — شامل transcript/OCR/خطای پردازش برای بازبینی CRM."""
    return _admin_out(await service.admin_get_item(db, item_id, user))


@admin_library_router.post("/items", response_model=LibraryItemOut, status_code=201)
async def create_item(
    request: Request,
    metadata: str = Form(description="متادیتای JSON (LibraryItemMetaIn)"),
    file: UploadFile = File(description="فایل رسانه"),
    cover: UploadFile | None = File(default=None, description="کاور اختیاری"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """آپلود آیتم — اعتبارسنجی magic-byte + پسوند پیش از هر پردازش (§۷)."""
    ip, ua = _client(request)
    try:
        meta = LibraryItemMetaIn.model_validate(json.loads(metadata))
    except Exception as exc:
        raise APIError(422, "invalid_metadata", f"متادیتای JSON نامعتبر است: {exc}")
    content = await file.read()
    cover_content, cover_filename = None, None
    if cover is not None:
        cover_content = await cover.read()
        cover_filename = cover.filename
    return _out(
        await service.create_item(
            db, meta.model_dump(), content, file.filename,
            actor=user, cover_content=cover_content, cover_filename=cover_filename,
            ip=ip, user_agent=ua,
        )
    )


@admin_library_router.put("/items/{item_id}", response_model=LibraryItemOut)
async def update_item(
    item_id: uuid.UUID,
    request: Request,
    metadata: str = Form(description="وصلهٔ JSON (LibraryItemUpdateIn)"),
    file: UploadFile | None = File(default=None, description="فایل جایگزین اختیاری"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """ویرایش — نسخهٔ قبلی بایگانی می‌شود (هرگز حذف). فایل جایگزین اختیاری است."""
    ip, ua = _client(request)
    try:
        patch = LibraryItemUpdateIn.model_validate(json.loads(metadata))
    except Exception as exc:
        raise APIError(422, "invalid_metadata", f"متادیتای JSON نامعتبر است: {exc}")
    new_content, new_filename = None, None
    if file is not None:
        new_content = await file.read()
        new_filename = file.filename
    return _out(
        await service.update_item(
            db, item_id, patch.model_dump(exclude_unset=True),
            actor=user, new_content=new_content, new_filename=new_filename,
            ip=ip, user_agent=ua,
        )
    )


@admin_library_router.post("/items/{item_id}/transition", response_model=LibraryItemOut)
async def transition_item(
    item_id: uuid.UUID,
    body: TransitionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """گذار گردش‌کار روی ماشین مشترک §۹ — گذار نامعتبر → 422."""
    ip, ua = _client(request)
    return _out(await service.transition_item(db, item_id, body.to, actor=user, ip=ip, user_agent=ua, note=body.note))


@admin_library_router.get("/items/{item_id}/versions", response_model=list[VersionOut])
async def list_versions(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """تاریخچهٔ نسخه‌های بایگانی‌شدهٔ آیتم."""
    return [VersionOut(**v) for v in await service.list_versions(db, item_id)]


@admin_library_router.post("/items/{item_id}/versions/{v}/revert", response_model=LibraryItemOut)
async def revert_version(
    item_id: uuid.UUID,
    v: int,
    request: Request,
    body: RevertIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """بازگشت به نسخهٔ قبلی — اول وضعیت فعلی بایگانی می‌شود."""
    ip, ua = _client(request)
    return _out(
        await service.revert_version(
            db, item_id, v, actor=user, note=(body.note if body else None),
            ip=ip, user_agent=ua,
        )
    )


@admin_library_router.delete("/items/{item_id}", response_model=LibraryItemOut)
async def delete_item(
    item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """حذف = بایگانی (وضعیت archived) — رکورد هرگز فیزیکی حذف نمی‌شود."""
    ip, ua = _client(request)
    return _out(await service.archive_item(db, item_id, actor=user, ip=ip, user_agent=ua))


@admin_library_router.post("/items/{item_id}/index-ai", response_model=IndexAiOut)
async def index_ai(
    item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """ایندکس AI — اقدام صریح و جدا از انتشار؛ فقط روی آیتم approved/published.
    استناد chunkها به صفحهٔ آیتم کتابخانه اشاره می‌کند."""
    ip, ua = _client(request)
    return IndexAiOut(**await service.index_ai(db, item_id, actor=user, ip=ip, user_agent=ua))


@admin_library_router.post("/import", response_model=LibraryItemOut, status_code=201)
async def import_item(
    body: ImportIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """ایجاد برنامه‌ریزی‌شده (آمادهٔ تلگرام — فاز ۱۱): همیشه در in_review می‌نشیند."""
    ip, ua = _client(request)
    return _out(await service.import_item(db, body.model_dump(), actor=user, ip=ip, user_agent=ua))


@admin_library_router.post("/items/{item_id}/reprocess", response_model=LibraryItemOut)
async def reprocess_item(
    item_id: uuid.UUID,
    body: ReprocessIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_library),
):
    """صف‌بندی مجدد STT/OCR روی صف media."""
    ip, ua = _client(request)
    return _out(await service.reprocess_item(db, item_id, body.job, actor=user, ip=ip, user_agent=ua))
