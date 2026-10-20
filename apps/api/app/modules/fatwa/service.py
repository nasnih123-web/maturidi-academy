"""سرویس فاز ۶ — موتور فتوای هوشمند (RAG).

همهٔ منطق کسب‌وکار اینجاست (§۱۵.۶)؛ روترها فقط سیم‌کشی‌اند.
قراردادها: ADR-0005، §۹/§۹.۵/§۹.۶/§۱۰/§۱۴.
"""
from __future__ import annotations

import hashlib
import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import workflow as _workflow
from app.core.audit import log_audit
from app.core.errors import APIError
from app.core.events import emit_event
from app.core.platform_settings import get_typed_setting
from app.models.models import (
    AIUsageLog,
    FatwaMessage,
    FatwaSession,
    FiqhKnowledgeChunk,
    FiqhTopic,
    IngestionRun,
    MadhabPosition,
    QuizAttempt,
    QuizQuestion,
    TrustedExternalSource,
    User,
    VerificationCheck,
)

from . import ingestion as _ingestion  # noqa: F401 — ثبت جاب ARQ روی صف ai
from .embeddings import (
    AI_SCOPES,
    ChunkIndex,
    ScoredChunk,
    cosine_similarity,
    get_embedding_provider,
)
from .providers import (
    SAFETY_PROMPT,
    SYSTEM_PROMPT,
    LLMProvider,
    PromptLayers,
    build_context_block,
    resolve_provider,
)

# وضعیت‌های قابل‌خواندن RAG از ماشین مشترک §۹
_RAG_OK = {"approved", "published"}

# پاسخ «نمی‌دانم» — §۱۰: اگر در RAG نبود، صراحتاً نمی‌دانم (LocalizedText دستی ممنوع
# نیست چون این رشتهٔ سیستمی پاسخ است، نه UI؛ با این حال سه‌زبانه نگه داشته شده).
IDK_ANSWER = {
    "fa": "در پایگاه دانش تأییدشده پاسخی برای این پرسش نیافتم. لطفاً با یک عالم مورداعتماد مشورت کنید.",
    "ar": "لم أجد إجابة لهذا السؤال في قاعدة المعرفة المعتمدة. يرجى استشارة عالم تثق به.",
    "en": "I could not find an answer to this question in the approved knowledge base. Please consult a trusted scholar.",
}

AI_LABEL = {
    "fa": "پاسخ تولیدشده با کمک هوش مصنوعی — مشورت با عالم توصیه می‌شود",
    "ar": "إجابة مولّدة بمساعدة الذكاء الاصطناعي — يُنصح باستشارة عالم",
    "en": "AI-assisted answer — consulting a scholar is recommended",
}

UNAVAILABLE_NOTE = {
    "fa": "موتور تولید متن در دسترس نیست؛ منابع بازیابی‌شده در ادامه آمده است.",
    "ar": "محرك توليد النص غير متاح؛ المصادر المسترجعة مذكورة أدناه.",
    "en": "The text generation engine is unavailable; retrieved sources follow.",
}


# ---------------------------------------------------------------------------
# تنظیمات AI (از platform_settings با پیش‌فرض — §۱۰)
# ---------------------------------------------------------------------------


async def _ai_int(db: AsyncSession, key: str, default: int) -> int:
    raw = await get_typed_setting(db, key, default)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


async def daily_quota(db: AsyncSession) -> int:
    return await _ai_int(db, "ai.daily_quota_per_user", 20)


async def rate_per_minute(db: AsyncSession) -> int:
    return await _ai_int(db, "ai.rate_per_minute", 5)


async def stream_timeout_s(db: AsyncSession) -> float:
    return float(await _ai_int(db, "ai.stream_timeout_s", 60))


# ---------------------------------------------------------------------------
# سهمیه و rate limit — پنجرهٔ لغزان درون‌فرایندی (محدودیت replica مثل فاز ۵
# مستند است؛ در صورت نیاز به Redis منتقل می‌شود).
# ---------------------------------------------------------------------------

_minute_hits: dict[str, deque[float]] = defaultdict(deque)
_daily_hits: dict[str, deque[float]] = defaultdict(deque)


