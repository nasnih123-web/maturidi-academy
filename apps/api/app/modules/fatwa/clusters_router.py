"""روتر تجمیع سوالات تکراری — فاز ۱۰.

POST /api/v1/fatwa/questions — ثبت سوال و تطبیق با خوشه‌ها.
GET  /api/v1/fatwa/clusters — فهرست خوشه‌ها (پنل مفتی).
POST /api/v1/fatwa/clusters/{id}/answer — پاسخ یک‌بارهٔ مفتی (اعلان همگانی).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.fatwa import cluster_service as service
from app.modules.fatwa import panel_schemas as schemas

clusters_router = APIRouter(prefix="/api/v1/fatwa", tags=["fatwa-clusters"])

_can_answer = require_permission("fatwa.answer_cluster")

MAX_LIMIT = 100


def _member_out(m) -> schemas.ClusterMemberOut:
    return schemas.ClusterMemberOut(
        id=m.id,
        question_text=m.question_text,
        user_id=m.user_id,
        source=m.source,
        created_at=m.created_at,
    )


@clusters_router.post("/questions", response_model=schemas.QuestionOut, status_code=201)
async def ask_question(
    payload: schemas.QuestionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await service.submit_question(
        db, user=user, text=payload.text, source=payload.source
    )
    suggestion = None
    if result["suggestion"]:
        suggestion = schemas.QuestionSuggestion(**result["suggestion"])
    return schemas.QuestionOut(
        cluster_id=result["cluster_id"],
        matched=result["matched"],
        similarity=result["similarity"],
        suggestion=suggestion,
    )


async def _cluster_out(db: AsyncSession, cluster, *, with_members: bool) -> schemas.ClusterOut:
    members = await service.list_members(db, cluster.id) if with_members else []
    return schemas.ClusterOut(
        id=cluster.id,
        representative_question=cluster.representative_question,
        status=cluster.status,
        answer=cluster.answer,
        answered_by=cluster.answered_by,
        answered_at=cluster.answered_at,
        member_count=len(members),
        members=[_member_out(m) for m in members],
        created_at=cluster.created_at,
    )


@clusters_router.get("/clusters", response_model=schemas.ClusterPage)
async def list_clusters(
    status: str | None = Query(default=None),
    after: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_answer),
):
    clusters, next_cursor = await service.list_clusters(
        db, status=status, cursor=after, limit=limit
    )
    items = []
    for cluster in clusters:
        out = await _cluster_out(db, cluster, with_members=False)
        out.member_count = await service.count_members(db, cluster.id)
        items.append(out)
    return schemas.ClusterPage(items=items, next_cursor=next_cursor)


@clusters_router.get("/clusters/{cluster_id}", response_model=schemas.ClusterOut)
async def get_cluster(
    cluster_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_answer),
):
    cluster = await service.get_cluster(db, cluster_id)
    return await _cluster_out(db, cluster, with_members=True)


@clusters_router.post(
    "/clusters/{cluster_id}/answer", response_model=schemas.ClusterAnswerOut
)
async def answer_cluster(
    cluster_id: UUID,
    payload: schemas.ClusterAnswer,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_answer),
):
    cluster = await service.get_cluster(db, cluster_id)
    cluster, notified = await service.answer_cluster(
        db, cluster=cluster, answer=payload.answer, answered_by=user
    )
    return schemas.ClusterAnswerOut(
        id=cluster.id,
        status=cluster.status,
        answer=cluster.answer or "",
        answered_at=cluster.answered_at,
        notified_count=notified,
    )
