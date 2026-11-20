import { apiFetch } from "./api";
import type { LocalizedText } from "./contentApi";

/**
 * Videos admin client — playlists over library video items
 * (`/api/v1/admin/videos/*`, permission library.manage) plus the
 * `videos.*` platform settings read/write through the shared admin
 * settings API (same calls Settings.tsx uses).
 */

export interface AdminPlaylistItem {
  item_id: string;
  position: number;
  kind: string;
  title: LocalizedText | null;
  cover_url: string | null;
  duration_seconds: number | null;
  workflow_status: string;
  visibility: string;
}

export interface AdminPlaylist {
  id: string;
  title: LocalizedText | null;
  description: LocalizedText | null;
  cover_media_key: string | null;
  cover_url: string | null;
  scholar_id: string | null;
  is_published: boolean;
  sort_order: number;
  item_count: number;
  items: AdminPlaylistItem[];
  created_at: string;
  updated_at: string;
}

export interface VideoCandidate {
  id: string;
  kind: string;
  title: LocalizedText | null;
  cover_url: string | null;
  duration_seconds: number | null;
  workflow_status: string;
  visibility: string;
  created_at: string;
}

export interface PlaylistWrite {
  title?: LocalizedText;
  description?: LocalizedText | null;
  cover_media_key?: string | null;
  scholar_id?: string | null;
  is_published?: boolean;
  sort_order?: number;
}

const BASE = "/api/v1/admin/videos";

export function listPlaylists(): Promise<AdminPlaylist[]> {
  return apiFetch<AdminPlaylist[]>(`${BASE}/playlists`);
}

export function createPlaylist(body: PlaylistWrite): Promise<AdminPlaylist> {
  return apiFetch<AdminPlaylist>(`${BASE}/playlists`, {
    method: "POST",
    body,
  });
}

export function updatePlaylist(
  id: string,
  body: PlaylistWrite,
): Promise<AdminPlaylist> {
  return apiFetch<AdminPlaylist>(`${BASE}/playlists/${id}`, {
    method: "PATCH",
    body,
  });
}

export function deletePlaylist(id: string): Promise<unknown> {
  return apiFetch(`${BASE}/playlists/${id}`, { method: "DELETE" });
}

export function addPlaylistItem(
  playlistId: string,
  itemId: string,
): Promise<AdminPlaylist> {
  return apiFetch<AdminPlaylist>(`${BASE}/playlists/${playlistId}/items`, {
    method: "POST",
    body: { item_id: itemId },
  });
}

export function removePlaylistItem(
  playlistId: string,
  itemId: string,
): Promise<AdminPlaylist> {
  return apiFetch<AdminPlaylist>(
    `${BASE}/playlists/${playlistId}/items/${itemId}`,
    { method: "DELETE" },
  );
}

export function reorderPlaylistItems(
  playlistId: string,
  itemIds: string[],
): Promise<AdminPlaylist> {
  return apiFetch<AdminPlaylist>(`${BASE}/playlists/${playlistId}/items/order`, {
    method: "PUT",
    body: { item_ids: itemIds },
  });
}

export function listCandidates(q: string): Promise<VideoCandidate[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return apiFetch<VideoCandidate[]>(`${BASE}/candidates${qs}`);
}

/* ------------------------- subtitles (phase 3) ---------------------- */

export type SubtitleStatus =
  | "ready"
  | "pending"
  | "processing"
  | "failed"
  | "missing";

export interface AdminSubtitleItem {
  id: string;
  kind: string;
  title: LocalizedText | null;
  workflow_status: string;
  visibility: string;
  created_at: string;
  /** Per-language status for all five subtitle languages. */
  subtitles: Record<string, SubtitleStatus>;
}

export interface SubtitleGenerateResult {
  item_id: string;
  statuses: Record<string, string>;
  enqueued: boolean;
}

export function fetchSubtitleStatuses(): Promise<AdminSubtitleItem[]> {
  return apiFetch<AdminSubtitleItem[]>(`${BASE}/subtitles`);
}

export function generateSubtitles(
  itemId: string,
): Promise<SubtitleGenerateResult> {
  return apiFetch<SubtitleGenerateResult>(
    `${BASE}/${itemId}/subtitles/generate`,
    { method: "POST" },
  );
}

/* ------------------------- videos.* settings ------------------------ */

export interface VideosSettingsValues {
  home_enabled: boolean;
  sidebar_side: "left" | "right";
  autoplay_next: boolean;
  resume_playback: boolean;
  player_speed: boolean;
  player_pip: boolean;
  related_enabled: boolean;
  subtitle_default_lang: string;
  subtitles_enabled: boolean;
  subtitle_langs: string[];
}

export const SUBTITLE_LANGS = ["fa", "ar", "en", "ur", "dari"] as const;

export const DEFAULT_VIDEOS_SETTINGS: VideosSettingsValues = {
  home_enabled: true,
  sidebar_side: "left",
  autoplay_next: true,
  resume_playback: true,
  player_speed: true,
  player_pip: true,
  related_enabled: true,
  subtitle_default_lang: "fa",
  subtitles_enabled: true,
  subtitle_langs: ["fa", "ar", "en", "ur", "dari"],
};

interface SettingItem {
  key: string;
  value: unknown;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/** Read the videos.* keys out of the shared admin settings snapshot. */
export async function fetchVideosSettings(): Promise<VideosSettingsValues> {
  const res = await apiFetch<{ settings: SettingItem[] }>("/api/v1/admin/settings");
  const map = new Map(res.settings.map((s) => [s.key, s.value]));
  const get = (k: string) => map.get(`videos.${k}`);
  const side = get("sidebar_side");
  const defLang = get("subtitle_default_lang");
  const langsRaw = get("subtitle_langs");
  const langs = Array.isArray(langsRaw)
    ? langsRaw.filter(
        (l): l is string =>
          typeof l === "string" &&
          (SUBTITLE_LANGS as readonly string[]).includes(l),
      )
    : [];
  return {
    home_enabled: asBool(get("home_enabled"), true),
    sidebar_side: side === "right" ? "right" : "left",
    autoplay_next: asBool(get("autoplay_next"), true),
    resume_playback: asBool(get("resume_playback"), true),
    player_speed: asBool(get("player_speed"), true),
    player_pip: asBool(get("player_pip"), true),
    related_enabled: asBool(get("related_enabled"), true),
    subtitle_default_lang:
      typeof defLang === "string" &&
      (SUBTITLE_LANGS as readonly string[]).includes(defLang)
        ? defLang
        : "fa",
    subtitles_enabled: asBool(get("subtitles_enabled"), true),
    subtitle_langs: langs.length > 0 ? langs : [...DEFAULT_VIDEOS_SETTINGS.subtitle_langs],
  };
}

/** Save all videos.* keys in one PUT (same payload shape as Settings.tsx). */
export async function saveVideosSettings(
  values: VideosSettingsValues,
): Promise<void> {
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    settings[`videos.${k}`] = v;
  }
  await apiFetch("/api/v1/admin/settings", {
    method: "PUT",
    body: { settings },
  });
}