def reset_ai_limits() -> None:
    """فقط برای تست — شمارنده‌های سهمیه را پاک می‌کند."""
    _minute_hits.clear()
    _daily_hits.clear()


def _quota_key(user: User | None, client_ip: str | None) -> str:
    return f"user:{user.id}" if user else f"ip:{client_ip or 'unknown'}"


async def check_quota(
    db: AsyncSession, user: User | None, client_ip: str | None, endpoint: str
) -> None:
    """سقف دقیقه‌ای + سقف روزانه؛ تخطی → ۴۲۹ با پاکت یکدست (§۱)."""
    key = _quota_key(user, client_ip)
    now = time.time()

    rpm = await rate_per_minute(db)
    dq = _minute_hits[f"rpm:{endpoint}:{key}"]
    while dq and dq[0] <= now - 60:
        dq.popleft()
    if len(dq) >= rpm:
        raise APIError(
            429,
            "rate_limited",
            "سقف درخواست در دقیقه رد شد؛ لطفاً کمی بعد تلاش کنید",
            details={"retry_after_s": 60},
        )
    dq.append(now)

    quota = await daily_quota(db)
    if user is not None:
        # شمارش DB-محور برای کاربران احرازهویت‌شده
        day_start = datetime.now(UTC).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        count = (
            await db.execute(
                select(func.count())
                .select_from(AIUsageLog)
                .where(
                    AIUsageLog.user_id == user.id,
                    AIUsageLog.endpoint == endpoint,
                    AIUsageLog.created_at >= day_start,
                )
            )
        ).scalar_one()
        if count >= quota:
            raise APIError(
                429,
                "quota_exceeded",
                "سقف روزانهٔ استفاده از هوش مصنوعی تمام شد",
                details={"quota": quota},
            )
    else:
        dq2 = _daily_hits[f"daily:{endpoint}:{key}"]
        while dq2 and dq2[0] <= now - 86400:
            dq2.popleft()
        if len(dq2) >= quota:
            raise APIError(
                429,
                "quota_exceeded",
                "سقف روزانهٔ استفاده از هوش مصنوعی تمام شد",
                details={"quota": quota},
            )
        dq2.append(now)


# ---------------------------------------------------------------------------
# ابزارهای مشترک
# ---------------------------------------------------------------------------


def _chunk_to_citation(
    ch: ScoredChunk, locale: str, excerpt_chars: int = 400
) -> dict[str, Any]:
    """chunk_id به‌صورت رشته ذخیره می‌شود تا در ستون JSON دیتابیس
    (و پاسخ API) قابل‌سریالایز باشد — Pydantic آن را به UUID برمی‌گرداند."""
    excerpt = ch.chunk_text[:excerpt_chars]
    if len(ch.chunk_text) > excerpt_chars:
        excerpt += "…"
    return {
        "chunk_id": str(ch.chunk_id),
        "excerpt": excerpt,
        "source_citation": ch.source_citation,
        "topic_category": ch.topic_category,
        "madhab_scope": ch.madhab_scope,
        "score": round(ch.score, 4),
    }


async def _get_or_create_session(
    db: AsyncSession,
    user: User | None,
    session_id: UUID | None,
    locale: str,
) -> FatwaSession:
    if session_id:
        sess = await db.get(FatwaSession, session_id)
        if sess:
            return sess
    sess = FatwaSession(user_id=user.id if user else None, locale=locale)
    db.add(sess)
    await db.flush()
    return sess


async def _log_usage(
    db: AsyncSession,
    *,
    user: User | None,
    endpoint: str,
    model: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_estimate: float = 0.0,
) -> None:
    db.add(
        AIUsageLog(
            user_id=user.id if user else None,
            endpoint=endpoint,
            model=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_estimate=cost_estimate,
        )
    )
    await db.flush()


# ---------------------------------------------------------------------------
# ask — بازیابی → لایه‌ها → provider یا fallback صادقانه
# ---------------------------------------------------------------------------


