"""B-03 (audit 197efa0): pgvector واقعی برای RAG فتوا — ADR-0026.

روی PostgreSQL:
- CREATE EXTENSION IF NOT EXISTS vector و pg_trgm
- ستون embedding_vec vector(256) روی fiqh_knowledge_chunks
- بک‌فیل از ستون JSON موجود (embedding::text)::vector
- ایندکس HNSW روی embedding_vec (عملگر cosine <=>)
- ایندکس GIN تری‌گرام روی chunk_text برای بازیابی واژگانی داخل DB

روی SQLite (dev/test): فقط ستون اضافه می‌شود (نوع Vector در SQLite
به‌صورت نوع تعریف‌شدهٔ کاربر ساخته می‌شود و خالی می‌ماند؛ بازیابی
آن‌جا Backend B است) — هیچ DDL مخصوص Postgres اجرا نمی‌شود.

Revision ID: e2b3c4d5f6a7
Revises: d1a2b3c4e5f6
"""
from __future__ import annotations

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

revision: str = "e2b3c4d5f6a7"
down_revision: str | None = "d1a2b3c4e5f6"
branch_labels: str | None = None
depends_on: str | None = None

EMBEDDING_DIM = 256  # = EMBEDDING_DIM در modules/fatwa/embeddings.py


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.add_column(
        "fiqh_knowledge_chunks",
        sa.Column("embedding_vec", Vector(EMBEDDING_DIM), nullable=True),
    )
    if is_pg:
        # بک‌فیل از JSON موجود — همان داده‌ای که Backend B می‌خواند
        op.execute(
            "UPDATE fiqh_knowledge_chunks "
            "SET embedding_vec = (embedding::text)::vector "
            "WHERE embedding IS NOT NULL AND embedding_vec IS NULL"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_fiqh_chunks_embedding_vec_hnsw "
            "ON fiqh_knowledge_chunks USING hnsw (embedding_vec vector_cosine_ops)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_fiqh_chunks_text_trgm "
            "ON fiqh_knowledge_chunks USING gin (chunk_text gin_trgm_ops)"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_fiqh_chunks_text_trgm")
        op.execute("DROP INDEX IF EXISTS ix_fiqh_chunks_embedding_vec_hnsw")
    op.drop_column("fiqh_knowledge_chunks", "embedding_vec")
    # اکستنشن‌ها عمداً حذف نمی‌شوند: ممکن است مصرف‌کنندهٔ دیگری داشته باشند.
