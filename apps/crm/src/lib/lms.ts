import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./api";
import { EMPTY_L10N, type CmsBlock, type LocalizedText } from "./contentApi";

/**
 * LMS service — Phase 8 (Track 3, CRM).
 *
 * Management-plane client over the Track 1 backend contract
 * (`/api/v1/admin/lms/*`, ADR-0018). ADR-001: all parsing, defaults, and
 * API access live here — components only render.
 *
 * Backend notes (aligned with apps/api/app/modules/lms/{router,schemas}.py):
 * - updates are PATCH (not PUT); deletes return 204
 * - Curriculum.description is a plain string|null server-side; the CRM
 *   keeps its trilingual editor and maps the fa text on write
 *   (adapter per contract §9.5)
 * - Course.visibility is "public" | "private"
 * - Lesson content blocks live in the `body` list field
 * - Cohort open/closed is the `is_open` boolean; ends_at/max_seats required
 * - prerequisites are single edges: POST {course_id, requires_course_id},
 *   DELETE ?course_id=&requires_course_id= ; cycle rejection is enforced
 *   server-side (422 prerequisite_cycle) and pre-checked here for UX
 */

export function errText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type CourseLevel = "beginner" | "intermediate" | "advanced";
export type CourseVisibility = "public" | "private";
export type EnrollmentStatus = "active" | "cancelled";

export const COURSE_LEVELS: CourseLevel[] = ["beginner", "intermediate", "advanced"];
export const COURSE_VISIBILITIES: CourseVisibility[] = ["public", "private"];

export interface Curriculum {
  id: string;
  title: LocalizedText;
  /** Backend stores a plain string; the CRM edits it trilingually and maps fa on write. */
  description: LocalizedText;
  sort_order: number;
  is_active: boolean;
}

export interface Course {
  id: string;
  curriculum_id: string | null;
  title: LocalizedText;
  description: LocalizedText | null;
  level: CourseLevel;
  visibility: CourseVisibility;
  sort_order: number;
  is_active: boolean;
  lesson_count: number;
}

export interface Lesson {
  id: string;
  course_id: string;
  title: LocalizedText;
  /** CMS block-shape content ({type, props} list) — same shape as the web renderer. */
  body: CmsBlock[];
  duration_minutes: number;
  sort_order: number;
  is_free_preview: boolean;
}

export interface Cohort {
  id: string;
  course_id: string;
  title: LocalizedText;
  starts_at: string;
  ends_at: string;
  max_seats: number;
  is_open: boolean;
  enrolled_count: number;
  seats_left: number;
}

export interface CohortEnrollment {
  id: string;
  cohort_id: string;
  user_id: string;
  user_display: string;
  enrolled_at: string;
  status: string;
}

export interface LessonProgressItem {
  lesson_id: string;
  lesson_title: LocalizedText;
  sort_order: number;
  completed: boolean;
  completed_at: string | null;
}

export interface UserEnrollmentProgress {
  course_id: string;
  course_title: LocalizedText;
  completed_lessons: number;
  total_lessons: number;
  progress_pct: number;
  lessons: LessonProgressItem[];
}

export interface Certificate {
  id: string;
  code: string;
  user_id: string;
  user_display: string;
  course_id: string;
  course_title: LocalizedText;
  issued_at: string;
  verify_url: string;
}

export interface PrerequisiteEdge {
  id: string;
  course_id: string;
  requires_course_id: string;
}

/* ------------------------------------------------------------------ */
/* parsing (tolerant)                                                  */
/* ------------------------------------------------------------------ */

function parseL10n(v: unknown): LocalizedText {
  const out: LocalizedText = { ...EMPTY_L10N };
  if (!v || typeof v !== "object") return out;
  const r = v as Record<string, unknown>;
  for (const l of ["fa", "ar", "en"] as const) {
    if (typeof r[l] === "string") out[l] = r[l];
  }
  return out;
}

