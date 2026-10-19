import type { LocalizedText } from './types';
import { ApiError, API_BASE_URL } from './api';
import { authFetch, authJson } from './auth-client';
import type { QuizFetchers, QuizQuestion, QuizReviewItem, QuizScore } from './quiz';

/**
 * LMS client (Phase 8 — web track).
 *
 * Typed API client for the Phase-8 LMS backend. ALL LMS business logic
 * (fetching, shaping, progress math, quiz fetchers) lives here and in
 * lib/hooks/* — components only render (ADR-001/ADR-0002).
 *
 * Backend contract (implemented by the Phase-8 backend track):
 *   GET  /api/v1/lms/courses?level=&after=&limit=      → {items, next_cursor}
 *   GET  /api/v1/lms/courses/{id}                      → CourseDetailOut
 *   POST /api/v1/lms/lessons/{id}/progress             → ProgressOut (auth)
 *   POST /api/v1/lms/quiz/{lesson_id}?count=           → QuizGenerateOut (auth)
 *   POST /api/v1/lms/quiz/submit                       → QuizSubmitOut (auth)
 *   GET  /api/v1/lms/reports/me                        → StudyReportOut (auth)
 *   GET  /api/v1/lms/recommendations?limit=            → RecommendationOut[] (auth)
 *   GET  /api/v1/lms/cohorts?course_id=&after=&limit=  → {items, next_cursor}
 *   POST /api/v1/lms/cohorts/{id}/enroll               → EnrollmentOut (auth)
 *   GET  /api/v1/lms/certificates/mine?course_id=     → CertificateOut | null (auth)
 *   GET  /api/v1/lms/certificates/{code}/download     → PDF (auth)
 *   GET  /api/v1/certificates/{code}/verify            → CertificateVerifyOut (public)
 *
 * Notes:
 * - There is NO single-lesson GET endpoint; lesson content (body blocks)
 *   arrives inside the course detail and inside recommendations.
 * - Progress uses position_seconds + status (not_started|in_progress|completed).
 * - No mock data anywhere (contract §15.9) — failures throw ApiError and
 *   callers render graceful error states.
 */

/* ------------------------------------------------------------------ types */

export interface LmsCourse {
  id: string;
  curriculum_id: string | null;
  title: LocalizedText;
  description: LocalizedText | null;
  level: string;
  lesson_count: number;
  /** 0–100 when the request is authenticated, else null. */
  progress_pct: number | null;
}

export interface LmsContentBlock {
  type: 'text' | 'fiqh_topic_ref' | 'scholar_quote_ref' | 'quiz_ref' | string;
  text?: LocalizedText | null;
  topic_id?: string | null;
  title?: LocalizedText | null;
  quote_id?: string | null;
  scholar?: LocalizedText | null;
  note?: string | null;
  question_ids?: string[] | null;
}

export type LmsLessonStatus = 'not_started' | 'in_progress' | 'completed';

export interface LmsLesson {
  id: string;
  course_id: string;
  title: LocalizedText;
  body: LmsContentBlock[];
  duration_minutes: number;
  sort_order: number;
  is_free_preview: boolean;
  /** My progress when authenticated. */
  status: LmsLessonStatus | null;
  position_seconds: number;
}

export interface LmsCourseDetail {
  course: LmsCourse;
  lessons: LmsLesson[];
  completed_lessons: number;
  total_lessons: number;
  progress_pct: number;
  has_certificate: boolean;
}

export interface LmsProgressUpdate {
  lesson_id: string;
  status: LmsLessonStatus;
  position_seconds: number;
  completed_at: string | null;
  course_completed: boolean;
  /** Non-null when this save completed the whole course. */
  certificate_code: string | null;
}

export interface LmsCourseProgress {
  course_id: string;
  course_title: LocalizedText;
  level: string;
  total_lessons: number;
  completed_lessons: number;
  progress_pct: number;
  quiz_avg: number | null;
  quiz_attempts: number;
}

export interface LmsStudyReport {
  courses: LmsCourseProgress[];
  total_completed_lessons: number;
  total_lessons: number;
  overall_progress_pct: number;
  quiz_overall_avg: number | null;
  streak_days: number;
}

export interface LmsRecommendation {
  lesson: LmsLesson;
  course_title: LocalizedText;
  level: string;
  /** Reason KEY (localized client-side): level_next_incomplete | next_level */
  reason: string;
}

