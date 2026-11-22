"""آستانه‌های شخصی حفاظ (پیشنهاد ۱۳، سرعت حفاظ).

Revision ID: 440bf17e99bb
Revises: f2a3b4c5d6e7
Create Date: 2026-11-22

- دو ستونِ nullable روی hifz_user_settings: green_threshold و
  amber_threshold — آستانه‌های کالیبره‌شدهٔ هر کاربر، مشتق از
  تاریخچهٔ اعتراض‌هایش (calibrate_user_thresholds در hifz_service).
  NULL یعنی هنوز کالیبره نشده و آستانه‌های سراسری CRM حاکم‌اند.
- هیچ داده‌ای مهاجرت نمی‌کند: همهٔ ردیف‌های موجود NULL می‌گیرند.

downgrade هر دو ستون را حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '440bf17e99bb'
down_revision: str | None = 'f2a3b4c5d6e7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "hifz_user_settings",
        sa.Column("green_threshold", sa.Float(), nullable=True),
    )
    op.add_column(
        "hifz_user_settings",
        sa.Column("amber_threshold", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("hifz_user_settings", "amber_threshold")
    op.drop_column("hifz_user_settings", "green_threshold")
