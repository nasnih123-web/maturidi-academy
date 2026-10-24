"""FIX2-03 — ارزیابی قطعی و محلی RAG (بدون شبکه/کلید واقعی).

corpus ثابت فارسی در سه موضوع، provider قطعی hash، و هر دو مسیر
رتبه‌بندی: مسیر واقعی ChunkIndex روی SQLite (Backend B: lexical +
semantic روی JSON) و رتبه‌بندی کسینوسی خالص روی بردارهای ذخیره‌شده
که همان ریاضی مسیر pgvector در PostgreSQL است (ترتیب بر اساس
1 - cosine). معیارها: recall@3 و MRR روی کوئری‌های دارای gold مشخص.

ارزیابی با provider زنده (external/local واقعی) به کلید/مدل مالک
نیاز دارد و در این تست نیست — BLOCKED در گزارش مأموریت.
"""
from __future__ import annotations

import pytest
from sqlalchemy import delete

from app.models.models import FiqhKnowledgeChunk
from app.modules.fatwa import embeddings as emb


@pytest.fixture(autouse=True)
async def _cleanup_corpus(tc):
    """corpus ارزیابی approved است — بعد از تست پاک شود تا به
    جست‌وجو/پرسش فایل‌های دیگر نشت نکند."""
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(FiqhKnowledgeChunk).where(
                FiqhKnowledgeChunk.source_type == "rag_eval"
            )
        )
        await db.commit()

# (کلید، متن) — واژگان متمایز هر موضوع برای تفکیک‌پذیری قطعی
_CORPUS: list[tuple[str, str]] = [
    (
        "qasr",
        ("مسافر نمازهای چهار رکعتی ظهر عصر و عشا را قصر می‌خواند یعنی دو رکعت "
        "به‌جا می‌آورد و این حکم قصر نماز مسافر در سفر شرعی ثابت است"),
    ),
    (
        "distance",
        ("مسافت شرعی سفر که قصر نماز و افطار روزه را جایز می‌کند حدود هشتاد "
        "کیلومتر است و مسافر با پیمودن این مسافت احکام سفر بر او جاری می‌شود"),
    ),
    (
        "iqama",
        ("اگر مسافر نیت اقامت پانزده روز یا بیشتر در شهری بکند نماز را تمام "
        "می‌خواند و دیگر قصر نمی‌کند چون با نیت اقامت حکم سفر از او برداشته می‌شود"),
    ),
    (
        "nisab",
        ("نصاب زکات طلا بیست مثقال و نصاب نقره دویست درهم است و هر کس مالک "
        "نصاب شود و یک سال قمری بگذرد زکات مال او واجب می‌شود"),
    ),
    (
        "trade",
        ("زکات مال تجارت بر کالاهایی است که برای خرید و فروش نگه داشته می‌شوند "
        "و در پایان سال ارزش آن‌ها محاسبه و یک چهلم آن به‌عنوان زکات پرداخت می‌شود"),
    ),
    (
        "fitr",
        ("زکات فطره بر هر مسلمانی که مالک نصاب باشد واجب است و باید پیش از "
        "نماز عید فطر به فقیر داده شود و مقدار آن برای هر نفر معین است"),
    ),
    (
        "qada",
        ("کسی که در ماه رمضان روزه را به عذر شرعی افطار کند قضای آن روزها را "
        "در روزهای دیگر سال به‌جا می‌آورد و قضای روزه واجب است"),
    ),
    (
        "kaffara",
        ("کفاره افطار عمدی روزه در ماه رمضان آزاد کردن برده یا دو ماه روزه "
        "پیاپی یا اطعام شصت مسکین است و این کفاره به ترتیب انجام می‌شود"),
    ),
    (
        "sick",
        ("مریضی که روزه برای او ضرر دارد یا بیماری‌اش شدت می‌گیرد می‌تواند "
        "روزه را افطار کند و پس از بهبودی قضای آن را بگیرد و فدیه لازم نیست"),
    ),
]

# (کوئری، کلید gold)
_QUERIES: list[tuple[str, str]] = [
    ("مسافر نماز چهار رکعتی را قصر چگونه می‌خواند", "qasr"),
    ("مسافت شرعی سفر برای قصر نماز چقدر است", "distance"),
    ("نصاب زکات طلا چیست و زکات مال چه زمانی واجب می‌شود", "nisab"),
    ("زکات فطره بر چه کسی واجب است و کی داده می‌شود", "fitr"),
    ("کفاره افطار عمدی روزه در رمضان چیست", "kaffara"),
    ("مریض در ماه رمضان روزه را افطار کند قضای آن چیست", "sick"),
]


async def _seed_corpus(db, provider) -> dict[str, object]:
    ids: dict[str, object] = {}
    for key, text_value in _CORPUS:
        vector = (await provider.embed([text_value]))[0]
        chunk = FiqhKnowledgeChunk(
            chunk_text=text_value,
            embedding=list(vector),
            embedding_provider=provider.name,
            embedding_model=provider.model_name,
            source_type="rag_eval",
            workflow_status="approved",
            ai_scopes=["fatwa"],
        )
        db.add(chunk)
        await db.flush()
        ids[key] = chunk.id
    await db.commit()
    return ids


def _recall_and_mrr(ranks: list[int | None]) -> tuple[float, float]:
    hits = sum(1 for r in ranks if r is not None and r <= 3)
    recall = hits / len(ranks)
    mrr = sum(1.0 / r for r in ranks if r) / len(ranks)
    return recall, mrr


async def test_rag_eval_backend_b_and_vector_ranking(tc):
    provider = emb.HashEmbeddingProvider()
    async with tc["maker"]() as db:
        ids = await _seed_corpus(db, provider)

        # مسیر واقعی: ChunkIndex روی SQLite (Backend B)
        index = emb.ChunkIndex(provider)
        ranks_b: list[int | None] = []
        for query, gold_key in _QUERIES:
            results = await index.search(db, query, top_k=3)
            order = [r.chunk_id for r in results]
            ranks_b.append(
                order.index(ids[gold_key]) + 1 if ids[gold_key] in order else None
            )
        recall_b, mrr_b = _recall_and_mrr(ranks_b)

        # مسیر برداری خالص: همان ریاضی pgvector (ترتیب بر اساس کسینوس)
        from sqlalchemy import select

        rows = (
            (
                await db.execute(
                    select(FiqhKnowledgeChunk).where(
                        FiqhKnowledgeChunk.source_type == "rag_eval"
                    )
                )
            )
            .scalars()
            .all()
        )
        by_id = {c.id: c for c in rows}
        ranks_v: list[int | None] = []
        for query, gold_key in _QUERIES:
            query_vec = (await provider.embed([query]))[0]
            ranked = sorted(
                rows,
                key=lambda c: emb.cosine_similarity(query_vec, c.embedding or []),
                reverse=True,
            )[:3]
            order = [c.id for c in ranked]
            ranks_v.append(
                order.index(ids[gold_key]) + 1 if ids[gold_key] in order else None
            )
        recall_v, mrr_v = _recall_and_mrr(ranks_v)

    print(
        f"\nRAG-EVAL hash/BackendB recall@3={recall_b:.3f} mrr={mrr_b:.3f} | "
        f"vector-ranking recall@3={recall_v:.3f} mrr={mrr_v:.3f} | "
        f"ranks_b={ranks_b} ranks_v={ranks_v}"
    )
    assert by_id  # corpus خوانده شد
    assert recall_b >= 0.8
    assert mrr_b >= 0.7
    assert recall_v >= 0.8
    assert mrr_v >= 0.7
