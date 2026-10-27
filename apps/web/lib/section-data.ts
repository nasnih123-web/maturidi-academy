import type { LocalizedText } from './types';
import { pickText } from './localize';

/**
 * Service-layer extractors for opaque section `data` payloads.
 * The contract only fixes the section envelope; per-section `data` shapes are
 * backend-defined. These extractors read *documented optional* fields and
 * return plain, localized, presentation-ready values (or null). Components
 * never touch raw `data`. Nothing is invented: missing fields → null →
 * the section renders its API-provided empty state.
 */

export interface ContentItem {
  id: string;
  title: string;
  subtitle: string;
  author: string;
  category: string;
  duration: string;
  badge: string;
  image: string | null;
  href: string | null;
}

export interface Cta {
  label: string;
  href: string;
}

export interface NavLink {
  label: string;
  href: string;
}

export interface NavColumn {
  heading: string;
  links: NavLink[];
}

/** Allow same-origin paths and http(s) URLs only. */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch {
    return null;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isLocalizedText(v: unknown): v is LocalizedText {
  return isRecord(v) && Object.values(v).every((x) => x == null || typeof x === 'string');
}

function textOf(v: unknown, locale: string): string {
  if (typeof v === 'string') return v;
  if (isLocalizedText(v)) return pickText(v, locale);
  return '';
}

/**
 * data.items → cards. Accepted item shape:
 * `{ id?, title: LocalizedText, subtitle?|snippet?: LocalizedText|string,
 *    author?, category?, duration?, badge?: LocalizedText|string,
 *    image?: string, url? }`
 * All fields are documented-optional; missing fields → empty strings, never
 * invented values.
 */
export function getContentItems(data: unknown, locale: string): ContentItem[] {
  if (!isRecord(data) || !Array.isArray(data.items)) return [];
  const out: ContentItem[] = [];
  for (const raw of data.items.slice(0, 12)) {
    if (!isRecord(raw) || !isLocalizedText(raw.title)) continue;
    const title = pickText(raw.title, locale);
    if (!title) continue;
    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : title,
      title,
      subtitle: textOf(raw.subtitle ?? raw.snippet, locale),
      author: textOf(raw.author, locale),
      category: textOf(raw.category, locale),
      duration: textOf(raw.duration, locale),
      badge: textOf(raw.badge, locale),
      image: typeof raw.image === 'string' && raw.image ? raw.image : null,
      href: safeHref(raw.url),
    });
  }
  return out;
}

/** Valid section layouts (mirrors the slider/section component contract). */
const SECTION_LAYOUTS = ['slider', 'grid', 'featured-rail', 'shelf', 'mosaic'] as const;
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];

/**
 * Optional CMS-driven section layout: `data.layout` must be one of the
 * known layouts, otherwise the caller's default applies. Unknown values
 * are ignored (never crash on CMS data).
 */
export function getSectionLayout(data: unknown, fallback: SectionLayout): SectionLayout {
  if (isRecord(data) && typeof data.layout === 'string') {
    const l = data.layout as SectionLayout;
    if ((SECTION_LAYOUTS as readonly string[]).includes(l)) return l;
  }
  return fallback;
}

/**
 * data.cta → `{ label: LocalizedText, href: string }`, or the seed-style
 * `{ cta_url: string }` paired with a localized fallback label (the label is
 * UI chrome from next-intl; the URL always comes from the API).
 */
export function getCta(data: unknown, locale: string, fallbackLabel = ''): Cta | null {
  if (!isRecord(data)) return null;
  if (isRecord(data.cta)) {
    const label = textOf(data.cta.label, locale);
    const href = safeHref(data.cta.href);
    if (label && href) return { label, href };
  }
  const href = safeHref(data.cta_url);
  if (href && fallbackLabel) return { label: fallbackLabel, href };
  return null;
}

/** data.status → single localized status line (e.g. live_status bar). */
export function getStatusLine(data: unknown, locale: string): string | null {
  if (!isRecord(data)) return null;
  const line = textOf(data.status, locale);
  return line || null;
}

/** Footer brand texts from `data.brand`, localized. Each field is
 * optional: a missing/empty field returns null for that field and the
 * caller falls back to the built-in messages text. `{year}` in `rights`
 * is replaced with the current year (same convention as the messages
 * string). Columns themselves come from `getNavColumns` below. */
export interface FooterBrandView {
  tagline: string | null;
  rights: string | null;
}

export function getFooterBrand(data: unknown, locale: string): FooterBrandView | null {
  if (!isRecord(data) || !isRecord(data.brand)) return null;
  const tagline = textOf(data.brand.tagline, locale) || null;
  const rawRights = textOf(data.brand.rights, locale) || null;
  const rights = rawRights
    ? rawRights.split('{year}').join(String(new Date().getFullYear()))
    : null;
  if (!tagline && !rights) return null;
  return { tagline, rights };
}

/** data.columns → footer nav columns. */
export function getNavColumns(data: unknown, locale: string): NavColumn[] {
  if (!isRecord(data) || !Array.isArray(data.columns)) return [];
  const out: NavColumn[] = [];
  for (const raw of data.columns) {
    if (!isRecord(raw)) continue;
    const heading = textOf(raw.heading, locale);
    if (!heading || !Array.isArray(raw.links)) continue;
    const links: NavLink[] = [];
    for (const l of raw.links) {
      if (!isRecord(l)) continue;
      const label = textOf(l.label, locale);
      const href = safeHref(l.href);
      if (!label || !href) continue;
      links.push({ label, href });
    }
    if (links.length > 0) out.push({ heading, links });
  }
  return out;
}

