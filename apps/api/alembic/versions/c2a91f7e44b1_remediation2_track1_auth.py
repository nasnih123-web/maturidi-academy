"""remediation-pass-2 Track 1 (§۵/§۹): ضد replay برای TOTP و گره‌خوردن بلیط WS به نشست.

Revision ID: c2a91f7e44b1
Revises: b21c9aa4d7e1
Create Date: 2026-10-19

Backward-compatible: هر دو ستون nullable اضافه می‌شوند؛ downgrade آن‌ها را
حذف می‌کند (دادهٔ امنیتی حساسی در آن‌ها نیست — گام زمانی و ارجاع نشست).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c2a91f7e44b1"
down_revision: Union[str, None] = "b21c9aa4d7e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # §۵: آخرین گام زمانی TOTP مصرف‌شده — کد تکراری در همان پنجره رد می‌شود
    op.add_column(
        "users", sa.Column("totp_last_step", sa.Integer(), nullable=True)
    )
    # §۵/verify: بلیط WS به نشست صادرکننده گره می‌خورد؛ ابطال نشست،
    # بلیطِ هنوزمصرف‌نشده را هم بی‌اعتبار می‌کند.
    # Track 2 (§۱۰): batch mode — روی SQLite (تست/CI) امکان ALTER مستقیم
    # constraint نیست؛ روی PostgreSQL همین بلاک ALTER عادی صادر می‌کند.
    with op.batch_alter_table("ws_tickets") as batch_op:
        batch_op.add_column(sa.Column("session_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_ws_tickets_session_id", "sessions", ["session_id"], ["id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("ws_tickets") as batch_op:
        batch_op.drop_constraint("fk_ws_tickets_session_id", type_="foreignkey")
        batch_op.drop_column("session_id")
    op.drop_column("users", "totp_last_step")
