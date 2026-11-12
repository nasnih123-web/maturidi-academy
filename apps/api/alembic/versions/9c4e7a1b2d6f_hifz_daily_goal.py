"""گام ۴ برابری حفاظ با ترتیل (PR ایجنت دوم) — هدف روزانهٔ کاربر.

Revision ID: 9c4e7a1b2d6f
Revises: facfa83410b4
Create Date: 2026-11-12

- ستون تازهٔ daily_goal_ayahs روی hifz_user_settings: هدف روزانه به
  واحد آیه (۰ = بدون هدف). مبنای «پیشرفت امروز»، رکورد پیوستگی
  (streak) و نقشهٔ مرور (heatmap) در داشبورد است؛ هر سه از دادهٔ
  واقعی نشست/نمره/مرور ساخته می‌شوند، نه از این ستون.
- server_default صفر یعنی ردیف‌های موجود بدون backfill هدف‌نداشته
  می‌مانند.

downgrade ستون را حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '9c4e7a1b2d6f'
down_revision: str | None = 'facfa83410b4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "hifz_user_settings",
        sa.Column(
            "daily_goal_ayahs",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("hifz_user_settings", "daily_goal_ayahs")
