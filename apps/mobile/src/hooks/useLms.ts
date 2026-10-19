/**
 * apps/mobile — src/hooks/useLms.ts
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  getCourse as svcGetCourse,
  getLesson as svcGetLesson,
  listCourses as svcListCourses,
  saveProgress as svcSaveProgress,
  type CourseDetail,
} from "../services/lms";
import type { Course, Lesson, LessonProgressStatus } from "../types";

export function useCourses(): {
  courses: Course[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    svcListCourses(20)
      .then((r) => alive && setCourses(r.items))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce]);

  return { courses, loading, error, refresh };
}

export function useCourseDetail(courseId: string | null): {
  course: CourseDetail | null;
  loading: boolean;
  error: string | null;
} {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    let alive = true;
    setLoading(true);
    svcGetCourse(courseId)
      .then((c) => alive && setCourse(c))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [courseId]);

  return { course, loading, error };
}

export function useLesson(lessonId: string | null): {
  lesson: Lesson | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  offline: boolean;
  saveProgress: (status: LessonProgressStatus) => Promise<void>;
} {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!lessonId) return;
    let alive = true;
    setLoading(true);
    svcGetLesson(lessonId)
      .then((l) => alive && setLesson(l))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.code : "unknown"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [lessonId]);

  const saveProgress = useCallback(
    async (status: LessonProgressStatus) => {
      if (!lessonId) return;
      setSaving(true);
      try {
        const res = await svcSaveProgress(lessonId, status);
        setOffline(res.offline);
        setLesson((l) => (l ? { ...l, status } : l));
      } catch (e) {
        setError(e instanceof ApiError ? e.code : "unknown");
      } finally {
        setSaving(false);
      }
    },
    [lessonId],
  );

  return { lesson, loading, error, saving, offline, saveProgress };
}
