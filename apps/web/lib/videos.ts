import { ApiError, getApiBaseUrl } from './api';
import type { LocalizedText } from './types';

/**
 * Videos section contract types + server-side fetchers.
 *
 * Mirrors GET /api/v1/videos* exactly. Videos are library items
 * (kind=video|video_360) grouped into playlists; covers/stream URLs are
 * the API's short-lived signed URLs — never raw storage keys.
 * Per ADR-0002 this module is the only place that knows the wire shape.
 */

export type VideoKind = 'video' | 'video_360';

export interface VideoPlaylistRef {
  id: string;
  title: LocalizedText | null;
}

export interface VideoItem {
  id: string;
  kind: VideoKind;
  title: LocalizedText | null;
  description: LocalizedText | null;
  cover_url: string | null;
  /** External (YouTube) video: canonical watch URL + nocookie embed URL.
   *  Both null for uploaded items, which play via the watch stream_url. */
  external_url: string | null;
  embed_url: string | null;
  duration_seconds: number | null;
  scholar_id: string | null;
  scholar_name: string | null;
  topic_tags: string[];
  visibility: string;
  created_at: string;
  playlists: VideoPlaylistRef[];
}

export interface VideoPlaylist {
  id: string;
  title: LocalizedText | null;
  description: LocalizedText | null;
  cover_url: string | null;
  scholar_id: string | null;
  scholar_name: string | null;
  is_published: boolean;
  sort_order: number;
  item_count: number;
  total_duration_seconds: number;
  items: VideoItem[];
  created_at: string;
  updated_at: string;
}

export interface VideoPlaylistContext {
  playlist: VideoPlaylistRef;
  position: number;
  total: number;
  prev_item_id: string | null;
  next_item_id: string | null;
  items: VideoItem[];
}

export interface SubtitleTrack {
  lang: string;
  /** Absolute URL of the WebVTT file (API path absolutized here). */
  url: string;
}

export interface VideoWatch {
  item: VideoItem;
  stream_url: string | null;
  playlist: VideoPlaylistContext | null;
  related: VideoItem[];
  /** Ready subtitle tracks only; empty when subtitles are disabled. */
  subtitles: SubtitleTrack[];
}

export interface VideoListResponse {
  items: VideoItem[];
  next_cursor: string | null;
}

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}`;
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
      `API unreachable at ${getApiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  return res;
}

/** GET /api/v1/videos — public video list (newest first, cursor paging). */
export async function getVideos(
  opts: { cursor?: string; limit?: number } = {},
): Promise<VideoListResponse> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('after', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetchJson(`/api/v1/videos${qs ? `?${qs}` : ''}`, {
    next: { revalidate: 120 },
  });
  if (!res.ok) throw new ApiError(`GET /api/v1/videos → ${res.status}`, res.status);
  const body = (await res.json()) as VideoListResponse;
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    next_cursor: body?.next_cursor ?? null,
  };
}

/** GET /api/v1/videos/playlists — published playlists with first items. */
export async function getVideoPlaylists(): Promise<VideoPlaylist[]> {
  const res = await fetchJson('/api/v1/videos/playlists', {
    next: { revalidate: 120 },
  });
  if (!res.ok) {
    throw new ApiError(`GET /api/v1/videos/playlists → ${res.status}`, res.status);
  }
  const body = (await res.json()) as VideoPlaylist[];
  return Array.isArray(body) ? body : [];
}

/**
 * GET /api/v1/videos/{id} — watch detail. A 404 means the item does not
 * exist OR is not visible to an anonymous caller (unpublished or
 * restricted visibility) — callers render the not-found state.
 */
export async function getVideoWatch(
  id: string,
  playlistId?: string | null,
): Promise<VideoWatch> {
  const qs = playlistId ? `?playlist=${encodeURIComponent(playlistId)}` : '';
  const res = await fetchJson(`/api/v1/videos/${encodeURIComponent(id)}${qs}`, {
    next: { revalidate: 120 },
  });
  if (!res.ok) {
    throw new ApiError(`GET /api/v1/videos/${id} → ${res.status}`, res.status);
  }
  const body = (await res.json()) as VideoWatch;
  return {
    item: body.item,
    stream_url: body.stream_url ?? null,
    playlist: body.playlist ?? null,
    related: Array.isArray(body.related) ? body.related : [],
    subtitles: (Array.isArray(body.subtitles) ? body.subtitles : []).map(
      (tr) => ({
        lang: tr.lang,
        url: tr.url.startsWith('http') ? tr.url : apiUrl(tr.url),
      }),
    ),
  };
}
