'use client';

/**
 * QuizRunnerShell — backend-agnostic quiz UI (Phase 8).
 *
 * Extracted from QuizRunner (Phase 6) without behavior change: the rendering
 * is identical, but the quiz session is injected as a prop instead of being
 * hard-wired to the fatwa hook. Both useQuizSession (fatwa) and
 * useLessonQuiz (LMS) return the same session shape, so both pages render
 * this shell. The state machine lives in lib/quiz.ts — never duplicated.
 */
import { useState } from 'react';
import type { useQuizSession } from '@/lib/hooks/useQuizSession';

export interface QuizRunnerLabels {
  startTitle: string;
  startHint: string;
  countLabel: string;
  generate: string;
  generating: string;
  questionOf: string; // "{current} / {total}" template
  next: string;
  prev: string;
  submit: string;
  submitting: string;
  unansweredHint: string;
  scoreTitle: string;
  scoreOf: string; // "{score} / {total}" template
  reviewTitle: string;
  correctLabel: string;
  wrongLabel: string;
  explanationLabel: string;
  retake: string;
  generateFailed: string;
  submitFailed: string;
  emptyFailed: string;
}

/** Session shape produced by useQuizSession and useLessonQuiz. */
export type QuizSession = ReturnType<typeof useQuizSession>;

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

export function QuizRunnerShell({ session: quiz, labels }: { session: QuizSession; labels: QuizRunnerLabels }) {
  const phase = quiz.state.phase;

  if (phase === 'idle' || phase === 'generating') {
    return <QuizStart quiz={quiz} labels={labels} phase={phase} />;
  }

  if (phase === 'failed') {
    return (
      <div className="ftw-error" role="alert">
        {quiz.state.error === '__empty__' ? labels.emptyFailed : labels.generateFailed}
        {quiz.state.error && quiz.state.error !== '__empty__' && quiz.state.error !== '__failed__'
          ? `: ${quiz.state.error}`
          : ''}
        <div>
          <button type="button" className="icon-btn" onClick={quiz.reset}>{labels.retake}</button>
        </div>
      </div>
    );
  }

  if (phase === 'review' && quiz.state.score) {
    return (
      <div className="ftw-quiz-review">
        <h2>{labels.scoreTitle}</h2>
        <p className="ftw-score" role="status">
          {fill(labels.scoreOf, { score: quiz.state.score.correct, total: quiz.state.score.total })}
          {quiz.percent !== null ? ` — ${quiz.percent}%` : ''}
        </p>
        <h3>{labels.reviewTitle}</h3>
        <ol className="ftw-review-list">
          {quiz.state.questions.map((q, i) => {
            const rev = quiz.reviewFor(q.id);
            const chosen = quiz.state.answers[q.id];
            const correctText =
              rev && rev.correctOption !== null && rev.correctOption !== undefined
                ? q.options[rev.correctOption]
                : null;
            return (
              <li key={q.id} className={rev?.correct ? 'ok' : 'bad'}>
                <p>
                  <strong>{i + 1}.</strong> {q.text}
                </p>
                <p>
                  {rev ? (rev.correct ? labels.correctLabel : labels.wrongLabel) : ''}{' '}
                  {typeof chosen === 'number' && q.options[chosen] ? `— ${q.options[chosen]}` : ''}
                </p>
                {correctText && (
                  <p>
                    {labels.correctLabel}: {correctText}
                  </p>
                )}
                {q.sourceCitation && (
                  <p className="ftw-cite">
                    {labels.explanationLabel}: {q.sourceCitation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <button type="button" className="ftw-ask" onClick={quiz.reset}>{labels.retake}</button>
      </div>
    );
  }

  const q = quiz.current;
  if (!q) return null;
  const chosen = quiz.state.answers[q.id];

  return (
    <div className="ftw-quiz-run">
      <p className="ftw-muted" aria-live="polite">
        {fill(labels.questionOf, { current: quiz.state.index + 1, total: quiz.state.questions.length })}
      </p>
      <h2>{q.text}</h2>
      <div className="ftw-options" role="radiogroup" aria-label={q.text}>
        {q.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={chosen === i}
            className={chosen === i ? 'ftw-opt on' : 'ftw-opt'}
            onClick={() => quiz.answer(q.id, i)}
            disabled={phase === 'submitting'}
          >
            {opt}
          </button>
        ))}
      </div>
      {quiz.state.error && (
        <div className="ftw-error" role="alert">
          {labels.submitFailed}: {quiz.state.error}
        </div>
      )}
      <div className="ftw-quiz-nav">
        <button
          type="button"
          className="icon-btn"
          disabled={quiz.state.index === 0 || phase === 'submitting'}
          onClick={() => quiz.goTo(quiz.state.index - 1)}
        >
          {labels.prev}
        </button>
        {quiz.state.index < quiz.state.questions.length - 1 ? (
          <button
            type="button"
            className="icon-btn"
            disabled={phase === 'submitting'}
            onClick={() => quiz.goTo(quiz.state.index + 1)}
          >
            {labels.next}
          </button>
        ) : (
          <button
            type="button"
            className="ftw-ask"
            disabled={!quiz.submittable || phase === 'submitting'}
            title={quiz.submittable ? '' : labels.unansweredHint}
            onClick={quiz.submit}
          >
            {phase === 'submitting' ? labels.submitting : labels.submit}
          </button>
        )}
      </div>
      {!quiz.submittable && (
        <p className="ftw-muted">
          {labels.unansweredHint} ({quiz.answered}/{quiz.state.questions.length})
        </p>
      )}
    </div>
  );
}

function QuizStart({
  quiz,
  labels,
  phase,
}: {
  quiz: QuizSession;
  labels: QuizRunnerLabels;
  phase: 'idle' | 'generating';
}) {
  const [count, setCount] = useState(5);
  return (
    <div className="ftw-quiz-start">
      <h2>{labels.startTitle}</h2>
      <p className="ftw-muted">{labels.startHint}</p>
      <div className="ftw-quiz-opts">
        <label>
          {labels.countLabel}
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            disabled={phase === 'generating'}
          />
        </label>
      </div>
      <button
        type="button"
        className="ftw-ask"
        disabled={phase === 'generating'}
        onClick={() => quiz.start({ count })}
      >
        {phase === 'generating' ? labels.generating : labels.generate}
      </button>
    </div>
  );
}
