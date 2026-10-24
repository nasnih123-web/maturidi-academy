"""لایهٔ embedding و بازیابی هیبریدی — فاز ۶ (ADR-0005 §۲).

یک رابط واحد:
    embed_provider.embed(texts) -> list[list[float]]
    chunk_index.search(db, query, top_k, filters) -> list[ScoredChunk]

Backend A (pgvector): فقط وقتی DATABASE_URL روی postgres است و پکیج
pgvector نصب شده. از B-03 (ADR-0026) ستون واقعی `embedding_vec`
vector(256) با مهاجرت ساخته می‌شود (اکستنشن vector + بک‌فیل از JSON +
ایندکس HNSW) و ingestion هر دو ستون را پر می‌کند؛ بازیابی کاملاً در
دیتابیس انجام می‌شود: معنایی با فاصلهٔ کسینوسی `<=>` و واژگانی با
pg_trgm (word_similarity روی ایندکس GIN تری‌گرام) — هیچ سقف اسکنی
وجود ندارد و chunk قدیمیِ #۵۰۱ هم مثل بقیه قابل بازیابی است.

Backend B (پیش‌فرض/SQLite): ستون JSON + cosine در پایتون، بدون سقف
اسکن (SQLite مسیر dev/test است؛ مقیاس production روی Backend A است).

امتیاز هیبریدی (§۸): score = lexical + semantic.
lexical = هم‌پوشانی trigram کاراکتری (۰..۱).
semantic = cosine similarity بردارها (۰..۱).

providerهای embedding (صریح، مستند، بدون اختراع):
- "hash": قطعی و تست‌پذیر — hashing trick روی trigramهای کلمه + نرمال‌سازی
  L2. این embedding معنایی واقعی نیست ولی قطعی و بدون وابستگی خارجی است؛
  **فقط dev/test** (M-07): در production اگر فعال باشد، جست‌وجوی معنایی
  عملاً خاموش است و سیستم آن را با هشدار صریح «semantic search disabled»
  در startup و داشبورد اتصالات CRM اعلام می‌کند — هرگز بی‌صدا.
- "external_api": POST به endpoint قابل‌پیکربندی (settings
  ai.embedding_endpoint + ai.embedding_api_key)؛ پاسخ موردانتظار
  {"embeddings": [[...], ...]}.
- "local_model": مدل واقعی sentence-transformers (چندزبانه) — **پیش‌فرض
  production وقتی setting صریحی نیست**؛ تنبل بارگذاری می‌شود و اگر پکیج
  نصب نباشد با خطای صریح رد می‌شود (نه mock).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import uuid
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

EMBEDDING_DIM = 256

# هویت پروجکشن فعلی (FIX3-04 — ADR-0051): الگوریتم fit_dim یعنی
# «folding دوره‌ای + نرمال‌سازی L2» با این نام روی هر chunk تازه
# ثبت می‌شود (ستون embedding_projection). بردارهای پیش از FIX2-03
# با برش سادهٔ ۲۵۶ مؤلفهٔ اول ساخته شده‌اند («slice-v0») ولی آن
# زمان هیچ نشانی ثبت نمی‌شد — پس projection NULL یعنی «نامعلوم/
# legacy» و در گزارش سازگاری ناسازگار شمرده و reindex می‌شود.
# هر تغییر آینده در fit_dim باید نسخهٔ این ثابت را بالا ببرد.
PROJECTION_ID = "folding-v1"

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
    # هویت مدل برای ثبت روی chunk هنگام ایندکس (FIX2-03)؛ providerی که
    # مدلش از config می‌آید (external) آن را async resolve می‌کند.
    model_name: str = ""

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
    model_name = "hash-trigram-v1"

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

    async def model_identity(self) -> str:
        """نام مدل پیکربندی‌شده — برای ثبت روی chunk (FIX2-03)."""
        return (
            await self._config("ai.embedding_model", "AI_EMBEDDING_MODEL")
            or "default"
        )

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
            return [fit_dim([float(x) for x in v]) for v in vectors]
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
    model_name = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

    def __init__(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise EmbeddingProviderError(
                "sentence-transformers نصب نیست؛ ai.embedding_provider را "
                "به hash یا external_api برگردانید"
            ) from exc
        self._model = SentenceTransformer(self.model_name)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import anyio

        vectors = await anyio.to_thread.run_sync(
            lambda: self._model.encode(texts, normalize_embeddings=True)
        )
        return [fit_dim(list(map(float, v))) for v in vectors]


class EmbeddingProviderError(Exception):
    """خطای صریح provider — هرگز با دادهٔ ساختگی جایگزین نمی‌شود."""


def fit_dim(vec: list[float]) -> list[float]:
    """پروجکشن بردار به EMBEDDING_DIM — قرارداد ذخیره‌سازی (B-03).

    ستون `embedding_vec` از نوع vector(256) است؛ مدل‌های واقعی ابعاد
    دیگری می‌دهند (MiniLM: ۳۸۴، OpenAI: ۱۵۳۶).

    FIX2-03: روش «folding» (تا کردن دوره‌ای) جای برش سادهٔ ۲۵۶ مؤلفهٔ
    اول را می‌گیرد — برش بقیهٔ بردار را بی‌صدا دور می‌ریخت. مؤلفهٔ j
    به خانهٔ j % EMBEDDING_DIM اضافه می‌شود: برای بردار کوتاه‌تر
    معادل pad با صفر است و برای بلندتر انرژی همهٔ مؤلفه‌ها به‌صورت
    جمع دوره‌ای حفظ می‌شود، بعد L2-نرمال. کوئری و سند هر دو همین تابع
    را می‌بینند پس رتبه‌بندی سازگار می‌ماند.

    توجه: تغییر پروجکشن معنای بردارهای قبلاً ذخیره‌شده را عوض
    می‌کند — reindex لازم است؛ از همین رو provider/model روی هر
    chunk ثبت می‌شود و وضعیت reindex در semantic_search_status
    expose می‌شود.
    """
    out = [0.0] * EMBEDDING_DIM
    for j, x in enumerate(vec):
        out[j % EMBEDDING_DIM] += float(x)
    norm = math.sqrt(sum(x * x for x in out))
    return [x / norm for x in out] if norm else out


def _decode_provider_name(raw: str) -> str:
    """تحمل مقدار JSON-codeشدهٔ setting.

    ai.embedding_provider از نوع json ذخیره می‌شود، پس get_setting رشتهٔ
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


