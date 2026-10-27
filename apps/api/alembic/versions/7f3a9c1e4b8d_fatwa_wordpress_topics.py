"""فهرست وردپرسی فتوا — دسته‌ها و فیلدهای تازهٔ موضوع.

- جدول تازهٔ fatwa_categories: دسته‌ها در CRM تعریف می‌شوند و در فرم
  ثبت فتوا فقط از همین فهرست انتخاب می‌شوند (تایپ آزاد نیست).
- ستون‌های تازه روی fiqh_topics (همه nullable به‌جز شمارنده‌ها):
  category_id (FK با SET NULL)، author_name، featured_image_url،
  view_count، share_count، published_at.
- published_at موقع ورود به وضعیت published ثبت می‌شود و با بایگانی
  (archived) پاک نمی‌شود — تاریخ انتشار همان چیزی است که روی سایت
  به هر دو تقویم شمسی و قمری نشان داده می‌شود.

Revision ID: 7f3a9c1e4b8d
Revises: 05dda9586e39
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "7f3a9c1e4b8d"
down_revision = "05dda9586e39"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fatwa_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_fatwa_categories_slug", "fatwa_categories", ["slug"])
    op.add_column(
        "fiqh_topics",
        sa.Column("category_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "fiqh_topics",
        sa.Column("author_name", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "fiqh_topics",
        sa.Column("featured_image_url", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "fiqh_topics",
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "fiqh_topics",
        sa.Column("share_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "fiqh_topics",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_fiqh_topics_category_id", "fiqh_topics", ["category_id"])
    op.create_foreign_key(
        "fk_fiqh_topics_category_id",
        "fiqh_topics",
        "fatwa_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_fiqh_topics_category_id", "fiqh_topics", type_="foreignkey"
    )
    op.drop_index("ix_fiqh_topics_category_id", "fiqh_topics")
    op.drop_column("fiqh_topics", "published_at")
    op.drop_column("fiqh_topics", "share_count")
    op.drop_column("fiqh_topics", "view_count")
    op.drop_column("fiqh_topics", "featured_image_url")
    op.drop_column("fiqh_topics", "author_name")
    op.drop_column("fiqh_topics", "category_id")
    op.drop_index("ix_fatwa_categories_slug", "fatwa_categories")
    op.drop_table("fatwa_categories")
