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
import { useQuestionForm } from '@/lib/hooks/useSocial';
import { formatSocialDate, isSocialDemo } from '@/lib/social';
import type { FatwaQuestionLabels } from '@/components/social/labels';

interface QuestionViewProps {
  locale: string;
  labels: FatwaQuestionLabels;
  /** Screenshot/test aid: prefill the question box. */
  prefill?: string;
  /** Demo-only: submit the prefilled question on mount (static screenshots). */
  autoAsk?: boolean;
}

export function QuestionView({ locale, labels, prefill, autoAsk }: QuestionViewProps) {
  const form = useQuestionForm();

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

  return (
    <div className="page-wrap">
      <h1 className="page-title">{labels.title}</h1>
      <p className="page-sub">{labels.subtitle}</p>

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