async def retrieve(
    db: AsyncSession,
    query: str,
    *,
    top_k: int = 5,
    ai_scope: str = "fatwa",
    topic_category: str | None = None,
    madhab_scope: str | None = None,
) -> list[ScoredChunk]:
    provider = await get_embedding_provider(db)
    index = ChunkIndex(provider)
    return await index.search(
        db,
        query,
        top_k=top_k,
        ai_scope=ai_scope,
        topic_category=topic_category,
        madhab_scope=madhab_scope,
    )


async def ask(
    db: AsyncSession,
    *,
    question: str,
    session_id: UUID | None,
    locale: str,
    top_k: int,
    user: User | None,
    client_ip: str | None,
) -> dict[str, Any]:
    """یک نوبت ask — خروجی dict برای مسیر JSON و SSE مشترک است."""
    await check_quota(db, user, client_ip, "fatwa.ask")

    sess = await _get_or_create_session(db, user, session_id, locale)
    db.add(
        FatwaMessage(session_id=sess.id, role="user", content=question)
    )
    await db.flush()
    await emit_event(
        db,
        aggregate_type="fatwa_session",
        aggregate_id=str(sess.id),
        event_type="fatwa.asked",
        payload={"locale": locale, "question_chars": len(question)},
    )

    chunks = await retrieve(db, question, top_k=top_k, ai_scope="fatwa")
    citations = [_chunk_to_citation(c, locale) for c in chunks]

    if not chunks:
        msg = FatwaMessage(
            session_id=sess.id,
            role="assistant",
            content=IDK_ANSWER.get(locale, IDK_ANSWER["fa"]),
            citations=[],
            status="no_sources",
        )
        db.add(msg)
        await db.flush()
        await _log_usage(db, user=user, endpoint="fatwa.ask", model="none")
        await emit_event(
            db,
            aggregate_type="fatwa_session",
            aggregate_id=str(sess.id),
            event_type="fatwa.answered",
            payload={"status": "no_sources", "citations": 0},
        )
        await db.commit()
        return {
            "session_id": sess.id,
            "answer": IDK_ANSWER.get(locale, IDK_ANSWER["fa"]),
            "status": "no_sources",
            "citations": [],
            "ai_label": AI_LABEL.get(locale, AI_LABEL["fa"]),
            "model": None,
            "layers": None,
            "provider": None,
            "chunks": chunks,
        }

    provider: LLMProvider | None = await resolve_provider(db)
    if provider is None:
        # مسیر graceful — هرگز متن ساخته‌شده (§۱۰، ADR-0005)
        db.add(
            FatwaMessage(
                session_id=sess.id,
                role="assistant",
                content=None,
                citations=citations,
                status="llm_unavailable",
            )
        )
        await db.flush()
        await _log_usage(db, user=user, endpoint="fatwa.ask", model="none")
        await emit_event(
            db,
            aggregate_type="fatwa_session",
            aggregate_id=str(sess.id),
            event_type="fatwa.answered",
            payload={"status": "llm_unavailable", "citations": len(citations)},
        )
        await db.commit()
        return {
            "session_id": sess.id,
            "answer": None,
            "status": "llm_unavailable",
            "citations": citations,
            "ai_label": AI_LABEL.get(locale, AI_LABEL["fa"]),
            "model": None,
            "note": UNAVAILABLE_NOTE.get(locale, UNAVAILABLE_NOTE["fa"]),
            "layers": None,
            "provider": None,
            "chunks": chunks,
        }

    layers = PromptLayers(
        system=SYSTEM_PROMPT,
        safety=SAFETY_PROMPT,
        context=build_context_block(chunks, locale),
        user_input=question,
    )
    timeout = await stream_timeout_s(db)
    result = await provider.generate(layers, timeout_s=timeout)
    db.add(
        FatwaMessage(
            session_id=sess.id,
            role="assistant",
            content=result.text,
            citations=citations,
            status="answered",
        )
    )
    await db.flush()
    await _log_usage(
        db,
        user=user,
        endpoint="fatwa.ask",
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )
    await emit_event(
        db,
        aggregate_type="fatwa_session",
        aggregate_id=str(sess.id),
        event_type="fatwa.answered",
        payload={
            "status": "answered",
            "citations": len(citations),
            "model": result.model,
        },
    )
    await db.commit()
    return {
        "session_id": sess.id,
        "answer": result.text,
        "status": "answered",
        "citations": citations,
        "ai_label": AI_LABEL.get(locale, AI_LABEL["fa"]),
        "model": result.model,
        "layers": layers,
        "provider": provider,
        "chunks": chunks,
    }


