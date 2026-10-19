'use client';

/**
 * useCourseCohorts — cohorts for one course (Phase 8).
 *
 * GET /api/v1/lms/cohorts?course_id= (auth-aware: user_enrolled flag).
 * Pure plumbing; CourseView renders.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listCohorts, type LmsCohort } from '../lms';

export function useCourseCohorts(courseId: string) {
  const [cohorts, setCohorts] = useState<LmsCohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    listCohorts({ course_id: courseId, limit: 20, signal: ctrl.signal })
      .then((items) => {
        if (ctrl.signal.aborted) return;
        setCohorts(items);
        setLoading(false);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [courseId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { cohorts, loading, error, reload: load };
}
