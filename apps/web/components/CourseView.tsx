'use client';

/**
 * CourseView — cohort enrollment island for the course page (Phase 8).
 *
 * The course header + lessons list are server-rendered
 * (components/CourseStatic.tsx); only cohort listing/enrollment needs JS.
 * Pure presentation + hook wiring (ADR-001).
 */
import { useState } from 'react';
import { useCourseCohorts } from '@/lib/hooks/useCourseCohorts';
import { enrollCohort, formatDateTime, type LmsCohort } from '@/lib/lms';
import { isLoggedIn } from '@/lib/auth-client';
import { pickText } from '@/lib/localize';

export interface CourseViewLabels {
  cohortsEmpty: string;
  enroll: string;
  enrolling: string;
  enrolled: string;
  enrollFailed: string;
  loginToEnroll: string;
  seatsLeftLabel: string; // "{n}" template
  startsAt: string;
  endsAt: string;
}

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

export function CourseView({
  courseId,
  locale,
  labels,
}: {
  courseId: string;
  locale: string;
  labels: CourseViewLabels;
}) {
  const { cohorts, loading } = useCourseCohorts(courseId);
  if (loading) return null;
  if (cohorts.length === 0) return <p className="lms-muted">{labels.cohortsEmpty}</p>;
  return (
    <ul className="lms-cards">
      {cohorts.map((c) => (
        <li key={c.id}>
          <CohortEnrollCard cohort={c} locale={locale} labels={labels} />
        </li>
      ))}
    </ul>
  );
}

function CohortEnrollCard({
  cohort,
  locale,
  labels,
}: {
  cohort: LmsCohort;
  locale: string;
  labels: CourseViewLabels;
}) {
  const [enrolled, setEnrolled] = useState(cohort.user_enrolled);
  const [seatsLeft, setSeatsLeft] = useState(cohort.seats_left);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loggedIn = isLoggedIn();

  const onEnroll = async () => {
    if (busy || enrolled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await enrollCohort(cohort.id);
      setEnrolled(true);
      setSeatsLeft(res.seats_left);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lms-card">
      <h3>{pickText(cohort.title, locale)}</h3>
      <p className="lms-muted">
        {labels.startsAt}: {formatDateTime(cohort.starts_at, locale)} · {labels.endsAt}:{' '}
        {formatDateTime(cohort.ends_at, locale)}
      </p>
      <p className="lms-muted">{fill(labels.seatsLeftLabel, { n: seatsLeft })}</p>
      {enrolled ? (
        <p className="lms-badge ok">{labels.enrolled}</p>
      ) : !loggedIn ? (
        <p className="lms-muted">{labels.loginToEnroll}</p>
      ) : (
        <button type="button" className="lms-btn" onClick={onEnroll} disabled={busy || !cohort.is_open}>
          {busy ? labels.enrolling : labels.enroll}
        </button>
      )}
      {error && (
        <p className="lms-error" role="alert">
          {labels.enrollFailed}: {error}
        </p>
      )}
    </div>
  );
}
