import React from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, CardContent } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import {
  PRIORITIES,
  PROJECT_STATUSES,
  RELATED_ENTITY_TYPES,
  TASK_STATUSES,
  errText,
  isOverdue,
  l10n,
  resolveAssigneeLabel,
  taskPriorityTone,
  taskStatusTone,
  useCreateProject,
  useCreateTask,
  useDeleteProject,
  useDeleteTask,
  useMoveTask,
  useProjectTasksQuery,
  useProjectsQuery,
  useStaffQuery,
  useUpdateProject,
  useUpdateTask,
  type Project,
  type ProjectStatus,
  type RelatedEntityType,
  type StaffMember,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../lib/projects16";
import { useLibraryItemsQuery, type LibraryItem } from "../lib/library";
import { ApiError } from "../lib/api";
import type { LocalizedText } from "../lib/contentApi";

/**
 * Phase 16 — Track 3 (CRM): internal project management (PMS).
 *
 * - Project list (create / edit / delete) with a project selector.
 * - Kanban board with 5 columns (backlog/todo/in_progress/review/done):
 *   native HTML5 drag-and-drop between columns → POST …/tasks/{id}/move;
 *   optimistic update with rollback on failure (lib/projects16.ts).
 * - Task card: localized title, assignee avatar/name, due date with
 *   overdue highlight, priority badge, linked-entity chip.
 * - Task detail drawer: edit all fields, assignee picker from the staff
 *   directory, due date, priority, and a related-entity linker
 *   (library_item — search via the existing library client, chip with link).
 *
 * Assignment notifications and due-date reminders are backend-driven;
 * this page performs no scheduling. ADR-001: this file only renders —
 * all API access, parsing, drag-move semantics and date math live in
 * lib/projects16.ts and lib/library.ts.
 */

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

function toneForPriority(p: TaskPriority): "danger" | "warning" | "info" | "neutral" {
  return taskPriorityTone(p);
}

function toneForStatus(s: TaskStatus): "info" | "warning" | "neutral" | "success" {
  return taskStatusTone(s);
}

function avatarInitial(name: string | null): string {
  return (name ?? "?").trim().charAt(0) || "?";
}

/* ------------------------------------------------------------------ */
/* task card                                                            */
/* ------------------------------------------------------------------ */

function TaskCard({
  task,
  staff,
  onOpen,
  t,
  locale,
}: {
  task: Task;
  staff: StaffMember[];
  onOpen: () => void;
  t: (p: string) => string;
  locale: "fa" | "ar" | "en";
}): React.ReactElement {
  const overdue = task.status !== "done" && isOverdue(task.due_date);
  const assigneeLabel = resolveAssigneeLabel(locale, task, staff);
  return (
    <div
      className="kanban-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      aria-label={l10n(locale, task.title)}
    >
      <p className="kanban-card-title">{l10n(locale, task.title) || "—"}</p>
      <div className="kanban-card-meta">
        {assigneeLabel ? (
          <span className="kanban-assignee">
            <span className="kanban-avatar" aria-hidden="true">
              {avatarInitial(assigneeLabel)}
            </span>
            {assigneeLabel}
          </span>
        ) : (
          <span className="hint">{t("proj16.unassigned")}</span>
        )}
        {task.due_date && (
          <Badge tone={overdue ? "danger" : "neutral"}>
            {overdue ? t("proj16.overdue") + " " : ""}
            <span dir="ltr">{task.due_date.slice(0, 10)}</span>
          </Badge>
        )}
      </div>
      <div className="kanban-card-tags">
        <Badge tone={toneForPriority(task.priority)}>
          {t(`proj16.priority_${task.priority}`)}
        </Badge>
        {task.related_entity_type && task.related_entity_id && (
          <span className="kanban-link-chip" title={task.related_entity_id}>
            📎 {t(`proj16.entity_${task.related_entity_type}`)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* kanban column                                                        */
/* ------------------------------------------------------------------ */

function KanbanColumn({
  status,
  tasks,
  staff,
  onOpenTask,
  onDropTask,
  onAdd,
  canManage,
  t,
  locale,
}: {
  status: TaskStatus;
  tasks: Task[];
  staff: StaffMember[];
  onOpenTask: (task: Task) => void;
  onDropTask: (taskId: string, status: TaskStatus) => void;
  onAdd: (status: TaskStatus) => void;
  canManage: boolean;
  t: (p: string) => string;
  locale: "fa" | "ar" | "en";
}): React.ReactElement {
  const [over, setOver] = React.useState(false);
  return (
    <section
      className={`kanban-col${over ? " kanban-col-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id, status);
      }}
      aria-label={t(`proj16.status_${status}`)}
    >
      <header className="kanban-col-head">
        <Badge tone={toneForStatus(status)}>{t(`proj16.status_${status}`)}</Badge>
        <span className="hint">{tasks.length}</span>
        {canManage && (
          <button
            type="button"
            className="kanban-add"
            onClick={() => onAdd(status)}
            aria-label={t("proj16.addTask")}
            title={t("proj16.addTask")}
          >
            +
          </button>
        )}
      </header>
      <div className="kanban-col-body">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} staff={staff} onOpen={() => onOpenTask(task)} t={t} locale={locale} />
        ))}
        {tasks.length === 0 && <p className="empty">{t("proj16.emptyColumn")}</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* related-entity linker (library_item)                                  */
/* ------------------------------------------------------------------ */

function useDebounced(value: string, ms: number): string {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

function EntityLinker({
  entityType,
  entityId,
  onChange,
  t,
  locale,
}: {
  entityType: RelatedEntityType | null;
  entityId: string | null;
  onChange: (type: RelatedEntityType | null, id: string | null) => void;
  t: (p: string) => string;
  locale: "fa" | "ar" | "en";
}): React.ReactElement {
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q, 350);
  const itemsQ = useLibraryItemsQuery({
    q: debounced.trim() || undefined,
  });
  const items: LibraryItem[] = itemsQ.data?.items ?? [];

  const selected = items.find((i) => i.id === entityId);

  return (
    <div className="field">
      <span className="field-label">{t("proj16.linkedEntity")}</span>
      {entityId && entityType ? (
        <div className="kanban-link-line">
          <span className="kanban-link-chip">
            📎 {t(`proj16.entity_${entityType}`)} —{" "}
            {selected ? l10n(locale, selected.title) : entityId.slice(0, 8)}
          </span>
          <Button variant="ghost" onClick={() => onChange(null, null)}>
            {t("proj16.unlink")}
          </Button>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="task-entity-type">{t("proj16.entityType")}</label>
            <select
              id="task-entity-type"
              value={entityType ?? ""}
              onChange={(e) =>
                onChange((e.target.value || null) as RelatedEntityType | null, null)
              }
            >
              <option value="">{t("proj16.entityNone")}</option>
              {RELATED_ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>
                  {t(`proj16.entity_${et}`)}
                </option>
              ))}
            </select>
          </div>
          {entityType && (
            <div className="field">
              <label htmlFor="task-entity-search">{t("proj16.entitySearch")}</label>
              <input
                id="task-entity-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("proj16.entitySearchPh")}
              />
              {itemsQ.isLoading && <p className="hint">{t("common.loading")}</p>}
              {itemsQ.isSuccess && items.length > 0 && (
                <ul className="kanban-search-results">
                  {items.slice(0, 8).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="kanban-search-item"
                        onClick={() => onChange(entityType, item.id)}
                      >
                        {l10n(locale, item.title) || item.id.slice(0, 8)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* task drawer                                                          */
/* ------------------------------------------------------------------ */

function TaskDrawer({
  task,
  projectId,
  defaultStatus,
  staff,
  onClose,
  t,
  locale,
}: {
  task: Task | null; // null → create mode
  projectId: string;
  defaultStatus: TaskStatus;
  staff: StaffMember[];
  onClose: () => void;
  t: (p: string) => string;
  locale: "fa" | "ar" | "en";
}): React.ReactElement {
  const navigate = useNavigate();
  const [title, setTitle] = React.useState<LocalizedText>(
    task?.title ?? { fa: "", ar: "", en: "" },
  );
  const [description, setDescription] = React.useState<LocalizedText>(
    task?.description ?? { fa: "", ar: "", en: "" },
  );
  const [assigneeId, setAssigneeId] = React.useState<string | null>(task?.assignee_id ?? null);
  const [status, setStatus] = React.useState<TaskStatus>(
    task?.status ?? defaultStatus,
  );
  const [priority, setPriority] = React.useState<TaskPriority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = React.useState(task?.due_date?.slice(0, 10) ?? "");
  const [entityType, setEntityType] = React.useState<RelatedEntityType | null>(
    task?.related_entity_type ?? null,
  );
  const [entityId, setEntityId] = React.useState<string | null>(
    task?.related_entity_id ?? null,
  );

  const activeStaff = staff.filter((s) => s.is_active);

  const createMut = useCreateTask(projectId);
  const updateMut = useUpdateTask();
  const deleteMut = useDeleteTask();
  const saving = createMut.isPending || updateMut.isPending;
  const saveError = createMut.isError ? createMut.error : updateMut.isError ? updateMut.error : null;

  const save = () => {
    const body = {
      title,
      description,
      assignee_id: assigneeId,
      status,
      due_date: dueDate || null,
      priority,
      related_entity_type: entityType,
      related_entity_id: entityId,
    };
    if (task) {
      updateMut.mutate({ id: task.id, projectId, ...body }, { onSuccess: onClose });
    } else {
      createMut.mutate(body, { onSuccess: onClose });
    }
  };

  const remove = () => {
    if (!task) return;
    deleteMut.mutate({ id: task.id, projectId }, { onSuccess: onClose });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card kanban-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={task ? t("proj16.editTask") : t("proj16.newTask")}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{task ? t("proj16.editTask") : t("proj16.newTask")}</h3>

        {(["fa", "ar", "en"] as const).map((l) => (
          <div className="field" key={l}>
            <label htmlFor={`task-title-${l}`}>
              {t("proj16.title")} ({t(`proj16.locale_${l}`)})
            </label>
            <input
              id={`task-title-${l}`}
              value={title[l]}
              onChange={(e) => setTitle({ ...title, [l]: e.target.value })}
              dir={l === "en" ? "ltr" : "rtl"}
            />
          </div>
        ))}

        {(["fa", "ar", "en"] as const).map((l) => (
          <div className="field" key={`desc-${l}`}>
            <label htmlFor={`task-desc-${l}`}>
              {t("proj16.description")} ({t(`proj16.locale_${l}`)})
            </label>
            <textarea
              id={`task-desc-${l}`}
              rows={2}
              value={description[l]}
              onChange={(e) => setDescription({ ...description, [l]: e.target.value })}
              dir={l === "en" ? "ltr" : "rtl"}
            />
          </div>
        ))}

        <div className="field">
          <label htmlFor="task-assignee">{t("proj16.assignee")}</label>
          <select
            id="task-assignee"
            value={assigneeId ?? ""}
            onChange={(e) => setAssigneeId(e.target.value || null)}
          >
            <option value="">{t("proj16.unassigned")}</option>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.user_id}>
                {s.user_name ?? s.user_id} — {l10n(locale, s.title)}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="task-status">{t("proj16.status")}</label>
            <select
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`proj16.status_${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="task-priority">{t("proj16.priority")}</label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`proj16.priority_${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="task-due">{t("proj16.dueDate")}</label>
            <input
              id="task-due"
              type="date"
              dir="ltr"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <EntityLinker
          entityType={entityType}
          entityId={entityId}
          onChange={(et, id) => {
            setEntityType(et);
            setEntityId(id);
          }}
          t={t}
          locale={locale}
        />
        {entityId && entityType === "library_item" && (
          <p className="hint">
            <button
              type="button"
              className="linklike"
              onClick={() => navigate(`/media?id=${encodeURIComponent(entityId)}`)}
            >
              {t("proj16.openLinkedItem")}
            </button>
          </p>
        )}

        {saveError && (
          <p className="form-error" role="alert">
            {errText(saveError)}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
          {task && (
            <Button
              variant="ghost"
              onClick={remove}
              disabled={deleteMut.isPending}
              aria-label={t("proj16.deleteTask")}
            >
              {t("common.delete")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={saving} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* project modal                                                        */
/* ------------------------------------------------------------------ */

function ProjectModal({
  project,
  onClose,
  t,
}: {
  project: Project | null; // null → create
  onClose: () => void;
  t: (p: string) => string;
}): React.ReactElement {
  const [title, setTitle] = React.useState(project?.title ?? { fa: "", ar: "", en: "" });
  const [status, setStatus] = React.useState<ProjectStatus>(project?.status ?? "active");
  const createMut = useCreateProject();
  const updateMut = useUpdateProject();
  const saving = createMut.isPending || updateMut.isPending;

  const save = () => {
    if (project) {
      updateMut.mutate({ id: project.id, title, status }, { onSuccess: onClose });
    } else {
      createMut.mutate({ title, status }, { onSuccess: onClose });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={project ? t("proj16.editProject") : t("proj16.newProject")}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{project ? t("proj16.editProject") : t("proj16.newProject")}</h3>
        {(["fa", "ar", "en"] as const).map((l) => (
          <div className="field" key={l}>
            <label htmlFor={`proj-title-${l}`}>
              {t("proj16.title")} ({t(`proj16.locale_${l}`)})
            </label>
            <input
              id={`proj-title-${l}`}
              value={title[l]}
              onChange={(e) => setTitle({ ...title, [l]: e.target.value })}
              dir={l === "en" ? "ltr" : "rtl"}
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="proj-status">{t("proj16.status")}</label>
          <select
            id="proj-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`proj16.projectStatus_${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={saving} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                 */
/* ------------------------------------------------------------------ */

export default function Projects(): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("projects.manage");

  const projectsQ = useProjectsQuery();
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [projectModal, setProjectModal] = React.useState<"create" | Project | null>(null);
  const [drawer, setDrawer] = React.useState<{ task: Task | null; status: TaskStatus } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const projects = projectsQ.data ?? [];
  React.useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);
  const project = projects.find((p) => p.id === projectId) ?? null;

  const tasksQ = useProjectTasksQuery(projectId);
  const moveMut = useMoveTask();
  const deleteProjectMut = useDeleteProject();
  const staffQ = useStaffQuery();
  const staff: StaffMember[] = staffQ.data ?? [];

  const tasks = React.useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const byStatus = React.useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const s of TASK_STATUSES) map.set(s, []);
    for (const task of tasks) map.get(task.status)?.push(task);
    return map;
  }, [tasks]);

  const onDropTask = (taskId: string, status: TaskStatus) => {
    if (!projectId) return;
    const task = tasks.find((x) => x.id === taskId);
    if (!task || task.status === status) return;
    moveMut.mutate({ id: taskId, projectId, status });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("proj16.pageTitle")}</h1>
          <p className="hint">{t("proj16.hint")}</p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setProjectModal("create")}>
            {t("proj16.newProject")}
          </Button>
        )}
      </div>

      {/* project selector */}
      <Card>
        <CardContent>
          {projectsQ.isLoading && <p className="empty">{t("common.loading")}</p>}
          {projectsQ.isError && (
            <p className="form-error" role="alert">
              {isForbidden(projectsQ.error) ? t("proj16.noPermission") : errText(projectsQ.error)}
            </p>
          )}
          {projectsQ.isSuccess && projects.length === 0 && (
            <p className="empty">{t("proj16.noProjects")}</p>
          )}
          {projectsQ.isSuccess && projects.length > 0 && (
            <div className="kanban-projects">
              <div className="field" style={{ minWidth: "16rem" }}>
                <label htmlFor="proj-select">{t("proj16.project")}</label>
                <select
                  id="proj-select"
                  value={projectId ?? ""}
                  onChange={(e) => setProjectId(e.target.value || null)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {l10n(locale, p.title) || p.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              {project && (
                <div className="kanban-project-actions">
                  <Badge tone="neutral">{t(`proj16.projectStatus_${project.status}`)}</Badge>
                  {canManage && (
                    <>
                      <Button variant="ghost" onClick={() => setProjectModal(project)}>
                        {t("common.edit")}
                      </Button>
                      {!confirmDelete ? (
                        <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                          {t("common.delete")}
                        </Button>
                      ) : (
                        <>
                          <span className="hint">{t("proj16.confirmDeleteProject")}</span>
                          <Button
                            variant="ghost"
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleteProjectMut.isPending}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            variant="primary"
                            loading={deleteProjectMut.isPending}
                            disabled={deleteProjectMut.isPending}
                            onClick={() =>
                              deleteProjectMut.mutate(project.id, {
                                onSuccess: () => {
                                  setProjectId(null);
                                  setConfirmDelete(false);
                                },
                              })
                            }
                          >
                            {t("proj16.confirmYes")}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* kanban board */}
      {projectId && (
        <div style={{ marginTop: "1rem" }}>
          {tasksQ.isLoading && <p className="empty">{t("common.loading")}</p>}
          {tasksQ.isError && (
            <p className="form-error" role="alert">
              {isForbidden(tasksQ.error) ? t("proj16.noPermission") : errText(tasksQ.error)}
            </p>
          )}
          {tasksQ.isSuccess && (
            <>
              {moveMut.isError && (
                <p className="form-error" role="alert">
                  {isForbidden(moveMut.error)
                    ? t("proj16.noPermission")
                    : `${t("proj16.moveFailed")}: ${errText(moveMut.error)}`}
                </p>
              )}
              <div className="kanban-board" dir={locale === "en" ? "ltr" : "rtl"}>
                {TASK_STATUSES.map((s) => (
                  <KanbanColumn
                    key={s}
                    status={s}
                    tasks={byStatus.get(s) ?? []}
                    staff={staff}
                    onOpenTask={(task) => setDrawer({ task, status: task.status })}
                    onDropTask={onDropTask}
                    onAdd={(status) => setDrawer({ task: null, status })}
                    canManage={canManage}
                    t={t}
                    locale={locale}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {projectModal && (
        <ProjectModal
          project={projectModal === "create" ? null : projectModal}
          onClose={() => setProjectModal(null)}
          t={t}
        />
      )}
      {drawer && projectId && (
        <TaskDrawer
          task={drawer.task}
          projectId={projectId}
          defaultStatus={drawer.status}
          staff={staff}
          onClose={() => setDrawer(null)}
          t={t}
          locale={locale}
        />
      )}
    </div>
  );
}
