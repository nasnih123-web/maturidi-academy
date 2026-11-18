'use client';

/**
 * QuestionView — fatwa question form with the "already answered"
 * suggestion state (client shell, ADR-001).
 *
 * POST /api/v1/fatwa/questions returns {cluster_id, suggestion} —
 * when a suggestion is present the prior answer is shown immediately.
 * All state lives in useQuestionForm; this component renders.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuestionForm } from '@/lib/hooks/useSocial';
import { useAuth } from '@/lib/auth-context';
import { useProfileGate } from '@/lib/profile-client';
import { formatSocialDate, isSocialDemo } from '@/lib/social';
import type { FatwaQuestionLabels } from '@/components/social/labels';

interface QuestionViewProps {
  locale: string;
  labels: FatwaQuestionLabels;
  /** Screenshot/test aid: prefill the question box. */
  prefill?: string;
  /** Demo-only: submit the prefilled question on mount (static screenshots). */
  autoAsk?: boolean;
  /**
   * 'page' (default): standalone question page with an h1.
   * 'sidebar': compact box for the fatwa list sidebar — h2 heading,
   * same form, same submit/suggestion behaviour.
   */
  variant?: 'page' | 'sidebar';
  /**
   * Phase B: CRM flag profile.require_for_fatwa_question (via public
   * settings, passed by the server page). When on and the signed-in
   * user's profile is incomplete, a complete-your-profile wall
   * replaces the form — the API enforces the same rule (403
   * profile_incomplete) as the backstop.
   */
  profileRequired?: boolean;
}

export function QuestionView({ locale, labels, prefill, autoAsk, variant = 'page', profileRequired = false }: QuestionViewProps) {
  const sidebar = variant === 'sidebar';
  const form = useQuestionForm();
  const { loggedIn } = useAuth();
  const pathname = usePathname();
  const gate = useProfileGate(profileRequired && loggedIn);

  useEffect(() => {
    if (prefill) form.setText(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  useEffect(() => {
    // Static-screenshot path only: no live backend, no user interaction.
    if (autoAsk && prefill && isSocialDemo() && form.text === prefill && !form.asking && !form.result) {
      void form.ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk, prefill, form.text, form.asking, form.result]);

  const result = form.result;

  // Asking requires an account (the API rejects anonymous submits).
  // Signed-out visitors get sign-in / sign-up actions carrying `next`,
  // so after registering they land back on this page — instead of the
  // form failing silently like it used to.
  if (!loggedIn && !isSocialDemo()) {
    const nextParam = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <div className={sidebar ? 'ftw-ask-box' : 'page-wrap'}>
        {sidebar ? (
          <>
            <h2>{labels.title}</h2>
            <p className="ftw-ask-sub">{labels.subtitle}</p>
          </>
        ) : (
          <>
            <h1 className="page-title">{labels.title}</h1>
            <p className="page-sub">{labels.subtitle}</p>
          </>
        )}
        <p>{labels.loginRequired}</p>
        <div className="soc-composer-foot">
          <Link className="soc-btn soc-btn-primary" href={`/${locale}/register${nextParam}`}>
            {labels.signUp}
          </Link>
          <Link className="soc-btn" href={`/${locale}/login${nextParam}`}>
            {labels.signIn}
          </Link>
        </div>
      </div>
    );
  }

  // Phase B profile gate: signed in, but the CRM requires a complete
  // profile for asking and this user's profile is incomplete.
  if (gate.kind === 'blocked' && !isSocialDemo()) {
    const nextParam = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <div className={sidebar ? 'ftw-ask-box' : 'page-wrap'}>
        {sidebar ? (
          <>
            <h2>{labels.title}</h2>
            <p className="ftw-ask-sub">{labels.subtitle}</p>
          </>
        ) : (
          <>
            <h1 className="page-title">{labels.title}</h1>
            <p className="page-sub">{labels.subtitle}</p>
          </>
        )}
        <p>{labels.profileRequired}</p>
        <div className="soc-composer-foot">
          <Link className="soc-btn soc-btn-primary" href={`/${locale}/profile${nextParam}`}>
            {labels.completeProfile}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={sidebar ? 'ftw-ask-box' : 'page-wrap'}>
      {sidebar ? (
        <>
          <h2>{labels.title}</h2>
          <p className="ftw-ask-sub">{labels.subtitle}</p>
        </>
      ) : (
        <>
          <h1 className="page-title">{labels.title}</h1>
          <p className="page-sub">{labels.subtitle}</p>
        </>
      )}

      <form
        className="soc-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void form.ask();
        }}
      >
        <label className="soc-field" htmlFor="ftw-question-input">
          <span className="soc-field-label">{labels.questionLabel}</span>
          <textarea
            id="ftw-question-input"
            className="soc-composer-input"
            placeholder={labels.questionPlaceholder}
            value={form.text}
            onChange={(e) => form.setText(e.target.value)}
            rows={4}
            disabled={form.asking}
          />
        </label>
        {form.failed && (
          <p className="soc-error" role="alert">
            {labels.error}
          </p>
        )}
        <div className="soc-composer-foot">
          <button
            type="submit"
            className="soc-btn soc-btn-primary"
            disabled={form.asking || form.text.trim() === ''}
          >
            {form.asking ? labels.asking : labels.ask}
          </button>
        </div>
      </form>

      {result?.suggestion && (
        <section className="ftw-suggestion" aria-live="polite">
          <h2 className="soc-section-title">{labels.suggestionTitle}</h2>
          <p className="ftw-suggestion-answer">{result.suggestion.answer}</p>
          <div className="ftw-suggestion-meta">
            {result.suggestion.answered_at && (
              <span>
                {labels.answeredAt}: {formatSocialDate(result.suggestion.answered_at, locale)}
              </span>
            )}
            {result.cluster_id && (
              <span>
                {labels.clusterLabel}: {result.cluster_id}
              </span>
            )}
          </div>
        </section>
      )}

      {result && !result.suggestion && (
        <p className="soc-status" role="status">
          {labels.noSuggestion}
        </p>
      )}
    </div>
  );
}
