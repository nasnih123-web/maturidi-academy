/**
 * Generic quiz engine (Phase 6 — web track).
 *
 * Phase-8 LMS reuse: this module knows NOTHING about the fatwa API.
 * It models a step-by-step quiz session (generate → answer → submit →
 * review) as a pure state machine and takes its generate/submit fetchers
 * as injected dependencies, so any backend (fatwa quiz today, LMS quiz
 * tomorrow) can drive it.
 *
 * Business logic lives here (ADR-001); components in
 * components/QuizRunner.tsx only render.
 */

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  /** Localized citation backing the question (shown in the review step). */
  sourceCitation?: string;
}

export interface QuizReviewItem {
  questionId: string;
  correct: boolean;
  /** Index chosen by the user (null when unanswered server-side). */
  given?: number | null;
  /** Index of the correct option. */
  correctOption?: number | null;
  /** Citation backing the correct answer / explanation. */
  explanationCitation?: string;
}

export interface QuizScore {
  /** Number of correct answers. */
  correct: number;
  total: number;
  /** Percent score as reported by the backend (0–100). */
  percent: number | null;
}

export type QuizPhase =
  | 'idle'
  | 'generating'
  | 'answering'
  | 'submitting'
  | 'review'
  | 'failed';

export interface QuizState {
  phase: QuizPhase;
  questions: QuizQuestion[];
  /** Answers keyed by question id → chosen option index. */
  answers: Record<string, number>;
  /** 0-based index of the question being shown. */
  index: number;
  score: QuizScore | null;
  review: QuizReviewItem[];
  error: string | null;
  attemptId: string | null;
}

/** Fetchers any quiz backend must supply (fatwa quiz implements these in lib/fatwa.ts). */
export interface QuizFetchers {
  generate: (opts: { count: number; category: string | null }, signal: AbortSignal) => Promise<{
    attemptId: string;
    questions: QuizQuestion[];
  }>;
  submit: (
    attemptId: string,
    answers: Record<string, number>,
    signal: AbortSignal,
  ) => Promise<{ score: QuizScore; review: QuizReviewItem[] }>;
}

export function initialQuizState(): QuizState {
  return {
    phase: 'idle',
    questions: [],
    answers: {},
    index: 0,
    score: null,
    review: [],
    error: null,
    attemptId: null,
  };
}

/** Pure transitions (no I/O). */

export function applyAnswer(state: QuizState, questionId: string, optionIndex: number): QuizState {
  return { ...state, answers: { ...state.answers, [questionId]: optionIndex } };
}

export function applyIndex(state: QuizState, index: number): QuizState {
  if (index < 0 || index >= state.questions.length) return state;
  return { ...state, index };
}

export function currentQuestion(state: QuizState): QuizQuestion | null {
  return state.questions[state.index] ?? null;
}

export function answeredCount(state: QuizState): number {
  return state.questions.filter((q) => typeof state.answers[q.id] === 'number').length;
}

export function canSubmit(state: QuizState): boolean {
  return (
    state.phase === 'answering' &&
    state.questions.length > 0 &&
    answeredCount(state) === state.questions.length
  );
}

/** Async drivers (I/O lives here, not in the component). */

export async function startQuiz(
  setState: (updater: (s: QuizState) => QuizState) => void,
  fetchers: QuizFetchers,
  opts: { count: number; category: string | null },
  signal: AbortSignal,
): Promise<void> {
  setState((s) => ({ ...s, phase: 'generating', error: null }));
  try {
    const { attemptId, questions } = await fetchers.generate(opts, signal);
    if (questions.length === 0) {
      setState((s) => ({ ...s, phase: 'failed', error: '__empty__' }));
      return;
    }
    setState(() => ({
      ...initialQuizState(),
      phase: 'answering',
      questions,
      attemptId,
    }));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      setState((s) => ({ ...s, phase: 'idle', error: null }));
      return;
    }
    setState((s) => ({
      ...s,
      phase: 'failed',
      error: err instanceof Error ? err.message : '__failed__',
    }));
  }
}

export async function finishQuiz(
  setState: (updater: (s: QuizState) => QuizState) => void,
  fetchers: QuizFetchers,
  signal: AbortSignal,
): Promise<void> {
  let snapshot: QuizState | null = null;
  setState((s) => {
    snapshot = s;
    return { ...s, phase: 'submitting', error: null };
  });
  const state = snapshot as QuizState | null;
  if (!state || !state.attemptId || !canSubmit(state)) {
    setState((s) => ({ ...s, phase: 'answering' }));
    return;
  }
  try {
    const { score, review } = await fetchers.submit(state.attemptId, state.answers, signal);
    setState((s) => ({ ...s, phase: 'review', score, review }));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      setState((s) => ({ ...s, phase: 'answering', error: null }));
      return;
    }
    setState((s) => ({
      ...s,
      phase: 'answering',
      error: err instanceof Error ? err.message : '__failed__',
    }));
  }
}

export function reviewFor(state: QuizState, questionId: string): QuizReviewItem | null {
  return state.review.find((r) => r.questionId === questionId) ?? null;
}

export function scorePercent(state: QuizState): number | null {
  if (!state.score || state.score.total <= 0) return null;
  if (state.score.percent !== null) return Math.round(state.score.percent);
  return Math.round((state.score.correct / state.score.total) * 100);
}
