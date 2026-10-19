"""Phase 16 — مدیریت پروژه و نیروی انسانی داخلی (PMS): projects/tasks/staff_members.

Revision ID: e6f1a2b3c4d5
Revises: 3f09e72ee6c1
Create Date: 2026-10-19

Forward-only (§۱۲). ADR-0014 documents the PMS contracts.
Conventions (§۱۵):
- FKs only to tables that exist in this or earlier phases (users, projects).
- All user-visible text is LocalizedText JSON (§۱۵.۴).
- tasks.related_entity_*: soft reference (string + UUID), no physical FK
  (§۹.۵ no future-FK coupling).
- UTC everywhere; DateTime(timezone=True).
- payroll/leave/contracts are deliberately NOT built (Phase 16 spec).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6f1a2b3c4d5'
down_revision: Union[str, None] = '3f09e72ee6c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=True,
        server_default=sa.func.now() if name == 'created_at' else None,
    )


def upgrade() -> None:
    # --- پروژه‌های داخلی تیم ---
    op.create_table(
        'projects',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('status', sa.String(16), nullable=False, default='active'),
        # active | on_hold | completed | archived — پرچم ساده؛ نه موتور گردش‌کار §۹
        sa.Column('created_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        _ts('created_at'),
        _ts('updated_at'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_projects_status', 'projects', ['status'], unique=False)
    op.create_index('ix_projects_created_by', 'projects', ['created_by'], unique=False)

    # --- تسک‌ها ---
    op.create_table(
        'tasks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('description', sa.JSON(), nullable=True),  # LocalizedText
        sa.Column('assignee_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('status', sa.String(16), nullable=False, default='backlog'),
        # backlog | todo | in_progress | review | done — گذارها در سرویس اعتبارسنجی می‌شوند
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('priority', sa.String(16), nullable=False, default='medium'),
        # low | medium | high | urgent
        sa.Column('related_entity_type', sa.String(64), nullable=True),
        sa.Column('related_entity_id', sa.Uuid(), nullable=True),
        # مرجع نرم، بدون FK فیزیکی (§۹.۵)
        sa.Column('due_notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        _ts('created_at'),
        _ts('updated_at'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tasks_project_id', 'tasks', ['project_id'], unique=False)
    op.create_index('ix_tasks_assignee_id', 'tasks', ['assignee_id'], unique=False)
    op.create_index('ix_tasks_status', 'tasks', ['status'], unique=False)
    op.create_index('ix_tasks_priority', 'tasks', ['priority'], unique=False)
    op.create_index('ix_tasks_created_by', 'tasks', ['created_by'], unique=False)
    op.create_index(
        'ix_tasks_related_entity', 'tasks',
        ['related_entity_type', 'related_entity_id'], unique=False,
    )

    # --- اعضای تیم داخلی (بدون حقوق/مرخصی/قرارداد — عمداً) ---
    op.create_table(
        'staff_members',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('department', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('joined_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True),
        _ts('created_at'),
        _ts('updated_at'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_staff_members_user_id'),
    )
    op.create_index('ix_staff_members_user_id', 'staff_members', ['user_id'], unique=False)
    op.create_index('ix_staff_members_is_active', 'staff_members', ['is_active'], unique=False)


def downgrade() -> None:
    # forward-only (§۱۲) — downgrade صوری برای سازگاری alembic
    op.drop_index('ix_staff_members_is_active', table_name='staff_members')
    op.drop_index('ix_staff_members_user_id', table_name='staff_members')
    op.drop_table('staff_members')
    op.drop_index('ix_tasks_related_entity', table_name='tasks')
    op.drop_index('ix_tasks_created_by', table_name='tasks')
    op.drop_index('ix_tasks_priority', table_name='tasks')
    op.drop_index('ix_tasks_status', table_name='tasks')
    op.drop_index('ix_tasks_assignee_id', table_name='tasks')
    op.drop_index('ix_tasks_project_id', table_name='tasks')
    op.drop_table('tasks')
    op.drop_index('ix_projects_created_by', table_name='projects')
    op.drop_index('ix_projects_status', table_name='projects')
    op.drop_table('projects')
