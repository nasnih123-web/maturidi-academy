"""فاز ۲: ستون totp_enabled_at روی users — مبنای enrolled_at در GET /2fa/status.

Revision ID: a2fa20261021
Revises: c2a91f7e44b1
Create Date: 2026-10-21

Backward-compatible: ستون nullable اضافه می‌شود؛ ردیف‌های موجود (کاربران
ثبت‌نام‌کردهٔ قبلی) NULL می‌مانند و status برای آن‌ها enrolled_at=null
برمی‌گرداند (زمان دقیق فعال‌سازی قبلی قابل بازیابی نیست). downgrade ستون
را حذف می‌کند.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a2fa20261021"
down_revision: str | None = "c2a91f7e44b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "totp_enabled_at")