export interface LmsCohort {
  id: string;
  course_id: string;
  title: LocalizedText;
  starts_at: string;
  ends_at: string;
  max_seats: number;
  is_open: boolean;
  enrolled_count: number;
  seats_left: number;
  user_enrolled: boolean;
}

export interface LmsEnrollment {
  cohort_id: string;
  status: string;
  enrolled_at: string;
  seats_left: number;
}

export interface LmsCertificate {
  id: string;
  code: string;
  course_id: string;
  course_title: LocalizedText;
  issued_at: string;
  download_url: string | null;
}

export interface LmsCertificateVerify {
  valid: boolean;
  code: string;
  holder_name: string | null;
  course_title: LocalizedText | null;
  issued_at: string | null;
  locale: string | null;
}

/* ------------------------------------------------------- server (public) */

function serverUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
}

async function getServer<T>(path: string, revalidate = 120): Promise<T> {
  let res: Response;
  try {
    res = await fetch(serverUrl(path), {
      next: { revalidate },
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable at ${API_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) throw new ApiError(`GET ${path} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

/** Public course catalog (progress_pct is null without auth). */
export async function listCoursesServer(
  opts: { level?: string; limit?: number } = {},
): Promise<LmsCourse[]> {
  const q = new URLSearchParams();
  if (opts.level) q.set('level', opts.level);
  if (opts.limit) q.set('limit', String(opts.limit));
  const body = await getServer<{ items: LmsCourse[] }>(`/api/v1/lms/courses?${q.toString()}`);
  return Array.isArray(body?.items) ? body.items : [];
}

/** Public course detail: lessons (with body blocks), progress, certificate flag. */
export async function getCourseServer(id: string): Promise<LmsCourseDetail> {
  const body = await getServer<LmsCourseDetail>(`/api/v1/lms/courses/${encodeURIComponent(id)}`);
  return {
    course: body.course,
    lessons: Array.isArray(body.lessons) ? body.lessons : [],
    completed_lessons: body.completed_lessons ?? 0,
    total_lessons: body.total_lessons ?? 0,
    progress_pct: body.progress_pct ?? 0,
    has_certificate: body.has_certificate === true,
  };
}

/**
 * Public certificate verification — the page at
 * /[locale]/learn/certificate/[code] is fully server-rendered (zero JS).
 * Unknown code → {valid: false} (HTTP 200 from the backend).
 */
export async function verifyCertificateServer(code: string): Promise<LmsCertificateVerify> {
  let body: LmsCertificateVerify;
  try {
    body = await getServer<LmsCertificateVerify>(
      `/api/v1/certificates/${encodeURIComponent(code)}/verify`,
      0,
    );
  } catch (err) {
    // Unknown code → invalid verdict, not a page crash.
    if (err instanceof ApiError && err.status === 404) {
      return { valid: false, code, holder_name: null, course_title: null, issued_at: null, locale: null };
    }
    throw err;
  }
  return {
    valid: body?.valid === true,
    code: body?.code ?? code,
    holder_name: body?.holder_name ?? null,
    course_title: body?.course_title ?? null,
    issued_at: body?.issued_at ?? null,
    locale: body?.locale ?? null,
  };
}

/* ------------------------------------------------------- client (authed) */

async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  return authJson<T>(path, init);
}

/**
 * My courses: the catalog endpoint includes progress_pct when authenticated.
 * Callers treat progress_pct !== null as "my course".
 */
export async function listMyCourses(signal?: AbortSignal): Promise<LmsCourse[]> {
  const body = await authed<{ items: LmsCourse[] }>('/api/v1/lms/courses?limit=100', { signal });
  return Array.isArray(body?.items) ? body.items : [];
}

/**
 * Save progress: POST /api/v1/lms/lessons/{id}/progress
 * {status, position_seconds}. When the save completes the course the
 * backend returns course_completed=true + certificate_code
 * (completion → certificate flow).
 */
export async function saveLessonProgress(
  lessonId: string,
  input: { status: LmsLessonStatus; position_seconds: number },
  signal?: AbortSignal,
): Promise<LmsProgressUpdate> {
  return authed<LmsProgressUpdate>(`/api/v1/lms/lessons/${encodeURIComponent(lessonId)}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: input.status,
      position_seconds: Math.max(0, Math.round(input.position_seconds)),
    }),
    signal,
  });
}

