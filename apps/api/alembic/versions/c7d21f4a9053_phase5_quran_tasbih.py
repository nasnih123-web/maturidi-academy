"""Quran notes + digital tasbih tables — phase 5.

Revision ID: c7d21f4a9053
Revises: b6d09fa96517
Create Date: 2026-10-19

Forward-only (§۱۲). New domain tables for the phase-5 track-1 backend scope:
- user_ayah_notes: private/shared user annotations on ayahs (auth-required,
  owner-scoped reads — enforced in the service layer, § privacy).
- dhikr_sessions / dhikr_daily_counts: digital tasbih sessions and
  per-user/per-day/per-dhikr aggregates (unique constraint on the triple).

Conventions (§۱۵):
- FK to users.id — users exists since phase 0 (no future-FK coupling).
- Times in DB always UTC; DateTime(timezone=True).
- user_ayah_notes keeps NO workflow_status: notes are user data, not
  publishable content (§۹); privacy is enforced by owner-scoped queries.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'c7d21f4a9053'
down_revision: str | None = 'b6d09fa96517'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- user_ayah_notes ---
    op.create_table(
        'user_ayah_notes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('surah', sa.Integer(), nullable=False),
        sa.Column('ayah', sa.Integer(), nullable=False),
        sa.Column('note_text', sa.Text(), nullable=False),
        sa.Column('is_private', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_user_ayah_notes_user_surah_ayah',
        'user_ayah_notes', ['user_id', 'surah', 'ayah'],
    )

    # --- dhikr_sessions ---
    op.create_table(
        'dhikr_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('dhikr_text', sa.String(length=255), nullable=False),
        sa.Column('target_count', sa.Integer(), nullable=True),
        sa.Column('count', sa.Integer(), nullable=False,
                  server_default=sa.text('0')),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_dhikr_sessions_user', 'dhikr_sessions', ['user_id'],
    )

    # --- dhikr_daily_counts ---
    op.create_table(
        'dhikr_daily_counts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('dhikr_text', sa.String(length=255), nullable=False),
        sa.Column('total_count', sa.Integer(), nullable=False,
                  server_default=sa.text('0')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'date', 'dhikr_text',
            name='uq_dhikr_daily_counts_user_date_dhikr',
        ),
    )


def downgrade() -> None:
    # forward-only per §۱۲ — kept only for alembic chain completeness; not used.
    op.drop_index('ix_user_ayah_notes_user_surah_ayah', table_name='user_ayah_notes')
    op.drop_table('user_ayah_notes')
    op.drop_index('ix_dhikr_sessions_user', table_name='dhikr_sessions')
    op.drop_table('dhikr_sessions')
    op.drop_table('dhikr_daily_counts')
