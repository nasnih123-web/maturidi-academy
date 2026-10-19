'use client';

/**
 * useLessonQuiz — lesson quiz session hook (Phase 8).
 *
 * Same session shape as useQuizSession (Phase 6) so QuizRunnerShell can
 * render either backend. Thin adapter: the state machine lives in
 * lib/quiz.ts; the fetchers come from lib/lms.ts (makeLessonQuizFetchers).
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
} from '../quiz';
import { makeLessonQuizFetchers } from '../lms';

export function useLessonQuiz(lessonId: string) {
  const [state, setState] = useState(initialQuizState);
  const abortRef = useRef<AbortController | null>(null);
  const fetchers: QuizFetchers = useMemo(() => makeLessonQuizFetchers(lessonId), [lessonId]);

  const freshSignal = useCallback((): AbortSignal => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }, []);

  const start = useCallback(
    (opts: { count: number }) =>
      startQuiz(setState, fetchers, { count: opts.count, category: null }, freshSignal()),
    [fetchers, freshSignal],
  );

  const answer = useCallback((questionId: string, optionIndex: number) => {
    setState((s) => (s.phase === 'answering' ? applyAnswer(s, questionId, optionIndex) : s));
  }, []);

  const goTo = useCallback((index: number) => {
    setState((s) => applyIndex(s, index));
  }, []);

  const submit = useCallback(() => finishQuiz(setState, fetchers, freshSignal()), [fetchers, freshSignal]);

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

/** Session type shared with the extracted QuizRunnerShell. */
export type LessonQuizSession = ReturnType<typeof useLessonQuiz>;
