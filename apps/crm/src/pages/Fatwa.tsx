import React from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import { EMPTY_L10N, LocalizedText, WorkflowStatus } from "../lib/contentApi";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useEventFeed } from "../lib/events";
import LocalizedInput from "../components/LocalizedInput";
import {
  AI_SCOPES,
  AiScope,
  CreateChunkBody,
  FatwaCategory,
  FatwaCategoryBody,
  FatwaChunk,
  FiqhTopic,
  MADHABS,
  MadhabId,
  MadhabPosition,
  TopicBody,
  TrustedSource,
  TrustedSourceBody,
  chunkExcerpt,
  errText,
  statusLabel,
  useApproveChunk,
  useCreateChunk,
  useCreateFatwaCategory,
  useCreatePosition,
  useCreateTopic,
  useCreateTrustedSource,
  useDeleteFatwaCategory,
  useDeleteTrustedSource,
  useFatwaAudit,
  useFatwaCategories,
  useFatwaChunks,
  useFatwaTopics,
  useFatwaUsage,
  useIngestRun,
  useIngestRuns,
  useMadhabPositions,
  useRejectChunk,
  useSetTopicStatus,
  useTriggerIngest,
  useUpdateFatwaCategory,
  useUpdatePosition,
  useUpdateTopic,
  useUpdateTrustedSource,
  useTrustedSources,
} from "../lib/fatwa";

/**
 * Fatwa management center — Phase 6 (CRM track).
 *
 * Tabbed management over the Track 1 backend contract:
 *   chunks · knowledge entry · topics & madhab positions · ingestion ·
 *   trusted sources · audit log · usage.
 *
 * Contract §9 shared workflow: chunks move draft → in_review → approved →
 * published through the backend; the CRM review queue uses the dedicated
 * approve/reject endpoints and only offers those actions on in_review
 * chunks. RAG only ever sees approved/published content — enforced
 * server-side.
 *
 * §14: the audit view never renders secret values (secrets are never
 * stored there — old/new values are not fetched at all).
 */

type FatwaTab =
  | "chunks"
  | "entry"
  | "topics"
  | "ingest"
  | "sources"
  | "audit"
  | "usage"
  | "register"
  | "categories"
  | "review"
  | "published";
const TABS: FatwaTab[] = [
  "chunks",
  "entry",
  "topics",
  "ingest",
  "sources",
  "audit",
  "usage",
  "register",
  "categories",
  "review",
  "published",
];

const TAB_KEY: Record<FatwaTab, string> = {
  chunks: "fatwa.tabChunks",
  entry: "fatwa.tabEntry",
  topics: "fatwa.tabTopics",
  ingest: "fatwa.tabIngest",
  sources: "fatwa.tabSources",
  audit: "fatwa.tabAudit",
  usage: "fatwa.tabUsage",
  register: "fatwa.tabRegister",
  categories: "fatwa.tabCategories",
  review: "fatwa.tabReview",
  published: "fatwa.tabPublished",
};

const WORKFLOW_STATUSES: WorkflowStatus[] = [
  "draft",
  "in_review",
  "approved",
  "published",
  "rejected",
  "archived",
];

function initialTab(): FatwaTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as string[]).includes(t)) return t as FatwaTab;
  } catch {
    // ignore
  }
  return "chunks";
}

/* ------------------------------------------------------------------ */
/* live fatwa strip (fatwa.asked / fatwa.answered, no refresh)          */
/* ------------------------------------------------------------------ */

function LiveFatwaStrip(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events } = useEventFeed(60);
  const fatwaEvents = events.filter(
    (e) => e.event_type === "fatwa.asked" || e.event_type === "fatwa.answered",
  );
  const latest = fatwaEvents[0];

  return (
    <div
      className="panel"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.55rem 1rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}
      aria-live="polite"
    >
      <Badge tone={status === "connected" ? "success" : "neutral"}>{t(`studio.feed_${status}`)}</Badge>
      <span className="hint" style={{ margin: 0 }}>
        {t("fatwa.liveSub")}
      </span>
      {latest ? (
        <span style={{ fontSize: "0.82rem", color: "var(--x-text2)" }} dir="ltr">
          <code style={{ fontSize: "0.78rem" }}>{latest.event_type}</code>
          {" · "}
          {formatDate(latest.created_at)}
          {fatwaEvents.length > 1 ? ` · +${fatwaEvents.length - 1}` : ""}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {t("fatwa.noLiveYet")}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* chunks — review queue                                               */
/* ------------------------------------------------------------------ */

function ChunkWorkflowActions({ chunk }: { chunk: FatwaChunk }): React.ReactElement | null {
  const { t } = useI18n();
  const approve = useApproveChunk();
  const reject = useRejectChunk();
  if (chunk.workflow_status !== "in_review") return null;
  const pending = approve.isPending || reject.isPending;
  const err = approve.isError ? approve.error : reject.isError ? reject.error : null;
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => approve.mutate(chunk.id)}
      >
        {pending ? t("common.loading") : t("fatwa.approve")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (window.confirm(t("fatwa.confirmReject"))) reject.mutate(chunk.id);
        }}
      >
        {t("fatwa.reject")}
      </Button>
      {err && (
        <span className="form-error" style={{ marginBottom: 0 }}>
          {errText(err)}
        </span>
      )}
    </div>
  );
}

function ChunkRow({ chunk, onReview }: { chunk: FatwaChunk; onReview: () => void }): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const citation = chunk.source_citation;
  return (
    <tr>
      <td dir="auto" style={{ maxWidth: "320px" }}>
        {chunkExcerpt(chunk.chunk_text)}
      </td>
      <td>
        {chunk.topic_category ? <code dir="ltr">{chunk.topic_category}</code> : "—"}
      </td>
      <td>{t(`fatwa.madhab_${chunk.madhab_scope}`) !== `fatwa.madhab_${chunk.madhab_scope}` ? t(`fatwa.madhab_${chunk.madhab_scope}`) : chunk.madhab_scope}</td>
      <td dir="auto" style={{ maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }}>
        {citation[locale] || citation.fa || citation.en || "—"}
      </td>
      <td>
        <Badge tone={statusTone(chunk.workflow_status)}>{statusLabel(t, chunk.workflow_status)}</Badge>
      </td>
      <td>{chunk.updated_at ? formatDate(chunk.updated_at) : "—"}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Button size="sm" variant="secondary" onClick={onReview}>
          {t("fatwa.review")}
        </Button>
      </td>
    </tr>
  );
}

