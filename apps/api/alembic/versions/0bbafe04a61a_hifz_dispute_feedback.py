"""بازخورد اعتراض حفاظ (پیشنهاد ۱۵، سرعت حفاظ).

جدول hifz_dispute_feedback: هر اعتراضِ تازه به یک نمرهٔ «غلط»،
جفت (واجِ موردانتظار ← تکهٔ واجیِ شنیده‌شده) را یک بار می‌شمارد؛
یکتاییِ جفت یعنی اعتراضِ دوباره به همان جفت، شمارش را بالا
می‌برد. فقط رشتهٔ واجی — هرگز صدا.

Revision ID: 0bbafe04a61a
Revises: 440bf17e99bb
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0bbafe04a61a'
down_revision: str | None = '440bf17e99bb'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hifz_dispute_feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("expected_phoneme", sa.String(length=120), nullable=False),
        sa.Column("heard_phoneme", sa.String(length=120), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_hifz_dispute_feedback_user"),
        sa.PrimaryKeyConstraint("id", name="pk_hifz_dispute_feedback"),
        sa.UniqueConstraint(
            "user_id", "expected_phoneme", "heard_phoneme",
            name="uq_hifz_dispute_feedback_pair",
        ),
    )
    op.create_index(
        "ix_hifz_dispute_feedback_user_id",
        "hifz_dispute_feedback",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_hifz_dispute_feedback_user_id",
        table_name="hifz_dispute_feedback",
    )
    op.drop_table("hifz_dispute_feedback")