async def resolve_provider_name(db: AsyncSession) -> str:
    """نام provider مؤثر (M-07).

    اول setting صریح `ai.embedding_provider`؛ اگر تنظیم نشده باشد:
    در production پیش‌فرض **local_model** (واقعی، بدون کلید خارجی) و
    در dev/test پیش‌فرض hash (قطعی و سبک). انتخاب صریحِ hash در
    production احترام گذاشته می‌شود ولی semantic_search_status آن را
    «semantic search disabled» گزارش می‌کند.
    """
    from app.core.platform_settings import get_setting

    raw = await get_setting(db, "ai.embedding_provider")
    if raw:
        return _decode_provider_name(raw)
    return "hash" if get_settings().is_dev else "local_model"


async def _semantic_search_status_base(db: AsyncSession) -> dict:
    """هستهٔ وضعیت جست‌وجوی معنایی (بدون آمار chunkها)."""
    from app.core.platform_settings import get_setting

    provider = await resolve_provider_name(db)
    if provider == "hash":
        return {
            "provider": "hash",
            "semantic_enabled": False,
            "reason": "semantic search disabled: hash provider is dev/test only",
        }
    if provider == "external_api":
        endpoint = await get_setting(db, "ai.embedding_endpoint")
        if not endpoint:
            import os

            endpoint = os.environ.get("AI_EMBEDDING_ENDPOINT")
        if not endpoint:
            return {
                "provider": "external_api",
                "semantic_enabled": False,
                "reason": "semantic search disabled: ai.embedding_endpoint not configured",
            }
        return {
            "provider": "external_api",
            "semantic_enabled": True,
            "reason": None,
        }
    if provider == "local_model":
        try:
            import sentence_transformers  # noqa: F401
        except ImportError:
            return {
                "provider": "local_model",
                "semantic_enabled": False,
                "reason": "semantic search disabled: sentence-transformers not installed",
            }
        return {
            "provider": "local_model",
            "semantic_enabled": True,
            "reason": None,
        }
    return {
        "provider": provider,
        "semantic_enabled": False,
        "reason": f"semantic search disabled: unknown provider {provider}",
    }


