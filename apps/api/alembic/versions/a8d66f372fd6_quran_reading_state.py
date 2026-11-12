"""گام ۸ توسعهٔ برابری با ترتیل (PR ایجنت دوم) — همگام‌سازی حسابیِ
وضعیت خواندن قرآن (ایراد ۱۱).

Revision ID: a8d66f372fd6
Revises: 9c4e7a1b2d6f
Create Date: 2026-11-12

- جدول تازهٔ user_reading_states: یک ردیف به‌ازای هر کاربر با
  نشان‌ها (JSON) و آخرین موقعیت خواندن (JSON) و ساعت منطقی وضعیت
  (state_updated_at، میلی‌ثانیه) برای قانون تعارض «تازه‌ترین برنده
  است». تا این مهاجرت این داده‌ها فقط localStorage مرورگر بودند.
- downgrade جدول را حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'a8d66f372fd6'
down_revision: str | None = '9c4e7a1b2d6f'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_reading_states",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bookmarks", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("last_read", sa.JSON(), nullable=True),
        sa.Column("state_updated_at", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_reading_states")
