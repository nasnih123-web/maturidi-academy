import { ApiError, API_BASE_URL } from './api';
import type { LocalizedText } from './types';

/**
 * Phase 9 — multimedia library (DMS) contract types + server-side fetchers.
 *
 * Mirrors GET /api/v1/library/* exactly. Per ADR-0002 this module is the
 * only place that knows the wire shape; components receive rendered values
 * (plain strings, numbers, URLs) via props. Pure plumbing — no UI.
 */

export type LibraryKind = 'video' | 'video_360' | 'pdf' | 'audio' | 'mindmap';

export const LIBRARY_KINDS: LibraryKind[] = ['video', 'video_360', 'pdf', 'audio', 'mindmap'];

export interface LibraryChapter {
  /** Chapter/topic title — LocalizedText or plain string. */
  title: LocalizedText | string | null;
  /** Seconds from the media start (video/audio/360). */
  start_seconds?: number | null;
  /** 1-based page for PDF items. */
  start_page?: number | null;
}

export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

export interface LibraryRelatedItem {
  id: string;
  kind: LibraryKind;
  title: LocalizedText | null;
  cover_url?: string | null;
  scholar_name?: string | LocalizedText | null;
  duration_seconds?: number | null;
}

export interface LibraryItemSummary {
  id: string;
  kind: LibraryKind;
  title: LocalizedText | null;
  description?: LocalizedText | null;
  cover_url?: string | null;
  scholar_name?: string | LocalizedText | null;
  duration_seconds?: number | null;
  visibility?: string | null;
  workflow_status?: string | null;
  tags?: string[] | null;
}

export interface LibraryItemDetail extends LibraryItemSummary {
  media_url?: string | null;
  transcript?: string | null;
  chapters?: LibraryChapter[] | null;
  /** Optional mindmap payload for kind=mindmap: {label, children}. */
  mindmap?: MindmapNode | null;
  scholar?: string | LocalizedText | null;
  tags?: string[] | null;
  related_items?: LibraryRelatedItem[] | null;
  /** Optional first-page preview image for PDFs (falls back to cover_url). */
  preview_url?: string | null;
  /** Optional captions/subtitles file URL for video items. */
  captions_url?: string | null;
  /** Projection type for 360 items, e.g. "equirectangular". */
  projection?: string | null;
}

export interface LibraryListResponse {
  items: LibraryItemSummary[];
  next_cursor: string | null;
}

export interface LibrarySearchResponse {
  items: LibraryItemSummary[];
  query: string;
}

function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
}

async function fetchJson(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable at ${API_BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  return res;
}

function normalizeItems(body: unknown): LibraryItemSummary[] {
  const raw = (body as { items?: unknown })?.items;
  return Array.isArray(raw) ? (raw as LibraryItemSummary[]) : [];
}

/**
 * GET /api/v1/library/items?kind=&tag=&q=&cursor=
 * Server-side (RSC). Throws ApiError on unreachable API or non-2xx.
 */
export async function getLibraryItems(
  opts: { kind?: LibraryKind | 'all'; tag?: string; q?: string; cursor?: string } = {},
): Promise<LibraryListResponse> {
  const params = new URLSearchParams();
  if (opts.kind && opts.kind !== 'all') params.set('kind', opts.kind);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.q) params.set('q', opts.q);
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  const res = await fetchJson(`/api/v1/library/items${qs ? `?${qs}` : ''}`, {
    next: { revalidate: 120 },
  });
  if (!res.ok) throw new ApiError(`GET /api/v1/library/items → ${res.status}`, res.status);
  const body = (await res.json()) as { items?: unknown; next_cursor?: unknown };
  return {
    items: normalizeItems(body),
    next_cursor: typeof body?.next_cursor === 'string' ? body.next_cursor : null,
  };
}

/**
 * GET /api/v1/library/items/{id} — full detail for one item.
 * A 404 means the item does not exist OR is not visible to an anonymous
 * caller (e.g. scholars_only) — callers render the login-required state.
 */
export async function getLibraryItem(id: string): Promise<LibraryItemDetail> {
  const res = await fetchJson(`/api/v1/library/items/${encodeURIComponent(id)}`, {
    next: { revalidate: 120 },
  });
  if (!res.ok) throw new ApiError(`GET /api/v1/library/items/${id} → ${res.status}`, res.status);
  const body = (await res.json()) as LibraryItemDetail;
  return {
    ...body,
    related_items: Array.isArray(body?.related_items) ? body.related_items : [],
    chapters: Array.isArray(body?.chapters) ? body.chapters : [],
    tags: Array.isArray(body?.tags) ? body.tags : [],
  };
}

/**
 * GET /api/v1/library/search?q= — ranked full-text search over
 * title / tags / transcript. Server-side; throws ApiError on failure.
 */
export async function searchLibraryItems(q: string): Promise<LibrarySearchResponse> {
  const params = new URLSearchParams({ q });
  const res = await fetchJson(`/api/v1/library/search?${params.toString()}`);
  if (!res.ok) throw new ApiError(`GET /api/v1/library/search → ${res.status}`, res.status);
  const body = (await res.json()) as { items?: unknown; query?: unknown };
  return {
    items: normalizeItems(body),
    query: typeof body?.query === 'string' ? body.query : q,
  };
}

/**
 * Absolute URL of the stream endpoint for an item.
 * GET …/stream answers 302 to a time-limited signed URL — the browser
 * follows the redirect; the raw storage URL is never exposed or hardcoded.
 */
export function libraryStreamUrl(id: string): string {
  return apiUrl(`/api/v1/library/items/${encodeURIComponent(id)}/stream`);
}

/**
 * Resolve a scholar/scholar_name value that may be a plain string or a
 * LocalizedText into a display string. Pure helper, no UI.
 */
export function scholarDisplay(
  value: string | LocalizedText | null | undefined,
  pick: (t: LocalizedText | null | undefined) => string,
): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return pick(value);
}

/**
 * Format a duration in seconds as h:mm:ss / m:ss with locale numerals.
 * Returns '' for null/negative input.
 */
export function formatDuration(totalSeconds: number | null | undefined, locale: string): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const nf = new Intl.NumberFormat(locale, { useGrouping: false });
  const p2 = (n: number) => nf.format(n).padStart(2, nf.format(0));
  const body = `${nf.format(m)}:${p2(sec)}`;
  return h > 0 ? `${nf.format(h)}:${p2(m)}:${p2(sec)}` : body;
}

/** Number of transcript "pages" when paginating by paragraphs. */
export const PDF_TRANSCRIPT_PAGE_SIZE = 6;

/**
 * Split a transcript into pages of paragraphs (client-side pagination for
 * the PDF viewer when no real PDF.js is bundled).
 */
export function paginateTranscript(transcript: string | null | undefined): string[][] {
  if (!transcript || !transcript.trim()) return [];
  const paras = transcript
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pages: string[][] = [];
  for (let i = 0; i < paras.length; i += PDF_TRANSCRIPT_PAGE_SIZE) {
    pages.push(paras.slice(i, i + PDF_TRANSCRIPT_PAGE_SIZE));
  }
  return pages;
}
