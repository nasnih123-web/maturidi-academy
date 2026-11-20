"""زیرنویس‌های زمان‌دار (WebVTT) آیتم‌های ویدیویی — فاز ۳ بخش ویدیوها.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-11-20

- item_subtitles: یک ردیف برای هر (آیتم کتابخانه، زبان) با وضعیت تولید
  (pending|processing|ready|failed)، متن VTT و دلیل خطا. حذف آیتم،
  زیرنویس‌هایش را آبشاری پاک می‌کند.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'd0e1f2a3b4c5'
down_revision: str | None = 'c9d0e1f2a3b4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'item_subtitles',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('item_id', sa.Uuid(), nullable=False),
        sa.Column('lang', sa.String(length=8), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('vtt', sa.Text(), nullable=True),
        sa.Column('error', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ['item_id'], ['library_items.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'item_id', 'lang', name='uq_item_subtitles_item_lang'
        ),
    )
    op.create_index(
        op.f('ix_item_subtitles_item_id'), 'item_subtitles', ['item_id']
    )
    op.create_index(
        op.f('ix_item_subtitles_status'), 'item_subtitles', ['status']
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_item_subtitles_status'), table_name='item_subtitles')
    op.drop_index(op.f('ix_item_subtitles_item_id'), table_name='item_subtitles')
    op.drop_table('item_subtitles')
