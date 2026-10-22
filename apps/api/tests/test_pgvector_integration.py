"""تست یکپارچهٔ pgvector روی PostgreSQL واقعی — فقط CI (B-03، ADR-0026).

بدون env PG_INTEGRATION_DATABASE_URL کل ماژول صادقانه skip می‌شود
(در sandbox داکر/PostgreSQL نیست — NOT RUN LOCALLY). در CI، job
postgres-integration در ci.yml سرویس pgvector/pgvector:pg16 را بالا
می‌آورد، مهاجرت‌ها را روی همان دیتابیس اجرا می‌کند و این تست را با
DATABASE_URL واقعی صدا می‌زند.

اثبات اصلی: chunk شمارهٔ ۵۰۱ — قدیمی‌ترین chunk، بیرون از سقف اسکن
۵۰۰تاییِ قبلی (order by created_at desc limit 500) — با جست‌وجوی
واقعی ChunkIndex روی مسیر pgvector پیدا می‌شود.
"""
from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

PG_URL = os.environ.get("PG_INTEGRATION_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not PG_URL,
    reason="PG_INTEGRATION_DATABASE_URL تنظیم نیست — تست CI با PostgreSQL واقعی",
)

TARGET_TEXT = (
    "حکم وضو با آب مستعمل در مذهب حنفی چیست و دلیل آن از کتاب الهدایه "
    "و بدائع الصنائع چگونه استنباط می شود"
)
FILLER_TEXT = "متن عمومی دربارهٔ احکام طهارت و نماز و روزه در فقه اسلامی"


@pytest.fixture
async def pg_session():
    from app.core.config import get_settings

    # pgvector_available() به database_url تنظیمات نگاه می‌کند — در CI
    # DATABASE_URL همان دیتابیس PG سرویس است.
    assert get_settings().database_url.startswith("postgresql"), (
        "DATABASE_URL باید دیتابیس PG سرویس CI باشد"
    )
    engine = create_async_engine(PG_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def test_pgvector_schema_from_migration(pg_session):
    """اکستنشن‌ها + ستون vector + ایندکس HNSW واقعاً ساخته شده‌اند."""
    ext = {
        r[0]
        for r in (
            await pg_session.execute(
                text("SELECT extname FROM pg_extension")
            )
        ).all()
    }
    assert "vector" in ext and "pg_trgm" in ext
    idx = {
        r[0]
        for r in (
            await pg_session.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename = 'fiqh_knowledge_chunks'"
                )
            )
        ).all()
    }
    assert "ix_fiqh_chunks_embedding_vec_hnsw" in idx
    assert "ix_fiqh_chunks_text_trgm" in idx


async def test_chunk_501_retrievable_via_pgvector(pg_session):
    """chunk قدیمیِ #۵۰۱ (بیرون از سقف قدیمی) با جست‌وجوی واقعی پیدا می‌شود."""
    from app.models.models import FiqhKnowledgeChunk
    from app.modules.fatwa.embeddings import ChunkIndex, HashEmbeddingProvider

    db = pg_session
    provider = HashEmbeddingProvider()
    marker = uuid.uuid4().hex[:8]
    target_text = f"{TARGET_TEXT} {marker}"
    filler_text = f"{FILLER_TEXT} {marker}"

    target_vec = (await provider.embed([target_text]))[0]
    filler_vec = (await provider.embed([filler_text]))[0]
    old = datetime.now(UTC) - timedelta(days=30)

    # اول هدف (قدیمی‌ترین) و بعد ۵۹۹ فیلر تازه‌تر: با سقف قدیمیِ
    # «۵۰۰ تازه‌ترین» هدف هرگز وارد اسکن نمی‌شد.
    target = FiqhKnowledgeChunk(
        chunk_text=target_text,
        embedding=target_vec,
        embedding_vec=target_vec,
        source_type="integration_test",
        workflow_status="approved",
        ai_scopes=["fatwa"],
        created_at=old,
        updated_at=old,
    )
    db.add(target)
    await db.flush()
    target_id = target.id
    for _ in range(599):
        db.add(
            FiqhKnowledgeChunk(
                chunk_text=filler_text,
                embedding=filler_vec,
                embedding_vec=filler_vec,
                source_type="integration_test",
                workflow_status="approved",
                ai_scopes=["fatwa"],
            )
        )
    await db.commit()

    index = ChunkIndex(provider)
    results = await index.search(db, target_text, top_k=5, ai_scope="fatwa")
    ids = [str(r.chunk_id) for r in results]
    assert str(target_id) in ids, f"chunk #501 پیدا نشد: {ids}"
    # هدف باید رتبهٔ اول باشد: lexical و semantic هر دو ۱٫۰
    assert ids[0] == str(target_id)
    assert results[0].semantic > 0.99
