"""Phase 6 — AI fatwa RAG engine: knowledge chunks, topics, sessions, quiz, verify.

Revision ID: d8f6e3b1a2c0
Revises: c7d21f4a9053
Create Date: 2026-10-19

Forward-only (§۱۲). ADR-0005 documents the contracts.
Conventions (§۱۵):
- NO physical FK to library_items (phase 9) — only source_ref JSON and
  source_library_item_ref (string, reserved, nullable) per §۹.۵.
- FKs only to tables that exist in this or earlier phases (users, chunks,
  topics, sessions).
- UTC everywhere; DateTime(timezone=True).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'd8f6e3b1a2c0'
down_revision: str | None = 'c7d21f4a9053'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- fiqh_knowledge_chunks ---
    op.create_table(
        'fiqh_knowledge_chunks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('chunk_text', sa.Text(), nullable=False),
        sa.Column('embedding', sa.JSON(), nullable=True),
        sa.Column('source_type', sa.String(length=32), nullable=False,
                  server_default='manual'),
        sa.Column('source_ref', sa.JSON(), nullable=True),
        sa.Column('source_library_item_ref', sa.String(length=128), nullable=True),
        sa.Column('source_citation', sa.JSON(), nullable=True),
        sa.Column('topic_category', sa.String(length=64), nullable=True),
        sa.Column('madhab_scope', sa.String(length=16), nullable=True),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('approved_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('ai_scopes', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fiqh_knowledge_chunks_source_type',
                    'fiqh_knowledge_chunks', ['source_type'])
    op.create_index('ix_fiqh_knowledge_chunks_topic_category',
                    'fiqh_knowledge_chunks', ['topic_category'])
    op.create_index('ix_fiqh_knowledge_chunks_madhab_scope',
                    'fiqh_knowledge_chunks', ['madhab_scope'])
    op.create_index('ix_fiqh_knowledge_chunks_workflow_status',
                    'fiqh_knowledge_chunks', ['workflow_status'])
    op.create_index('ix_fiqh_knowledge_chunks_library_item_ref',
                    'fiqh_knowledge_chunks', ['source_library_item_ref'])

    # --- fiqh_topics ---
    op.create_table(
        'fiqh_topics',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('description', sa.JSON(), nullable=True),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fiqh_topics_workflow_status', 'fiqh_topics',
                    ['workflow_status'])

    # --- madhab_positions ---
    op.create_table(
        'madhab_positions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('topic_id', sa.Uuid(),
                  sa.ForeignKey('fiqh_topics.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('madhab', sa.String(length=16), nullable=False),
        sa.Column('position_text', sa.JSON(), nullable=False),
        sa.Column('evidence_refs', sa.JSON(), nullable=True),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_madhab_positions_topic_id', 'madhab_positions',
                    ['topic_id'])
    op.create_index('ix_madhab_positions_madhab', 'madhab_positions', ['madhab'])
    op.create_index('ix_madhab_positions_workflow_status', 'madhab_positions',
                    ['workflow_status'])

    # --- fatwa_sessions ---
    op.create_table(
        'fatwa_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('locale', sa.String(length=8), nullable=False, server_default='fa'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fatwa_sessions_user_id', 'fatwa_sessions', ['user_id'])

    # --- fatwa_messages ---
    op.create_table(
        'fatwa_messages',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.Uuid(),
                  sa.ForeignKey('fatwa_sessions.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('citations', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fatwa_messages_session_id', 'fatwa_messages',
                    ['session_id'])

    # --- quiz_questions ---
    op.create_table(
        'quiz_questions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('question_text', sa.JSON(), nullable=False),
        sa.Column('options', sa.JSON(), nullable=False),
        sa.Column('correct_option', sa.Integer(), nullable=False),
        sa.Column('source_chunk_id', sa.Uuid(),
                  sa.ForeignKey('fiqh_knowledge_chunks.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('difficulty', sa.String(length=16), nullable=False,
                  server_default='medium'),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_quiz_questions_source_chunk_id', 'quiz_questions',
                    ['source_chunk_id'])
    op.create_index('ix_quiz_questions_workflow_status', 'quiz_questions',
                    ['workflow_status'])

    # --- quiz_attempts ---
    op.create_table(
        'quiz_attempts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('question_ids', sa.JSON(), nullable=False),
        sa.Column('answers', sa.JSON(), nullable=False),
        sa.Column('score', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_quiz_attempts_user_id', 'quiz_attempts', ['user_id'])

    # --- verification_checks ---
    op.create_table(
        'verification_checks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('input_hash', sa.String(length=64), nullable=False),
        sa.Column('input_excerpt', sa.String(length=512), nullable=False),
        sa.Column('verdict', sa.String(length=16), nullable=False),
        sa.Column('matched_chunk_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_verification_checks_input_hash', 'verification_checks',
                    ['input_hash'])
    op.create_index('ix_verification_checks_verdict', 'verification_checks',
                    ['verdict'])

    # --- trusted_external_sources ---
    op.create_table(
        'trusted_external_sources',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('base_url', sa.String(length=512), nullable=False),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('allowed_paths', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('citation_required', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_trusted_external_sources_domain', 'trusted_external_sources',
                    ['domain'])
    op.create_index('ix_trusted_external_sources_enabled', 'trusted_external_sources',
                    ['enabled'])

    # --- ai_provider_configs ---
    op.create_table(
        'ai_provider_configs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('provider', sa.String(length=64), nullable=False),
        sa.Column('model', sa.String(length=128), nullable=False),
        sa.Column('version', sa.String(length=64), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_fallback', sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('provider', 'model',
                            name='uq_ai_provider_configs_provider_model'),
    )
    op.create_index('ix_ai_provider_configs_provider', 'ai_provider_configs',
                    ['provider'])

    # --- ai_usage_log ---
    op.create_table(
        'ai_usage_log',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('endpoint', sa.String(length=64), nullable=False),
        sa.Column('model', sa.String(length=128), nullable=False),
        sa.Column('tokens_in', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tokens_out', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cost_estimate', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ai_usage_log_user_id', 'ai_usage_log', ['user_id'])
    op.create_index('ix_ai_usage_log_endpoint', 'ai_usage_log', ['endpoint'])
    op.create_index('ix_ai_usage_log_created_at', 'ai_usage_log', ['created_at'])

    # --- ingestion_runs ---
    op.create_table(
        'ingestion_runs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('source_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False,
                  server_default='queued'),
        sa.Column('stats', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ingestion_runs_source_type', 'ingestion_runs',
                    ['source_type'])
    op.create_index('ix_ingestion_runs_status', 'ingestion_runs', ['status'])


def downgrade() -> None:
    # forward-only (§۱۲) — این تابع عمداً خالی است.
    pass
