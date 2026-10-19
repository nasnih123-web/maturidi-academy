import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import { EMPTY_L10N, type CmsBlock, type LocalizedText } from "../lib/contentApi";
import { useI18n, type Locale } from "../lib/i18n";
import { BLOCK_DEFS } from "../lib/blockRegistry";
import LocalizedInput from "../components/LocalizedInput";
import {
  COURSE_LEVELS,
  COURSE_VISIBILITIES,
  LMS_KEYS,
  errText,
  fetchUserProgress,
  useAllPrerequisitesQuery,
  useCohortEnrollmentsQuery,
  useCohortsQuery,
  useCoursesQuery,
  useCertificatesQuery,
  useCurriculaQuery,
  useAddPrerequisite,
  useRemovePrerequisite,
  useCreateCohort,  useCreateCourse,
  useCreateCurriculum,
  useCreateLesson,
  useDeleteCohort,
  useDeleteCourse,
  useDeleteCurriculum,
  useDeleteLesson,
  useLessonsQuery,
  usePrerequisitesQuery,
  useUpdateCohort,
  useUpdateCourse,
  useUpdateCurriculum,
  useUpdateLesson,
  wouldCreateCycle,
  type Certificate,
  type Cohort,
  type CohortBody,
  type CohortEnrollment,
  type Course,
  type CourseBody,
  type Curriculum,
  type CurriculumBody,
  type Lesson,
  type LessonBody,
  type LessonProgressItem,
  type UserEnrollmentProgress,
} from "../lib/lms";

/**
 * LMS management center — Phase 8 (CRM track).
 *
 * Tabbed management over the Track 1 backend contract
 * (/api/v1/admin/lms/*): curricula & courses · lessons · cohorts ·
 * enrollments & progress · certificates · prerequisites.
 *
 * ADR-001: this page only renders. All parsing, defaults, and API access
 * live in ../lib/lms (including the client-side prerequisite cycle check).
 */

type LmsTab = "courses" | "lessons" | "cohorts" | "progress" | "certificates" | "prerequisites";
const TABS: LmsTab[] = ["courses", "lessons", "cohorts", "progress", "certificates", "prerequisites"];

const TAB_KEY: Record<LmsTab, string> = {
  courses: "lms.tabCourses",
  lessons: "lms.tabLessons",
  cohorts: "lms.tabCohorts",
  progress: "lms.tabProgress",
  certificates: "lms.tabCertificates",
  prerequisites: "lms.tabPrerequisites",
};

function initialTab(): LmsTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as string[]).includes(t)) return t as LmsTab;
  } catch {
    // ignore (SSR)
  }
  return "courses";
}

function l10n(locale: Locale, v: LocalizedText): string {
  return v[locale] || v.fa || v.en || v.ar || "";
}

/* ------------------------------------------------------------------ */
/* shared bits                                                          */
/* ------------------------------------------------------------------ */

