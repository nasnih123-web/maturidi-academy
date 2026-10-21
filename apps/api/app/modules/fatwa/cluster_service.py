"""سرویس تجمیع سوالات تکراری — فاز ۱۰.

سوال جدید با provider فاز ۶ (app/modules/fatwa/embeddings.py) embed می‌شود و
با cosine-similarity با نماینده‌های خوشه‌های باز/پاسخ‌داده‌شده مقایسه می‌شود؛
آستانه از platform_settings (کلید fatwa.cluster_match_threshold، پیش‌فرض ۰.۸۲).

- تطبیق → عضو جدید در خوشه؛ اگر خوشه قبلاً پاسخ داده شده، پاسخ موجود به‌عنوان
  پیشنهاد فوری برگردانده می‌شود.
- عدم تطبیق → خوشهٔ جدید.
- پاسخ یک‌بارهٔ مفتی به خوشه → اعلان ذخیره‌شده برای **همهٔ** کاربران عضو
  (جدول notifications — وب/CRM نمایش می‌دهند) + رویداد دامنه.
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import get_setting
from app.models.models import ClusterMember, QuestionCluster, User
from app.modules.fatwa.embeddings import (
    cosine_similarity,
    get_embedding_provider,
)
from app.modules.social.service import notify_user

DEFAULT_CLUSTER_THRESHOLD = 0.82


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _L(fa: str, ar: str, en: str) -> dict:
    return {"fa": fa, "ar": ar, "en": en}


async def cluster_threshold(db: AsyncSession) -> float:
    raw = await get_setting(db, "fatwa.cluster_match_threshold")
    try:
        value = float(raw) if raw else DEFAULT_CLUSTER_THRESHOLD
    except (TypeError, ValueError):
        value = DEFAULT_CLUSTER_THRESHOLD
    return min(1.0, max(0.0, value))


def _encode_cursor(created_at: datetime, lid: uuid.UUID) -> str:
    raw = json.dumps([created_at.isoformat(), str(lid)])
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        ts, lid = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return datetime.fromisoformat(ts), uuid.UUID(lid)
    except Exception:
        raise APIError(400, "invalid_cursor", "کرسر صفحه‌بندی نامعتبر است")


async def _find_best_match(
    db: AsyncSession, query_vec: list[float], threshold: float
) -> tuple[QuestionCluster | None, float]:
    """بهترین خوشهٔ منطبق (باز یا پاسخ‌داده‌شده) — None یعنی عدم تطبیق."""
    stmt = select(QuestionCluster).where(
        QuestionCluster.status.in_(("open", "answered")),
        QuestionCluster.embedding.is_not(None),
    )
    clusters = (await db.execute(stmt)).scalars().all()
    best: QuestionCluster | None = None
    best_score = -1.0
    for cluster in clusters:
        score = cosine_similarity(query_vec, cluster.embedding or [])
        if score > best_score:
            best, best_score = cluster, score
    if best is not None and best_score >= threshold:
        return best, best_score
    return None, best_score


async def submit_question(
    db: AsyncSession, *, user: User, text: str, source: str = "direct"
) -> dict:
    """ثبت سوال و تطبیق با خوشه‌ها.

    خروجی: {cluster_id, matched, similarity, suggestion?} که suggestion فقط
    وقتی خوشهٔ منطبق قبلاً پاسخ داده شده، شامل answer و answered_at است.
    """
    cleaned = text.strip()
    if not cleaned:
        raise APIError(422, "empty_question", "متن سوال نمی‌تواند خالی باشد")
    if source not in ("chat", "direct"):
        raise APIError(422, "invalid_source", "منبع سوال نامعتبر است")

    provider = await get_embedding_provider(db)
    query_vec = (await provider.embed([cleaned]))[0]
    threshold = await cluster_threshold(db)

    match, score = await _find_best_match(db, query_vec, threshold)
    if match is not None:
        db.add(
            ClusterMember(
                cluster_id=match.id,
                question_text=cleaned,
                user_id=user.id,
                source=source,
            )
        )
        await db.flush()
        await emit_event(
            db,
            aggregate_type="question_cluster",
            aggregate_id=str(match.id),
            event_type="fatwa.cluster_question_added",
            payload={
                "user_id": str(user.id),
                "source": source,
                "similarity": round(score, 4),
            },
        )
        await db.commit()
        suggestion = None
        if match.status == "answered" and match.answer:
            suggestion = {
                "answer": match.answer,
                "answered_at": match.answered_at.isoformat()
                if match.answered_at
                else None,
            }
        return {
            "cluster_id": match.id,
            "matched": True,
            "similarity": round(score, 4),
            "suggestion": suggestion,
        }

    cluster = QuestionCluster(
        representative_question=cleaned,
        embedding=query_vec,
        status="open",
    )
    db.add(cluster)
    await db.flush()
    db.add(
        ClusterMember(
            cluster_id=cluster.id,
            question_text=cleaned,
            user_id=user.id,
            source=source,
        )
    )
    await db.flush()
    await emit_event(
        db,
        aggregate_type="question_cluster",
        aggregate_id=str(cluster.id),
        event_type="fatwa.cluster_created",
        payload={"user_id": str(user.id), "source": source},
    )
    await db.commit()
    return {
        "cluster_id": cluster.id,
        "matched": False,
        "similarity": None,
        "suggestion": None,
    }


async def list_clusters(
    db: AsyncSession, *, status: str | None, cursor: str | None, limit: int
) -> tuple[list[QuestionCluster], str | None]:
    stmt = select(QuestionCluster).order_by(
        QuestionCluster.created_at.desc(), QuestionCluster.id.desc()
    )
    if status:
        if status not in ("open", "answered", "archived"):
            raise APIError(422, "invalid_status", "وضعیت خوشه نامعتبر است")
        stmt = stmt.where(QuestionCluster.status == status)
    if cursor:
        ts, lid = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                QuestionCluster.created_at < ts,
                and_(QuestionCluster.created_at == ts, QuestionCluster.id < lid),
            )
        )
    rows = list((await db.execute(stmt.limit(limit + 1))).scalars().all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return rows, next_cursor


async def get_cluster(db: AsyncSession, cluster_id: uuid.UUID) -> QuestionCluster:
    cluster = await db.get(QuestionCluster, cluster_id)
    if not cluster:
        raise APIError(404, "cluster_not_found", "خوشه یافت نشد")
    return cluster


async def count_members(db: AsyncSession, cluster_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(ClusterMember)
        .where(ClusterMember.cluster_id == cluster_id)
    )
    return int((await db.execute(stmt)).scalar_one())


async def list_members(db: AsyncSession, cluster_id: uuid.UUID) -> list[ClusterMember]:
    rows = (
        await db.execute(
            select(ClusterMember)
            .where(ClusterMember.cluster_id == cluster_id)
            .order_by(ClusterMember.created_at.asc())
        )
    ).scalars().all()
    return list(rows)


async def answer_cluster(
    db: AsyncSession, *, cluster: QuestionCluster, answer: str, answered_by: User
) -> tuple[QuestionCluster, int]:
    """پاسخ یک‌بارهٔ مفتی → اعلان برای همهٔ اعضای یکتای خوشه.

    خروجی: (cluster, notified_count).
    """
    cleaned = answer.strip()
    if not cleaned:
        raise APIError(422, "empty_answer", "متن پاسخ نمی‌تواند خالی باشد")
    now = _utcnow()
    cluster.answer = cleaned
    cluster.answered_by = answered_by.id
    cluster.answered_at = now
    cluster.status = "answered"
    await db.flush()

    members = await list_members(db, cluster.id)
    user_ids = list(dict.fromkeys(m.user_id for m in members))  # یکتا، با حفظ ترتیب
    for uid in user_ids:
        await notify_user(
            db,
            user_id=uid,
            notif_type="fatwa.cluster_answered",
            title=_L(
                "سوال شما پاسخ داده شد",
                "تمت الإجابة على سؤالك",
                "Your question was answered",
            ),
            body=cleaned,
            data={"cluster_id": str(cluster.id)},
        )
    await emit_event(
        db,
        aggregate_type="question_cluster",
        aggregate_id=str(cluster.id),
        event_type="fatwa.cluster_answered",
        payload={
            "answered_by": str(answered_by.id),
            "member_count": len(user_ids),
            "notified_count": len(user_ids),
        },
    )
    await db.commit()
    return cluster, len(user_ids)