# ---------------------------------------------------------------------------
# categories / compare
# ---------------------------------------------------------------------------


async def list_categories(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(FiqhKnowledgeChunk.topic_category, func.count())
            .where(
                FiqhKnowledgeChunk.workflow_status.in_(_RAG_OK),
                FiqhKnowledgeChunk.topic_category.is_not(None),
            )
            .group_by(FiqhKnowledgeChunk.topic_category)
            .order_by(FiqhKnowledgeChunk.topic_category)
        )
    ).all()
    return [{"key": r[0], "count": r[1]} for r in rows]


async def compare_topic(db: AsyncSession, topic_id: UUID) -> dict[str, Any]:
    topic = await db.get(FiqhTopic, topic_id)
    if topic is None or topic.workflow_status not in _RAG_OK:
        raise APIError(404, "topic_not_found", "موضوع یافت نشد")
    positions = (
        await db.execute(
            select(MadhabPosition)
            .where(
                MadhabPosition.topic_id == topic_id,
                MadhabPosition.workflow_status.in_(_RAG_OK),
            )
            .order_by(MadhabPosition.madhab)
        )
    ).scalars().all()
    return {
        "topic_id": topic.id,
        "title": topic.title,
        "description": topic.description,
        "positions": [
            {
                "madhab": p.madhab,
                "position_text": p.position_text,
                "evidence_refs": p.evidence_refs,
            }
            for p in positions
        ],
    }


# ---------------------------------------------------------------------------
# quiz — فقط از پرسش‌های ریشه‌دار در chunk تأییدشده (ADR-0005)
# ---------------------------------------------------------------------------


async def quiz_generate(
    db: AsyncSession,
    user: User | None,
    *,
    count: int = 5,
    locale: str = "fa",
    client_ip: str | None = None,
) -> dict[str, Any]:
    await check_quota(db, user, client_ip, "fatwa.quiz")
    count = max(1, min(count, 20))
    questions = (
        await db.execute(
            select(QuizQuestion, FiqhKnowledgeChunk)
            .join(
                FiqhKnowledgeChunk,
                QuizQuestion.source_chunk_id == FiqhKnowledgeChunk.id,
            )
            .where(
                QuizQuestion.workflow_status.in_(_RAG_OK),
                FiqhKnowledgeChunk.workflow_status.in_(_RAG_OK),
            )
            .order_by(func.random())
            .limit(count)
        )
    ).all()
    if not questions:
        raise APIError(
            404, "no_quiz_questions", "سؤال تأییدشده‌ای برای آزمون موجود نیست"
        )
    attempt = QuizAttempt(
        user_id=user.id if user else None,
        question_ids=[str(q.id) for q, _ in questions],
        answers={},
        score=0.0,
    )
    db.add(attempt)
    await db.flush()
    await _log_usage(db, user=user, endpoint="fatwa.quiz", model="none")
    await db.commit()
    return {
        "attempt_id": attempt.id,
        "questions": [
            {
                "id": q.id,
                "question_text": q.question_text,
                "options": q.options,
                "difficulty": q.difficulty,
                "source_citation": chunk.source_citation,
            }
            for q, chunk in questions
        ],
    }


async def quiz_submit(
    db: AsyncSession,
    user: User | None,
    *,
    attempt_id: UUID,
    answers: dict[str, int],
) -> dict[str, Any]:
    attempt = await db.get(QuizAttempt, attempt_id)
    if attempt is None:
        raise APIError(404, "attempt_not_found", "تلاش آزمون یافت نشد")
    if user and attempt.user_id and attempt.user_id != user.id:
        raise APIError(403, "forbidden", "این تلاش متعلق به شما نیست")
    qids = [UUID(q) for q in attempt.question_ids]
    questions = (
        await db.execute(select(QuizQuestion).where(QuizQuestion.id.in_(qids)))
    ).scalars().all()
    by_id = {str(q.id): q for q in questions}
    correct = 0
    details: list[dict[str, Any]] = []
    for qid in attempt.question_ids:
        q = by_id.get(qid)
        if q is None:
            continue
        given = answers.get(qid)
        ok = given == q.correct_option
        correct += 1 if ok else 0
        details.append(
            {
                "question_id": qid,
                "given": given,
                "correct_option": q.correct_option,
                "is_correct": ok,
            }
        )
    total = len(details)
    attempt.answers = answers
    attempt.score = (correct / total * 100.0) if total else 0.0
    await db.flush()
    await db.commit()
    return {
        "score": round(attempt.score, 2),
        "total": total,
        "correct": correct,
        "details": details,
    }


