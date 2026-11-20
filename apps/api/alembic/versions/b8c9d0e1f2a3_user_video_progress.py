"""موقعیت پخش کاربران روی ویدیوها (ادامهٔ تماشا در پلیر حرفه‌ای).

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-11-20

- user_video_progress: یک ردیف برای هر (کاربر، آیتم ویدیویی) با
  position_seconds/duration_seconds؛ یکتا روی (user_id, item_id) و
  حذف آبشاری از هر دو سمت.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'b8c9d0e1f2a3'
down_revision: str | None = 'a7b8c9d0e1f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_video_progress',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('item_id', sa.Uuid(), nullable=False),
        sa.Column('position_seconds', sa.Float(), nullable=False),
        sa.Column('duration_seconds', sa.Float(), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), nullable=False,
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
            name='uq_user_video_progress_user_item',
        ),
    )
    op.create_index(
        'ix_user_video_progress_user_id', 'user_video_progress', ['user_id'],
    )
    op.create_index(
        'ix_user_video_progress_item_id', 'user_video_progress', ['item_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_user_video_progress_item_id', table_name='user_video_progress',
    )
    op.drop_index(
        'ix_user_video_progress_user_id', table_name='user_video_progress',
    )
    op.drop_table('user_video_progress')
