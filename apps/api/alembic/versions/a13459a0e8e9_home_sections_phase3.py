"""home_sections table — phase 3 (homepage + search backend)

Revision ID: a13459a0e8e9
Revises: bd898906c7e2
Create Date: 2026-10-18

Forward-only (§۱۲). No foreign keys — §۹.۵ no future-FK coupling:
home sections must not be physically coupled to tables of later-phase modules.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a13459a0e8e9'
down_revision: Union[str, None] = 'bd898906c7e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('home_sections',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('visible', sa.Boolean(), nullable=False, server_default=sa.true()),
    sa.Column('title', sa.JSON(), nullable=False),
    sa.Column('subtitle', sa.JSON(), nullable=True),
    sa.Column('data', sa.JSON(), nullable=True),
    sa.Column('empty_title', sa.JSON(), nullable=True),
    sa.Column('empty_hint', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key')
    )
    op.create_index(op.f('ix_home_sections_key'), 'home_sections', ['key'], unique=True)
    op.create_index(op.f('ix_home_sections_sort_order'), 'home_sections', ['sort_order'], unique=False)


def downgrade() -> None:
    # forward-only per §۱۲ — kept only for alembic chain completeness; not used.
    op.drop_index(op.f('ix_home_sections_sort_order'), table_name='home_sections')
    op.drop_index(op.f('ix_home_sections_key'), table_name='home_sections')
    op.drop_table('home_sections')