function parseOptL10n(v: unknown): LocalizedText | null {
  if (v == null) return null;
  return parseL10n(v);
}

/** Curriculum.description: plain string server-side → expand into {fa}. */
function parseCurriculumDescription(v: unknown): LocalizedText {
  const out: LocalizedText = { ...EMPTY_L10N };
  if (typeof v === "string" && v) out.fa = v;
  return out;
}

function parseNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseId(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function asList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const items = (raw as Record<string, unknown>).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

function parseLevel(v: unknown): CourseLevel {
  return v === "intermediate" || v === "advanced" ? v : "beginner";
}

function parseVisibility(v: unknown): CourseVisibility {
  return v === "private" ? "private" : "public";
}

function parseBlocks(v: unknown): CmsBlock[] {
  if (!Array.isArray(v)) return [];
  const out: CmsBlock[] = [];
  for (const b of v) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    if (typeof r.type !== "string" || !r.type) continue;
    out.push({
      type: r.type,
      props: r.props && typeof r.props === "object" ? (r.props as Record<string, unknown>) : {},
    });
  }
  return out;
}

function parseCurriculum(raw: unknown): Curriculum | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  return {
    id: parseId(r.id),
    title: parseL10n(r.title),
    description: parseCurriculumDescription(r.description),
    sort_order: parseNum(r.sort_order, 0),
    is_active: r.is_active !== false,
  };
}

function parseCourse(raw: unknown): Course | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  return {
    id: parseId(r.id),
    curriculum_id: r.curriculum_id == null ? null : parseId(r.curriculum_id),
    title: parseL10n(r.title),
    description: parseOptL10n(r.description),
    level: parseLevel(r.level),
    visibility: parseVisibility(r.visibility),
    sort_order: parseNum(r.sort_order, 0),
    is_active: r.is_active !== false,
    lesson_count: parseNum(r.lesson_count, 0),
  };
}

function parseLesson(raw: unknown): Lesson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  return {
    id: parseId(r.id),
    course_id: r.course_id == null ? "" : parseId(r.course_id),
    title: parseL10n(r.title),
    body: parseBlocks(r.body),
    duration_minutes: parseNum(r.duration_minutes, 0),
    sort_order: parseNum(r.sort_order, 0),
    is_free_preview: r.is_free_preview === true,
  };
}

function parseCohort(raw: unknown): Cohort | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  return {
    id: parseId(r.id),
    course_id: r.course_id == null ? "" : parseId(r.course_id),
    title: parseL10n(r.title),
    starts_at: typeof r.starts_at === "string" ? r.starts_at : "",
    ends_at: typeof r.ends_at === "string" ? r.ends_at : "",
    max_seats: parseNum(r.max_seats, 0),
    is_open: r.is_open !== false,
    enrolled_count: parseNum(r.enrolled_count, 0),
    seats_left: parseNum(r.seats_left, 0),
  };
}

function parseCohortEnrollment(raw: unknown): CohortEnrollment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  const userId = r.user_id == null ? "" : parseId(r.user_id);
  return {
    id: parseId(r.id),
    cohort_id: r.cohort_id == null ? "" : parseId(r.cohort_id),
    user_id: userId,
    user_display:
      typeof r.user_display === "string" && r.user_display ? r.user_display : userId,
    enrolled_at: typeof r.enrolled_at === "string" ? r.enrolled_at : "",
    status: typeof r.status === "string" ? r.status : "active",
  };
}

function parseLessonProgressItem(raw: unknown): LessonProgressItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.lesson_id == null) return null;
  return {
    lesson_id: parseId(r.lesson_id),
    lesson_title: parseL10n(r.lesson_title),
    sort_order: parseNum(r.sort_order, 0),
    completed: r.completed === true,
    completed_at: typeof r.completed_at === "string" ? r.completed_at : null,
  };
}

