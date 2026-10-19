"""روتر شبکهٔ اجتماعی و نظارت — فاز ۱۰.

قرارداد: §۱ (پیشوند /api/v1، پاکت خطای یکدست، صفحه‌بندی cursor،
زمان ISO 8601). منطق کسب‌وکار فقط در service.py (§۱۵.۶).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import SocialGroup, User
from app.modules.auth.dependencies import get_current_user, require_permission
from app.modules.social import schemas, service

social_router = APIRouter(prefix="/api/v1/social", tags=["social"])
admin_social_router = APIRouter(prefix="/api/v1/admin/social", tags=["admin-social"])
moderation_router = APIRouter(prefix="/api/v1/moderation", tags=["moderation"])

_moderate = require_permission("social.moderate")
_words = require_permission("moderation.words")

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def _limit(value: int) -> int:
    return max(1, min(MAX_LIMIT, value))


# ---------------------------------------------------------------------------
# گروه‌ها
# ---------------------------------------------------------------------------


def _group_out(
    group: SocialGroup, *, is_member: bool = False
) -> schemas.GroupOut:
    return schemas.GroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        slug=group.slug,
        is_public=group.is_public,
        member_count=group.member_count or 0,
        is_member=is_member,
        created_at=group.created_at,
    )


@social_router.post("/groups", response_model=schemas.GroupOut, status_code=201)
async def create_group(
    payload: schemas.GroupCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_moderate),
):
    group = await service.create_group(
        db,
        name=dict(payload.name),
        description=dict(payload.description) if payload.description else None,
        slug=payload.slug,
        is_public=payload.is_public,
        creator=user,
    )
    return _group_out(group, is_member=True)


@social_router.get("/groups", response_model=schemas.GroupPage)
async def list_groups(
    after: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    groups, next_cursor = await service.list_groups(
        db, cursor=after, limit=limit, user_id=user.id
    )
    items = [
        _group_out(g, is_member=await service.is_member(db, g.id, user.id))
        for g in groups
    ]
    return schemas.GroupPage(items=items, next_cursor=next_cursor)


@social_router.get("/groups/{group_id}", response_model=schemas.GroupOut)
async def get_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await service.get_group(db, group_id)
    return _group_out(
        group, is_member=await service.is_member(db, group.id, user.id)
    )


@social_router.post("/groups/{group_id}/join", response_model=schemas.GroupOut)
async def join_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await service.get_group(db, group_id)
    await service.join_group(db, group, user)
    return _group_out(group, is_member=True)


@social_router.post("/groups/{group_id}/leave", response_model=schemas.GroupOut)
async def leave_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    group = await service.get_group(db, group_id)
    await service.leave_group(db, group, user)
    return _group_out(group, is_member=False)


# ---------------------------------------------------------------------------
# پست، فید، کامنت
# ---------------------------------------------------------------------------


def _post_out(post, liked_ids: set | None = None) -> schemas.PostOut:
    return schemas.PostOut(
        id=post.id,
        group_id=post.group_id,
        author_id=post.author_id,
        body=post.body,
        status=post.status,
        comment_count=post.comment_count or 0,
        likes_count=post.likes_count or 0,
        liked=bool(liked_ids and post.id in liked_ids),
        created_at=post.created_at,
    )


@social_router.get("/feed", response_model=schemas.FeedPage)
async def feed(
    after: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    group_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    posts, next_cursor = await service.list_feed(
        db, cursor=after, limit=limit, group_id=group_id
    )
    liked_ids = await service.liked_post_ids(db, user.id, [p.id for p in posts])
    return schemas.FeedPage(
        items=[_post_out(p, liked_ids) for p in posts], next_cursor=next_cursor
    )


@social_router.get("/groups/{group_id}/posts", response_model=schemas.FeedPage)
async def group_posts(
    group_id: UUID,
    after: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await service.get_group(db, group_id)
    posts, next_cursor = await service.list_feed(
        db, cursor=after, limit=limit, group_id=group_id
    )
    liked_ids = await service.liked_post_ids(db, user.id, [p.id for p in posts])
    return schemas.FeedPage(
        items=[_post_out(p, liked_ids) for p in posts], next_cursor=next_cursor
    )


@social_router.post("/posts", response_model=schemas.PostOut, status_code=201)
async def create_post(
    payload: schemas.PostCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = await service.create_post(
        db, author=user, body=payload.body, group_id=payload.group_id
    )
    return _post_out(post)


@social_router.get("/posts/{post_id}", response_model=schemas.PostOut)
async def get_post(
    post_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = await service.get_post(db, post_id)
    liked_ids = await service.liked_post_ids(db, user.id, [post.id])
    return _post_out(post, liked_ids)


@social_router.post("/posts/{post_id}/like", response_model=schemas.LikeOut)
async def like_post(
    post_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = await service.get_post(db, post_id)
    liked, count = await service.like_post(db, post=post, user=user)
    return schemas.LikeOut(liked=liked, likes_count=count)


@social_router.delete("/posts/{post_id}/like", response_model=schemas.LikeOut)
async def unlike_post(
    post_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = await service.get_post(db, post_id)
    liked, count = await service.unlike_post(db, post=post, user=user)
    return schemas.LikeOut(liked=liked, likes_count=count)


def _comment_out(comment) -> schemas.CommentOut:
    return schemas.CommentOut(
        id=comment.id,
        post_id=comment.post_id,
        author_id=comment.author_id,
        body=comment.body,
        status=comment.status,
        created_at=comment.created_at,
    )


@social_router.post(
    "/posts/{post_id}/comments", response_model=schemas.CommentOut, status_code=201
)
async def create_comment(
    post_id: UUID,
    payload: schemas.CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = await service.get_post(db, post_id)
    comment = await service.create_comment(db, author=user, post=post, body=payload.body)
    return _comment_out(comment)


@social_router.get(
    "/posts/{post_id}/comments", response_model=schemas.CommentPage
)
async def list_comments(
    post_id: UUID,
    after: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    post = await service.get_post(db, post_id)
    comments, next_cursor = await service.list_comments(
        db, post, cursor=after, limit=limit
    )
    return schemas.CommentPage(
        items=[_comment_out(c) for c in comments], next_cursor=next_cursor
    )


@social_router.post("/follows", response_model=schemas.FollowOut, status_code=201)
async def follow(
    payload: schemas.FollowCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    follow = await service.follow_user(db, follower=user, followed_id=payload.followed_id)
    return schemas.FollowOut(
        id=follow.id,
        follower_id=follow.follower_id,
        followed_id=follow.followed_id,
        created_at=follow.created_at,
    )


@social_router.delete("/follows/{followed_id}", status_code=200)
async def unfollow(
    followed_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    removed = await service.unfollow_user(db, follower=user, followed_id=followed_id)
    return {"unfollowed": removed}


# ---------------------------------------------------------------------------
# گزارش تخلف
# ---------------------------------------------------------------------------


@social_router.post("/report", response_model=schemas.ReportOut, status_code=201)
async def report(
    payload: schemas.ReportCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    r = await service.create_report(
        db,
        reporter=user,
        target_type=payload.target_type,
        target_id=payload.target_id,
        reason=payload.reason,
    )
    return _report_out(r)


def _report_out(r) -> schemas.ReportOut:
    return schemas.ReportOut(
        id=r.id,
        target_type=r.target_type,
        target_id=r.target_id,
        reason=r.reason,
        reported_by=r.reported_by,
        status=r.status,
        reported_at=r.reported_at,
        triaged_at=r.triaged_at,
        actioned_at=r.actioned_at,
        sla_due_at=r.sla_due_at,
        action=r.action,
        note=r.note,
    )


@admin_social_router.get("/reports", response_model=schemas.ReportQueuePage)
async def report_queue(
    status: str | None = Query(default=None),
    after: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_moderate),
):
    reports, next_cursor = await service.list_reports(
        db, status=status, cursor=after, limit=limit
    )
    return schemas.ReportQueuePage(
        items=[_report_out(r) for r in reports], next_cursor=next_cursor
    )


@admin_social_router.post("/reports/{report_id}/action", response_model=schemas.ReportOut)
async def report_action(
    report_id: UUID,
    payload: schemas.ReportAction,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_moderate),
):
    report = await service.get_report(db, report_id)
    report = await service.action_report(
        db, report=report, action=payload.action, note=payload.note, actor=user
    )
    return _report_out(report)


# ---------------------------------------------------------------------------
# کلمات ممنوعه (مدیریت)
# ---------------------------------------------------------------------------


@moderation_router.get("/banned-words", response_model=list[schemas.BannedWordOut])
async def list_banned_words(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_words),
):
    words = await service.list_banned_words(db)
    return [
        schemas.BannedWordOut(id=w.id, word=w.word, created_at=w.created_at)
        for w in words
    ]


@moderation_router.post(
    "/banned-words", response_model=schemas.BannedWordOut, status_code=201
)
async def add_banned_word(
    payload: schemas.BannedWordCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_words),
):
    w = await service.add_banned_word(db, word=payload.word, added_by=user)
    return schemas.BannedWordOut(id=w.id, word=w.word, created_at=w.created_at)


@moderation_router.delete("/banned-words/{word_id}", status_code=204)
async def delete_banned_word(
    word_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(_words),
):
    await service.delete_banned_word(db, word_id)
    return None


# ---------------------------------------------------------------------------
# اعلان‌ها
# ---------------------------------------------------------------------------


@social_router.get("/notifications", response_model=schemas.NotificationPage)
async def notifications(
    after: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items, next_cursor = await service.list_notifications(
        db, user, cursor=after, limit=limit
    )
    return schemas.NotificationPage(
        items=[
            schemas.NotificationOut(
                id=n.id,
                notif_type=n.notif_type,
                title=n.title,
                body=n.body,
                data=n.data,
                read_at=n.read_at,
                created_at=n.created_at,
            )
            for n in items
        ],
        next_cursor=next_cursor,
    )


@social_router.post(
    "/notifications/{notif_id}/read", response_model=schemas.NotificationOut
)
async def notification_read(
    notif_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = await service.mark_notification_read(db, user, notif_id)
    return schemas.NotificationOut(
        id=n.id,
        notif_type=n.notif_type,
        title=n.title,
        body=n.body,
        data=n.data,
        read_at=n.read_at,
        created_at=n.created_at,
    )


@social_router.get("/notifications/unread-count", response_model=dict)
async def notifications_unread_count(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return {"unread": await service.unread_count(db, user)}
