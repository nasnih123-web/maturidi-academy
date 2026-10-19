'use client';

/**
 * DemoQuizPreview — DEV-ONLY lesson-quiz layout preview.
 *
 * Builds the fixture quiz session client-side (functions cannot cross the
 * server→client boundary) and renders the real QuizRunnerShell with it.
 * Never used in any production path.
 */
import { demoQuizQuestions } from '@/lib/demo-fixtures';
import { initialQuizState, type QuizState } from '@/lib/quiz';
import { QuizRunnerShell, type QuizRunnerLabels, type QuizSession } from './QuizRunnerShell';

function fixtureQuizSession(): QuizSession {
  const questions = demoQuizQuestions();
  const state: QuizState = {
    ...initialQuizState(),
    phase: 'answering',
    questions,
    answers: { dq1: 0 },
    index: 0,
  };
  return {
    state,
    start: () => Promise.resolve(),
    answer: () => {},
    goTo: () => {},
    submit: () => Promise.resolve(),
    reset: () => {},
    current: questions[0] ?? null,
    answered: 1,
    submittable: false,
    percent: null,
    reviewFor: () => null,
  };
}

export function DemoQuizPreview({ labels }: { labels: QuizRunnerLabels }) {
  return <QuizRunnerShell session={fixtureQuizSession()} labels={labels} />;
}
