/**
 * Phase 14 — Content Control Center (Track 2: CRM frontend).
 *
 * The single «محتوا» inbox for every registered domain adapter (§9.5,
 * ADR-0011): global table with filters, per-item detail with 11 tabs,
 * placement manager, distribution manager, bulk actions, publication
 * calendar, preview/compare, AI source center, trusted external sources,
 * Telegram center, and the Phase-9 Media Manager embedded as the Media tab.
 *
 * ADR-001/0002: this file is presentational. All data logic lives in
 * lib/admin14.ts and the hooks in lib/admin14Hooks.ts. Workflow rules come
 * from lib/contentApi (the §9 state machine) — never re-declared here.
 */

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import {
  AI_SCOPES,
  BULK_ACTIONS,
  CONTENT_DOMAINS,
  CONTENT_SOURCES,
  DISTRIBUTION_CHANNELS,
  EMPTY_DISTRIBUTION,
  PLACEMENT_SURFACES,
  type AiScope,
  type BulkAction,
  type BulkResult,
  type CalendarEntry,
  type ContentDetail,
  type ContentInboxItem,
  type ContentRef,
  type DistributionChannel,
  type DistributionPolicy,
  type InboxFilters,
  type Placement,
  type PlacementInput,
  type TelegramPolicy,
  type WorkflowStatus,
} from "../lib/admin14";
import {
  admin14Keys,
  useAiSources,
  useCompare,
  useContentAudit,
  useContentCalendar,
  useContentDetail,
  useContentMutation,
  useDistribution,
  useExternalSourceMutation,
  useExternalSources,
  useInbox,
  useItemPlacements,
  usePlacementMutation,
  usePlacements,
  useReindexSource,
  useTelegramDedupe,
  useTelegramHistory,
  useTelegramMutation,
  useTelegramPolicies,
  useTelegramQueue,
  useTelegramSchedule,
  useVersions,
  type ItemRef,
} from "../lib/admin14Hooks";
import { WORKFLOW_ORDER, WORKFLOW_TRANSITIONS } from "../lib/contentApi";
import { errText } from "../lib/admin14";
import MediaManager from "./MediaManager";
import Telegram from "./Telegram";

/* ------------------------------------------------------------------ */
/* small presentational helpers (no business logic)                     */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: WorkflowStatus }): React.ReactElement {
  const { t } = useI18n();
  const key =
    status === "draft" ? "statusDraft"
    : status === "in_review" ? "statusInReview"
    : status === "approved" ? "statusApproved"
    : status === "published" ? "statusPublished"
    : status === "rejected" ? "statusRejected"
    : "statusArchived";
  const tone =
    status === "published" ? "ok"
    : status === "rejected" ? "bad"
    : status === "in_review" ? "warn"
    : status === "approved" ? "info"
    : "muted";
  return <span className={`badge tone-${tone}`}>{t(`admin14.${key}`)}</span>;
}

function TypeLabel({ domain, contentType }: { domain: string; contentType: string }): React.ReactElement {
  const { t } = useI18n();
  const typeKey = `admin14.type_${contentType}`;
  const domKey = `admin14.dom_${domain}`;
  const typeLabel = t(typeKey) === typeKey ? contentType : t(typeKey);
  const domLabel = t(domKey) === domKey ? domain : t(domKey);
  return (
    <span className="hint">
      {domLabel} · {typeLabel}
    </span>
  );
}

function refKey(r: Pick<ContentRef, "domain" | "content_type" | "id">): string {
  return `${r.domain}/${r.content_type}/${r.id}`;
}

