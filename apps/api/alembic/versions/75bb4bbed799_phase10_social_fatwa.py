"""Social network + fatwa author panel + question clustering — phase 10.

Revision ID: 75bb4bbed799
Revises: 74f3c6f810a58fac
Create Date: 2026-10-19

Forward-only (§۱۲). New domain tables for the phase-10 track:

Social network:
- social_groups, group_memberships, social_posts, social_comments,
  social_follows
Moderation:
- social_reports (target_type/target_id polymorphic — no FK per §۹.۵
  "no future-FK coupling"; target references existing-phase tables only),
  moderation_banned_words
Fatwa author panel:
- fatwa_submissions — workflow_status follows the shared §۹ machine
  (draft → in_review → approved → published ↘ rejected / archived);
  the machine lives in app/core/workflow.py, the DB only stores the string.
Question clustering:
- question_clusters, cluster_members
Notifications (phase-2 infra extension — persisted so web/CRM can list):
- notifications
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '75bb4bbed799'
down_revision: Union[str, None] = '74f3c6f810a58fac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

WORKFLOW_STATUSES = ('draft', 'in_review', 'approved', 'published', 'rejected', 'archived')


def upgrade() -> None:
    # ------------------------------------------------------------------
    # social network
    # ------------------------------------------------------------------
    op.create_table(
        'social_groups',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('description', sa.JSON(), nullable=True),  # LocalizedText
        sa.Column('slug', sa.String(length=128), nullable=False),
        sa.Column('cover_media_id', sa.Uuid(), sa.ForeignKey('media_assets.id'), nullable=True),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('member_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug'),
    )
    op.create_index('ix_social_groups_created_at', 'social_groups', ['created_at'])

    op.create_table(
        'group_memberships',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('group_id', sa.Uuid(), sa.ForeignKey('social_groups.id'), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False, server_default='member'),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('group_id', 'user_id', name='uq_group_memberships_group_user'),
    )
    op.create_index('ix_group_memberships_group_id', 'group_memberships', ['group_id'])
    op.create_index('ix_group_memberships_user_id', 'group_memberships', ['user_id'])

    op.create_table(
        'social_posts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('group_id', sa.Uuid(), sa.ForeignKey('social_groups.id'), nullable=True),
        sa.Column('author_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        # published | removed (by moderation) — pre-publish filter rejects at the
        # service layer (§۱۵.۶), so no draft state is needed for posts.
        sa.Column('status', sa.String(length=16), nullable=False, server_default='published'),
        sa.Column('comment_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('likes_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_social_posts_created_at', 'social_posts', ['created_at'])
    op.create_index('ix_social_posts_author_id', 'social_posts', ['author_id'])
    op.create_index('ix_social_posts_group_id', 'social_posts', ['group_id'])

    op.create_table(
        'post_likes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('post_id', sa.Uuid(), sa.ForeignKey('social_posts.id'), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'user_id', name='uq_post_likes_pair'),
    )
    op.create_index('ix_post_likes_post_id', 'post_likes', ['post_id'])
    op.create_index('ix_post_likes_user_id', 'post_likes', ['user_id'])

    op.create_table(
        'social_comments',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('post_id', sa.Uuid(), sa.ForeignKey('social_posts.id'), nullable=False),
        sa.Column('author_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='published'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_social_comments_post_id', 'social_comments', ['post_id'])

    op.create_table(
        'social_follows',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('follower_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('followed_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('follower_id', 'followed_id', name='uq_social_follows_pair'),
    )
    op.create_index('ix_social_follows_follower_id', 'social_follows', ['follower_id'])

    # ------------------------------------------------------------------
    # moderation
    # ------------------------------------------------------------------
    op.create_table(
        'social_reports',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('target_type', sa.String(length=16), nullable=False),  # post | comment | user
        sa.Column('target_id', sa.Uuid(), nullable=False),  # polymorphic — no FK (§۹.۵)
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('reported_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        # new → triaged → actioned | dismissed
        sa.Column('status', sa.String(length=16), nullable=False, server_default='new'),
        sa.Column('reported_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('triaged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('actioned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sla_due_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('action', sa.String(length=32), nullable=True),  # triage | dismiss | remove_content | warn_user
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('actioned_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_social_reports_status', 'social_reports', ['status'])
    op.create_index('ix_social_reports_reported_at', 'social_reports', ['reported_at'])

    op.create_table(
        'moderation_banned_words',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('word', sa.String(length=128), nullable=False),
        sa.Column('added_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('word', name='uq_moderation_banned_words_word'),
    )

    # ------------------------------------------------------------------
    # fatwa author panel
    # ------------------------------------------------------------------
    op.create_table(
        'fatwa_submissions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('madhab', sa.String(length=16), nullable=True),
        sa.Column('evidence', sa.Text(), nullable=True),
        sa.Column('author_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('workflow_status', sa.String(length=16), nullable=False, server_default='draft'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('reviewed_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fatwa_submissions_status', 'fatwa_submissions', ['workflow_status'])
    op.create_index('ix_fatwa_submissions_author_id', 'fatwa_submissions', ['author_id'])

    # ------------------------------------------------------------------
    # question clustering
    # ------------------------------------------------------------------
    op.create_table(
        'question_clusters',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('representative_question', sa.Text(), nullable=False),
        sa.Column('embedding', sa.JSON(), nullable=True),
        # open | answered | archived
        sa.Column('status', sa.String(length=16), nullable=False, server_default='open'),
        sa.Column('answer', sa.Text(), nullable=True),
        sa.Column('answered_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_question_clusters_status', 'question_clusters', ['status'])

    op.create_table(
        'cluster_members',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('cluster_id', sa.Uuid(), sa.ForeignKey('question_clusters.id'), nullable=False),
        sa.Column('question_text', sa.Text(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False, server_default='direct'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_cluster_members_cluster_id', 'cluster_members', ['cluster_id'])
    op.create_index('ix_cluster_members_user_id', 'cluster_members', ['user_id'])

    # ------------------------------------------------------------------
    # notifications (persisted — web/CRM list endpoint)
    # ------------------------------------------------------------------
    op.create_table(
        'notifications',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('notif_type', sa.String(length=64), nullable=False),
        sa.Column('title', sa.JSON(), nullable=False),  # LocalizedText
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('data', sa.JSON(), nullable=True),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])
    op.create_index('ix_notifications_created_at', 'notifications', ['created_at'])


def downgrade() -> None:
    # §۱۲: forward-only — downgrade فقط برای سازگاری alembic، در عمل استفاده نمی‌شود.
    op.drop_table('notifications')
    op.drop_table('post_likes')
    op.drop_table('cluster_members')
    op.drop_table('question_clusters')
    op.drop_table('fatwa_submissions')
    op.drop_table('moderation_banned_words')
    op.drop_table('social_reports')
    op.drop_table('social_follows')
    op.drop_table('social_comments')
    op.drop_table('social_posts')
    op.drop_table('group_memberships')
    op.drop_table('social_groups')
