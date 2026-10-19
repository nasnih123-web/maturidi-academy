'use client';

/**
 * useLearnDashboard — student dashboard data (Phase 8).
 *
 * Loads the authenticated student's LMS overview in parallel:
 * my courses (progress_pct present), recommendations, my enrolled cohorts,
 * my certificates (one lookup per engaged course), study report.
 * Pure data plumbing; the component renders.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isLoggedIn } from '../auth-client';
import {
  getMyCertificate,
  getMyReport,
  getRecommendations,
  isMyCourse,
  listCohorts,
  listMyCourses,
  type LmsCertificate,
  type LmsCohort,
  type LmsCourse,
  type LmsRecommendation,
  type LmsStudyReport,
} from '../lms';

export type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unauthenticated';

export interface LearnDashboardData {
  courses: LmsCourse[];
  recommendations: LmsRecommendation[];
  cohorts: LmsCohort[];
  certificates: LmsCertificate[];
  report: LmsStudyReport | null;
}

export function useLearnDashboard() {
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [data, setData] = useState<LearnDashboardData>({
    courses: [],
    recommendations: [],
    cohorts: [],
    certificates: [],
    report: null,
  });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!isLoggedIn()) {
      setStatus('unauthenticated');
      return;
    }
    setStatus('loading');
    setError(null);
    const signal = ctrl.signal;
    const coursesP = listMyCourses(signal);
    Promise.all([
      coursesP,
      getRecommendations(signal),
      listCohorts({ limit: 50, signal }).then((all) => all.filter((c) => c.user_enrolled)),
      getMyReport(signal).catch(() => null),
    ])
      .then(async ([courses, recommendations, cohorts, report]) => {
        if (ctrl.signal.aborted) return;
        const mine = courses.filter(isMyCourse);
        const certs = (
          await Promise.all(mine.map((c) => getMyCertificate(c.id, signal).catch(() => null)))
        ).filter((c): c is LmsCertificate => c !== null);
        if (ctrl.signal.aborted) return;
        setData({ courses: mine, recommendations, cohorts, certificates: certs, report });
        setStatus('ready');
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { status, data, error, reload: load };
}
