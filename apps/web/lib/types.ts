/**
 * Frozen API contracts — Phase 3 (mirror of the backend contract).
 * Per ADR-0002 these types live in the non-UI service layer; components only
 * receive rendered values via props. Nothing here is business logic — just
 * the shape of the wire protocol.
 */

export type Locale = 'fa' | 'ar' | 'en';

/** Localized text object as returned by the API: {"fa": "...", "ar": "...", "en": "..."} */
export interface LocalizedText {
  fa?: string | null;
  ar?: string | null;
  en?: string | null;
  [lang: string]: string | null | undefined;
}

export interface HomeEmptyState {
  title: LocalizedText;
  hint: LocalizedText;
}

export interface HomeSection {
  key: string;
  order: number;
  visible: boolean;
  title: LocalizedText;
  subtitle?: LocalizedText | null;
  /** Opaque per-section payload. Only documented, optional fields are read. */
  data?: unknown;
  empty?: HomeEmptyState | null;
}

export interface HomeTheme {
  /** palette keys are CSS-var suffixes: applied as `--ma-<suffix>` */
  palette?: Record<string, string> | null;
  fonts?: { body?: string | null; heading?: string | null } | null;
}

export interface HomeSectionsResponse {
  theme: HomeTheme | null;
  sections: HomeSection[];
}

export interface SearchResultItem {
  type: string;
  id: string;
  title: LocalizedText;
  snippet?: string | null;
  url?: string | null;
  score?: number | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  total: number;
}

/** Section keys the homepage knows how to render, in contract order. */
export const SECTION_KEYS = [
  'hero',
  'live_status',
  'latest_fatwas',
  'quran_of_day',
  'suggested_lessons',
  'fresh_library',
  'community',
  'nearby_map',
  'donation_banner',
  'footer',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/* ------------------------------------------------------------------ */
/* Phase 4 — CMS / content contracts (mirror of the backend contract).  */
/* ------------------------------------------------------------------ */

/** Generic CMS block as emitted by the CMS.
 * Two conventions exist: flat (`{type, text:{fa,ar,en}, …}` — current
 * seeds/editor) and props-nested (`{type, props:{…}}` — visual-editor spec).
 * CmsBlocks renders both; unknown types degrade gracefully. */
export interface CmsBlockWire {
  type: string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CmsSeoMeta {
  title?: string | null;
  description?: string | null;
  keywords?: string | null;
  canonical?: string | null;
  author?: string | null;
}

/** GET /api/v1/content/public/pages/slug/{slug} — published page payload. */
export interface CmsPage {
  slug: string;
  title: LocalizedText;
  blocks: CmsBlockWire[];
  seo_meta: CmsSeoMeta | null;
  content_type: 'page' | 'article' | 'faq';
  published_at: string | null;
  updated_at: string | null;
  author?: LocalizedText | string | null;
}

/** GET /api/v1/content/public/nav — nested nav tree (children[]). */
export interface NavItemWire {
  id?: string | null;
  label: LocalizedText;
  url: string;
  link_type?: string | null;
  children?: NavItemWire[] | null;
}

/** GET /api/v1/content/public/banners — active banners for a placement. */
export interface BannerWire {
  id?: string | number | null;
  title: LocalizedText;
  subtitle?: LocalizedText | null;
  media?: { type?: string | null; url?: string | null } | null;
  cta?: { text?: LocalizedText | string | null; url?: string | null } | null;
  priority?: number | null;
}

/** GET /api/v1/content/public/announcements — active announcements. */
export interface AnnouncementWire {
  id: string | number;
  message: LocalizedText;
  dismissible?: boolean | null;
}

/** GET /api/v1/content/public/events — published Islamic events. */
export interface IslamicEventWire {
  id?: string | number | null;
  /** localized event name (the API field is `name`, not `title`) */
  name: LocalizedText;
  hijri_month?: number | null;
  hijri_day?: number | null;
  theme_id?: string | null;
  image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/** GET /api/v1/content/public/quotes — published scholar quotes. */
export interface ScholarQuoteWire {
  id?: string | number | null;
  text: LocalizedText;
  /** localized scholar name (the API field is `scholar`, not `author`) */
  scholar?: LocalizedText | null;
  source?: LocalizedText | string | null;
  avatar_url?: string | null;
}
