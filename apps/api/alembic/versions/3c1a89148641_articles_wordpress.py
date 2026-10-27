"""مقالات وردپرسی — دسته‌ها و جدول مقالات.

- جدول تازهٔ article_categories: دسته‌ها در CRM تعریف می‌شوند و در فرم
  ثبت مقاله فقط از همین فهرست انتخاب می‌شوند (تایپ آزاد نیست).
- جدول تازهٔ articles: عنوان چندزبانه، بدنه به‌صورت JSON سند Tiptap،
  نامک یکتا (slug)، فیلدهای سئو، دسته (FK با SET NULL)، نویسنده،
  تصویر شاخص، شمارنده‌های بازدید/اشتراک‌گذاری و تاریخ انتشار.
- فقط جدول تازه ساخته می‌شود؛ هیچ ALTER روی جدول موجود نیست، پس
  روی SQLite هم بدون batch امن است.

Revision ID: 3c1a89148641
Revises: 7f3a9c1e4b8d
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "3c1a89148641"
down_revision = "7f3a9c1e4b8d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "article_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_article_categories_slug", "article_categories", ["slug"])
    op.create_table(
        "articles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.JSON(), nullable=False),
        sa.Column("body", sa.JSON(), nullable=False),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("seo_title", sa.String(length=200), nullable=True),
        sa.Column("seo_description", sa.String(length=500), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("author_name", sa.String(length=160), nullable=True),
        sa.Column("featured_image_url", sa.String(length=1024), nullable=True),
        sa.Column(
            "workflow_status", sa.String(length=16), nullable=False,
            server_default="draft",
        ),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("share_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["category_id"], ["article_categories.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_articles_slug", "articles", ["slug"])
    op.create_index("ix_articles_category_id", "articles", ["category_id"])
    op.create_index("ix_articles_workflow_status", "articles", ["workflow_status"])


def downgrade() -> None:
    op.drop_index("ix_articles_workflow_status", "articles")
    op.drop_index("ix_articles_category_id", "articles")
    op.drop_index("ix_articles_slug", "articles")
    op.drop_table("articles")
    op.drop_index("ix_article_categories_slug", "article_categories")
    op.drop_table("article_categories")
