/**
 * Server-side client for the public fatwa listing (WordPress-style catalog).
 *
 * RSC only — never imported from client code. Mirrors the defensive
 * parsing of lib/fatwa-server.ts. Only published topics are ever served
 * here (the API enforces it); drafts are invisible to this layer.
 *
 * Endpoints (public, no auth):
 *   GET /api/v1/fatwa/topics?q&category&sort&page&per_page&exclude
 *   GET /api/v1/fatwa/topics/categories
 *   GET /api/v1/fatwa/topics/{id}   (each call counts one view)
 */
import { getApiBaseUrl, ApiError } from './api';

export interface FatwaTopicCategory {
  slug: string;
  title: string;
}

export interface FatwaTopicItem {
  id: string;
  title: string;
  description: string;
  category: FatwaTopicCategory | null;
  authorName: string | null;
  featuredImageUrl: string | null;
  publishedAt: string | null;
  viewCount: number;
  shareCount: number;
}

export interface FatwaTopicList {
  items: FatwaTopicItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export interface FatwaTopicCategoryCount extends FatwaTopicCategory {
  publishedCount: number;
}

export interface FatwaTopicPosition {
  madhab: string;
  positionText: string;
  evidenceRefs: string[];
}

export interface FatwaTopicDetail extends FatwaTopicItem {
  positions: FatwaTopicPosition[];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function localizedText(v: unknown, locale = 'fa'): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const m = v as Record<string, unknown>;
    for (const k of [locale, 'en', 'fa']) {
      if (typeof m[k] === 'string' && (m[k] as string).trim() !== '') return m[k] as string;
    }
    const first = Object.values(m).find((x): x is string => typeof x === 'string');
    if (first) return first;
  }
  return '';
}

function parseCategory(raw: unknown, locale: string): FatwaTopicCategory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slug = asString(r.slug);
  if (!slug) return null;
  return { slug, title: localizedText(r.title, locale) };
}

function parseItem(raw: unknown, locale: string): FatwaTopicItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id);
  if (!id) return null;
  return {
    id,
    title: localizedText(r.title, locale),
    description: localizedText(r.description, locale),
    category: parseCategory(r.category, locale),
    authorName: typeof r.author_name === 'string' ? r.author_name : null,
    featuredImageUrl: typeof r.featured_image_url === 'string' ? r.featured_image_url : null,
    publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
    viewCount: typeof r.view_count === 'number' ? r.view_count : 0,
    shareCount: typeof r.share_count === 'number' ? r.share_count : 0,
  };
}

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl().replace(/\/+$/, '')}${path}`, {
      headers: { Accept: 'application/json' },
      ...init,
    });
  } catch (err) {
    throw new ApiError(`API unreachable at ${getApiBaseUrl()}: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  if (!res.ok) throw new ApiError(`GET ${path} → ${res.status}`, res.status);
  return await res.json();
}

export async function getFatwaListServer(opts: {
  locale?: string;
  q?: string;
  category?: string;
  sort?: 'newest' | 'views';
  page?: number;
  perPage?: number;
  exclude?: string;
}): Promise<FatwaTopicList> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.exclude) params.set('exclude', opts.exclude);
  params.set('page', String(opts.page ?? 1));
  params.set('per_page', String(opts.perPage ?? 10));
  const o = (await fetchJson(`/api/v1/fatwa/topics?${params.toString()}`, {
    next: { revalidate: 60 },
  })) as Record<string, unknown>;
  const locale = opts.locale ?? 'fa';
  const items = Array.isArray(o.items)
    ? o.items.map((raw) => parseItem(raw, locale)).filter((x): x is FatwaTopicItem => x !== null)
    : [];
  return {
    items,
    total: typeof o.total === 'number' ? o.total : items.length,
    page: typeof o.page === 'number' ? o.page : 1,
    perPage: typeof o.per_page === 'number' ? o.per_page : 10,
    pages: typeof o.pages === 'number' ? o.pages : 0,
  };
}

export async function getFatwaCategoriesServer(locale = 'fa'): Promise<FatwaTopicCategoryCount[]> {
  const raw = await fetchJson('/api/v1/fatwa/topics/categories', {
    next: { revalidate: 60 },
  });
  // The categories endpoint returns a bare array, not an object.
  const arr = Array.isArray(raw) ? raw : [];
  const out: FatwaTopicCategoryCount[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const slug = asString(r.slug);
    if (!slug) continue;
    out.push({
      slug,
      title: localizedText(r.title, locale),
      publishedCount: typeof r.published_count === 'number' ? r.published_count : 0,
    });
  }
  return out;
}

/**
 * Detail fetch — no-store on purpose: every render counts one view on the
 * API side, so a cached response would silently drop views.
 * Returns null on 404 (caller renders notFound); throws on other failures.
 */
export async function getFatwaDetailServer(
  topicId: string,
  locale = 'fa',
): Promise<FatwaTopicDetail | null> {
  let o: Record<string, unknown>;
  try {
    o = (await fetchJson(`/api/v1/fatwa/topics/${encodeURIComponent(topicId)}`, {
      cache: 'no-store',
    })) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  const item = parseItem(o, locale);
  if (!item) return null;
  const positions: FatwaTopicPosition[] = Array.isArray(o.positions)
    ? (o.positions as unknown[])
        .map((raw): FatwaTopicPosition | null => {
          if (!raw || typeof raw !== 'object') return null;
          const p = raw as Record<string, unknown>;
          return {
            madhab: asString(p.madhab),
            positionText: localizedText(p.position_text, locale),
            evidenceRefs: Array.isArray(p.evidence_refs)
              ? p.evidence_refs.filter((x): x is string => typeof x === 'string')
              : [],
          };
        })
        .filter((p): p is FatwaTopicPosition => p !== null)
    : [];
  return { ...item, positions };
}

/**
 * Publish date in both calendars: Solar Hijri (shamsi) and Lunar Hijri
 * (qamari). Rendered with the page locale; falls back to the ISO date
 * when the runtime lacks the calendar data.
 */
export function formatDualHijri(
  iso: string | null,
  locale: string,
): { shamsi: string; qamari: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = (calendar: string): string => {
    try {
      return new Intl.DateTimeFormat(`${locale}-u-ca-${calendar}`, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(d);
    } catch {
      return '';
    }
  };
  const shamsi = fmt('persian');
  const qamari = fmt('islamic');
  if (!shamsi && !qamari) return { shamsi: iso.slice(0, 10), qamari: '' };
  return { shamsi, qamari };
}
