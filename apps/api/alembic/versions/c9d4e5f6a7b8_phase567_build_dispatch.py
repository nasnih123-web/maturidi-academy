"""فاز ۵/۶/۷: ستون‌های dispatch واقعی روی build_requests (F-05 remediation).

Revision ID: c9d4e5f6a7b8
Revises: a2fa20261021
Create Date: 2026-10-21

Backward-compatible: همهٔ ستون‌ها nullable یا با default خنثی اضافه می‌شوند؛
ردیف‌های legacy (فاز ۱۴) provider=NULL می‌مانند — یعنی «هرگز dispatch
نشده‌اند» و همین‌طور هم در UI/API گزارش می‌شوند. downgrade ستون‌ها را
حذف می‌کند.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9d4e5f6a7b8"
down_revision: str | None = "a2fa20261021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "build_requests",
        sa.Column("branding", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "build_requests", sa.Column("provider", sa.String(32), nullable=True)
    )
    op.add_column(
        "build_requests",
        sa.Column("provider_run_id", sa.String(32), nullable=True),
    )
    op.add_column(
        "build_requests",
        sa.Column("provider_run_url", sa.String(1024), nullable=True),
    )
    op.add_column(
        "build_requests",
        sa.Column("artifact_name", sa.String(255), nullable=True),
    )
    op.add_column(
        "build_requests",
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("build_requests", "dispatched_at")
    op.drop_column("build_requests", "artifact_name")
    op.drop_column("build_requests", "provider_run_url")
    op.drop_column("build_requests", "provider_run_id")
    op.drop_column("build_requests", "provider")
    op.drop_column("build_requests", "branding")
