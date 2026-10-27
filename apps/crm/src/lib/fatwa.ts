import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { EMPTY_L10N, LocalizedText, WorkflowStatus } from "./contentApi";
import { errText } from "./quran";

export { errText };

/**
 * Fatwa service — Phase 6 (CRM track).
 *
 * Typed client over the Track 1 backend contract:
 *   GET/POST /api/v1/admin/fatwa/chunks (+ /{id}/approve, /{id}/reject)
 *   GET/POST /api/v1/admin/fatwa/ingest (+ /{run_id})
 *   GET/POST /api/v1/admin/fatwa/topics, PUT /{id}
 *   GET/POST /api/v1/admin/fatwa/positions, PUT /{id}
 *   GET/POST/PUT/DELETE /api/v1/admin/fatwa/trusted-sources (+ /{id})
 *   GET /api/v1/admin/fatwa/audit
 *   GET /api/v1/admin/fatwa/usage
 *
 * ADR-001: all parsing / defaults / API access live here, never in
 * components. §9.5 AI scopes default to none; §14: no secrets are ever
 * written to or read from the audit views here.
 */

/* ------------------------------------------------------------------ */
/* shared shapes                                                       */
/* ------------------------------------------------------------------ */

/** AI policy scopes (§9.5) — every chunk/entry declares where it may be used. */
export const AI_SCOPES = [
  "fatwa",
  "assistant",
  "quiz",
  "verification",
  "semantic_search",
] as const;
export type AiScope = (typeof AI_SCOPES)[number];

/** The four Sunni madhabs for the comparison engine.
 *  Backend spelling (schemas.py / models.py): "shafii" with double-i. */
export const MADHABS = ["hanafi", "maliki", "shafii", "hanbali"] as const;
export type MadhabId = (typeof MADHABS)[number];

export function parseL10n(raw: unknown): LocalizedText {
  if (!raw || typeof raw !== "object") return { ...EMPTY_L10N };
  const r = raw as Record<string, unknown>;
  const pick = (k: string): string =>
    typeof r[k] === "string" ? (r[k] as string) : "";
  return { fa: pick("fa"), ar: pick("ar"), en: pick("en") };
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const it of raw) {
    if (typeof it === "string" && it.trim() && !out.includes(it)) out.push(it);
  }
  return out;
}

function parseWorkflowStatus(raw: unknown): WorkflowStatus {
  const s = [
    "draft",
    "in_review",
    "approved",
    "published",
    "rejected",
    "archived",
  ];
  return typeof raw === "string" && s.includes(raw) ? (raw as WorkflowStatus) : "draft";
}

export function statusLabel(t: (k: string) => string, s: string): string {
  const k = t(`status.${s}`);
  return k === `status.${s}` ? s : k;
}

/* ------------------------------------------------------------------ */
/* knowledge chunks (review queue)                                     */
/* ------------------------------------------------------------------ */

