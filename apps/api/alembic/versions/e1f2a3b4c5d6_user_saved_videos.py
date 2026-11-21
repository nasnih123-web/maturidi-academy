"""ویدیوهای ذخیره‌شدهٔ کاربران (نشانک «ذخیره» در صفحهٔ تماشا).

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-11-21

- user_saved_videos: یک ردیف برای هر (کاربر، آیتم ویدیویی)؛ یکتا روی
  (user_id, item_id) و حذف آبشاری از هر دو سمت.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'e1f2a3b4c5d6'
down_revision: str | None = 'd0e1f2a3b4c5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_saved_videos',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('item_id', sa.Uuid(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['item_id'], ['library_items.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'item_id',
            name='uq_user_saved_videos_user_item',
        ),
    )
    op.create_index(
        'ix_user_saved_videos_user_id', 'user_saved_videos', ['user_id'],
    )
    op.create_index(
        'ix_user_saved_videos_item_id', 'user_saved_videos', ['item_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_user_saved_videos_item_id', table_name='user_saved_videos')
    op.drop_index('ix_user_saved_videos_user_id', table_name='user_saved_videos')
    op.drop_table('user_saved_videos')
