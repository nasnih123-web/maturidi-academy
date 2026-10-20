"""Phase 13 — موتور همگام‌سازی آفلاین (Track 1 — بک‌اند).

Revision ID: b93cee5d2cdf
Revises: 8d3e5f7a9c1b
Create Date: 2026-10-19

Forward-only (§۱۲). جدول‌های جدید موتور sync (ADR-0010):

- device_cursors — کرسر pull به‌ازای هر (کاربر، دستگاه)
- sync_operations — صف عملیات push با idempotency روی client_op_id
- sync_tombstones — حذف‌های منطقیِ ماندگار (پرچم حذف، نه حذف فیزیکی)
- conflict_records — تعارض‌های نسخه‌ای محتوای نوشته‌شدهٔ کاربر (سطح فیلد)
- sync_changelog — ژورنال تغییرات سرور که pull از روی آن می‌خواند

ستون‌های افزودنی (additive — بدون تغییر نام/حذف هیچ ستونی):
- version + updated_at روی user_ayah_notes و dhikr_daily_counts
- version روی user_progress (این جدول updated_at را از قبل دارد)
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'b93cee5d2cdf'
down_revision: str | None = '8d3e5f7a9c1b'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- کرسر pull به‌ازای هر (کاربر، دستگاه) ---
    op.create_table(
        'device_cursors',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('cursor_seq', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'device_id', name='uq_device_cursors_user_device'),
    )
    op.create_index('ix_device_cursors_user_id', 'device_cursors', ['user_id'])

    # --- صف عملیات push با idempotency روی client_op_id ---
    op.create_table(
        'sync_operations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('client_op_id', sa.String(length=128), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('entity_type', sa.String(length=32), nullable=False),
        sa.Column('entity_id', sa.String(length=128), nullable=False),
        sa.Column('op_type', sa.String(length=16), nullable=False),  # upsert | delete
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('base_version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=16), nullable=False,
                  server_default='pending'),  # pending | applied | conflicted | rejected
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('client_op_id', name='uq_sync_operations_client_op_id'),
    )
    op.create_index('ix_sync_operations_user_id', 'sync_operations', ['user_id'])
    op.create_index('ix_sync_operations_entity', 'sync_operations',
                    ['entity_type', 'entity_id'])

    # --- حذف‌های منطقیِ ماندگار ---
    op.create_table(
        'sync_tombstones',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('entity_type', sa.String(length=32), nullable=False),
        sa.Column('entity_id', sa.String(length=128), nullable=False),
        sa.Column('deleted_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('version', sa.BigInteger(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        # §۱۵.۲/ADR-0010: user_id هم جزو یکتایی است چون entity_idها
        # (مثل lesson_id در user_progress) بین کاربران یکتا نیستند.
        sa.UniqueConstraint('user_id', 'entity_type', 'entity_id',
                           name='uq_sync_tombstones_user_entity'),
    )
    op.create_index('ix_sync_tombstones_user_id', 'sync_tombstones', ['user_id'])

    # --- تعارض‌های نسخه‌ای (سطح فیلد) ---
    op.create_table(
        'conflict_records',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('entity_type', sa.String(length=32), nullable=False),
        sa.Column('entity_id', sa.String(length=128), nullable=False),
        sa.Column('local_payload', sa.JSON(), nullable=True),
        sa.Column('remote_payload', sa.JSON(), nullable=True),
        sa.Column('local_version', sa.Integer(), nullable=True),
        sa.Column('remote_version', sa.Integer(), nullable=True),
        sa.Column('resolution', sa.String(length=16), nullable=False,
                  server_default='pending'),  # pending | keep_local | keep_remote | merged
        sa.Column('resolved_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_conflict_records_user_id', 'conflict_records', ['user_id'])
    op.create_index('ix_conflict_records_resolution', 'conflict_records', ['resolution'])

    # --- ژورنال تغییرات سرور (منبع pull) ---
    op.create_table(
        'sync_changelog',
        # Integer (نه BigInteger): روی SQLite فقط INTEGER PRIMARY KEY
        # خودافزا (rowid) است؛ روی Postgres به SERIAL رندر می‌شود.
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=True),
        sa.Column('entity_type', sa.String(length=32), nullable=False),
        sa.Column('entity_id', sa.String(length=128), nullable=False),
        sa.Column('op_type', sa.String(length=16), nullable=False),  # upsert | delete
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('seq'),
    )
    op.create_index('ix_sync_changelog_user_seq', 'sync_changelog', ['user_id', 'seq'])

    # --- ستون‌های افزودنی روی جدول‌های syncable (بدون تغییر ستون موجود) ---
    op.add_column('user_ayah_notes',
                  sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('user_ayah_notes',
                  sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('dhikr_daily_counts',
                  sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('dhikr_daily_counts',
                  sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('user_progress',
                  sa.Column('version', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    # §۱۲: forward-only — rollback صرفاً برای completeness؛ در عمل با
    # migration جدید جبران می‌شود، نه برگشت جادویی.
    op.drop_column('user_progress', 'version')
    op.drop_column('dhikr_daily_counts', 'updated_at')
    op.drop_column('dhikr_daily_counts', 'version')
    op.drop_column('user_ayah_notes', 'updated_at')
    op.drop_column('user_ayah_notes', 'version')
    op.drop_index('ix_sync_changelog_user_seq', table_name='sync_changelog')
    op.drop_table('sync_changelog')
    op.drop_index('ix_conflict_records_resolution', table_name='conflict_records')
    op.drop_index('ix_conflict_records_user_id', table_name='conflict_records')
    op.drop_table('conflict_records')
    op.drop_index('ix_sync_tombstones_user_id', table_name='sync_tombstones')
    op.drop_table('sync_tombstones')
    op.drop_index('ix_sync_operations_entity', table_name='sync_operations')
    op.drop_index('ix_sync_operations_user_id', table_name='sync_operations')
    op.drop_table('sync_operations')
    op.drop_index('ix_device_cursors_user_id', table_name='device_cursors')
    op.drop_table('device_cursors')
