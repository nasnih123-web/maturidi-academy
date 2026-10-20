"""Phase 12 — دستیار صوتی دوزبانه (فارسی/عربی).

Revision ID: 8d3e5f7a9c1b
Revises: 7c1d2b3a4e5f
Create Date: 2026-10-19

Forward-only (§۱۲). New domain tables (ADR-0009):

- voice_sessions — هر فراخوانی /voice/ask یک نشست؛ user_id nullable چون ask
  ناشناس هم پذیرفته می‌شود (مثل fatwa.ask فاز ۶).
- voice_usage_log — لاگ مصرف (intent/lang/stt_ms/tts_provider) با FK به
  voice_sessions؛ هر دو جدول در همین فاز ساخته می‌شوند پس «no future-FK
  coupling» (§۹.۵) نقض نمی‌شود.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '8d3e5f7a9c1b'
down_revision: str | None = '7c1d2b3a4e5f'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'voice_sessions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('lang', sa.String(length=8), nullable=False, server_default='fa'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_voice_sessions_user_id', 'voice_sessions', ['user_id'])
    op.create_index('ix_voice_sessions_lang', 'voice_sessions', ['lang'])
    op.create_index('ix_voice_sessions_created_at', 'voice_sessions', ['created_at'])

    op.create_table(
        'voice_usage_log',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('session_id', sa.Uuid(), sa.ForeignKey('voice_sessions.id'),
                  nullable=False),
        sa.Column('intent', sa.String(length=16), nullable=False),
        sa.Column('lang', sa.String(length=8), nullable=False),
        sa.Column('stt_ms', sa.Integer(), nullable=True),
        sa.Column('tts_provider', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_voice_usage_log_session_id', 'voice_usage_log', ['session_id'])
    op.create_index('ix_voice_usage_log_intent', 'voice_usage_log', ['intent'])
    op.create_index('ix_voice_usage_log_lang', 'voice_usage_log', ['lang'])
    op.create_index('ix_voice_usage_log_created_at', 'voice_usage_log', ['created_at'])


def downgrade() -> None:
    # §۱۲: forward-only — rollback صرفاً برای completeness؛ در عمل با
    # migration جدید جبران می‌شود، نه برگشت جادویی.
    op.drop_table('voice_usage_log')
    op.drop_table('voice_sessions')