export interface FatwaChunk {
  id: string;
  /** Backend field name (FiqhKnowledgeChunk.chunk_text). */
  chunk_text: string;
  source_type: string;
  /** LocalizedText dict: book/work name shown to the user. */
  source_citation: LocalizedText;
  topic_category: string;
  madhab_scope: string;
  ai_scopes: string[];
  workflow_status: WorkflowStatus;
  /** Provenance pointer {type, id, version} — no cross-phase FK (§9.5). */
  source_ref: { type?: string; id?: string; version?: number } | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export function parseChunk(raw: unknown): FatwaChunk | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  let source_ref: FatwaChunk["source_ref"] = null;
  if (r.source_ref && typeof r.source_ref === "object") {
    const s = r.source_ref as Record<string, unknown>;
    source_ref = {
      type: typeof s.type === "string" ? s.type : undefined,
      id: typeof s.id === "string" ? s.id : undefined,
      version: typeof s.version === "number" ? s.version : undefined,
    };
  }
  return {
    id: r.id,
    chunk_text: typeof r.chunk_text === "string" ? r.chunk_text : "",
    source_type: typeof r.source_type === "string" ? r.source_type : "manual",
    source_citation: parseL10n(r.source_citation),
    topic_category: typeof r.topic_category === "string" ? r.topic_category : "",
    madhab_scope: typeof r.madhab_scope === "string" ? r.madhab_scope : "all",
    ai_scopes: parseStringArray(r.ai_scopes),
    workflow_status: parseWorkflowStatus(r.workflow_status),
    source_ref,
    approved_by: typeof r.approved_by === "string" ? r.approved_by : null,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

/** Short display label for the review queue — chunks carry no title server-side. */
export function chunkExcerpt(chunk_text: string, max = 90): string {
  const oneLine = chunk_text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export interface ChunkPage {
  items: FatwaChunk[];
  next_cursor: string | null;
}

/**
 * Knowledge Entry create body. Field names follow the backend
 * `ChunkCreateIn` schema (`chunk_text`, `source_citation` as LocalizedText
 * dict). `title` is required by the Phase 6 task contract but has no
 * backend column yet — sent anyway; Pydantic ignores extra fields, and the
 * backend track can adopt it without a client change.
 */
export interface CreateChunkBody {
  title: LocalizedText;
  chunk_text: string;
  source_type: string;
  source_ref?: { type?: string; id?: string; version?: number } | null;
  source_citation: LocalizedText;
  topic_category: string;
  madhab_scope: string;
  ai_scopes: string[];
}

export const CHUNK_KEY = ["fatwa-chunks"];

export function useFatwaChunks(workflowStatus?: string, cursor?: string) {
  return useQuery({
    queryKey: [...CHUNK_KEY, workflowStatus ?? "", cursor ?? ""],
    queryFn: async (): Promise<ChunkPage> => {
      const params = new URLSearchParams();
      if (workflowStatus) params.set("workflow_status", workflowStatus);
      if (cursor) params.set("cursor", cursor);
      const qs = params.toString();
      const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/chunks${qs ? `?${qs}` : ""}`);
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : [];
      return {
        items: items.map(parseChunk).filter((c): c is FatwaChunk => c !== null),
        next_cursor: typeof r.next_cursor === "string" ? r.next_cursor : null,
      };
    },
    retry: false,
  });
}

export function useCreateChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChunkBody) =>
      apiFetch<unknown>("/api/v1/admin/fatwa/chunks", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHUNK_KEY });
    },
  });
}

export function useApproveChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/chunks/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHUNK_KEY });
    },
  });
}

export function useRejectChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/chunks/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHUNK_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* ingestion runs                                                      */
/* ------------------------------------------------------------------ */

export interface IngestStats {
  extracted: number;
  chunked: number;
  embedded: number;
  approved: number;
  failed: number;
}

export const EMPTY_INGEST_STATS: IngestStats = {
  extracted: 0,
  chunked: 0,
  embedded: 0,
  approved: 0,
  failed: 0,
};

export interface IngestRun {
  id: string;
  status: string;
  note: string | null;
  started_at: string;
  finished_at: string | null;
  stats: IngestStats;
  error: string | null;
}

function parseIngestStats(raw: unknown): IngestStats {
  const out = { ...EMPTY_INGEST_STATS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(out) as (keyof IngestStats)[]) {
    if (typeof r[k] === "number") out[k] = r[k] as number;
  }
  return out;
}

export function parseIngestRun(raw: unknown): IngestRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    status: typeof r.status === "string" ? r.status : "unknown",
    note: typeof r.note === "string" ? r.note : null,
    started_at: typeof r.started_at === "string" ? r.started_at : "",
    finished_at: typeof r.finished_at === "string" ? r.finished_at : null,
    stats: parseIngestStats(r.stats),
    error: typeof r.error === "string" ? r.error : null,
  };
}

export const INGEST_KEY = ["fatwa-ingest"];

export function useIngestRuns() {
  return useQuery({
    queryKey: INGEST_KEY,
    queryFn: async (): Promise<IngestRun[]> => {
      const raw = await apiFetch<unknown>("/api/v1/admin/fatwa/ingest");
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      return items.map(parseIngestRun).filter((x): x is IngestRun => x !== null);
    },
    retry: false,
  });
}

export function useIngestRun(runId: string | null) {
  return useQuery({
    queryKey: [...INGEST_KEY, runId],
    queryFn: async (): Promise<IngestRun> => {
      const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/ingest/${runId}`);
      const run = parseIngestRun(raw);
      if (!run) throw new Error("bad ingest run payload");
      return run;
    },
    enabled: runId !== null,
    retry: false,
  });
}

export function useTriggerIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) =>
      apiFetch<unknown>("/api/v1/admin/fatwa/ingest", {
        method: "POST",
        // Backend IngestTriggerIn: {source_type: "text"|"file", payload: dict, ...}
        body: { source_type: "text", payload: note ? { note } : {}, ai_scopes: [] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INGEST_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* fiqh topics + madhab positions                                      */
/* ------------------------------------------------------------------ */

export interface FiqhTopic {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  workflow_status: WorkflowStatus;
  category_id: string | null;
  category: { slug: string; title: LocalizedText } | null;
  author_name: string | null;
  featured_image_url: string | null;
  view_count: number;
  share_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export function parseTopic(raw: unknown): FiqhTopic | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  let category: FiqhTopic["category"] = null;
  if (r.category && typeof r.category === "object") {
    const c = r.category as Record<string, unknown>;
    if (typeof c.slug === "string" && c.slug) {
      category = { slug: c.slug, title: parseL10n(c.title) };
    }
  }
  return {
    id: r.id,
    title: parseL10n(r.title),
    description: parseL10n(r.description),
    workflow_status: parseWorkflowStatus(r.workflow_status),
    category_id: typeof r.category_id === "string" ? r.category_id : null,
    category,
    author_name: typeof r.author_name === "string" ? r.author_name : null,
    featured_image_url:
      typeof r.featured_image_url === "string" ? r.featured_image_url : null,
    view_count: typeof r.view_count === "number" ? r.view_count : 0,
    share_count: typeof r.share_count === "number" ? r.share_count : 0,
    published_at: typeof r.published_at === "string" ? r.published_at : null,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

export const TOPIC_KEY = ["fatwa-topics"];

export interface TopicFilters {
  status?: string;
  category?: string;
  q?: string;
  perPage?: number;
}

export function useFatwaTopics(filters?: TopicFilters) {
  const { status, category, q, perPage } = filters ?? {};
  return useQuery({
    queryKey: [...TOPIC_KEY, status ?? "", category ?? "", q ?? "", perPage ?? 100],
    queryFn: async (): Promise<FiqhTopic[]> => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      if (q) params.set("q", q);
      params.set("per_page", String(perPage ?? 100));
      const qs = params.toString();
      const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/topics${qs ? `?${qs}` : ""}`);
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      return items.map(parseTopic).filter((x): x is FiqhTopic => x !== null);
    },
    retry: false,
  });
}

export interface TopicBody {
  title: LocalizedText;
  description: LocalizedText;
  category_id?: string | null;
  author_name?: string | null;
  featured_image_url?: string | null;
}

export function useCreateTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TopicBody) =>
      apiFetch<unknown>("/api/v1/admin/fatwa/topics", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOPIC_KEY });
    },
  });
}

export function useUpdateTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TopicBody }) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/topics/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOPIC_KEY });
    },
  });
}

/**
 * Workflow transition for a topic. The backend enforces the §9 machine
 * (no jumps): approve from review means two sequential PATCHes here in
 * the CRM (approved, then published); reject → rejected; archive →
 * archived. No backend bypass.
 */
export function useSetTopicStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/topics/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOPIC_KEY });
    },
  });
}

export interface MadhabPosition {
  id: string;
  topic_id: string;
  madhab: MadhabId;
  position_text: LocalizedText;
  /** Backend `evidence_refs` (JSONB list) — provenance for the position. */
  evidence_refs: string[];
  workflow_status: WorkflowStatus;
  created_at: string;
  updated_at: string;
}

export function parsePosition(raw: unknown): MadhabPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const madhab = typeof r.madhab === "string" ? r.madhab : "";
  const topic_id = typeof r.topic_id === "string" ? r.topic_id : "";
  const madhabId = (MADHABS as readonly string[]).includes(madhab)
    ? (madhab as MadhabId)
    : "hanafi";
  return {
    // The compare output shape carries no id; synthesize a stable one so
    // admin rows stay keyable and PUT-capable when the id arrives.
    id:
      typeof r.id === "string" && r.id
        ? r.id
        : `${topic_id || "topic"}:${madhabId}`,
    topic_id,
    madhab: madhabId,
    position_text: parseL10n(r.position_text),
    evidence_refs: parseStringArray(r.evidence_refs),
    workflow_status: parseWorkflowStatus(r.workflow_status),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

export const POSITION_KEY = ["fatwa-positions"];

export function useMadhabPositions(topicId?: string) {
  return useQuery({
    queryKey: [...POSITION_KEY, topicId ?? ""],
    queryFn: async (): Promise<MadhabPosition[]> => {
      const qs = topicId ? `?topic_id=${encodeURIComponent(topicId)}` : "";
      const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/positions${qs}`);
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      const all = items.map(parsePosition).filter((x): x is MadhabPosition => x !== null);
      // Client-side guard in case the backend ignores the topic filter.
      return topicId ? all.filter((p) => p.topic_id === topicId) : all;
    },
    retry: false,
  });
}

export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    // Backend PositionCreateIn: {madhab, position_text: dict, evidence_refs}.
    // topic_id rides along in the body (Pydantic ignores extras) because the
    // task contract uses flat /positions endpoints; the router will bind it.
    mutationFn: (body: {
      topic_id: string;
      madhab: MadhabId;
      position_text: LocalizedText;
      evidence_refs: string[];
    }) => apiFetch<unknown>("/api/v1/admin/fatwa/positions", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: POSITION_KEY });
    },
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { position_text: LocalizedText; evidence_refs: string[] };
    }) => apiFetch<unknown>(`/api/v1/admin/fatwa/positions/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: POSITION_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* trusted external sources (§9.6 — super_admin only)                  */
/* ------------------------------------------------------------------ */

export interface TrustedSource {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  allowed_paths: string[];
  priority: number;
  citation_required: boolean;
  last_checked_at: string | null;
  crawl_policy: string;
}

export function parseTrustedSource(raw: unknown): TrustedSource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    base_url: typeof r.base_url === "string" ? r.base_url : "",
    enabled: r.enabled === true,
    allowed_paths: parseStringArray(r.allowed_paths),
    priority: typeof r.priority === "number" ? r.priority : 0,
    citation_required: r.citation_required !== false,
    last_checked_at: typeof r.last_checked_at === "string" ? r.last_checked_at : null,
    crawl_policy: typeof r.crawl_policy === "string" ? r.crawl_policy : "",
  };
}

export const SOURCE_KEY = ["fatwa-trusted-sources"];

export function useTrustedSources() {
  return useQuery({
    queryKey: SOURCE_KEY,
    queryFn: async (): Promise<TrustedSource[]> => {
      const raw = await apiFetch<unknown>("/api/v1/admin/fatwa/trusted-sources");
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      return items.map(parseTrustedSource).filter((x): x is TrustedSource => x !== null);
    },
    retry: false,
  });
}

export interface TrustedSourceBody {
  name: string;
  base_url: string;
  enabled: boolean;
  allowed_paths: string[];
  priority: number;
  citation_required: boolean;
  // NOTE: §9.6 also wants a crawl/search policy field, but the backend
  // TrustedSourceIn has none yet — the form omits it until the backend
  // adopts it; the parser already reads it if it appears.
}

export function useCreateTrustedSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrustedSourceBody) =>
      apiFetch<unknown>("/api/v1/admin/fatwa/trusted-sources", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCE_KEY });
    },
  });
}

export function useUpdateTrustedSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TrustedSourceBody }) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/trusted-sources/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCE_KEY });
    },
  });
}

export function useDeleteTrustedSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/trusted-sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SOURCE_KEY });
    },
  });
}

/* ------------------------------------------------------------------ */
/* audit + usage                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fatwa audit entries (asked/answered). §14: secrets are never stored in
 * audit old_values/new_values — display whatever the API returns as-is.
 */
export interface FatwaAuditEntry {
  id: string;
  actor_id: string | null;
  actor_type: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  request_id: string | null;
  created_at: string;
  summary: string | null;
}

export function useFatwaAudit(limit = 100) {
  return useQuery({
    queryKey: ["fatwa-audit", limit],
    queryFn: async (): Promise<FatwaAuditEntry[]> => {
      const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/audit?limit=${limit}`);
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      const out: FatwaAuditEntry[] = [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const e = it as Record<string, unknown>;
        out.push({
          id: typeof e.id === "string" ? e.id : "",
          actor_id: typeof e.actor_id === "string" ? e.actor_id : null,
          actor_type: typeof e.actor_type === "string" ? e.actor_type : null,
          action: typeof e.action === "string" ? e.action : "",
          entity_type: typeof e.entity_type === "string" ? e.entity_type : null,
          entity_id: typeof e.entity_id === "string" ? e.entity_id : null,
          ip: typeof e.ip === "string" ? e.ip : null,
          request_id: typeof e.request_id === "string" ? e.request_id : null,
          created_at: typeof e.created_at === "string" ? e.created_at : "",
          summary: typeof e.summary === "string" ? e.summary : null,
        });
      }
      return out;
    },
    retry: false,
  });
}

