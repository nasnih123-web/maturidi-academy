"""Phase 11 — religious places, Telegram (bot/connect/import/distribute), API keys.

Revision ID: 7c1d2b3a4e5f
Revises: 75bb4bbed799
Create Date: 2026-10-19

Forward-only (§۱۲). New domain tables (ADR-0008):

Places:
- religious_places — typed table (§۹.۵ anti-giant-table). video_360_id is a
  REAL FK to library_items.id (phase 9 already exists, so "no future-FK
  coupling" is not violated). The phase-9 string column
  library_items.religious_place_ref is left untouched for loose references;
  there are no religious_places rows to backfill, so no data migration is
  needed beyond creating the FK (existing 360 rows are preserved as-is).

Telegram:
- telegram_distribution_policies — per content_type policy
  (never|manual_approval|auto_publish|scheduled), default never.
- telegram_published — publish log with UNIQUE idempotency_key
  (source_content_type:source_content_id:target) — double sends collapse.
- telegram_callbacks — one-time nonces for inline approve/reject buttons.

Widgets:
- api_keys — only the SHA-256 hash is stored; the raw key is shown once
  at creation time and never persisted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7c1d2b3a4e5f'
down_revision: Union[str, None] = '75bb4bbed799'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # religious places
    # ------------------------------------------------------------------
    op.create_table(
        'religious_places',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('description', sa.JSON(), nullable=True),  # LocalizedText
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lng', sa.Float(), nullable=False),
        sa.Column('type', sa.String(length=32), nullable=False,
                  server_default='mosque'),
        sa.Column('video_360_id', sa.Uuid(),
                  sa.ForeignKey('library_items.id'), nullable=True),
        sa.Column('submitted_by', sa.Uuid(),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),  # shared §۹ machine (app/core/workflow.py)
        sa.Column('version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.Uuid(),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_religious_places_lat', 'religious_places', ['lat'])
    op.create_index('ix_religious_places_lng', 'religious_places', ['lng'])
    op.create_index('ix_religious_places_type', 'religious_places', ['type'])
    op.create_index('ix_religious_places_workflow_status',
                    'religious_places', ['workflow_status'])
    op.create_index('ix_religious_places_created_at',
                    'religious_places', ['created_at'])

    # ------------------------------------------------------------------
    # telegram distribution policies
    # ------------------------------------------------------------------
    op.create_table(
        'telegram_distribution_policies',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('content_type', sa.String(length=64), nullable=False),
        sa.Column('policy', sa.String(length=16), nullable=False,
                  server_default='never'),  # never|manual_approval|auto_publish|scheduled
        sa.Column('message_template', sa.JSON(), nullable=True),
        sa.Column('target_channels', sa.JSON(), nullable=False,
                  server_default='[]'),
        sa.Column('spacing_seconds', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('require_approval', sa.Boolean(), nullable=False,
                  server_default='1'),
        sa.Column('schedule_config', sa.JSON(), nullable=True),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('content_type'),
    )
    op.create_index('ix_telegram_distribution_policies_content_type',
                    'telegram_distribution_policies', ['content_type'])
    op.create_index('ix_telegram_distribution_policies_policy',
                    'telegram_distribution_policies', ['policy'])

    # ------------------------------------------------------------------
    # telegram publish log (idempotent)
    # ------------------------------------------------------------------
    op.create_table(
        'telegram_published',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('source_content_type', sa.String(length=64), nullable=False),
        sa.Column('source_content_id', sa.String(length=64), nullable=False),
        sa.Column('distribution_target', sa.String(length=128), nullable=False),
        sa.Column('published_message_id', sa.BigInteger(), nullable=True),
        sa.Column('idempotency_key', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False,
                  server_default='pending'),  # pending|sent|failed|notified|deleted
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key', name='uq_telegram_published_idem'),
    )
    op.create_index('ix_telegram_published_source_content_type',
                    'telegram_published', ['source_content_type'])
    op.create_index('ix_telegram_published_source_content_id',
                    'telegram_published', ['source_content_id'])
    op.create_index('ix_telegram_published_distribution_target',
                    'telegram_published', ['distribution_target'])
    op.create_index('ix_telegram_published_status',
                    'telegram_published', ['status'])
    op.create_index('ix_telegram_published_created_at',
                    'telegram_published', ['created_at'])

    # ------------------------------------------------------------------
    # telegram inline-button callbacks (one-time nonces)
    # ------------------------------------------------------------------
    op.create_table(
        'telegram_callbacks',
        sa.Column('nonce', sa.String(length=32), nullable=False),
        sa.Column('source_content_type', sa.String(length=64), nullable=False),
        sa.Column('source_content_id', sa.String(length=64), nullable=False),
        sa.Column('op', sa.String(length=32), nullable=False),  # approve|reject
        sa.Column('actor_user_id', sa.Uuid(),
                  sa.ForeignKey('users.id'), nullable=False),
        sa.Column('signature', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('nonce'),
    )
    op.create_index('ix_telegram_callbacks_source_content_type',
                    'telegram_callbacks', ['source_content_type'])
    op.create_index('ix_telegram_callbacks_source_content_id',
                    'telegram_callbacks', ['source_content_id'])
    op.create_index('ix_telegram_callbacks_actor_user_id',
                    'telegram_callbacks', ['actor_user_id'])

    # ------------------------------------------------------------------
    # api keys for embeddable widgets (hash only)
    # ------------------------------------------------------------------
    op.create_table(
        'api_keys',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('key_hash', sa.String(length=64), nullable=False),
        sa.Column('key_prefix', sa.String(length=8), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('scopes', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('rate_limit_per_min', sa.Integer(), nullable=False,
                  server_default='60'),
        sa.Column('quota_monthly', sa.Integer(), nullable=False,
                  server_default='10000'),
        sa.Column('used_this_month', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('quota_period', sa.String(length=7), nullable=False,
                  server_default=''),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('abuse_flag', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Uuid(),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key_hash'),
    )
    op.create_index('ix_api_keys_key_hash', 'api_keys', ['key_hash'])
    op.create_index('ix_api_keys_is_active', 'api_keys', ['is_active'])
    op.create_index('ix_api_keys_created_at', 'api_keys', ['created_at'])


def downgrade() -> None:
    # §۱۲: forward-only — rollback صرفاً برای completeness؛ در عمل با
    # migration جدید جبران می‌شود، نه برگشت جادویی.
    op.drop_table('api_keys')
    op.drop_table('telegram_callbacks')
    op.drop_table('telegram_published')
    op.drop_table('telegram_distribution_policies')
    op.drop_table('religious_places')
