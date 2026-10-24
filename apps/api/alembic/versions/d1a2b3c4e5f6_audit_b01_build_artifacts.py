"""B-01 (audit 197efa0): build_releases artifact columns — ADR-0025.

حلقهٔ بیلد بسته می‌شود: workflow فایل ساخته‌شده را به باکت builds در
MinIO می‌فرستد و کلید آبجکت + اندازه + sha256 روی رکورد release ثبت
می‌شود؛ download_url پاسخ از همین کلید با URL امضاشدهٔ کوتاه‌عمر ساخته
می‌شود. هر سه ستون nullable‌اند — ردیف‌های قدیمی (ثبت دستی بدون فایل)
دست‌نخورده می‌مانند.

Revision ID: d1a2b3c4e5f6
Revises: c9d4e5f6a7b8
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "d1a2b3c4e5f6"
down_revision: str | None = "c9d4e5f6a7b8"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "build_releases", sa.Column("artifact_key", sa.String(512), nullable=True)
    )
    op.add_column(
        "build_releases",
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "build_releases", sa.Column("sha256", sa.String(64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("build_releases", "sha256")
    op.drop_column("build_releases", "file_size_bytes")
    op.drop_column("build_releases", "artifact_key")