async def log_semantic_search_status(db: AsyncSession) -> dict:
    """هشدار startup (M-07): در production خاموشی معنایی = CRITICAL."""
    from app.core.logging import logger

    status = await semantic_search_status(db)
    if status["semantic_enabled"]:
        logger.info("semantic search: enabled (provider=%s)", status["provider"])
    elif get_settings().is_dev:
        logger.info("semantic search: %s", status["reason"])
    else:
        logger.critical("%s", status["reason"])
    return status


async def chunk_provider_stats(db: AsyncSession, provider_name: str) -> dict:
    """آمار هویت امبدینگ chunkها نسبت به provider فعلی (FIX2-03).

    - chunks_without_provider: ردیف‌های legacy که قبل از ثبت هویت
      ساخته شده‌اند — موقع بازیابی خوانده می‌شوند ولی اینجا شمرده و
      expose می‌شوند تا reindex آن‌ها تصمیم آگاهانه باشد، نه حدس.
    - chunks_other_provider: با provider دیگری ایندکس شده‌اند —
      بازیابی معنایی آن‌ها را قاطی نمی‌کند (نگهبان _score) و تنها
      راه استفاده‌شان reindex با provider فعلی است.
    """
    from sqlalchemy import func, select

    from app.models.models import FiqhKnowledgeChunk

    async def _count(*criteria) -> int:
        stmt = select(func.count()).select_from(FiqhKnowledgeChunk).where(*criteria)
        return int((await db.execute(stmt)).scalar_one())

    total = await _count(FiqhKnowledgeChunk.embedding.is_not(None))
    without_provider = await _count(
        FiqhKnowledgeChunk.embedding.is_not(None),
        FiqhKnowledgeChunk.embedding_provider.is_(None),
    )
    other_provider = await _count(
        FiqhKnowledgeChunk.embedding.is_not(None),
        FiqhKnowledgeChunk.embedding_provider.is_not(None),
        FiqhKnowledgeChunk.embedding_provider != provider_name,
    )
    return {
        "chunks_total": total,
        "chunks_without_provider": without_provider,
        "chunks_other_provider": other_provider,
        "reindex_recommended": (without_provider + other_provider) > 0,
    }


async def current_embedding_identity(db: AsyncSession) -> dict:
    """هویت امبدینگ جاری (provider, model, projection, dim) — FIX3-04.

    model بدون ساخت provider سنگین خوانده می‌شود: برای hash و
    local_model از ثابت کلاس، برای external از همان configای که
    model_identity می‌خواند (setting/env).
    """
    name = await resolve_provider_name(db)
    if name == HashEmbeddingProvider.name:
        model = HashEmbeddingProvider.model_name
    elif name == LocalModelEmbeddingProvider.name:
        model = LocalModelEmbeddingProvider.model_name
    elif name == ExternalAPIEmbeddingProvider.name:
        model = await ExternalAPIEmbeddingProvider(db).model_identity()
    else:
        model = ""
    return {
        "provider": name,
        "model": model,
        "projection": PROJECTION_ID,
        "dim": EMBEDDING_DIM,
    }


