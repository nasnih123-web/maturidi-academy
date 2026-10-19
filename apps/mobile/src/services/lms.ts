/**
 * apps/mobile — src/services/lms.ts
 *
 * LMS client (Phase 8): courses, lessons and progress. Progress writes are
 * queued offline with the max-wins policy — re-doing a lesson offline can
 * only move progress forward.
 */
import { api, ApiError } from "../lib/api";
import { getDb, nowIso } from "../lib/db";
import { enqueueOp } from "../lib/sync";
import type { Course, Lesson, LessonProgressStatus } from "../types";

function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.isNetworkError;
}

export async function listCourses(limit = 20, cursor?: string): Promise<{ items: Course[]; nextCursor: string | null }> {
  const res = await api.get<{ items: Course[]; next_cursor?: string | null }>("/api/v1/lms/courses", {
    query: { limit, after: cursor },
  });
  return { items: res.items ?? [], nextCursor: res.next_cursor ?? null };
}

export interface CourseDetail extends Course {
  lessons: Lesson[];
}

export async function getCourse(courseId: string): Promise<CourseDetail> {
  return api.get<CourseDetail>(`/api/v1/lms/courses/${courseId}`);
}

export async function getLesson(lessonId: string): Promise<Lesson> {
  return api.get<Lesson>(`/api/v1/lms/lessons/${lessonId}`);
}

async function cacheProgress(lessonId: string, status: LessonProgressStatus, positionSeconds = 0): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO cache_progress (lesson_id, status, position_seconds, version, updated_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET status = excluded.status,
       position_seconds = excluded.position_seconds, updated_at = excluded.updated_at`,
    [lessonId, status, positionSeconds, nowIso()],
  );
}

export async function saveProgress(
  lessonId: string,
  status: LessonProgressStatus,
  positionSeconds = 0,
): Promise<{ offline: boolean }> {
  await cacheProgress(lessonId, status, positionSeconds);
  try {
    await api.post(`/api/v1/lms/lessons/${lessonId}/progress`, { status });
    return { offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    // ADR-0010: user_progress is max-wins server-side (position_seconds and
    // status rank); it never conflicts.
    await enqueueOp("user_progress", lessonId, "upsert", { status, position_seconds: positionSeconds }, 0);
    return { offline: true };
  }
}

export async function localProgress(lessonId: string): Promise<LessonProgressStatus | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ status: string }>(`SELECT status FROM cache_progress WHERE lesson_id = ?`, [
    lessonId,
  ]);
  const s = row?.status;
  return s === "completed" || s === "in_progress" || s === "not_started" ? s : null;
}