async def quiz_question_create(
    db: AsyncSession,
    user: User,
    *,
    question_text: dict,
    options: list[dict],
    correct_option: int,
    source_chunk_id: UUID,
    difficulty: str,
) -> QuizQuestion:
    """ثبت سؤال توسط انسانِ مجاز — chunk مرجع باید approved/published با
    scope=quiz باشد؛ در غیر این صورت ۴۲۲ (نه تولید خودکار از LLM)."""
    chunk = await db.get(FiqhKnowledgeChunk, source_chunk_id)
    if chunk is None:
        raise APIError(404, "chunk_not_found", "chunk مرجع یافت نشد")
    if chunk.workflow_status not in _RAG_OK or "quiz" not in (chunk.ai_scopes or []):
        raise APIError(
            422,
            "chunk_not_quiz_eligible",
            "سؤال فقط می‌تواند به chunk تأییدشده با scope=quiz بچسبد",
        )
    if not (0 <= correct_option < len(options)):
        raise APIError(422, "bad_correct_option", "گزینهٔ صحیح خارج از بازه است")
    q = QuizQuestion(
        question_text=question_text,
        options=options,
        correct_option=correct_option,
        source_chunk_id=source_chunk_id,
        difficulty=difficulty,
        workflow_status="draft",
    )
    db.add(q)
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="quiz.question_created",
        entity_type="quiz_question",
        entity_id=str(q.id),
        new_values={"source_chunk_id": str(source_chunk_id)},
    )
    await db.commit()
    return q


# ---------------------------------------------------------------------------
# verify — راستی‌آزمایی متن پیست‌شده علیه محتوای منتشرشده
# ---------------------------------------------------------------------------

_VERIFY_VERIFIED_THRESHOLD = 0.95
_VERIFY_FOUND_THRESHOLD = 0.5


