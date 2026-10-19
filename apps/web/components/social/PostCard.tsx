'use client';

/**
 * PostCard — presentational social post (ADR-001).
 *
 * Renders props only. Like/follow toggles are callbacks owned by the
 * calling view's hook; this component holds no network logic.
 */

import { formatSocialDate, type SocialPost } from '@/lib/social';

export interface PostCardLabels {
  like: string;
  unlike: string;
  follow: string;
  unfollow: string;
  comments: string;
}

interface PostCardProps {
  post: SocialPost;
  locale: string;
  labels: PostCardLabels;
  postHref?: string;
  onLike?: () => void;
  onFollow?: () => void;
}

export function PostCard({ post, locale, labels, postHref, onLike, onFollow }: PostCardProps) {
  const liked = Boolean(post.liked);
  const following = Boolean(post.following_author);
  const body = (
    <>
      <div className="soc-post-head">
        <span className="soc-post-author">{post.author.display_name}</span>
        {post.group_name && <span className="soc-post-group">{post.group_name}</span>}
        <time className="soc-post-date" dateTime={post.created_at}>
          {formatSocialDate(post.created_at, locale)}
        </time>
      </div>
      <p className="soc-post-body">{post.body}</p>
    </>
  );
  return (
    <article className="soc-post" aria-label={post.author.display_name}>
      {postHref ? (
        <a className="soc-post-link" href={postHref}>
          {body}
        </a>
      ) : (
        body
      )}
      <div className="soc-post-actions">
        <button
          type="button"
          className={`soc-btn soc-btn-ghost${liked ? ' is-active' : ''}`}
          onClick={onLike}
          aria-pressed={liked}
        >
          {liked ? labels.unlike : labels.like}
          {typeof post.likes_count === 'number' && (
            <span className="soc-count">{post.likes_count}</span>
          )}
        </button>
        <span className="soc-action-sep" aria-hidden="true" />
        <span className="soc-comments-count">
          {post.comments_count} {labels.comments}
        </span>
        <span className="soc-action-spacer" />
        <button
          type="button"
          className={`soc-btn soc-btn-ghost${following ? ' is-active' : ''}`}
          onClick={onFollow}
          aria-pressed={following}
        >
          {following ? labels.unfollow : labels.follow}
        </button>
      </div>
    </article>
  );
}
