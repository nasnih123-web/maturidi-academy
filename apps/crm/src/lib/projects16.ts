import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { EMPTY_L10N, type LocalizedText } from "./contentApi";
import { errText } from "./library";

/**
 * Phase 16 — Track 3 (CRM) service layer: internal project management (PMS)
 * and staff directory.
 *
 * ADR-001: every bit of parsing, defaulting, date math, and API access lives
 * here. Components in pages/ only render what these hooks return.
 *
 * ------------------------------------------------------------------
 * Backend contract — from the Phase 16 parallel-track contract (Track 1):
 *
 *   GET  /api/v1/projects
 *     → [{id, title:{fa,ar,en}, status, ...}]
 *   POST /api/v1/projects  {title:{fa,ar,en}, status?}
 *   GET / PATCH / DELETE /api/v1/projects/{id}
 *
 *   GET  /api/v1/projects/{id}/tasks
 *     → [{id, project_id, title:{fa,ar,en}, description, assignee_id,
 *          assignee_name?, status, due_date, priority,
 *          related_entity_type, related_entity_id, ...}]
 *   POST /api/v1/projects/{id}/tasks
 *     {title:{fa,ar,en}, description?, assignee_id?, status?, due_date?,
 *      priority?, related_entity_type?, related_entity_id?}
 *   GET / PATCH / DELETE /api/v1/projects/tasks/{task_id}
 *   POST /api/v1/projects/tasks/{task_id}/move  {status}   (kanban target)
 *
 *   GET  /api/v1/projects/tasks/by-entity
 *        ?related_entity_type=library_item&related_entity_id=<uuid>
 *
 *   GET  /api/v1/staff
 *     → [{id, user_id, user_name?, title:{fa,ar,en}, department:{fa,ar,en},
 *          joined_date, is_active}]
 *   POST /api/v1/staff  {user_id, title, department, joined_date?}
 *   GET / PATCH / DELETE /api/v1/staff/{id}
 *
 *   Task statuses:    backlog | todo | in_progress | review | done
 *   Project statuses: active | on_hold | completed | archived
 *   Priorities:       low | medium | high | urgent
 *
 *   All writes require the `projects.manage` permission; reads need auth.
 *   A 403 from the backend surfaces as an ApiError — the pages render an
 *   honest "no permission" state, never a crash.
 *
 * Assignment notifications and due-date reminders are backend-driven
 * (notification_preferences) — no CRM-side scheduling here.
 * ------------------------------------------------------------------
 */

export { errText };

export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type RelatedEntityType = "library_item";

export const TASK_STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "review", "done"];
export const PROJECT_STATUSES: ProjectStatus[] = ["active", "on_hold", "completed", "archived"];
export const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
export const RELATED_ENTITY_TYPES: RelatedEntityType[] = ["library_item"];

export interface Project {
  id: string;
  title: LocalizedText;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: LocalizedText;
  description: LocalizedText;
  assignee_id: string | null;
  /**
   * The parallel-track contract listed `assignee_name?` here, but the real
   * backend (ADR-0014) does not return it on TaskOut — and StaffOut has no
   * `user_name` either. Kept as a tolerant optional so a future backend
   * enrichment flows through; until then the CRM resolves a display label
   * from the staff directory (see resolveAssigneeLabel).
   */
  assignee_name: string | null;
  status: TaskStatus;
  due_date: string | null;
  priority: TaskPriority;
  related_entity_type: RelatedEntityType | null;
  related_entity_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffMember {
  id: string;
  user_id: string;
  user_name: string | null;
  title: LocalizedText;
  department: LocalizedText;
  joined_date: string | null;
  is_active: boolean;
}

/* ------------------------------------------------------------------ */
/* tolerant parsing (backend is authoritative; CRM only defaults)        */
/* ------------------------------------------------------------------ */

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : {};
}

function pickString(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string") return v;
  }
  return "";
}

function pickL10n(raw: unknown): LocalizedText {
  if (typeof raw === "string") return { fa: raw, ar: raw, en: raw };
  const r = asRecord(raw);
  return {
    fa: typeof r.fa === "string" ? r.fa : "",
    ar: typeof r.ar === "string" ? r.ar : "",
    en: typeof r.en === "string" ? r.en : "",
  };
}

function pickOneOf<T extends string>(r: Record<string, unknown>, allowed: T[], fallback: T): T {
  const v = r.status ?? r.state ?? null;
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

function readList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = asRecord(raw);
  if (Array.isArray(r.items)) return r.items;
  if (Array.isArray(r.data)) return r.data;
  return [];
}

export function parseProject(raw: unknown): Project {
  const r = asRecord(raw);
  return {
    id: pickString(r, "id"),
    title: pickL10n(r.title),
    status: pickOneOf(r, PROJECT_STATUSES, "active"),
    created_at: pickString(r, "created_at"),
    updated_at: pickString(r, "updated_at"),
  };
}

