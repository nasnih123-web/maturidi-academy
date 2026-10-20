"""Phase 9 — Multimedia Library DMS: library_items + library_item_versions.

Revision ID: 74f3c6f810a58fac
Revises: f8a4b6c2d9e1
Create Date: 2026-10-19

Forward-only (§۱۲). ADR-0007 documents the contracts.
Conventions (§۱۵):
- FKs only to tables that exist in this or earlier phases (users; the
  versions table FKs library_items, created in this same migration).
- §۹.۵ no future-FK coupling: related_lesson_id is a nullable UUID with NO
  physical FK (a string ref in spirit; lessons exist in phase 8 but we keep
  the library decoupled), religious_place_ref is a nullable string reserved
  for phase 11.
- UTC everywhere; DateTime(timezone=True).
- All user-visible text columns are LocalizedText JSON (never single-language).
- AI indexing is separate from publication: ai_indexed defaults false.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '74f3c6f810a58fac'
down_revision: str | None = 'f8a4b6c2d9e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_pk() -> list:
    return [sa.Column('id', sa.Uuid(), nullable=False)]


def upgrade() -> None:
    op.create_table(
        'library_items',
        *_id_pk(),
        sa.Column('kind', sa.String(length=16), nullable=False),  # video/video_360/pdf/audio/mindmap
        sa.Column('title', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('description', sa.JSON(), nullable=True),  # LocalizedText
        sa.Column('cover_media_key', sa.String(length=1024), nullable=True),
        sa.Column('media_key', sa.String(length=1024), nullable=False),
        sa.Column('scholar_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('topic_tags', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('related_lesson_id', sa.Uuid(), nullable=True),  # no FK — §۹.۵
        sa.Column('religious_place_ref', sa.String(length=128), nullable=True),  # reserved phase 11
        sa.Column('visibility', sa.String(length=16), nullable=False, server_default='registered'),
        sa.Column('workflow_status', sa.String(length=16), nullable=False, server_default='draft'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('ai_scopes', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('include_in_fatwa_rag', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('ai_indexed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('download_policy', sa.JSON(), nullable=True),
        sa.Column('transcript', sa.Text(), nullable=True),
        sa.Column('transcript_status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('ocr_text', sa.Text(), nullable=True),
        sa.Column('ocr_status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('processing_error', sa.Text(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('file_size_bytes', sa.Integer(), nullable=True),
        sa.Column('mime_type', sa.String(length=128), nullable=True),
        sa.Column('source_type', sa.String(length=16), nullable=False, server_default='upload'),
        sa.Column('source_ref', sa.JSON(), nullable=True),
        sa.Column('created_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_library_items_kind', 'library_items', ['kind'])
    op.create_index('ix_library_items_visibility', 'library_items', ['visibility'])
    op.create_index('ix_library_items_workflow_status', 'library_items', ['workflow_status'])
    op.create_index('ix_library_items_scholar_id', 'library_items', ['scholar_id'])
    op.create_index('ix_library_items_created_at', 'library_items', ['created_at'])

    op.create_table(
        'library_item_versions',
        *_id_pk(),
        sa.Column('item_id', sa.Uuid(), sa.ForeignKey('library_items.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_library_item_versions_item_id', 'library_item_versions', ['item_id'])


def downgrade() -> None:
    # §۱۲: forward-only — downgrade فقط برای سازگاری alembic، در عمل استفاده نمی‌شود.
    op.drop_table('library_item_versions')
    op.drop_table('library_items')