/** Lesson quiz: start an attempt — POST /api/v1/lms/quiz/{lesson_id}?count= (auth). */
export async function startLessonQuiz(
  lessonId: string,
  count: number,
  signal?: AbortSignal,
): Promise<{ attempt_id: string; questions: QuizQuestion[] }> {
  const n = Math.max(1, Math.min(20, count));
  const body = await authed<{
    attempt_id: string;
    questions: Array<{ id: string; question_text: unknown; options: unknown[]; source_citation?: unknown }>;
  }>(`/api/v1/lms/quiz/${encodeURIComponent(lessonId)}?count=${n}`, {
    method: 'POST',
    signal,
  });
  const questions: QuizQuestion[] = (Array.isArray(body?.questions) ? body.questions : [])
    .filter((q) => q && typeof q.id === 'string')
    .map((q) => ({
      id: q.id,
      text: localizeWire(q.question_text),
      options: (Array.isArray(q.options) ? q.options : []).map(localizeWire).filter((s) => s !== ''),
      sourceCitation: localizeWire(q.source_citation) || undefined,
    }))
    .filter((q) => q.text !== '' && q.options.length >= 2);
  return { attempt_id: String(body.attempt_id), questions };
}

/**
 * Lesson quiz: submit — POST /api/v1/lms/quiz/submit {attempt_id, answers}
 * (auth). Same Phase-6 engine as the fatwa quiz: {score, total, correct,
 * details:[{question_id, is_correct, given, correct_option}]}.
 */
export async function submitLessonQuiz(
  attemptId: string,
  answers: Record<string, number>,
  signal?: AbortSignal,
): Promise<{ score: QuizScore; review: QuizReviewItem[] }> {
  const body = await authed<{
    score: number;
    total: number;
    correct: number;
    details: Array<{
      question_id: string;
      is_correct: boolean;
      given?: number | null;
      correct_option?: number | null;
    }>;
  }>('/api/v1/lms/quiz/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_id: attemptId, answers }),
    signal,
  });
  const review: QuizReviewItem[] = (Array.isArray(body?.details) ? body.details : [])
    .filter((r) => r && typeof r.question_id === 'string')
    .map((r) => ({
      questionId: r.question_id,
      correct: r.is_correct === true,
      given: typeof r.given === 'number' ? r.given : null,
      correctOption: typeof r.correct_option === 'number' ? r.correct_option : null,
    }));
  const total = typeof body?.total === 'number' ? body.total : review.length;
  const correct = typeof body?.correct === 'number' ? body.correct : review.filter((r) => r.correct).length;
  return {
    score: {
      correct,
      total,
      percent: typeof body?.score === 'number' ? body.score : total > 0 ? (correct / total) * 100 : null,
    },
    review,
  };
}

/**
 * QuizFetchers adapter: plugs the lesson quiz backend into the generic
 * Phase-6 quiz engine (lib/quiz.ts) — no quiz logic duplicated.
 */
export function makeLessonQuizFetchers(lessonId: string): QuizFetchers {
  return {
    generate: async (opts, signal) => {
      const res = await startLessonQuiz(lessonId, opts.count, signal);
      return { attemptId: res.attempt_id, questions: res.questions };
    },
    submit: async (attemptId, answers, signal) => {
      return submitLessonQuiz(attemptId, answers, signal);
    },
  };
}

/** Study report (auth). */
export async function getMyReport(signal?: AbortSignal): Promise<LmsStudyReport> {
  return authed<LmsStudyReport>('/api/v1/lms/reports/me', { signal });
}

/** Recommended lessons — bare array (auth). */
export async function getRecommendations(signal?: AbortSignal): Promise<LmsRecommendation[]> {
  const body = await authed<LmsRecommendation[]>('/api/v1/lms/recommendations?limit=10', { signal });
  return Array.isArray(body) ? body : [];
}

/** My certificate for one course (auth) — null when none issued. */
export async function getMyCertificate(
  courseId: string,
  signal?: AbortSignal,
): Promise<LmsCertificate | null> {
  const body = await authed<LmsCertificate | null>(
    `/api/v1/lms/certificates/mine?course_id=${encodeURIComponent(courseId)}`,
    { signal },
  );
  return body && typeof body === 'object' && body.code ? body : null;
}