export interface FatwaUsageEntry {
  user_id: string;
  user_label: string;
  period: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export function useFatwaUsage() {
  return useQuery({
    queryKey: ["fatwa-usage"],
    queryFn: async (): Promise<FatwaUsageEntry[]> => {
      const raw = await apiFetch<unknown>("/api/v1/admin/fatwa/usage");
      const r = (raw ?? {}) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? r.items : Array.isArray(raw) ? raw : [];
      const out: FatwaUsageEntry[] = [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const e = it as Record<string, unknown>;
        const num = (k: string): number => (typeof e[k] === "number" ? (e[k] as number) : 0);
        out.push({
          user_id: typeof e.user_id === "string" ? e.user_id : "",
          user_label: typeof e.user_label === "string" ? e.user_label : "",
          period: typeof e.period === "string" ? e.period : "",
          requests: num("requests"),
          prompt_tokens: num("prompt_tokens"),
          completion_tokens: num("completion_tokens"),
          total_tokens: num("total_tokens"),
          cost_usd: num("cost_usd"),
        });
      }
      return out;
    },
    retry: false,
  });
}

/* ------------------------------------------------------------------ */
/* fatwa categories — defined in CRM, selected (never typed) in the    */
/* registration form                                                   */
/* ------------------------------------------------------------------ */

export interface FatwaCategory {
  id: string;
  slug: string;
  title: LocalizedText;
  created_at: string;
}

export function parseFatwaCategory(raw: unknown): FatwaCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.slug !== "string" || !r.slug) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: parseL10n(r.title),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

export const FATWA_CATEGORY_KEY = ["fatwa-categories"];

export function useFatwaCategories() {
  return useQuery({
    queryKey: FATWA_CATEGORY_KEY,
    queryFn: async (): Promise<FatwaCategory[]> => {
      const raw = await apiFetch<unknown>("/api/v1/admin/fatwa/categories");
      const items = Array.isArray(raw) ? raw : [];
      return items
        .map(parseFatwaCategory)
        .filter((x): x is FatwaCategory => x !== null);
    },
    retry: false,
  });
}

export interface FatwaCategoryBody {
  slug: string;
  title: LocalizedText;
}

export function useCreateFatwaCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FatwaCategoryBody) =>
      apiFetch<unknown>("/api/v1/admin/fatwa/categories", { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FATWA_CATEGORY_KEY });
    },
  });
}

export function useUpdateFatwaCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: FatwaCategoryBody }) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/categories/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FATWA_CATEGORY_KEY });
    },
  });
}

export function useDeleteFatwaCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/admin/fatwa/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FATWA_CATEGORY_KEY });
    },
  });
}
