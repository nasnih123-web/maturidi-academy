'use client';

/**
 * LessonQuizRunner — embedded lesson quiz (Phase 8).
 *
 * Reuses the Phase-6 quiz UI (QuizRunnerShell) and the generic quiz engine
 * (lib/quiz.ts); only the fetchers differ (lesson quiz backend via
 * useLessonQuiz). No quiz logic is duplicated here.
 */
import { useLessonQuiz } from '@/lib/hooks/useLessonQuiz';
import { QuizRunnerShell, type QuizRunnerLabels } from './QuizRunnerShell';

export function LessonQuizRunner({
  lessonId,
  labels,
}: {
  lessonId: string;
  labels: QuizRunnerLabels;
}) {
  const session = useLessonQuiz(lessonId);
  return <QuizRunnerShell session={session} labels={labels} />;
}
