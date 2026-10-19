'use client';

/**
 * CommentThread — presentational comments list + add-comment form (ADR-001).
 * State machine lives in usePostView; the banned-word friendly message is
 * chosen by the view from `commentErrorCode`.
 */

import { CONTENT_POLICY_VIOLATION, type PostViewState } from '@/lib/hooks/useSocial';
import { formatSocialDate } from '@/lib/social';

interface CommentThreadProps {
  view: Pick<
    PostViewState,
    | 'detail'
    | 'commentBody'
    | 'setCommentBody'
    | 'commenting'
    | 'commentErrorCode'
    | 'commentFailed'
    | 'submitComment'
  >;
  locale: string;
  title: string;
  emptyLabel: string;
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  policyViolationMessage: string;
  commentErrorMessage: string;
}

export function CommentThread({
  view,
  locale,
  title,
  emptyLabel,
  placeholder,
  submitLabel,
  submittingLabel,
  policyViolationMessage,
  commentErrorMessage,
}: CommentThreadProps) {
  const comments = view.detail?.comments ?? [];
  const policyError = view.commentErrorCode === CONTENT_POLICY_VIOLATION;

  return (
    <section className="soc-comments" aria-label={title}>
      <h2 className="soc-section-title">{title}</h2>
      {comments.length === 0 ? (
        <p className="soc-empty">{emptyLabel}</p>
      ) : (
        <ol className="soc-comment-list">
          {comments.map((c) => (
            <li key={c.id} className="soc-comment">
              <div className="soc-comment-head">
                <span className="soc-comment-author">{c.author.display_name}</span>
                <time className="soc-post-date" dateTime={c.created_at}>
                  {formatSocialDate(c.created_at, locale)}
                </time>
              </div>
              <p className="soc-comment-body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="soc-comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void view.submitComment();
        }}
      >
        <label className="soc-composer-label" htmlFor="soc-comment-input">
          <span className="sr-only">{placeholder}</span>
          <textarea
            id="soc-comment-input"
            className="soc-composer-input"
            placeholder={placeholder}
            value={view.commentBody}
            onChange={(e) => view.setCommentBody(e.target.value)}
            rows={2}
            disabled={view.commenting}
          />
        </label>
        {policyError && (
          <p className="soc-error" role="alert">
            {policyViolationMessage}
          </p>
        )}
        {view.commentFailed && !policyError && (
          <p className="soc-error" role="alert">
            {commentErrorMessage}
          </p>
        )}
        <div className="soc-composer-foot">
          <button
            type="submit"
            className="soc-btn soc-btn-primary"
            disabled={view.commenting || view.commentBody.trim() === ''}
          >
            {view.commenting ? submittingLabel : submitLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
