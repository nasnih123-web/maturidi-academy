"""FIX2-03 — وحدت resolve provider + ثبت هویت روی chunk + نگهبان اختلاط.

باگ اصلی: ingestion با پیش‌فرض خودش (`or "hash"`) ایندکس می‌کرد ولی
بازیابی با resolve_provider_name — در production دانش با hash ایندکس
و با local_model بازیابی می‌شد (کسینوس بین دو فضا). قرارداد جدید:

- ingestion از همان resolve_provider_name واحد استفاده می‌کند.
- هر chunk هویت (provider, model) سازندهٔ بردارش را حمل می‌کند.
- بازیابی به chunkِ provider دیگر امتیاز معنایی نمی‌دهد؛ ردیف‌های
  legacy (بدون هویت) در semantic_search_status به‌عنوان نیازمند
  reindex شمرده و expose می‌شوند.
"""
from __future__ import annotations

import pytest
from sqlalchemy import delete, select

from app.models.models import FiqhKnowledgeChunk, IngestionRun
from app.modules.fatwa import embeddings as emb
from app.modules.fatwa.ingestion import run_ingestion


@pytest.fixture(autouse=True)
async def _cleanup_chunks(tc):
    """دیتابیس تست مشترک است — chunkهای این فایل (به‌خصوص approvedها)
    نباید به جست‌وجو/پرسش تست‌های دیگر نشت کنند."""
    yield
    async with tc["maker"]() as db:
        await db.execute(
            delete(FiqhKnowledgeChunk).where(
                (FiqhKnowledgeChunk.source_type == "fix2_test")
                | (FiqhKnowledgeChunk.topic_category == "fix2_ingest")
            )
        )
        await db.commit()

_TEXT = (
    "پاراگراف اول دربارهٔ احکام نماز مسافر است و توضیح می‌دهد که "
    "مسافر نمازهای چهار رکعتی را دو رکعت می‌خواند و این حکم در سفر "
    "شرعی با شرایط معین ثابت است و باید مستند بیان شود.\n\n"
    "پاراگراف دوم دربارهٔ روزهٔ مسافر است و می‌گوید مسافر می‌تواند "
    "روزه را افطار کند و قضای آن را در روزهای دیگر به‌جا آورد و این "
    "رخصت برای راحتی مسافران در سفر تشریع شده است."
)


async def _run_ingestion(tc) -> dict:
    async with tc["maker"]() as db:
        run = IngestionRun(source_type="text", status="queued", stats={})
        db.add(run)
        await db.flush()
        run_id = run.id
        await db.commit()
    async with tc["maker"]() as db:
        stats = await run_ingestion(
            db,
            run_id,
            source_type="text",
            payload={"text": _TEXT},
            topic_category="fix2_ingest",
            ai_scopes=["fatwa"],
        )
        await db.commit()
    return stats


async def test_ingestion_uses_single_resolve_and_records_identity(tc, monkeypatch):
    calls = 0
    original = emb.resolve_provider_name

    async def _spy(db):
        nonlocal calls
        calls += 1
        return await original(db)

    monkeypatch.setattr(emb, "resolve_provider_name", _spy)

    stats = await _run_ingestion(tc)
    assert calls >= 1, "ingestion باید از resolve_provider_name واحد استفاده کند"
    assert stats["stages"]["embed"]["provider"] == "hash"  # پیش‌فرض محیط تست
    assert stats["stages"]["embed"]["model"] == "hash-trigram-v1"

    async with tc["maker"]() as db:
        chunks = (
            (
                await db.execute(
                    select(FiqhKnowledgeChunk).where(
                        FiqhKnowledgeChunk.topic_category == "fix2_ingest"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert chunks, "ingestion باید chunk ساخته باشد"
    for chunk in chunks:
        assert chunk.embedding_provider == "hash"
        assert chunk.embedding_model == "hash-trigram-v1"


async def _add_chunk(db, text_value: str, vector, provider, model=None):
    chunk = FiqhKnowledgeChunk(
        chunk_text=text_value,
        embedding=list(vector),
        embedding_provider=provider,
        embedding_model=model,
        source_type="fix2_test",
        workflow_status="approved",
        ai_scopes=["fatwa"],
    )
    db.add(chunk)
    await db.flush()
    return chunk


async def test_retrieval_never_mixes_other_provider_vectors(tc):
    provider = emb.HashEmbeddingProvider()
    query = "حکم نماز مسافر در سفر چیست"
    query_vec = (await provider.embed([query]))[0]

    async with tc["maker"]() as db:
        # chunk هم‌provider با بردار واقعی کوئری
        await _add_chunk(db, "نماز مسافر قصر خوانده می‌شود", query_vec, "hash",
                         "hash-trigram-v1")
        # chunk با بردار یکسان ولی provider دیگر — نباید امتیاز معنایی بگیرد
        foreign = await _add_chunk(
            db, "متن کاملاً نامرتبط آشپزی خورشت", query_vec, "local_model",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        # ردیف legacy بدون هویت
        legacy = await _add_chunk(db, "ردیف قدیمی بدون هویت", query_vec, None)
        await db.commit()
        foreign_id, legacy_id = foreign.id, legacy.id

        results = await emb.ChunkIndex(provider).search(db, query, top_k=10)
        by_id = {r.chunk_id: r for r in results}

        assert by_id[foreign_id].semantic == 0.0
        # legacy فعلاً خوانده می‌شود (امتیاز معنایی دارد) ولی expose می‌شود
        assert by_id[legacy_id].semantic > 0.0

        stats = await emb.chunk_provider_stats(db, "hash")
        assert stats["chunks_other_provider"] >= 1
        assert stats["chunks_without_provider"] >= 1
        assert stats["reindex_recommended"] is True

        status = await emb.semantic_search_status(db)
        assert status["chunks_other_provider"] >= 1
        assert status["reindex_recommended"] is True


def test_fit_dim_folding_preserves_tail_signal():
    """سیگنالی که فقط بعد از بُعد ۲۵۶ است با برش گم می‌شد؛ folding نگهش می‌دارد."""
    dim = emb.EMBEDDING_DIM
    a = [0.0] * 384
    b = [0.0] * 384
    for i in range(300, 384):
        a[i] = 1.0
        b[i] = 1.0
    sliced_cos = emb.cosine_similarity(a[:dim], b[:dim]) if any(a[:dim]) else 0.0
    folded_cos = emb.cosine_similarity(emb.fit_dim(a), emb.fit_dim(b))
    assert sliced_cos == 0.0
    assert folded_cos > 0.99
    # بردار کوتاه: folding معادل pad است (قرارداد قبلی حفظ می‌شود)
    short = emb.fit_dim([3.0, 4.0])
    assert len(short) == dim
    assert abs(short[0] - 0.6) < 1e-9 and abs(short[1] - 0.8) < 1e-9
