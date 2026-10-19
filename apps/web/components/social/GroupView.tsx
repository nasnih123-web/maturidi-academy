'use client';

/**
 * GroupView — single group page: header, join/leave, group posts,
 * group-scoped composer (client shell, ADR-001).
 */

import { useComposer, useGroupView } from '@/lib/hooks/useSocial';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import { ReportButton } from './ReportButton';
import type { SocialLabels } from './labels';

interface GroupViewProps {
  groupId: string;
  locale: string;
  labels: SocialLabels;
}

export function GroupView({ groupId, locale, labels }: GroupViewProps) {
  const view = useGroupView(groupId);
  const composer = useComposer((post) => {
    // Group posts come from the paginated loader; after publishing we
    // reload the first page so the new post appears at the top.
    void view.retryAll();
    void post;
  });

  if (view.loading) {
    return (
      <div className="page-wrap">
        <p className="soc-status" role="status">
          {labels.loading}
        </p>
      </div>
    );
  }

  if (view.error || !view.group) {
    return (
      <div className="page-wrap">
        <div className="soc-status" role="alert">
          <p>{labels.error}</p>
          <button type="button" className="soc-btn soc-btn-ghost" onClick={view.retryAll}>
            {labels.retry}
          </button>
        </div>
      </div>
    );
  }

  const group = view.group;

  return (
    <div className="page-wrap">
      <a className="soc-back" href={`/${locale}/community`}>
        {labels.backToCommunity}
      </a>
      <div className="soc-group-hero">
        <div>
          <h1 className="page-title">{group.name}</h1>
          {group.description && <p className="page-sub">{group.description}</p>}
          <span className="soc-group-members">
            {group.member_count} {labels.members}
          </span>
        </div>
        <button
          type="button"
          className={`soc-btn${group.joined ? ' soc-btn-ghost' : ' soc-btn-primary'}`}
          onClick={view.toggleJoin}
          disabled={view.busyId !== null}
          aria-pressed={Boolean(group.joined)}
        >
          {view.busyId !== null
            ? group.joined
              ? labels.leaving
              : labels.joining
            : group.joined
              ? labels.leave
              : labels.join}
        </button>
      </div>

      <PostComposer
        composer={composer}
        groupId={groupId}
        placeholder={labels.composerPlaceholder}
        postLabel={labels.post}
        postingLabel={labels.posting}
        policyViolationMessage={labels.policyViolation}
        postErrorMessage={labels.postError}
        id="group-composer"
      />

      <h2 className="soc-section-title">{labels.groupPosts}</h2>
      {view.postsLoading && (
        <p className="soc-status" role="status">
          {labels.loading}
        </p>
      )}
      {view.postsError && (
        <div className="soc-status" role="alert">
          <p>{labels.error}</p>
          <button type="button" className="soc-btn soc-btn-ghost" onClick={view.retryAll}>
            {labels.retry}
          </button>
        </div>
      )}
      {!view.postsLoading && !view.postsError && view.posts.length === 0 && (
        <p className="soc-empty" role="status">
          {labels.emptyPosts}
        </p>
      )}
      <div className="soc-post-list">
        {view.posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            locale={locale}
            postHref={`/${locale}/community/post/${encodeURIComponent(p.id)}`}
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
      {view.hasMorePosts && (
        <div className="soc-more">
          <button
            type="button"
            className="soc-btn soc-btn-ghost"
            onClick={view.loadMorePosts}
            disabled={view.loadingMorePosts}
          >
            {labels.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
