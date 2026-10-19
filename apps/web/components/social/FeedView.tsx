'use client';

/**
 * FeedView — personal feed page: composer + followed/groups posts with
 * like/follow toggles (client shell, ADR-001).
 */

import { useComposer, useSocialFeed } from '@/lib/hooks/useSocial';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import type { SocialLabels } from './labels';

interface FeedViewProps {
  locale: string;
  labels: SocialLabels;
}

export function FeedView({ locale, labels }: FeedViewProps) {
  const feed = useSocialFeed();
  const composer = useComposer(feed.prependPost);

  return (
    <div className="page-wrap">
      <h1 className="page-title">{labels.feedTitle}</h1>
      <p className="page-sub">{labels.feedSubtitle}</p>

      <PostComposer
        composer={composer}
        groupId={null}
        placeholder={labels.composerPlaceholder}
        postLabel={labels.post}
        postingLabel={labels.posting}
        policyViolationMessage={labels.policyViolation}
        postErrorMessage={labels.postError}
        id="feed-composer"
      />

      {feed.loading && (
        <p className="soc-status" role="status">
          {labels.loading}
        </p>
      )}
      {feed.error && !feed.loading && (
        <div className="soc-status" role="alert">
          <p>{labels.error}</p>
          <button type="button" className="soc-btn soc-btn-ghost" onClick={feed.retry}>
            {labels.retry}
          </button>
        </div>
      )}
      {!feed.loading && !feed.error && feed.posts.length === 0 && (
        <p className="soc-empty" role="status">
          {labels.emptyFeed}
        </p>
      )}
      <div className="soc-post-list">
        {feed.posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            locale={locale}
            postHref={`/${locale}/community/post/${encodeURIComponent(p.id)}`}
            onLike={() => void feed.toggleLike(p)}
            onFollow={() => void feed.toggleFollow(p)}
            labels={{
              like: labels.like,
              unlike: labels.unlike,
              follow: labels.follow,
              unfollow: labels.unfollow,
              comments: labels.comments,
            }}
          />
        ))}
      </div>
      {feed.hasMore && (
        <div className="soc-more">
          <button
            type="button"
            className="soc-btn soc-btn-ghost"
            onClick={() => void feed.loadMore()}
            disabled={feed.loadingMore}
          >
            {labels.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
