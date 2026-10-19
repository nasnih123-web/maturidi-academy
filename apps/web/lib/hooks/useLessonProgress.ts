'use client';

/**
 * useLessonProgress — lesson progress persistence (Phase 8).
 *
 * POST /api/v1/lms/lessons/{id}/progress {status, position_seconds}.
 * Surfaces course completion + certificate code when the save completes
 * the whole course (completion → certificate flow).
 */
import { useCallback, useRef, useState } from 'react';
import {
  saveLessonProgress,
  type LmsLessonStatus,
  type LmsProgressUpdate,
} from '../lms';

export interface LessonProgressInit {
  status: LmsLessonStatus | null;
  position_seconds: number;
}

export function useLessonProgress(lessonId: string, initial: LessonProgressInit) {
  const [update, setUpdate] = useState<LmsProgressUpdate | null>(null);
  const [status, setStatus] = useState<LmsLessonStatus | null>(initial.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<LmsProgressUpdate> | null>(null);

  const save = useCallback(
    async (input: { status: LmsLessonStatus; position_seconds: number }) => {
      if (inFlight.current) {
        try {
          await inFlight.current;
        } catch {
          /* fall through and retry */
        }
      }
      setSaving(true);
      setError(null);
      const p = saveLessonProgress(lessonId, input).then((res) => {
        setUpdate(res);
        setStatus(res.status);
        return res;
      });
      inFlight.current = p;
      try {
        return await p;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        if (inFlight.current === p) inFlight.current = null;
        setSaving(false);
      }
    },
    [lessonId],
  );

  const savePosition = useCallback(
    (positionSeconds: number, currentStatus: LmsLessonStatus | null) =>
      save({
        status: currentStatus === 'completed' ? 'completed' : 'in_progress',
        position_seconds: positionSeconds,
      }).catch(() => null),
    [save],
  );

  const markComplete = useCallback(
    (totalSeconds: number) => save({ status: 'completed', position_seconds: totalSeconds }),
    [save],
  );

  return {
    status,
    completed: status === 'completed',
    saving,
    error,
    courseCompleted: update?.course_completed === true,
    certificateCode: update?.certificate_code ?? null,
    savePosition,
    markComplete,
  };
}
