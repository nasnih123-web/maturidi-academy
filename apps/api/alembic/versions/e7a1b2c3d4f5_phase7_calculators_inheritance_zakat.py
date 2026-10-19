"""Phase 7 — calculators: inheritance & zakat rule configs, cases, price cache.

Revision ID: e7a1b2c3d4f5
Revises: d8f6e3b1a2c0
Create Date: 2026-10-19

Forward-only (§۱۲). ADR-0006 documents the contracts.
Conventions (§۱۵):
- HARD RULE: NO fiqh tables/numbers hardcoded anywhere — rule_data is
  empty/placeholder until a scholar approves a config (§۱۵.۵). The seed
  only creates DRAFT configs with {"status": "pending_scholar_entry"}.
- FKs only to tables that exist in this or earlier phases (users).
- UTC everywhere; DateTime(timezone=True).
- idempotency_key (unique, nullable) on case tables per §۱ (Idempotency-Key
  for sensitive writes).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7a1b2c3d4f5'
down_revision: Union[str, None] = 'd8f6e3b1a2c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rule_config_columns() -> list:
    return [
        sa.Column('source', sa.String(length=256), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('effective_from', sa.DateTime(timezone=True), nullable=False),
        sa.Column('effective_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approved_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('change_reason', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('rule_data', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    # --- inheritance_rule_configs ---
    op.create_table(
        'inheritance_rule_configs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('madhab', sa.String(length=16), nullable=False),
        *_rule_config_columns(),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('madhab', 'version', name='uq_inh_rule_madhab_version'),
    )
    op.create_index('ix_inheritance_rule_configs_madhab',
                    'inheritance_rule_configs', ['madhab'])
    op.create_index('ix_inheritance_rule_configs_status',
                    'inheritance_rule_configs', ['status'])

    # --- inheritance_cases ---
    op.create_table(
        'inheritance_cases',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('estate_value', sa.Numeric(20, 4), nullable=False),
        sa.Column('madhab', sa.String(length=16), nullable=False),
        sa.Column('heirs', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('result', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('rule_config_id', sa.Uuid(),
                  sa.ForeignKey('inheritance_rule_configs.id'), nullable=True),
        sa.Column('idempotency_key', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key', name='uq_inheritance_cases_idem'),
    )
    op.create_index('ix_inheritance_cases_user_id', 'inheritance_cases', ['user_id'])
    op.create_index('ix_inheritance_cases_madhab', 'inheritance_cases', ['madhab'])
    op.create_index('ix_inheritance_cases_created_at',
                    'inheritance_cases', ['created_at'])

    # --- zakat_rule_configs ---
    op.create_table(
        'zakat_rule_configs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('madhab', sa.String(length=16), nullable=True),
        *_rule_config_columns(),
        sa.Column('asset_categories', sa.JSON(), nullable=False, server_default='{}'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('version', name='uq_zakat_rule_version'),
    )
    op.create_index('ix_zakat_rule_configs_status',
                    'zakat_rule_configs', ['status'])

    # --- zakat_calculations ---
    op.create_table(
        'zakat_calculations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('inputs', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('result', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('nisab_snapshot', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('rule_config_id', sa.Uuid(),
                  sa.ForeignKey('zakat_rule_configs.id'), nullable=True),
        sa.Column('idempotency_key', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key', name='uq_zakat_calculations_idem'),
    )
    op.create_index('ix_zakat_calculations_user_id', 'zakat_calculations', ['user_id'])
    op.create_index('ix_zakat_calculations_created_at',
                    'zakat_calculations', ['created_at'])

    # --- nisab_price_cache ---
    op.create_table(
        'nisab_price_cache',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('source', sa.String(length=64), nullable=False),
        sa.Column('currency', sa.String(length=8), nullable=False,
                  server_default='USD'),
        sa.Column('gold_per_gram', sa.Numeric(20, 6), nullable=True),
        sa.Column('silver_per_gram', sa.Numeric(20, 6), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source', name='uq_nisab_price_cache_source'),
    )
    op.create_index('ix_nisab_price_cache_source', 'nisab_price_cache', ['source'])