async def _chunk_identity_rows(db: AsyncSession) -> list[tuple]:
    """(id, provider, model, projection, dim) همهٔ chunkهای دارای بردار.

    بُعد داخل SQL حساب می‌شود (jsonb_array_length روی PG /
    json_array_length روی SQLite) تا خود بردارها برای یک گزارش
    وضعیتی جابه‌جا نشوند؛ روی dialect ناشناخته به len پایتونی
    برمی‌گردد.
    """
    from sqlalchemy import func, select

    from app.models.models import FiqhKnowledgeChunk

    dialect = ""
    bind = getattr(db, "bind", None)
    if bind is not None and getattr(bind, "dialect", None) is not None:
        dialect = bind.dialect.name
    dim_expr = None
    if dialect == "postgresql":
        dim_expr = func.jsonb_array_length(FiqhKnowledgeChunk.embedding)
    elif dialect == "sqlite":
        dim_expr = func.json_array_length(FiqhKnowledgeChunk.embedding)
    if dim_expr is not None:
        rows = (
            await db.execute(
                select(
                    FiqhKnowledgeChunk.id,
                    FiqhKnowledgeChunk.embedding_provider,
                    FiqhKnowledgeChunk.embedding_model,
                    FiqhKnowledgeChunk.embedding_projection,
                    dim_expr,
                ).where(FiqhKnowledgeChunk.embedding.is_not(None))
            )
        ).all()
        return [(cid, prov, model, proj, int(dim or 0)) for cid, prov, model, proj, dim in rows]
    rows = (
        await db.execute(
            select(
                FiqhKnowledgeChunk.id,
                FiqhKnowledgeChunk.embedding_provider,
                FiqhKnowledgeChunk.embedding_model,
                FiqhKnowledgeChunk.embedding_projection,
                FiqhKnowledgeChunk.embedding,
            ).where(FiqhKnowledgeChunk.embedding.is_not(None))
        )
    ).all()
    return [
        (cid, prov, model, proj, len(vec) if vec is not None else 0)
        for cid, prov, model, proj, vec in rows
    ]


def _identity_matches(
    prov: str | None, model: str | None, proj: str | None, dim: int, current: dict
) -> bool:
    return (
        prov == current["provider"]
        and (model or "") == current["model"]
        and proj == current["projection"]
        and dim == current["dim"]
    )


async def chunk_compatibility_report(db: AsyncSession) -> dict:
    """گزارش سازگاری امبدینگ‌ها (FIX3-04 — ADR-0051).

    chunkها بر اساس (provider, model, projection, dim) گروه‌بندی
    می‌شوند و هر گروه صریحاً سازگار/ناسازگار با هویت جاری علامت
    می‌خورد. ردیف‌های legacy (هویت NULL — پیش از FIX2-03/FIX3-04)
    گروه خودشان را دارند و ناسازگارند: راه استفاده‌شان فقط
    reindex است (ابزار: app.modules.fatwa.reindex).
    """
    current = await current_embedding_identity(db)
    groups: dict[tuple, dict] = {}
    total = 0
    compatible = 0
    for _cid, prov, model, proj, dim in await _chunk_identity_rows(db):
        key = (prov, model, proj, dim)
        group = groups.get(key)
        if group is None:
            group = {
                "provider": prov,
                "model": model,
                "projection": proj,
                "dim": dim,
                "count": 0,
                "compatible": _identity_matches(prov, model, proj, dim, current),
            }
            groups[key] = group
        group["count"] += 1
        total += 1
        if group["compatible"]:
            compatible += 1
    return {
        "current": current,
        "groups": sorted(
            groups.values(),
            key=lambda g: (g["compatible"], -(g["count"])),
        ),
        "chunks_total": total,
        "chunks_compatible": compatible,
        "chunks_incompatible": total - compatible,
        "reindex_recommended": (total - compatible) > 0,
    }


