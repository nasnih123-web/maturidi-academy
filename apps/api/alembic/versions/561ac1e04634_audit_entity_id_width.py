"""Widen audit_logs.entity_id from 128 to 512 characters.

Root cause (2026-11-03): update_settings passes entity_id as the
comma-joined list of changed setting keys. The Quran display tab always
sends all 12 display keys (248 chars), which exceeds the String(128)
column, so INSERT INTO audit_logs fails with DBAPIError and the whole
settings PUT returns 500 (and, because the 500 bypasses CORS headers,
the CRM shows "Failed to fetch"). Single-key saves (<= 26 chars) fit.
512 covers the current 248 with room for future keys; new_values (JSONB)
already carries the full key map, so no audit data is lost.

Downgrade note: fails on rows whose entity_id is already longer than
128 characters (standard for a narrowing migration).
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "561ac1e04634"
down_revision = "99211a611221"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.alter_column(
            "entity_id",
            existing_type=sa.String(128),
            type_=sa.String(512),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.alter_column(
            "entity_id",
            existing_type=sa.String(512),
            type_=sa.String(128),
            existing_nullable=True,
        )
