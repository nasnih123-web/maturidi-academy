"""Phase 13 (تکمیلی هماهنگ‌کننده) — دستگاه‌های کاربر و اشتراک‌های web push.

Revision ID: c41d7e8f2a93
Revises: b93cee5d2cdf
Create Date: 2026-10-19

Forward-only (§۱۲). دو جدول جدید برای بستن شکاف‌های Track 2 و Track 3:

- user_devices — ثبت دستگاه + توکن FCM (کلاینت موبایل به
  POST /api/v1/users/me/devices می‌زند)
- web_push_subscriptions — اشتراک‌های VAPID مرورگر (وب به
  POST /api/v1/users/me/web-push/subscriptions می‌زند)
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'c41d7e8f2a93'
down_revision: str | None = 'b93cee5d2cdf'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'user_devices',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('platform', sa.String(length=16), nullable=True),
        sa.Column('push_token', sa.String(length=512), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'device_id', name='uq_user_devices_user_device'),
    )
    op.create_index('ix_user_devices_user_id', 'user_devices', ['user_id'])

    op.create_table(
        'web_push_subscriptions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('endpoint', sa.String(length=1024), nullable=False),
        sa.Column('p256dh', sa.String(length=256), nullable=False),
        sa.Column('auth', sa.String(length=128), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'endpoint', name='uq_web_push_user_endpoint'),
    )
    op.create_index('ix_web_push_subscriptions_user_id', 'web_push_subscriptions', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_web_push_subscriptions_user_id', table_name='web_push_subscriptions')
    op.drop_table('web_push_subscriptions')
    op.drop_index('ix_user_devices_user_id', table_name='user_devices')
    op.drop_table('user_devices')
