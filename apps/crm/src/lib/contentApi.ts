/**
 * Phase 4 — Content service layer for the CRM Content Center.
 *
 * All business logic / API access for Islamic calendar + CMS lives here
 * (ADR-001/0002: no domain logic inside components). Components and managers
 * only consume the typed hooks in `lib/contentHooks.ts`, which wrap these
 * functions. Pages never call `apiFetch` directly for content.
 *
 * Backend contract (sibling track implements; shapes adapt gracefully —
 * readers tolerate both `workflow_status`/`status` and paged/array lists):
 *   /api/v1/content/events | /quotes | /pages | /nav | /banners | /announcements
 *     GET /            → list     (page `{items, next_cursor}` or raw array)
 *     POST /           → create
 *     GET|PATCH /{id}  → read/update
 *     DELETE /{id}     → archive
 *     POST /{id}/transition {"to": …} → §9 state machine
 *     GET  /{id}/versions → version history
 */

import { apiFetch } from "./api";

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

export interface LocalizedText {
  fa: string;
  ar: string;
  en: string;
}

export const EMPTY_L10N: LocalizedText = { fa: "", ar: "", en: "" };

export type WorkflowStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "rejected"
  | "archived";

export const WORKFLOW_ORDER: WorkflowStatus[] = [
  "draft",
  "in_review",
  "approved",
  "published",
];

/** Legal §9 transitions; the server re-validates. UI only offers these. */
export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "rejected", "draft"],
  approved: ["published", "in_review", "archived"],
  published: ["archived"],
  rejected: ["draft", "archived"],
  archived: ["draft"],
};

/** Distribution policy §9.5 — each channel toggled independently. */
export interface DistributionPolicy {
  web: boolean;
  mobile: boolean;
  desktop: boolean;
  telegram: boolean;
  ai_knowledge: boolean;
}

export const DISTRIBUTION_CHANNELS: (keyof DistributionPolicy)[] = [
  "web",
  "mobile",
  "desktop",
  "telegram",
  "ai_knowledge",
];

export const DEFAULT_DISTRIBUTION: DistributionPolicy = {
  web: true,
  mobile: true,
  desktop: false,
  telegram: false,
  ai_knowledge: false,
};

