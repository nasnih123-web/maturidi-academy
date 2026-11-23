"""بخش کودکان قرآن — فاز ۴: جدول‌های ویدیوی سوره، سؤال آزمون، تلاش و پیشرفت.

Revision ID: 0f64b32a1eae
Revises: 5eccbb7998d3
Create Date: 2026-11-23

- children_surah_videos: پیوند LibraryItem به سوره (ویدیو با لینک خارجی؛
  آپلود فایل محلی در این فاز نیست).
- children_quiz_questions: سؤال چندگزینه‌ای (mcq) یا جورکردنی (matching)
  برای یک سوره؛ source: auto (خودکار از متن سوره) یا crm.
- children_quiz_attempts: تلاش کاربر در آزمون یک سوره + ستاره‌ها.
- children_progress: پیشرفت هر کاربر روی هر سوره (ستاره، وضعیت،
  آخرین آیهٔ شنیده‌شده، آزمون/جورکردنی انجام‌شده).

downgrade هر چهار جدول را حذف می‌کند.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0f64b32a1eae'
down_revision: str | None = '5eccbb7998d3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "children_surah_videos",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["library_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "surah", "item_id", name="uq_children_surah_videos_surah_item"
        ),
    )
    op.create_index("ix_children_surah_videos_surah", "children_surah_videos", ["surah"])
    op.create_index(
        "ix_children_surah_videos_item_id", "children_surah_videos", ["item_id"]
    )

    op.create_table(
        "children_quiz_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("question_type", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="crm"),
        sa.Column(
            "payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default="true"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_children_quiz_questions_surah", "children_quiz_questions", ["surah"]
    )
    op.create_index(
        "ix_children_quiz_questions_question_type",
        "children_quiz_questions",
        ["question_type"],
    )
    op.create_index(
        "ix_children_quiz_questions_is_active",
        "children_quiz_questions",
        ["is_active"],
    )

    op.create_table(
        "children_quiz_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("question_type", sa.String(length=16), nullable=False),
        sa.Column(
            "question_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "answers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_children_quiz_attempts_user_id", "children_quiz_attempts", ["user_id"]
    )
    op.create_index(
        "ix_children_quiz_attempts_surah", "children_quiz_attempts", ["surah"]
    )

    op.create_table(
        "children_progress",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("stars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="not_started",
        ),
        sa.Column("last_ayah", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("listened_ayahs", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quiz_done", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("match_done", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "surah", name="uq_children_progress_user_surah"
        ),
    )
    op.create_index("ix_children_progress_user_id", "children_progress", ["user_id"])
    op.create_index("ix_children_progress_surah", "children_progress", ["surah"])
    op.create_index("ix_children_progress_status", "children_progress", ["status"])


def downgrade() -> None:
    op.drop_table("children_progress")
    op.drop_table("children_quiz_attempts")
    op.drop_table("children_quiz_questions")
    op.drop_table("children_surah_videos")
