'use client';

/**
 * PostComposer — presentational post publishing form (ADR-001).
 *
 * The state machine (body, posting, banned-word error code) lives in
 * useComposer; this component renders it. The friendly
 * content-policy message is chosen by the view from `errorCode`.
 */

import { CONTENT_POLICY_VIOLATION, type ComposerState } from '@/lib/hooks/useSocial';

interface PostComposerProps {
  composer: ComposerState;
  placeholder: string;
  postLabel: string;
  postingLabel: string;
  policyViolationMessage: string;
  postErrorMessage: string;
  groupId?: string | null;
  id?: string;
}

export function PostComposer({
  composer,
  placeholder,
  postLabel,
  postingLabel,
  policyViolationMessage,
  postErrorMessage,
  groupId,
  id,
}: PostComposerProps) {
  const { body, setBody, posting, errorCode, failed, publish } = composer;
  const policyError = errorCode === CONTENT_POLICY_VIOLATION;

  return (
    <form
      className="soc-composer"
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        void publish(groupId ?? null);
      }}
    >
      <label className="soc-composer-label" htmlFor={id ? `${id}-body` : 'soc-composer-body'}>
        <span className="sr-only">{placeholder}</span>
        <textarea
          id={id ? `${id}-body` : 'soc-composer-body'}
          className="soc-composer-input"
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          disabled={posting}
        />
      </label>
      {policyError && (
        <p className="soc-error" role="alert">
          {policyViolationMessage}
        </p>
      )}
      {failed && !policyError && (
        <p className="soc-error" role="alert">
          {postErrorMessage}
        </p>
      )}
      <div className="soc-composer-foot">
        <button
          type="submit"
          className="soc-btn soc-btn-primary"
          disabled={posting || body.trim() === ''}
        >
          {posting ? postingLabel : postLabel}
        </button>
      </div>
    </form>
  );
}
