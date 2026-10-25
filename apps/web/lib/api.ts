import type { HomeSectionsResponse, SearchResponse } from './types';

/**
 * Server-side API client (RSC only — never imported from client components).
 * Per ADR-0002 all data access goes through this layer; components render.
 *
 * آدرس از متغیر سروری API_URL می‌آید (رانتایم، نه build — برخلاف
 * NEXT_PUBLIC_API_URL که عمومی/مرورگر است؛ Track 2 / §۱۳).
 * در production بدون API_URL صریح، بلند خطا می‌دهد (نه fallback خاموش به
 * localhost) — مقدار درست در compose: http://api:8000 (نام سرویس داخلی).
 *
 * CRITICAL — lazy, never at import time: this module is transitively
 * imported by client bundles (layout → AdhanCountdown → useAdhanCountdown
 * → lib/adhan → lib/api), and in the browser process.env.API_URL is always
 * undefined (only NEXT_PUBLIC_* vars are inlined into client bundles).
 * A module-level `export const API_BASE_URL = resolveApiBaseUrl()` therefore
 * threw an Uncaught Error in every browser page load, before any caller's
 * try/catch could run. Resolve only on first use, inside the fetch
 * functions, so callers that catch ApiError (or return null/defaults) get
 * the graceful error state instead of a crashed render/hydration.
 */
function resolveApiBaseUrl(): string {
  const base = process.env.API_URL;
  if (base) return base;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[web] API_URL is not set for this production server — refusing to ' +
        'silently fall back to http://localhost:8000. Set API_URL ' +
        '(e.g. http://api:8000 inside docker-compose.prod.yml).'
    );
  }
  return 'http://localhost:8000';
}

/** Lazy replacement for the old module-level API_BASE_URL constant. */
export function getApiBaseUrl(): string {
  return resolveApiBaseUrl();
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}`;
}

/**
 * Fetch the homepage sections contract.
 * Throws ApiError when the API is unreachable or returns a non-2xx status —
 * callers render a graceful error state (contract §15: no mock data in the
 * production path, never fake sections).
 */
export async function getHomeSections(): Promise<HomeSectionsResponse> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/v1/home/sections'), {
      next: { revalidate: 120 },
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new ApiError(`GET /api/v1/home/sections → ${res.status}`, res.status);
  }
  const body = (await res.json()) as HomeSectionsResponse;
  return {
    theme: body?.theme ?? null,
    sections: Array.isArray(body?.sections) ? body.sections : [],
  };
}

/**
 * Server-side global search: GET /api/v1/search?q=&type=&limit=.
 * Throws ApiError on unreachable API or non-2xx — callers render a graceful
 * error state. Pure plumbing; no business logic.
 */
export async function searchApi(
  q: string,
  opts: { type?: string; limit?: number } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (opts.type) params.set('type', opts.type);
  if (opts.limit) params.set('limit', String(opts.limit));
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/v1/search?${params.toString()}`), {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new ApiError(`GET /api/v1/search → ${res.status}`, res.status);
  }
  const body = (await res.json()) as SearchResponse;
  return {
    query: typeof body?.query === 'string' ? body.query : q,
    results: Array.isArray(body?.results) ? body.results : [],
    total: typeof body?.total === 'number' ? body.total : 0,
  };
}
