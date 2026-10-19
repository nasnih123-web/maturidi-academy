"""روتر پنل مؤلفین فتوا — فاز ۱۰.

POST /api/v1/fatwa/submissions و گذارهای گردش‌کار مشترک §۹:
submit | approve | publish | reject (+ آرشیو).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.fatwa import panel_schemas as schemas
from app.modules.fatwa import submissions_service as service

submissions_router = APIRouter(prefix="/api/v1/fatwa/submissions", tags=["fatwa-submissions"])

_can_knowledge = require_permission("knowledge.manage")

MAX_LIMIT = 100


async def _can_participate(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """نویسنده (fatwa.submit) یا تأییدکننده (fatwa.approve) — RBAC دقیق‌تر
    هر گذار در لایهٔ service اعمال می‌شود."""
    if await service._has_permission(db, user, "fatwa.submit"):
        return user
    if await service._has_permission(db, user, "fatwa.approve"):
        return user
    raise APIError(403, "forbidden", "دسترسی کافی نیست")


def _out(s) -> schemas.SubmissionOut:
    return schemas.SubmissionOut(
        id=s.id,
        title=s.title,
        body=s.body,
        madhab=s.madhab,
        evidence=s.evidence,
        author_id=s.author_id,
        workflow_status=s.workflow_status,
        version=s.version or 1,
        reviewed_by=s.reviewed_by,
        reviewed_at=s.reviewed_at,
        published_at=s.published_at,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@submissions_router.post("", response_model=schemas.SubmissionOut, status_code=201)
async def create_submission(
    payload: schemas.SubmissionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    submission = await service.create_submission(
        db,
        author=user,
        title=dict(payload.title),
        body=payload.body,
        madhab=payload.madhab,
        evidence=payload.evidence,
    )
    return _out(submission)


@submissions_router.get("", response_model=schemas.SubmissionPage)
async def list_submissions(
    status: str | None = Query(default=None),
    after: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    items, next_cursor = await service.list_submissions(
        db, user, status=status, cursor=after, limit=limit
    )
    return schemas.SubmissionPage(items=[_out(s) for s in items], next_cursor=next_cursor)


@submissions_router.get("/{submission_id}", response_model=schemas.SubmissionOut)
async def get_submission(
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    submission = await service.get_submission(db, submission_id)
    if not await service._can_view(db, user, submission):
        raise APIError(403, "forbidden", "دسترسی کافی نیست")
    return _out(submission)


async def _transition(
    submission_id: UUID, target: str, db: AsyncSession, user: User
) -> schemas.SubmissionOut:
    submission = await service.get_submission(db, submission_id)
    submission = await service.transition(
        db, submission=submission, target=target, actor=user
    )
    return _out(submission)


@submissions_router.post("/{submission_id}/submit", response_model=schemas.SubmissionOut)
async def submit_for_review(
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    return await _transition(submission_id, "in_review", db, user)


@submissions_router.post("/{submission_id}/approve", response_model=schemas.SubmissionOut)
async def approve(
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    return await _transition(submission_id, "approved", db, user)


@submissions_router.post("/{submission_id}/publish", response_model=schemas.SubmissionOut)
async def publish(
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    return await _transition(submission_id, "published", db, user)


@submissions_router.post("/{submission_id}/reject", response_model=schemas.SubmissionOut)
async def reject(
    submission_id: UUID,
    payload: schemas.RejectBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_participate),
):
    return await _transition(submission_id, "rejected", db, user)


@submissions_router.post(
    "/{submission_id}/add-to-rag", response_model=schemas.ChunkRef, status_code=201
)
async def add_to_rag(
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    submission = await service.get_submission(db, submission_id)
    chunk = await service.add_to_rag(db, submission=submission, actor=user)
    return schemas.ChunkRef(chunk_id=chunk.id)