export interface BaseResource {
  id: string;
  workflow_status: WorkflowStatus;
  distribution: Partial<DistributionPolicy>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface VersionRecord {
  version: number;
  created_at: string;
  actor: string | null;
  summary: string | null;
  changes: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/* Resource shapes                                                     */
/* ------------------------------------------------------------------ */

export interface IslamicEvent extends BaseResource {
  name: LocalizedText;
  hijri_month: number; // 1..12
  hijri_day: number; // 1..30
  recurring: boolean;
  starts_at: string | null;
  ends_at: string | null;
  /** UUID of the site theme activated while the event is live (nullable). */
  theme_id: string | null;
  image_url: string | null;
  auto_publish: boolean;
  needs_admin_confirmation: boolean;
}

export interface BannerMedia {
  type: "image" | "video";
  url: string;
  variants?: Record<string, unknown>;
}

export interface BannerCta {
  text: LocalizedText;
  url: string;
  /** Optional link kind (internal/external) — stored inside the free-form cta dict. */
  link_type?: "internal" | "external";
}

export interface Banner extends BaseResource {
  title: LocalizedText;
  subtitle: LocalizedText | null;
  media: BannerMedia | null;
  cta: BannerCta | null;
  placement: string; // e.g. "homepage"
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  /** Audience targeting dict, e.g. {segment: "members"}. */
  audience: Record<string, unknown>;
}

/** Read the audience segment out of the backend's audience dict. */
export function audienceSegment(audience: unknown): string {
  if (audience && typeof audience === "object") {
    const s = (audience as Record<string, unknown>)["segment"];
    if (typeof s === "string" && s) return s;
  }
  if (typeof audience === "string" && audience) return audience;
  return "all";
}

export function toAudienceDict(segment: string): Record<string, unknown> {
  return { segment };
}

export interface ScholarQuote extends BaseResource {
  scholar: LocalizedText;
  text: LocalizedText;
  source: string | null; // book / session / lecture name
  quote_date: string | null; // ISO date (YYYY-MM-DD)
  avatar_url: string | null;
  placements: string[]; // scholar_page | homepage | quote_section | social | telegram
}

export interface CmsBlock {
  type: string;
  props: Record<string, unknown>;
}

export type PageContentType = "page" | "article" | "faq";

export interface ContentPageResource extends BaseResource {
  slug: string;
  title: LocalizedText;
  blocks: CmsBlock[];
  /** SEO dict, e.g. {title: LocalizedText, description: LocalizedText}. */
  seo_meta: Record<string, unknown>;
  content_type: PageContentType;
}

export interface NavItem {
  id: string;
  parent_id: string | null;
  label: LocalizedText;
  url: string;
  link_type: "internal" | "external";
  sort_order: number;
  visible: boolean;
  /** null = all locales */
  locale: "fa" | "ar" | "en" | null;
  starts_at: string | null;
  ends_at: string | null;
  children?: NavItem[];
}

export interface Announcement extends BaseResource {
  message: LocalizedText;
  audience: Record<string, unknown>;
  placement: string; // global | homepage | dashboard | lms
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export interface HomeSection {
  key: string;
  order: number;
  visible: boolean;
  title: LocalizedText;
  subtitle: LocalizedText | null;
  data: Record<string, unknown> | null;
  empty: { title: LocalizedText; hint: LocalizedText } | null;
}

export interface HomeSectionsOut {
  theme: { palette: Record<string, string>; fonts: Record<string, string> } | null;
  sections: HomeSection[];
}

/* ------------------------------------------------------------------ */
/* Response adaptation (never trust a sibling-track field name blindly) */
/* ------------------------------------------------------------------ */

interface MaybePaged<T> {
  items?: T[];
  next_cursor?: string | null;
}

export function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && Array.isArray((payload as MaybePaged<T>).items)) {
    return (payload as MaybePaged<T>).items as T[];
  }
  return [];
}

/** Accept both `workflow_status` (contract) and `status` (legacy). */
export function workflowOf(row: Record<string, unknown>): WorkflowStatus {
  const raw =
    (row["workflow_status"] as string | undefined) ??
    (row["status"] as string | undefined) ??
    "draft";
  return (WORKFLOW_ORDER as string[]).includes(raw) ||
    raw === "rejected" ||
    raw === "archived"
    ? (raw as WorkflowStatus)
    : "draft";
}

export function normalizeBase(row: Record<string, unknown>): BaseResource {
  return {
    id: String(row["id"] ?? ""),
    workflow_status: workflowOf(row),
    distribution: (row["distribution"] as Partial<DistributionPolicy>) ?? {},
    version: Number(row["version"] ?? 1),
    created_at: String(row["created_at"] ?? ""),
    updated_at: String(row["updated_at"] ?? ""),
  };
}

/* ------------------------------------------------------------------ */
/* Generic resource client                                             */
/* ------------------------------------------------------------------ */

export type ResourceName =
  | "events"
  | "quotes"
  | "pages"
  | "nav"
  | "banners"
  | "announcements";

const resourcePath = (r: ResourceName): string => `/api/v1/content/${r}`;

export interface AdminListFilters {
  workflow_status?: string;
  placement?: string;
  locale?: string;
  limit?: number;
  offset?: number;
}

/**
 * Admin list — GET /api/v1/content/{resource}/ with optional
 * workflow_status/placement/locale filters + limit/offset.
 * Returns ItemsOut{items, total}; only the items are surfaced here.
 */
export async function listResources<T>(
  resource: ResourceName,
  filters: AdminListFilters = {},
): Promise<T[]> {
  const params = new URLSearchParams();
  if (filters.workflow_status) params.set("workflow_status", filters.workflow_status);
  if (filters.placement) params.set("placement", filters.placement);
  if (filters.locale) params.set("locale", filters.locale);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const qs = params.toString();
  const payload = await apiFetch<unknown>(
    qs ? `${resourcePath(resource)}?${qs}` : resourcePath(resource),
  );
  return asArray<T>(payload);
}

export async function getResource<T>(resource: ResourceName, id: string): Promise<T> {
  return apiFetch<T>(`${resourcePath(resource)}/${encodeURIComponent(id)}`);
}

export async function createResource<T>(
  resource: ResourceName,
  body: Record<string, unknown>,
): Promise<T> {
  return apiFetch<T>(resourcePath(resource), { method: "POST", body });
}

export async function updateResource<T>(
  resource: ResourceName,
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  return apiFetch<T>(`${resourcePath(resource)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

/** DELETE archives per contract (the record stays, status → archived). */
export async function archiveResource<T>(resource: ResourceName, id: string): Promise<T> {
  return apiFetch<T>(`${resourcePath(resource)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function transitionResource<T>(
  resource: ResourceName,
  id: string,
  to: WorkflowStatus,
): Promise<T> {
  return apiFetch<T>(
    `${resourcePath(resource)}/${encodeURIComponent(id)}/transition`,
    { method: "POST", body: { to } },
  );
}

export async function listVersions(
  resource: ResourceName,
  id: string,
): Promise<VersionRecord[]> {
  const payload = await apiFetch<unknown>(
    `${resourcePath(resource)}/${encodeURIComponent(id)}/versions`,
  );
  return asArray<VersionRecord>(payload);
}

/* ------------------------------------------------------------------ */
/* Home sections (layout / placement management)                       */
/* ------------------------------------------------------------------ */

export async function getHomeSections(): Promise<HomeSectionsOut> {
  const payload = await apiFetch<unknown>("/api/v1/home/sections");
  if (payload && typeof payload === "object" && "sections" in payload) {
    return payload as HomeSectionsOut;
  }
  return { theme: null, sections: [] };
}

export interface SectionOrderPatch {
  key: string;
  order: number;
  visible: boolean;
  /** Optional flags the home admin endpoint may persist (graceful if ignored). */
  featured?: boolean;
  pinned?: boolean;
}

/**
 * Persist CMS order used by GET /api/v1/home/sections.
 * Admin endpoint (sibling track): PATCH /api/v1/admin/home/sections
 * body {sections: [{key, order, visible}]}.
 */
export async function reorderHomeSections(
  sections: SectionOrderPatch[],
): Promise<HomeSectionsOut> {
  return apiFetch<HomeSectionsOut>("/api/v1/admin/home/sections", {
    method: "PATCH",
    body: { sections },
  });
}

/* ------------------------------------------------------------------ */
/* Hijri helpers (presentation only — real conversion lives backend-side) */
/* ------------------------------------------------------------------ */

export const HIJRI_MONTHS: { value: number; key: string }[] = [
  { value: 1, key: "muharram" },
  { value: 2, key: "safar" },
  { value: 3, key: "rabi1" },
  { value: 4, key: "rabi2" },
  { value: 5, key: "jumada1" },
  { value: 6, key: "jumada2" },
  { value: 7, key: "rajab" },
  { value: 8, key: "shaban" },
  { value: 9, key: "ramadan" },
  { value: 10, key: "shawwal" },
  { value: 11, key: "dhuqadah" },
  { value: 12, key: "dhuhijjah" },
];

/** Site themes an Islamic event can activate while live (keys only; CSS lives in web). */
/** Banner placement slots (§9.5 placement contract; backend filters ?placement=). */
export const BANNER_PLACEMENTS = [
  "homepage",
  "global",
  "page_top",
  "sidebar",
  "dashboard",
];

/** Quote placements. */
export const QUOTE_PLACEMENTS = [
  "scholar_page",
  "homepage",
  "quote_section",
  "social",
  "telegram",
];

/** Announcement placements. */
export const ANNOUNCEMENT_PLACEMENTS = ["global", "homepage", "dashboard", "lms"];

/** Audience buckets. */
export const AUDIENCES = ["all", "guests", "members", "scholars", "admins"];

/**
 * Convert a `datetime-local` input value to UTC ISO for the API (contract §1:
 * times are UTC ISO on the wire; only the UI localizes). Empty → null.
 */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** UTC ISO → value for `datetime-local` inputs (browser-local rendering). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/* ------------------------------------------------------------------ */
/* Public reads — /api/v1/content/public/* (no auth; published only)    */
/* ------------------------------------------------------------------ */

const publicPath = "/api/v1/content/public";

export interface CalendarTheme {
  theme_id: string | null;
  event_id: string | null;
  hijri: { month: number; day: number };
}

/** Nested nav tree, optionally scoped to a locale. */
export async function getPublicNav(locale?: string): Promise<NavItem[]> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  return asArray<NavItem>(await apiFetch<unknown>(`${publicPath}/nav${qs}`));
}

export async function getPublicBanners(placement?: string): Promise<Banner[]> {
  const qs = placement ? `?placement=${encodeURIComponent(placement)}` : "";
  return asArray<Banner>(await apiFetch<unknown>(`${publicPath}/banners${qs}`));
}

export async function getPublicAnnouncements(placement?: string): Promise<Announcement[]> {
  const qs = placement ? `?placement=${encodeURIComponent(placement)}` : "";
  return asArray<Announcement>(
    await apiFetch<unknown>(`${publicPath}/announcements${qs}`),
  );
}

export async function getPublicPage(slug: string): Promise<ContentPageResource> {
  return apiFetch<ContentPageResource>(
    `${publicPath}/pages/slug/${encodeURIComponent(slug)}`,
  );
}

export async function getPublicEvents(
  hijri_month?: number,
  hijri_day?: number,
): Promise<IslamicEvent[]> {
  const params = new URLSearchParams();
  if (hijri_month !== undefined) params.set("hijri_month", String(hijri_month));
  if (hijri_day !== undefined) params.set("hijri_day", String(hijri_day));
  const qs = params.toString();
  return asArray<IslamicEvent>(
    await apiFetch<unknown>(`${publicPath}/events${qs ? `?${qs}` : ""}`),
  );
}

export async function getPublicQuotes(placement?: string): Promise<ScholarQuote[]> {
  const qs = placement ? `?placement=${encodeURIComponent(placement)}` : "";
  return asArray<ScholarQuote>(await apiFetch<unknown>(`${publicPath}/quotes${qs}`));
}

/** Today's active Islamic-calendar theme for web/mobile + hijri month/day. */
export async function getCalendarTheme(): Promise<CalendarTheme> {
  const raw = await apiFetch<unknown>(`${publicPath}/calendar/theme`);
  const r = (raw ?? {}) as Record<string, unknown>;
  const hijri = (r["hijri"] ?? {}) as Record<string, unknown>;
  return {
    theme_id: (r["theme_id"] as string | null) ?? null,
    event_id: (r["event_id"] as string | null) ?? null,
    hijri: {
      month: Number(hijri["month"] ?? 0),
      day: Number(hijri["day"] ?? 0),
    },
  };
}