function parseUserProgressOut(raw: unknown): UserEnrollmentProgress[] {
  if (!raw || typeof raw !== "object") return [];
  const courses = (raw as Record<string, unknown>).courses;
  if (!Array.isArray(courses)) return [];
  const out: UserEnrollmentProgress[] = [];
  for (const c of courses) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (r.course_id == null) continue;
    const lessons: LessonProgressItem[] = [];
    if (Array.isArray(r.lessons)) {
      for (const l of r.lessons) {
        const p = parseLessonProgressItem(l);
        if (p) lessons.push(p);
      }
    }
    lessons.sort((a, b) => a.sort_order - b.sort_order);
    const total = parseNum(r.total_lessons, lessons.length);
    const done = parseNum(r.completed_lessons, lessons.filter((l) => l.completed).length);
    out.push({
      course_id: parseId(r.course_id),
      course_title: parseL10n(r.course_title),
      completed_lessons: done,
      total_lessons: total,
      progress_pct: total > 0 ? Math.round((done / total) * 100) : 0,
      lessons,
    });
  }
  return out;
}

function parseCertificate(raw: unknown): Certificate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id == null) return null;
  const code = typeof r.code === "string" ? r.code : "";
  const userId = r.user_id == null ? "" : parseId(r.user_id);
  return {
    id: parseId(r.id),
    code,
    user_id: userId,
    user_display:
      typeof r.user_display === "string" && r.user_display ? r.user_display : userId,
    course_id: r.course_id == null ? "" : parseId(r.course_id),
    course_title: parseL10n(r.course_title),
    issued_at: typeof r.issued_at === "string" ? r.issued_at : "",
    verify_url: `/api/v1/certificates/${encodeURIComponent(code)}/verify`,
  };
}

function parsePrerequisiteEdge(raw: unknown): PrerequisiteEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.course_id == null || r.requires_course_id == null) return null;
  return {
    id: r.id == null ? "" : parseId(r.id),
    course_id: parseId(r.course_id),
    requires_course_id: parseId(r.requires_course_id),
  };
}

/* ------------------------------------------------------------------ */
/* cycle prevention (prerequisite graph)                               */
/*                                                                     */
/* Edges point course → its prerequisite. Adding (courseId requires    */
/* requiresId) creates a cycle iff requiresId transitively requires    */
/* courseId. Computed client-side from the full edge list so the UI    */
/* can refuse the save before it ever reaches the server (which also   */
/* enforces it: 422 prerequisite_cycle).                               */
/* ------------------------------------------------------------------ */

export function wouldCreateCycle(
  edges: PrerequisiteEdge[],
  courseId: string,
  requiresId: string,
): boolean {
  if (courseId === requiresId) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.course_id) ?? [];
    list.push(e.requires_course_id);
    adj.set(e.course_id, list);
  }
  const seen = new Set<string>([requiresId]);
  const stack = [requiresId];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (cur === courseId) return true;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* query keys                                                          */
/* ------------------------------------------------------------------ */

export const LMS_KEYS = {
  curricula: ["lms", "curricula"] as const,
  courses: ["lms", "courses"] as const,
  lessons: (courseId: string) => ["lms", "lessons", courseId] as const,
  cohorts: ["lms", "cohorts"] as const,
  cohortEnrollments: (cohortId: string) => ["lms", "cohort-enrollments", cohortId] as const,
  userProgress: (userId: string) => ["lms", "user-progress", userId] as const,
  certificates: ["lms", "certificates"] as const,
  prerequisites: (courseId: string) => ["lms", "prerequisites", courseId] as const,
  allPrerequisites: ["lms", "prerequisites", "all"] as const,
};

/* ------------------------------------------------------------------ */
/* fetchers                                                            */
/* ------------------------------------------------------------------ */

async function fetchList<T>(path: string, parse: (raw: unknown) => T | null): Promise<T[]> {
  const raw = await apiFetch<unknown>(path);
  const out: T[] = [];
  for (const it of asList(raw)) {
    const p = parse(it);
    if (p) out.push(p);
  }
  return out;
}

