"""سطل زبالهٔ کاربران (حذف نرم) + رویدادهای فعالیت کاربر.

Revision ID: f6a7b8c9d0e1
Revises: c2b0cc7d091a
Create Date: 2026-11-19

- users.deleted_at / users.deleted_by: حذف کاربر از این پس نرم است —
  ردیف و همهٔ سابقه‌اش می‌ماند و کاربر به «سطل زباله» در CRM می‌رود؛
  حذف دائمی فقط از داخل سطل ممکن است.
- user_activity_events: رویدادهای رفتاری‌ای که جدول اختصاصی ندارند
  (پخش صوت/ویدیو، دانلود کتابخانه و…) تا در خط زمانی ۳۶۰° دیده شوند.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'f6a7b8c9d0e1'
down_revision: str | None = 'c2b0cc7d091a'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # batch mode: deleted_by carries a self-FK — SQLite cannot ALTER a
    # constraint in place, so the users changes go through batch mode
    # (a plain passthrough on PostgreSQL).
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.add_column(
            sa.Column(
                'deleted_by',
                sa.Uuid(),
                sa.ForeignKey('users.id', name='fk_users_deleted_by'),
                nullable=True,
            ),
        )
    op.create_table(
        'user_activity_events',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column(
            'user_id',
            sa.Uuid(),
            sa.ForeignKey('users.id'),
            nullable=False,
        ),
        sa.Column('kind', sa.String(length=48), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=True),
        sa.Column('ref_type', sa.String(length=48), nullable=True),
        sa.Column('ref_id', sa.String(length=64), nullable=True),
        sa.Column(
            'meta',
            sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_user_activity_events_user_id',
        'user_activity_events',
        ['user_id'],
    )
    op.create_index(
        'ix_user_activity_events_kind',
        'user_activity_events',
        ['kind'],
    )
    op.create_index(
        'ix_user_activity_events_created_at',
        'user_activity_events',
        ['created_at'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_user_activity_events_created_at',
        table_name='user_activity_events',
    )
    op.drop_index(
        'ix_user_activity_events_kind',
        table_name='user_activity_events',
    )
    op.drop_index(
        'ix_user_activity_events_user_id',
        table_name='user_activity_events',
    )
    op.drop_table('user_activity_events')
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('deleted_by')
        batch_op.drop_column('deleted_at')
