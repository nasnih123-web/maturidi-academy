"""روتر بخش کودکان — فاز ۴.

فقط سیم‌کشی؛ منطق در service.py (§۱۵.۶). متن قرآن و ویدیوها عمومی‌اند؛
پیشرفت و داشبورد نیازمند احراز هویت‌اند؛ مدیریت نیازمند platform.settings
(همان قرارداد مدیریت ماژول قرآن).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission

from . import service
from .schemas import (
    ChildrenDashboardOut,
    ChildrenListenIn,
    ChildrenOfflinePackOut,
    ChildrenProgressOut,
    ChildrenQuestionCreateIn,
    ChildrenQuestionOut,
    ChildrenQuestionUpdateIn,
    ChildrenQuizSubmitIn,
    ChildrenQuizSubmitOut,
    ChildrenVideoLinkIn,
    ChildrenVideoOrderIn,
    ChildrenVideoOut,
    ChildrenWholeQuranPackOut,
)

children_router = APIRouter(prefix="/api/v1/quran/children", tags=["quran-children"])
admin_children_router = APIRouter(
    prefix="/api/v1/admin/quran/children", tags=["admin-quran-children"]
)

_admin_perm = require_permission("platform.settings")

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


# ---------------------------------------------------------------------------
# عمومی
# ---------------------------------------------------------------------------


@children_router.get(
    "/surahs/{surah}/videos", response_model=list[ChildrenVideoOut]
)
async def list_surah_videos(
    surah: int,
    user: User | None = Depends(_optional_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_surah_videos(db, surah, user)


@children_router.get(
    "/surahs/{surah}/quiz", response_model=list[ChildrenQuestionOut]
)
async def list_surah_quiz(
    surah: int,
    question_type: str | None = Query(default=None, pattern="^(mcq|matching)$"),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_questions(db, surah, question_type)


@children_router.get("/offline-pack", response_model=ChildrenOfflinePackOut)
async def get_offline_pack(
    surah: int = Query(ge=1, le=114),
    reciter: str = Query(default="minshawi"),
    db: AsyncSession = Depends(get_db),
):
    return await service.offline_pack(db, surah, reciter)


@children_router.get(
    "/offline-pack/whole-quran", response_model=ChildrenWholeQuranPackOut
)
async def get_whole_quran_pack(reciter: str = Query(default="minshawi")):
    return service.whole_quran_pack(reciter)


# ---------------------------------------------------------------------------
# پیشرفت و داشبورد (احراز هویت)
# ---------------------------------------------------------------------------


@children_router.post(
    "/surahs/{surah}/quiz/submit", response_model=ChildrenQuizSubmitOut
)
async def submit_quiz(
    surah: int,
    body: ChildrenQuizSubmitIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.submit_quiz(
        db, user, surah, body.question_type, body.answers
    )


@children_router.post("/progress/listen", response_model=ChildrenProgressOut)
async def record_listen(
    body: ChildrenListenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.record_listen(db, user, body.surah, body.last_ayah)


@children_router.get("/progress", response_model=list[ChildrenProgressOut])
async def get_progress(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.get_progress(db, user)


@children_router.get("/dashboard", response_model=ChildrenDashboardOut)
async def get_dashboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """داشبورد کودکان — فقط آمار واقعی و قابل‌ردیابی."""
    return await service.dashboard(db, user)


# ---------------------------------------------------------------------------
# مدیریت (CRM)
# ---------------------------------------------------------------------------


@admin_children_router.post(
    "/surahs/{surah}/videos", response_model=ChildrenVideoOut
)
async def link_video(
    surah: int,
    body: ChildrenVideoLinkIn,
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    return await service.link_video(db, surah, body.item_id, body.position)


@admin_children_router.delete("/surahs/{surah}/videos/{item_id}")
async def unlink_video(
    surah: int,
    item_id: uuid.UUID,
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    await service.unlink_video(db, surah, item_id)
    return {"ok": True}


@admin_children_router.put("/surahs/{surah}/videos/order")
async def reorder_videos(
    surah: int,
    body: ChildrenVideoOrderIn,
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    await service.reorder_videos(db, surah, body.item_ids)
    return {"ok": True}


@admin_children_router.get("/questions", response_model=list[ChildrenQuestionOut])
async def list_admin_questions(
    surah: int | None = Query(default=None, ge=1, le=114),
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.list_admin_questions(db, surah)
    return [
        {
            "id": r["id"],
            "surah": r["surah"],
            "question_type": r["question_type"],
            "source": r["source"],
            "payload": r["payload"],
            "is_active": r["is_active"],
        }
        for r in rows
    ]


@admin_children_router.post("/questions", response_model=ChildrenQuestionOut)
async def create_question(
    body: ChildrenQuestionCreateIn,
    user: User = Depends(get_current_user),
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_question(
        db, user, body.surah, body.question_type, body.payload, body.is_active
    )


@admin_children_router.patch("/questions/{question_id}")
async def update_question(
    question_id: uuid.UUID,
    body: ChildrenQuestionUpdateIn,
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    return await service.update_question(
        db, question_id, body.payload, body.is_active
    )


@admin_children_router.delete("/questions/{question_id}")
async def delete_question(
    question_id: uuid.UUID,
    _perm: None = Depends(_admin_perm),
    db: AsyncSession = Depends(get_db),
):
    await service.delete_question(db, question_id)
    return {"ok": True}
