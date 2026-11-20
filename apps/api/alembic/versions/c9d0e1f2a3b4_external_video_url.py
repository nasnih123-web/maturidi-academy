"""لینک ویدیوی خارجی (یوتیوب) برای آیتم‌های کتابخانه.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-11-20

- library_items.external_url: URL کانونیک ویدیوی یوتیوب (فقط kind=video).
- library_items.media_key از این پس nullable است: آیتم خارجی فایل ندارد.
  آیتم‌های آپلودی همچنان همیشه media_key دارند (قاعده در سرویس اعمال می‌شود).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'c9d0e1f2a3b4'
down_revision: str | None = 'b8c9d0e1f2a3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'library_items',
        sa.Column('external_url', sa.String(length=600), nullable=True),
    )
    with op.batch_alter_table('library_items') as batch_op:
        batch_op.alter_column(
            'media_key',
            existing_type=sa.String(length=1024),
            nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table('library_items') as batch_op:
        batch_op.alter_column(
            'media_key',
            existing_type=sa.String(length=1024),
            nullable=False,
        )
    op.drop_column('library_items', 'external_url')
