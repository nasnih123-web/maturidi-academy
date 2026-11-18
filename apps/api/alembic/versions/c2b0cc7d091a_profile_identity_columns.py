"""فاز B (تکمیل پروفایل) — ستون‌های هویتی روی users.

Revision ID: c2b0cc7d091a
Revises: d7e8f9a0b1c2
Create Date: 2026-11-18

سه ستون nullable روی users: date_of_birth (تاریخ تولد)، gender
(male|female — اعتبارسنجی در لایهٔ سرویس) و country_code (کد
ISO 3166-1 alpha-2). مبنای گسترش تعریف «پروفایل کامل» فاز B از دو
فیلد (نام + عکس) به پنج فیلد‌اند؛ ردیف‌های قبلی NULL می‌مانند و
هیچ backfillای لازم نیست.

زنجیرهٔ migration در این repo خطی و تک‌سَر است (راستی‌آزمایی
۲۰۲۶-۱۱-۱۸: alembic heads فقط d7e8f9a0b1c2 را نشان می‌دهد و هر ۴۲
revision یک زنجیرهٔ واحد می‌سازند) — پس این revision فرزند خطی
همان سر است و merge point لازم نیست.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'c2b0cc7d091a'
down_revision: str | None = 'd7e8f9a0b1c2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('date_of_birth', sa.Date(), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('gender', sa.String(length=16), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('country_code', sa.String(length=2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'country_code')
    op.drop_column('users', 'gender')
    op.drop_column('users', 'date_of_birth')
