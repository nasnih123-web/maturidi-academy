'use client';

/**
 * QuizRunner — fatwa quiz UI (Phase 6).
 *
 * Thin adapter: wires the generic QuizRunnerShell to the fatwa quiz session
 * hook. Rendering moved to components/QuizRunnerShell.tsx (Phase 8) with no
 * behavior change so the LMS lesson quiz reuses the same UI.
 */
import { useQuizSession } from '@/lib/hooks/useQuizSession';
import { QuizRunnerShell, type QuizRunnerLabels } from './QuizRunnerShell';

export type { QuizRunnerLabels };

export function QuizRunner({ labels, locale }: { labels: QuizRunnerLabels; locale: string }) {
  const session = useQuizSession(locale);
  return <QuizRunnerShell session={session} labels={labels} />;
}
