'use client';

/**
 * useQuizSession — quiz runner hook for the fatwa quiz (Phase 6).
 *
 * Thin adapter: the state machine lives in lib/quiz.ts (reusable by the
 * Phase-8 LMS); this hook only wires it to the fatwa quiz fetchers from
 * lib/fatwa.ts and React state.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  applyAnswer,
  applyIndex,
  answeredCount,
  canSubmit,
  currentQuestion,
  finishQuiz,
  initialQuizState,
  reviewFor,
  scorePercent,
  startQuiz,
  type QuizFetchers,
  type QuizQuestion,
  type QuizState,
} from '../quiz';
import { generateQuiz, submitQuiz } from '../fatwa';

function makeFetchers(locale: string): QuizFetchers {
  return {
    generate: async (opts, signal) => {
      const res = await generateQuiz({ count: opts.count, locale, signal });
      return {
        attemptId: res.attempt_id,
        questions: res.questions.map(
          (q): QuizQuestion => ({
            id: q.id,
            text: q.question_text,
            options: q.options,
            sourceCitation: q.source_citation || undefined,
          }),
        ),
      };
    },
    submit: async (attemptId, answers, signal) => {
      const res = await submitQuiz(attemptId, answers, signal);
      return {
        score: { correct: res.correct, total: res.total, percent: res.score_percent },
        review: res.review.map((r) => ({
          questionId: r.question_id,
          correct: r.correct,
          given: r.given,
          correctOption: r.correct_option,
        })),
      };
    },
  };
}

export function useQuizSession(locale: string) {
  const [state, setState] = useState<QuizState>(initialQuizState);
  const abortRef = useRef<AbortController | null>(null);
  const fetchers = useMemo(() => makeFetchers(locale), [locale]);

  const freshSignal = useCallback((): AbortSignal => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }, []);

  const start = useCallback(
    (opts: { count: number }) => startQuiz(setState, fetchers, { count: opts.count, category: null }, freshSignal()),
    [fetchers, freshSignal],
  );

  const answer = useCallback((questionId: string, optionIndex: number) => {
    setState((s) => (s.phase === 'answering' ? applyAnswer(s, questionId, optionIndex) : s));
  }, []);

  const goTo = useCallback((index: number) => {
    setState((s) => applyIndex(s, index));
  }, []);

  const submit = useCallback(
    () => finishQuiz(setState, fetchers, freshSignal()),
    [fetchers, freshSignal],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initialQuizState());
  }, []);

  return useMemo(
    () => ({
      state,
      start,
      answer,
      goTo,
      submit,
      reset,
      current: currentQuestion(state),
      answered: answeredCount(state),
      submittable: canSubmit(state),
      percent: scorePercent(state),
      reviewFor: (questionId: string) => reviewFor(state, questionId),
    }),
    [state, start, answer, goTo, submit, reset],
  );
}