export function parseTask(raw: unknown): Task {
  const r = asRecord(raw);
  const statusRaw = pickString(r, "status");
  const status: TaskStatus = (TASK_STATUSES as string[]).includes(statusRaw)
    ? (statusRaw as TaskStatus)
    : "todo";
  const prioRaw = pickString(r, "priority");
  const priority: TaskPriority = (PRIORITIES as string[]).includes(prioRaw)
    ? (prioRaw as TaskPriority)
    : "medium";
  const entityRaw = pickString(r, "related_entity_type");
  return {
    id: pickString(r, "id"),
    project_id: pickString(r, "project_id"),
    title: pickL10n(r.title),
    description: r.description == null ? { ...EMPTY_L10N } : pickL10n(r.description),
    assignee_id: pickString(r, "assignee_id") || null,
    assignee_name: pickString(r, "assignee_name") || null,
    status,
    due_date: pickString(r, "due_date") || null,
    priority,
    related_entity_type: (RELATED_ENTITY_TYPES as string[]).includes(entityRaw)
      ? (entityRaw as RelatedEntityType)
      : null,
    related_entity_id: pickString(r, "related_entity_id") || null,
    created_at: pickString(r, "created_at"),
    updated_at: pickString(r, "updated_at"),
  };
}

export function parseStaff(raw: unknown): StaffMember {
  const r = asRecord(raw);
  return {
    id: pickString(r, "id"),
    user_id: pickString(r, "user_id"),
    user_name: pickString(r, "user_name") || null,
    title: pickL10n(r.title),
    department: pickL10n(r.department),
    joined_date: pickString(r, "joined_date") || null,
    is_active: typeof r.is_active === "boolean" ? r.is_active : true,
  };
}

/** True when a due date has passed (date-only comparison; logic lives here per ADR-001). */
export function isOverdue(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return day(d) < day(now);
}

/** Localized text picker — fa/ar/en fallback chain (contract §15.4). */
export function l10n(locale: "fa" | "ar" | "en", v: LocalizedText): string {
  return v[locale] || v.fa || v.en || v.ar || "";
}

export function emptyProjectInput(): { title: LocalizedText; status: ProjectStatus } {
  return { title: { ...EMPTY_L10N }, status: "active" };
}

/**
 * Assignee display label for a task card.
 *
 * The backend does not return a personal name on tasks (no `assignee_name`
 * on TaskOut, no `user_name` on StaffOut — verified against the real
 * implementation). Resolution order: backend-provided name (tolerant,
 * future-proof) → staff directory match by user_id (localized staff
 * title) → short user id. ADR-001: this lookup logic lives here, not in
 * components.
 */
export function resolveAssigneeLabel(
  locale: "fa" | "ar" | "en",
  task: Pick<Task, "assignee_id" | "assignee_name">,
  staff: StaffMember[],
): string | null {
  if (task.assignee_name) return task.assignee_name;
  if (!task.assignee_id) return null;
  const member = staff.find((s) => s.user_id === task.assignee_id);
  if (member) {
    const title = l10n(locale, member.title);
    return title || task.assignee_id.slice(0, 8);
  }
  return task.assignee_id.slice(0, 8);
}

export function emptyTaskInput(): {
  title: LocalizedText;
  description: LocalizedText;
  assignee_id: string | null;
  status: TaskStatus;
  due_date: string | null;
  priority: TaskPriority;
  related_entity_type: RelatedEntityType | null;
  related_entity_id: string | null;
} {
  return {
    title: { ...EMPTY_L10N },
    description: { ...EMPTY_L10N },
    assignee_id: null,
    status: "todo",
    due_date: null,
    priority: "medium",
    related_entity_type: null,
    related_entity_id: null,
  };
}

/** Badge tones for task statuses (presentation config, kept here as the single source). */
export function taskStatusTone(s: TaskStatus): "info" | "warning" | "neutral" | "success" {
  switch (s) {
    case "backlog":
      return "neutral";
    case "todo":
      return "info";
    case "in_progress":
      return "warning";
    case "review":
      return "warning";
    case "done":
      return "success";
    default:
      return "neutral";
  }
}

/** Badge tones for task priorities (presentation config, kept here as the single source). */
export function taskPriorityTone(
  p: TaskPriority,
): "danger" | "warning" | "info" | "neutral" {
  switch (p) {
    case "urgent":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "neutral";
  }
}

/* ------------------------------------------------------------------ */
/* react-query keys + hooks                                             */
/* ------------------------------------------------------------------ */

export const proj16Keys = {
  projects: ["proj16", "projects"] as const,
  project: (id: string) => ["proj16", "project", id] as const,
  tasks: (projectId: string) => ["proj16", "tasks", projectId] as const,
  byEntity: (type: string, id: string) => ["proj16", "tasksByEntity", type, id] as const,
  staff: ["proj16", "staff"] as const,
};

