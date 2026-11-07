"""Phase 10 — جدول‌های حفاظ: برنامه، SRS، آزمون، تسمی.

Revision ID: 2e6a9529d1a0
Revises: 3718ca12e5c5
Create Date: 2026-11-07

جدول‌های تازه (مدل‌ها در app/models/models.py، فاز ۱۰):
- hifz_plans + hifz_plan_items: برنامهٔ حفظ (عادی/معکوس) + آیه‌های آن.
- hifz_reviews: وضعیت SRS هر آیه (SM-2 نسخه‌دار).
- hifz_tests + hifz_test_questions: آزمون موقت + سؤال‌ها و رویدادهای خام.
- hifz_tasmi_sessions: نشست‌های روش تمرین تسمی (خودارزیابی).

هیچ جدول قدیمی‌ای تغییر نمی‌کند؛ downgrade همهٔ جدول‌های تازه را
حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '2e6a9529d1a0'
down_revision: str | None = '3718ca12e5c5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hifz_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="memorize"),
        sa.Column("direction", sa.String(length=10), nullable=False, server_default="normal"),
        sa.Column("start_surah", sa.Integer(), nullable=False),
        sa.Column("start_ayah", sa.Integer(), nullable=False),
        sa.Column("end_surah", sa.Integer(), nullable=False),
        sa.Column("end_ayah", sa.Integer(), nullable=False),
        sa.Column("daily_target_new", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("daily_target_review", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hifz_plans_user_id", "hifz_plans", ["user_id"])
    op.create_index("ix_hifz_plans_kind", "hifz_plans", ["kind"])
    op.create_index("ix_hifz_plans_status", "hifz_plans", ["status"])

    op.create_table(
        "hifz_plan_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("ayah", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_new", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["hifz_plans.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plan_id", "surah", "ayah", name="uq_hifz_plan_item_plan_ayah"),
    )
    op.create_index("ix_hifz_plan_items_plan_id", "hifz_plan_items", ["plan_id"])
    op.create_index("ix_hifz_plan_items_user_id", "hifz_plan_items", ["user_id"])
    op.create_index("ix_hifz_plan_items_surah", "hifz_plan_items", ["surah"])
    op.create_index("ix_hifz_plan_items_ayah", "hifz_plan_items", ["ayah"])
    op.create_index("ix_hifz_plan_items_position", "hifz_plan_items", ["position"])
    op.create_index("ix_hifz_plan_items_status", "hifz_plan_items", ["status"])
    op.create_index(
        "ix_hifz_plan_item_plan_pos", "hifz_plan_items", ["plan_id", "position"]
    )

    op.create_table(
        "hifz_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("ayah", sa.Integer(), nullable=False),
        sa.Column("ease", sa.Float(), nullable=False, server_default="2.5"),
        sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("repetitions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_quality", sa.Integer(), nullable=True),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("params_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "surah", "ayah", name="uq_hifz_review_user_ayah"),
    )
    op.create_index("ix_hifz_reviews_user_id", "hifz_reviews", ["user_id"])
    op.create_index("ix_hifz_reviews_surah", "hifz_reviews", ["surah"])
    op.create_index("ix_hifz_reviews_ayah", "hifz_reviews", ["ayah"])
    op.create_index("ix_hifz_reviews_due_at", "hifz_reviews", ["due_at"])
    op.create_index("ix_hifz_review_user_due", "hifz_reviews", ["user_id", "due_at"])

    op.create_table(
        "hifz_tests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah_start", sa.Integer(), nullable=False),
        sa.Column("surah_end", sa.Integer(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("time_limit_minutes", sa.Integer(), nullable=True),
        sa.Column("question_length", sa.String(length=10), nullable=False, server_default="medium"),
        sa.Column("stop_rule", sa.String(length=10), nullable=False, server_default="ayah_end"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="in_progress"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hifz_tests_user_id", "hifz_tests", ["user_id"])
    op.create_index("ix_hifz_tests_status", "hifz_tests", ["status"])

    op.create_table(
        "hifz_test_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("test_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("ayah_start", sa.Integer(), nullable=False),
        sa.Column("ayah_end", sa.Integer(), nullable=False),
        sa.Column("prompt_words", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("prompt", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("peek_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_events", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["test_id"], ["hifz_tests.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("test_id", "position", name="uq_hifz_test_question_test_pos"),
    )
    op.create_index("ix_hifz_test_questions_test_id", "hifz_test_questions", ["test_id"])
    op.create_index("ix_hifz_test_questions_position", "hifz_test_questions", ["position"])
    op.create_index("ix_hifz_test_questions_status", "hifz_test_questions", ["status"])

    op.create_table(
        "hifz_tasmi_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("method", sa.String(length=20), nullable=False),
        sa.Column("variant", sa.String(length=20), nullable=False, server_default="standard"),
        sa.Column("start_surah", sa.Integer(), nullable=False),
        sa.Column("start_ayah", sa.Integer(), nullable=False),
        sa.Column("end_surah", sa.Integer(), nullable=False),
        sa.Column("end_ayah", sa.Integer(), nullable=False),
        sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("self_assessed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("reflection", sa.String(length=2000), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hifz_tasmi_sessions_user_id", "hifz_tasmi_sessions", ["user_id"])
    op.create_index("ix_hifz_tasmi_sessions_method", "hifz_tasmi_sessions", ["method"])
    op.create_index("ix_hifz_tasmi_sessions_status", "hifz_tasmi_sessions", ["status"])


def downgrade() -> None:
    op.drop_table("hifz_tasmi_sessions")
    op.drop_table("hifz_test_questions")
    op.drop_table("hifz_tests")
    op.drop_table("hifz_reviews")
    op.drop_table("hifz_plan_items")
    op.drop_table("hifz_plans")