async def verify_check(
    db: AsyncSession, text_value: str, *, top_k: int = 3
) -> dict[str, Any]:
    input_hash = hashlib.sha256(text_value.encode("utf-8")).hexdigest()
    cached = (
        await db.execute(
            select(VerificationCheck)
            .where(VerificationCheck.input_hash == input_hash)
            .order_by(VerificationCheck.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if cached:
        # بازسازی استنادها از chunkهای ذخیره‌شده (نه فقط شناسه)
        from app.models.models import FiqhKnowledgeChunk

        cached_chunks = []
        for cid in cached.matched_chunk_ids:
            c = await db.get(FiqhKnowledgeChunk, UUID(cid))
            if c is not None:
                cached_chunks.append(
                    ScoredChunk(
                        chunk_id=c.id,
                        chunk_text=c.chunk_text,
                        source_citation=c.source_citation,
                        topic_category=c.topic_category,
                        madhab_scope=c.madhab_scope,
                        score=0.0,
                        lexical=0.0,
                        semantic=0.0,
                        matched_scopes=c.ai_scopes or [],
                    )
                )
        return {
            "verdict": cached.verdict,
            "matched": [_chunk_to_citation(c, "fa") for c in cached_chunks],
            "note": "نتیجهٔ کش‌شده",
        }

    chunks = await retrieve(
        db, text_value, top_k=top_k, ai_scope="verification"
    )
    if not chunks or chunks[0].score < _VERIFY_FOUND_THRESHOLD:
        verdict = "not_found"
        matched: list[ScoredChunk] = chunks[:1]
        note = "در محتوای منتشرشده مورد مشابهی یافت نشد"
    elif chunks[0].score >= _VERIFY_VERIFIED_THRESHOLD:
        verdict = "verified"
        matched = [chunks[0]]
        note = "متن با محتوای منتشرشده و منبع‌دار مطابقت دارد"
    else:
        # هیوریستیک مستند «conflicting»: دو نزدیک‌ترین نامزد از یک
        # topic_category ولی با محتوای کم‌شباهت به هم → سیگنال تعارض احتمالی
        # که باید انسان بررسی کند.
        verdict = "not_found"
        matched = chunks[:2]
        note = "مورد مشابهی یافت نشد"
        if len(chunks) >= 2 and chunks[0].topic_category and (
            chunks[0].topic_category == chunks[1].topic_category
        ):
            provider = await get_embedding_provider(db)
            vecs = await provider.embed(
                [chunks[0].chunk_text, chunks[1].chunk_text]
            )
            if cosine_similarity(vecs[0], vecs[1]) < 0.6:
                verdict = "conflicting"
                note = (
                    "متن ورودی به دو منبع هم‌موضوع ولی ناهمسو نزدیک است؛ "
                    "نیازمند بررسی انسانی"
                )

    record = VerificationCheck(
        input_hash=input_hash,
        input_excerpt=text_value[:512],
        verdict=verdict,
        matched_chunk_ids=[str(c.chunk_id) for c in matched],
    )
    db.add(record)
    await db.flush()
    await db.commit()
    return {
        "verdict": verdict,
        "matched": [_chunk_to_citation(c, "fa") for c in matched],
        "note": note,
    }


# ---------------------------------------------------------------------------
# admin: chunks
# ---------------------------------------------------------------------------


async def chunk_list(
    db: AsyncSession,
    *,
    status: str | None = None,
    topic_category: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[FiqhKnowledgeChunk], str | None]:
    stmt = select(FiqhKnowledgeChunk).order_by(FiqhKnowledgeChunk.created_at.desc())
    if status:
        stmt = stmt.where(FiqhKnowledgeChunk.workflow_status == status)
    if topic_category:
        stmt = stmt.where(FiqhKnowledgeChunk.topic_category == topic_category)
    if cursor:
        stmt = stmt.where(FiqhKnowledgeChunk.id < UUID(cursor))
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = str(rows[-1].id) if len(rows) > limit else None
    return list(rows[:limit]), next_cursor


async def chunk_create(
    db: AsyncSession,
    user: User,
    *,
    chunk_text: str,
    source_type: str,
    source_ref: dict | None,
    source_citation: dict | None,
    topic_category: str | None,
    madhab_scope: str | None,
    ai_scopes: list[str],
) -> FiqhKnowledgeChunk:
    bad = [s for s in ai_scopes if s not in AI_SCOPES]
    if bad:
        raise APIError(422, "bad_ai_scopes", f"scope نامعتبر: {bad}")
    provider = await get_embedding_provider(db)
    vector = (await provider.embed([chunk_text]))[0]
    chunk = FiqhKnowledgeChunk(
        chunk_text=chunk_text,
        embedding=list(vector),
        source_type=source_type,
        source_ref=source_ref,
        source_citation=source_citation,
        topic_category=topic_category,
        madhab_scope=madhab_scope,
        workflow_status="draft",
        ai_scopes=ai_scopes,
    )
    db.add(chunk)
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="fatwa.chunk_created",
        entity_type="fiqh_knowledge_chunk",
        entity_id=str(chunk.id),
        new_values={"topic_category": topic_category, "ai_scopes": ai_scopes},
    )
    await emit_event(
        db,
        aggregate_type="fiqh_knowledge_chunk",
        aggregate_id=str(chunk.id),
        event_type="fatwa.chunk_created",
        payload={"topic_category": topic_category},
    )
    await db.commit()
    return chunk


async def chunk_set_status(
    db: AsyncSession, user: User, chunk_id: UUID, target: str
) -> FiqhKnowledgeChunk:
    chunk = await db.get(FiqhKnowledgeChunk, chunk_id)
    if chunk is None:
        raise APIError(404, "chunk_not_found", "chunk یافت نشد")
    _workflow.validate_transition(chunk.workflow_status, target)
    old = chunk.workflow_status
    chunk.workflow_status = target
    if target in _RAG_OK:
        chunk.approved_by = user.id
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="fatwa.chunk_status_changed",
        entity_type="fiqh_knowledge_chunk",
        entity_id=str(chunk.id),
        old_values={"workflow_status": old},
        new_values={"workflow_status": target},
    )
    await emit_event(
        db,
        aggregate_type="fiqh_knowledge_chunk",
        aggregate_id=str(chunk.id),
        event_type="fatwa.chunk_approved" if target in _RAG_OK else "fatwa.chunk_status_changed",
        payload={"from": old, "to": target},
    )
    await db.commit()
    return chunk


# ---------------------------------------------------------------------------
# admin: topics / positions
# ---------------------------------------------------------------------------


async def topic_create(
    db: AsyncSession, user: User, *, title: dict, description: dict | None
) -> FiqhTopic:
    topic = FiqhTopic(title=title, description=description, workflow_status="draft")
    db.add(topic)
    await db.flush()
    await db.commit()
    return topic


async def topic_set_status(
    db: AsyncSession, user: User, topic_id: UUID, target: str
) -> FiqhTopic:
    topic = await db.get(FiqhTopic, topic_id)
    if topic is None:
        raise APIError(404, "topic_not_found", "موضوع یافت نشد")
    _workflow.validate_transition(topic.workflow_status, target)
    topic.workflow_status = target
    await db.flush()
    await db.commit()
    return topic


async def position_create(
    db: AsyncSession,
    user: User,
    topic_id: UUID,
    *,
    madhab: str,
    position_text: dict,
    evidence_refs: list | None,
) -> MadhabPosition:
    topic = await db.get(FiqhTopic, topic_id)
    if topic is None:
        raise APIError(404, "topic_not_found", "موضوع یافت نشد")
    pos = MadhabPosition(
        topic_id=topic_id,
        madhab=madhab,
        position_text=position_text,
        evidence_refs=evidence_refs,
        workflow_status="draft",
    )
    db.add(pos)
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="fatwa.position_created",
        entity_type="madhab_position",
        entity_id=str(pos.id),
        new_values={"topic_id": str(topic_id), "madhab": madhab},
    )
    await db.commit()
    return pos


