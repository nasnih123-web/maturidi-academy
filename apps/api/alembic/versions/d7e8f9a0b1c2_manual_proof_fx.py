"""حمایت دستی ارزی — ستون‌های تبدیل لحظه‌ای به ریال روی اثبات پرداخت.

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0
Create Date: 2026-11-16

Forward-only (§۱۲). هنگام تأیید حمایت دستیِ غیرریالی، مبلغ با نرخ
لحظه‌ای به ریال تبدیل و در مجموع کمپین شمرده می‌شود؛ نرخ، منبعش و
معادل ریالی روی همان رکورد اثبات می‌ماند تا تغییر بعدی نرخ، تاریخچه
را بازنویسی نکند. هر سه ستون nullable است (ردیف‌های قبلی و حمایت‌های
ریالی بدون تبدیل‌اند).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'd7e8f9a0b1c2'
down_revision: str | None = 'c5d6e7f8a9b0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'manual_donation_proofs',
        sa.Column('amount_irr', sa.BigInteger(), nullable=True),
    )
    op.add_column(
        'manual_donation_proofs',
        sa.Column('fx_rate_irr', sa.BigInteger(), nullable=True),
    )
    op.add_column(
        'manual_donation_proofs',
        sa.Column('fx_source', sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('manual_donation_proofs', 'fx_source')
    op.drop_column('manual_donation_proofs', 'fx_rate_irr')
    op.drop_column('manual_donation_proofs', 'amount_irr')
