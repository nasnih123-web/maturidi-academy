/**
 * Browser-side library client (Phase 9).
 *
 * Used by client components for interactive filtering/search and for
 * resolving signed stream URLs. RSC/server code must use lib/library.ts
 * instead — this module reads NEXT_PUBLIC_API_URL and the user's tokens.
 *
 * Stream resolution: GET …/items/{id}/stream answers 302 to a time-limited
 * signed URL. fetch() follows the redirect, so response.url IS the signed
 * URL — the raw storage location is never hardcoded anywhere.
 */

import {
  getAccessToken,
  isLoggedIn,
  authFetch,
  type TokenPair,
} from './auth-client';
import { apiBaseUrl } from './api-base';
import type {
  LibraryItemDetail,
  LibraryItemSummary,
  LibraryKind,
  LibraryListResponse,
  LibrarySearchResponse,
} from './library';

function apiBase(): string {
  return apiBaseUrl();
}

export function libraryStreamEndpoint(id: string): string {
  return `${apiBase()}/api/v1/library/items/${encodeURIComponent(id)}/stream`;
}

async function clientFetch(path: string, init?: RequestInit): Promise<Response> {
  // Authenticated callers (scholars_only items) go through the token-aware
  // wrapper; anonymous callers use a plain fetch. The wrapper refreshes
  // once on 401, same as the rest of the web app.
  if (isLoggedIn()) {
    return authFetch(path, init);
  }
  return fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
}

export class LibraryClientError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'LibraryClientError';
    this.status = status;
  }
}

function normalizeItems(body: unknown): LibraryItemSummary[] {
  const raw = (body as { items?: unknown })?.items;
  return Array.isArray(raw) ? (raw as LibraryItemSummary[]) : [];
}

/** GET /api/v1/library/items?kind=&tag=&q=&cursor= from the browser. */
export async function fetchLibraryItems(
  opts: { kind?: LibraryKind | 'all'; tag?: string; q?: string; cursor?: string } = {},
): Promise<LibraryListResponse> {
  const params = new URLSearchParams();
  if (opts.kind && opts.kind !== 'all') params.set('kind', opts.kind);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.q) params.set('q', opts.q);
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  let res: Response;
  try {
    res = await clientFetch(`/api/v1/library/items${qs ? `?${qs}` : ''}`);
  } catch (err) {
    throw new LibraryClientError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) throw new LibraryClientError(`library items → ${res.status}`, res.status);
  const body = (await res.json()) as { items?: unknown; next_cursor?: unknown };
  return {
    items: normalizeItems(body),
    next_cursor: typeof body?.next_cursor === 'string' ? body.next_cursor : null,
  };
}

/** GET /api/v1/library/search?q= from the browser (ranked). */
export async function fetchLibrarySearch(q: string): Promise<LibrarySearchResponse> {
  const params = new URLSearchParams({ q });
  let res: Response;
  try {
    res = await clientFetch(`/api/v1/library/search?${params.toString()}`);
  } catch (err) {
    throw new LibraryClientError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) throw new LibraryClientError(`library search → ${res.status}`, res.status);
  const body = (await res.json()) as { items?: unknown; query?: unknown };
  return {
    items: normalizeItems(body),
    query: typeof body?.query === 'string' ? body.query : q,
  };
}

/** GET /api/v1/library/items/{id} from the browser (auth-aware). */
export async function fetchLibraryItem(id: string): Promise<LibraryItemDetail> {
  let res: Response;
  try {
    res = await clientFetch(`/api/v1/library/items/${encodeURIComponent(id)}`);
  } catch (err) {
    throw new LibraryClientError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) throw new LibraryClientError(`library item ${id} → ${res.status}`, res.status);
  const body = (await res.json()) as LibraryItemDetail;
  return {
    ...body,
    related_items: Array.isArray(body?.related_items) ? body.related_items : [],
    chapters: Array.isArray(body?.chapters) ? body.chapters : [],
    tags: Array.isArray(body?.tags) ? body.tags : [],
  };
}

/**
 * Resolve the playable media URL for an item.
 *
 * The stream endpoint 302-redirects to a time-limited signed URL; fetch
 * follows it, so `response.url` is the signed URL. <audio>/<video> cannot
 * send Authorization headers, so this fetch goes through the auth-aware
 * wrapper for logged-in users (scholars_only items) and fails with 401/403
 * for anonymous callers — which the viewers surface honestly.
 */
export async function resolveStreamUrl(id: string): Promise<string> {
  let res: Response;
  try {
    res = await clientFetch(`/api/v1/library/items/${encodeURIComponent(id)}/stream`, {
      redirect: 'follow',
    });
  } catch (err) {
    throw new LibraryClientError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) throw new LibraryClientError(`library stream ${id} → ${res.status}`, res.status);
  if (!res.url) throw new LibraryClientError('stream endpoint returned no URL', 0);
  return res.url;
}

/** Re-export for callers that need the raw token (never logged). */
export type { TokenPair };
export { getAccessToken, isLoggedIn };
