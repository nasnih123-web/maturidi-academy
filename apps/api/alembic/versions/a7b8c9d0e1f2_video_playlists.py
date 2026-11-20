"""لیست‌های پخش بخش ویدیوها.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-20

- video_playlists: گروه‌بندی ویدیوهای کتابخانه (عنوان/توضیح چندزبانه،
  کاور، مدرس، انتشار، ترتیب نمایشی).
- video_playlist_items: عضویت آیتم ویدیویی در لیست با position؛
  یکتا روی (playlist_id, item_id) و حذف آبشاری از هر دو سمت.

بخش «videos» صفحهٔ اصلی از این مهاجرت نمی‌آید: ردیف home_sections آن
را seed idempotent در app/seed.py (HOME_SECTIONS_SEED) در هر بوت
می‌سازد/به‌روز می‌کند — همان سازوکار بقیهٔ بخش‌ها.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'a7b8c9d0e1f2'
down_revision: str | None = 'f6a7b8c9d0e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'video_playlists',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column(
            'title',
            sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'),
            nullable=False,
        ),
        sa.Column(
            'description',
            sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'),
            nullable=True,
        ),
        sa.Column('cover_media_key', sa.String(length=1024), nullable=True),
        sa.Column('scholar_id', sa.Uuid(), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), nullable=False,
        ),
        sa.ForeignKeyConstraint(['scholar_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_video_playlists_scholar_id', 'video_playlists', ['scholar_id'],
    )
    op.create_index(
        'ix_video_playlists_created_at', 'video_playlists', ['created_at'],
    )
    op.create_table(
        'video_playlist_items',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('playlist_id', sa.Uuid(), nullable=False),
        sa.Column('item_id', sa.Uuid(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['item_id'], ['library_items.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['playlist_id'], ['video_playlists.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'playlist_id', 'item_id',
            name='uq_video_playlist_items_playlist_item',
        ),
    )
    op.create_index(
        'ix_video_playlist_items_playlist_id',
        'video_playlist_items',
        ['playlist_id'],
    )
    op.create_index(
        'ix_video_playlist_items_item_id', 'video_playlist_items', ['item_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_video_playlist_items_item_id', table_name='video_playlist_items',
    )
    op.drop_index(
        'ix_video_playlist_items_playlist_id',
        table_name='video_playlist_items',
    )
    op.drop_table('video_playlist_items')
    op.drop_index('ix_video_playlists_created_at', table_name='video_playlists')
    op.drop_index('ix_video_playlists_scholar_id', table_name='video_playlists')
    op.drop_table('video_playlists')
