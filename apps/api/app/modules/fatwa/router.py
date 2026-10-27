"""روتر فاز ۶ — فتوا / مقایسهٔ مذاهب / آزمون / راستی‌آزمایی.

فقط سیم‌کشی؛ منطق در service.py (§۱۵.۶).
- عمومی (rate-limited): ask (+SSE با ?stream=true)، categories،
  compare، quiz generate/submit، verify.
- ادمین: chunks/topics/positions (fatwa.approve یا knowledge.manage)،
  ingest، quiz question، trusted-sources (فقط super_admin)، audit.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import APIError
from app.models.models import TrustedExternalSource, User
from app.modules.auth.dependencies import (
    get_current_user,
    require_permission,
)

from . import service
from .schemas import (
    AskIn,
    AskOut,
    AuditEntryOut,
    CategoryIn,
    CategoryOut,
    ChunkCreateIn,
    ChunkOut,
    ChunkStatusIn,
    CitationOut,
    CompareOut,
    FatwaCategoryOut,
    IngestionRunOut,
    IngestTriggerIn,
    IngestTriggerOut,
    PositionCreateIn,
    PositionOut,
    PublicCategoryWithCountOut,
    PublicTopicCategoryOut,
    PublicTopicDetailOut,
    PublicTopicListOut,
    PublicTopicOut,
    QuizGenerateOut,
    QuizQuestionCreateIn,
    QuizQuestionOut,
    QuizSubmitIn,
    QuizSubmitOut,
    ShareOut,
    TopicCreateIn,
    TopicOut,
    TopicUpdateIn,
    TrustedSourceIn,
    TrustedSourceOut,
    VerifyIn,
    VerifyOut,
)

fatwa_router = APIRouter(prefix="/api/v1/fatwa", tags=["fatwa"])
verify_router = APIRouter(prefix="/api/v1/verify", tags=["verify"])
admin_fatwa_router = APIRouter(prefix="/api/v1/admin/fatwa", tags=["admin-fatwa"])

_can_approve = require_permission("fatwa.approve")
_can_knowledge = require_permission("knowledge.manage")
_super_admin = require_permission("platform.settings")

# get_current_user اختیاری — ask عمومی برای ناشناس هم باز است
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

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


def _client_ip(request: Request) -> str | None:
    if request.client:
        return request.client.host
    return None


def _ask_out(result: dict) -> AskOut:
    return AskOut(
        session_id=result["session_id"],
        answer=result["answer"],
        status=result["status"],
        citations=[CitationOut(**c) for c in result["citations"]],
        ai_label=result["ai_label"],
        model=result["model"],
    )


# --- عمومی ---


@fatwa_router.post("/ask", response_model=AskOut)
async def ask(
    body: AskIn,
    request: Request,
    stream: bool = Query(default=False, description="true → پاسخ SSE"),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """پرسش فتوا — grounded روی دانش تأییدشده؛ بدون LLM، منابع + وضعیت
    llm_unavailable برمی‌گردد (هرگز متن ساخته‌شده)."""
    if stream:
        return StreamingResponse(
            _ask_sse(request, db, body, user),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    result = await service.ask(
        db,
        question=body.question,
        session_id=body.session_id,
        locale=body.locale,
        top_k=body.top_k,
        user=user,
        client_ip=_client_ip(request),
    )
    return _ask_out(result)


async def _ask_sse(request: Request, db: AsyncSession, body: AskIn, user):
    """استریم SSE — لغو با قطع اتصال کلاینت (is_disconnected).

    در پایان استریم توکن‌ها، یک رویداد پایانی با کل payload ‏AskOut
    (citations/status/ai_label) ارسال می‌شود تا کلاینت وب کارت‌های استناد
    را زیر پاسخ استریم‌شده نشان دهد؛ سپس [DONE].
    """
    result = await service.ask(
        db,
        question=body.question,
        session_id=body.session_id,
        locale=body.locale,
        top_k=body.top_k,
        user=user,
        client_ip=request.client.host if request.client else None,
    )
    provider = result.get("provider")
    layers = result.get("layers")
    if provider is not None and layers is not None:
        ok = True
        try:
            async for piece in provider.generate_stream(layers):
                if await request.is_disconnected():
                    ok = False
                    break
                yield f"data: {json.dumps({'type': 'token', 'token': piece}, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 — خطای provider وسط استریم
            ok = False
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)}, ensure_ascii=False)}\n\n"
        if ok and not await request.is_disconnected():
            final = _ask_out(result).model_dump(mode="json")
            final["type"] = "final"
            yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
    else:
        # مسیر graceful: کل payload یکجا
        payload = _ask_out(result).model_dump(mode="json")
        payload["type"] = "final"
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


@fatwa_router.get("/categories", response_model=list[CategoryOut])
async def categories(db: AsyncSession = Depends(get_db)):
    """دسته‌بندی‌های موضوعی دانش تأییدشده."""
    return [CategoryOut(**c) for c in await service.list_categories(db)]


# --- عمومی: فهرست وردپرسی فتوا (فقط منتشرشده‌ها) ---
# ترتیب مهم است: /topics/categories باید پیش از /topics/{id} ثبت شود
# تا «categories» به‌عنوان شناسه بلعیده نشود.


def _public_topic_out(d: dict) -> PublicTopicOut:
    cat = d.get("category")
    return PublicTopicOut(
        id=d["id"],
        title=d["title"],
        description=d.get("description"),
        category=PublicTopicCategoryOut(**cat) if cat else None,
        author_name=d.get("author_name"),
        featured_image_url=d.get("featured_image_url"),
        published_at=d.get("published_at"),
        view_count=d.get("view_count") or 0,
        share_count=d.get("share_count") or 0,
    )


@fatwa_router.get("/topics", response_model=PublicTopicListOut)
async def public_topic_list(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=10, ge=1, le=100),
    q: str | None = Query(default=None),
    category: str | None = Query(default=None, description="slug دسته"),
    sort: str = Query(default="newest", pattern="^(newest|views)$"),
    exclude: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """فهرست منتشرشده‌ها — بدون سقف کلی، همه با صفحه‌بندی در دسترس‌اند."""
    data = await service.topic_public_list(
        db, page=page, per_page=per_page, q=q, category=category,
        sort=sort, exclude=exclude,
    )
    return PublicTopicListOut(
        items=[_public_topic_out(d) for d in data["items"]],
        total=data["total"],
        page=data["page"],
        per_page=data["per_page"],
        pages=data["pages"],
    )


@fatwa_router.get("/topics/categories", response_model=list[PublicCategoryWithCountOut])
async def public_topic_categories(db: AsyncSession = Depends(get_db)):
    """دسته‌های فتوا + تعداد فتواهای منتشرشدهٔ هر دسته.

    با /fatwa/categories فرق دارد: آن یکی از چانک‌های دانش ساخته
    می‌شود و دست نخورده می‌ماند؛ این یکی از دسته‌های ثبت‌شده در CRM
    و موضوع‌های منتشرشده است. اگر فتوای منتشرشدهٔ بدون دسته باشد،
    یک ردیف «بدون دسته» هم با همان تعداد در انتها می‌آید تا جمع
    تعدادها با total فهرست برابر شود.
    """
    rows = await service.category_list_with_published_counts(db)
    out = [
        PublicCategoryWithCountOut(
            id=r["category"].id,
            slug=r["category"].slug,
            title=r["category"].title,
            created_at=r["category"].created_at,
            published_count=r["published_count"],
        )
        for r in rows
    ]
    uncategorized = await service.count_published_without_category(db)
    if uncategorized > 0:
        out.append(
            PublicCategoryWithCountOut(
                id=None,
                slug=service.UNCATEGORIZED_SLUG,
                title={
                    "fa": "بدون دسته",
                    "ar": "غير مصنّف",
                    "en": "Uncategorized",
                },
                created_at=None,
                published_count=uncategorized,
            )
        )
    return out


@fatwa_router.get("/topics/{topic_id}", response_model=PublicTopicDetailOut)
async def public_topic_detail(
    topic_id: UUID, db: AsyncSession = Depends(get_db)
):
    """جزئیات یک فتوای منتشرشده — هر فراخوانی یک بازدید می‌شمارد."""
    data = await service.topic_public_get(db, topic_id)
    out = _public_topic_out(data)
    return PublicTopicDetailOut(
        **out.model_dump(),
        positions=[PositionOut(**p) for p in data["positions"]],
    )


@fatwa_router.post("/topics/{topic_id}/share", response_model=ShareOut)
async def public_topic_share(
    topic_id: UUID, db: AsyncSession = Depends(get_db)
):
    """ثبت یک اشتراک‌گذاری — فقط منتشرشده؛ شمارندهٔ تازه برمی‌گردد."""
    t = await service.topic_share(db, topic_id)
    return ShareOut(id=t.id, share_count=t.share_count or 0)


@fatwa_router.get("/compare/{topic_id}", response_model=CompareOut)
async def compare(topic_id: UUID, db: AsyncSession = Depends(get_db)):
    """مقایسهٔ مواضع مذاهب دربارهٔ یک موضوع — فقط محتوای تأییدشده."""
    data = await service.compare_topic(db, topic_id)
    return CompareOut(
        topic_id=data["topic_id"],
        title=data["title"],
        description=data["description"],
        positions=[PositionOut(**p) for p in data["positions"]],
    )


@fatwa_router.post("/quiz/generate", response_model=QuizGenerateOut)
async def quiz_generate(
    request: Request,
    count: int = Query(default=5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """ساخت آزمون — فقط از سؤال‌های ریشه‌دار در chunk تأییدشده."""
    ip = request.client.host if request.client else None
    data = await service.quiz_generate(db, user, count=count, client_ip=ip)
    return QuizGenerateOut(
        attempt_id=data["attempt_id"],
        questions=[QuizQuestionOut(**q) for q in data["questions"]],
    )


@fatwa_router.post("/quiz/submit", response_model=QuizSubmitOut)
async def quiz_submit(
    body: QuizSubmitIn,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(_optional_user),
):
    """ثبت پاسخ‌های آزمون و نمره."""
    data = await service.quiz_submit(
        db, user, attempt_id=body.attempt_id, answers=body.answers
    )
    return QuizSubmitOut(**data)


@verify_router.post("/check", response_model=VerifyOut)
async def verify_check(
    body: VerifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """راستی‌آزمایی متن پیست‌شده علیه محتوای منتشرشده."""
    data = await service.verify_check(db, body.text)
    return VerifyOut(
        verdict=data["verdict"],
        matched=[CitationOut(**c) for c in data["matched"]],
        note=data["note"],
    )


# --- ادمین: chunks ---


@admin_fatwa_router.get("/chunks", response_model=dict)
async def chunk_list(
    status: str | None = Query(default=None),
    topic_category: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    after: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    items, next_cursor = await service.chunk_list(
        db, status=status, topic_category=topic_category, limit=limit,
        cursor=after,
    )
    return {
        "items": [ChunkOut(**_chunk_dict(c)).model_dump(mode="json") for c in items],
        "next_cursor": next_cursor,
    }


def _chunk_dict(c) -> dict:
    return {
        "id": c.id,
        "chunk_text": c.chunk_text,
        "source_type": c.source_type,
        "source_ref": c.source_ref,
        "source_citation": c.source_citation,
        "topic_category": c.topic_category,
        "madhab_scope": c.madhab_scope,
        "workflow_status": c.workflow_status,
        "ai_scopes": c.ai_scopes or [],
        "created_at": c.created_at,
    }


@admin_fatwa_router.post("/chunks", response_model=ChunkOut, status_code=201)
async def chunk_create(
    body: ChunkCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    c = await service.chunk_create(
        db, user,
        chunk_text=body.chunk_text,
        source_type=body.source_type,
        source_ref=body.source_ref,
        source_citation=body.source_citation,
        topic_category=body.topic_category,
        madhab_scope=body.madhab_scope,
        ai_scopes=body.ai_scopes,
    )
    return ChunkOut(**_chunk_dict(c))


@admin_fatwa_router.patch("/chunks/{chunk_id}/status", response_model=ChunkOut)
async def chunk_set_status(
    chunk_id: UUID,
    body: ChunkStatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_approve),
):
    c = await service.chunk_set_status(db, user, chunk_id, body.status)
    return ChunkOut(**_chunk_dict(c))


# --- ادمین: ingestion ---


@admin_fatwa_router.post("/ingest", response_model=IngestTriggerOut, status_code=202)
async def ingest_trigger(
    body: IngestTriggerIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    run = await service.trigger_ingestion(
        db, user,
        source_type=body.source_type,
        payload=body.payload,
        topic_category=body.topic_category,
        madhab_scope=body.madhab_scope,
        ai_scopes=body.ai_scopes,
        source_citation=body.source_citation,
    )
    return IngestTriggerOut(run_id=run.id, status=run.status)


@admin_fatwa_router.get("/ingest/{run_id}", response_model=IngestionRunOut)
async def ingest_status(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    run = await service.ingestion_run_get(db, run_id)
    return IngestionRunOut(
        id=run.id,
        source_type=run.source_type,
        status=run.status,
        stats=run.stats or {},
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


# --- ادمین: topics / positions ---


def _topic_out(t) -> TopicOut:
    return TopicOut(
        id=t.id, title=t.title, description=t.description,
        workflow_status=t.workflow_status,
        category_id=t.category_id,
        author_name=t.author_name,
        featured_image_url=t.featured_image_url,
        view_count=t.view_count or 0,
        share_count=t.share_count or 0,
        published_at=t.published_at,
    )


@admin_fatwa_router.post("/topics", response_model=TopicOut, status_code=201)
async def topic_create(
    body: TopicCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    t = await service.topic_create(
        db, user, title=body.title, description=body.description,
        category_id=body.category_id, author_name=body.author_name,
        featured_image_url=body.featured_image_url,
    )
    return _topic_out(t)


@admin_fatwa_router.patch("/topics/{topic_id}/status", response_model=TopicOut)
async def topic_set_status(
    topic_id: UUID,
    body: ChunkStatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_approve),
):
    t = await service.topic_set_status(db, user, topic_id, body.status)
    return _topic_out(t)


@admin_fatwa_router.get("/topics", response_model=dict)
async def topic_admin_list(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=100),
    q: str | None = Query(default=None),
    category: str | None = Query(default=None, description="slug دسته"),
    status: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    """فهرست ادمین — همهٔ وضعیت‌ها، با صفحه‌بندی و فیلترها."""
    data = await service.topic_admin_list(
        db, page=page, per_page=per_page, q=q, category=category,
        status=status,
    )
    items = []
    for d in data["items"]:
        cat = d.get("category")
        items.append({
            **d,
            "category": PublicTopicCategoryOut(**cat).model_dump(mode="json") if cat else None,
        })
    return {
        "items": items,
        "total": data["total"],
        "page": data["page"],
        "per_page": data["per_page"],
        "pages": data["pages"],
    }


@admin_fatwa_router.put("/topics/{topic_id}", response_model=TopicOut)
async def topic_update(
    topic_id: UUID,
    body: TopicUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    """ویرایش موضوع — دقیقاً PUT، چون CRM از قبل PUT صدا می‌زند."""
    t = await service.topic_update(
        db, user, topic_id, title=body.title, description=body.description,
        category_id=body.category_id, author_name=body.author_name,
        featured_image_url=body.featured_image_url,
    )
    return _topic_out(t)


# --- ادمین: دسته‌ها ---


def _category_out(c) -> FatwaCategoryOut:
    return FatwaCategoryOut(
        id=c.id, slug=c.slug, title=c.title, created_at=c.created_at
    )


@admin_fatwa_router.get("/categories", response_model=list[FatwaCategoryOut])
async def admin_category_list(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    return [_category_out(c) for c in await service.category_list(db)]


@admin_fatwa_router.post("/categories", response_model=FatwaCategoryOut, status_code=201)
async def admin_category_create(
    body: CategoryIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    c = await service.category_create(db, user, slug=body.slug, title=body.title)
    return _category_out(c)


@admin_fatwa_router.put("/categories/{category_id}", response_model=FatwaCategoryOut)
async def admin_category_update(
    category_id: UUID,
    body: CategoryIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    c = await service.category_update(
        db, user, category_id, slug=body.slug, title=body.title
    )
    return _category_out(c)


@admin_fatwa_router.delete("/categories/{category_id}", status_code=204)
async def admin_category_delete(
    category_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    await service.category_delete(db, user, category_id)


@admin_fatwa_router.post(
    "/topics/{topic_id}/positions", response_model=dict, status_code=201
)
async def position_create(
    topic_id: UUID,
    body: PositionCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    p = await service.position_create(
        db, user, topic_id,
        madhab=body.madhab,
        position_text=body.position_text,
        evidence_refs=body.evidence_refs,
    )
    return {
        "id": str(p.id),
        "madhab": p.madhab,
        "workflow_status": p.workflow_status,
    }


@admin_fatwa_router.post("/positions", response_model=dict, status_code=201)
async def position_create_flat(
    body: PositionCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    """مسیر تخت برای CRM — topic_id در body می‌آید."""
    if body.topic_id is None:
        raise APIError(422, "topic_id_required", "topic_id در body الزامی است")
    p = await service.position_create(
        db, user, body.topic_id,
        madhab=body.madhab,
        position_text=body.position_text,
        evidence_refs=body.evidence_refs,
    )
    return {
        "id": str(p.id),
        "topic_id": str(p.topic_id),
        "madhab": p.madhab,
        "workflow_status": p.workflow_status,
    }


@admin_fatwa_router.patch("/positions/{position_id}/status", response_model=dict)
async def position_set_status(
    position_id: UUID,
    body: ChunkStatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_approve),
):
    p = await service.position_set_status(db, user, position_id, body.status)
    return {"id": str(p.id), "workflow_status": p.workflow_status}


# --- ادمین: quiz questions ---


@admin_fatwa_router.post("/quiz/questions", response_model=dict, status_code=201)
async def quiz_question_create(
    body: QuizQuestionCreateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    q = await service.quiz_question_create(
        db, user,
        question_text=body.question_text,
        options=body.options,
        correct_option=body.correct_option,
        source_chunk_id=body.source_chunk_id,
        difficulty=body.difficulty,
    )
    return {"id": str(q.id), "workflow_status": q.workflow_status}


# --- ادمین: trusted sources (فقط super_admin — §۹.۶) ---


@admin_fatwa_router.get("/trusted-sources", response_model=list[TrustedSourceOut])
async def trusted_source_list(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_super_admin),
):
    return [
        TrustedSourceOut(
            id=s.id, name=s.name, base_url=s.base_url, domain=s.domain,
            enabled=s.enabled, allowed_paths=s.allowed_paths or [],
            priority=s.priority, citation_required=s.citation_required,
            last_checked_at=s.last_checked_at,
        )
        for s in await service.trusted_source_list(db)
    ]


@admin_fatwa_router.post(
    "/trusted-sources", response_model=TrustedSourceOut, status_code=201
)
async def trusted_source_create(
    body: TrustedSourceIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_super_admin),
):
    s = await service.trusted_source_create(db, user, **body.model_dump())
    return TrustedSourceOut(
        id=s.id, name=s.name, base_url=s.base_url, domain=s.domain,
        enabled=s.enabled, allowed_paths=s.allowed_paths or [],
        priority=s.priority, citation_required=s.citation_required,
        last_checked_at=s.last_checked_at,
    )


@admin_fatwa_router.patch("/trusted-sources/{source_id}", response_model=TrustedSourceOut)
async def trusted_source_update(
    source_id: UUID,
    body: TrustedSourceIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_super_admin),
):
    s = await service.trusted_source_update(db, user, source_id, body.model_dump())
    return TrustedSourceOut(
        id=s.id, name=s.name, base_url=s.base_url, domain=s.domain,
        enabled=s.enabled, allowed_paths=s.allowed_paths or [],
        priority=s.priority, citation_required=s.citation_required,
        last_checked_at=s.last_checked_at,
    )


@admin_fatwa_router.post("/trusted-sources/{source_id}/check", response_model=dict)
async def trusted_source_check(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_super_admin),
):
    """تست اتصال منبع خارجی مورداعتماد — HEAD/GET با timeout (صفحهٔ External Sources)."""
    import time

    import httpx

    src = await db.get(TrustedExternalSource, source_id)
    if src is None:
        raise APIError(404, "source_not_found", "منبع یافت نشد")
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.head(src.base_url)
            if r.status_code >= 400:
                r = await client.get(src.base_url)
    except Exception as exc:  # noqa: BLE001 — نتیجهٔ تست، نه خطای سرور
        return {"ok": False, "latency_ms": int((time.monotonic() - t0) * 1000),
                "error": f"{type(exc).__name__}"}
    ms = int((time.monotonic() - t0) * 1000)
    src.last_checked_at = datetime.now(UTC)
    await db.commit()
    return {"ok": r.status_code < 400, "status_code": r.status_code,
            "latency_ms": ms, "checked_at": src.last_checked_at.isoformat()}


@admin_fatwa_router.delete("/trusted-sources/{source_id}", status_code=204)
async def trusted_source_delete(
    source_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_super_admin),
):
    await service.trusted_source_delete(db, user, source_id)


# --- ادمین: audit ---


@admin_fatwa_router.get("/audit", response_model=dict)
async def fatwa_audit(
    limit: int = Query(default=50, ge=1, le=100),
    after: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_can_knowledge),
):
    items, next_cursor = await service.fatwa_audit_list(
        db, limit=limit, cursor=after
    )
    return {
        "items": [
            AuditEntryOut(
                id=r.id, actor_id=r.actor_id, action=r.action,
                entity_type=r.entity_type, entity_id=r.entity_id,
                created_at=r.created_at,
            ).model_dump(mode="json")
            for r in items
        ],
        "next_cursor": next_cursor,
    }
