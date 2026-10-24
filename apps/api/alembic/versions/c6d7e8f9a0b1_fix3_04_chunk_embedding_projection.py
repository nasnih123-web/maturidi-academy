"""FIX3-04: هویت پروجکشن امبدینگ روی chunkهای دانش — ADR-0051.

یک ستون nullable روی fiqh_knowledge_chunks:
- embedding_projection: نام/نسخهٔ الگوریتم پروجکشن سازندهٔ بردار
  (فعلی: «folding-v1» — fit_dim از FIX2-03). بردارهای پیش از
  FIX2-03 با برش سادهٔ ۲۵۶ مؤلفهٔ اول ساخته شده‌اند ولی هیچ نشانی
  ندارند؛ پس ردیف‌های موجود NULL می‌مانند = «پروجکشن نامعلوم/
  legacy» و در گزارش سازگاری (chunk_compatibility_report)
  ناسازگار شمرده و با ابزار reindex بازنمایه می‌شوند.

هر دو dialect (SQLite/PostgreSQL) با add_column ساده امن است.

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "c6d7e8f9a0b1"
down_revision = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fiqh_knowledge_chunks",
        sa.Column("embedding_projection", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("fiqh_knowledge_chunks", "embedding_projection")
