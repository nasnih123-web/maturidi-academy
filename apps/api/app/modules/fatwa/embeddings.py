"""لایهٔ embedding و بازیابی هیبریدی — فاز ۶ (ADR-0005 §۲).

یک رابط واحد:
    embed_provider.embed(texts) -> list[list[float]]
    chunk_index.search(db, query, top_k, filters) -> list[ScoredChunk]

Backend A (pgvector): فقط وقتی DATABASE_URL روی postgres است و پکیج
pgvector نصب شده. embeddingها در همان ستون JSON ذخیره می‌شوند؛ در اولین
استفاده روی Postgres، index ستون `embedding_vec` را lazily می‌سازد و از
JSON پر می‌کند، سپس فاصلهٔ کسینوسی `<=>` را در خودِ دیتابیس می‌زند.

Backend B (پیش‌فرض/SQLite): ستون JSON + cosine در پایتون.

امتیاز هیبریدی (§۸): score = lexical + semantic.
lexical = هم‌پوشانی trigram کاراکتری (۰..۱).
semantic = cosine similarity بردارها (۰..۱).

providerهای embedding (صریح، مستند، بدون اختراع):
- "hash": قطعی و تست‌پذیر — hashing trick روی trigramهای کلمه + نرمال‌سازی
  L2. این embedding معنایی واقعی نیست ولی قطعی و بدون وابستگی خارجی است؛
  provider پیش‌فرض تا وقتی external/local پیکربندی شود.
- "external_api": POST به endpoint قابل‌پیکربندی (settings
  ai.embedding_endpoint + ai.embedding_api_key)؛ پاسخ موردانتظار
  {"embeddings": [[...], ...]}.
- "local_model": تنبل — فقط اگر sentence-transformers نصب بود؛ در غیر این
  صورت با خطای صریح رد می‌شود (نه mock).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

EMBEDDING_DIM = 256

# وضعیت‌های قابل‌خواندن توسط RAG (§۹، §۱۰) — هرگز draft.
RAG_READABLE_STATUSES = ("approved", "published")

# ابعاد مجاز ai_scopes (§۹.۵).
AI_SCOPES = ("fatwa", "assistant", "quiz", "verification", "semantic_search")


# ---------------------------------------------------------------------------
# ابزارهای متنی
# ---------------------------------------------------------------------------


def _normalize(text_value: str) -> str:
    """نرمال‌سازی سبک برای embedding/lexical: حذف تشکیلات و یکدست‌سازی."""
    t = text_value.strip()
    # حذف اعراب و تشکیلات عربی/فارسی
    t = re.sub(r"[\u064b-\u0652\u0670]", "", t)
    # یکدست‌سازی ی/ک عربی با فارسی
    t = t.replace("ي", "ی").replace("ك", "ک")
    return re.sub(r"\s+", " ", t)


def _trigrams(text_value: str) -> set[str]:
    """مجموعهٔ trigramهای کاراکتری (با padding مرزی)."""
    t = f"  {_normalize(text_value)}  "
    return {t[i : i + 3] for i in range(len(t) - 2)} if len(t) >= 3 else {t}


def lexical_score(query: str, document: str) -> float:
    """هم‌پوشانی trigram: |A∩B| / |A| — در [۰,۱]."""
    q = _trigrams(query)
    if not q:
        return 0.0
    d = _trigrams(document)
    return len(q & d) / len(q)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """کسینوس روی بردارهای نرمال‌شده — در [۰,۱] clip می‌شود."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


# ---------------------------------------------------------------------------
# providerهای embedding
# ---------------------------------------------------------------------------


class EmbeddingProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """هر متن → بردار EMBEDDING_DIMبعدی. ورودی خالی → خروجی خالی."""
        raise NotImplementedError


class HashEmbeddingProvider(EmbeddingProvider):
    """provider قطعی پیش‌فرض — hashing trick روی trigramهای کلمه.

    برای هر trigram، بایت‌های sha256 تعیین می‌کند کدام بُعد +۱ بگیرد؛
    در پایان نرمال‌سازی L2. کاملاً قطعی، بدون شبکه، بدون وابستگی.
    کیفیت معنایی محدود است — برای production باید external_api یا
    local_model پیکربندی شود (مستندات README).
    """

    name = "hash"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for t in texts:
            vec = [0.0] * EMBEDDING_DIM
            words = _normalize(t).split()
            for w in words:
                padded = f"<{w}>"
                for i in range(len(padded) - 2):
                    tri = padded[i : i + 3]
                    h = hashlib.sha256(tri.encode("utf-8")).digest()
                    idx = int.from_bytes(h[:4], "big") % EMBEDDING_DIM
                    # علامت از بایت پنجم تا ترم‌های متضاد همدیگر را خنثی کنند
                    vec[idx] += 1.0 if h[4] & 1 else -1.0
            norm = math.sqrt(sum(x * x for x in vec))
            out.append([x / norm for x in vec] if norm else vec)
        return out


