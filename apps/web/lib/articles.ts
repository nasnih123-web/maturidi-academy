/**
 * Server-side client for the public articles listing (WordPress-style catalog).
 *
 * RSC only — never imported from client code. Mirrors lib/fatwa-topics.ts.
 * Only published articles are ever served here (the API enforces it).
 *
 * Endpoints (public, no auth):
 *   GET /api/v1/articles?q&category&sort&page&per_page&exclude
 *   GET /api/v1/articles/categories
 *   GET /api/v1/articles/{slug}        (each call counts one view)
 *   GET /api/v1/articles/{slug}/meta   (never counts a view — metadata only)
 */
import { getApiBaseUrl, ApiError } from './api';
import { localizedText } from './fatwa-topics';

export interface ArticleCategory {
  slug: string;
  title: string;
}

export interface ArticleItem {
  slug: string;
  title: string;
  category: ArticleCategory | null;
  authorName: string | null;
  featuredImageUrl: string | null;
  publishedAt: string | null;
  viewCount: number;
  shareCount: number;
}

export interface ArticleList {
  items: ArticleItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export interface ArticleCategoryCount extends ArticleCategory {
  publishedCount: number;
}

export interface ArticleDetail extends ArticleItem {
  body: unknown;
}

export interface ArticleMeta {
  slug: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  featuredImageUrl: string | null;
  category: ArticleCategory | null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseCategory(raw: unknown, locale: string): ArticleCategory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slug = asString(r.slug);
  if (!slug) return null;
  return { slug, title: localizedText(r.title, locale) };
}

function parseItem(raw: unknown, locale: string): ArticleItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slug = asString(r.slug);
  if (!slug) return null;
  return {
    slug,
    title: localizedText(r.title, locale),
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

export async function getArticleListServer(opts: {
  locale?: string;
  q?: string;
  category?: string;
  sort?: 'newest' | 'views';
  page?: number;
  perPage?: number;
  exclude?: string;
}): Promise<ArticleList> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.exclude) params.set('exclude', opts.exclude);
  params.set('page', String(opts.page ?? 1));
  params.set('per_page', String(opts.perPage ?? 10));
  const o = (await fetchJson(`/api/v1/articles?${params.toString()}`, {
    next: { revalidate: 60 },
  })) as Record<string, unknown>;
  const locale = opts.locale ?? 'fa';
  const items = Array.isArray(o.items)
    ? o.items.map((raw) => parseItem(raw, locale)).filter((x): x is ArticleItem => x !== null)
    : [];
  return {
    items,
    total: typeof o.total === 'number' ? o.total : items.length,
    page: typeof o.page === 'number' ? o.page : 1,
    perPage: typeof o.per_page === 'number' ? o.per_page : 10,
    pages: typeof o.pages === 'number' ? o.pages : 0,
  };
}

export async function getArticleCategoriesServer(locale = 'fa'): Promise<ArticleCategoryCount[]> {
  const raw = await fetchJson('/api/v1/articles/categories', {
    next: { revalidate: 60 },
  });
  const arr = Array.isArray(raw) ? raw : [];
  const out: ArticleCategoryCount[] = [];
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
export async function getArticleDetailServer(
  slug: string,
  locale = 'fa',
): Promise<ArticleDetail | null> {
  let o: Record<string, unknown>;
  try {
    o = (await fetchJson(`/api/v1/articles/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    })) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  const item = parseItem(o, locale);
  if (!item) return null;
  return { ...item, body: o.body ?? null };
}

/**
 * Metadata fetch — revalidated, never counts a view. Used ONLY by
 * generateMetadata so metadata never double-counts visits.
 * Returns null on 404; throws on other failures.
 */
export async function getArticleMetaServer(
  slug: string,
  locale = 'fa',
): Promise<ArticleMeta | null> {
  let o: Record<string, unknown>;
  try {
    o = (await fetchJson(`/api/v1/articles/${encodeURIComponent(slug)}/meta`, {
      next: { revalidate: 60 },
    })) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
  if (!asString(o.slug)) return null;
  return {
    slug: asString(o.slug),
    title: localizedText(o.title, locale),
    seoTitle: typeof o.seo_title === 'string' ? o.seo_title : null,
    seoDescription: typeof o.seo_description === 'string' ? o.seo_description : null,
    featuredImageUrl: typeof o.featured_image_url === 'string' ? o.featured_image_url : null,
    category: parseCategory(o.category, locale),
  };
}
