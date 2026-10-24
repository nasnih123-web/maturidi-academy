"""Pass 4 / C1: زمان آخرین تلاش ناموفق روی رویدادهای outbox.

یک ستون nullable روی domain_events:
- last_attempt_at: زمان آخرین publish ناموفق. backoff نمایی
  dispatcher از این زمان محاسبه می‌شود، نه از created_at.

NULL امن است: ردیف‌های قدیمی (پیش از این مهاجرت) هنوز تلاش
ناموفقی نداشته‌اند و مبنای backoffشان created_at می‌ماند
(fallback در _backoff_eligible). downgrade ستون را حذف می‌کند —
دادهٔ backoffِ موقت است، نه دادهٔ کسب‌وکاری؛ رویدادها خودشان
حفظ می‌شوند.

Revision ID: 05dda9586e39
Revises: c6d7e8f9a0b1
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "05dda9586e39"
down_revision = "c6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "domain_events",
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("domain_events", "last_attempt_at")
