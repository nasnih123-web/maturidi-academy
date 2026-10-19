"""Phase 15 — مالی، اهدا و درگاه پرداخت: جدول‌های پرداخت idempotent.

Revision ID: 3f09e72ee6c1
Revises: d4e5f6a7b8c9
Create Date: 2026-10-19

Forward-only (§۱۲). ADR-0013 documents the idempotency contracts.
Conventions (§۱۵):
- FKs only to tables that exist in this or earlier phases (users).
- payment_intents.idempotency_key UNIQUE NOT NULL (§۱, §۴ — هدایت تکرار درخواست).
- donations.gateway_reference UNIQUE (§۴ — دوبار ثبت نکردن وبهوک).
- payment_webhook_log.payload_hash UNIQUE (dedupe وبهوک).
- UTC everywhere; DateTime(timezone=True).
- Amounts: BigInteger IRR (§۱۵ — هیچ قاعدهٔ فقهی/نرخی هاردکد نیست؛ فقط واحد ریال).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3f09e72ee6c1'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id_pk() -> list:
    return [sa.Column('id', sa.Uuid(), nullable=False)]


def _ts(name: str, *, nullable: bool = False, index: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        index=index,
        server_default=sa.func.now() if not nullable and name == 'created_at' else None,
    )


def upgrade() -> None:
    # --- کمپین‌های اهدا (title/description: LocalizedText JSON) ---
    op.create_table(
        'donation_campaigns',
        *_id_pk(),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('description', sa.JSON(), nullable=True),
        sa.Column('goal_amount', sa.BigInteger(), nullable=False, default=0),
        sa.Column('raised_amount', sa.BigInteger(), nullable=False, default=0),
        sa.Column('status', sa.String(16), nullable=False, default='active', index=True),
        # active | draft | archived — پرچم ساده (ADR-0013)؛ نه موتور گردش‌کار §۹
        sa.Column('cover', sa.String(1024), nullable=True),
        _ts('created_at'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- نیت‌های پرداخت: هدر Idempotency-Key §۱ → همین ردیف (یکتا) ---
    op.create_table(
        'payment_intents',
        *_id_pk(),
        sa.Column('idempotency_key', sa.String(128), nullable=False),
        sa.Column('amount', sa.BigInteger(), nullable=False),  # ریال (IRR)
        sa.Column('currency', sa.String(8), nullable=False, default='IRR'),
        sa.Column('campaign_id', sa.Uuid(), sa.ForeignKey('donation_campaigns.id'), nullable=True),
        sa.Column('donor_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('donor_name', sa.String(256), nullable=True),  # اهداکنندهٔ ناشناس/مهمان
        sa.Column('status', sa.String(16), nullable=False, default='pending', index=True),
        # pending | succeeded | failed | cancelled
        sa.Column('gateway', sa.String(32), nullable=False, default='zarinpal'),
        sa.Column('authority', sa.String(128), nullable=True),  # کد authority زرین‌پال
        _ts('created_at', index=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key', name='uq_payment_intents_idempotency_key'),
    )
    op.create_index(
        'ix_payment_intents_authority', 'payment_intents', ['authority'], unique=False
    )

    # --- اهداهای ثبت‌شده ---
    op.create_table(
        'donations',
        *_id_pk(),
        sa.Column('donor_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('payment_intent_id', sa.Uuid(), sa.ForeignKey('payment_intents.id'), nullable=False),
        sa.Column('campaign_id', sa.Uuid(), sa.ForeignKey('donation_campaigns.id'), nullable=True),
        sa.Column('gateway', sa.String(32), nullable=False),
        sa.Column('gateway_reference', sa.String(128), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, default='succeeded', index=True),
        # succeeded | refunded | failed
        sa.Column('amount', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(8), nullable=False, default='IRR'),
        sa.Column('donor_name', sa.String(256), nullable=True),
        _ts('created_at', index=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('gateway_reference', name='uq_donations_gateway_reference'),
        sa.UniqueConstraint('payment_intent_id', name='uq_donations_payment_intent_id'),
    )

    # --- دفتر مالی سبک ---
    op.create_table(
        'ledger_entries',
        *_id_pk(),
        sa.Column('entry_type', sa.String(16), nullable=False, index=True),
        # donation_in | refund | fee
        sa.Column('amount', sa.BigInteger(), nullable=False),  # علامت‌دار
        sa.Column('currency', sa.String(8), nullable=False, default='IRR'),
        sa.Column('reference', sa.String(256), nullable=True, index=True),
        sa.Column('donation_id', sa.Uuid(), sa.ForeignKey('donations.id'), nullable=True),
        _ts('created_at', index=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- لاگ وبهوک برای پردازش idempotent ---
    op.create_table(
        'payment_webhook_log',
        *_id_pk(),
        sa.Column('gateway', sa.String(32), nullable=False, index=True),
        sa.Column('payload_hash', sa.String(64), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, default='processed'),
        # processed | duplicate | rejected
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('payload_hash', name='uq_payment_webhook_log_payload_hash'),
    )

    # --- اهدای مکرر (اجرای شارژ دوره‌ای در فاز ۱۶ — فقط ثبت) ---
    op.create_table(
        'recurring_donations',
        *_id_pk(),
        sa.Column('donor_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('campaign_id', sa.Uuid(), sa.ForeignKey('donation_campaigns.id'), nullable=True),
        sa.Column('amount', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(8), nullable=False, default='IRR'),
        sa.Column('interval', sa.String(16), nullable=False, default='monthly'),
        # weekly | monthly | yearly
        sa.Column('status', sa.String(16), nullable=False, default='active', index=True),
        # active | paused | cancelled
        sa.Column('next_charge_at', sa.DateTime(timezone=True), nullable=True),
        _ts('created_at'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    # forward-only (§۱۲) — downgrade صوری برای سازگاری alembic
    op.drop_table('recurring_donations')
    op.drop_table('payment_webhook_log')
    op.drop_table('ledger_entries')
    op.drop_table('donations')
    op.drop_index('ix_payment_intents_authority', table_name='payment_intents')
    op.drop_table('payment_intents')
    op.drop_table('donation_campaigns')
