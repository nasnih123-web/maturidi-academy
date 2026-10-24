"""FIX2-03: هویت provider/model امبدینگ روی chunkهای دانش — ADR-0042.

دو ستون nullable روی fiqh_knowledge_chunks:
- embedding_provider: نام provider سازندهٔ بردار (hash/external_api/
  local_model) — بازیابی معنایی بردار provider دیگر را قاطی نمی‌کند.
- embedding_model: هویت مدل (مثلاً نام مدل external یا نسخهٔ hash).

ردیف‌های موجود NULL می‌مانند = legacy؛ در semantic_search_status
به‌عنوان نیازمند reindex شمرده و expose می‌شوند. هر دو dialect
(SQLite/PostgreSQL) با add_column ساده امن است.

Revision ID: a4b5c6d7e8f9
Revises: f3c4d5e6a7b8
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a4b5c6d7e8f9"
down_revision = "f3c4d5e6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fiqh_knowledge_chunks",
        sa.Column("embedding_provider", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "fiqh_knowledge_chunks",
        sa.Column("embedding_model", sa.String(length=128), nullable=True),
    )
    op.create_index(
        "ix_fiqh_knowledge_chunks_embedding_provider",
        "fiqh_knowledge_chunks",
        ["embedding_provider"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_fiqh_knowledge_chunks_embedding_provider",
        table_name="fiqh_knowledge_chunks",
    )
    op.drop_column("fiqh_knowledge_chunks", "embedding_model")
    op.drop_column("fiqh_knowledge_chunks", "embedding_provider")