function ChunkDrawer({ chunk, onClose }: { chunk: FatwaChunk; onClose: () => void }): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const citation = chunk.source_citation;
  const ref = chunk.source_ref;
  const refText = ref
    ? [ref.type, ref.id, ref.version !== undefined ? `v${ref.version}` : ""]
        .filter(Boolean)
        .join(" / ")
    : "";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer slide-in" role="dialog" aria-modal="true" aria-label={t("fatwa.chunkPreview")}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--x-gold2)" }}>
            {t("fatwa.chunkPreview")}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
            {t("fatwa.close")}
          </Button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
          <Badge tone={statusTone(chunk.workflow_status)}>{statusLabel(t, chunk.workflow_status)}</Badge>
          <Badge tone="neutral">
            <span dir="ltr">{chunk.source_type}</span>
          </Badge>
          <ChunkWorkflowActions chunk={chunk} />
        </div>

        <Card style={{ marginBottom: "1rem" }}>
          <CardContent>
            <div style={{ whiteSpace: "pre-wrap", fontSize: "0.92rem", color: "var(--x-text2)" }} dir="auto">
              {chunk.chunk_text}
            </div>
          </CardContent>
        </Card>

        <h3 style={{ fontSize: "0.95rem", color: "var(--x-gold2)" }}>{t("fatwa.provenance")}</h3>
        <div className="table-wrap" style={{ marginBottom: "1rem" }}>
          <table className="data">
            <tbody>
              <tr>
                <td style={{ width: "40%" }}>{t("fatwa.provCitation")}</td>
                <td dir="auto">{citation[locale] || citation.fa || citation.en || "—"}</td>
              </tr>
              <tr>
                <td>{t("fatwa.provRef")}</td>
                <td dir="ltr">
                  <code style={{ fontSize: "0.78rem" }}>{refText || "—"}</code>
                </td>
              </tr>
              <tr>
                <td>{t("fatwa.provApprovedBy")}</td>
                <td>{chunk.approved_by ? <code dir="ltr">{chunk.approved_by.slice(0, 8)}…</code> : "—"}</td>
              </tr>
              <tr>
                <td>{t("fatwa.provCreated")}</td>
                <td>{chunk.created_at ? formatDate(chunk.created_at) : "—"}</td>
              </tr>
              <tr>
                <td>{t("fatwa.tableTopic")}</td>
                <td dir="ltr">{chunk.topic_category ? <code>{chunk.topic_category}</code> : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 style={{ fontSize: "0.95rem", color: "var(--x-gold2)" }}>{t("fatwa.aiScopes")}</h3>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {chunk.ai_scopes.length === 0 ? (
            <Badge tone="neutral">{t("fatwa.scopeNone")}</Badge>
          ) : (
            chunk.ai_scopes.map((s) => (
              <Badge key={s} tone="info">
                {t(`fatwa.scope_${s}`) !== `fatwa.scope_${s}` ? t(`fatwa.scope_${s}`) : s}
              </Badge>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function ChunksTab(): React.ReactElement {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = React.useState<string>("in_review");
  const [selected, setSelected] = React.useState<FatwaChunk | null>(null);
  const chunks = useFatwaChunks(statusFilter || undefined);

  return (
    <div>
      <div className="panel" style={{ marginBottom: "0.75rem" }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: "180px" }}>
            <label htmlFor="chunk-status">{t("fatwa.filterStatus")}</label>
            <select
              id="chunk-status"
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("fatwa.allStatuses")}</option>
              {WORKFLOW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(t, s)}
                </option>
              ))}
            </select>
          </div>
          <span style={{ flex: 1 }} />
          <span className="hint" style={{ margin: 0 }}>
            {t("fatwa.chunksHint")}
          </span>
        </div>
      </div>

      {chunks.isLoading && <div className="empty">{t("common.loading")}</div>}
      {chunks.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => chunks.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {chunks.data && chunks.data.items.length === 0 && (
        <div className="empty">
          <p>{t("fatwa.emptyChunks")}</p>
        </div>
      )}
      {chunks.data && chunks.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("fatwa.tableTitle")}</th>
                <th>{t("fatwa.tableTopic")}</th>
                <th>{t("fatwa.tableMadhab")}</th>
                <th>{t("fatwa.tableCitation")}</th>
                <th>{t("fatwa.tableStatus")}</th>
                <th>{t("fatwa.tableUpdated")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {chunks.data.items.map((c) => (
                <ChunkRow key={c.id} chunk={c} onReview={() => setSelected(c)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ChunkDrawer chunk={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* knowledge entry — structured form, citation required                */
/* ------------------------------------------------------------------ */

const EMPTY_ENTRY: CreateChunkBody = {
  title: { ...EMPTY_L10N },
  chunk_text: "",
  source_type: "manual",
  source_citation: { ...EMPTY_L10N },
  topic_category: "",
  madhab_scope: "all",
  ai_scopes: [],
};

function EntryTab(): React.ReactElement {
  const { t } = useI18n();
  const [form, setForm] = React.useState<CreateChunkBody>({
    ...EMPTY_ENTRY,
    title: { ...EMPTY_L10N },
    source_citation: { ...EMPTY_L10N },
  });
  const [touched, setTouched] = React.useState(false);
  const create = useCreateChunk();

  const citationOk = form.source_citation.fa.trim().length > 0;
  const bodyOk = form.chunk_text.trim().length > 0;
  const valid = citationOk && bodyOk;

  const toggleScope = (s: AiScope): void =>
    setForm((f) => ({
      ...f,
      ai_scopes: f.ai_scopes.includes(s) ? f.ai_scopes.filter((x) => x !== s) : [...f.ai_scopes, s],
    }));

  const handleSubmit = (): void => {
    setTouched(true);
    if (!valid || create.isPending) return;
    create.mutate(form, {
      onSuccess: () => {
        setForm({ ...EMPTY_ENTRY, title: { ...EMPTY_L10N }, source_citation: { ...EMPTY_L10N } });
        setTouched(false);
      },
    });
  };

  return (
    <section className="panel" aria-label={t("fatwa.entryTitle")}>
      <div className="panel-head">
        <h2>{t("fatwa.entryTitle")}</h2>
        <Badge tone="info">{t("fatwa.entryBadge")}</Badge>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("fatwa.entryHint")}
      </p>

      <LocalizedInput
        id="entry-title"
        label={t("fatwa.fieldTitle")}
        value={form.title}
        onChange={(v) => setForm((f) => ({ ...f, title: v }))}
      />

      <div className="field">
        <label htmlFor="entry-body">{t("fatwa.fieldBody")}</label>
        <textarea
          id="entry-body"
          className="input"
          rows={6}
          dir="auto"
          value={form.chunk_text}
          onChange={(e) => setForm((f) => ({ ...f, chunk_text: e.target.value }))}
        />
        {touched && !bodyOk && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {t("fatwa.bodyRequired")}
          </span>
        )}
      </div>

      <LocalizedInput
        id="entry-citation"
        label={t("fatwa.fieldCitation")}
        value={form.source_citation}
        onChange={(v) => setForm((f) => ({ ...f, source_citation: v }))}
        multiline
        rows={2}
      />
      {touched && !citationOk && (
        <span className="form-error" style={{ marginBottom: "0.75rem" }}>
          {t("fatwa.citationRequired")}
        </span>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div className="field">
          <label htmlFor="entry-topic">{t("fatwa.fieldTopicCategory")}</label>
          <input
            id="entry-topic"
            className="input"
            dir="ltr"
            placeholder={t("fatwa.topicPlaceholder")}
            value={form.topic_category}
            onChange={(e) => setForm((f) => ({ ...f, topic_category: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="entry-madhab">{t("fatwa.fieldMadhabScope")}</label>
          <select
            id="entry-madhab"
            className="input"
            value={form.madhab_scope}
            onChange={(e) => setForm((f) => ({ ...f, madhab_scope: e.target.value }))}
          >
            <option value="all">{t("fatwa.madhab_all")}</option>
            {MADHABS.map((m) => (
              <option key={m} value={m}>
                {t(`fatwa.madhab_${m}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <span className="field-label">{t("fatwa.aiScopes")}</span>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {AI_SCOPES.map((s) => (
            <label className="check-row" key={s}>
              <input
                type="checkbox"
                checked={form.ai_scopes.includes(s)}
                onChange={() => toggleScope(s)}
              />
              {t(`fatwa.scope_${s}`)}
            </label>
          ))}
        </div>
        <span className="hint">{t("fatwa.scopesHint")}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" }}>
        <button type="button" className="btn-gold" onClick={handleSubmit} disabled={create.isPending}>
          {create.isPending ? t("common.loading") : t("fatwa.submitEntry")}
        </button>
        {create.isSuccess && <Badge tone="success">{t("fatwa.entrySaved")}</Badge>}
        {create.isError && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(create.error)}
          </span>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* topics & madhab positions                                           */
/* ------------------------------------------------------------------ */

function topicName(topic: FiqhTopic, locale: string): string {
  const l10n = topic.title as LocalizedText & Record<string, string>;
  return l10n[locale] || topic.title.fa || topic.title.en || "—";
}

function TopicForm({
  initial,
  onDone,
}: {
  initial: FiqhTopic | null;
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [title, setTitle] = React.useState<LocalizedText>(
    initial ? { ...initial.title } : { ...EMPTY_L10N },
  );
  const [description, setDescription] = React.useState<LocalizedText>(
    initial ? { ...initial.description } : { ...EMPTY_L10N },
  );
  const create = useCreateTopic();
  const update = useUpdateTopic();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  return (
    <div>
      <LocalizedInput id="topic-title" label={t("fatwa.fieldTitle")} value={title} onChange={setTitle} />
      <LocalizedInput
        id="topic-desc"
        label={t("fatwa.fieldDescription")}
        value={description}
        onChange={setDescription}
        multiline
      />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            const body = { title, description };
            if (initial) {
              update.mutate({ id: initial.id, body }, { onSuccess: onDone });
            } else {
              create.mutate(body, { onSuccess: onDone });
            }
          }}
        >
          {pending ? t("common.loading") : t("fatwa.saveTopic")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t("fatwa.cancel")}
        </Button>
        {err && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(err)}
          </span>
        )}
      </div>
    </div>
  );
}

function PositionEditor({
  topicId,
  madhab,
  existing,
}: {
  topicId: string;
  madhab: MadhabId;
  existing: MadhabPosition | undefined;
}): React.ReactElement {
  const { t } = useI18n();
  const [text, setText] = React.useState<LocalizedText>(
    existing ? { ...existing.position_text } : { ...EMPTY_L10N },
  );
  const [evidence, setEvidence] = React.useState(existing?.evidence_refs.join("\n") ?? "");
  const [savedTick, setSavedTick] = React.useState(0);
  const create = useCreatePosition();
  const update = useUpdatePosition();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  React.useEffect(() => {
    setText(existing ? { ...existing.position_text } : { ...EMPTY_L10N });
    setEvidence(existing?.evidence_refs.join("\n") ?? "");
  }, [existing]);

  const evidenceRefs = evidence.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`fatwa.madhab_${madhab}`)}</CardTitle>
      </CardHeader>
      <CardContent>
        <LocalizedInput
          id={`pos-${madhab}`}
          label={t("fatwa.fieldPositionText")}
          value={text}
          onChange={setText}
          multiline
          rows={4}
        />
        <div className="field">
          <label htmlFor={`pos-ev-${madhab}`}>{t("fatwa.fieldEvidenceRefs")}</label>
          <textarea
            id={`pos-ev-${madhab}`}
            className="input"
            rows={2}
            dir="auto"
            placeholder={t("fatwa.evidencePlaceholder")}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              const body = { position_text: text, evidence_refs: evidenceRefs };
              if (existing) {
                update.mutate({ id: existing.id, body }, { onSuccess: () => setSavedTick((n) => n + 1) });
              } else {
                create.mutate({ topic_id: topicId, madhab, ...body }, {
                  onSuccess: () => setSavedTick((n) => n + 1),
                });
              }
            }}
          >
            {pending ? t("common.loading") : t("fatwa.savePosition")}
          </Button>
          {savedTick > 0 && !err && <Badge tone="success">{t("fatwa.saved")}</Badge>}
          {err && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(err)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TopicsTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const topics = useFatwaTopics();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<FiqhTopic | null | "new">(null);
  const positions = useMadhabPositions(selectedId ?? undefined);

  const selected = topics.data?.find((x) => x.id === selectedId) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 2fr", gap: "1rem" }}>
      <section className="panel" aria-label={t("fatwa.topicsTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.topicsTitle")}</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            {t("fatwa.newTopic")}
          </Button>
        </div>
        {topics.isLoading && <div className="empty">{t("common.loading")}</div>}
        {topics.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => topics.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {topics.data && topics.data.length === 0 && <div className="empty">{t("fatwa.emptyTopics")}</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {topics.data?.map((tp) => (
            <li key={tp.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(tp.id);
                  setEditing(null);
                }}
                className="input"
                style={{
                  width: "100%",
                  textAlign: "start",
                  cursor: "pointer",
                  marginBottom: "0.4rem",
                  background: selectedId === tp.id ? "var(--x-gold)" : "transparent",
                  color: selectedId === tp.id ? "#1a1408" : "var(--x-text2)",
                  fontWeight: selectedId === tp.id ? 700 : 400,
                }}
              >
                {topicName(tp, locale)}
              </button>
            </li>
          ))}
        </ul>
        {editing && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--x-line)", paddingTop: "1rem" }}>
            <TopicForm initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
          </div>
        )}
        {selected && !editing && (
          <div style={{ marginTop: "0.75rem" }}>
            <Button size="sm" variant="secondary" onClick={() => setEditing(selected)}>
              {t("fatwa.editTopic")}
            </Button>
          </div>
        )}
      </section>

      <section className="panel" aria-label={t("fatwa.positionsTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.positionsTitle")}</h2>
          {selected && (
            <span className="panel-hint">{topicName(selected, locale)}</span>
          )}
        </div>
        {!selected && <div className="empty">{t("fatwa.selectTopic")}</div>}
        {selected && positions.isLoading && <div className="empty">{t("common.loading")}</div>}
        {selected && positions.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => positions.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {selected && positions.data && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {MADHABS.map((m) => (
              <PositionEditor
                key={m}
                topicId={selected.id}
                madhab={m}
                existing={positions.data.find((p) => p.madhab === m)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ingestion                                                           */
/* ------------------------------------------------------------------ */

function IngestTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const runs = useIngestRuns();
  const [note, setNote] = React.useState("");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const trigger = useTriggerIngest();
  const detail = useIngestRun(detailId);

  const fmtNum = (n: number): string => n.toLocaleString("en-US");

  return (
    <div>
      <section className="panel" aria-label={t("fatwa.ingestTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.ingestTitle")}</h2>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("fatwa.triggerHint")}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0, minWidth: "240px", flex: 1 }}>
            <label htmlFor="ingest-note">{t("fatwa.triggerNote")}</label>
            <input
              id="ingest-note"
              className="input"
              dir="auto"
              placeholder={t("fatwa.triggerNotePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-gold"
            disabled={trigger.isPending}
            onClick={() => trigger.mutate(note.trim() || undefined)}
          >
            {trigger.isPending ? t("common.loading") : t("fatwa.triggerIngest")}
          </button>
        </div>
        {trigger.isError && (
          <span className="form-error" style={{ marginBottom: 0, marginTop: "0.5rem" }}>
            {errText(trigger.error)}
          </span>
        )}
      </section>

      {runs.isLoading && <div className="empty">{t("common.loading")}</div>}
      {runs.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => runs.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {runs.data && runs.data.length === 0 && <div className="empty">{t("fatwa.emptyRuns")}</div>}
      {runs.data && runs.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("fatwa.tableRun")}</th>
                <th>{t("fatwa.tableRunStatus")}</th>
                <th>{t("fatwa.tableStarted")}</th>
                <th>{t("fatwa.tableFinished")}</th>
                <th>{t("fatwa.runStats")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code dir="ltr" style={{ fontSize: "0.75rem" }}>
                      {r.id.slice(0, 8)}…
                    </code>
                  </td>
                  <td>
                    <Badge tone={r.status === "failed" ? "danger" : r.status === "done" ? "success" : "info"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td>{r.started_at ? formatDate(r.started_at) : "—"}</td>
                  <td>{r.finished_at ? formatDate(r.finished_at) : "—"}</td>
                  <td dir="ltr" style={{ fontSize: "0.8rem" }}>
                    {fmtNum(r.stats.extracted)}/{fmtNum(r.stats.chunked)}/{fmtNum(r.stats.embedded)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="secondary" onClick={() => setDetailId(r.id)}>
                      {t("fatwa.runDetail")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailId && (
        <section className="panel" style={{ marginTop: "1rem" }} aria-label={t("fatwa.runDetail")}>
          <div className="panel-head">
            <h2>{t("fatwa.runDetail")}</h2>
            <Button size="sm" variant="ghost" onClick={() => setDetailId(null)}>
              {t("fatwa.close")}
            </Button>
          </div>
          {detail.isLoading && <div className="empty">{t("common.loading")}</div>}
          {detail.data && (
            <>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    <tr>
                      <td style={{ width: "40%" }}>{t("fatwa.statExtracted")}</td>
                      <td dir="ltr">{fmtNum(detail.data.stats.extracted)}</td>
                    </tr>
                    <tr>
                      <td>{t("fatwa.statChunked")}</td>
                      <td dir="ltr">{fmtNum(detail.data.stats.chunked)}</td>
                    </tr>
                    <tr>
                      <td>{t("fatwa.statEmbedded")}</td>
                      <td dir="ltr">{fmtNum(detail.data.stats.embedded)}</td>
                    </tr>
                    <tr>
                      <td>{t("fatwa.statApproved")}</td>
                      <td dir="ltr">{fmtNum(detail.data.stats.approved)}</td>
                    </tr>
                    <tr>
                      <td>{t("fatwa.statFailed")}</td>
                      <td dir="ltr">{fmtNum(detail.data.stats.failed)}</td>
                    </tr>
                    {detail.data.error && (
                      <tr>
                        <td>{t("fatwa.runError")}</td>
                        <td dir="auto" style={{ color: "var(--x-danger)" }}>
                          {detail.data.error}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* trusted sources (§9.6 — super_admin only)                            */
/* ------------------------------------------------------------------ */

const EMPTY_SOURCE: TrustedSourceBody = {
  name: "",
  base_url: "",
  enabled: false,
  allowed_paths: [],
  priority: 0,
  citation_required: true,
};

function SourceForm({
  initial,
  onDone,
}: {
  initial: TrustedSource | null;
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [form, setForm] = React.useState<TrustedSourceBody>(
    initial
      ? {
          name: initial.name,
          base_url: initial.base_url,
          enabled: initial.enabled,
          allowed_paths: [...initial.allowed_paths],
          priority: initial.priority,
          citation_required: initial.citation_required,
        }
      : { ...EMPTY_SOURCE },
  );
  const create = useCreateTrustedSource();
  const update = useUpdateTrustedSource();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  const patch = (p: Partial<TrustedSourceBody>): void => setForm((f) => ({ ...f, ...p }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div className="field">
          <label htmlFor="src-name">{t("fatwa.fieldName")}</label>
          <input
            id="src-name"
            className="input"
            dir="auto"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="src-url">{t("fatwa.fieldBaseUrl")}</label>
          <input
            id="src-url"
            className="input"
            dir="ltr"
            placeholder="https://…"
            value={form.base_url}
            onChange={(e) => patch({ base_url: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="src-paths">{t("fatwa.fieldAllowedPaths")}</label>
        <textarea
          id="src-paths"
          className="input"
          rows={3}
          dir="ltr"
          value={form.allowed_paths.join("\n")}
          onChange={(e) =>
            patch({ allowed_paths: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
          }
        />
      </div>
      <div className="field">
        <label htmlFor="src-prio">{t("fatwa.fieldPriority")}</label>
        <input
          id="src-prio"
          className="input"
          type="number"
          dir="ltr"
          value={form.priority}
          onChange={(e) => patch({ priority: Number(e.target.value) || 0 })}
        />
      </div>
      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <label className="check-row">
          <input type="checkbox" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          {t("fatwa.fieldEnabled")}
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.citation_required}
            onChange={(e) => patch({ citation_required: e.target.checked })}
          />
          {t("fatwa.fieldCitationRequired")}
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Button
          size="sm"
          disabled={pending || !form.name.trim() || !form.base_url.trim()}
          onClick={() => {
            if (initial) {
              update.mutate({ id: initial.id, body: form }, { onSuccess: onDone });
            } else {
              create.mutate(form, { onSuccess: onDone });
            }
          }}
        >
          {pending ? t("common.loading") : t("fatwa.save")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t("fatwa.cancel")}
        </Button>
        {err && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(err)}
          </span>
        )}
      </div>
    </div>
  );
}

function SourcesTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { isSuperAdmin } = useAuth();
  const sources = useTrustedSources();
  const [editing, setEditing] = React.useState<TrustedSource | null | "new">(null);
  const del = useDeleteTrustedSource();

  if (!isSuperAdmin) {
    return (
      <div className="empty">
        <p>{t("fatwa.superAdminOnly")}</p>
        <p style={{ fontSize: "0.85rem" }}>{t("fatwa.sourcesHint")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: "0.75rem" }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <span className="hint" style={{ margin: 0 }}>
            {t("fatwa.sourcesHint")}
          </span>
          <span style={{ flex: 1 }} />
          <Button size="sm" onClick={() => setEditing("new")}>
            {t("fatwa.newSource")}
          </Button>
        </div>
      </div>

      {editing && (
        <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("fatwa.editSource")}>
          <div className="panel-head">
            <h2>{editing === "new" ? t("fatwa.newSource") : t("fatwa.editSource")}</h2>
          </div>
          <SourceForm initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        </section>
      )}

      {sources.isLoading && <div className="empty">{t("common.loading")}</div>}
      {sources.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => sources.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {sources.data && sources.data.length === 0 && <div className="empty">{t("fatwa.emptySources")}</div>}
      {sources.data && sources.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("fatwa.fieldName")}</th>
                <th>{t("fatwa.fieldBaseUrl")}</th>
                <th>{t("fatwa.fieldEnabled")}</th>
                <th>{t("fatwa.fieldPriority")}</th>
                <th>{t("fatwa.fieldLastChecked")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.data.map((s) => (
                <tr key={s.id}>
                  <td dir="auto">{s.name}</td>
                  <td dir="ltr">
                    <code style={{ fontSize: "0.75rem" }}>{s.base_url}</code>
                  </td>
                  <td>
                    <Badge tone={s.enabled ? "success" : "neutral"}>
                      {s.enabled ? t("fatwa.yes") : t("fatwa.no")}
                    </Badge>
                  </td>
                  <td dir="ltr">{s.priority}</td>
                  <td>{s.last_checked_at ? formatDate(s.last_checked_at) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                      {t("fatwa.edit")}
                    </Button>{" "}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={del.isPending}
                      onClick={() => {
                        if (window.confirm(t("fatwa.confirmDelete"))) del.mutate(s.id);
                      }}
                    >
                      {t("fatwa.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* audit + usage                                                       */
/* ------------------------------------------------------------------ */

function AuditTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const audit = useFatwaAudit(100);

  return (
    <div>
      <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("fatwa.auditTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.auditTitle")}</h2>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {t("fatwa.auditHint")}
        </p>
      </section>

      {audit.isLoading && <div className="empty">{t("common.loading")}</div>}
      {audit.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => audit.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {audit.data && audit.data.length === 0 && <div className="empty">{t("fatwa.emptyAudit")}</div>}
      {audit.data && audit.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("fatwa.tableAction")}</th>
                <th>{t("fatwa.tableEntity")}</th>
                <th>{t("fatwa.tableActor")}</th>
                <th>{t("fatwa.tableTime")}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map((e) => (
                <tr key={e.id || `${e.action}-${e.created_at}`}>
                  <td>
                    <Badge tone={e.action === "fatwa.answered" ? "success" : "info"}>{e.action}</Badge>
                  </td>
                  <td>
                    {e.entity_type ? (
                      <span dir="ltr">
                        <code style={{ fontSize: "0.75rem" }}>{e.entity_type}</code>
                        {e.entity_id ? ` · ${e.entity_id.slice(0, 8)}…` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{e.actor_id ? <code dir="ltr">{e.actor_id.slice(0, 8)}…</code> : "—"}</td>
                  <td>{e.created_at ? formatDate(e.created_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsageTab(): React.ReactElement {
  const { t } = useI18n();
  const usage = useFatwaUsage();

  const totals = React.useMemo(() => {
    const rows = usage.data ?? [];
    return {
      requests: rows.reduce((n, r) => n + r.requests, 0),
      prompt: rows.reduce((n, r) => n + r.prompt_tokens, 0),
      completion: rows.reduce((n, r) => n + r.completion_tokens, 0),
      total: rows.reduce((n, r) => n + r.total_tokens, 0),
      cost: rows.reduce((n, r) => n + r.cost_usd, 0),
    };
  }, [usage.data]);

  const fmtNum = (n: number): string => n.toLocaleString("en-US");
  const fmtCost = (n: number): string => n.toFixed(4);

  return (
    <div>
      <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("fatwa.usageTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.usageTitle")}</h2>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {t("fatwa.usageHint")}
        </p>
      </section>

      {usage.isLoading && <div className="empty">{t("common.loading")}</div>}
      {usage.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => usage.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {usage.data && usage.data.length === 0 && <div className="empty">{t("fatwa.emptyUsage")}</div>}
      {usage.data && usage.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("fatwa.tableUser")}</th>
                <th>{t("fatwa.tablePeriod")}</th>
                <th>{t("fatwa.tableRequests")}</th>
                <th>{t("fatwa.tablePrompt")}</th>
                <th>{t("fatwa.tableCompletion")}</th>
                <th>{t("fatwa.tableTotal")}</th>
                <th>{t("fatwa.tableCost")}</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.map((r) => (
                <tr key={`${r.user_id}-${r.period}`}>
                  <td dir="auto">{r.user_label || <code dir="ltr">{r.user_id.slice(0, 8)}…</code>}</td>
                  <td dir="ltr">{r.period}</td>
                  <td dir="ltr">{fmtNum(r.requests)}</td>
                  <td dir="ltr">{fmtNum(r.prompt_tokens)}</td>
                  <td dir="ltr">{fmtNum(r.completion_tokens)}</td>
                  <td dir="ltr">{fmtNum(r.total_tokens)}</td>
                  <td dir="ltr">${fmtCost(r.cost_usd)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={2}>{t("fatwa.totalRow")}</td>
                <td dir="ltr">{fmtNum(totals.requests)}</td>
                <td dir="ltr">{fmtNum(totals.prompt)}</td>
                <td dir="ltr">{fmtNum(totals.completion)}</td>
                <td dir="ltr">{fmtNum(totals.total)}</td>
                <td dir="ltr">${fmtCost(totals.cost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page shell                                                          */
/* ------------------------------------------------------------------ */

export default function Fatwa(): React.ReactElement {
  const { t, setLocale } = useI18n();
  const [tab, setTab] = React.useState<FatwaTab>(initialTab);

  // Deep-link support: ?tab=…&locale=fa|ar|en
  React.useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("locale");
      if (l === "fa" || l === "ar" || l === "en") setLocale(l);
    } catch {
      // ignore
    }
  }, [setLocale]);

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
        <h1 style={{ margin: 0 }}>{t("fatwa.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>
        {t("fatwa.liveHint")}
      </p>
      <p className="hint" style={{ fontSize: "0.85rem", marginBottom: "1.25rem" }}>
        {t("fatwa.keysNote")}{" "}
        <Link to="/settings" style={{ color: "var(--x-gold2)" }}>
          {t("nav.settings")}
        </Link>
      </p>

      <LiveFatwaStrip />

      <div className="locale-tabs" role="tablist" aria-label={t("fatwa.title")}>
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
        {tab === "chunks" && <ChunksTab />}
        {tab === "entry" && <EntryTab />}
        {tab === "topics" && <TopicsTab />}
        {tab === "ingest" && <IngestTab />}
        {tab === "sources" && <SourcesTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "usage" && <UsageTab />}
        {tab === "register" && <RegisterTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "review" && <ReviewTab />}
        {tab === "published" && <PublishedTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* فهرست وردپرسی فتوا — ثبت چندمرحله‌ای، دسته‌بندی، بررسی، منتشرشده */
/* ------------------------------------------------------------------ */

function catName(
  cat: { title: LocalizedText } | null | undefined,
  locale: string,
): string {
  if (!cat) return "";
  const l10n = cat.title as LocalizedText & Record<string, string>;
  return l10n[locale] || cat.title.fa || cat.title.en || "—";
}

/** مرتب‌سازی فهرست‌ها بر اساس دسته، بعد تاریخ (تازه‌ترین اول). */
function sortByCategoryDate(items: FiqhTopic[], locale: string): FiqhTopic[] {
  return [...items].sort((a, b) => {
    const ca = catName(a.category, locale);
    const cb = catName(b.category, locale);
    if (ca !== cb) return ca.localeCompare(cb);
    const da = a.published_at || a.created_at;
    const db = b.published_at || b.created_at;
    return db.localeCompare(da);
  });
}

/** فرم ویرایش فشردهٔ موضوع — همان فیلدهایی که PUT می‌پذیرد. */
function TopicEditForm({
  initial,
  onDone,
}: {
  initial: FiqhTopic;
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const categories = useFatwaCategories();
  const [title, setTitle] = React.useState<LocalizedText>({ ...initial.title });
  const [description, setDescription] = React.useState<LocalizedText>({
    ...initial.description,
  });
  const [categoryId, setCategoryId] = React.useState<string>(initial.category_id ?? "");
  const [author, setAuthor] = React.useState<string>(initial.author_name ?? "");
  const [imageUrl, setImageUrl] = React.useState<string>(initial.featured_image_url ?? "");
  const update = useUpdateTopic();
  const pending = update.isPending;
  const err = update.isError ? update.error : null;

  return (
    <div>
      <LocalizedInput id="edit-topic-title" label={t("fatwa.fieldTitle")} value={title} onChange={setTitle} />
      <LocalizedInput
        id="edit-topic-desc"
        label={t("fatwa.fieldDescription")}
        value={description}
        onChange={setDescription}
        multiline
      />
      <div className="field">
        <label htmlFor="edit-topic-cat">{t("fatwa.selectCategory")}</label>
        <select
          id="edit-topic-cat"
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t("fatwa.selectCategory")}</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {catName(c, "fa") || c.slug}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="edit-topic-author">{t("fatwa.stepAuthor")}</label>
        <input
          id="edit-topic-author"
          className="input"
          value={author}
          placeholder={t("fatwa.authorPlaceholder")}
          onChange={(e) => setAuthor(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-topic-img">{t("fatwa.imageUrlLabel")}</label>
        <input
          id="edit-topic-img"
          className="input"
          dir="ltr"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <p className="hint">{t("fatwa.imageUrlHint")}</p>
        {imageUrl.startsWith("http") ? (
          <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "12rem", marginTop: "0.5rem" }} />
        ) : null}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            const body: TopicBody = {
              title,
              description,
              category_id: categoryId || null,
              author_name: author.trim() || null,
              featured_image_url: imageUrl.trim() || null,
            };
            update.mutate({ id: initial.id, body }, { onSuccess: onDone });
          }}
        >
          {pending ? t("common.loading") : t("fatwa.saveTopic")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t("fatwa.cancel")}
        </Button>
        {err && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(err)}
          </span>
        )}
      </div>
    </div>
  );
}

const OTHER_MADHABS = ["shafii", "maliki", "hanbali"] as const;

function RegisterTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const categories = useFatwaCategories();
  const drafts = useFatwaTopics({ status: "draft" });
  const setStatus = useSetTopicStatus();
  const createTopic = useCreateTopic();
  const createPosition = useCreatePosition();

  const [step, setStep] = React.useState(1);
  const [question, setQuestion] = React.useState<LocalizedText>({ ...EMPTY_L10N });
  const [answer, setAnswer] = React.useState<LocalizedText>({ ...EMPTY_L10N });
  const [evidence, setEvidence] = React.useState("");
  const [others, setOthers] = React.useState<Record<string, LocalizedText>>({
    shafii: { ...EMPTY_L10N },
    maliki: { ...EMPTY_L10N },
    hanbali: { ...EMPTY_L10N },
  });
  const [categoryId, setCategoryId] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [imageUrl, setImageUrl] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [submitErr, setSubmitErr] = React.useState<unknown>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const sortedDrafts = drafts.data ? sortByCategoryDate(drafts.data, locale) : [];
  const editing = drafts.data?.find((x) => x.id === editingId) ?? null;

  async function submit(): Promise<void> {
    setSubmitting(true);
    setSubmitErr(null);
    setSaved(false);
    try {
      const created = (await createTopic.mutateAsync({
        title: question,
        description: answer,
        category_id: categoryId || null,
        author_name: author.trim() || null,
        featured_image_url: imageUrl.trim() || null,
      })) as unknown as { id?: string };
      if (!created || typeof created.id !== "string") {
        throw new Error("bad topic create payload");
      }
      const evidenceRefs = evidence.split("\n").map((s) => s.trim()).filter(Boolean);
      await createPosition.mutateAsync({
        topic_id: created.id,
        madhab: "hanafi",
        position_text: answer,
        evidence_refs: evidenceRefs,
      });
      for (const m of OTHER_MADHABS) {
        const text = others[m] ?? { ...EMPTY_L10N };
        if (text.fa.trim() || text.ar.trim() || text.en.trim()) {
          await createPosition.mutateAsync({
            topic_id: created.id,
            madhab: m,
            position_text: text,
            evidence_refs: [],
          });
        }
      }
      setSaved(true);
      setStep(1);
      setQuestion({ ...EMPTY_L10N });
      setAnswer({ ...EMPTY_L10N });
      setEvidence("");
      setOthers({
        shafii: { ...EMPTY_L10N },
        maliki: { ...EMPTY_L10N },
        hanbali: { ...EMPTY_L10N },
      });
      setCategoryId("");
      setAuthor("");
      setImageUrl("");
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="panel" aria-label={t("fatwa.registerTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.registerTitle")}</h2>
          <span className="panel-hint">
            {t("fatwa.stepContent")} · {step} / 4
          </span>
        </div>
        {saved && <Badge tone="success">{t("fatwa.fatwaRegistered")}</Badge>}
        {step === 1 && (
          <div>
            <LocalizedInput id="reg-q" label={t("fatwa.fieldQuestion")} value={question} onChange={setQuestion} />
            <LocalizedInput
              id="reg-a"
              label={t("fatwa.fieldAnswer")}
              value={answer}
              onChange={setAnswer}
              multiline
              rows={4}
            />
            <div className="field">
              <label htmlFor="reg-ev">{t("fatwa.fieldEvidenceRefs")}</label>
              <textarea
                id="reg-ev"
                className="input"
                rows={3}
                dir="auto"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </div>
            {OTHER_MADHABS.map((m) => (
              <LocalizedInput
                key={m}
                id={`reg-other-${m}`}
                label={`${t("fatwa.fieldOtherMadhab")} ${t(`fatwa.madhab_${m}`)}`}
                value={others[m] ?? { ...EMPTY_L10N }}
                onChange={(v) => setOthers((prev) => ({ ...prev, [m]: v }))}
                multiline
                rows={3}
              />
            ))}
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="field">
              <label htmlFor="reg-cat">{t("fatwa.selectCategory")}</label>
              <select
                id="reg-cat"
                className="input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t("fatwa.selectCategory")}</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {catName(c, locale) || c.slug}
                  </option>
                ))}
              </select>
            </div>
            {categories.data && categories.data.length === 0 && (
              <p className="hint">{t("fatwa.noCategoriesHint")}</p>
            )}
          </div>
        )}
        {step === 3 && (
          <div className="field">
            <label htmlFor="reg-author">{t("fatwa.stepAuthor")}</label>
            <input
              id="reg-author"
              className="input"
              value={author}
              placeholder={t("fatwa.authorPlaceholder")}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        )}
        {step === 4 && (
          <div>
            <div className="field">
              <label htmlFor="reg-img">{t("fatwa.imageUrlLabel")}</label>
              <input
                id="reg-img"
                className="input"
                dir="ltr"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
              <p className="hint">{t("fatwa.imageUrlHint")}</p>
            </div>
            {imageUrl.startsWith("http") ? (
              <div className="field">
                <span>{t("fatwa.imagePreview")}</span>
                <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "12rem", display: "block", marginTop: "0.5rem" }} />
              </div>
            ) : null}
          </div>
        )}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem" }}>
          {step > 1 && (
            <Button size="sm" variant="secondary" onClick={() => setStep(step - 1)}>
              {t("fatwa.stepPrev")}
            </Button>
          )}
          {step < 4 && (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              {t("fatwa.stepNext")}
            </Button>
          )}
          {step === 4 && (
            <Button size="sm" disabled={submitting} onClick={submit}>
              {submitting ? t("common.loading") : t("fatwa.submitFatwa")}
            </Button>
          )}
          {submitErr !== null && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(submitErr)}
            </span>
          )}
        </div>
      </section>

      <section className="panel" aria-label={t("fatwa.registeredTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.registeredTitle")}</h2>
          <span className="panel-hint">{t("fatwa.sortByCategoryDate")}</span>
        </div>
        {drafts.isLoading && <div className="empty">{t("common.loading")}</div>}
        {drafts.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => drafts.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {drafts.data && sortedDrafts.length === 0 && (
          <div className="empty">{t("fatwa.emptyTopics")}</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {sortedDrafts.map((tp) => (
            <li
              key={tp.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--x-line)",
              }}
            >
              <span style={{ flex: "1 1 12rem" }}>{topicName(tp, locale)}</span>
              <span className="hint" style={{ margin: 0 }}>
                {catName(tp.category, locale)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditingId(editingId === tp.id ? null : tp.id)}
              >
                {t("fatwa.editTopic")}
              </Button>
              <Button
                size="sm"
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({ id: tp.id, status: "in_review" })
                }
              >
                {t("fatwa.sendToReview")}
              </Button>
            </li>
          ))}
        </ul>
        {editing && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--x-line)", paddingTop: "1rem" }}>
            <TopicEditForm initial={editing} onDone={() => setEditingId(null)} />
          </div>
        )}
      </section>
    </div>
  );
}

function CategoriesTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const categories = useFatwaCategories();
  const create = useCreateFatwaCategory();
  const update = useUpdateFatwaCategory();
  const remove = useDeleteFatwaCategory();
  const [editing, setEditing] = React.useState<FatwaCategory | null | "new">(null);
  const [slug, setSlug] = React.useState("");
  const [title, setTitle] = React.useState<LocalizedText>({ ...EMPTY_L10N });
  const pending = create.isPending || update.isPending || remove.isPending;
  const err = create.isError
    ? create.error
    : update.isError
      ? update.error
      : remove.isError
        ? remove.error
        : null;

  function startEdit(c: FatwaCategory | "new"): void {
    setEditing(c);
    if (c === "new") {
      setSlug("");
      setTitle({ ...EMPTY_L10N });
    } else {
      setSlug(c.slug);
      setTitle({ ...c.title });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="panel" aria-label={t("fatwa.categoriesTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.categoriesTitle")}</h2>
          <Button size="sm" variant="secondary" onClick={() => startEdit("new")}>
            {t("fatwa.newCategory")}
          </Button>
        </div>
        {categories.isLoading && <div className="empty">{t("common.loading")}</div>}
        {categories.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => categories.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {categories.data && categories.data.length === 0 && (
          <div className="empty">{t("fatwa.emptyCategories")}</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {categories.data?.map((c) => (
            <li
              key={c.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--x-line)",
              }}
            >
              <span style={{ flex: "1 1 12rem" }}>{catName(c, locale) || c.slug}</span>
              <span className="hint" style={{ margin: 0 }} dir="ltr">
                {c.slug}
              </span>
              <Button size="sm" variant="secondary" onClick={() => startEdit(c)}>
                {t("fatwa.editCategory")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => remove.mutate(c.id)}
              >
                {t("fatwa.deleteCategory")}
              </Button>
            </li>
          ))}
        </ul>
        {err && (
          <p className="form-error" style={{ marginTop: "0.75rem" }}>
            {errText(err)}
          </p>
        )}
      </section>
      {editing && (
        <section className="panel">
          <div className="field">
            <label htmlFor="cat-slug">{t("fatwa.fieldSlug")}</label>
            <input
              id="cat-slug"
              className="input"
              dir="ltr"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <LocalizedInput
            id="cat-title"
            label={t("fatwa.fieldCategoryTitle")}
            value={title}
            onChange={setTitle}
          />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Button
              size="sm"
              disabled={pending || !slug.trim()}
              onClick={() => {
                const body: FatwaCategoryBody = { slug: slug.trim(), title };
                if (editing === "new") {
                  create.mutate(body, { onSuccess: () => setEditing(null) });
                } else {
                  update.mutate({ id: editing.id, body }, { onSuccess: () => setEditing(null) });
                }
              }}
            >
              {pending ? t("common.loading") : t("fatwa.saveCategory")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              {t("fatwa.cancel")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewTab(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const queue = useFatwaTopics({ status: "in_review" });
  const setStatus = useSetTopicStatus();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [actionErr, setActionErr] = React.useState<unknown>(null);
  const [approvingId, setApprovingId] = React.useState<string | null>(null);
  const editing = queue.data?.find((x) => x.id === editingId) ?? null;

  async function approve(id: string): Promise<void> {
    // تأیید از بررسی یعنی دو PATCH پیاپی: approved سپس published.
    setActionErr(null);
    setApprovingId(id);
    try {
      await setStatus.mutateAsync({ id, status: "approved" });
      await setStatus.mutateAsync({ id, status: "published" });
    } catch (err) {
      setActionErr(err);
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section className="panel" aria-label={t("fatwa.reviewTitle")}>
        <div className="panel-head">
          <h2>{t("fatwa.reviewTitle")}</h2>
        </div>
        {queue.isLoading && <div className="empty">{t("common.loading")}</div>}
        {queue.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => queue.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {queue.data && queue.data.length === 0 && (
          <div className="empty">{t("fatwa.emptyReview")}</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {queue.data?.map((tp) => (
            <li
              key={tp.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "0.4rem 0",
                borderTop: "1px solid var(--x-line)",
              }}
            >
              <span style={{ flex: "1 1 12rem" }}>{topicName(tp, locale)}</span>
              <span className="hint" style={{ margin: 0 }}>
                {catName(tp.category, locale)}
              </span>
              <span className="hint" style={{ margin: 0 }}>
                {tp.author_name ?? ""}
              </span>
              <span className="hint" style={{ margin: 0 }}>
                {tp.created_at ? formatDate(tp.created_at) : ""}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditingId(editingId === tp.id ? null : tp.id)}
              >
                {t("fatwa.editTopic")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: tp.id, status: "rejected" })}
              >
                {t("fatwa.rejectFatwa")}
              </Button>
              <Button
                size="sm"
                disabled={approvingId === tp.id}
                onClick={() => approve(tp.id)}
              >
                {approvingId === tp.id ? t("common.loading") : t("fatwa.approveFatwa")}
              </Button>
            </li>
          ))}
        </ul>
        {actionErr !== null && (
          <p className="form-error" style={{ marginTop: "0.75rem" }}>
            {errText(actionErr)}
          </p>
        )}
      </section>
      {editing && (
        <section className="panel">
          <TopicEditForm initial={editing} onDone={() => setEditingId(null)} />
        </section>
      )}
    </div>
  );
}

function PublishedTab(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const published = useFatwaTopics({ status: "published" });
  const setStatus = useSetTopicStatus();
  const sorted = published.data ? sortByCategoryDate(published.data, locale) : [];

  return (
    <section className="panel" aria-label={t("fatwa.publishedTitle")}>
      <div className="panel-head">
        <h2>{t("fatwa.publishedTitle")}</h2>
        <span className="panel-hint">{t("fatwa.sortByCategoryDate")}</span>
      </div>
      {published.isLoading && <div className="empty">{t("common.loading")}</div>}
      {published.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => published.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {published.data && sorted.length === 0 && (
        <div className="empty">{t("fatwa.emptyPublished")}</div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sorted.map((tp) => (
          <li
            key={tp.id}
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              flexWrap: "wrap",
              padding: "0.4rem 0",
              borderTop: "1px solid var(--x-line)",
            }}
          >
            <span style={{ flex: "1 1 12rem" }}>{topicName(tp, locale)}</span>
            <span className="hint" style={{ margin: 0 }}>
              {catName(tp.category, locale)}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {tp.published_at ? formatDate(tp.published_at) : ""}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {tp.view_count} {t("fatwa.viewsLabel")}
            </span>
            <span className="hint" style={{ margin: 0 }}>
              {tp.share_count} {t("fatwa.sharesLabel")}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: tp.id, status: "archived" })}
            >
              {t("fatwa.archiveFatwa")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