/* ----------------------------------------------------------- */
/* Phase 4 — CMS surfaces (banners, announcements, events,      */
/* quotes, API-driven nav). Same extractor style: documented    */
/* optional fields only, missing data → null, never invented.   */
/* ----------------------------------------------------------- */

/** Nav entry after localization: what the header/footer render. */
export interface CmsNavEntry {
  label: string;
  href: string;
  external: boolean;
  children: CmsNavEntry[];
}function navHref(url: unknown, linkType: unknown): { href: string; external: boolean } | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const external = linkType === 'external' || /^https?:\/\//i.test(url.trim());
  if (external) {
    const href = safeHref(url);
    return href ? { href, external: true } : null;
  }
  const href = safeHref(url);
  return href ? { href, external: false } : null;
}

/**
 * NavItemWire[] → localized nav tree. Entries without a label or a safe
 * href are dropped. Called by the layout; the header receives plain values.
 */
export function getCmsNav(
  items: unknown,
  locale: string,
): CmsNavEntry[] {
  if (!Array.isArray(items)) return [];
  const out: CmsNavEntry[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const label = textOf(raw.label, locale);
    const link = navHref(raw.url, raw.link_type);
    if (!label || !link) continue;
    out.push({
      label,
      href: link.href,
      external: link.external,
      children: getCmsNav(raw.children, locale),
    });
  }
  return out;
}

/** Presentation-ready banner (localized, priority-resolved by the caller). */
export interface BannerView {
  id: string;
  title: string;
  subtitle: string;
  image: string | null;
  cta: { label: string; href: string } | null;
}

/** BannerWire → BannerView; null when the banner has no usable title. */
export function getBannerView(banner: unknown, locale: string): BannerView | null {
  if (!isRecord(banner)) return null;
  const title = textOf(banner.title, locale);
  if (!title) return null;
  const subtitle = textOf(banner.subtitle, locale);
  const media = isRecord(banner.media) ? banner.media : null;
  const image = media && media.type !== 'video' ? safeHref(media.url) : null;
  let cta: BannerView['cta'] = null;
  if (isRecord(banner.cta)) {
    const label = textOf(banner.cta.text, locale);
    const href = safeHref(banner.cta.url);
    if (label && href) cta = { label, href };
  }
  return {
    id: typeof banner.id === 'string' || typeof banner.id === 'number' ? String(banner.id) : title,
    title,
    subtitle,
    image,
    cta,
  };
}

/** Presentation-ready announcement (localized). */
export interface AnnouncementView {
  id: string;
  message: string;
  dismissible: boolean;
}

export function getAnnouncementViews(items: unknown, locale: string): AnnouncementView[] {
  if (!Array.isArray(items)) return [];
  const out: AnnouncementView[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const message = textOf(raw.message, locale);
    if (!message) continue;
    out.push({
      id: String(raw.id ?? message),
      message,
      dismissible: raw.dismissible !== false,
    });
  }
  return out;
}

/** Presentation-ready Islamic event (localized, ISO dates untouched). */
export interface IslamicEventView {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  hijriMonth: number | null;
  hijriDay: number | null;
  imageUrl: string | null;
}

export function getEventView(
  event: unknown,
  locale: string,
): IslamicEventView | null {
  if (!isRecord(event)) return null;
  // NOTE: the API field is `name`, not `title`.
  const title = textOf(event.name, locale);
  if (!title) return null;
  const iso = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null;
    return Number.isNaN(new Date(v).getTime()) ? null : v;
  };
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    id: typeof event.id === 'string' || typeof event.id === 'number' ? String(event.id) : title,
    title,
    startsAt: iso(event.starts_at),
    endsAt: iso(event.ends_at),
    hijriMonth: num(event.hijri_month),
    hijriDay: num(event.hijri_day),
    imageUrl: safeHref(event.image_url),
  };
}

/** Presentation-ready scholar quote (localized). */
export interface ScholarQuoteView {
  id: string;
  text: string;
  scholar: string;
  source: string;
}

export function getScholarQuoteViews(items: unknown, locale: string): ScholarQuoteView[] {
  if (!Array.isArray(items)) return [];
  const out: ScholarQuoteView[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const text = textOf(raw.text, locale);
    if (!text) continue;
    out.push({
      id: typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : text,
      text,
      // NOTE: the API field is `scholar`, not `author`.
      scholar: textOf(raw.scholar, locale),
      source: textOf(raw.source, locale),
    });
  }
  return out;
}

/** Final nav entry with a fully-resolved href, ready to render. */
export interface NavEntryFinal {
  label: string;
  href: string;
  external: boolean;
  children: NavEntryFinal[];
}

/**
 * Resolve CMS nav hrefs to their final render form: internal links get the
 * locale prefix (`/fa/pages/about`), external links pass through untouched.
 * Pure plumbing — keeps href logic out of components (ADR-001).
 */
export function finalizeNav(entries: CmsNavEntry[], locale: string): NavEntryFinal[] {
  const prefix = `/${locale}`;
  return entries.map((e) => ({
    label: e.label,
    href:
      e.external || e.href.startsWith(`${prefix}/`) || e.href === prefix
        ? e.href
        : `${prefix}${e.href.startsWith('/') ? e.href : `/${e.href}`}`,
    external: e.external,
    children: finalizeNav(e.children, locale),
  }));
}