async def semantic_search_status(db: AsyncSession) -> dict:
    """وضعیت صادقانهٔ جست‌وجوی معنایی — برای startup و داشبورد CRM.

    semantic_enabled فقط وقتی True است که provider واقعی باشد و
    پیش‌نیازش کامل باشد (external: endpoint؛ local: نصب بودن
    sentence-transformers). در غیر این صورت reason دقیق برمی‌گردد.
    روی آن، آمار هویت chunkها (FIX2-03) هم سوار می‌شود تا نیاز به
    reindex در همان داشبورد دیده شود.
    """
    status = await _semantic_search_status_base(db)
    status.update(await chunk_provider_stats(db, status["provider"]))
    # FIX3-04: گزارش سازگاری کامل (گروه‌ها + شمار ناسازگارها) روی
    # همان سطح وضعیت — داشبورد و ابزار reindex هر دو از همین می‌خوانند.
    status["compatibility"] = await chunk_compatibility_report(db)
    return status


async def provider_identity(provider: EmbeddingProvider) -> tuple[str, str]:
    """هویت (provider, model) برای ثبت روی chunk هنگام ایندکس (FIX2-03)."""
    model = provider.model_name or ""
    if isinstance(provider, ExternalAPIEmbeddingProvider):
        model = await provider.model_identity()
    return provider.name, model


# ---------------------------------------------------------------------------
# کش singleton تنبل و thread-safe برای providerها (FIX2-04)
#
# ساخت LocalModelEmbeddingProvider سنگین است (لود SentenceTransformer) و
# پیش از این fix در هر فراخوانیِ get_embedding_provider از نو ساخته
# می‌شد — یعنی عملاً در مسیر هر درخواست. providerهای بدون وضعیت
# (hash/local_model) یک بار در هر پردازه ساخته و کش می‌شوند؛ دسترسی با
# double-checked locking thread-safe است و ساخت تنبل می‌ماند (تا اولین
# استفاده هیچ مدلی لود نمی‌شود).
# ---------------------------------------------------------------------------

_provider_cache: dict[str, EmbeddingProvider] = {}
_provider_cache_lock = threading.Lock()


def _cached_provider(
    name: str, factory: Callable[[], EmbeddingProvider]
) -> EmbeddingProvider:
    inst = _provider_cache.get(name)
    if inst is None:
        with _provider_cache_lock:
            inst = _provider_cache.get(name)
            if inst is None:
                inst = factory()
                _provider_cache[name] = inst
    return inst


def reset_embedding_provider_cache() -> None:
    """خالی‌کردن کش providerها — فقط برای تست‌ها."""
    with _provider_cache_lock:
        _provider_cache.clear()


async def get_embedding_provider(
    db: AsyncSession, name: str | None = None
) -> EmbeddingProvider:
    """انتخاب provider — setting صریح، وگرنه پیش‌فرض محیطی (M-07).

    hash و local_model از کش singleton پردازه برمی‌گردند (FIX2-04).
    external_api عمداً کش نمی‌شود: نمونه‌اش به AsyncSession زندهٔ همان
    درخواست گره خورده (config را از دیتابیس می‌خواند) و کش‌کردنش نشستِ
    بسته‌شده را به درخواست‌های بعدی نشت می‌دهد.
    """
    selected = _decode_provider_name(name) if name else await resolve_provider_name(db)
    if selected == "hash":
        return _cached_provider("hash", HashEmbeddingProvider)
    if selected == "external_api":
        return ExternalAPIEmbeddingProvider(db)
    if selected == "local_model":
        return _cached_provider("local_model", LocalModelEmbeddingProvider)
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