class ExternalAPIEmbeddingProvider(EmbeddingProvider):
    """embedding از API خارجی قابل‌پیکربندی.

    settings: ai.embedding_endpoint (الزامی)، ai.embedding_api_key (اختیاری،
    secret)، ai.embedding_model (نام مدل برای ارسال در body).
    هرکدام که در settings نباشد، از env خوانده می‌شود
    (AI_EMBEDDING_ENDPOINT / AI_EMBEDDING_API_KEY / AI_EMBEDDING_MODEL).
    قرارداد پاسخ: {"embeddings": [[float...], ...]} با همان ترتیب ورودی.
    """

    name = "external_api"

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def _config(self, key: str, env_name: str) -> str | None:
        from app.core.platform_settings import get_setting

        value = await get_setting(self._db, key)
        if value:
            return value
        import os

        return os.environ.get(env_name) or None

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import httpx

        endpoint = await self._config("ai.embedding_endpoint", "AI_EMBEDDING_ENDPOINT")
        if not endpoint:
            raise EmbeddingProviderError(
                "ai.embedding_endpoint تنظیم نشده است"
            )
        api_key = await self._config("ai.embedding_api_key", "AI_EMBEDDING_API_KEY")
        model = (
            await self._config("ai.embedding_model", "AI_EMBEDDING_MODEL")
            or "default"
        )
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    endpoint,
                    json={"model": model, "input": texts},
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
            vectors = data.get("embeddings")
            if not isinstance(vectors, list) or len(vectors) != len(texts):
                raise EmbeddingProviderError(
                    "پاسخ embedding نامعتبر است (embeddings با طول ورودی)"
                )
            return [[float(x) for x in v] for v in vectors]
        except EmbeddingProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 — بسته‌بندی برای لایهٔ بالاتر
            raise EmbeddingProviderError(f"خطای provider خارجی embedding: {exc}")