function Loading(): React.ReactElement {
  const { t } = useI18n();
  return <div className="hint">{t("common.loading")}</div>;
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="panel" role="alert">
      <p>{t("admin14.backendMissing")}</p>
      <p className="hint">{errText(error)}</p>
      <button type="button" className="btn" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* inbox                                                               */
/* ------------------------------------------------------------------ */

const EMPTY_FILTERS: InboxFilters = {};

function InboxTab({ onOpen }: { onOpen: (ref: ItemRef) => void }): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { hasPermission } = useAuth();
  const [draft, setDraft] = React.useState<InboxFilters>({});
  const [filters, setFilters] = React.useState<InboxFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);

  const query = useInbox(filters);
  const items = query.data?.items ?? [];

  const toggle = (k: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectedRefs: ContentRef[] = React.useMemo(
    () =>
      items
        .filter((i) => selected.has(refKey(i)))
        .map((i) => ({ domain: i.domain, content_type: i.content_type, id: i.id })),
    [items, selected],
  );

  const typeOptions = CONTENT_SOURCES.filter((s) => !draft.domain || s.domain === draft.domain);

  return (
    <div>
      <section className="panel" aria-label={t("admin14.search")}>
        <div className="form-grid">
          <label>
            {t("admin14.search")}
            <input
              type="search"
              value={draft.q ?? ""}
              placeholder={t("admin14.searchPh")}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            {t("admin14.fDomain")}
            <select
              value={draft.domain ?? ""}
              onChange={(e) => setDraft({ ...draft, domain: e.target.value || undefined, content_type: undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              {CONTENT_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {t(`admin14.dom_${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.fType")}
            <select
              value={draft.content_type ?? ""}
              onChange={(e) => setDraft({ ...draft, content_type: e.target.value || undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              {typeOptions.map((s) => (
                <option key={`${s.domain}/${s.content_type}`} value={s.content_type}>
                  {t(`admin14.type_${s.content_type}`) === `admin14.type_${s.content_type}`
                    ? s.content_type
                    : t(`admin14.type_${s.content_type}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.fStatus")}
            <select
              value={draft.status ?? ""}
              onChange={(e) => setDraft({ ...draft, status: e.target.value || undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              {(Object.keys(WORKFLOW_TRANSITIONS) as WorkflowStatus[]).map((s) => (
                <option key={s} value={s}>
                  {t(`admin14.status${s[0].toUpperCase()}${s.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.fAuthor")}
            <input
              value={draft.author_id ?? ""}
              placeholder="author id"
              onChange={(e) => setDraft({ ...draft, author_id: e.target.value || undefined })}
            />
          </label>
          <label>
            {t("admin14.fVisibility")}
            <select
              value={draft.visibility ?? ""}
              onChange={(e) => setDraft({ ...draft, visibility: e.target.value || undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              <option value="public">public</option>
              <option value="scholars_only">scholars_only</option>
              <option value="private">private</option>
            </select>
          </label>
          <label>
            {t("admin14.fAiScope")}
            <select
              value={draft.ai_scope ?? ""}
              onChange={(e) => setDraft({ ...draft, ai_scope: e.target.value || undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              {AI_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin14.scope_${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.fChannel")}
            <select
              value={draft.channel ?? ""}
              onChange={(e) => setDraft({ ...draft, channel: e.target.value || undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              {DISTRIBUTION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`admin14.ch_${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.fPlacement")}
            <select
              value={draft.placement ?? ""}
              onChange={(e) => setDraft({ ...draft, placement: e.target.value || undefined })}
            >
              <option value="">{t("admin14.all")}</option>
              {PLACEMENT_SURFACES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin14.surf_${s.replace(/\./g, "_")}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.fDateFrom")}
            <input
              type="date"
              value={draft.date_from ?? ""}
              onChange={(e) => setDraft({ ...draft, date_from: e.target.value || undefined })}
            />
          </label>
          <label>
            {t("admin14.fDateTo")}
            <input
              type="date"
              value={draft.date_to ?? ""}
              onChange={(e) => setDraft({ ...draft, date_to: e.target.value || undefined })}
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setCursorStack([]);
              setFilters({ ...draft, cursor: undefined });
              setSelected(new Set());
            }}
          >
            {t("admin14.applyFilters")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft({});
              setFilters(EMPTY_FILTERS);
              setCursorStack([]);
              setSelected(new Set());
            }}
          >
            {t("admin14.clearFilters")}
          </button>
        </div>
      </section>

      <BulkBar
        selectedRefs={selectedRefs}
        canBulk={hasPermission("content.bulk")}
        onDone={() => {
          setSelected(new Set());
          void query.refetch();
        }}
      />

      <section className="panel" aria-label={t("admin14.inboxTitle")}>
        {query.isLoading && <Loading />}
        {query.isError && <LoadError error={query.error} onRetry={() => void query.refetch()} />}
        {query.isSuccess && items.length === 0 && <p className="hint">{t("admin14.emptyInbox")}</p>}
        {items.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label={t("admin14.selectAll")}
                        checked={items.every((i) => selected.has(refKey(i)))}
                        onChange={(e) => {
                          if (e.target.checked) setSelected(new Set(items.map(refKey)));
                          else setSelected(new Set());
                        }}
                      />
                    </th>
                    <th>{t("admin14.colTitle")}</th>
                    <th>{t("admin14.colType")}</th>
                    <th>{t("admin14.colStatus")}</th>
                    <th>{t("admin14.colAuthor")}</th>
                    <th>{t("admin14.colUpdated")}</th>
                    <th>{t("admin14.colScheduled")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <InboxRow key={refKey(item)} item={item} checked={selected.has(refKey(item))} onToggle={toggle} onOpen={onOpen} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <span className="hint">
                {query.data?.total ?? 0} · v{formatDate(new Date().toISOString())}
              </span>
              {query.data?.next_cursor && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setCursorStack([...cursorStack, query.data?.next_cursor ?? ""]);
                    setFilters({ ...filters, cursor: query.data?.next_cursor ?? undefined });
                  }}
                >
                  →
                </button>
              )}
              {cursorStack.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const next = cursorStack.slice(0, -1);
                    setCursorStack(next);
                    setFilters({ ...filters, cursor: next[next.length - 1] });
                  }}
                >
                  ←
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function InboxRow({
  item,
  checked,
  onToggle,
  onOpen,
}: {
  item: ContentInboxItem;
  checked: boolean;
  onToggle: (k: string) => void;
  onOpen: (ref: ItemRef) => void;
}): React.ReactElement {
  const { formatDate } = useI18n();
  const k = refKey(item);
  return (
    <tr className={checked ? "selected" : undefined}>
      <td>
        <input type="checkbox" checked={checked} onChange={() => onToggle(k)} aria-label={item.title} />
      </td>
      <td>
        <button type="button" className="link" onClick={() => onOpen({ domain: item.domain, content_type: item.content_type, id: item.id })}>
          {item.title}
        </button>
        <div className="hint mono">v{item.version_no}</div>
      </td>
      <td>
        <TypeLabel domain={item.domain} contentType={item.content_type} />
      </td>
      <td>
        <StatusBadge status={item.status} />
      </td>
      <td className="hint">{item.author_name || "—"}</td>
      <td className="hint">{item.updated_at ? formatDate(item.updated_at) : "—"}</td>
      <td className="hint">{item.published_at ? formatDate(item.published_at) : "—"}</td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* bulk actions                                                        */
/* ------------------------------------------------------------------ */

function BulkBar({
  selectedRefs,
  canBulk,
  onDone,
}: {
  selectedRefs: ContentRef[];
  canBulk: boolean;
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const mut = useContentMutation();
  const [action, setAction] = React.useState<BulkAction>("transition");
  const [toStatus, setToStatus] = React.useState<WorkflowStatus>("approved");
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<{ results: BulkResult[]; audit_id: string } | null>(null);

  if (selectedRefs.length === 0) return <></>;

  const run = (): void => {
    const payload: Record<string, unknown> =
      action === "transition" ? { to: toStatus } : {};
    mut.bulk.mutate(
      { action, refs: selectedRefs, payload },
      {
        onSuccess: (r) => {
          setResult(r);
          setConfirming(false);
          onDone();
        },
      },
    );
  };

  return (
    <section className="panel" aria-label={t("admin14.bulkTitle")}>
      <div className="row">
        <strong>
          {t("admin14.bulkTitle")} · {selectedRefs.length}
        </strong>
        <label>
          {t("admin14.bulkAction")}
          <select value={action} onChange={(e) => setAction(e.target.value as BulkAction)}>
            {BULK_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {action === "transition" && (
          <label>
            {t("admin14.bulkToStatus")}
            <select value={toStatus} onChange={(e) => setToStatus(e.target.value as WorkflowStatus)}>
              {(Object.keys(WORKFLOW_TRANSITIONS) as WorkflowStatus[]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn danger"
          disabled={!canBulk || mut.bulk.isPending}
          onClick={() => setConfirming(true)}
        >
          {t("admin14.bulkApply")}
        </button>
      </div>

      {confirming && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-label={t("admin14.confirmTitle")}>
            <h3>{t("admin14.confirmTitle")}</h3>
            <p>{t("admin14.confirmSensitive").replace("{n}", String(selectedRefs.length))}</p>
            <div className="row">
              <button type="button" className="btn danger" disabled={mut.bulk.isPending} onClick={run}>
                {t("admin14.bulkApply")}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {mut.bulk.isError && <p className="error-text">{errText(mut.bulk.error)}</p>}

      {result && (
        <div style={{ marginTop: "0.75rem" }}>
          <h4>{t("admin14.bulkResult")}</h4>
          <p className="hint">
            {t("admin14.bulkOk")}: {result.results.filter((r) => r.ok).length} · {t("admin14.bulkFail")}:{" "}
            {result.results.filter((r) => !r.ok).length} · {t("admin14.bulkAudit")}:{" "}
            <code>{result.audit_id || "—"}</code>
          </p>
          <ul className="compact-list">
            {result.results
              .filter((r) => !r.ok)
              .map((r) => (
                <li key={refKey(r)}>
                  <code>{refKey(r)}</code> — {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* detail view                                                         */
/* ------------------------------------------------------------------ */

type DetailTab =
  | "preview" | "edit" | "workflow" | "versions" | "placements"
  | "related" | "ai" | "distribution" | "schedule" | "seo" | "audit";

const DETAIL_TABS: DetailTab[] = [
  "preview", "edit", "workflow", "versions", "placements",
  "related", "ai", "distribution", "schedule", "seo", "audit",
];

const EDITOR_FALLBACK: Record<string, string> = {
  content: "/content",
  fatwa: "/fatwa-submissions",
  library: "/media",
  lms: "/lms",
  social: "/moderation",
  places: "/places",
};

function DetailView({ itemRef, onBack, onOpen }: { itemRef: ItemRef; onBack: () => void; onOpen: (r: ItemRef) => void }): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<DetailTab>("preview");
  const detail = useContentDetail(itemRef);

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        <button type="button" className="btn" onClick={onBack}>
          ← {t("admin14.detailBack")}
        </button>
        {detail.data && (
          <>
            <h2 style={{ margin: 0 }}>{detail.data.title}</h2>
            <StatusBadge status={detail.data.status} />
            <TypeLabel domain={detail.data.domain} contentType={detail.data.content_type} />
          </>
        )}
      </div>

      {detail.isLoading && <Loading />}
      {detail.isError && <LoadError error={detail.error} onRetry={() => void detail.refetch()} />}

      {detail.data && (
        <>
          <nav className="tabs" aria-label={t("admin14.inboxTitle")}>
            {DETAIL_TABS.map((tb) => (
              <button
                key={tb}
                type="button"
                className={`tab${tab === tb ? " active" : ""}`}
                onClick={() => setTab(tb)}
              >
                {t(`admin14.tab${tb[0].toUpperCase()}${tb.slice(1)}`)}
              </button>
            ))}
          </nav>
          <DetailTabBody tab={tab} detail={detail.data} itemRef={itemRef} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

function DetailTabBody({
  tab, detail, itemRef, onOpen,
}: {
  tab: DetailTab;
  detail: ContentDetail;
  itemRef: ItemRef;
  onOpen: (r: ItemRef) => void;
}): React.ReactElement {
  switch (tab) {
    case "preview": return <PreviewTab detail={detail} itemRef={itemRef} />;
    case "edit": return <EditTab detail={detail} />;
    case "workflow": return <WorkflowTab detail={detail} itemRef={itemRef} />;
    case "versions": return <VersionsTab itemRef={itemRef} />;
    case "placements": return <ItemPlacementsTab itemRef={itemRef} />;
    case "related": return <RelatedTab detail={detail} onOpen={onOpen} />;
    case "ai": return <ItemAiTab detail={detail} />;
    case "distribution": return <DistributionTab itemRef={itemRef} />;
    case "schedule": return <ScheduleTab itemRef={itemRef} />;
    case "seo": return <SeoTab detail={detail} />;
    case "audit": return <ItemAuditTab itemRef={itemRef} />;
  }
}

/* ---- preview: current content + destination preview + approve/publish/reject ---- */

function PreviewTab({ detail, itemRef }: { detail: ContentDetail; itemRef: ItemRef }): React.ReactElement {
  const { t } = useI18n();
  const mut = useContentMutation();
  const [surface, setSurface] = React.useState<string>(PLACEMENT_SURFACES[0]);
  const [note, setNote] = React.useState("");

  const act = (to: WorkflowStatus): void => {
    mut.transition.mutate({ ref: itemRef, to, note: note || undefined });
  };

  return (
    <section className="panel">
      <div className="row">
        <label>
          {t("admin14.previewDest")}
          <select value={surface} onChange={(e) => setSurface(e.target.value)}>
            {PLACEMENT_SURFACES.map((s) => (
              <option key={s} value={s}>
                {t(`admin14.surf_${s.replace(/\./g, "_")}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          {t("admin14.versionNo").replace("{n}", String(detail.version_no))}
        </span>
      </div>

      {detail.preview_url ? (
        <iframe
          title={t("admin14.previewTitle")}
          src={detail.preview_url}
          className="preview-frame"
          sandbox="allow-same-origin"
        />
      ) : (
        <article className="preview-doc">
          <h3>{detail.title}</h3>
          <p>{detail.excerpt || "—"}</p>
        </article>
      )}

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("admin14.transitionNotePh")}
          aria-label={t("admin14.transitionNote")}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn primary" onClick={() => act("approved")} disabled={mut.transition.isPending}>
          {t("admin14.approveBtn")}
        </button>
        <button type="button" className="btn primary" onClick={() => act("published")} disabled={mut.transition.isPending}>
          {t("admin14.publishBtn")}
        </button>
        <button type="button" className="btn danger" onClick={() => act("rejected")} disabled={mut.transition.isPending}>
          {t("admin14.rejectBtn")}
        </button>
      </div>
      {mut.transition.isSuccess && <p className="ok-text">{t("admin14.transitionDone")}</p>}
      {mut.transition.isError && <p className="error-text">{errText(mut.transition.error)}</p>}
    </section>
  );
}

/* ---- edit: typed domain editor (never a generic JSON editor) ---- */

function EditTab({ detail }: { detail: ContentDetail }): React.ReactElement {
  const { t } = useI18n();
  const route = detail.editor_route && detail.editor_route !== "/content" ? detail.editor_route : EDITOR_FALLBACK[detail.domain] ?? "/content";
  return (
    <section className="panel">
      <p>{t("admin14.editGoesTo")}</p>
      <p className="hint">
        {t("admin14.editLivesIn").replace("{name}", t(`admin14.dom_${detail.domain}`))}
        {detail.editor_note ? ` — ${detail.editor_note}` : ""}
      </p>
      <Link className="btn primary" to={route}>
        {t("admin14.openEditor")}
      </Link>
    </section>
  );
}

/* ---- workflow: §9 state machine, transitions via the domain's own fn ---- */

function WorkflowTab({ detail, itemRef }: { detail: ContentDetail; itemRef: ItemRef }): React.ReactElement {
  const { t } = useI18n();
  const mut = useContentMutation();
  const [note, setNote] = React.useState("");
  const allowed = WORKFLOW_TRANSITIONS[detail.status] ?? [];

  const labelFor = (s: WorkflowStatus): string =>
    s === "in_review" ? t("admin14.doSubmitReview")
    : s === "approved" ? t("admin14.doApprove")
    : s === "published" ? t("admin14.doPublish")
    : s === "rejected" ? t("admin14.doReject")
    : s === "archived" ? t("admin14.doArchive")
    : t("admin14.doDraft");

  return (
    <section className="panel">
      <ol className="workflow-track">
        {WORKFLOW_ORDER.map((s) => (
          <li key={s} className={s === detail.status ? "current" : WORKFLOW_ORDER.indexOf(s) < WORKFLOW_ORDER.indexOf(detail.status) ? "done" : ""}>
            <StatusBadge status={s} />
          </li>
        ))}
      </ol>
      <div className="row" style={{ marginTop: "0.75rem" }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("admin14.transitionNotePh")}
          aria-label={t("admin14.transitionNote")}
          style={{ flex: 1 }}
        />
      </div>
      <div className="row" style={{ marginTop: "0.5rem" }}>
        {allowed.length === 0 && <span className="hint">—</span>}
        {allowed.map((to) => (
          <button
            key={to}
            type="button"
            className={`btn${to === "published" || to === "approved" ? " primary" : to === "rejected" || to === "archived" ? " danger" : ""}`}
            disabled={mut.transition.isPending}
            onClick={() => mut.transition.mutate({ ref: itemRef, to, note: note || undefined })}
          >
            {labelFor(to)}
          </button>
        ))}
      </div>
      {mut.transition.isSuccess && <p className="ok-text">{t("admin14.transitionDone")}</p>}
      {mut.transition.isError && (
        <p className="error-text">
          {t("admin14.transitionFailed")} — {errText(mut.transition.error)}
        </p>
      )}
    </section>
  );
}

/* ---- versions: history + compare + rollback ---- */

function VersionsTab({ itemRef }: { itemRef: ItemRef }): React.ReactElement {
  const { t, formatDate } = useI18n();
  const mut = useContentMutation();
  const versions = useVersions(itemRef);
  const [compareId, setCompareId] = React.useState<string | null>(null);
  const compare = useCompare(itemRef, compareId);
  const [confirmRb, setConfirmRb] = React.useState<string | null>(null);

  if (versions.isLoading) return <Loading />;
  if (versions.isError) return <LoadError error={versions.error} onRetry={() => void versions.refetch()} />;

  return (
    <section className="panel">
      {(versions.data ?? []).length === 0 && <p className="hint">{t("admin14.noVersions")}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin14.versionNo").replace("{n}", "#")}</th>
              <th>{t("admin14.colStatus")}</th>
              <th>{t("admin14.auditActor")}</th>
              <th>{t("admin14.auditAt")}</th>
              <th>{t("admin14.flagNote")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(versions.data ?? []).map((v) => (
              <tr key={v.version_id}>
                <td className="mono">{v.version_no}</td>
                <td>
                  <StatusBadge status={v.status} />
                </td>
                <td className="hint">{v.changed_by || "—"}</td>
                <td className="hint">{v.changed_at ? formatDate(v.changed_at) : "—"}</td>
                <td className="hint">{v.note || "—"}</td>
                <td>
                  <div className="row">
                    <button type="button" className="btn" onClick={() => setCompareId(v.version_id)}>
                      {t("admin14.compareWith")}
                    </button>
                    <button type="button" className="btn danger" onClick={() => setConfirmRb(v.version_id)}>
                      {t("admin14.rollbackTo")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmRb && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-label={t("admin14.confirmTitle")}>
            <h3>{t("admin14.confirmTitle")}</h3>
            <div className="row">
              <button
                type="button"
                className="btn danger"
                disabled={mut.rollback.isPending}
                onClick={() =>
                  mut.rollback.mutate(
                    { ref: itemRef, versionId: confirmRb },
                    { onSuccess: () => setConfirmRb(null) },
                  )
                }
              >
                {t("admin14.rollbackTo")}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmRb(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {compareId && (
        <div style={{ marginTop: "1rem" }}>
          <h4>{t("admin14.compareTitle")}</h4>
          {compare.isLoading && <Loading />}
          {compare.isError && <LoadError error={compare.error} onRetry={() => void compare.refetch()} />}
          {compare.data && (
            <>
              <p className="hint">
                {t("admin14.currentVersion")}: {compare.data.base_title} · {t("admin14.compareWith")}: {compare.data.other_title}
              </p>
              {compare.data.diffs.length === 0 && <p className="hint">{t("admin14.compareEmpty")}</p>}
              {compare.data.diffs.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t("admin14.diffField")}</th>
                        <th>{t("admin14.diffBefore")}</th>
                        <th>{t("admin14.diffAfter")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.data.diffs.map((d, i) => (
                        <tr key={i}>
                          <td className="mono">{d.field}</td>
                          <td className="diff-before">{d.before}</td>
                          <td className="diff-after">{d.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ---- item placements ---- */

function ItemPlacementsTab({ itemRef }: { itemRef: ItemRef }): React.ReactElement {
  const { t } = useI18n();
  const list = useItemPlacements(itemRef);
  const mut = usePlacementMutation();
  const [form, setForm] = React.useState<PlacementInput>({ surface: PLACEMENT_SURFACES[0], priority: 0, locale: "fa" });

  if (list.isLoading) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <section className="panel">
      {(list.data ?? []).length === 0 && <p className="hint">{t("admin14.plcEmpty")}</p>}
      <ul className="compact-list">
        {(list.data ?? []).map((p) => (
          <li key={p.id}>
            <strong>{t(`admin14.surf_${p.surface.replace(/\./g, "_")}`) === `admin14.surf_${p.surface.replace(/\./g, "_")}` ? p.surface : t(`admin14.surf_${p.surface.replace(/\./g, "_")}`)}</strong>
            {p.slot ? ` / ${p.slot}` : ""} · {t("admin14.plcPriority")}: {p.priority} ·{" "}
            {p.enabled ? t("admin14.plcEnabled") : t("admin14.extDisabled")}
            <button
              type="button"
              className="btn danger"
              style={{ marginInlineStart: "0.5rem" }}
              onClick={() => mut.remove.mutate(p.id)}
            >
              {t("common.delete")}
            </button>
          </li>
        ))}
      </ul>

      <h4 style={{ marginTop: "1rem" }}>{t("admin14.plcAdd")}</h4>
      <div className="form-grid">
        <label>
          {t("admin14.plcSurface")}
          <select value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })}>
            {PLACEMENT_SURFACES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("admin14.plcSlot")}
          <input value={form.slot ?? ""} onChange={(e) => setForm({ ...form, slot: e.target.value || undefined })} />
        </label>
        <label>
          {t("admin14.plcPriority")}
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
          />
        </label>
        <label>
          {t("admin14.plcLocale")}
          <select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
            <option value="fa">fa</option>
            <option value="ar">ar</option>
            <option value="en">en</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        className="btn primary"
        style={{ marginTop: "0.5rem" }}
        disabled={mut.create.isPending}
        onClick={() => mut.create.mutate({ ref: itemRef, placement: form })}
      >
        {t("admin14.plcAdd")}
      </button>
      {mut.create.isError && <p className="error-text">{errText(mut.create.error)}</p>}
    </section>
  );
}

/* ---- related / ai / seo / audit ---- */

function RelatedTab({ detail, onOpen }: { detail: ContentDetail; onOpen: (r: ItemRef) => void }): React.ReactElement {
  const { t } = useI18n();
  if (detail.related.length === 0) return <p className="hint">{t("admin14.noRelated")}</p>;
  return (
    <section className="panel">
      <ul className="compact-list">
        {detail.related.map((r) => (
          <li key={refKey(r)}>
            <button type="button" className="link" onClick={() => onOpen(r)}>
              {detail.related_titles[refKey(r)] ?? r.id}
            </button>{" "}
            <TypeLabel domain={r.domain} contentType={r.content_type} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemAiTab({ detail }: { detail: ContentDetail }): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="panel">
      <p className="hint">{t("admin14.aiHint")}</p>
      <div className="row">
        {(detail.ai_scopes as AiScope[]).length === 0 && <span className="badge tone-muted">{t("admin14.scope_none")}</span>}
        {(detail.ai_scopes as AiScope[]).map((s) => (
          <span key={s} className="badge tone-info">
            {t(`admin14.scope_${s}`)}
          </span>
        ))}
      </div>
      {detail.native_distribution && (
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          native: {Object.entries(detail.native_distribution).map(([k, v]) => `${k}=${v ? "1" : "0"}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

function SeoTab({ detail }: { detail: ContentDetail }): React.ReactElement {
  const { t } = useI18n();
  const rows: [string, string][] = [
    [t("admin14.seoTitle"), detail.seo.title],
    [t("admin14.seoDesc"), detail.seo.description],
    [t("admin14.seoCanonical"), detail.seo.canonical],
    [t("admin14.seoSchema"), detail.seo.schema_type],
  ];
  return (
    <section className="panel">
      <dl className="def-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="hint">{t("admin14.editGoesTo")}</p>
    </section>
  );
}

function ItemAuditTab({ itemRef }: { itemRef: ItemRef }): React.ReactElement {
  const { t, formatDate } = useI18n();
  const audit = useContentAudit(itemRef);
  if (audit.isLoading) return <Loading />;
  if (audit.isError) return <LoadError error={audit.error} onRetry={() => void audit.refetch()} />;
  if ((audit.data ?? []).length === 0) return <p className="hint">{t("admin14.noAudit")}</p>;
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin14.auditAction")}</th>
              <th>{t("admin14.auditActor")}</th>
              <th>{t("admin14.auditAt")}</th>
              <th>{t("admin14.auditChanges")}</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.action}</td>
                <td className="hint">{a.actor_name}</td>
                <td className="hint">{a.created_at ? formatDate(a.created_at) : "—"}</td>
                <td className="hint mono small">
                  {a.new_values ? JSON.stringify(a.new_values).slice(0, 120) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---- distribution + schedule ---- */

function DistributionTab({ itemRef }: { itemRef: ItemRef }): React.ReactElement {
  const { t } = useI18n();
  const dist = useDistribution(itemRef);
  const mut = useContentMutation();
  const [policy, setPolicy] = React.useState<DistributionPolicy | null>(null);
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [untilAt, setUntilAt] = React.useState("");

  React.useEffect(() => {
    if (dist.data && policy === null) {
      setPolicy(dist.data.policy);
      setScheduledAt(dist.data.scheduled_at ?? "");
      setUntilAt(dist.data.until_at ?? "");
    }
  }, [dist.data, policy]);

  if (dist.isLoading) return <Loading />;
  if (dist.isError) return <LoadError error={dist.error} onRetry={() => void dist.refetch()} />;

  const p = policy ?? EMPTY_DISTRIBUTION;
  const toggle = (ch: DistributionChannel): void => setPolicy({ ...p, [ch]: !p[ch] });

  return (
    <section className="panel">
      <p className="hint">{t("admin14.distHint")}</p>
      <div className="channel-grid">
        {DISTRIBUTION_CHANNELS.map((ch) => (
          <label key={ch} className="switch-row">
            <input type="checkbox" checked={p[ch]} onChange={() => toggle(ch)} />
            {t(`admin14.ch_${ch}`)}
          </label>
        ))}
      </div>
      <div className="form-grid" style={{ marginTop: "0.75rem" }}>
        <label>
          {t("admin14.distScheduledAt")}
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
        <label>
          {t("admin14.distUntilAt")}
          <input type="datetime-local" value={untilAt} onChange={(e) => setUntilAt(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn primary"
        style={{ marginTop: "0.5rem" }}
        disabled={mut.distribution.isPending}
        onClick={() =>
          mut.distribution.mutate({
            ref: itemRef,
            policy: p,
            scheduledAt: scheduledAt || null,
            untilAt: untilAt || null,
          })
        }
      >
        {t("admin14.distSave")}
      </button>
      {mut.distribution.isSuccess && <p className="ok-text">{t("admin14.distSaved")}</p>}
      {mut.distribution.isError && <p className="error-text">{errText(mut.distribution.error)}</p>}
    </section>
  );
}

function ScheduleTab({ itemRef }: { itemRef: ItemRef }): React.ReactElement {
  const { t } = useI18n();
  const dist = useDistribution(itemRef);
  const mut = useContentMutation();
  const [at, setAt] = React.useState("");
  const [until, setUntil] = React.useState("");

  React.useEffect(() => {
    if (dist.data) {
      setAt(dist.data.scheduled_at ?? "");
      setUntil(dist.data.until_at ?? "");
    }
  }, [dist.data]);

  if (dist.isLoading) return <Loading />;
  if (dist.isError) return <LoadError error={dist.error} onRetry={() => void dist.refetch()} />;

  return (
    <section className="panel">
      <p className="hint">{t("admin14.schedHint")}</p>
      <div className="form-grid">
        <label>
          {t("admin14.schedAt")}
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <label>
          {t("admin14.schedUntil")}
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn primary"
        style={{ marginTop: "0.5rem" }}
        disabled={mut.distribution.isPending}
        onClick={() =>
          mut.distribution.mutate({
            ref: itemRef,
            policy: dist.data?.policy ?? EMPTY_DISTRIBUTION,
            scheduledAt: at || null,
            untilAt: until || null,
          })
        }
      >
        {t("admin14.schedSave")}
      </button>
      {mut.distribution.isSuccess && <p className="ok-text">{t("admin14.schedSaved")}</p>}
      {mut.distribution.isError && <p className="error-text">{errText(mut.distribution.error)}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* global placement manager                                             */
/* ------------------------------------------------------------------ */

function PlacementsTab(): React.ReactElement {
  const { t } = useI18n();
  const [surface, setSurface] = React.useState<string>("");
  const list = usePlacements(surface || undefined);
  const mut = usePlacementMutation();
  const [savedTick, setSavedTick] = React.useState(0);

  const move = (idx: number, dir: -1 | 1): void => {
    const arr = [...(list.data ?? [])].sort((a, b) => a.priority - b.priority);
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    mut.reorder.mutate(arr.map((p) => p.id), { onSuccess: () => setSavedTick((x) => x + 1) });
  };

  return (
    <div>
      <section className="panel">
        <p className="hint">{t("admin14.plcHint")}</p>
        <label>
          {t("admin14.plcSurface")}
          <select value={surface} onChange={(e) => setSurface(e.target.value)}>
            <option value="">{t("admin14.plcAllSurfaces")}</option>
            {PLACEMENT_SURFACES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="panel">
        {list.isLoading && <Loading />}
        {list.isError && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && (list.data ?? []).length === 0 && <p className="hint">{t("admin14.plcEmpty")}</p>}
        {(list.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("admin14.plcPriority")}</th>
                  <th>{t("admin14.colTitle")}</th>
                  <th>{t("admin14.plcSurface")}</th>
                  <th>{t("admin14.plcSlot")}</th>
                  <th>{t("admin14.plcEnabled")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...(list.data ?? [])]
                  .sort((a, b) => a.priority - b.priority)
                  .map((p, idx, arr) => (
                    <PlacementRow key={p.id} p={p} idx={idx} total={arr.length} onMove={move} onDelete={(id) => mut.remove.mutate(id)} />
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {savedTick > 0 && <p className="ok-text">{t("admin14.plcReordered")}</p>}
      </section>
    </div>
  );
}

function PlacementRow({
  p, idx, total, onMove, onDelete,
}: {
  p: Placement; idx: number; total: number;
  onMove: (idx: number, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <tr>
      <td className="mono">{p.priority}</td>
      <td>{p.content_title}</td>
      <td className="mono">{p.surface}</td>
      <td className="hint">{p.slot ?? "—"}</td>
      <td>{p.enabled ? "✓" : "—"}</td>
      <td>
        <div className="row">
          <button type="button" className="btn" disabled={idx === 0} onClick={() => onMove(idx, -1)} aria-label={t("admin14.plcMoveUp")}>
            ↑
          </button>
          <button type="button" className="btn" disabled={idx === total - 1} onClick={() => onMove(idx, 1)} aria-label={t("admin14.plcMoveDown")}>
            ↓
          </button>
          <button type="button" className="btn danger" onClick={() => onDelete(p.id)}>
            {t("common.delete")}
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* content calendar                                                     */
/* ------------------------------------------------------------------ */

type CalView = "day" | "week" | "month";

function rangeFor(view: CalView, anchor: Date): { from: string; to: string } {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  const from = new Date(d);
  const to = new Date(d);
  if (view === "day") to.setDate(to.getDate() + 1);
  else if (view === "week") { from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to.setDate(from.getDate() + 7); }
  else { from.setDate(1); to.setMonth(to.getMonth() + 1); to.setDate(1); }
  return { from: from.toISOString(), to: to.toISOString() };
}

function CalendarTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [view, setView] = React.useState<CalView>("month");
  const [anchor, setAnchor] = React.useState(() => new Date());
  const { from, to } = React.useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const cal = useContentCalendar(from, to, true);

  const shift = (dir: 1 | -1): void => {
    const d = new Date(anchor);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };

  return (
    <div>
      <section className="panel">
        <div className="row">
          <div className="seg">
            {(["day", "week", "month"] as CalView[]).map((v) => (
              <button key={v} type="button" className={`tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
                {t(`admin14.cal${v[0].toUpperCase()}${v.slice(1)}`)}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => shift(-1)}>←</button>
          <button type="button" className="btn" onClick={() => setAnchor(new Date())}>{t("admin14.calToday")}</button>
          <button type="button" className="btn" onClick={() => shift(1)}>→</button>
        </div>
      </section>
      <section className="panel">
        {cal.isLoading && <Loading />}
        {cal.isError && <LoadError error={cal.error} onRetry={() => void cal.refetch()} />}
        {cal.isSuccess && (cal.data ?? []).length === 0 && <p className="hint">{t("admin14.calEmpty")}</p>}
        {(cal.data ?? []).length > 0 && (
          <ul className="compact-list">
            {(cal.data ?? []).map((e) => (
              <CalendarRow key={`${e.domain}/${e.content_type}/${e.id}`} entry={e} formatDate={formatDate} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CalendarRow({ entry, formatDate }: { entry: CalendarEntry; formatDate: (iso: string) => string }): React.ReactElement {
  const { t } = useI18n();
  const conflict = entry.conflict_with.length > 0;
  return (
    <li className={conflict ? "conflict" : undefined}>
      <StatusBadge status={entry.status} />{" "}
      <strong>{entry.title}</strong>{" "}
      <span className="hint mono">{entry.surface || "—"}</span>
      <div className="hint">
        {formatDate(entry.starts_at)}
        {entry.ends_at ? ` → ${formatDate(entry.ends_at)}` : ""} ·{" "}
        <TypeLabel domain={entry.domain} contentType={entry.content_type} />
      </div>
      {conflict && (
        <div className="conflict-note" role="alert">
          ⚠ {t("admin14.calConflict")} {t("admin14.calWith")}:{" "}
          {entry.conflict_with.map((c) => `${c.domain}/${c.content_type}/${c.id}`).join("، ")}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* AI source center                                                     */
/* ------------------------------------------------------------------ */

function AiSourcesTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [status, setStatus] = React.useState("");
  const [scope, setScope] = React.useState("");
  const list = useAiSources(status || undefined, scope || undefined);
  const reindex = useReindexSource();
  const [queued, setQueued] = React.useState<string | null>(null);

  return (
    <div>
      <section className="panel">
        <p className="hint">{t("admin14.aiHint")}</p>
        <div className="row">
          <label>
            {t("admin14.aiIngestion")}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("admin14.all")}</option>
              {["ok", "pending", "error", "stale"].map((s) => (
                <option key={s} value={s}>
                  {t(`admin14.ai${s[0].toUpperCase()}${s.slice(1)}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin14.aiScopes")}
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">{t("admin14.all")}</option>
              {AI_SCOPES.filter((s) => s !== "none").map((s) => (
                <option key={s} value={s}>
                  {t(`admin14.scope_${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="panel">
        {list.isLoading && <Loading />}
        {list.isError && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && (list.data ?? []).length === 0 && <p className="hint">{t("admin14.aiEmpty")}</p>}
        {(list.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("admin14.colTitle")}</th>
                  <th>{t("admin14.aiProvenance")}</th>
                  <th>{t("admin14.aiScopes")}</th>
                  <th>{t("admin14.aiIngestion")}</th>
                  <th>{t("admin14.aiLastEmbed")}</th>
                  <th>{t("admin14.aiChunks")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((s) => (
                  <tr key={refKey(s)}>
                    <td>
                      {s.title}
                      <div className="hint mono">{refKey(s)}</div>
                      {s.extraction_errors.length > 0 && (
                        <details>
                          <summary className="error-text">
                            {t("admin14.aiErrors")} ({s.extraction_errors.length})
                          </summary>
                          <ul className="compact-list">
                            {s.extraction_errors.map((e, i) => (
                              <li key={i} className="error-text">{e}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="hint">{s.provenance}</td>
                    <td>
                      {s.scopes.map((sc) => (
                        <span key={sc} className="badge tone-info">
                          {t(`admin14.scope_${sc}`)}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={`badge tone-${s.ingestion_status === "ok" ? "ok" : s.ingestion_status === "error" ? "bad" : "warn"}`}>
                        {t(`admin14.ai${s.ingestion_status[0].toUpperCase()}${s.ingestion_status.slice(1)}`)}
                      </span>
                    </td>
                    <td className="hint">{s.last_embedding_at ? formatDate(s.last_embedding_at) : "—"}</td>
                    <td className="mono">{s.embedding_chunks}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={reindex.isPending}
                        onClick={() =>
                          reindex.mutate(
                            { domain: s.domain, content_type: s.content_type, id: s.id },
                            { onSuccess: () => setQueued(refKey(s)) },
                          )
                        }
                      >
                        {t("admin14.aiReindex")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {queued && <p className="ok-text">{t("admin14.aiReindexQueued")}</p>}
        {reindex.isError && <p className="error-text">{errText(reindex.error)}</p>}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* external sources (§9.6 — writes are super_admin only)                */
/* ------------------------------------------------------------------ */

function ExternalSourcesTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { isSuperAdmin } = useAuth();
  const list = useExternalSources();
  const mut = useExternalSourceMutation();
  const [checkResult, setCheckResult] = React.useState<Record<string, string>>({});

  return (
    <div>
      <section className="panel">
        <p className="hint">{t("admin14.extHint")}</p>
      </section>
      <section className="panel">
        {list.isLoading && <Loading />}
        {list.isError && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && (list.data ?? []).length === 0 && <p className="hint">{t("admin14.extEmpty")}</p>}
        {(list.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("admin14.colTitle")}</th>
                  <th>{t("admin14.extDomain")}</th>
                  <th>{t("admin14.extEnabled")}</th>
                  <th>{t("admin14.extPolicy")}</th>
                  <th>{t("admin14.extPriority")}</th>
                  <th>{t("admin14.extLastChecked")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.name}
                      <div className="hint mono">{s.allowed_paths.join(", ") || "—"}</div>
                    </td>
                    <td className="mono">{s.domain}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        disabled={!isSuperAdmin || mut.update.isPending}
                        onChange={(e) => mut.update.mutate({ id: s.id, patch: { enabled: e.target.checked } })}
                        aria-label={s.name}
                      />
                    </td>
                    <td>
                      <select
                        value={s.policy}
                        disabled={!isSuperAdmin || mut.update.isPending}
                        onChange={(e) => mut.update.mutate({ id: s.id, patch: { policy: e.target.value } })}
                        aria-label={t("admin14.extPolicy")}
                      >
                        <option value="allowlist">allowlist</option>
                        <option value="disabled">disabled</option>
                        <option value="citation_only">citation_only</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={s.priority}
                        disabled={!isSuperAdmin || mut.update.isPending}
                        onChange={(e) => mut.update.mutate({ id: s.id, patch: { priority: Number(e.target.value) } })}
                        aria-label={t("admin14.extPriority")}
                        style={{ width: "4rem" }}
                      />
                    </td>
                    <td className="hint">{s.last_checked_at ? formatDate(s.last_checked_at) : "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={mut.check.isPending}
                        onClick={() =>
                          mut.check.mutate(s.id, {
                            onSuccess: (r) =>
                              setCheckResult({
                                ...checkResult,
                                [s.id]: r.ok ? t("admin14.extCheckOk") : `${t("admin14.extCheckFail")} — ${r.detail}`,
                              }),
                          })
                        }
                      >
                        {t("admin14.extCheck")}
                      </button>
                      {checkResult[s.id] && <div className="hint">{checkResult[s.id]}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mut.update.isError && <p className="error-text">{errText(mut.update.error)}</p>}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* telegram center                                                       */
/* ------------------------------------------------------------------ */

type TgTab = "policies" | "queue" | "schedule" | "history" | "dedupe" | "bot";

function TelegramCenterTab(): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<TgTab>("queue");
  return (
    <div>
      <section className="panel">
        <p className="hint">{t("admin14.tgHint")}</p>
        <nav className="tabs">
          {(["policies", "queue", "schedule", "history", "dedupe", "bot"] as TgTab[]).map((tb) => (
            <button key={tb} type="button" className={`tab${tab === tb ? " active" : ""}`} onClick={() => setTab(tb)}>
              {tb === "bot" ? t("nav.telegram") : t(`admin14.tab${tb[0].toUpperCase()}${tb.slice(1)}`)}
            </button>
          ))}
        </nav>
      </section>
      {tab === "policies" && <TgPoliciesTab />}
      {tab === "queue" && <TgQueueTab />}
      {tab === "schedule" && <TgScheduleTab />}
      {tab === "history" && <TgHistoryTab />}
      {tab === "dedupe" && <TgDedupeTab />}
      {tab === "bot" && <Telegram />}
    </div>
  );
}

function TgPoliciesTab(): React.ReactElement {
  const { t } = useI18n();
  const list = useTelegramPolicies();
  const mut = useTelegramMutation();
  const [edits, setEdits] = React.useState<Record<string, Partial<TelegramPolicy>>>({});

  const merged = (p: TelegramPolicy): TelegramPolicy => ({ ...p, ...(edits[`${p.domain}/${p.content_type}`] ?? {}) });

  if (list.isLoading) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  if ((list.data ?? []).length === 0) return <p className="hint">{t("admin14.tgEmpty")}</p>;

  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin14.colType")}</th>
              <th>policy</th>
              <th>{t("admin14.tgChannel")}</th>
              <th>{t("admin14.tgCaptionTpl")}</th>
              <th>{t("admin14.tgDedupeWindow")}</th>
              <th>{t("admin14.plcEnabled")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p0) => {
              const p = merged(p0);
              const k = `${p.domain}/${p.content_type}`;
              const set = (patch: Partial<TelegramPolicy>): void => setEdits({ ...edits, [k]: { ...(edits[k] ?? {}), ...patch } });
              return (
                <tr key={k}>
                  <td>
                    <TypeLabel domain={p.domain} contentType={p.content_type} />
                  </td>
                  <td>
                    <select value={p.policy} onChange={(e) => set({ policy: e.target.value as TelegramPolicy["policy"] })} aria-label="policy">
                      <option value="never">{t("admin14.tgNever")}</option>
                      <option value="manual_approval">{t("admin14.tgManual")}</option>
                      <option value="auto_publish">{t("admin14.tgAuto")}</option>
                      <option value="scheduled">{t("admin14.tgScheduled")}</option>
                    </select>
                  </td>
                  <td>
                    <input value={p.channel ?? ""} onChange={(e) => set({ channel: e.target.value || null })} aria-label={t("admin14.tgChannel")} />
                  </td>
                  <td>
                    <input
                      value={p.caption_template ?? ""}
                      onChange={(e) => set({ caption_template: e.target.value || null })}
                      aria-label={t("admin14.tgCaptionTpl")}
                      style={{ minWidth: "10rem" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={p.dedupe_window_hours}
                      onChange={(e) => set({ dedupe_window_hours: Number(e.target.value) })}
                      aria-label={t("admin14.tgDedupeWindow")}
                      style={{ width: "4rem" }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={p.enabled} onChange={(e) => set({ enabled: e.target.checked })} aria-label={t("admin14.plcEnabled")} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={mut.policy.isPending || !edits[k]}
                      onClick={() =>
                        mut.policy.mutate(
                          { domain: p.domain, type: p.content_type, patch: edits[k] ?? {} },
                          { onSuccess: () => setEdits((e) => { const n = { ...e }; delete n[k]; return n; }) },
                        )
                      }
                    >
                      {t("admin14.tgSave")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mut.policy.isError && <p className="error-text">{errText(mut.policy.error)}</p>}
    </section>
  );
}

function TgQueueTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const list = useTelegramQueue();
  const mut = useTelegramMutation();
  const [note, setNote] = React.useState("");
  const [acting, setActing] = React.useState<string | null>(null);

  if (list.isLoading) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  if ((list.data ?? []).length === 0) return <p className="hint">{t("admin14.tgEmpty")}</p>;

  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin14.colTitle")}</th>
              <th>{t("admin14.tgChannel")}</th>
              <th>{t("admin14.colStatus")}</th>
              <th>{t("admin14.tgSentAt")}</th>
              <th>{t("admin14.tgDecisionNote")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((q) => (
              <tr key={q.id}>
                <td>
                  {q.title}
                  <div className="hint">{q.caption.slice(0, 80)}</div>
                </td>
                <td className="mono">{q.channel}</td>
                <td>
                  <span className="badge tone-warn">{q.status}</span>
                </td>
                <td className="hint">{q.scheduled_at ? formatDate(q.scheduled_at) : formatDate(q.created_at)}</td>
                <td>
                  <input
                    value={acting === q.id ? note : ""}
                    onFocus={() => setActing(q.id)}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("admin14.tgDecisionNotePh")}
                    aria-label={t("admin14.tgDecisionNote")}
                  />
                </td>
                <td>
                  <div className="row">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={mut.decide.isPending}
                      onClick={() => mut.decide.mutate({ id: q.id, approve: true, note: note || undefined })}
                    >
                      {t("admin14.tgApprove")}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={mut.decide.isPending}
                      onClick={() => mut.decide.mutate({ id: q.id, approve: false, note: note || undefined })}
                    >
                      {t("admin14.tgReject")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mut.decide.isError && <p className="error-text">{errText(mut.decide.error)}</p>}
    </section>
  );
}

function TgScheduleTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const list = useTelegramSchedule();
  if (list.isLoading) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  if ((list.data ?? []).length === 0) return <p className="hint">{t("admin14.tgEmpty")}</p>;
  return (
    <section className="panel">
      <ul className="compact-list">
        {(list.data ?? []).map((q) => (
          <li key={q.id}>
            <strong>{q.title}</strong> · <span className="mono">{q.channel}</span> ·{" "}
            <span className="hint">{q.scheduled_at ? formatDate(q.scheduled_at) : "—"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TgHistoryTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const list = useTelegramHistory();
  const mut = useTelegramMutation();
  if (list.isLoading) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  if ((list.data ?? []).length === 0) return <p className="hint">{t("admin14.tgEmpty")}</p>;
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin14.colTitle")}</th>
              <th>{t("admin14.tgChannel")}</th>
              <th>{t("admin14.tgSentAt")}</th>
              <th>{t("admin14.colStatus")}</th>
              <th>{t("admin14.tgError")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((m) => (
              <tr key={m.id}>
                <td>{m.title}</td>
                <td className="mono">{m.channel}</td>
                <td className="hint">{formatDate(m.sent_at)}</td>
                <td>
                  <span className={`badge tone-${m.status === "sent" ? "ok" : m.status === "failed" ? "bad" : "muted"}`}>
                    {m.status}
                  </span>
                </td>
                <td className="error-text">{m.error ?? "—"}</td>
                <td>
                  {m.status === "failed" && (
                    <button type="button" className="btn" disabled={mut.retry.isPending} onClick={() => mut.retry.mutate(m.id)}>
                      {t("admin14.tgRetry")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mut.retry.isError && <p className="error-text">{errText(mut.retry.error)}</p>}
    </section>
  );
}

function TgDedupeTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const list = useTelegramDedupe();
  if (list.isLoading) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  if ((list.data ?? []).length === 0) return <p className="hint">{t("admin14.tgEmpty")}</p>;
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>A</th>
              <th>B</th>
              <th>similarity</th>
              <th>{t("admin14.tgChannel")}</th>
              <th>{t("admin14.tgSentAt")}</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.title_a}</td>
                <td>{c.title_b}</td>
                <td className="mono">{Math.round(c.similarity * 100)}%</td>
                <td className="mono">{c.channel}</td>
                <td className="hint">
                  {formatDate(c.sent_at_a)} / {formatDate(c.sent_at_b)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* media tab (Phase-9 Media Manager embedded)                           */
/* ------------------------------------------------------------------ */

function MediaTab(): React.ReactElement {
  const { t } = useI18n();
  return (
    <div>
      <section className="panel">
        <p className="hint">{t("admin14.mediaHint")}</p>
      </section>
      <MediaManager />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* top-level page                                                       */
/* ------------------------------------------------------------------ */

type TopTab = "inbox" | "placements" | "calendar" | "ai" | "external" | "telegram" | "media";

const TOP_TABS: { id: TopTab; key: string }[] = [
  { id: "inbox", key: "admin14.inboxTitle" },
  { id: "placements", key: "admin14.plcTitle" },
  { id: "calendar", key: "admin14.calTitle" },
  { id: "ai", key: "admin14.aiTitle" },
  { id: "external", key: "admin14.extTitle" },
  { id: "telegram", key: "admin14.tgTitle" },
  { id: "media", key: "admin14.mediaTitle" },
];

export default function ContentControl(): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<TopTab>("inbox");
  const [openRef, setOpenRef] = React.useState<ItemRef | null>(null);

  const openItem = (ref: ItemRef): void => {
    setOpenRef(ref);
  };

  return (
    <div className="page" style={{ maxWidth: "1280px" }}>
      <h1>{t("admin14.inboxTitle")}</h1>
      <p className="hint">{t("admin14.inboxHint")}</p>

      {openRef ? (
        <DetailView itemRef={openRef} onBack={() => setOpenRef(null)} onOpen={openItem} />
      ) : (
        <>
          <nav className="tabs" aria-label={t("admin14.inboxTitle")}>
            {TOP_TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={`tab${tab === tb.id ? " active" : ""}`}
                onClick={() => setTab(tb.id)}
              >
                {t(tb.key)}
              </button>
            ))}
          </nav>
          {tab === "inbox" && <InboxTab onOpen={openItem} />}
          {tab === "placements" && <PlacementsTab />}
          {tab === "calendar" && <CalendarTab />}
          {tab === "ai" && <AiSourcesTab />}
          {tab === "external" && <ExternalSourcesTab />}
          {tab === "telegram" && <TelegramCenterTab />}
          {tab === "media" && <MediaTab />}
        </>
      )}
    </div>
  );
}

/** Re-exported so tests/SSR harnesses can reference the same query keys. */
export { admin14Keys };

/**
 * Sub-views exported for SSR/test harnesses (the route surface stays the
 * single default export above). Pure presentation — safe to render standalone.
 */
export {
  InboxTab,
  DetailView,
  PlacementsTab,
  CalendarTab,
  AiSourcesTab,
  ExternalSourcesTab,
  TelegramCenterTab,
  MediaTab,
};