/** Cohorts (auth-aware: user_enrolled flag). */
export async function listCohorts(
  opts: { course_id?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<LmsCohort[]> {
  const q = new URLSearchParams();
  if (opts.course_id) q.set('course_id', opts.course_id);
  q.set('limit', String(opts.limit ?? 50));
  const body = await authed<{ items: LmsCohort[] }>(`/api/v1/lms/cohorts?${q.toString()}`, {
    signal: opts.signal,
  });
  return Array.isArray(body?.items) ? body.items : [];
}

/** Enroll in a cohort (auth). */
export async function enrollCohort(cohortId: string, signal?: AbortSignal): Promise<LmsEnrollment> {
  return authed<LmsEnrollment>(`/api/v1/lms/cohorts/${encodeURIComponent(cohortId)}/enroll`, {
    method: 'POST',
    signal,
  });
}

/**
 * Download a certificate PDF (auth). The endpoint requires a Bearer token,
 * so this fetches via authFetch and returns a Blob for the caller to save —
 * a plain <a href> could not send the Authorization header.
 */
export async function downloadCertificatePdf(code: string, signal?: AbortSignal): Promise<Blob> {
  const res = await authFetch(`/api/v1/lms/certificates/${encodeURIComponent(code)}/download`, {
    signal,
  });
  return res.blob();
}

/* ---------------------------------------------------------------- helpers */

/** Coerce a LocalizedText-or-string wire value to a plain string. */
function localizeWire(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['fa', 'ar', 'en']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim() !== '') return o[k] as string;
    }
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
  }
  return '';
}

/** Course completion percent (0–100), pure. */
export function coursePercent(course: LmsCourse): number {
  if (course.progress_pct === null || course.progress_pct === undefined) return 0;
  return Math.max(0, Math.min(100, Math.round(course.progress_pct)));
}

/** A course counts as "mine" when the backend reported progress for me. */
export function isMyCourse(course: LmsCourse): boolean {
  return course.progress_pct !== null && course.progress_pct !== undefined;
}

/** Continue-learning target: in-progress course with the highest percent. */
export function pickContinueCourse(courses: LmsCourse[]): LmsCourse | null {
  let best: LmsCourse | null = null;
  let bestPct = -1;
  for (const c of courses) {
    if (!isMyCourse(c)) continue;
    const pct = coursePercent(c);
    if (pct > 0 && pct < 100 && pct > bestPct) {
      best = c;
      bestPct = pct;
    }
  }
  if (best) return best;
  return courses.find(isMyCourse) ?? null;
}

/** Does this lesson carry a quiz? (quiz_ref block in body.) */
export function lessonHasQuiz(lesson: LmsLesson): boolean {
  return (lesson.body ?? []).some((b) => b && b.type === 'quiz_ref');
}

/** Number of quiz questions referenced by the lesson (0 when none). */
export function lessonQuizCount(lesson: LmsLesson): number {
  for (const b of lesson.body ?? []) {
    if (b && b.type === 'quiz_ref' && Array.isArray(b.question_ids)) return b.question_ids.length;
  }
  return 0;
}

/** Total media seconds for position math (duration_minutes → seconds). */
export function lessonTotalSeconds(lesson: LmsLesson): number {
  return Math.max(60, (lesson.duration_minutes || 0) * 60);
}

/** position_seconds → 0–100 percent, pure. */
export function positionPercent(lesson: LmsLesson): number {
  const total = lessonTotalSeconds(lesson);
  return Math.max(0, Math.min(100, Math.round(((lesson.position_seconds || 0) / total) * 100)));
}

/** 0–100 percent → position_seconds, pure. */
export function secondsForPercent(lesson: LmsLesson, pct: number): number {
  return Math.round((Math.max(0, Math.min(100, pct)) / 100) * lessonTotalSeconds(lesson));
}

/** Re-export for callers that only need the error type. */
export { ApiError };

/* ------------------------------------------------------------ labels */

export interface LevelLabels {
  levelBeginner: string;
  levelIntermediate: string;
  levelAdvanced: string;
}

/** Localize a course level key — pure, usable from server components. */
export function levelLabel(level: string, labels: LevelLabels): string {
  if (level === 'beginner') return labels.levelBeginner;
  if (level === 'intermediate') return labels.levelIntermediate;
  if (level === 'advanced') return labels.levelAdvanced;
  return level;
}

/** Localize the backend's recommendation reason KEY (never invent text). */
export function recommendationReasonLabel(
  reason: string,
  labels: { reasonNextIncomplete: string; reasonNextLevel: string },
): string {
  if (reason === 'level_next_incomplete') return labels.reasonNextIncomplete;
  if (reason === 'next_level') return labels.reasonNextLevel;
  return reason;
}

/**
 * Format an ISO-8601 timestamp for display in the UI locale.
 * Pure — the API always speaks ISO 8601 (contract §1); only the UI localizes.
 */
export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return iso;
  }
}