export async function fetchCurricula(): Promise<Curriculum[]> {
  return fetchList("/api/v1/admin/lms/curricula", parseCurriculum);
}

export async function fetchCourses(): Promise<Course[]> {
  return fetchList("/api/v1/admin/lms/courses", parseCourse);
}

export async function fetchLessons(courseId: string): Promise<Lesson[]> {
  return fetchList(
    `/api/v1/admin/lms/courses/${encodeURIComponent(courseId)}/lessons`,
    parseLesson,
  );
}

export async function fetchCohorts(): Promise<Cohort[]> {
  return fetchList("/api/v1/admin/lms/cohorts", parseCohort);
}

export async function fetchCohortEnrollments(cohortId: string): Promise<CohortEnrollment[]> {
  return fetchList(
    `/api/v1/admin/lms/cohorts/${encodeURIComponent(cohortId)}/enrollments`,
    parseCohortEnrollment,
  );
}

export async function fetchUserProgress(userId: string): Promise<UserEnrollmentProgress[]> {
  const raw = await apiFetch<unknown>(
    `/api/v1/admin/lms/users/${encodeURIComponent(userId)}/progress`,
  );
  return parseUserProgressOut(raw);
}

export async function fetchCertificates(): Promise<Certificate[]> {
  return fetchList("/api/v1/admin/lms/certificates", parseCertificate);
}

export async function fetchPrerequisites(courseId: string): Promise<PrerequisiteEdge[]> {
  return fetchList(
    `/api/v1/admin/lms/prerequisites?course_id=${encodeURIComponent(courseId)}`,
    parsePrerequisiteEdge,
  );
}

export async function fetchAllPrerequisites(): Promise<PrerequisiteEdge[]> {
  return fetchList("/api/v1/admin/lms/prerequisites", parsePrerequisiteEdge);
}

/* ------------------------------------------------------------------ */
/* react-query hooks                                                   */
/* ------------------------------------------------------------------ */

export function useCurriculaQuery() {
  return useQuery({ queryKey: LMS_KEYS.curricula, queryFn: fetchCurricula, retry: false });
}

export function useCoursesQuery() {
  return useQuery({ queryKey: LMS_KEYS.courses, queryFn: fetchCourses, retry: false });
}

export function useLessonsQuery(courseId: string | null) {
  return useQuery({
    queryKey: LMS_KEYS.lessons(courseId ?? ""),
    queryFn: () => fetchLessons(courseId as string),
    enabled: !!courseId,
    retry: false,
  });
}

export function useCohortsQuery() {
  return useQuery({ queryKey: LMS_KEYS.cohorts, queryFn: fetchCohorts, retry: false });
}

export function useCohortEnrollmentsQuery(cohortId: string | null) {
  return useQuery({
    queryKey: LMS_KEYS.cohortEnrollments(cohortId ?? ""),
    queryFn: () => fetchCohortEnrollments(cohortId as string),
    enabled: !!cohortId,
    retry: false,
  });
}

export function useCertificatesQuery() {
  return useQuery({ queryKey: LMS_KEYS.certificates, queryFn: fetchCertificates, retry: false });
}

export function usePrerequisitesQuery(courseId: string | null) {
  return useQuery({
    queryKey: LMS_KEYS.prerequisites(courseId ?? ""),
    queryFn: () => fetchPrerequisites(courseId as string),
    enabled: !!courseId,
    retry: false,
  });
}

