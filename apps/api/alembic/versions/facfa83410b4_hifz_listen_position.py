"""مأموریت تکمیلی حفاظ — بخش ۵: جدول موقعیت شنیدنِ هر کاربر.

Revision ID: facfa83410b4
Revises: c41f2a9b8d07
Create Date: 2026-11-07

- جدول تازهٔ hifz_listen_positions: یک ردیف برای هر کاربر (کلید اصلی
  user_id) — آخرین قاری، سوره+آیه، موقعیت پخش (میلی‌ثانیه)، سرعت و
  وضعیت تکرارِ پلیر شنیداری. جدا از موقعیت نشست تمرین
  (hifz_attempts.current_*) است.
- هیچ دادهٔ صوتی در این جدول نیست — فقط شناسهٔ قاری و عددها.

downgrade جدول را حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'facfa83410b4'
down_revision: str | None = 'c41f2a9b8d07'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hifz_listen_positions",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reciter", sa.String(length=40), nullable=False, server_default="alafasy"),
        sa.Column("surah", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ayah", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("progress_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("speed", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("repeat_mode", sa.String(length=10), nullable=False, server_default="off"),
        sa.Column("repeat_ayah", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("repeat_range_start", sa.Integer(), nullable=True),
        sa.Column("repeat_range_end", sa.Integer(), nullable=True),
        sa.Column("repeat_range_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("hifz_listen_positions")
