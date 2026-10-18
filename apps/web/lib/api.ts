import type { HomeSectionsResponse, SearchResponse } from './types';

/**
 * Server-side API client (RSC only — never imported from client components).
 * Per ADR-0002 all data access goes through this layer; components render.
 */

export const API_BASE_URL = process.env.API_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
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
      `API unreachable at ${API_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
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
      `API unreachable at ${API_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
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