def _pg_filters(filters: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    """قطعه‌های WHERE امن برای کوئری‌های PG (معنایی + واژگانی).

    یافتهٔ فاز ۱۷ (SEC-17-02): فقط کلیدهای شناخته‌شدهٔ فیلتر اعمال
    می‌شوند؛ کلید ناشناس هرگز نمی‌تواند وارد ساختار SQL شود و همهٔ
    مقادیر پویا پارامتر bound هستند (دفاع در عمق).
    """
    _SAFE_FILTER_KEYS = frozenset({"ai_scope", "topic_category", "madhab_scope"})
    filters = {k: v for k, v in (filters or {}).items() if k in _SAFE_FILTER_KEYS}
    where = ["workflow_status = ANY(:statuses)"]
    params: dict[str, Any] = {"statuses": list(RAG_READABLE_STATUSES)}
    if filters.get("ai_scope"):
        where.append("ai_scopes::jsonb ? :scope")
        params["scope"] = filters["ai_scope"]
    if filters.get("topic_category"):
        where.append("topic_category = :topic")
        params["topic"] = filters["topic_category"]
    if filters.get("madhab_scope"):
        where.append("(madhab_scope IS NULL OR madhab_scope = :madhab)")
        params["madhab"] = filters["madhab_scope"]
    return where, params


async def _pgvector_search(
    db: AsyncSession,
    query_vec: list[float],
    top_k: int,
    filters: dict[str, Any],
) -> list[dict[str, Any]] | None:
    """جست‌وجوی معنایی در دیتابیس با pgvector — None یعنی fallback به Backend B.

    ستون embedding_vec و ایندکس HNSW را مهاجرت B-03 می‌سازد (دیگر هیچ
    DDL تنبلی در مسیر کوئری نیست)؛ اگر ستون/اکستنشن نباشد، کوئری خطا
    می‌دهد و None برمی‌گردد تا Backend B نتیجهٔ درست بدهد.
    """
    where, params = _pg_filters(filters)
    where.append("embedding_vec IS NOT NULL")
    params.update(
        {
            "qvec": "[" + ",".join(repr(float(x)) for x in query_vec) + "]",
        }
    )
    try:
        rows = (
            await db.execute(
                # بررسی‌شدهٔ فاز ۱۷ (SEC-17-02): قطعه‌های WHERE همگی رشته‌های
                # ثابت‌اند و همهٔ مقادیر پویا (scope/topic/madhab/qvec/topk)
                # از طریق پارامترهای bound یا float() رد می‌شوند؛ تزریق SQL
                # ممکن نیست. سرکوب اسکنر آگاهانه و مستند است.
                # بُعد بردار در SQL عمداً لیترالِ ثابتِ ماژول است:
                # PostgreSQL در prepared statement برای type modifier
                # پارامتر قبول نمی‌کند («type modifiers must be simple
                # constants») — یافتهٔ CI ممیزی 197efa0؛ EMBEDDING_DIM
                # ثابتِ همین ماژول است، ورودی کاربر نیست.
                text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    f"SELECT id, embedding_vec <=> (:qvec)::vector({int(EMBEDDING_DIM)}) AS dist "  # nosec B608 -- reviewed SEC-17-02
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


async def _pg_trgm_search(
    db: AsyncSession,
    query: str,
    top_k: int,
    filters: dict[str, Any],
) -> list[dict[str, Any]] | None:
    """نامزدهای واژگانی در دیتابیس با pg_trgm (B-03) — None یعنی ناموجود.

    word_similarity بهترین زیررشتهٔ chunk را با کوئری می‌سنجد (مناسب
    متن‌های بلند) و ایندکس GIN تری‌گرامِ مهاجرت آن را پشتیبانی می‌کند.
    """
    where, params = _pg_filters(filters)
    where.append("word_similarity(:q, chunk_text) > 0.05")
    # کوئری خام: chunk_text هم خام ذخیره شده و این فقط انتخاب نامزد است؛
    # امتیاز واژگانی نهایی با lexical_score (نرمال‌ساز) حساب می‌شود.
    params["q"] = query
    try:
        rows = (
            await db.execute(
                text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    "SELECT id, word_similarity(:q, chunk_text) AS sim "  # nosec B608 -- reviewed SEC-17-02 pattern (fixed fragments + bound params)
                    "FROM fiqh_knowledge_chunks WHERE "
                    + " AND ".join(where)
                    + " ORDER BY sim DESC LIMIT :topk"
                ),
                {**params, "topk": top_k * 3},
            )
        ).all()
        return [{"id": r[0], "lexical_db": float(r[1])} for r in rows]
    except Exception:  # noqa: BLE001 — pg_trgm در دسترس نیست → فقط معنایی
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

        # مسیر pgvector (Backend A — B-03): نامزدها کاملاً در دیتابیس
        # انتخاب می‌شوند (معنایی با <=>، واژگانی با pg_trgm) و فقط
        # همان ردیف‌ها برای امتیازدهی نهایی خوانده می‌شوند — هیچ سقف
        # اسکنی نیست، پس chunk قدیمی هم قابل بازیابی است.
        if pgvector_available():
            sem_rows = await _pgvector_search(db, query_vec, top_k, filters)
            if sem_rows is not None:
                pg_semantic = {str(r["id"]): r["semantic"] for r in sem_rows}
                candidate_ids = set(pg_semantic)
                lex_rows = await _pg_trgm_search(db, query, top_k, filters)
                if lex_rows:
                    candidate_ids.update(str(r["id"]) for r in lex_rows)
                if candidate_ids:
                    rows = (
                        await db.execute(
                            select(FiqhKnowledgeChunk).where(
                                FiqhKnowledgeChunk.id.in_(
                                    [uuid.UUID(i) for i in candidate_ids]
                                )
                            )
                        )
                    ).scalars().all()
                    scored_pg: list[ScoredChunk] = []
                    for c in rows:
                        s = self._score(c, query, query_vec, ai_scope, pg_semantic)
                        if s is not None:
                            scored_pg.append(s)
                    scored_pg.sort(key=lambda s: s.score, reverse=True)
                    return scored_pg[:top_k]
                return []

        # Backend B (SQLite / fallback): اسکن کاملِ بدون سقف روی ستون
        # JSON — سقف ۵۰۰تاییِ قبلی chunkهای قدیمی‌تر را برای همیشه
        # نامرئی می‌کرد (یافتهٔ B-03). SQLite مسیر dev/test است و
        # مقیاس production روی Backend A است.
        stmt = select(FiqhKnowledgeChunk).where(
            FiqhKnowledgeChunk.workflow_status.in_(RAG_READABLE_STATUSES)
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
            s = self._score(c, query, query_vec, ai_scope, None)
            if s is not None:
                scored.append(s)
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:top_k]

    def _score(
        self,
        c: Any,
        query: str,
        query_vec: list[float],
        ai_scope: str,
        pg_semantic: dict[str, float] | None,
    ) -> ScoredChunk | None:
        """امتیاز هیبریدی یک chunk — None یعنی خارج از ai_scope خواسته‌شده.

        FIX2-03: chunkی که provider ثبت‌شده‌اش با provider کوئری فرق
        دارد هرگز امتیاز معنایی نمی‌گیرد — کسینوس بین فضای دو provider
        بی‌معناست و قاطی‌کردن خاموش آن دقیقاً باگ گزارش‌شده بود. چنین
        chunkی فقط با امتیاز واژگانی می‌ماند و در وضعیت
        (chunks_other_provider) به‌عنوان نیازمند reindex شمرده می‌شود.
        chunkهای legacy بدون provider ثبت‌شده فعلاً امتیاز معنایی
        می‌گیرند ولی در همان وضعیت expose می‌شوند.
        """
        scopes = c.ai_scopes or []
        if ai_scope not in scopes:
            return None
        lex = lexical_score(query, c.chunk_text)
        recorded_provider = getattr(c, "embedding_provider", None)
        provider_mismatch = bool(recorded_provider) and (
            recorded_provider != self.provider.name
        )
        if provider_mismatch:
            sem = 0.0
        elif pg_semantic is not None and str(c.id) in pg_semantic:
            sem = pg_semantic[str(c.id)]
        else:
            sem = (
                cosine_similarity(query_vec, c.embedding) if c.embedding else 0.0
            )
        return ScoredChunk(
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
