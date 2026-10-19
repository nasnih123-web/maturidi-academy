"""Phase 8 — LMS: curricula, courses, lessons, progress, certificates, cohorts, prerequisites.

Revision ID: f8a4b6c2d9e1
Revises: e7a1b2c3d4f5
Create Date: 2026-10-19

Forward-only (§۱۲). ADR-0018 documents the contracts.
Conventions (§۱۵):
- FKs only to tables that exist in this or earlier phases (users, lessons
  created here before the ALTER of quiz_attempts).
- UTC everywhere; DateTime(timezone=True).
- All user-visible text columns are LocalizedText JSON (never single-language).
- study_reports is service-computed (ADR-0018) — no table here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f8a4b6c2d9e1'
down_revision: Union[str, None] = 'e7a1b2c3d4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id_pk() -> list:
    return [sa.Column('id', sa.Uuid(), nullable=False)]


def upgrade() -> None:
    op.create_table(
        'curricula',
        *_id_pk(),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_curricula_is_active', 'curricula', ['is_active'])

    op.create_table(
        'courses',
        *_id_pk(),
        sa.Column('curriculum_id', sa.Uuid(), sa.ForeignKey('curricula.id'), nullable=True),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('description', sa.JSON(), nullable=True),
        sa.Column('level', sa.String(length=16), nullable=False, server_default='beginner'),
        sa.Column('visibility', sa.String(length=16), nullable=False, server_default='public'),
        sa.Column('thumbnail_media_ref', sa.String(length=1024), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_courses_curriculum_id', 'courses', ['curriculum_id'])
    op.create_index('ix_courses_level', 'courses', ['level'])
    op.create_index('ix_courses_is_active', 'courses', ['is_active'])

    op.create_table(
        'lessons',
        *_id_pk(),
        sa.Column('course_id', sa.Uuid(), sa.ForeignKey('courses.id'), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('body', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('duration_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_free_preview', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_lessons_course_id', 'lessons', ['course_id'])

    op.create_table(
        'user_progress',
        *_id_pk(),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('lesson_id', sa.Uuid(), sa.ForeignKey('lessons.id'), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='not_started'),
        sa.Column('position_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'lesson_id', name='uq_user_progress_user_lesson'),
    )
    op.create_index('ix_user_progress_user_id', 'user_progress', ['user_id'])
    op.create_index('ix_user_progress_lesson_id', 'user_progress', ['lesson_id'])

    op.create_table(
        'certificates',
        *_id_pk(),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('course_id', sa.Uuid(), sa.ForeignKey('courses.id'), nullable=False),
        sa.Column('code', sa.String(length=32), nullable=False),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('pdf_storage_ref', sa.String(length=1024), nullable=True),
        sa.Column('locale', sa.String(length=8), nullable=False, server_default='fa'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code', name='uq_certificates_code'),
    )
    op.create_index('ix_certificates_user_id', 'certificates', ['user_id'])
    op.create_index('ix_certificates_course_id', 'certificates', ['course_id'])

    op.create_table(
        'course_cohorts',
        *_id_pk(),
        sa.Column('course_id', sa.Uuid(), sa.ForeignKey('courses.id'), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('max_seats', sa.Integer(), nullable=False),
        sa.Column('is_open', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_course_cohorts_course_id', 'course_cohorts', ['course_id'])

    op.create_table(
        'cohort_enrollments',
        *_id_pk(),
        sa.Column('cohort_id', sa.Uuid(), sa.ForeignKey('course_cohorts.id'), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='active'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cohort_id', 'user_id', name='uq_cohort_enrollment_cohort_user'),
    )
    op.create_index('ix_cohort_enrollments_cohort_id', 'cohort_enrollments', ['cohort_id'])
    op.create_index('ix_cohort_enrollments_user_id', 'cohort_enrollments', ['user_id'])

    op.create_table(
        'course_prerequisites',
        *_id_pk(),
        sa.Column('course_id', sa.Uuid(), sa.ForeignKey('courses.id'), nullable=False),
        sa.Column('requires_course_id', sa.Uuid(), sa.ForeignKey('courses.id'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'course_id', 'requires_course_id', name='uq_course_prereq_pair'
        ),
    )
    op.create_index('ix_course_prerequisites_course_id', 'course_prerequisites', ['course_id'])
    op.create_index(
        'ix_course_prerequisites_requires', 'course_prerequisites', ['requires_course_id']
    )

    # lessons جدول در همین migration ساخته شد (§۹.۵: هیچ FK آینده‌نگر در فازهای قبل).
    # batch mode: روی SQLite افزودن ستونِ دارای FK فقط با copy-and-move ممکن است؛
    # روی PostgreSQL هم همان ALTER صادر می‌شود.
    with op.batch_alter_table("quiz_attempts") as batch_op:
        batch_op.add_column(sa.Column("lesson_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_quiz_attempts_lesson_id", "lessons", ["lesson_id"], ["id"]
        )
        batch_op.create_index("ix_quiz_attempts_lesson_id", ["lesson_id"])
