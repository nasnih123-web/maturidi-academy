/**
 * Phase 14 — CRM Control Center service layer (Track 2: CRM frontend).
 *
 * All business logic / API access for the unified admin surface lives here
 * (ADR-001/0002: no domain logic inside components). Pages only consume the
 * typed hooks in `lib/admin14Hooks.ts`, which wrap these functions.
 *
 * NOTE on connections/builds/BI: those are covered by the sibling track's
 * `lib/ops14.ts` (connections status, build releases/rebuild/prereqs,
 * Metabase URL) — this file does NOT duplicate them. The contract below is
 * the Track 2 → Track 1 reconciliation surface for the CONTENT / USERS /
 * MODERATION / NOTIFICATIONS / ROLES endpoints, aligned with ADR-0011's
 * (domain, content_type) adapter registry in
 * app/modules/admin/control_registry.py.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ API CONTRACT (Track 1 — backend — reconcile on delivery)        │
 * │ Base: /api/v1/admin  ·  auth: Bearer JWT  ·  errors: §1 envelope │
 * │ Identity of a content item: (domain, content_type, id)          │
 * │ Registered adapters (ADR-0011):                                 │
 * │   content/{islamic_event,scholar_quote,page,banner,announcement}│
 * │   fatwa/{fatwa_submission,knowledge_chunk}                      │
 * │   library/library_item · lms/course · social/social_post         │
 * │   places/religious_place                                        │
 * │                                                                 │
 * │ CONTENT                                                         │
 * │  GET  /content/inbox                                            │
 * │    ?q, ?domain, ?content_type, ?status, ?author_id, ?visibility, │
 * │    ?ai_scope, ?channel, ?placement, ?date_from, ?date_to,        │
 * │    ?cursor, ?limit  → {items, total, next_cursor}                │
 * │    item: {domain, content_type, id, title, excerpt, status,      │
 * │      author_id, author_name?, visibility, ai_scopes, version,    │
 * │      created_at, updated_at, published_at?}                     │
 * │  GET  /content/items/{domain}/{content_type}/{id}               │
 * │    → ContentDetail (inbox fields + editor_route, editor_note,    │
 * │       seo{title,description,canonical,schema_type},              │
 * │       related[{domain,content_type,id,title}],                   │
 * │       native_distribution?, preview_url?)                       │
 * │  POST /content/items/{domain}/{content_type}/{id}/transition    │
 * │    {to, note?}  (delegates to the domain's own transition fn)   │
 * │  GET  /content/items/{domain}/{content_type}/{id}/versions      │
 * │    → {versions:[{version_id,version_no,status,title,changed_by,  │
 * │       changed_at,note?}]}                                       │
 * │  POST /content/items/{domain}/{content_type}/{id}/rollback      │
 * │    {version_id}                                                 │
 * │  GET  /content/items/{domain}/{content_type}/{id}/compare/      │
 * │    {version_id} → {base_title, other_title,                     │
 * │       diffs:[{field,before,after}]}                              │
 * │  --- placements (§9.5, polymorphic, no physical FK) ---         │
 * │  GET  /content/items/{domain}/{content_type}/{id}/placements    │
 * │  POST /content/items/{domain}/{content_type}/{id}/placements    │
 * │    {surface, slot?, priority, starts_at?, ends_at?, locale?,    │
 * │     audience?}                                                  │
 * │  GET  /content/placements?surface= → {placements}               │
 * │  POST /content/placements/reorder {ordered_ids}                 │
 * │  PATCH /content/placements/{pid}                                │
 * │  DELETE /content/placements/{pid}                               │
 * │  --- distribution (§9.5; unified table content_distributions,    │
 * │      enforced at serve time, see ADR-0011) ---                  │
 * │  PATCH /content/items/{domain}/{content_type}/{id}/distribution │
 * │    {policy:{web,mobile,desktop,telegram,ai_knowledge,search,     │
 * │      embed}, scheduled_at?, until_at?}                          │
 * │  --- bulk (sensitive ops: permission content.bulk + audit) ---  │
 * │  POST /content/bulk                                             │
 * │    {action, refs:[{domain,content_type,id}], payload?}           │
 * │    actions: transition | set_placement | set_distribution |     │
 * │             schedule | export                                   │
 * │    → {results:[{domain,content_type,id,ok,error?}], audit_id}   │
 * │  --- calendar ---                                               │
 * │  GET  /content/calendar?from=&to=                                │
 * │    → {events:[{domain,content_type,id,title,starts_at,ends_at?, │
 * │       surface,status,conflict_with:[{domain,content_type,id,    │
 * │       title}]}]}                                                │
 * │  --- audit (§14) ---                                            │
 * │  GET  /content/audit?domain=&content_type=&id=                   │
 * │    → {entries:[{id,actor_id,actor_name,action,entity_type,      │
 * │       entity_id,old_values,new_values,ip,created_at}]}           │
 * │                                                                 │
 * │ AI SOURCE CENTER                                                │
 * │  GET  /content/ai-sources?status=&scope=                        │
 * │    → {items:[{domain,content_type,id,title,provenance,          │
 * │       scopes[],ingestion_status,last_embedding_at,              │
 * │       embedding_chunks,extraction_errors[]}]}                   │
 * │  POST /content/ai-sources/{domain}/{content_type}/{id}/reindex  │
 * │    → {job_id}                                                  │
 * │                                                                 │
 * │ EXTERNAL SOURCES (§9.6; super_admin only for writes)            │
 * │  GET  /content/external-sources                                 │
 * │    → {sources:[{id,name,domain,enabled,policy,priority,         │
 * │       citation_required,last_checked_at,allowed_paths[]}]}       │
 * │  PATCH /content/external-sources/{id}                           │
 * │    {enabled?, policy?, priority?, allowed_paths?}               │
 * │  POST /content/external-sources/{id}/check                      │
 * │    → {ok, latency_ms?, detail?}                                 │
 * │                                                                 │
 * │ TELEGRAM CENTER                                                 │
 * │  GET  /telegram/policies → {policies:[{domain,content_type,     │
 * │    policy,channel,caption_template,dedupe_window_hours,        │
 * │    enabled}]}  policy ∈ never|manual_approval|auto_publish|     │
 * │    scheduled                                                    │
 * │  PATCH /telegram/policies/{domain}/{content_type}               │
 * │  GET  /telegram/queue → {items:[TgQueueItem]}                   │
 * │  POST /telegram/queue/{id}/approve | /reject {note?}            │
 * │  GET  /telegram/schedule → {items:[TgQueueItem]}                │
 * │  GET  /telegram/history → {messages:[TgSentMessage]}            │
 * │  POST /telegram/history/{id}/retry                               │
 * │  GET  /telegram/dedupe → {candidates:[DedupeCandidate]}         │
 * │                                                                 │
 * │ USERS (users.view360)                                           │
 * │  GET  /users?q=&role=&cursor=&limit= → {items,total,next_cursor} │
 * │  GET  /users/{id} → UserProfile360                             │
 * │  PATCH /users/{id}/roles {roles:[string]}                       │
 * │  POST /users/{id}/sessions/revoke                               │
 * │                                                                 │
 * │ MODERATION                                                      │
 * │  GET  /moderation/flags?status=&cursor= → {items:[ContentFlag]}  │
 * │  POST /moderation/flags/{id}/action {action, note?}             │
 * │    actions: dismiss | warn_user | hide_content | ban_user       │
 * │                                                                 │
 * │ NOTIFICATIONS (notifications.broadcast)                         │
 * │  POST /notifications/broadcast                                  │
 * │    {title, body, channels, audience:{mode:"all"|"roles"|"users", │
 * │     roles?, user_ids?}, schedule_at?}                           │
 * │    → {broadcast_id, estimated_recipients}                      │
 * │  POST /notifications/preview {title, body, channels, user_id}   │
 * │    → {per_channel:[{channel, will_receive, reason}]}            │
 * │  GET  /notifications/log?cursor= → {items:[NotificationLogEntry]│
 * │    , next_cursor}                                               │
 * │                                                                 │
 * │ ROLES (super_admin only, §2; new keys: content.bulk,            │
 * │ connections.test, builds.manage, notifications.broadcast,      │
 * │ users.view360 — registered in seed.py BASE_PERMISSIONS)         │
 * │  GET  /roles → {roles:[Role], permissions:[Permission]}         │
 * │  POST /roles {name, description?} → Role                        │
 * │  PATCH /roles/{id} {name?, description?}                        │
 * │  DELETE /roles/{id}  (super_admin can never be deleted/emptied) │
 * │  PUT  /roles/{id}/permissions {permission_keys:[string]}        │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Contract §1 note: all datetimes are UTC ISO 8601; the UI localizes them
 * via lib/i18n formatDate. Audit follows §14 (no secrets in old/new values).
 */

