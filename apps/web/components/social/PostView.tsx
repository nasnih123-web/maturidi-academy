'use client';

/**
 * PostView — post detail page: full post, like/follow, report button,
 * comments thread (client shell, ADR-001).
 */

import { usePostView } from '@/lib/hooks/useSocial';
import { CommentThread } from './CommentThread';
import { PostCard } from './PostCard';
import { ReportButton } from './ReportButton';
import type { SocialLabels } from './labels';

interface PostViewProps {
  postId: string;
  locale: string;
  labels: SocialLabels;
}

export function PostView({ postId, locale, labels }: PostViewProps) {
  const view = usePostView(postId);

  if (view.loading) {
    return (
      <div className="page-wrap">
        <p className="soc-status" role="status">
          {labels.loading}
        </p>
      </div>
    );
  }

  if (view.error || !view.detail) {
    return (
      <div className="page-wrap">
        <div className="soc-status" role="alert">
          <p>{labels.error}</p>
          <button type="button" className="soc-btn soc-btn-ghost" onClick={view.retry}>
            {labels.retry}
          </button>
        </div>
      </div>
    );
  }

  const post = view.detail.post;

  return (
    <div className="page-wrap">
      {post.group_id && (
        <a
          className="soc-back"
          href={`/${locale}/community/${encodeURIComponent(post.group_id)}`}
        >
          {post.group_name ?? labels.backToCommunity}
        </a>
      )}
      <PostCard
        post={post}
        locale={locale}
        onLike={() => void view.toggleLike()}
        onFollow={() => void view.toggleFollow()}
        labels={{
          like: labels.like,
          unlike: labels.unlike,
          follow: labels.follow,
          unfollow: labels.unfollow,
          comments: labels.comments,
        }}
      />
      <div className="soc-detail-actions">
        <ReportButton
          targetType="post"
          targetId={post.id}
          reportLabel={labels.report}
          dialogTitle={labels.reportTitle}
          reasonLabel={labels.reportReason}
          reasons={labels.reportReasons}
          submitLabel={labels.reportSubmit}
          cancelLabel={labels.reportCancel}
          successMessage={labels.reportSuccess}
          errorMessage={labels.reportError}
          closeLabel={labels.close}
        />
      </div>
      <CommentThread
        view={view}
        locale={locale}
        title={`${labels.commentsTitle} (${post.comments_count})`}
        emptyLabel={labels.emptyComments}
        placeholder={labels.commentPlaceholder}
        submitLabel={labels.comment}
        submittingLabel={labels.commenting}
        policyViolationMessage={labels.policyViolation}
        commentErrorMessage={labels.postError}
      />
    </div>
  );
}
