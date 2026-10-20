"""Phase 14 — کنترل مرکزی ادمین (Track 1 — بک‌اند).

Revision ID: d4e5f6a7b8c9
Revises: c41d7e8f2a93
Create Date: 2026-10-19

Forward-only (§۱۲). جدول‌های جدید (ADR-0011):

- content_placements — اتصال محتوا به surface/slot (§۹.۵ Placement)؛
  ارجاع چندریختی (domain, content_type, content_id) بدون FK فیزیکی.
- content_distributions — تاگل مستقل هر کانال توزیع به‌ازای هر محتوا
  + زمان‌بندی timezone-aware (مقادیر UTC ذخیره می‌شوند).
- notification_broadcasts + notification_deliveries — پخش چندکاناله با
  لاگ تحویل per-user/per-channel.
- build_releases + build_requests — مرکز بیلدها (پرچم signed صادقانه).

هیچ تغییری روی جدول‌های موجود نیست (purely additive).
قرارداد migrationها: بدون server_default روی timestampها (مقادیر در اپ ست
می‌شوند)؛ بولی‌ها با '1'/'0' سازگار SQLite/Postgres.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'd4e5f6a7b8c9'
down_revision: str | None = 'c41d7e8f2a93'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_placements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("domain", sa.String(64), nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("content_id", sa.String(128), nullable=False),
        sa.Column("surface", sa.String(64), nullable=False),
        sa.Column("slot", sa.String(64), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("audience", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locale", sa.String(8), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.UniqueConstraint(
            "surface", "slot", "domain", "content_type", "content_id",
            name="uq_content_placements_slot_content",
        ),
    )
    op.create_index("ix_content_placements_domain", "content_placements", ["domain"])
    op.create_index(
        "ix_content_placements_content_type", "content_placements", ["content_type"])
    op.create_index(
        "ix_content_placements_content_id", "content_placements", ["content_id"])
    op.create_index("ix_content_placements_surface", "content_placements", ["surface"])
    op.create_index("ix_content_placements_slot", "content_placements", ["slot"])
    op.create_index("ix_content_placements_active", "content_placements", ["active"])
    op.create_index(
        "ix_content_placements_content", "content_placements",
        ["domain", "content_type", "content_id"],
    )

    op.create_table(
        "content_distributions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("domain", sa.String(64), nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("content_id", sa.String(128), nullable=False),
        sa.Column("channel", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("schedule_tz", sa.String(64), nullable=True),
        sa.Column("until_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.UniqueConstraint(
            "domain", "content_type", "content_id", "channel",
            name="uq_content_distributions_content_channel",
        ),
    )
    op.create_index(
        "ix_content_distributions_domain", "content_distributions", ["domain"])
    op.create_index(
        "ix_content_distributions_content_type", "content_distributions",
        ["content_type"])
    op.create_index(
        "ix_content_distributions_content_id", "content_distributions",
        ["content_id"])
    op.create_index(
        "ix_content_distributions_channel", "content_distributions", ["channel"])

    op.create_table(
        "notification_broadcasts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("cohort", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("channels_requested", sa.JSON(), nullable=False,
                  server_default="[]"),
        sa.Column("status", sa.String(16), nullable=False,
                  server_default="queued"),
        sa.Column("total_recipients", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("total_sent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_skipped", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("total_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
    )
    op.create_index(
        "ix_notification_broadcasts_status", "notification_broadcasts", ["status"])
    op.create_index(
        "ix_notification_broadcasts_created_at", "notification_broadcasts",
        ["created_at"])

    op.create_table(
        "notification_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("broadcast_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False,
                  server_default="pending"),
        sa.Column("skip_reason", sa.String(64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["broadcast_id"], ["notification_broadcasts.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.UniqueConstraint(
            "broadcast_id", "user_id", "channel",
            name="uq_notification_deliveries_triplet",
        ),
    )
    op.create_index(
        "ix_notification_deliveries_broadcast_id", "notification_deliveries",
        ["broadcast_id"])
    op.create_index(
        "ix_notification_deliveries_user_id", "notification_deliveries",
        ["user_id"])
    op.create_index(
        "ix_notification_deliveries_channel", "notification_deliveries",
        ["channel"])
    op.create_index(
        "ix_notification_deliveries_status", "notification_deliveries",
        ["status"])

    op.create_table(
        "build_releases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("build_number", sa.String(32), nullable=True),
        sa.Column("download_url", sa.String(1024), nullable=True),
        sa.Column("download_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signed", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("build_metadata", sa.JSON(), nullable=False,
                  server_default="{}"),
        sa.Column("released_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["released_by"], ["users.id"]),
        sa.UniqueConstraint(
            "platform", "version", "build_number",
            name="uq_build_releases_platform_version",
        ),
    )
    op.create_index("ix_build_releases_platform", "build_releases", ["platform"])
    op.create_index(
        "ix_build_releases_created_at", "build_releases", ["created_at"])

    op.create_table(
        "build_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("version", sa.String(32), nullable=True),
        sa.Column("ref", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False,
                  server_default="queued"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"]),
    )
    op.create_index("ix_build_requests_platform", "build_requests", ["platform"])
    op.create_index("ix_build_requests_status", "build_requests", ["status"])
    op.create_index(
        "ix_build_requests_created_at", "build_requests", ["created_at"])


def downgrade() -> None:
    # §۱۲: forward-only — downgrade فقط برای completeness زنجیره نگه داشته شده؛
    # در عمل rollback با migration جدید انجام می‌شود.
    op.drop_table("build_requests")
    op.drop_table("build_releases")
    op.drop_table("notification_deliveries")
    op.drop_table("notification_broadcasts")
    op.drop_table("content_distributions")
    op.drop_table("content_placements")