import { apiFetch } from "./api";
import { errText } from "./quran";

export { errText };

/* ------------------------------------------------------------------ */
/* tolerant readers (Track 1 shapes adapt gracefully)                  */
/* ------------------------------------------------------------------ */

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function pickString(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function pickBool(r: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : fallback;
}

function pickNum(r: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickArr<T>(r: Record<string, unknown>, ...keys: string[]): T[] {
  for (const k of keys) {
    const v = r[k];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

/** Accept `{items:[…]}`, `{results:[…]}`, a bare array, or `{data:[…]}`. */
export function readList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const r = asRecord(raw);
  return pickArr<T>(r, "items", "results", "data", "messages", "entries", "sources", "candidates", "versions", "placements");
}

function readPaged<T>(raw: unknown): { items: T[]; total: number; next_cursor: string | null } {
  const r = asRecord(raw);
  const total = pickNum(r, "total", "count") ?? readList<T>(raw).length;
  const nc = pickString(r, "next_cursor", "cursor");
  return { items: readList<T>(raw), total, next_cursor: nc || null };
}

function q(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ------------------------------------------------------------------ */
/* content identity: (domain, content_type, id) — ADR-0011             */
/* ------------------------------------------------------------------ */

export type WorkflowStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "rejected"
  | "archived";

export interface ContentRef {
  domain: string;
  content_type: string;
  id: string;
}

/** Adapter pairs registered by the backend (ADR-0011), for filter UI. */
export const CONTENT_SOURCES: { domain: string; content_type: string }[] = [
  { domain: "content", content_type: "islamic_event" },
  { domain: "content", content_type: "scholar_quote" },
  { domain: "content", content_type: "page" },
  { domain: "content", content_type: "banner" },
  { domain: "content", content_type: "announcement" },
  { domain: "fatwa", content_type: "fatwa_submission" },
  { domain: "fatwa", content_type: "knowledge_chunk" },
  { domain: "library", content_type: "library_item" },
  { domain: "lms", content_type: "course" },
  { domain: "social", content_type: "social_post" },
  { domain: "places", content_type: "religious_place" },
];

export const CONTENT_DOMAINS = ["content", "fatwa", "library", "lms", "social", "places"] as const;

export const DISTRIBUTION_CHANNELS = [
  "web",
  "mobile",
  "desktop",
  "telegram",
  "ai_knowledge",
  "search",
  "embed",
] as const;
export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

export const AI_SCOPES = ["none", "fatwa", "assistant", "quiz", "verification", "semantic_search"] as const;
export type AiScope = (typeof AI_SCOPES)[number];

/** Canonical item path for the admin content API. */
function itemPath(ref: Pick<ContentRef, "domain" | "content_type" | "id">): string {
  return `/api/v1/admin/content/items/${ref.domain}/${ref.content_type}/${ref.id}`;
}

/**
 * Resolve a (domain, content_type, id) ref from a live domain event
 * (contract §4 outbox → /ws/events). Tolerant: prefers explicit
 * payload.domain/payload.content_type, falls back to mapping the
 * aggregate_type to its registered adapter pair. Returns null when the
 * event does not identify actionable content — the feed then shows no
 * action buttons for that row.
 */
export interface FeedEventLike {
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}

const AGGREGATE_TO_ADAPTER: Record<string, { domain: string; content_type: string }> = {
  islamic_event: { domain: "content", content_type: "islamic_event" },
  scholar_quote: { domain: "content", content_type: "scholar_quote" },
  page: { domain: "content", content_type: "page" },
  banner: { domain: "content", content_type: "banner" },
  announcement: { domain: "content", content_type: "announcement" },
  fatwa_submission: { domain: "fatwa", content_type: "fatwa_submission" },
  knowledge_chunk: { domain: "fatwa", content_type: "knowledge_chunk" },
  library_item: { domain: "library", content_type: "library_item" },
  course: { domain: "lms", content_type: "course" },
  social_post: { domain: "social", content_type: "social_post" },
  religious_place: { domain: "places", content_type: "religious_place" },
};

export function contentRefFromEvent(ev: FeedEventLike): Pick<ContentRef, "domain" | "content_type" | "id"> | null {
  const p = asRecord(ev.payload);
  const domain = pickString(p, "domain");
  const contentType = pickString(p, "content_type");
  if (domain && contentType && ev.aggregate_id) {
    return { domain, content_type: contentType, id: String(ev.aggregate_id) };
  }
  const mapped = AGGREGATE_TO_ADAPTER[ev.aggregate_type];
  if (mapped && ev.aggregate_id) {
    return { ...mapped, id: String(ev.aggregate_id) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* content inbox                                                       */
/* ------------------------------------------------------------------ */

export interface ContentInboxItem extends ContentRef {
  title: string;
  excerpt: string;
  status: WorkflowStatus;
  author_id: string;
  author_name: string;
  visibility: string;
  ai_scopes: AiScope[];
  version_no: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

function parseInboxItem(raw: unknown): ContentInboxItem {
  const r = asRecord(raw);
  return {
    domain: pickString(r, "domain") || "content",
    content_type: pickString(r, "content_type", "type") || "page",
    id: pickString(r, "id", "uuid"),
    title: pickString(r, "title", "name") || "—",
    excerpt: pickString(r, "excerpt", "summary", "description"),
    status: (pickString(r, "status", "workflow_status") || "draft") as WorkflowStatus,
    author_id: pickString(r, "author_id", "owner_id"),
    author_name: pickString(r, "author_name", "owner_name", "author_id", "owner_id"),
    visibility: pickString(r, "visibility", "access_policy") || "public",
    ai_scopes: pickArr<string>(r, "ai_scopes", "ai_policy").filter((s): s is AiScope =>
      (AI_SCOPES as readonly string[]).includes(s),
    ),
    version_no: pickNum(r, "version_no", "version") ?? 1,
    created_at: pickString(r, "created_at"),
    updated_at: pickString(r, "updated_at"),
    published_at: pickString(r, "published_at", "scheduled_at") || null,
  };
}

export interface InboxFilters {
  q?: string;
  domain?: string;
  content_type?: string;
  status?: string;
  author_id?: string;
  visibility?: string;
  ai_scope?: string;
  channel?: string;
  placement?: string;
  date_from?: string;
  date_to?: string;
  cursor?: string;
  limit?: number;
}

export async function listContentInbox(filters: InboxFilters = {}): Promise<{
  items: ContentInboxItem[];
  total: number;
  next_cursor: string | null;
}> {
  // بک‌اند واقعی: GET /api/v1/admin/content/items (همان فیلترها؛ channel → distribution_channel)
  const { channel, ...rest } = filters;
  const params: Record<string, string | number | undefined> = { ...rest };
  if (channel) params["distribution_channel"] = channel;
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/items${q(params)}`);
  const paged = readPaged<unknown>(raw);
  return { ...paged, items: paged.items.map(parseInboxItem) };
}

/* ------------------------------------------------------------------ */
/* content detail / workflow                                           */
/* ------------------------------------------------------------------ */

export interface ContentVersion {
  version_id: string;
  version_no: number;
  status: WorkflowStatus;
  title: string;
  changed_by: string;
  changed_at: string;
  note: string | null;
}

export interface ContentDetail extends ContentInboxItem {
  /** Deep-link route of the domain's own typed editor (never a generic JSON editor). */
  editor_route: string;
  /** Honest note when the domain keeps its editor in its own module. */
  editor_note: string | null;
  preview_url: string | null;
  seo: { title: string; description: string; canonical: string; schema_type: string };
  related: ContentRef[];
  related_titles: Record<string, string>;
  native_distribution: Record<string, boolean> | null;
}

function parseVersion(raw: unknown): ContentVersion {
  const r = asRecord(raw);
  return {
    version_id: pickString(r, "version_id", "id"),
    version_no: pickNum(r, "version_no", "version") ?? 1,
    status: (pickString(r, "status", "workflow_status") || "draft") as WorkflowStatus,
    title: pickString(r, "title") || "—",
    changed_by: pickString(r, "changed_by", "actor"),
    changed_at: pickString(r, "changed_at", "created_at"),
    note: pickString(r, "note") || null,
  };
}

export async function getContentDetail(ref: Pick<ContentRef, "domain" | "content_type" | "id">): Promise<ContentDetail> {
  const raw = await apiFetch<unknown>(itemPath(ref));
  const base = parseInboxItem(raw);
  const r = asRecord(raw);
  const seo = asRecord(r.seo);
  const relatedRaw = pickArr<Record<string, unknown>>(r, "related");
  const related_titles: Record<string, string> = {};
  const related: ContentRef[] = relatedRaw.map((x) => {
    const rr: ContentRef = {
      domain: pickString(x, "domain") || "content",
      content_type: pickString(x, "content_type") || "page",
      id: pickString(x, "id"),
    };
    related_titles[`${rr.domain}/${rr.content_type}/${rr.id}`] = pickString(x, "title") || "—";
    return rr;
  });
  const nd = r.native_distribution;
  return {
    ...base,
    editor_route: pickString(r, "editor_route") || `/content`,
    editor_note: pickString(r, "editor_note") || null,
    preview_url: pickString(r, "preview_url") || null,
    seo: {
      title: pickString(seo, "title"),
      description: pickString(seo, "description"),
      canonical: pickString(seo, "canonical"),
      schema_type: pickString(seo, "schema_type"),
    },
    related,
    related_titles,
    native_distribution: nd !== null && typeof nd === "object" ? (nd as Record<string, boolean>) : null,
  };
}

export async function transitionContent(
  ref: Pick<ContentRef, "domain" | "content_type" | "id">,
  to: WorkflowStatus,
  note?: string,
): Promise<unknown> {
  return apiFetch<unknown>(`${itemPath(ref)}/transition`, {
    method: "POST",
    body: { to, note },
  });
}

export async function listVersions(ref: Pick<ContentRef, "domain" | "content_type" | "id">): Promise<ContentVersion[]> {
  // بک‌اند واقعی: نسخه‌ها در payload جزئیات‌اند؛ برای کتابخانه endpoint جدا هم هست
  if (ref.domain === "library" && ref.content_type === "library_item") {
    const raw = await apiFetch<unknown>(`/api/v1/admin/library/items/${ref.id}/versions`);
    return readList<unknown>(raw).map(parseVersion);
  }
  const detail = await apiFetch<unknown>(itemPath(ref));
  return pickArr<Record<string, unknown>>(asRecord(detail), "versions").map(parseVersion);
}

export async function rollbackVersion(
  ref: Pick<ContentRef, "domain" | "content_type" | "id">,
  versionId: string,
): Promise<unknown> {
  // بک‌اند واقعی: فقط کتابخانه revert دارد
  if (ref.domain === "library" && ref.content_type === "library_item") {
    return apiFetch<unknown>(`/api/v1/admin/library/items/${ref.id}/versions/${versionId}/revert`, {
      method: "POST",
    });
  }
  throw new Error("rollback_unsupported");
}

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

export interface CompareResult {
  base_title: string;
  other_title: string;
  diffs: FieldDiff[];
}

export async function compareVersions(
  ref: Pick<ContentRef, "domain" | "content_type" | "id">,
  versionId: string,
): Promise<CompareResult> {
  // مقایسه سمت‌کلاینت: snapshot نسخه در برابر وضعیت فعلی (بک‌اند compare ندارد)
  if (ref.domain !== "library" || ref.content_type !== "library_item") {
    throw new Error("compare_unsupported");
  }
  const versionsRaw = await apiFetch<unknown>(`/api/v1/admin/library/items/${ref.id}/versions`);
  const versions = readList<Record<string, unknown>>(versionsRaw);
  const target = versions.find((v) => String(v.version ?? v.version_id ?? v.id) === String(versionId));
  if (!target) throw new Error("version_not_found");
  const snap = asRecord(target.snapshot ?? {});
  const detail = await getContentDetail(ref);
  const cur: Record<string, string> = {
    title: detail.title,
    status: detail.status,
  };
  const diffs: FieldDiff[] = [];
  for (const [field, beforeRaw] of Object.entries(snap)) {
    const before = String(beforeRaw ?? "");
    const after = cur[field] ?? "";
    if (before !== after) diffs.push({ field, before, after });
  }
  return { base_title: detail.title, other_title: `نسخهٔ ${String(target.version ?? versionId)}`, diffs };
}

/* ------------------------------------------------------------------ */
/* placements                                                          */
/* ------------------------------------------------------------------ */

export interface Placement {
  id: string;
  surface: string;
  slot: string | null;
  priority: number;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  locale: string;
  audience: string | null;
  domain: string;
  content_type: string;
  content_id: string;
  content_title: string;
}

function parsePlacement(raw: unknown): Placement {
  const r = asRecord(raw);
  return {
    id: pickString(r, "id"),
    surface: pickString(r, "surface"),
    slot: pickString(r, "slot") || null,
    priority: pickNum(r, "priority", "sort_order") ?? 0,
    enabled: pickBool(r, "enabled", true),
    starts_at: pickString(r, "starts_at") || null,
    ends_at: pickString(r, "ends_at") || null,
    locale: pickString(r, "locale") || "fa",
    audience: pickString(r, "audience") || null,
    domain: pickString(r, "domain") || "content",
    content_type: pickString(r, "content_type") || "page",
    content_id: pickString(r, "content_id", "id"),
    content_title: pickString(r, "content_title", "title") || "—",
  };
}

/** Placement surfaces from contract §9.5. */
export const PLACEMENT_SURFACES = [
  "homepage.section",
  "page.section",
  "banner_area",
  "scholar_profile",
  "library_collection",
  "quran_context",
  "dashboard",
  "widget",
  "telegram",
] as const;

export interface PlacementInput {
  surface: string;
  slot?: string;
  priority: number;
  starts_at?: string | null;
  ends_at?: string | null;
  locale?: string;
  audience?: string | null;
}

export async function listItemPlacements(ref: Pick<ContentRef, "domain" | "content_type" | "id">): Promise<Placement[]> {
  // بک‌اند واقعی: GET /content/placements با فیلتر دامنه
  const raw = await apiFetch<unknown>(
    `/api/v1/admin/content/placements${q({ domain: ref.domain, content_type: ref.content_type, content_id: ref.id })}`,
  );
  return readList<unknown>(raw).map(parsePlacement);
}

export async function createPlacement(
  ref: Pick<ContentRef, "domain" | "content_type" | "id">,
  p: PlacementInput,
): Promise<Placement> {
  // بک‌اند واقعی: PUT /content/placements (upsert)
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/placements`, {
    method: "PUT",
    body: {
      domain: ref.domain,
      content_type: ref.content_type,
      content_id: ref.id,
      surface: p.surface,
      slot: p.slot ?? null,
      sort_order: p.priority ?? 0,
      audience: p.audience ?? {},
      starts_at: p.starts_at ?? null,
      ends_at: p.ends_at ?? null,
      locale: p.locale ?? null,
      active: true,
    },
  });
  return parsePlacement(raw);
}

export async function listPlacements(surface?: string): Promise<Placement[]> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/placements${q({ surface })}`);
  return readList<unknown>(raw).map(parsePlacement);
}

export async function updatePlacement(placementId: string, patch: Partial<Placement>): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/admin/content/placements/${placementId}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function deletePlacement(placementId: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/admin/content/placements/${placementId}`, { method: "DELETE" });
}

/** No-deploy reorder: server persists the new priority order. */
export async function reorderPlacements(orderedIds: string[]): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/admin/content/placements/reorder`, {
    method: "POST",
    body: { ordered_ids: orderedIds },
  });
}

/* ------------------------------------------------------------------ */
/* distribution                                                        */
/* ------------------------------------------------------------------ */

export type DistributionPolicy = Record<DistributionChannel, boolean>;

export const EMPTY_DISTRIBUTION: DistributionPolicy = {
  web: false,
  mobile: false,
  desktop: false,
  telegram: false,
  ai_knowledge: false,
  search: false,
  embed: false,
};

export function parseDistribution(r: Record<string, unknown>): DistributionPolicy {
  const out = { ...EMPTY_DISTRIBUTION };
  for (const ch of DISTRIBUTION_CHANNELS) {
    const v = r[ch];
    // شکل بک‌اند واقعی: {web: {enabled: bool, source, ...}} یا {web: bool}
    out[ch] =
      v !== null && typeof v === "object"
        ? pickBool(v as Record<string, unknown>, "enabled", false)
        : pickBool(r, ch, false);
  }
  return out;
}

export async function updateDistribution(
  ref: Pick<ContentRef, "domain" | "content_type" | "id">,
  policy: DistributionPolicy,
  scheduledAt?: string | null,
  untilAt?: string | null,
): Promise<unknown> {
  // بک‌اند واقعی: policy تخت {channel: bool} (DistributionPolicyIn)
  const flat: Record<string, boolean> = {};
  for (const [ch, v] of Object.entries(policy)) {
    flat[ch] = typeof v === "boolean" ? v : Boolean((v as { enabled?: boolean }).enabled);
  }
  return apiFetch<unknown>(`${itemPath(ref)}/distribution`, {
    method: "PATCH",
    body: { policy: flat, scheduled_at: scheduledAt ?? null, until_at: untilAt ?? null },
  });
}

export async function getDistribution(
  ref: Pick<ContentRef, "domain" | "content_type" | "id">,
): Promise<{ policy: DistributionPolicy; scheduled_at: string | null; until_at: string | null }> {
  // بک‌اند واقعی: GET /content/distribution?domain=&content_type=&id=
  const raw = await apiFetch<unknown>(
    `/api/v1/admin/content/distribution${q({ domain: ref.domain, content_type: ref.content_type, id: ref.id })}`,
  );
  const r = asRecord(raw);
  const policySrc = asRecord(r.policy ?? r.channels ?? raw);
  return {
    policy: parseDistribution(policySrc),
    scheduled_at: pickString(r, "scheduled_at") || null,
    until_at: pickString(r, "until_at") || null,
  };
}

/* ------------------------------------------------------------------ */
/* bulk actions                                                        */
/* ------------------------------------------------------------------ */

export const BULK_ACTIONS = ["transition", "set_placement", "set_distribution", "schedule", "export"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkResult extends ContentRef {
  ok: boolean;
  error: string | null;
}

export async function runBulkAction(
  action: BulkAction,
  refs: ContentRef[],
  payload: Record<string, unknown> = {},
): Promise<{ results: BulkResult[]; audit_id: string }> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/bulk`, {
    method: "POST",
    body: { action, refs, payload },
  });
  const r = asRecord(raw);
  return {
    audit_id: pickString(r, "audit_id"),
    results: readList<Record<string, unknown>>(r.results ?? raw).map((x) => ({
      domain: pickString(x, "domain") || "content",
      content_type: pickString(x, "content_type"),
      id: pickString(x, "id"),
      ok: pickBool(x, "ok", false),
      error: pickString(x, "error") || null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* calendar                                                            */
/* ------------------------------------------------------------------ */

export interface CalendarEntry {
  domain: string;
  content_type: string;
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  surface: string;
  status: WorkflowStatus;
  conflict_with: ContentRef[];
}

export async function getContentCalendar(from: string, to: string): Promise<CalendarEntry[]> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/calendar${q({ from, to })}`);
  return readList<unknown>(raw).map((x) => {
    const r = asRecord(x);
    return {
      domain: pickString(r, "domain") || "content",
      content_type: pickString(r, "content_type") || "page",
      id: pickString(r, "id"),
      title: pickString(r, "title") || "—",
      starts_at: pickString(r, "starts_at", "scheduled_at"),
      ends_at: pickString(r, "ends_at") || null,
      surface: pickString(r, "surface"),
      status: (pickString(r, "status") || "draft") as WorkflowStatus,
      conflict_with: pickArr<Record<string, unknown>>(r, "conflict_with", "conflicts").map((c) => ({
        domain: pickString(c, "domain") || "content",
        content_type: pickString(c, "content_type") || "page",
        id: pickString(c, "id"),
      })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* audit (contract §14)                                                 */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

function parseAudit(raw: unknown): AuditEntry {
  const r = asRecord(raw);
  return {
    id: pickString(r, "id"),
    actor_id: pickString(r, "actor_id"),
    actor_name: pickString(r, "actor_name", "actor_id"),
    action: pickString(r, "action"),
    entity_type: pickString(r, "entity_type"),
    entity_id: pickString(r, "entity_id"),
    old_values: (r.old_values as Record<string, unknown> | null) ?? null,
    new_values: (r.new_values as Record<string, unknown> | null) ?? null,
    ip: pickString(r, "ip") || null,
    created_at: pickString(r, "created_at"),
  };
}

export async function getContentAudit(ref: Pick<ContentRef, "domain" | "content_type" | "id">): Promise<AuditEntry[]> {
  const raw = await apiFetch<unknown>(
    `/api/v1/admin/content/audit${q({ domain: ref.domain, content_type: ref.content_type, id: ref.id })}`,
  );
  return readList<unknown>(raw).map(parseAudit);
}

export async function getUserAudit(userId: string): Promise<AuditEntry[]> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/audit${q({ actor_id: userId })}`);
  return readList<unknown>(raw).map(parseAudit);
}

/* ------------------------------------------------------------------ */
/* AI source center                                                    */
/* ------------------------------------------------------------------ */

export interface AiSource extends ContentRef {
  title: string;
  provenance: string;
  scopes: AiScope[];
  ingestion_status: "ok" | "pending" | "error" | "stale";
  last_embedding_at: string | null;
  embedding_chunks: number;
  extraction_errors: string[];
}

export async function listAiSources(status?: string, scope?: string): Promise<AiSource[]> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/content/ai-sources${q({ status, scope })}`);
  return readList<unknown>(raw).map((x) => {
    const r = asRecord(x);
    return {
      domain: pickString(r, "domain") || "content",
      content_type: pickString(r, "content_type") || "page",
      id: pickString(r, "id"),
      title: pickString(r, "title") || "—",
      provenance: pickString(r, "provenance") || "—",
      scopes: pickArr<string>(r, "scopes", "ai_scopes").filter((s): s is AiScope =>
        (AI_SCOPES as readonly string[]).includes(s),
      ),
      ingestion_status: (pickString(r, "ingestion_status", "status") || "pending") as AiSource["ingestion_status"],
      last_embedding_at: pickString(r, "last_embedding_at") || null,
      embedding_chunks: pickNum(r, "embedding_chunks", "chunks") ?? 0,
      extraction_errors: pickArr<string>(r, "extraction_errors", "errors"),
    };
  });
}

export async function reindexAiSource(ref: Pick<ContentRef, "domain" | "content_type" | "id">): Promise<{ job_id: string }> {
  const raw = await apiFetch<unknown>(
    `/api/v1/admin/content/ai-sources/${ref.domain}/${ref.content_type}/${ref.id}/reindex`,
    { method: "POST" },
  );
  return { job_id: pickString(asRecord(raw), "job_id", "run_id") };
}

/* ------------------------------------------------------------------ */
/* external sources (§9.6)                                             */
/* ------------------------------------------------------------------ */

export interface ExternalSource {
  id: string;
  name: string;
  domain: string;
  enabled: boolean;
  policy: string;
  priority: number;
  citation_required: boolean;
  last_checked_at: string | null;
  allowed_paths: string[];
}

export async function listExternalSources(): Promise<ExternalSource[]> {
  // بک‌اند واقعی: /api/v1/admin/fatwa/trusted-sources (§۹.۶)
  const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/trusted-sources`);
  return readList<unknown>(raw).map((x) => {
    const r = asRecord(x);
    return {
      id: pickString(r, "id"),
      name: pickString(r, "name"),
      domain: pickString(r, "domain", "base_url"),
      enabled: pickBool(r, "enabled", false),
      policy: pickString(r, "policy", "crawl_policy") || "allowlist",
      priority: pickNum(r, "priority") ?? 0,
      citation_required: pickBool(r, "citation_required", true),
      last_checked_at: pickString(r, "last_checked_at") || null,
      allowed_paths: pickArr<string>(r, "allowed_paths"),
    };
  });
}

export async function updateExternalSource(
  id: string,
  patch: Partial<Pick<ExternalSource, "enabled" | "policy" | "priority"> & { allowed_paths: string[] }>,
): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/admin/fatwa/trusted-sources/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function checkExternalSource(id: string): Promise<{ ok: boolean; latency_ms: number | null; detail: string }> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/fatwa/trusted-sources/${id}/check`, { method: "POST" });
  const r = asRecord(raw);
  return {
    ok: pickBool(r, "ok", false),
    latency_ms: pickNum(r, "latency_ms"),
    detail: pickString(r, "detail", "message", "error"),
  };
}

/* ------------------------------------------------------------------ */
/* telegram center                                                     */
/* ------------------------------------------------------------------ */

export type TelegramPolicyKind = "never" | "manual_approval" | "auto_publish" | "scheduled";

export interface TelegramPolicy {
  domain: string;
  content_type: string;
  policy: TelegramPolicyKind;
  channel: string | null;
  caption_template: string | null;
  dedupe_window_hours: number;
  enabled: boolean;
}

export async function listTelegramPolicies(): Promise<TelegramPolicy[]> {
  // بک‌اند واقعی: /api/v1/telegram/distribute/policies (فاز ۱۱)
  const raw = await apiFetch<unknown>(`/api/v1/telegram/distribute/policies`);
  return readList<unknown>(raw).map((x) => {
    const r = asRecord(x);
    return {
      domain: pickString(r, "domain") || "content",
      content_type: pickString(r, "content_type") || "page",
      policy: (pickString(r, "policy") || "never") as TelegramPolicyKind,
      channel: pickString(r, "channel") || null,
      caption_template: pickString(r, "caption_template", "template") || null,
      dedupe_window_hours: pickNum(r, "dedupe_window_hours") ?? 24,
      enabled: pickBool(r, "enabled", true),
    };
  });
}

export async function updateTelegramPolicy(
  _domain: string,
  contentType: string,
  patch: Partial<Omit<TelegramPolicy, "domain" | "content_type">>,
): Promise<unknown> {
  // بک‌اند واقعی: PUT /api/v1/telegram/distribute/policies/{content_type}
  return apiFetch<unknown>(`/api/v1/telegram/distribute/policies/${contentType}`, {
    method: "PUT",
    body: patch,
  });
}

export interface TgQueueItem {
  id: string;
  domain: string;
  content_type: string;
  content_id: string;
  title: string;
  caption: string;
  channel: string;
  status: "pending" | "approved" | "rejected" | "scheduled" | "sent" | "failed";
  scheduled_at: string | null;
  created_at: string;
}

function parseTgQueue(raw: unknown): TgQueueItem {
  const r = asRecord(raw);
  return {
    id: pickString(r, "id"),
    domain: pickString(r, "domain") || "content",
    content_type: pickString(r, "content_type") || "page",
    content_id: pickString(r, "content_id"),
    title: pickString(r, "title") || "—",
    caption: pickString(r, "caption", "caption_template") || "",
    channel: pickString(r, "channel"),
    status: (pickString(r, "status") || "pending") as TgQueueItem["status"],
    scheduled_at: pickString(r, "scheduled_at") || null,
    created_at: pickString(r, "created_at"),
  };
}

export async function listTelegramQueue(): Promise<TgQueueItem[]> {
  // بک‌اند واقعی: /api/v1/telegram/distribute/log?status=pending (صف تأیید دستی)
  const raw = await apiFetch<unknown>(`/api/v1/telegram/distribute/log${q({ status: "pending" })}`);
  return readList<unknown>(asRecord(raw).items ?? raw).map(parseTgQueue);
}

export async function telegramQueueDecision(id: string, approve: boolean, note?: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/telegram/distribute/${approve ? "approve" : "reject"}/${id}`, {
    method: "POST",
    body: { note },
  });
}

export async function listTelegramSchedule(): Promise<TgQueueItem[]> {
  // زمان‌بندی‌شده‌ها: status=scheduled در همان log
  const raw = await apiFetch<unknown>(`/api/v1/telegram/distribute/log${q({ status: "scheduled" })}`);
  return readList<unknown>(asRecord(raw).items ?? raw).map(parseTgQueue);
}

export interface TgSentMessage {
  id: string;
  title: string;
  channel: string;
  sent_at: string;
  telegram_message_id: string | null;
  status: "sent" | "failed" | "deleted";
  error: string | null;
}

export async function listTelegramHistory(): Promise<TgSentMessage[]> {
  // بک‌اند واقعی: /api/v1/telegram/distribute/log → {items, total}
  const raw = await apiFetch<unknown>(`/api/v1/telegram/distribute/log`);
  return readList<unknown>(asRecord(raw).items ?? raw).map((x) => {
    const r = asRecord(x);
    return {
      id: pickString(r, "id"),
      title: pickString(r, "title", "source_content_id") || "—",
      channel: pickString(r, "channel", "distribution_target"),
      sent_at: pickString(r, "sent_at", "created_at"),
      telegram_message_id: pickString(r, "telegram_message_id", "published_message_id") || null,
      status: (pickString(r, "status") || "sent") as TgSentMessage["status"],
      error: pickString(r, "error") || null,
    };
  });
}

export async function retryTelegramMessage(id: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/telegram/distribute/retry/${id}`, { method: "POST" });
}

export interface DedupeCandidate {
  id: string;
  title_a: string;
  title_b: string;
  similarity: number;
  channel: string;
  sent_at_a: string;
  sent_at_b: string;
}

export async function listTelegramDedupe(): Promise<DedupeCandidate[]> {
  // نمای dedupe سمت‌کلاینت از روی log: گروه‌بندی بر اساس کلید idempotency
  const raw = await apiFetch<unknown>(`/api/v1/telegram/distribute/log${q({ limit: 200 })}`);
  const items = readList<Record<string, unknown>>(asRecord(raw).items ?? raw);
  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const it of items) {
    const k = String(it.idempotency_key ?? it.source_content_id ?? it.id);
    const arr = byKey.get(k) ?? [];
    arr.push(it);
    byKey.set(k, arr);
  }
  const out: DedupeCandidate[] = [];
  for (const [k, arr] of byKey) {
    if (arr.length < 2) continue;
    const [a, b] = arr;
    out.push({
      id: k,
      title_a: String(a.title ?? a.source_content_id ?? "—"),
      title_b: String(b.title ?? b.source_content_id ?? "—"),
      similarity: 1,
      channel: String(a.distribution_target ?? ""),
      sent_at_a: String(a.sent_at ?? a.created_at ?? ""),
      sent_at_b: String(b.sent_at ?? b.created_at ?? ""),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* users 360                                                           */
/* ------------------------------------------------------------------ */

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
  created_at: string;
  last_active_at: string | null;
  status: string;
}

function parseUserSummary(raw: unknown): UserSummary {
  const r = asRecord(raw);
  return {
    id: pickString(r, "id"),
    email: pickString(r, "email"),
    display_name: pickString(r, "display_name", "name", "email"),
    roles: pickArr<string>(r, "roles"),
    created_at: pickString(r, "created_at"),
    last_active_at: pickString(r, "last_active_at") || null,
    status: pickString(r, "status") || "active",
  };
}

export async function listUsers(params: { q?: string; role?: string; cursor?: string; limit?: number } = {}): Promise<{
  items: UserSummary[];
  total: number;
  next_cursor: string | null;
}> {
  const raw = await apiFetch<unknown>(`/api/v1/admin/users${q(params as Record<string, string | undefined>)}`);
  const paged = readPaged<unknown>(raw);
  return { ...paged, items: paged.items.map(parseUserSummary) };
}

export interface UserProfile360 {
  id: string;
  email: string;
  display_name: string;
  phone: string | null;
  roles: string[];
  status: string;
  created_at: string;
  last_active_at: string | null;
  locale: string;
  notification_preferences: { email: boolean; sms: boolean; push: boolean; in_app: boolean };
  lms_progress: { enrolled: number; completed: number; certificates: number; xp: number };
  library_activity: { checkouts: number; bookmarks: number; uploads: number };
  social_activity: { posts: number; comments: number; reports_filed: number; reports_received: number };
  fatwa_activity: { questions: number; answers: number; submissions: number };
  recent_notifications: { id: string; title: string; channel: string; sent_at: string; read: boolean }[];
  audit_trail: AuditEntry[];
}

export async function getUser360(id: string): Promise<UserProfile360> {
  // بک‌اند واقعی: GET /api/v1/admin/users/{id}/overview → {profile, roles, lms, library, social, fatwa, notifications, audit_trail}
  const raw = await apiFetch<unknown>(`/api/v1/admin/users/${id}/overview`);
  const r = asRecord(raw);
  const profile = asRecord(r.profile);
  const np = asRecord(profile.notification_preferences ?? r.notification_preferences);
  const lms = asRecord(r.lms);
  const lib = asRecord(r.library);
  const soc = asRecord(r.social);
  const fw = asRecord(r.fatwa);
  const nOf = (o: Record<string, unknown>, ...ks: string[]): number => pickNum(o, ...ks) ?? 0;
  return {
    id: pickString(profile, "id") || id,
    email: pickString(profile, "email"),
    display_name: pickString(profile, "display_name", "name", "email"),
    phone: pickString(profile, "phone") || null,
    roles: pickArr<string>(r, "roles"),
    status: pickString(profile, "status", "is_active") || "active",
    created_at: pickString(profile, "created_at"),
    last_active_at: pickString(profile, "last_active_at") || null,
    locale: pickString(profile, "locale") || "fa",
    notification_preferences: {
      email: pickBool(np, "email", true),
      sms: pickBool(np, "sms", false),
      push: pickBool(np, "push", true),
      in_app: pickBool(np, "in_app", true),
    },
    lms_progress: {
      enrolled: nOf(lms, "enrolled"),
      completed: nOf(lms, "completed"),
      certificates: nOf(lms, "certificates"),
      xp: nOf(lms, "xp"),
    },
    library_activity: {
      checkouts: nOf(lib, "checkouts"),
      bookmarks: nOf(lib, "bookmarks"),
      uploads: nOf(lib, "uploads"),
    },
    social_activity: {
      posts: nOf(soc, "posts"),
      comments: nOf(soc, "comments"),
      reports_filed: nOf(soc, "reports_filed"),
      reports_received: nOf(soc, "reports_received"),
    },
    fatwa_activity: {
      questions: nOf(fw, "questions"),
      answers: nOf(fw, "answers"),
      submissions: nOf(fw, "submissions"),
    },
    recent_notifications: pickArr<Record<string, unknown>>(r, "recent_notifications", "notifications").map((n) => ({
      id: pickString(n, "id"),
      title: pickString(n, "title") || "—",
      channel: pickString(n, "channel"),
      sent_at: pickString(n, "sent_at", "created_at"),
      read: pickBool(n, "read", false),
    })),
    audit_trail: readList<unknown>(r.audit_trail ?? r.audit).map(parseAudit),
  };
}

export async function setUserRoles(id: string, roles: string[]): Promise<unknown> {
  // بک‌اند role_ids یا role_names می‌پذیرد — UI نام‌ها را می‌فرستد
  return apiFetch<unknown>(`/api/v1/admin/users/${id}/roles`, {
    method: "PATCH",
    body: { role_names: roles },
  });
}

export async function revokeUserSessions(id: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/admin/users/${id}/sessions/revoke`, { method: "POST" });
}

/* ------------------------------------------------------------------ */
/* unified moderation (content flags — social reports stay in          */
/* lib/moderation.ts, the inbox page merges both)                       */
/* ------------------------------------------------------------------ */

export type ContentFlagStatus = "open" | "triaged" | "dismissed" | "actioned";
export const FLAG_ACTIONS = ["dismiss", "warn_user", "hide_content", "ban_user"] as const;
export type FlagAction = (typeof FLAG_ACTIONS)[number];

export interface ContentFlag extends ContentRef {
  content_title: string;
  reason: string;
  reporter: string | null;
  status: ContentFlagStatus;
  reported_at: string;
}

export async function listContentFlags(status?: string): Promise<ContentFlag[]> {
  // بک‌اند واقعی: /api/v1/admin/social/reports (گزارش‌های اجتماعی)
  const raw = await apiFetch<unknown>(`/api/v1/admin/social/reports${q({ status })}`);
  const items = readList<unknown>(asRecord(raw).items ?? raw);
  return items.map((x) => {
    const r = asRecord(x);
    return {
      domain: "social",
      content_type: pickString(r, "target_type", "content_type") || "post",
      id: pickString(r, "id", "content_id", "target_id"),
      content_title: pickString(r, "content_title", "title") || pickString(r, "target_id"),
      reason: pickString(r, "reason"),
      reporter: pickString(r, "reporter", "reported_by") || null,
      status: (pickString(r, "status") || "open") as ContentFlagStatus,
      reported_at: pickString(r, "reported_at", "created_at"),
    };
  });
}

export async function actOnContentFlag(id: string, action: FlagAction, note?: string): Promise<unknown> {
  // نگاشت اکشن‌های UI به اکشن‌های بک‌اند: hide_content → remove_content
  const mapped = action === "hide_content" ? "remove_content" : action;
  return apiFetch<unknown>(`/api/v1/admin/social/reports/${id}/action`, {
    method: "POST",
    body: { action: mapped, note },
  });
}

/* ------------------------------------------------------------------ */
/* notifications center                                                */
/* ------------------------------------------------------------------ */

export const NOTIFY_CHANNELS = ["email", "sms", "push", "in_app"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export interface BroadcastPayload {
  title: string;
  body: string;
  channels: NotifyChannel[];
  audience: { mode: "all" | "roles" | "users"; roles?: string[]; user_ids?: string[] };
  schedule_at?: string | null;
}

export async function sendBroadcast(p: BroadcastPayload): Promise<{ broadcast_id: string; estimated_recipients: number }> {
  // بک‌اند واقعی: {title, body, cohort:{type,roles?,user_ids?}, channels}
  const cohort: Record<string, unknown> = { type: p.audience.mode };
  if (p.audience.roles) cohort.roles = p.audience.roles;
  if (p.audience.user_ids) cohort.user_ids = p.audience.user_ids;
  const raw = await apiFetch<unknown>(`/api/v1/admin/notifications/broadcast`, {
    method: "POST",
    body: { title: p.title, body: p.body, cohort, channels: p.channels },
  });
  const r = asRecord(raw);
  return {
    broadcast_id: pickString(r, "broadcast_id", "id"),
    estimated_recipients: pickNum(r, "estimated_recipients", "total_recipients", "recipients") ?? 0,
  };
}

export interface ChannelPreview {
  channel: NotifyChannel;
  will_receive: boolean;
  reason: string;
}

export async function previewBroadcast(p: {
  title: string;
  body: string;
  channels: NotifyChannel[];
  user_id: string;
}): Promise<ChannelPreview[]> {
  // بک‌اند واقعی: POST /notifications/preview با cohort تکی‌کاربره
  const raw = await apiFetch<unknown>(`/api/v1/admin/notifications/preview`, {
    method: "POST",
    body: { title: p.title, body: p.body, channels: p.channels, cohort: { type: "users", user_ids: [p.user_id] } },
  });
  const r = asRecord(raw);
  const perChannel = asRecord(r.per_channel);
  return p.channels.map((channel) => {
    const n = pickNum(perChannel, channel) ?? 0;
    return {
      channel,
      will_receive: n > 0,
      reason: n > 0 ? "" : "disabled",
    };
  });
}

export interface NotificationLogEntry {
  id: string;
  title: string;
  channels: NotifyChannel[];
  recipients: number;
  delivered: number;
  failed: number;
  skipped: number;
  status: "queued" | "sending" | "done" | "scheduled" | "failed";
  created_at: string;
  actor: string;
}

export async function listNotificationLog(_cursor?: string): Promise<{
  items: NotificationLogEntry[];
  next_cursor: string | null;
}> {
  // بک‌اند واقعی: GET /broadcasts (لیست) — cursor پشتیبانی نمی‌شود
  const raw = await apiFetch<unknown>(`/api/v1/admin/notifications/broadcasts`);
  const items = readList<unknown>(raw);
  return {
    next_cursor: null,
    items: items.map((x) => {
      const r = asRecord(x);
      return {
        id: pickString(r, "id"),
        title: pickString(r, "title") || "—",
        channels: pickArr<string>(r, "channels", "channels_requested").filter((c): c is NotifyChannel =>
          (NOTIFY_CHANNELS as readonly string[]).includes(c),
        ),
        recipients: pickNum(r, "recipients", "total_recipients") ?? 0,
        delivered: pickNum(r, "delivered", "total_sent") ?? 0,
        failed: pickNum(r, "failed", "total_failed") ?? 0,
        skipped: pickNum(r, "skipped", "total_skipped") ?? 0,
        status: (pickString(r, "status") || "queued") as NotificationLogEntry["status"],
        created_at: pickString(r, "created_at"),
        actor: pickString(r, "actor", "actor_name"),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* roles & permissions (§2 RBAC — super_admin only)                    */
/* ------------------------------------------------------------------ */

export interface Role {
  id: string;
  name: string;
  description: string;
  user_count: number;
  permissions: string[];
}

export interface Permission {
  key: string;
  description: string;
  module: string;
}

export async function listRoles(): Promise<{ roles: Role[]; permissions: Permission[] }> {
  // بک‌اند واقعی: GET /roles (لیست با permissions) + GET /permissions
  const [rolesRaw, permsRaw] = await Promise.all([
    apiFetch<unknown>(`/api/v1/admin/roles`),
    apiFetch<unknown>(`/api/v1/admin/roles/permissions`),
  ]);
  return {
    roles: readList<unknown>(rolesRaw).map((x) => {
      const rr = asRecord(x);
      return {
        id: pickString(rr, "id"),
        name: pickString(rr, "name"),
        description: pickString(rr, "description"),
        user_count: pickNum(rr, "user_count", "users") ?? 0,
        permissions: readList<Record<string, unknown>>(rr.permissions ?? rr.permission_keys ?? []).map((p) =>
          typeof p === "string" ? p : pickString(p, "key"),
        ),
      };
    }),
    permissions: readList<unknown>(permsRaw).map((x) => {
      const p = asRecord(x);
      return {
        key: pickString(p, "key"),
        description: pickString(p, "description"),
        module: pickString(p, "module") || pickString(p, "key").split(".")[0] || "—",
      };
    }),
  };
}

export async function createRole(name: string, description?: string): Promise<unknown> {
  // بک‌اند RoleIn: {name, description, permission_keys}
  return apiFetch<unknown>(`/api/v1/admin/roles`, { method: "POST", body: { name, description, permission_keys: [] } });
}

export async function updateRole(id: string, patch: { name?: string; description?: string }): Promise<unknown> {
  // بک‌اند واقعی: PUT /roles/{id} با RoleUpdateIn
  return apiFetch<unknown>(`/api/v1/admin/roles/${id}`, { method: "PUT", body: patch });
}

export async function deleteRole(id: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/v1/admin/roles/${id}`, { method: "DELETE" });
}

export async function setRolePermissions(id: string, permissionKeys: string[]): Promise<unknown> {
  // بک‌اند واقعی: PUT /roles/{id} با permission_keys
  return apiFetch<unknown>(`/api/v1/admin/roles/${id}`, {
    method: "PUT",
    body: { permission_keys: permissionKeys },
  });
}
