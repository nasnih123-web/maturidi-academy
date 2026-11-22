"""وضعیت پنجم نمرهٔ کلمهٔ حفاظ: بسملهٔ خوانده‌شده (پیشنهاد ۱۶).

وضعیت `basmala` (بسملهٔ خوانده‌شدهٔ زنده — نمایشی، بی‌نمره) به
قیودِ وضعیتِ hifz_word_scores اضافه می‌شود؛ پیش از این، چهار
وضعیت فقط قراردادِ کد بود و قیدی در دیتابیس نداشت. ردیف‌های
موجود هر چهار وضعیتِ پیشین را دارند، پس قید روی دادهٔ موجود
می‌نشیند. batch mode: افزودنِ قید به جدولِ موجود، در SQLite
فقط با کپی‌وانتقال شدنی است.

Revision ID: 5eccbb7998d3
Revises: 0bbafe04a61a
Create Date: 2026-11-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = '5eccbb7998d3'
down_revision: str | None = '0bbafe04a61a'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("hifz_word_scores") as batch_op:
        batch_op.create_check_constraint(
            "ck_hifz_word_score_status",
            "status IN ('correct', 'close', 'wrong', 'skipped', 'basmala')",
        )


def downgrade() -> None:
    with op.batch_alter_table("hifz_word_scores") as batch_op:
        batch_op.drop_constraint("ck_hifz_word_score_status", type_="check")