async def position_set_status(
    db: AsyncSession, user: User, position_id: UUID, target: str
) -> MadhabPosition:
    pos = await db.get(MadhabPosition, position_id)
    if pos is None:
        raise APIError(404, "position_not_found", "موضع یافت نشد")
    _workflow.validate_transition(pos.workflow_status, target)
    pos.workflow_status = target
    await db.flush()
    await db.commit()
    return pos


# ---------------------------------------------------------------------------
# admin: ingestion trigger
# ---------------------------------------------------------------------------


async def trigger_ingestion(
    db: AsyncSession,
    user: User,
    *,
    source_type: str,
    payload: dict[str, Any],
    topic_category: str | None,
    madhab_scope: str | None,
    ai_scopes: list[str],
    source_citation: dict | None,
) -> IngestionRun:
    bad = [s for s in ai_scopes if s not in AI_SCOPES]
    if bad:
        raise APIError(422, "bad_ai_scopes", f"scope نامعتبر: {bad}")
    run = IngestionRun(
        source_type=source_type,
        status="queued",
        stats={
            "run_config": {
                "payload": payload,
                "topic_category": topic_category,
                "madhab_scope": madhab_scope,
                "ai_scopes": ai_scopes,
                "source_citation": source_citation,
                "triggered_by": str(user.id),
            }
        },
    )
    db.add(run)
    await db.flush()
    await db.commit()

    # تلاش برای صف ARQ — اگر Redis در دسترس نبود، run در حالت queued می‌ماند
    # و ورکر `ai` بعداً آن را برمی‌دارد (ثبت در stats).
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        from app.core.config import get_settings

        pool = await create_pool(
            RedisSettings.from_dsn(get_settings().redis_url)
        )
        await pool.enqueue_job(
            "ingest_knowledge_run", str(run.id), _queue_name="ai"
        )
        await pool.close()
        enqueued = True
    except Exception:  # noqa: BLE001 — worker آفلاین؛ run صف می‌ماند
        enqueued = False
    run.stats = {**(run.stats or {}), "enqueued": enqueued}
    await db.flush()
    await db.commit()
    await emit_event(
        db,
        aggregate_type="ingestion_run",
        aggregate_id=str(run.id),
        event_type="ingestion.run_triggered",
        payload={"source_type": source_type, "enqueued": enqueued},
    )
    await db.commit()
    return run