class LocalModelEmbeddingProvider(EmbeddingProvider):
    """مدل محلی sentence-transformers — بارگذاری تنبل.

    فقط وقتی انتخاب می‌شود که کاربر صریحاً ai.embedding_provider=local_model
    را تنظیم کرده باشد و پکیج نصب باشد؛ در غیر این صورت خطای صریح.
    """

    name = "local_model"

    def __init__(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise EmbeddingProviderError(
                "sentence-transformers نصب نیست؛ ai.embedding_provider را "
                "به hash یا external_api برگردانید"
            ) from exc
        model_name = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
        self._model = SentenceTransformer(model_name)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import anyio

        vectors = await anyio.to_thread.run_sync(
            lambda: self._model.encode(texts, normalize_embeddings=True)
        )
        return [list(map(float, v)) for v in vectors]


class EmbeddingProviderError(Exception):
    """خطای صریح provider — هرگز با دادهٔ ساختگی جایگزین نمی‌شود."""


def _decode_provider_name(raw: str) -> str:
    """تحمل مقدار JSON-codeشدهٔ setting.

    ‏ai.embedding_provider از نوع json ذخیره می‌شود، پس get_setting رشتهٔ
    «"hash"» (با گیومه) برمی‌گرداند نه «hash». هر دو شکل پذیرفته می‌شوند؛
    در صورت نامعتبر بودن، همان رشتهٔ خام برگردانده می‌شود تا خطای
    «provider ناشناخته» با مقدار واقعی گزارش شود.
    """
    text = raw.strip()
    if len(text) >= 2 and text.startswith('"') and text.endswith('"'):
        try:
            decoded = json.loads(text)
            if isinstance(decoded, str):
                return decoded
        except (json.JSONDecodeError, ValueError):
            pass
    return text


async def get_embedding_provider(
    db: AsyncSession, name: str | None = None
) -> EmbeddingProvider:
    """انتخاب provider از setting ‏ai.embedding_provider (پیش‌فرض: hash)."""
    from app.core.platform_settings import get_setting

    raw = name or (await get_setting(db, "ai.embedding_provider")) or "hash"
    selected = _decode_provider_name(raw)
    if selected == "hash":
        return HashEmbeddingProvider()
    if selected == "external_api":
        return ExternalAPIEmbeddingProvider(db)
    if selected == "local_model":
        return LocalModelEmbeddingProvider()
    raise EmbeddingProviderError(f"provider ناشناخته: {selected}")


# ---------------------------------------------------------------------------
# index و جست‌وجو
# ---------------------------------------------------------------------------


@dataclass
class ScoredChunk:
    chunk_id: Any
    chunk_text: str
    source_citation: dict | None
    topic_category: str | None
    madhab_scope: str | None
    score: float
    lexical: float
    semantic: float
    matched_scopes: list[str] = field(default_factory=list)


def pgvector_available() -> bool:
    """Backend A فقط روی postgres و با نصب pgvector."""
    if not get_settings().database_url.startswith(
        ("postgresql://", "postgres://", "postgresql+")
    ):
        return False
    try:
        import pgvector  # noqa: F401
    except ImportError:
        return False
    return True


async def _pgvector_search(
    db: AsyncSession,
    query_vec: list[float],
    top_k: int,
    filters: dict[str, Any],
) -> list[dict[str, Any]] | None:
    """جست‌وجوی معنایی در دیتابیس با pgvector — None یعنی fallback به Backend B.

    ستون embedding_vec lazily ساخته و از JSON پر می‌شود تا migration واحد
    برای SQLite و Postgres کار کند.
    """
    # یافتهٔ فاز ۱۷ (SEC-17-02): فقط کلیدهای شناخته‌شدهٔ فیلتر اعمال می‌شوند؛
    # کلید ناشناس هرگز نمی‌تواند وارد ساختار SQL شود (دفاع در عمق).
    _SAFE_FILTER_KEYS = frozenset({"ai_scope", "topic_category", "madhab_scope"})
    filters = {k: v for k, v in (filters or {}).items() if k in _SAFE_FILTER_KEYS}
    try:
        await db.execute(
            text(
                "ALTER TABLE fiqh_knowledge_chunks "
                "ADD COLUMN IF NOT EXISTS embedding_vec vector(:dim)"
            ),
            {"dim": EMBEDDING_DIM},
        )
        # پرکردن ستون vector از JSON برای ردیف‌هایی که هنوز nullاند
        await db.execute(
            text(
                "UPDATE fiqh_knowledge_chunks SET embedding_vec = "
                "(embedding::text)::vector(:dim) "
                "WHERE embedding_vec IS NULL AND embedding IS NOT NULL"
            ),
            {"dim": EMBEDDING_DIM},
        )
        where = ["workflow_status = ANY(:statuses)", "embedding_vec IS NOT NULL"]
        params: dict[str, Any] = {
            "statuses": list(RAG_READABLE_STATUSES),
            "dim": EMBEDDING_DIM,
            "qvec": "[" + ",".join(repr(float(x)) for x in query_vec) + "]",
        }
        if filters.get("ai_scope"):
            where.append("ai_scopes::jsonb ? :scope")
            params["scope"] = filters["ai_scope"]
        if filters.get("topic_category"):
            where.append("topic_category = :topic")
            params["topic"] = filters["topic_category"]
        if filters.get("madhab_scope"):
            where.append(
                "(madhab_scope IS NULL OR madhab_scope = :madhab)"
            )
            params["madhab"] = filters["madhab_scope"]
        rows = (
            await db.execute(
                # بررسی‌شدهٔ فاز ۱۷ (SEC-17-02): قطعه‌های WHERE همگی رشته‌های
                # ثابت‌اند و همهٔ مقادیر پویا (scope/topic/madhab/qvec/topk)
                # از طریق پارامترهای bound یا float() رد می‌شوند؛ تزریق SQL
                # ممکن نیست. سرکوب اسکنر آگاهانه و مستند است.
                text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    "SELECT id, embedding_vec <=> (:qvec)::vector(:dim) AS dist "  # nosec B608 -- reviewed SEC-17-02
                    "FROM fiqh_knowledge_chunks WHERE "
                    + " AND ".join(where)
                    + " ORDER BY dist ASC LIMIT :topk"
                ),
                {**params, "topk": top_k * 3},
            )
        ).all()
        return [
            {"id": r[0], "semantic": max(0.0, 1.0 - float(r[1]))} for r in rows
        ]
    except Exception:  # noqa: BLE001 — هر خطایی → fallback به Backend B
        await db.rollback()
        return None


