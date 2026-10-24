"""M-04 (audit 197efa0): ستون‌های claim برای dispatcher — ADR-0035.

claimed_by / claimed_at روی domain_events: dispatcherها batch را
با claim اتمیک می‌گیرند (روی PostgreSQL با FOR UPDATE SKIP LOCKED؛
روی بقیه با UPDATE گارددار قابل‌حمل) تا هر رویداد دقیقاً یک‌بار
منتشر شود؛ claim منقضی (TTL) توسط dispatcher دیگر قابل‌گرفتن است.

Revision ID: f3c4d5e6a7b8
Revises: e2b3c4d5f6a7
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "f3c4d5e6a7b8"
down_revision = "e2b3c4d5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "domain_events",
        sa.Column("claimed_by", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "domain_events",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_domain_events_claimed_at", "domain_events", ["claimed_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_domain_events_claimed_at", table_name="domain_events")
    op.drop_column("domain_events", "claimed_at")
    op.drop_column("domain_events", "claimed_by")
