"""بلیط یک‌بارمصرف WebSocket — hardening/audit-pass-1.

Revision ID: b21c9aa4d7e1
Revises: f17a0b1c2d3e
Create Date: 2026-10-19

Forward-only (§۱۲). جدول ws_tickets: بلیط کوتاه‌مدت (۶۰ ثانیه) و
یک‌بارمصرف برای handshake وب‌سوکت — جایگزین امن JWT در query string.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b21c9aa4d7e1"
down_revision: str | None = "f17a0b1c2d3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ws_tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ws_tickets_user_id", "ws_tickets", ["user_id"])
    op.create_index(
        "ix_ws_tickets_ticket_hash", "ws_tickets", ["ticket_hash"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_ws_tickets_ticket_hash", table_name="ws_tickets")
    op.drop_index("ix_ws_tickets_user_id", table_name="ws_tickets")
    op.drop_table("ws_tickets")