export function useAllPrerequisitesQuery() {
  return useQuery({
    queryKey: LMS_KEYS.allPrerequisites,
    queryFn: fetchAllPrerequisites,
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* mutation bodies                                                     */
/* ------------------------------------------------------------------ */

export interface CurriculumBody {
  title: LocalizedText;
  /** mapped to the backend's plain-string description (fa text) */
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface CourseBody {
  curriculum_id: string | null;
  title: LocalizedText;
  description: LocalizedText | null;
  level: CourseLevel;
  visibility: CourseVisibility;
  sort_order: number;
  is_active: boolean;
}

export interface LessonBody {
  course_id: string;
  title: LocalizedText;
  body: CmsBlock[];
  duration_minutes: number;
  sort_order: number;
  is_free_preview: boolean;
}

export interface CohortBody {
  course_id: string;
  title: LocalizedText;
  starts_at: string;
  ends_at: string;
  max_seats: number;
  is_open: boolean;
}

function useLmsMutation<TArgs, TOut>(fn: (args: TArgs) => Promise<TOut>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lms"] });
    },
  });
}

/* curricula */

export function useCreateCurriculum() {
  return useLmsMutation((body: CurriculumBody) =>
    apiFetch<Curriculum>("/api/v1/admin/lms/curricula", { method: "POST", body }),
  );
}

export function useUpdateCurriculum() {
  return useLmsMutation(({ id, body }: { id: string; body: CurriculumBody }) =>
    apiFetch<Curriculum>(`/api/v1/admin/lms/curricula/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),
  );
}

export function useDeleteCurriculum() {
  return useLmsMutation((id: string) =>
    apiFetch<unknown>(`/api/v1/admin/lms/curricula/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

/* courses */

export function useCreateCourse() {
  return useLmsMutation((body: CourseBody) =>
    apiFetch<Course>("/api/v1/admin/lms/courses", { method: "POST", body }),
  );
}

export function useUpdateCourse() {
  return useLmsMutation(({ id, body }: { id: string; body: CourseBody }) =>
    apiFetch<Course>(`/api/v1/admin/lms/courses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),
  );
}

export function useDeleteCourse() {
  return useLmsMutation((id: string) =>
    apiFetch<unknown>(`/api/v1/admin/lms/courses/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

/* lessons */

export function useCreateLesson() {
  return useLmsMutation((body: LessonBody) =>
    apiFetch<Lesson>("/api/v1/admin/lms/lessons", { method: "POST", body }),
  );
}

export function useUpdateLesson() {
  return useLmsMutation(({ id, body }: { id: string; body: Omit<LessonBody, "course_id"> }) =>
    apiFetch<Lesson>(`/api/v1/admin/lms/lessons/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),
  );
}

export function useDeleteLesson() {
  return useLmsMutation((id: string) =>
    apiFetch<unknown>(`/api/v1/admin/lms/lessons/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

/* cohorts */

export function useCreateCohort() {
  return useLmsMutation((body: CohortBody) =>
    apiFetch<Cohort>("/api/v1/admin/lms/cohorts", { method: "POST", body }),
  );
}

export function useUpdateCohort() {
  return useLmsMutation(({ id, body }: { id: string; body: Partial<CohortBody> }) =>
    apiFetch<Cohort>(`/api/v1/admin/lms/cohorts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),
  );
}

export function useDeleteCohort() {
  return useLmsMutation((id: string) =>
    apiFetch<unknown>(`/api/v1/admin/lms/cohorts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}

/* prerequisites — single edges */

export function useAddPrerequisite() {
  return useLmsMutation(({ courseId, requiresId }: { courseId: string; requiresId: string }) =>
    apiFetch<PrerequisiteEdge>("/api/v1/admin/lms/prerequisites", {
      method: "POST",
      body: { course_id: courseId, requires_course_id: requiresId },
    }),
  );
}

export function useRemovePrerequisite() {
  return useLmsMutation(({ courseId, requiresId }: { courseId: string; requiresId: string }) =>
    apiFetch<unknown>(
      `/api/v1/admin/lms/prerequisites?course_id=${encodeURIComponent(courseId)}&requires_course_id=${encodeURIComponent(requiresId)}`,
      { method: "DELETE" },
    ),
  );
}
