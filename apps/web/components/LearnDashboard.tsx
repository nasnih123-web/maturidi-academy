'use client';

/**
 * LearnDashboard — student learning dashboard (Phase 8).
 *
 * Container wires the useLearnDashboard hook; LearnDashboardView is pure
 * presentation (props in, markup out) so it can also render fixture data on
 * the dev-only /demo/lms preview page. No business logic here (ADR-001):
 * fetching/selection math lives in lib/lms.ts and lib/hooks/*.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useLearnDashboard, type LearnDashboardData } from '@/lib/hooks/useLearnDashboard';
import {
  coursePercent,
  downloadCertificatePdf,
  formatDateTime,
  levelLabel,
  pickContinueCourse,
  recommendationReasonLabel,
  type LmsCohort,
  type LevelLabels,
} from '@/lib/lms';
import { pickText } from '@/lib/localize';

export type { LevelLabels };

export interface LearnDashboardLabels {
  loginRequiredTitle: string;
  loginRequiredBody: string;
  loginCta: string;
  loading: string;
  loadFailed: string;
  retry: string;
  continueTitle: string;
  continueEmpty: string;
  continueCta: string;
  progressLabel: string; // "{percent}" template
  recommendationsTitle: string;
  recommendationsEmpty: string;
  openLesson: string;
  cohortsTitle: string;
  cohortsEmpty: string;
  seatsLeftLabel: string; // "{n}" template
  enrolledBadge: string;
  certificatesTitle: string;
  certificatesEmpty: string;
  verifyCta: string;
  downloadPdf: string;
  reportTitle: string;
  statLessons: string;
  statOverall: string;
  statAvgScore: string;
  statStreak: string;
  courseQuizAvg: string;
  reasonNextIncomplete: string;
  reasonNextLevel: string;
  levelBeginner: string;
  levelIntermediate: string;
  levelAdvanced: string;
  startsAt: string;
  endsAt: string;
}

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

export function LearnDashboard({ locale, labels }: { locale: string; labels: LearnDashboardLabels }) {
  const { status, data, error, reload } = useLearnDashboard();

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="lms-state" role="status">
        {labels.loading}
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="lms-state lms-gate">
        <h2>{labels.loginRequiredTitle}</h2>
        <p>{labels.loginRequiredBody}</p>
        <Link className="lms-btn" href={`/${locale}/login`}>
          {labels.loginCta}
        </Link>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="lms-state" role="alert">
        <p>
          {labels.loadFailed}
          {error ? `: ${error}` : ''}
        </p>
        <button type="button" className="lms-btn" onClick={reload}>
          {labels.retry}
        </button>
      </div>
    );
  }

  return <LearnDashboardView locale={locale} labels={labels} data={data} />;
}

export function LearnDashboardView({
  locale,
  labels,
  data,
}: {
  locale: string;
  labels: LearnDashboardLabels;
  data: LearnDashboardData;
}) {
  const cont = pickContinueCourse(data.courses);
  return (
    <div className="lms-dash">
      <section className="lms-continue" aria-labelledby="lms-continue-h">
        <h2 id="lms-continue-h">{labels.continueTitle}</h2>
        {cont ? (
          <div className="lms-continue-card">
            <div>
              <p className="lms-kicker">{levelLabel(cont.level, labels)}</p>
              <h3>{pickText(cont.title, locale)}</h3>
              <div
                className="lms-progress"
                role="progressbar"
                aria-valuenow={coursePercent(cont)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={fill(labels.progressLabel, { percent: coursePercent(cont) })}
              >
                <span style={{ inlineSize: `${coursePercent(cont)}%` }} />
              </div>
              <p className="lms-muted">{fill(labels.progressLabel, { percent: coursePercent(cont) })}</p>
            </div>
            <Link className="lms-btn" href={`/${locale}/learn/courses/${cont.id}`}>
              {labels.continueCta}
            </Link>
          </div>
        ) : (
          <p className="lms-muted">{labels.continueEmpty}</p>
        )}
      </section>

      {data.report && (
        <section className="lms-report" aria-labelledby="lms-report-h">
          <h2 id="lms-report-h">{labels.reportTitle}</h2>
          <dl className="lms-stats">
            <div>
              <dt>{labels.statLessons}</dt>
              <dd>
                {data.report.total_completed_lessons}/{data.report.total_lessons}
              </dd>
            </div>
            <div>
              <dt>{labels.statOverall}</dt>
              <dd>{Math.round(data.report.overall_progress_pct)}٪</dd>
            </div>
            <div>
              <dt>{labels.statAvgScore}</dt>
              <dd>
                {data.report.quiz_overall_avg === null ? '—' : `${Math.round(data.report.quiz_overall_avg)}٪`}
              </dd>
            </div>
            <div>
              <dt>{labels.statStreak}</dt>
              <dd>{data.report.streak_days}</dd>
            </div>
          </dl>
          {data.report.courses.length > 0 && (
            <ul className="lms-report-courses">
              {data.report.courses.map((c) => (
                <li key={c.course_id}>
                  <Link className="lms-link" href={`/${locale}/learn/courses/${c.course_id}`}>
                    {pickText(c.course_title, locale)}
                  </Link>
                  <span className="lms-muted">
                    {Math.round(c.progress_pct)}٪
                    {c.quiz_avg !== null && ` · ${labels.courseQuizAvg}: ${Math.round(c.quiz_avg)}٪`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="lms-section" aria-labelledby="lms-rec-h">
        <h2 id="lms-rec-h">{labels.recommendationsTitle}</h2>
        {data.recommendations.length === 0 ? (
          <p className="lms-muted">{labels.recommendationsEmpty}</p>
        ) : (
          <ul className="lms-cards">
            {data.recommendations.map((r) => (
              <li key={r.lesson.id} className="lms-card">
                <p className="lms-kicker">{pickText(r.course_title, locale)}</p>
                <h3>{pickText(r.lesson.title, locale)}</h3>
                <p className="lms-muted">{recommendationReasonLabel(r.reason, labels)}</p>
                <Link
                  className="lms-link"
                  href={`/${locale}/learn/lessons/${r.lesson.id}?course=${r.lesson.course_id}`}
                >
                  {labels.openLesson}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lms-section" aria-labelledby="lms-coh-h">
        <h2 id="lms-coh-h">{labels.cohortsTitle}</h2>
        {data.cohorts.length === 0 ? (
          <p className="lms-muted">{labels.cohortsEmpty}</p>
        ) : (
          <ul className="lms-cards">
            {data.cohorts.map((c) => (
              <li key={c.id}>
                <CohortCard cohort={c} locale={locale} labels={labels} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lms-section" aria-labelledby="lms-cert-h">
        <h2 id="lms-cert-h">{labels.certificatesTitle}</h2>
        {data.certificates.length === 0 ? (
          <p className="lms-muted">{labels.certificatesEmpty}</p>
        ) : (
          <ul className="lms-cards">
            {data.certificates.map((cert) => (
              <li key={cert.id} className="lms-card">
                <h3>{pickText(cert.course_title, locale)}</h3>
                <p className="lms-muted" dir="ltr">
                  {cert.code}
                </p>
                <div className="lms-card-actions">
                  <Link className="lms-link" href={`/${locale}/learn/certificate/${cert.code}`}>
                    {labels.verifyCta}
                  </Link>
                  <CertificateDownloadButton code={cert.code} label={labels.downloadPdf} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Authenticated PDF download (Bearer header can't ride a plain <a>). */
function CertificateDownloadButton({ code, label }: { code: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadCertificatePdf(code);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificate-${code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span>
      <button type="button" className="lms-link lms-link-btn" onClick={onClick} disabled={busy}>
        {label}
      </button>
      {error && (
        <span className="lms-error" role="alert">
          : {error}
        </span>
      )}
    </span>
  );
}

export function CohortCard({
  cohort,
  locale,
  labels,
}: {
  cohort: LmsCohort;
  locale: string;
  labels: LearnDashboardLabels;
}) {
  return (
    <div className="lms-card">
      <h3>{pickText(cohort.title, locale)}</h3>
      <p className="lms-muted">
        {labels.startsAt}: {formatDateTime(cohort.starts_at, locale)} · {labels.endsAt}:{' '}
        {formatDateTime(cohort.ends_at, locale)}
      </p>
      <p className="lms-muted">{fill(labels.seatsLeftLabel, { n: cohort.seats_left })}</p>
      {cohort.user_enrolled && <p className="lms-badge">{labels.enrolledBadge}</p>}
    </div>
  );
}
