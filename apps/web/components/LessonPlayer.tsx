'use client';

/**
 * LessonPlayer — client islands for the lesson page (Phase 8).
 *
 * The article itself is server-rendered (components/LessonContent.tsx).
 * This module owns the interactive parts only:
 * - LessonProgressIsland: debounced position save on scroll, "mark complete",
 *   and the certificate banner when the backend reports course completion
 *   with a certificate code (completion → certificate flow).
 * - LessonQuizIsland: the embedded lesson quiz reusing the Phase-6 UI.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useLessonProgress } from '@/lib/hooks/useLessonProgress';
import {
  lessonHasQuiz,
  lessonTotalSeconds,
  secondsForPercent,
  type LmsLesson,
} from '@/lib/lms';
import { isLoggedIn } from '@/lib/auth-client';
import { LessonQuizRunner } from './LessonQuizRunner';
import type { QuizRunnerLabels } from './QuizRunnerShell';

export interface LessonPlayerLabels {
  markComplete: string;
  markingComplete: string;
  completedBadge: string;
  saveFailed: string;
  certificateTitle: string;
  certificateBody: string;
  verifyCertificateCta: string;
  loginRequiredTitle: string;
  loginRequiredBody: string;
  loginCta: string;
  progressSaving: string;
}

export function LessonProgressIsland({
  lesson,
  locale,
  labels,
}: {
  lesson: LmsLesson;
  locale: string;
  labels: LessonPlayerLabels;
}) {
  const loggedIn = isLoggedIn();
  const prog = useLessonProgress(lesson.id, {
    status: lesson.status,
    position_seconds: lesson.position_seconds,
  });
  const statusRef = useRef(prog.status);
  statusRef.current = prog.status;
  const saveTimer = useRef<number | null>(null);

  // Debounced position save on scroll (2s quiet period).
  useEffect(() => {
    if (!loggedIn) return;
    const onScroll = () => {
      const el = document.querySelector<HTMLElement>('.lms-blocks');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const read = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      const pct = total > 0 ? (read / total) * 100 : 100;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(
        () => prog.savePosition(secondsForPercent(lesson, pct), statusRef.current),
        2000,
      );
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, lesson.id]);

  if (!loggedIn) {
    return (
      <div className="lms-gate lms-state">
        <h2>{labels.loginRequiredTitle}</h2>
        <p>{labels.loginRequiredBody}</p>
        <Link className="lms-btn" href={`/${locale}/login`}>
          {labels.loginCta}
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="lms-progress-actions">
        {prog.completed ? (
          <p className="lms-badge ok">{labels.completedBadge}</p>
        ) : (
          <button
            type="button"
            className="lms-btn"
            onClick={() => prog.markComplete(lessonTotalSeconds(lesson))}
            disabled={prog.saving}
          >
            {prog.saving ? labels.markingComplete : labels.markComplete}
          </button>
        )}
        {prog.saving && <span className="lms-muted">{labels.progressSaving}</span>}
        {prog.error && (
          <p className="lms-error" role="alert">
            {labels.saveFailed}: {prog.error}
          </p>
        )}
      </div>

      {prog.courseCompleted && prog.certificateCode && (
        <section className="lms-cert-issued" aria-labelledby="lms-cert-issued-h" role="status">
          <h2 id="lms-cert-issued-h">{labels.certificateTitle}</h2>
          <p>{labels.certificateBody}</p>
          <p className="lms-muted" dir="ltr">
            {prog.certificateCode}
          </p>
          <div className="lms-card-actions">
            <Link className="lms-btn" href={`/${locale}/learn/certificate/${prog.certificateCode}`}>
              {labels.verifyCertificateCta}
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

export function LessonQuizIsland({
  lesson,
  labels,
}: {
  lesson: LmsLesson;
  labels: QuizRunnerLabels;
}) {
  if (!lessonHasQuiz(lesson)) return null;
  return <LessonQuizRunner lessonId={lesson.id} labels={labels} />;
}