class ChunkIndex:
    """بازیابی هیبریدی روی fiqh_knowledge_chunks."""

    def __init__(self, provider: EmbeddingProvider) -> None:
        self.provider = provider

    async def search(
        self,
        db: AsyncSession,
        query: str,
        top_k: int = 5,
        ai_scope: str = "fatwa",
        topic_category: str | None = None,
        madhab_scope: str | None = None,
    ) -> list[ScoredChunk]:
        """top_k chunk با score = lexical + semantic.

        فقط chunkهای approved/published و دارای ai_scope خواسته‌شده.
        """
        from sqlalchemy import select

        from app.models.models import FiqhKnowledgeChunk

        if ai_scope not in AI_SCOPES:
            raise ValueError(f"ai_scope نامعتبر: {ai_scope}")

        query_vec = (await self.provider.embed([query]))[0]

        filters = {
            "ai_scope": ai_scope,
            "topic_category": topic_category,
            "madhab_scope": madhab_scope,
        }

        # مسیر pgvector (Backend A) — فقط semantic از دیتابیس
        pg_semantic: dict[str, float] | None = None
        if pgvector_available():
            rows = await _pgvector_search(db, query_vec, top_k, filters)
            if rows is not None:
                pg_semantic = {str(r["id"]): r["semantic"] for r in rows}

        stmt = (
            select(FiqhKnowledgeChunk)
            .where(
                FiqhKnowledgeChunk.workflow_status.in_(RAG_READABLE_STATUSES)
            )
            .order_by(FiqhKnowledgeChunk.created_at.desc())
            .limit(500)  # سقف اسکن برای Backend B؛ با pgvector بی‌اثر است
        )
        if topic_category:
            stmt = stmt.where(
                FiqhKnowledgeChunk.topic_category == topic_category
            )
        if madhab_scope:
            stmt = stmt.where(
                (FiqhKnowledgeChunk.madhab_scope.is_(None))
                | (FiqhKnowledgeChunk.madhab_scope == madhab_scope)
            )
        candidates = (await db.execute(stmt)).scalars().all()

        scored: list[ScoredChunk] = []
        for c in candidates:
            scopes = c.ai_scopes or []
            if ai_scope not in scopes:
                continue
            lex = lexical_score(query, c.chunk_text)
            if pg_semantic is not None and str(c.id) in pg_semantic:
                sem = pg_semantic[str(c.id)]
            else:
                sem = (
                    cosine_similarity(query_vec, c.embedding)
                    if c.embedding
                    else 0.0
                )
            scored.append(
                ScoredChunk(
                    chunk_id=c.id,
                    chunk_text=c.chunk_text,
                    source_citation=c.source_citation,
                    topic_category=c.topic_category,
                    madhab_scope=c.madhab_scope,
                    score=lex + sem,
                    lexical=lex,
                    semantic=sem,
                    matched_scopes=scopes,
                )
            )
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:top_k]


# ---------------------------------------------------------------------------
# chunking
# ---------------------------------------------------------------------------


def chunk_text_paragraphs(
    text_value: str,
    max_words: int = 500,
    overlap_words: int = 50,
    min_words: int = 20,
) -> list[str]:
    """chunking پاراگراف‌محور (§فاز ۶): انباشت پاراگراف‌ها تا ~max_words.

    «توکن» با واژه تقریب زده شده (مستند و صریح)؛ overlap ۵۰ واژه بین
    chunkهای پیاپی. پاراگراف‌های خیلی بلند در مرز جمله می‌شکنند.
    """
    if not text_value or not text_value.strip():
        return []
    paragraphs = [
        p.strip() for p in re.split(r"\n\s*\n", text_value) if p.strip()
    ]
    # شکستن پاراگراف‌های خیلی بلند در مرز جمله
    units: list[str] = []
    for p in paragraphs:
        words = p.split()
        if len(words) <= max_words:
            units.append(p)
        else:
            sentences = re.split(r"(?<=[.!?؟。])\s+", p)
            buf: list[str] = []
            for s in sentences:
                buf.append(s)
                if sum(len(x.split()) for x in buf) >= max_words:
                    units.append(" ".join(buf))
                    buf = []
            if buf:
                units.append(" ".join(buf))

    chunks: list[str] = []
    current: list[str] = []
    current_words = 0
    for u in units:
        w = len(u.split())
        if current and current_words + w > max_words:
            text_chunk = "\n\n".join(current)
            if len(text_chunk.split()) >= min_words:
                chunks.append(text_chunk)
            # overlap: ۵۰ واژهٔ پایانی chunk قبلی
            tail = text_chunk.split()[-overlap_words:]
            current = [" ".join(tail)] if tail else []
            current_words = len(tail)
        current.append(u)
        current_words += w
    if current:
        text_chunk = "\n\n".join(current)
        if len(text_chunk.split()) >= min_words:
            chunks.append(text_chunk)
    return chunks
