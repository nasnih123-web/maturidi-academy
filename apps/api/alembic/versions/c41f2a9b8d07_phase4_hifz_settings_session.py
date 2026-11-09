"""Phase 4 (بازطراحی حفاظ) — تنظیم‌های حفظِ هر کاربر + بازه/موقعیت/تکرار نشست.

Revision ID: c41f2a9b8d07
Revises: 2e6a9529d1a0
Create Date: 2026-11-07

- جدول تازهٔ hifz_user_settings: freeze_on_error (پیش‌فرض خاموش =
  رفتار پرمیوم)، mistake_detection / tashkeel_detection (پیش‌فرض
  روشن)، resumable_sessions (پیش‌فرض خاموش)، hide_ayah_markers
  (پیش‌فرض خاموش). کلید اصلی user_id.
- ستون‌های تازه روی hifz_attempts: start_ayah / end_ayah (بازهٔ
  تمرین، NULL = کل سوره)، current_surah / current_ayah /
  current_word_index (آخرین موقعیتِ دنبال‌شده برای ازسرگیری)،
  repeat_ayah / repeat_range (شمار تکرار، پیش‌فرض ۱).

downgrade ستون‌ها و جدول تازه را حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'c41f2a9b8d07'
down_revision: str | None = '2e6a9529d1a0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hifz_user_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("freeze_on_error", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("mistake_detection", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("tashkeel_detection", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("resumable_sessions", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("hide_ayah_markers", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.add_column("hifz_attempts", sa.Column("start_ayah", sa.Integer(), nullable=True))
    op.add_column("hifz_attempts", sa.Column("end_ayah", sa.Integer(), nullable=True))
    op.add_column("hifz_attempts", sa.Column("current_surah", sa.Integer(), nullable=True))
    op.add_column("hifz_attempts", sa.Column("current_ayah", sa.Integer(), nullable=True))
    op.add_column(
        "hifz_attempts", sa.Column("current_word_index", sa.Integer(), nullable=True)
    )
    op.add_column(
        "hifz_attempts",
        sa.Column("repeat_ayah", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "hifz_attempts",
        sa.Column("repeat_range", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("hifz_attempts", "repeat_range")
    op.drop_column("hifz_attempts", "repeat_ayah")
    op.drop_column("hifz_attempts", "current_word_index")
    op.drop_column("hifz_attempts", "current_ayah")
    op.drop_column("hifz_attempts", "current_surah")
    op.drop_column("hifz_attempts", "end_ayah")
    op.drop_column("hifz_attempts", "start_ayah")
    op.drop_table("hifz_user_settings")
