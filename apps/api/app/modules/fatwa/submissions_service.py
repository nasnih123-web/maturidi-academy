"""سرویس پنل مؤلفین فتوا — فاز ۱۰.

ثبت فتوای رسمی توسط نقش scholar_author با گردش‌کار مشترک §۹
(app/core/workflow.py):
    draft → in_review → approved → published ↘ rejected / archived

نقش‌ها/مجوزها (§۲ — واقعی، از جدول‌ها):
- ثبت و ارسال برای بررسی: مجوز fatwa.submit (نقش scholar_author)
- تأیید/انتشار/رد: مجوز fatwa.approve
- افزودن به RAG: فتوای published + مجوز knowledge.manage

رویدادها: fatwa.submission_created / _submitted / _approved /
_submission_published؟ نه — fatwa.submission_published / _rejected /
fatwa.submission_added_to_rag.
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow
from app.core.errors import APIError
from app.core.events import emit_event
from app.models.models import (
    FatwaSubmission,
    FiqhKnowledgeChunk,
    Permission,
    RolePermission,
    User,
    UserRole,
)
from app.modules.fatwa.embeddings import (
    PROJECTION_ID,
    get_embedding_provider,
    pgvector_available,
    provider_identity,
)

_TRANSITION_EVENTS = {
    "in_review": "fatwa.submission_submitted",
    "approved": "fatwa.submission_approved",
    "published": "fatwa.submission_published",
    "rejected": "fatwa.submission_rejected",
    "archived": "fatwa.submission_archived",
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _encode_cursor(created_at: datetime, lid: uuid.UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(lid)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        ts, lid = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(ts), uuid.UUID(lid)
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


async def _has_permission(db: AsyncSession, user: User, key: str) -> bool:
    stmt = (
        select(Permission.id)
        .select_from(UserRole)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(UserRole.user_id == user.id, Permission.key == key)
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def is_approver(db: AsyncSession, user: User) -> bool:
    """تأییدکنندهٔ فتوا — مجوز واقعی fatwa.approve."""
    return await _has_permission(db, user, "fatwa.approve")


# ---------------------------------------------------------------------------
# ثبت و فهرست
# ---------------------------------------------------------------------------


async def create_submission(
    db: AsyncSession,
    *,
    author: User,
    title: dict,
    body: str,
    madhab: str | None,
    evidence: str | None,
) -> FatwaSubmission:
    if not body.strip():
        raise APIError(422, "empty_body", "متن فتوا نمی‌تواند خالی باشد")
    submission = FatwaSubmission(
        title=title,
        body=body,
        madhab=madhab,
        evidence=evidence,
        author_id=author.id,
        workflow_status=workflow.DRAFT,
    )
    db.add(submission)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="fatwa_submission",
        aggregate_id=str(submission.id),
        event_type="fatwa.submission_created",
        payload={"author_id": str(author.id)},
    )
    await db.commit()
    return submission


async def get_submission(db: AsyncSession, submission_id: uuid.UUID) -> FatwaSubmission:
    submission = await db.get(FatwaSubmission, submission_id)
    if not submission:
        raise APIError(404, "submission_not_found", "ثبت فتوا یافت نشد")
    return submission


async def _can_view(db: AsyncSession, user: User, submission: FatwaSubmission) -> bool:
    if submission.author_id == user.id:
        return True
    return await is_approver(db, user)


async def list_submissions(
    db: AsyncSession,
    user: User,
    *,
    status: str | None,
    cursor: str | None,
    limit: int,
) -> tuple[list[FatwaSubmission], str | None]:
    approver = await is_approver(db, user)
    stmt = select(FatwaSubmission).order_by(
        FatwaSubmission.created_at.desc(), FatwaSubmission.id.desc()
    )
    if not approver:
        stmt = stmt.where(FatwaSubmission.author_id == user.id)
    if status:
        if status not in workflow.STATUSES:
            raise APIError(422, "unknown_status", f"وضعیت ناشناخته: {status}")
        stmt = stmt.where(FatwaSubmission.workflow_status == status)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                FatwaSubmission.created_at < ts,
                and_(FatwaSubmission.created_at == ts, FatwaSubmission.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor


# ---------------------------------------------------------------------------
# گذارهای گردش‌کار
# ---------------------------------------------------------------------------


async def transition(
    db: AsyncSession,
    *,
    submission: FatwaSubmission,
    target: str,
    actor: User,
) -> FatwaSubmission:
    """گذار طبق ماشین §۹ + کنترل مجوز به‌ازای هر گذار."""
    workflow.validate_transition(submission.workflow_status, target)
    approver = await is_approver(db, actor)
    is_author = submission.author_id == actor.id

    if target == workflow.IN_REVIEW:
        # submit: نویسنده یا تأییدکننده
        if not (is_author or approver):
            raise APIError(403, "forbidden", "دسترسی کافی نیست")
    elif target in (workflow.APPROVED, workflow.PUBLISHED, workflow.REJECTED):
        if not approver:
            raise APIError(403, "forbidden", "فقط تأییدکنندهٔ فتوا مجاز است")
    elif target == workflow.ARCHIVED:
        if not (is_author or approver):
            raise APIError(403, "forbidden", "دسترسی کافی نیست")
    else:  # pragma: no cover — گذارهای draft از طریق رد/بایگانی پوشش داده شده‌اند
        if not approver:
            raise APIError(403, "forbidden", "دسترسی کافی نیست")

    submission.workflow_status = target
    submission.updated_at = _utcnow()
    if target == workflow.APPROVED:
        submission.reviewed_by = actor.id
        submission.reviewed_at = _utcnow()
    if target == workflow.PUBLISHED:
        submission.published_at = _utcnow()
        submission.version = (submission.version or 1) + 1

    event_type = _TRANSITION_EVENTS.get(target)
    if event_type:
        await emit_event(
            db,
            aggregate_type="fatwa_submission",
            aggregate_id=str(submission.id),
            event_type=event_type,
            payload={"actor_id": str(actor.id), "to": target},
        )
    await db.flush()
    await db.commit()

    # --- فاز ۱۱: هوک تلگرام (lazy import برای جلوگیری از چرخه؛ guarded) ---
    # in_review → اعلان بازبینی با دکمه‌های inline؛ published → انتشار خودکار
    # فقط اگر policy صریحاً auto_publish باشد. هر خطایی این‌جا نباید مسیر
    # فتوا را بشکند.
    try:
        from app.modules.telegram import distribute_service as _tg_dist

        if target == workflow.PUBLISHED:
            await _tg_dist.auto_publish_if_policy(
                db, "fatwa_submission", str(submission.id)
            )
        elif target == workflow.IN_REVIEW:
            await _tg_dist.notify_review_request(
                db, "fatwa_submission", str(submission.id), actor=actor
            )
    except Exception:  # noqa: BLE001 — تلگرام هرگز مسیر فتوا را نمی‌شکند
        from app.core.logging import logger as _log

        _log.exception("telegram hook failed (non-fatal)")
    return submission


# ---------------------------------------------------------------------------
# افزودن فتوای منتشرشده به RAG فاز ۶
# ---------------------------------------------------------------------------


async def add_to_rag(
    db: AsyncSession, *, submission: FatwaSubmission, actor: User
) -> FiqhKnowledgeChunk:
    """فتوای published → یک chunk جدید در fiqh_knowledge_chunks.

    Chunk با workflow_status=approved ساخته می‌شود تا طبق §۱۰ در RAG
    قابل‌خواندن باشد؛ ai_scopes صریحاً fatwa و assistant است.
    """
    if submission.workflow_status != workflow.PUBLISHED:
        raise APIError(
            422,
            "submission_not_published",
            "فقط فتوای منتشرشده را می‌توان به پایگاه دانش افزود",
        )
    # جلوگیری از افزودن تکراری همان نسخه — فیلتر در پایتون تا روی
    # SQLite و Postgres یکسان کار کند (§۸: بدون تکیه بر عملگر JSON خاص دیتابیس).
    candidates = (
        await db.execute(
            select(FiqhKnowledgeChunk).where(
                FiqhKnowledgeChunk.source_type == "fatwa_submission"
            )
        )
    ).scalars().all()
    if any(
        isinstance(c.source_ref, dict) and c.source_ref.get("id") == str(submission.id)
        for c in candidates
    ):
        raise APIError(409, "already_in_rag", "این فتوا قبلاً به پایگاه دانش افزوده شده است")

    title = submission.title or {}
    title_fa = title.get("fa") or title.get("en") or ""
    parts = [title_fa, submission.body]
    if submission.evidence:
        parts.append(submission.evidence)
    chunk_text = "\n\n".join(p for p in parts if p)

    provider = await get_embedding_provider(db)
    embedding = (await provider.embed([chunk_text]))[0]
    prov_name, prov_model = await provider_identity(provider)

    chunk = FiqhKnowledgeChunk(
        chunk_text=chunk_text,
        embedding=embedding,
        # ستون برداری واقعی روی Postgres (B-03 — ADR-0026)
        embedding_vec=list(embedding) if pgvector_available() else None,
        embedding_provider=prov_name,
        embedding_model=prov_model,
        embedding_projection=PROJECTION_ID,
        source_type="fatwa_submission",
        source_ref={
            "type": "fatwa_submission",
            "id": str(submission.id),
            "version": submission.version,
        },
        source_citation=dict(title),
        topic_category="fatwa",
        madhab_scope=submission.madhab,
        workflow_status="approved",
        approved_by=actor.id,
        ai_scopes=["fatwa", "assistant"],
    )
    db.add(chunk)
    await db.flush()
    await emit_event(
        db,
        aggregate_type="fatwa_submission",
        aggregate_id=str(submission.id),
        event_type="fatwa.submission_added_to_rag",
        payload={"chunk_id": str(chunk.id), "actor_id": str(actor.id)},
    )
    await db.commit()
    return chunk