function QueryState({
  isLoading,
  isError,
  error,
  empty,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  empty: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  if (isLoading) return <p className="hint">{t("common.loading")}</p>;
  if (isError)
    return (
      <p className="form-error" style={{ marginBottom: "1rem" }}>
        {t("lms.errorLoad")}: {errText(error)}
      </p>
    );
  if (empty) return <p className="hint">{t("lms.emptyNone")}</p>;
  return <>{children}</>;
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer slide-in" role="dialog" aria-modal="true" aria-label={title}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--x-gold2)" }}>{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
            {t("common.close")}
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function ActionsCell({
  onEdit,
  onDelete,
  deleting,
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <td style={{ whiteSpace: "nowrap" }}>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          {t("lms.edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={deleting}
          onClick={() => {
            if (window.confirm(t("lms.confirmDelete"))) onDelete();
          }}
        >
          {t("lms.delete")}
        </Button>
      </div>
    </td>
  );
}

/* ------------------------------------------------------------------ */
/* tab 1 — curricula & courses                                          */
/* ------------------------------------------------------------------ */

function CurriculumForm({
  initial,
  onSaved,
}: {
  initial: Curriculum | null;
  onSaved: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [title, setTitle] = React.useState<LocalizedText>(initial?.title ?? { ...EMPTY_L10N });
  const [description, setDescription] = React.useState<LocalizedText>(
    initial?.description ?? { ...EMPTY_L10N },
  );
  const [sortOrder, setSortOrder] = React.useState(String(initial?.sort_order ?? 0));
  const [isActive, setIsActive] = React.useState(initial?.is_active ?? true);
  const create = useCreateCurriculum();
  const update = useUpdateCurriculum();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  const save = (): void => {
    const body: CurriculumBody = {
      title,
      // Backend stores a plain string — send the fa text (adapter, §9.5).
      description: description.fa.trim() ? description.fa : null,
      sort_order: Number(sortOrder) || 0,
      is_active: isActive,
    };
    if (initial) update.mutate({ id: initial.id, body }, { onSuccess: onSaved });
    else create.mutate(body, { onSuccess: onSaved });
  };

  return (
    <>
      <LocalizedInput id="cur-title" label={t("lms.fieldTitle")} value={title} onChange={setTitle} />
      <LocalizedInput
        id="cur-desc"
        label={t("lms.fieldDescription")}
        value={description}
        onChange={setDescription}
        multiline
      />
      <Field label={t("lms.fieldSortOrder")}>
        <input
          className="input"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          dir="ltr"
        />
      </Field>
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("lms.fieldActive")}
        </label>
      </div>
      {err && <p className="form-error">{errText(err)}</p>}
      <Button disabled={pending} onClick={save}>
        {pending ? t("common.loading") : t("lms.save")}
      </Button>
    </>
  );
}

function CourseForm({
  initial,
  curricula,
  presetCurriculumId,
  onSaved,
}: {
  initial: Course | null;
  curricula: Curriculum[];
  presetCurriculumId: string | null;
  onSaved: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [title, setTitle] = React.useState<LocalizedText>(initial?.title ?? { ...EMPTY_L10N });
  const [description, setDescription] = React.useState<LocalizedText>(
    initial?.description ?? { ...EMPTY_L10N },
  );
  const [curriculumId, setCurriculumId] = React.useState<string | null>(
    initial ? initial.curriculum_id : presetCurriculumId,
  );
  const [level, setLevel] = React.useState(initial?.level ?? "beginner");
  const [visibility, setVisibility] = React.useState(initial?.visibility ?? "public");
  const [sortOrder, setSortOrder] = React.useState(String(initial?.sort_order ?? 0));
  const [isActive, setIsActive] = React.useState(initial?.is_active ?? true);
  const create = useCreateCourse();
  const update = useUpdateCourse();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  const save = (): void => {
    const body: CourseBody = {
      curriculum_id: curriculumId || null,
      title,
      description,
      level,
      visibility,
      sort_order: Number(sortOrder) || 0,
      is_active: isActive,
    };
    if (initial) update.mutate({ id: initial.id, body }, { onSuccess: onSaved });
    else create.mutate(body, { onSuccess: onSaved });
  };

  return (
    <>
      <LocalizedInput id="course-title" label={t("lms.fieldTitle")} value={title} onChange={setTitle} />
      <LocalizedInput
        id="course-desc"
        label={t("lms.fieldDescription")}
        value={description}
        onChange={setDescription}
        multiline
      />
      <Field label={t("lms.fieldCurriculum")}>
        <select
          className="input"
          value={curriculumId ?? ""}
          onChange={(e) => setCurriculumId(e.target.value || null)}
        >
          <option value="">{t("lms.noCurriculum")}</option>
          {curricula.map((c) => (
            <option key={c.id} value={c.id}>
              {l10n("fa", c.title) || c.id}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Field label={t("lms.fieldLevel")}>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value as Course["level"])}>
            {COURSE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`lms.level_${l}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("lms.fieldVisibility")}>
          <select
            className="input"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Course["visibility"])}
          >
            {COURSE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {t(`lms.vis_${v}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("lms.fieldSortOrder")}>
        <input
          className="input"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          dir="ltr"
        />
      </Field>
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("lms.fieldActive")}
        </label>
      </div>
      {err && <p className="form-error">{errText(err)}</p>}
      <Button disabled={pending} onClick={save}>
        {pending ? t("common.loading") : t("lms.save")}
      </Button>
    </>
  );
}

function CoursesTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const curQ = useCurriculaQuery();
  const courseQ = useCoursesQuery();
  const delCur = useDeleteCurriculum();
  const delCourse = useDeleteCourse();
  const [curriculumFilter, setCurriculumFilter] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState<
    | { kind: "curriculum"; item: Curriculum | null }
    | { kind: "course"; item: Course | null }
    | null
  >(null);

  const curricula = (curQ.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const courses = (courseQ.data ?? [])
    .filter((c) => (curriculumFilter ? c.curriculum_id === curriculumFilter : true))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.curriculaTitle")}</h2>
        <Button size="sm" onClick={() => setDrawer({ kind: "curriculum", item: null })}>
          {t("lms.newCurriculum")}
        </Button>
      </div>
      <QueryState
        isLoading={curQ.isLoading}
        isError={curQ.isError}
        error={curQ.error}
        empty={!curQ.isLoading && !curQ.isError && curricula.length === 0}
      >
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          <button
            type="button"
            className={`locale-tab${curriculumFilter === null ? " on" : ""}`}
            onClick={() => setCurriculumFilter(null)}
          >
            {t("lms.allCurricula")}
          </button>
          {curricula.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`locale-tab${curriculumFilter === c.id ? " on" : ""}`}
              onClick={() => setCurriculumFilter(c.id)}
              title={l10n(locale, c.description) || undefined}
            >
              {l10n(locale, c.title) || c.id}
              {!c.is_active && ` (${t("lms.inactive")})`}
            </button>
          ))}
        </div>
      </QueryState>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.coursesTitle")}</h2>
        <Button size="sm" onClick={() => setDrawer({ kind: "course", item: null })}>
          {t("lms.newCourse")}
        </Button>
      </div>
      <QueryState
        isLoading={courseQ.isLoading}
        isError={courseQ.isError}
        error={courseQ.error}
        empty={!courseQ.isLoading && !courseQ.isError && courses.length === 0}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("lms.tableTitle")}</th>
                <th>{t("lms.tableLevel")}</th>
                <th>{t("lms.tableVisibility")}</th>
                <th>{t("lms.tableStatus")}</th>
                <th>{t("lms.tableLessonCount")}</th>
                <th>{t("lms.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td dir="auto" style={{ maxWidth: "320px" }}>
                    <div style={{ fontWeight: 600 }}>{l10n(locale, c.title) || c.id}</div>
                    <div className="muted" style={{ fontSize: "0.8rem" }} dir="ltr">
                      {c.id}
                    </div>
                  </td>
                  <td>
                    <Badge tone="neutral">{t(`lms.level_${c.level}`)}</Badge>
                  </td>
                  <td>{t(`lms.vis_${c.visibility}`)}</td>
                  <td>
                    <Badge tone={c.is_active ? "success" : "neutral"}>
                      {c.is_active ? t("lms.active") : t("lms.inactive")}
                    </Badge>
                  </td>
                  <td dir="ltr">{c.lesson_count}</td>
                  <ActionsCell
                    onEdit={() => setDrawer({ kind: "course", item: c })}
                    onDelete={() => delCourse.mutate(c.id)}
                    deleting={delCourse.isPending}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      {drawer?.kind === "curriculum" && (
        <Drawer
          title={drawer.item ? t("lms.editCurriculum") : t("lms.newCurriculum")}
          onClose={() => setDrawer(null)}
        >
          <CurriculumForm initial={drawer.item} onSaved={() => setDrawer(null)} />
        </Drawer>
      )}
      {drawer?.kind === "course" && (
        <Drawer
          title={drawer.item ? t("lms.editCourse") : t("lms.newCourse")}
          onClose={() => setDrawer(null)}
        >
          <CourseForm
            initial={drawer.item}
            curricula={curQ.data ?? []}
            presetCurriculumId={curriculumFilter}
            onSaved={() => setDrawer(null)}
          />
        </Drawer>
      )}
      {!curQ.isLoading && !curQ.isError && curricula.length > 0 && (
        <Card style={{ marginTop: "1.5rem" }}>
          <CardHeader>
            <CardTitle>{t("lms.curriculaManageTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("lms.tableTitle")}</th>
                    <th>{t("lms.tableStatus")}</th>
                    <th>{t("lms.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {curricula.map((c) => (
                    <tr key={c.id}>
                      <td dir="auto">{l10n(locale, c.title) || c.id}</td>
                      <td>
                        <Badge tone={c.is_active ? "success" : "neutral"}>
                          {c.is_active ? t("lms.active") : t("lms.inactive")}
                        </Badge>
                      </td>
                      <ActionsCell
                        onEdit={() => setDrawer({ kind: "curriculum", item: c })}
                        onDelete={() => delCur.mutate(c.id)}
                        deleting={delCur.isPending}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab 2 — lessons (CMS block-shape content editor)                     */
/*                                                                     */
/* Lessons reuse the CMS block approach (Phase 4): every content unit  */
/* is a `{type, props}` block understood by the web renderer; the      */
/* block types come from the shared blockRegistry palette.             */
/* ------------------------------------------------------------------ */

function BlocksEditor({
  blocks,
  onChange,
}: {
  blocks: CmsBlock[];
  onChange: (b: CmsBlock[]) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [propsText, setPropsText] = React.useState<Record<number, string>>({});
  const [propsError, setPropsError] = React.useState<Record<number, string | null>>({});

  const textFor = (i: number): string =>
    propsText[i] ?? JSON.stringify(blocks[i]?.props ?? {}, null, 2);

  const commitProps = (i: number): void => {
    const raw = textFor(i);
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("object");
      }
      const next = blocks.slice();
      next[i] = { type: next[i].type, props: parsed as Record<string, unknown> };
      onChange(next);
      setPropsError((e) => ({ ...e, [i]: null }));
      setPropsText((p) => {
        const np = { ...p };
        delete np[i];
        return np;
      });
    } catch {
      setPropsError((e) => ({ ...e, [i]: t("lms.blockPropsInvalid") }));
    }
  };

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setPropsText({});
  };

  return (
    <div className="field">
      <label>{t("lms.blocksTitle")}</label>
      <p className="hint" style={{ fontSize: "0.82rem" }}>
        {t("lms.blocksHint")}
      </p>
      {blocks.length === 0 && <p className="hint">{t("lms.emptyBlocks")}</p>}
      {blocks.map((b, i) => (
        <Card key={i} style={{ marginBottom: "0.75rem" }}>
          <CardContent>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                marginBottom: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <span className="muted" dir="ltr" style={{ fontSize: "0.8rem" }}>
                #{i + 1}
              </span>
              <select
                className="input"
                value={b.type}
                onChange={(e) => {
                  const next = blocks.slice();
                  next[i] = { type: e.target.value, props: next[i].props };
                  onChange(next);
                }}
                style={{ width: "auto", flex: "1 1 160px" }}
                aria-label={t("lms.blockType")}
              >
                {BLOCK_DEFS.map((d) => (
                  <option key={d.type} value={d.type} dir="ltr">
                    {d.type}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => move(i, 1)}
                disabled={i === blocks.length - 1}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange(blocks.filter((_, k) => k !== i));
                  setPropsText({});
                }}
              >
                {t("lms.delete")}
              </Button>
            </div>
            <label className="muted" style={{ fontSize: "0.8rem" }}>
              {t("lms.blockProps")}
            </label>
            <textarea
              className="input"
              rows={4}
              dir="ltr"
              value={textFor(i)}
              onChange={(e) => setPropsText((p) => ({ ...p, [i]: e.target.value }))}
              onBlur={() => commitProps(i)}
              style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            {propsError[i] && <p className="form-error">{propsError[i]}</p>}
          </CardContent>
        </Card>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onChange([...blocks, { type: BLOCK_DEFS[0]?.type ?? "text", props: {} }])}
      >
        {t("lms.addBlock")}
      </Button>
    </div>
  );
}

function LessonForm({
  courseId,
  initial,
  onSaved,
}: {
  courseId: string;
  initial: Lesson | null;
  onSaved: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [title, setTitle] = React.useState<LocalizedText>(initial?.title ?? { ...EMPTY_L10N });
  const [blocks, setBlocks] = React.useState<CmsBlock[]>(initial?.body ?? []);
  const [duration, setDuration] = React.useState(
    initial ? String(initial.duration_minutes) : "",
  );
  const [sortOrder, setSortOrder] = React.useState(String(initial?.sort_order ?? 0));
  const [freePreview, setFreePreview] = React.useState(initial?.is_free_preview ?? false);
  const create = useCreateLesson();
  const update = useUpdateLesson();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  const save = (): void => {
    const body: LessonBody = {
      course_id: courseId,
      title,
      body: blocks,
      duration_minutes: Number(duration) || 0,
      sort_order: Number(sortOrder) || 0,
      is_free_preview: freePreview,
    };
    if (initial) {
      const { course_id: _omit, ...patch } = body;
      update.mutate({ id: initial.id, body: patch }, { onSuccess: onSaved });
    } else create.mutate(body, { onSuccess: onSaved });
  };

  return (
    <>
      <LocalizedInput id="lesson-title" label={t("lms.fieldTitle")} value={title} onChange={setTitle} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Field label={t("lms.fieldDurationMin")}>
          <input
            className="input"
            type="number"
            min={0}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            dir="ltr"
            placeholder={t("lms.durationPlaceholder")}
          />
        </Field>
        <Field label={t("lms.fieldSortOrder")}>
          <input
            className="input"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            dir="ltr"
          />
        </Field>
      </div>
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={freePreview}
            onChange={(e) => setFreePreview(e.target.checked)}
          />
          {t("lms.fieldFreePreview")}
        </label>
      </div>
      <BlocksEditor blocks={blocks} onChange={setBlocks} />
      {err && <p className="form-error">{errText(err)}</p>}
      <Button disabled={pending} onClick={save}>
        {pending ? t("common.loading") : t("lms.save")}
      </Button>
    </>
  );
}

function LessonsTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const courseQ = useCoursesQuery();
  const [courseId, setCourseId] = React.useState<string | null>(null);
  const lessonQ = useLessonsQuery(courseId);
  const delLesson = useDeleteLesson();
  const [drawer, setDrawer] = React.useState<{ item: Lesson | null } | null>(null);

  const courses = (courseQ.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const lessons = (lessonQ.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const activeCourse = courses.find((c) => c.id === courseId) ?? null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.lessonsTitle")}</h2>
        <select
          className="input"
          value={courseId ?? ""}
          onChange={(e) => setCourseId(e.target.value || null)}
          style={{ width: "auto", minWidth: "220px" }}
          aria-label={t("lms.fieldCourse")}
        >
          <option value="">{t("lms.pickCourse")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {l10n(locale, c.title) || c.id}
            </option>
          ))}
        </select>
        {courseId && (
          <Button size="sm" onClick={() => setDrawer({ item: null })}>
            {t("lms.newLesson")}
          </Button>
        )}
      </div>
      {!courseId && <p className="hint">{t("lms.pickCourseHint")}</p>}
      {courseId && (
        <QueryState
          isLoading={lessonQ.isLoading}
          isError={lessonQ.isError}
          error={lessonQ.error}
          empty={!lessonQ.isLoading && !lessonQ.isError && lessons.length === 0}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("lms.tableTitle")}</th>
                  <th>{t("lms.tableBlocks")}</th>
                  <th>{t("lms.fieldDurationMin")}</th>
                  <th>{t("lms.fieldFreePreview")}</th>
                  <th>{t("lms.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((l) => (
                  <tr key={l.id}>
                    <td dir="auto" style={{ maxWidth: "300px" }}>
                      <div style={{ fontWeight: 600 }}>{l10n(locale, l.title) || l.id}</div>
                      <div className="muted" style={{ fontSize: "0.8rem" }} dir="ltr">
                        {l.id}
                      </div>
                    </td>
                    <td dir="ltr">{l.body.length}</td>
                    <td dir="ltr">{l.duration_minutes}</td>
                    <td>
                      <Badge tone={l.is_free_preview ? "success" : "neutral"}>
                        {l.is_free_preview ? t("lms.yes") : t("lms.no")}
                      </Badge>
                    </td>
                    <ActionsCell
                      onEdit={() => setDrawer({ item: l })}
                      onDelete={() => delLesson.mutate(l.id)}
                      deleting={delLesson.isPending}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      )}
      {drawer && courseId && (
        <Drawer
          title={
            drawer.item
              ? t("lms.editLesson")
              : `${t("lms.newLesson")}${activeCourse ? ` — ${l10n(locale, activeCourse.title)}` : ""}`
          }
          onClose={() => setDrawer(null)}
        >
          <LessonForm courseId={courseId} initial={drawer.item} onSaved={() => setDrawer(null)} />
        </Drawer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab 3 — cohorts & enrollment lists                                   */
/* ------------------------------------------------------------------ */

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateInputToIso(v: string): string | null {
  if (!v.trim()) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function CohortForm({
  initial,
  courses,
  onSaved,
}: {
  initial: Cohort | null;
  courses: Course[];
  onSaved: () => void;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const [title, setTitle] = React.useState<LocalizedText>(initial?.title ?? { ...EMPTY_L10N });
  const [courseId, setCourseId] = React.useState(initial?.course_id ?? courses[0]?.id ?? "");
  const [startsAt, setStartsAt] = React.useState(toDateInput(initial?.starts_at ?? null));
  const [endsAt, setEndsAt] = React.useState(toDateInput(initial?.ends_at ?? null));
  const [maxSeats, setMaxSeats] = React.useState(initial ? String(initial.max_seats) : "");
  const [isOpen, setIsOpen] = React.useState(initial?.is_open ?? true);
  const [formError, setFormError] = React.useState<string | null>(null);
  const create = useCreateCohort();
  const update = useUpdateCohort();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  const save = (): void => {
    const startIso = dateInputToIso(startsAt);
    const endIso = dateInputToIso(endsAt);
    if (!startIso) {
      setFormError(t("lms.startRequired"));
      return;
    }
    if (!endIso) {
      setFormError(t("lms.endRequired"));
      return;
    }
    const seats = Number(maxSeats);
    if (!Number.isInteger(seats) || seats < 1) {
      setFormError(t("lms.seatsRequired"));
      return;
    }
    setFormError(null);
    const body: CohortBody = {
      course_id: courseId,
      title,
      starts_at: startIso,
      ends_at: endIso,
      max_seats: seats,
      is_open: isOpen,
    };
    if (initial) update.mutate({ id: initial.id, body }, { onSuccess: onSaved });
    else create.mutate(body, { onSuccess: onSaved });
  };

  return (
    <>
      <LocalizedInput id="cohort-title" label={t("lms.fieldTitle")} value={title} onChange={setTitle} />
      <Field label={t("lms.fieldCourse")}>
        <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {l10n(locale, c.title) || c.id}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Field label={t("lms.fieldStart")}>
          <input
            className="input"
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t("lms.fieldEnd")}>
          <input
            className="input"
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            dir="ltr"
          />
        </Field>
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <Field label={t("lms.fieldMaxSeats")}>
          <input
            className="input"
            type="number"
            min={1}
            value={maxSeats}
            onChange={(e) => setMaxSeats(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t("lms.fieldStatus")}>
          <select
            className="input"
            value={isOpen ? "open" : "closed"}
            onChange={(e) => setIsOpen(e.target.value === "open")}
          >
            <option value="open">{t("lms.statusOpen")}</option>
            <option value="closed">{t("lms.statusClosed")}</option>
          </select>
        </Field>
      </div>
      {err && <p className="form-error">{errText(err)}</p>}
      <Button disabled={pending || !courseId} onClick={save}>
        {pending ? t("common.loading") : t("lms.save")}
      </Button>
    </>
  );
}

function EnrollmentList({ cohortId }: { cohortId: string }): React.ReactElement {
  const { t } = useI18n();
  const q = useCohortEnrollmentsQuery(cohortId);
  const enrollments = q.data ?? [];
  return (
    <QueryState
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error}
      empty={!q.isLoading && !q.isError && enrollments.length === 0}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("lms.tableUser")}</th>
              <th>{t("lms.tableEnrolledAt")}</th>
              <th>{t("lms.tableEnrollStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e: CohortEnrollment) => (
              <tr key={e.id}>
                <td dir="auto">
                  {e.user_display}
                  <div className="muted" style={{ fontSize: "0.8rem" }} dir="ltr">
                    {e.user_id}
                  </div>
                </td>
                <td>{e.enrolled_at ? new Date(e.enrolled_at).toLocaleDateString() : "—"}</td>
                <td>
                  <Badge tone={statusTone(e.status)}>{t(`lms.enroll_${e.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueryState>
  );
}

function CohortsTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const cohortQ = useCohortsQuery();
  const courseQ = useCoursesQuery();
  const delCohort = useDeleteCohort();
  const [drawer, setDrawer] = React.useState<{ item: Cohort | null } | null>(null);
  const [selectedCohortId, setSelectedCohortId] = React.useState<string | null>(null);

  const cohorts = (cohortQ.data ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const courses = courseQ.data ?? [];
  const courseTitle = (id: string): string => {
    const c = courses.find((x) => x.id === id);
    return c ? l10n(locale, c.title) || id : id;
  };
  const selected = cohorts.find((c) => c.id === selectedCohortId) ?? null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.cohortsTitle")}</h2>
        <Button size="sm" onClick={() => setDrawer({ item: null })} disabled={courses.length === 0}>
          {t("lms.newCohort")}
        </Button>
      </div>
      <QueryState
        isLoading={cohortQ.isLoading}
        isError={cohortQ.isError}
        error={cohortQ.error}
        empty={!cohortQ.isLoading && !cohortQ.isError && cohorts.length === 0}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("lms.tableTitle")}</th>
                <th>{t("lms.fieldCourse")}</th>
                <th>{t("lms.fieldStart")}</th>
                <th>{t("lms.fieldEnd")}</th>
                <th>{t("lms.fieldMaxSeats")}</th>
                <th>{t("lms.fieldStatus")}</th>
                <th>{t("lms.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedCohortId(c.id)}
                  style={{ cursor: "pointer", background: selectedCohortId === c.id ? "var(--x-rowhl)" : undefined }}
                >
                  <td dir="auto">{l10n(locale, c.title) || c.id}</td>
                  <td dir="auto">{courseTitle(c.course_id)}</td>
                  <td>{c.starts_at ? new Date(c.starts_at).toLocaleDateString(locale) : "—"}</td>
                  <td>{c.ends_at ? new Date(c.ends_at).toLocaleDateString(locale) : "—"}</td>
                  <td dir="ltr">
                    {c.enrolled_count}/{c.max_seats}
                  </td>
                  <td>
                    <Badge tone={c.is_open ? "success" : "neutral"}>
                      {t(c.is_open ? "lms.statusOpen" : "lms.statusClosed")}
                    </Badge>
                  </td>
                  <ActionsCell
                    onEdit={() => setDrawer({ item: c })}
                    onDelete={() => delCohort.mutate(c.id)}
                    deleting={delCohort.isPending}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <Card style={{ marginTop: "1.5rem" }}>
        <CardHeader>
          <CardTitle>{t("lms.enrollmentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="hint">{t("lms.pickCohortHint")}</p>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: "0.75rem" }}>
                <span dir="auto">{l10n(locale, selected.title)}</span>
                {" · "}
                <span dir="ltr">{selected.id}</span>
              </p>
              <EnrollmentList cohortId={selected.id} />
            </>
          )}
        </CardContent>
      </Card>

      {drawer && (
        <Drawer
          title={drawer.item ? t("lms.editCohort") : t("lms.newCohort")}
          onClose={() => setDrawer(null)}
        >
          <CohortForm initial={drawer.item} courses={courses} onSaved={() => setDrawer(null)} />
        </Drawer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab 4 — enrollments & progress (per-user oversight)                  */
/* ------------------------------------------------------------------ */

function ProgressBar({ pct }: { pct: number }): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      style={{
        height: "8px",
        borderRadius: "4px",
        background: "var(--x-track)",
        overflow: "hidden",
        minWidth: "120px",
      }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{
          height: "100%",
          width: `${clamped}%`,
          background: "linear-gradient(90deg, var(--x-gold), var(--x-gold2))",
        }}
      />
    </div>
  );
}

function EnrollmentProgressCard({ enrollment }: { enrollment: UserEnrollmentProgress }): React.ReactElement {
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  return (
    <Card style={{ marginBottom: "0.75rem" }}>
      <CardContent>
        <div
          style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}
        >
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ fontWeight: 600 }} dir="auto">
              {l10n(locale, enrollment.course_title) || enrollment.course_id}
            </div>
            <div className="muted" style={{ fontSize: "0.8rem" }} dir="ltr">
              {enrollment.course_id}
            </div>
          </div>
          <ProgressBar pct={enrollment.progress_pct} />
          <span dir="ltr" style={{ fontSize: "0.85rem", color: "var(--x-gold2)", fontWeight: 600 }}>
            {enrollment.progress_pct}%
          </span>
          <span className="muted" style={{ fontSize: "0.85rem" }} dir="ltr">
            {enrollment.completed_lessons}/{enrollment.total_lessons}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)}>
            {open ? t("lms.hideLessons") : t("lms.showLessons")}
          </Button>
        </div>
        {open && (
          <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("lms.tableLesson")}</th>
                  <th>{t("lms.tableDone")}</th>
                  <th>{t("lms.completedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {enrollment.lessons.map((l: LessonProgressItem) => (
                  <tr key={l.lesson_id}>
                    <td dir="auto">{l10n(locale, l.lesson_title) || l.lesson_id}</td>
                    <td>
                      <Badge tone={l.completed ? "success" : "neutral"}>
                        {l.completed ? t("lms.done") : t("lms.notDone")}
                      </Badge>
                    </td>
                    <td>{l.completed_at ? new Date(l.completed_at).toLocaleDateString(locale) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProgressTab(): React.ReactElement {
  const { t } = useI18n();
  const [input, setInput] = React.useState("");
  const [submitted, setSubmitted] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: LMS_KEYS.userProgress(submitted ?? ""),
    queryFn: () => fetchUserProgress(submitted as string),
    enabled: !!submitted,
    retry: false,
  });
  const enrollments = q.data ?? [];

  const search = (): void => {
    const v = input.trim();
    if (v) setSubmitted(v);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.progressTitle")}</h2>
      </div>
      <p className="hint" style={{ marginBottom: "1rem" }}>
        {t("lms.progressHint")}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder={t("lms.userIdPlaceholder")}
          dir="ltr"
          style={{ maxWidth: "340px" }}
          aria-label={t("lms.fieldUserId")}
        />
        <Button onClick={search} disabled={!input.trim()}>
          {t("lms.searchUser")}
        </Button>
      </div>
      {submitted && (
        <QueryState
          isLoading={q.isLoading}
          isError={q.isError}
          error={q.error}
          empty={!q.isLoading && !q.isError && enrollments.length === 0}
        >
          {enrollments.map((e) => (
            <EnrollmentProgressCard key={e.course_id} enrollment={e} />
          ))}
        </QueryState>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab 5 — certificates                                                */
/* ------------------------------------------------------------------ */

function CertificatesTab(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const q = useCertificatesQuery();
  const certs = q.data ?? [];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.certsTitle")}</h2>
      </div>
      <p className="hint" style={{ marginBottom: "1rem" }}>
        {t("lms.certsHint")}
      </p>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        empty={!q.isLoading && !q.isError && certs.length === 0}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("lms.tableCode")}</th>
                <th>{t("lms.tableCertUser")}</th>
                <th>{t("lms.tableCertCourse")}</th>
                <th>{t("lms.tableIssued")}</th>
                <th>{t("lms.tableVerify")}</th>
              </tr>
            </thead>
            <tbody>
              {certs.map((c: Certificate) => (
                <tr key={c.id}>
                  <td dir="ltr">
                    <code>{c.code}</code>
                  </td>
                  <td dir="auto">
                    {c.user_display}
                    <div className="muted" style={{ fontSize: "0.8rem" }} dir="ltr">
                      {c.user_id}
                    </div>
                  </td>
                  <td dir="auto">{l10n(locale, c.course_title) || c.course_id}</td>
                  <td>{c.issued_at ? formatDate(c.issued_at) : "—"}</td>
                  <td>
                    <a
                      href={c.verify_url}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      style={{ color: "var(--x-gold2)", fontSize: "0.85rem" }}
                    >
                      {t("lms.openVerify")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab 6 — prerequisites (graph editor with cycle prevention)          */
/* ------------------------------------------------------------------ */

function PrerequisitesTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const courseQ = useCoursesQuery();
  const allEdgesQ = useAllPrerequisitesQuery();
  const [courseId, setCourseId] = React.useState<string | null>(null);
  const prereqQ = usePrerequisitesQuery(courseId);
  const addEdge = useAddPrerequisite();
  const removeEdge = useRemovePrerequisite();
  const [opError, setOpError] = React.useState<string | null>(null);
  const [addId, setAddId] = React.useState("");

  const courses = (courseQ.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const courseName = (id: string): string => {
    const c = courses.find((x) => x.id === id);
    return c ? l10n(locale, c.title) || id : id;
  };
  const edges = prereqQ.data ?? [];
  const allEdges = allEdgesQ.data ?? [];
  const existing = new Set(edges.map((e) => e.requires_course_id));
  const candidates = courses.filter((c) => c.id !== courseId && !existing.has(c.id));
  const mutating = addEdge.isPending || removeEdge.isPending;

  const add = (): void => {
    if (!courseId || !addId) return;
    if (wouldCreateCycle(allEdges, courseId, addId)) {
      setOpError(t("lms.cycleRefused"));
      return;
    }
    setOpError(null);
    setAddId("");
    addEdge.mutate(
      { courseId, requiresId: addId },
      { onError: (e) => setOpError(errText(e)) },
    );
  };

  const remove = (requiresId: string): void => {
    if (!courseId) return;
    setOpError(null);
    removeEdge.mutate(
      { courseId, requiresId },
      { onError: (e) => setOpError(errText(e)) },
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>{t("lms.prereqTitle")}</h2>
        <select
          className="input"
          value={courseId ?? ""}
          onChange={(e) => {
            setCourseId(e.target.value || null);
            setOpError(null);
            setAddId("");
          }}
          style={{ width: "auto", minWidth: "240px" }}
          aria-label={t("lms.fieldCourse")}
        >
          <option value="">{t("lms.pickPrereqCourse")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {courseName(c.id)}
            </option>
          ))}
        </select>
      </div>
      <p className="hint" style={{ marginBottom: "0.5rem" }}>
        {t("lms.prereqHint")}
      </p>
      <p className="hint" style={{ marginBottom: "1rem", color: "var(--x-gold2)" }}>
        {t("lms.cycleNotice")}
      </p>
      {!courseId && <p className="hint">{t("lms.pickCourseHint")}</p>}
      {courseId && (
        <QueryState
          isLoading={prereqQ.isLoading}
          isError={prereqQ.isError}
          error={prereqQ.error}
          empty={!prereqQ.isLoading && !prereqQ.isError && edges.length === 0}
        >
          <div className="table-wrap" style={{ marginBottom: "1rem" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("lms.tablePrereq")}</th>
                  <th>{t("lms.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr key={e.requires_course_id}>
                    <td dir="auto">
                      {courseName(e.requires_course_id)}
                      <div className="muted" style={{ fontSize: "0.8rem" }} dir="ltr">
                        {e.requires_course_id}
                      </div>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={mutating}
                        onClick={() => {
                          if (window.confirm(t("lms.confirmDelete"))) remove(e.requires_course_id);
                        }}
                      >
                        {t("lms.delete")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <select
              className="input"
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              style={{ width: "auto", minWidth: "240px" }}
              aria-label={t("lms.addPrereq")}
            >
              <option value="">{t("lms.pickAddPrereq")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {courseName(c.id)}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!addId || mutating} onClick={add}>
              {mutating ? t("common.loading") : t("lms.addPrereq")}
            </Button>
          </div>
        </QueryState>
      )}
      {opError && (
        <p className="form-error" style={{ marginTop: "0.75rem" }}>
          {opError}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page shell                                                          */
/* ------------------------------------------------------------------ */

export default function LMS(): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<LmsTab>(initialTab);

  // Deep-link support: ?tab=… (mirrors Fatwa.tsx)
  React.useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("tab");
      if (l && (TABS as string[]).includes(l)) setTab(l as LmsTab);
    } catch {
      // ignore (SSR)
    }
  }, []);

  return (
    <div className="page" style={{ maxWidth: "1280px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>{t("lms.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("lms.hint")}
      </p>

      <div className="locale-tabs" role="tablist" aria-label={t("lms.title")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`locale-tab${tab === tb ? " on" : ""}`}
            onClick={() => setTab(tb)}
          >
            {t(TAB_KEY[tb])}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "courses" && <CoursesTab />}
        {tab === "lessons" && <LessonsTab />}
        {tab === "cohorts" && <CohortsTab />}
        {tab === "progress" && <ProgressTab />}
        {tab === "certificates" && <CertificatesTab />}
        {tab === "prerequisites" && <PrerequisitesTab />}
      </div>
    </div>
  );
}
