"""حمایت دستی — جدول اثبات پرداخت (کارت‌به‌کارت / کریپتو / PayPal).

Revision ID: c5d6e7f8a9b0
Revises: a8d66f372fd6
Create Date: 2026-11-15

Forward-only (§۱۲). رکورد مالی حمایت دستی همان payment_intents/donations
موجود است؛ این جدول فقط اثبات ارسالیِ اهداکننده و وضعیت بازبینی ادمین را
نگه می‌دارد (۱:۱ با payment_intents، یکتا).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'c5d6e7f8a9b0'
down_revision: str | None = 'a8d66f372fd6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'manual_donation_proofs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('payment_intent_id', sa.Uuid(), nullable=False),
        sa.Column('method', sa.String(length=16), nullable=False),
        sa.Column('proof_text', sa.String(length=1024), nullable=True),
        sa.Column('proof_image_key', sa.String(length=1024), nullable=True),
        sa.Column('proof_image_mime', sa.String(length=64), nullable=True),
        sa.Column('wallet_label', sa.String(length=128), nullable=True),
        sa.Column('review_status', sa.String(length=16), nullable=False),
        sa.Column('reviewed_by', sa.Uuid(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_note', sa.String(length=512), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['payment_intent_id'], ['payment_intents.id']),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'payment_intent_id', name='uq_manual_donation_proofs_payment_intent_id'
        ),
    )
    op.create_index(
        'ix_manual_donation_proofs_method', 'manual_donation_proofs', ['method']
    )
    op.create_index(
        'ix_manual_donation_proofs_review_status',
        'manual_donation_proofs',
        ['review_status'],
    )
    op.create_index(
        'ix_manual_donation_proofs_created_at',
        'manual_donation_proofs',
        ['created_at'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_manual_donation_proofs_created_at', table_name='manual_donation_proofs'
    )
    op.drop_index(
        'ix_manual_donation_proofs_review_status',
        table_name='manual_donation_proofs',
    )
    op.drop_index('ix_manual_donation_proofs_method', table_name='manual_donation_proofs')
    op.drop_table('manual_donation_proofs')