const BASE = "/api/v1/projects";
const STAFF_BASE = "/api/v1/staff";

/* ---------------- projects ---------------- */

export function useProjectsQuery() {
  return useQuery({
    queryKey: proj16Keys.projects,
    queryFn: async () => readList(await apiFetch<unknown>(BASE)).map(parseProject),
    retry: false,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: LocalizedText; status?: ProjectStatus }) =>
      apiFetch<unknown>(BASE, { method: "POST", body: input }).then(parseProject),
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.projects }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title?: LocalizedText; status?: ProjectStatus }) =>
      apiFetch<unknown>(`${BASE}/${input.id}`, {
        method: "PATCH",
        body: { title: input.title, status: input.status },
      }).then(parseProject),
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.projects }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.projects }),
  });
}

/* ---------------- tasks ---------------- */

export function useProjectTasksQuery(projectId: string | null) {
  return useQuery({
    queryKey: proj16Keys.tasks(projectId ?? "none"),
    queryFn: () =>
      apiFetch<unknown>(`${BASE}/${projectId}/tasks`).then((raw) =>
        readList(raw).map(parseTask),
      ),
    enabled: !!projectId,
    retry: false,
  });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: LocalizedText;
      description?: LocalizedText;
      assignee_id?: string | null;
      status?: TaskStatus;
      due_date?: string | null;
      priority?: TaskPriority;
      related_entity_type?: RelatedEntityType | null;
      related_entity_id?: string | null;
    }) =>
      apiFetch<unknown>(`${BASE}/${projectId}/tasks`, { method: "POST", body: input }).then(
        parseTask,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.tasks(projectId) }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      projectId: string;
      title?: LocalizedText;
      description?: LocalizedText;
      assignee_id?: string | null;
      status?: TaskStatus;
      due_date?: string | null;
      priority?: TaskPriority;
      related_entity_type?: RelatedEntityType | null;
      related_entity_id?: string | null;
    }) => {
      const { id, projectId: _pid, ...body } = input;
      return apiFetch<unknown>(`${BASE}/tasks/${id}`, { method: "PATCH", body }).then(
        parseTask,
      );
    },
    onSuccess: (task) => qc.invalidateQueries({ queryKey: proj16Keys.tasks(task.project_id) }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; projectId: string }) =>
      apiFetch<unknown>(`${BASE}/tasks/${input.id}`, { method: "DELETE" }),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: proj16Keys.tasks(vars.projectId) }),
  });
}

/**
 * Kanban drag target — POST /api/v1/projects/tasks/{id}/move {status}.
 * Optimistic: the card moves instantly in the project-tasks cache;
 * on failure the previous cache is restored (rollback).
 */
export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; projectId: string; status: TaskStatus }) =>
      apiFetch<unknown>(`${BASE}/tasks/${input.id}/move`, {
        method: "POST",
        body: { status: input.status },
      }).then(parseTask),
    onMutate: async (vars) => {
      const key = proj16Keys.tasks(vars.projectId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Task[]>(key);
      qc.setQueryData<Task[]>(key, (old) =>
        (old ?? []).map((t) => (t.id === vars.id ? { ...t, status: vars.status } : t)),
      );
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: (_d, _e, vars) =>
      qc.invalidateQueries({ queryKey: proj16Keys.tasks(vars.projectId) }),
  });
}

/** Reverse lookup: tasks linked to a content entity (e.g. a library item). */
export function useTasksByEntity(
  entityType: RelatedEntityType | null,
  entityId: string | null,
) {
  return useQuery({
    queryKey: proj16Keys.byEntity(entityType ?? "none", entityId ?? "none"),
    queryFn: () =>
      apiFetch<unknown>(
        `${BASE}/tasks/by-entity?related_entity_type=${encodeURIComponent(
          entityType as string,
        )}&related_entity_id=${encodeURIComponent(entityId as string)}`,
      ).then((raw) => readList(raw).map(parseTask)),
    enabled: !!entityType && !!entityId,
    retry: false,
  });
}

/* ---------------- staff ---------------- */

export function useStaffQuery() {
  return useQuery({
    queryKey: proj16Keys.staff,
    queryFn: async () => readList(await apiFetch<unknown>(STAFF_BASE)).map(parseStaff),
    retry: false,
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      user_id: string;
      title: LocalizedText;
      department: LocalizedText;
      joined_date?: string;
    }) => apiFetch<unknown>(STAFF_BASE, { method: "POST", body: input }).then(parseStaff),
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.staff }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      title?: LocalizedText;
      department?: LocalizedText;
      joined_date?: string | null;
      is_active?: boolean;
    }) => {
      const { id, ...body } = input;
      return apiFetch<unknown>(`${STAFF_BASE}/${id}`, { method: "PATCH", body }).then(
        parseStaff,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.staff }),
  });
}

export function useDeleteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`${STAFF_BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: proj16Keys.staff }),
  });
}
