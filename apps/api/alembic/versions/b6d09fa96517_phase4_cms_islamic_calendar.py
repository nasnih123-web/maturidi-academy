"""CMS + Islamic calendar tables — phase 4 (content control §۹.۵).

Revision ID: b6d09fa96517
Revises: a13459a0e8e9
Create Date: 2026-10-18

Forward-only (§۱۲). New domain tables for the CMS track of phase 4:
islamic_events, scholar_quotes, pages, nav_items, banners, announcements.

Conventions (§۹, §۹.۵):
- workflow_status on all publishable tables follows the shared §۹ machine
  (draft → in_review → approved → published ↘ rejected / archived).
  The machine itself is implemented in app/core/workflow.py — the DB only
  stores the status string.
- distribution: JSONB {"web","mobile","desktop","telegram","ai_knowledge"} with
  independent per-surface toggles (§۹.۵). Defaults (web=true on publish,
  everything else false) are applied by the service layer, not the DB.
- nav_items carry no workflow_status: visibility is driven by `visible` +
  schedule window, per the phase-4 track spec.
- FK to themes.id (islamic_events.theme_id) is a same-repo domain reference,
  not a future-phase coupling (§۹.۵ "no future-FK coupling" is about phases
  that don't exist yet — themes exists since phase 0).
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'b6d09fa96517'
down_revision: str | None = 'a13459a0e8e9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WORKFLOW_STATUSES = ('draft', 'in_review', 'approved', 'published', 'rejected', 'archived')


def _audit_cols():
    return [
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.Uuid(),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    # --- islamic_events ---
    op.create_table(
        'islamic_events',
        *_audit_cols(),
        sa.Column('name', sa.JSON(), nullable=False),
        sa.Column('hijri_month', sa.Integer(), nullable=False),
        sa.Column('hijri_day', sa.Integer(), nullable=False),
        sa.Column('recurring', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('theme_id', sa.Uuid(), sa.ForeignKey('themes.id'), nullable=True),
        sa.Column('auto_publish', sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column('needs_admin_confirmation', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('image_url', sa.String(length=1024), nullable=True),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('distribution', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_islamic_events_hijri', 'islamic_events',
                    ['hijri_month', 'hijri_day'])
    op.create_index('ix_islamic_events_workflow_status', 'islamic_events',
                    ['workflow_status'])

    # --- scholar_quotes ---
    op.create_table(
        'scholar_quotes',
        *_audit_cols(),
        sa.Column('text', sa.JSON(), nullable=False),
        sa.Column('scholar', sa.JSON(), nullable=False),
        sa.Column('source', sa.String(length=512), nullable=True),
        sa.Column('quote_date', sa.Date(), nullable=True),
        sa.Column('avatar_url', sa.String(length=1024), nullable=True),
        sa.Column('placements', sa.JSON(), nullable=False,
                  server_default=sa.text("'[]'")),
        sa.Column('distribution', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scholar_quotes_workflow_status', 'scholar_quotes',
                    ['workflow_status'])

    # --- pages ---
    op.create_table(
        'pages',
        *_audit_cols(),
        sa.Column('slug', sa.String(length=160), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('blocks', sa.JSON(), nullable=False,
                  server_default=sa.text("'[]'")),
        sa.Column('seo_meta', sa.JSON(), nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column('content_type', sa.String(length=16), nullable=False,
                  server_default='page'),  # page | article | faq
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('distribution', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug'),
    )
    op.create_index(op.f('ix_pages_slug'), 'pages', ['slug'], unique=True)
    op.create_index('ix_pages_workflow_status', 'pages', ['workflow_status'])
    op.create_index('ix_pages_content_type', 'pages', ['content_type'])

    # --- nav_items ---
    op.create_table(
        'nav_items',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('label', sa.JSON(), nullable=False),
        sa.Column('parent_id', sa.Uuid(),
                  sa.ForeignKey('nav_items.id'), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('visible', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('locale', sa.String(length=8), nullable=True),  # fa|ar|en|null=all
        sa.Column('link_type', sa.String(length=16), nullable=False,
                  server_default='internal'),  # internal | external
        sa.Column('url', sa.String(length=1024), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_nav_items_parent', 'nav_items', ['parent_id'])
    op.create_index('ix_nav_items_sort_order', 'nav_items', ['sort_order'])

    # --- banners ---
    op.create_table(
        'banners',
        *_audit_cols(),
        sa.Column('title', sa.JSON(), nullable=False),
        sa.Column('subtitle', sa.JSON(), nullable=True),
        sa.Column('media', sa.JSON(), nullable=False,
                  server_default=sa.text("'{}'")),  # {type: image|video, url, variants?}
        sa.Column('cta', sa.JSON(), nullable=True),  # {text: LocalizedText, url}
        sa.Column('placement', sa.String(length=64), nullable=False,
                  server_default='homepage'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('audience', sa.JSON(), nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('distribution', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_banners_placement', 'banners', ['placement'])
    op.create_index('ix_banners_workflow_status', 'banners', ['workflow_status'])
    op.create_index('ix_banners_priority', 'banners', ['priority'])

    # --- announcements ---
    op.create_table(
        'announcements',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workflow_status', sa.String(length=16), nullable=False,
                  server_default='draft'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.Uuid(),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('message', sa.JSON(), nullable=False),
        sa.Column('dismissible', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('audience', sa.JSON(), nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column('placement', sa.String(length=64), nullable=False,
                  server_default='global'),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('distribution', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_announcements_placement', 'announcements', ['placement'])
    op.create_index('ix_announcements_workflow_status', 'announcements',
                    ['workflow_status'])


def downgrade() -> None:
    # forward-only per §۱۲ — kept only for alembic chain completeness; not used.
    op.drop_table('announcements')
    op.drop_table('banners')
    op.drop_table('nav_items')
    op.drop_table('pages')
    op.drop_table('scholar_quotes')
    op.drop_table('islamic_events')
