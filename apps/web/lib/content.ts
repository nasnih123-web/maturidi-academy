import { getApiBaseUrl, ApiError } from './api';
import type {
  AnnouncementWire,
  BannerWire,
  CmsPage,
  IslamicEventWire,
  Locale,
  NavItemWire,
  ScholarQuoteWire,
} from './types';

/**
 * Server-side content client — Phase 4 CMS surfaces.
 * Bound to the backend contract `GET /api/v1/content/public/*`
 * (backend track, Phase 4): all texts are LocalizedText
 * `{"fa":..,"ar":..,"en":..}`, all dates ISO 8601.
 *
 * Per ADR-001 every data fetch lives here; components only render props.
 * All fetchers are NON-THROWING: a CMS endpoint that is missing, slow or
 * failing yields an empty result (empty array / null) so the site never
 * breaks because of the CMS. Contract §15.9 (no mock data) is honoured —
 * nothing is invented, the surfaces simply stay empty.
 */

const PUBLIC = '/api/v1/content/public';

function contentUrl(path: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}${qs ? `?${qs}` : ''}`;
}

async function getJson<T>(path: string, query: Record<string, string> = {}, init: RequestInit = {}): Promise<T | null> {
  // `next.revalidate` and `cache: "no-store"` are mutually exclusive —
  // preview (no-store) must not inherit the default revalidation window.
  const useDefaultCache = init.cache !== 'no-store' && init.next === undefined;
  const fetchInit: RequestInit = {
    ...(useDefaultCache ? { next: { revalidate: 120 } } : {}),
    ...init,
    headers: { Accept: 'application/json', ...((init.headers ?? {}) as Record<string, string>) },
  };
  let res: Response;
  try {
    res = await fetch(contentUrl(path, query), fetchInit);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items)) {
    return (v as { items: T[] }).items;
  }
  return [];
}

/**
 * GET /api/v1/content/public/pages/slug/{slug} — published CMS page.
 * Preview mode (CRM Preview Matrix): pass `{ previewId, token }` to fetch
 * the unpublished draft via GET /api/v1/content/public/pages/preview/{id}
 * with a Bearer admin token. Returns null when the page is missing or
 * unpublished. NOTE: the preview endpoint is a documented proposal —
 * until the backend implements it, preview URLs 404 honestly.
 */
export async function getCmsPage(
  slug: string,
  opts: { previewId?: string; token?: string } = {},
): Promise<CmsPage | null> {
  const preview = Boolean(opts.previewId);
  const path = preview
    ? `${PUBLIC}/pages/preview/${encodeURIComponent(opts.previewId as string)}`
    : `${PUBLIC}/pages/slug/${encodeURIComponent(slug)}`;
  const body = await getJson<Record<string, unknown>>(
    path,
    {},
    preview
      ? {
          cache: 'no-store',
          headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
        }
      : {},
  );
  if (!body || typeof body !== 'object') return null;
  // Blocks arrive either flat ({type, text:{fa,ar,en}, …} — current seeds/editor)
  // or props-nested ({type, props:{…}} — visual-editor spec). Pass through
  // untouched; CmsBlocks normalizes both conventions.
  const blocks = asArray<Record<string, unknown>>(body.blocks)
    .filter((b) => b && typeof b.type === 'string')
    .map((b) => ({
      ...b,
      type: b.type as string,
      props: (b.props && typeof b.props === 'object' ? b.props : {}) as Record<string, unknown>,
    }));
  const seo = (body.seo_meta && typeof body.seo_meta === 'object'
    ? body.seo_meta
    : null) as CmsPage['seo_meta'];
  const contentType = body.content_type === 'article' || body.content_type === 'faq' ? body.content_type : 'page';
  return {
    slug: typeof body.slug === 'string' ? body.slug : slug,
    title: (body.title as CmsPage['title']) ?? {},
    blocks,
    seo_meta: seo,
    content_type: contentType,
    published_at: typeof body.published_at === 'string' ? body.published_at : null,
    updated_at: typeof body.updated_at === 'string' ? body.updated_at : null,
    author: (body.author as CmsPage['author']) ?? null,
  };
}

/**
 * GET /api/v1/content/public/nav?locale={locale} — nested nav tree.
 * The server resolves visibility/scheduling; the web only localizes
 * labels. Empty array ⇒ caller falls back to the static IA.
 */
export async function getNavItems(locale: Locale): Promise<NavItemWire[]> {
  return asArray<NavItemWire>(await getJson<unknown>(`${PUBLIC}/nav`, { locale }));
}

/**
 * GET /api/v1/content/public/banners?placement= — active banners.
 * Server orders by priority DESC; the web keeps that order.
 */
export async function getBanners(placement: string): Promise<BannerWire[]> {
  return asArray<BannerWire>(await getJson<unknown>(`${PUBLIC}/banners`, { placement }));
}

/** GET /api/v1/content/public/announcements?placement= — active announcements. */
export async function getAnnouncements(placement: string): Promise<AnnouncementWire[]> {
  return asArray<AnnouncementWire>(await getJson<unknown>(`${PUBLIC}/announcements`, { placement }));
}

/**
 * GET /api/v1/content/public/events — published Islamic events, with
 * optional hijri_month / hijri_day filter.
 */
export async function getIslamicEvents(
  hijriMonth?: number | null,
  hijriDay?: number | null,
): Promise<IslamicEventWire[]> {
  const query: Record<string, string> = {};
  if (hijriMonth) query.hijri_month = String(hijriMonth);
  if (hijriDay) query.hijri_day = String(hijriDay);
  return asArray<IslamicEventWire>(await getJson<unknown>(`${PUBLIC}/events`, query));
}

/** GET /api/v1/content/public/quotes?placement= — published scholar quotes. */
export async function getScholarQuotes(placement: string): Promise<ScholarQuoteWire[]> {
  return asArray<ScholarQuoteWire>(await getJson<unknown>(`${PUBLIC}/quotes`, { placement }));
}

export interface CalendarTheme {
  theme_id: string | null;
  event_id: string | null;
  hijri: { month: number; day: number } | null;
}

/**
 * GET /api/v1/content/public/calendar/theme — today's active Islamic
 * calendar theme + current hijri (month, day). Drives the homepage
 * event banner: the web then loads events for that hijri date.
 */
export async function getCalendarTheme(): Promise<CalendarTheme | null> {
  const body = await getJson<Record<string, unknown>>(`${PUBLIC}/calendar/theme`);
  if (!body || typeof body !== 'object') return null;
  const hijri = body.hijri as { month?: unknown; day?: unknown } | undefined;
  const month = typeof hijri?.month === 'number' ? hijri.month : null;
  const day = typeof hijri?.day === 'number' ? hijri.day : null;
  return {
    theme_id: typeof body.theme_id === 'string' ? body.theme_id : null,
    event_id:
      typeof body.event_id === 'string' || typeof body.event_id === 'number'
        ? String(body.event_id)
        : null,
    hijri: month && day ? { month, day } : null,
  };
}

// Re-exported so callers can distinguish "API failed" from "empty"
// when they need the honest error state instead of the silent fallback.
export { ApiError };
