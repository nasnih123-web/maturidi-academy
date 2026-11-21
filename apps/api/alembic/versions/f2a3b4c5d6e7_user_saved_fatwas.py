"""فتواهای ذخیره‌شدهٔ کاربران (نشانک «ذخیره» در صفحهٔ فتوا).

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-11-21

- user_saved_fatwas: یک ردیف برای هر (کاربر، فتوای منتشرشده)؛ یکتا روی
  (user_id, fatwa_id) و حذف آبشاری از هر دو سمت. فتوا همان FiqhTopic
  است (fiqh_topics).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'f2a3b4c5d6e7'
down_revision: str | None = 'e1f2a3b4c5d6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_saved_fatwas',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('fatwa_id', sa.Uuid(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['fatwa_id'], ['fiqh_topics.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'fatwa_id',
            name='uq_user_saved_fatwas_user_fatwa',
        ),
    )
    op.create_index(
        'ix_user_saved_fatwas_user_id', 'user_saved_fatwas', ['user_id'],
    )
    op.create_index(
        'ix_user_saved_fatwas_fatwa_id', 'user_saved_fatwas', ['fatwa_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_user_saved_fatwas_fatwa_id', table_name='user_saved_fatwas')
    op.drop_index('ix_user_saved_fatwas_user_id', table_name='user_saved_fatwas')
    op.drop_table('user_saved_fatwas')
