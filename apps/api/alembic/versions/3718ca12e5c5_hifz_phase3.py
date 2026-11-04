"""Hifz Phase 3: hifz_attempts, hifz_word_scores, hifz_mistakes.

New tables only — no alteration of existing tables, so no batch mode is
needed (SQLite rule: batch_alter_table applies to ALTERs, not CREATEs).

Grading audio is transient and is never stored: these tables keep only
scores and mistakes, never audio bytes or audio references.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "3718ca12e5c5"
down_revision = "9e546ce5407f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hifz_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("engine", sa.String(length=40), nullable=False),
        sa.Column("extra_words", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hifz_attempts_user_id", "hifz_attempts", ["user_id"])
    op.create_index("ix_hifz_attempts_surah", "hifz_attempts", ["surah"])
    op.create_index("ix_hifz_attempts_page", "hifz_attempts", ["page"])
    op.create_index("ix_hifz_attempts_status", "hifz_attempts", ["status"])

    op.create_table(
        "hifz_word_scores",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("ayah", sa.Integer(), nullable=False),
        sa.Column("word_index", sa.Integer(), nullable=False),
        sa.Column("expected_text", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("prob", sa.Float(), nullable=False),
        sa.Column("heard", sa.String(length=120), nullable=True),
        sa.Column("mistake_type", sa.String(length=20), nullable=True),
        sa.Column("disputed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["attempt_id"], ["hifz_attempts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "attempt_id", "surah", "ayah", "word_index",
            name="uq_hifz_word_score_attempt_word",
        ),
    )
    op.create_index("ix_hifz_word_scores_attempt_id", "hifz_word_scores", ["attempt_id"])
    op.create_index("ix_hifz_word_scores_surah", "hifz_word_scores", ["surah"])
    op.create_index("ix_hifz_word_scores_ayah", "hifz_word_scores", ["ayah"])
    op.create_index("ix_hifz_word_scores_status", "hifz_word_scores", ["status"])
    op.create_index(
        "ix_hifz_word_score_attempt_ayah", "hifz_word_scores",
        ["attempt_id", "surah", "ayah"],
    )

    op.create_table(
        "hifz_mistakes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("ayah", sa.Integer(), nullable=False),
        sa.Column("word_index", sa.Integer(), nullable=True),
        sa.Column("mistake_type", sa.String(length=20), nullable=False),
        sa.Column("expected_text", sa.String(length=120), nullable=False),
        sa.Column("heard", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["attempt_id"], ["hifz_attempts.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hifz_mistakes_attempt_id", "hifz_mistakes", ["attempt_id"])
    op.create_index("ix_hifz_mistakes_user_id", "hifz_mistakes", ["user_id"])
    op.create_index("ix_hifz_mistakes_surah", "hifz_mistakes", ["surah"])
    op.create_index("ix_hifz_mistakes_ayah", "hifz_mistakes", ["ayah"])
    op.create_index("ix_hifz_mistakes_mistake_type", "hifz_mistakes", ["mistake_type"])
    op.create_index("ix_hifz_mistakes_created_at", "hifz_mistakes", ["created_at"])


def downgrade() -> None:
    op.drop_table("hifz_mistakes")
    op.drop_table("hifz_word_scores")
    op.drop_table("hifz_attempts")