async def ingestion_run_get(db: AsyncSession, run_id: UUID) -> IngestionRun:
    run = await db.get(IngestionRun, run_id)
    if run is None:
        raise APIError(404, "run_not_found", "اجرای درون‌ریزی یافت نشد")
    return run


# ---------------------------------------------------------------------------
# admin: trusted external sources (فقط super_admin — §۹.۶)
# ---------------------------------------------------------------------------


def _domain_of(base_url: str) -> str | None:
    from urllib.parse import urlparse

    try:
        return urlparse(base_url).hostname
    except Exception:  # noqa: BLE001
        return None


async def trusted_source_create(
    db: AsyncSession, user: User, **fields: Any
) -> TrustedExternalSource:
    src = TrustedExternalSource(
        domain=_domain_of(fields["base_url"]), **fields
    )
    db.add(src)
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="fatwa.trusted_source_created",
        entity_type="trusted_external_source",
        entity_id=str(src.id),
        new_values={"name": src.name, "base_url": src.base_url},
    )
    await db.commit()
    return src


async def trusted_source_list(db: AsyncSession) -> list[TrustedExternalSource]:
    return (
        await db.execute(
            select(TrustedExternalSource).order_by(
                TrustedExternalSource.priority.desc(),
                TrustedExternalSource.name,
            )
        )
    ).scalars().all()


async def trusted_source_update(
    db: AsyncSession, user: User, source_id: UUID, fields: dict[str, Any]
) -> TrustedExternalSource:
    src = await db.get(TrustedExternalSource, source_id)
    if src is None:
        raise APIError(404, "source_not_found", "منبع یافت نشد")
    allowed = {"name", "base_url", "enabled", "allowed_paths", "priority",
               "citation_required"}
    old = {k: getattr(src, k) for k in allowed if k in fields}
    for k, v in fields.items():
        if k in allowed:
            setattr(src, k, v)
    if "base_url" in fields:
        src.domain = _domain_of(fields["base_url"])
    src.last_checked_at = datetime.now(UTC)
    await db.flush()
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="fatwa.trusted_source_updated",
        entity_type="trusted_external_source",
        entity_id=str(src.id),
        old_values=old,
        new_values={k: fields[k] for k in allowed if k in fields},
    )
    await db.commit()
    return src


async def trusted_source_delete(
    db: AsyncSession, user: User, source_id: UUID
) -> None:
    src = await db.get(TrustedExternalSource, source_id)
    if src is None:
        raise APIError(404, "source_not_found", "منبع یافت نشد")
    await log_audit(
        db,
        actor_id=user.id,
        actor_type="user",
        action="fatwa.trusted_source_deleted",
        entity_type="trusted_external_source",
        entity_id=str(src.id),
        old_values={"name": src.name, "base_url": src.base_url},
    )
    await db.delete(src)
    await db.commit()


# ---------------------------------------------------------------------------
# admin: audit
# ---------------------------------------------------------------------------

_FATWA_ENTITY_TYPES = {
    "fiqh_knowledge_chunk",
    "fiqh_topic",
    "madhab_position",
    "quiz_question",
    "trusted_external_source",
    "fatwa_session",
}


async def fatwa_audit_list(
    db: AsyncSession, *, limit: int = 50, cursor: str | None = None
) -> tuple[list, str | None]:
    from app.models.models import AuditLog

    stmt = (
        select(AuditLog)
        .where(AuditLog.entity_type.in_(_FATWA_ENTITY_TYPES))
        .order_by(AuditLog.created_at.desc())
    )
    if cursor:
        stmt = stmt.where(AuditLog.id < UUID(cursor))
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = str(rows[-1].id) if len(rows) > limit else None
    return list(rows[:limit]), next_cursor
