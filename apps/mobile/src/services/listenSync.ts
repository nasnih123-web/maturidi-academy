/**
 * apps/mobile — src/services/listenSync.ts
 *
 * Server sync for the listen position (completion mission §5).
 *
 * Endpoints (new in this wave): `GET/PUT /api/v1/quran/hifz/listen-position`
 * — one row per user, last-write-wins by `updated_at` (the rule lives in
 * `hifz_listen_sync.py` and `lib/listenPlayer.ts` `mergeListenPositions`).
 *
 * - LOCAL FIRST: the position always lives in the local kv table first
 *   (`listen:position:v1`). Every play/pause writes it; the server is a
 *   second copy, never the only copy.
 * - FIRST LOGIN (localStorage → server, no data loss): on sign-in,
 *   `syncListenPositionOnLogin()` fetches the server state and merges it
 *   with the local one. Local-newer pushes up; server-newer is adopted;
 *   a stale push (`applied=false`) adopts the returned server state.
 * - GUESTS keep local storage only: with no stored session the server
 *   is never contacted.
 * - SERVER DISCONNECT must not lose local playback: any network failure
 *   leaves the local position untouched and reports `offline: true`.
 *   Playback continues from the local position.
 * - No sensitive audio data is stored or sent — only the reciter id,
 *   surah/ayah numbers, milliseconds, speed and repeat counts.
 * - Timing JSON is static data (Quran.com v4 segments); a fetched copy
 *   is cached in kv so an offline play still highlights words.
 */
import { api, ApiError, hasStoredSession } from "../lib/api";
import { apiBaseUrl } from "../lib/config";
import { getDb } from "../lib/db";
import {
  LISTEN_POSITION_KV_KEY,
  LISTEN_TIMING_KV_PREFIX,
  localPositionToServer,
  mergeListenPositions,
  parseListenPosition,
  serverPositionToLocal,
  type ListenPosition,
  type RecitationTiming,
} from "../lib/listenPlayer";

const LISTEN_PATH = "/api/v1/quran/hifz/listen-position";

/** Core reciters when the reciter list cannot be fetched (offline). */
export const FALLBACK_RECITERS: { id: string; label: string }[] = [
  { id: "alafasy", label: "مشاری راشد العفاسی" },
  { id: "abdul_basit", label: "عبدالباسط عبدالصمد" },
  { id: "husary", label: "محمود خلیل الحصری" },
];

async function kvGet(key: string): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [key]);
  return row?.value ?? null;
}

async function kvSet(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
    [key, value, value],
  );
}

/** The local listen position (null = never listened). Corrupt → null. */
export async function loadLocalPosition(): Promise<ListenPosition | null> {
  const raw = await kvGet(LISTEN_POSITION_KV_KEY);
  if (!raw) return null;
  try {
    return parseListenPosition(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Persist the position locally (always first; server sync is second). */
export async function saveLocalPosition(pos: ListenPosition): Promise<void> {
  await kvSet(LISTEN_POSITION_KV_KEY, JSON.stringify({ ...pos, updatedAt: pos.updatedAt }));
}

/** Clear the local position (surah finished — the next visit starts at ayah 1). */
export async function clearLocalPosition(): Promise<void> {
  const database = await getDb();
  await database.runAsync(`DELETE FROM kv WHERE key = ?`, [LISTEN_POSITION_KV_KEY]);
}

export interface ListenSyncResult {
  position: ListenPosition | null;
  /** Where the resolved position came from. */
  source: "local" | "server" | "none";
  /** True when the server could not be reached (local kept as-is). */
  offline: boolean;
}

/** Fetch the server position (null = none stored). Throws on network failure. */
export async function fetchServerPosition(): Promise<ListenPosition | null> {
  const body = await api.get<Record<string, unknown> | null>(LISTEN_PATH, { auth: true });
  if (body === null) return null;
  return serverPositionToLocal(body);
}

export interface PushListenResult {
  applied: boolean;
  conflict: boolean;
  position: ListenPosition | null;
}

/** Push a local position to the server. Throws on network failure. */
export async function pushPosition(pos: ListenPosition): Promise<PushListenResult> {
  const body = await api.put<{
    applied: boolean;
    conflict: boolean;
    position: Record<string, unknown> | null;
  }>(LISTEN_PATH, localPositionToServer(pos), { auth: true });
  return {
    applied: body.applied === true,
    conflict: body.conflict === true,
    position: body.position ? serverPositionToLocal(body.position) : null,
  };
}

/**
 * First-login migration + every reconnect: merge local and server
 * positions (last-write-wins), save the winner locally, push it when
 * the local side won. Guests (no stored session) and offline devices
 * keep the local position untouched.
 */
export async function syncListenPositionOnLogin(): Promise<ListenSyncResult> {
  const local = await loadLocalPosition();
  if (!(await hasStoredSession())) {
    return { position: local, source: local ? "local" : "none", offline: false };
  }
  let server: ListenPosition | null;
  try {
    server = await fetchServerPosition();
  } catch (e) {
    if (e instanceof ApiError && e.isNetworkError) {
      return { position: local, source: local ? "local" : "none", offline: true };
    }
    throw e;
  }
  const merged = mergeListenPositions(local, server);
  if (merged.position) await saveLocalPosition(merged.position);
  if (merged.shouldPush && merged.position) {
    try {
      const pushed = await pushPosition(merged.position);
      if (!pushed.applied && pushed.position) {
        // The server had a newer state after all — adopt it.
        await saveLocalPosition(pushed.position);
        return { position: pushed.position, source: "server", offline: false };
      }
    } catch (e) {
      if (e instanceof ApiError && e.isNetworkError) {
        return { position: merged.position, source: "local", offline: true };
      }
      throw e;
    }
  }
  return { position: merged.position, source: merged.source, offline: false };
}

/**
 * Push the current local position in the background (pause/stop,
 * throttled while playing). Fire-and-forget safe: network failure
 * keeps the local position; a stale write adopts the server state.
 * Returns false when nothing was pushed (guest / offline / stale).
 */
export async function pushLocalPositionBestEffort(): Promise<boolean> {
  if (!(await hasStoredSession())) return false;
  const local = await loadLocalPosition();
  if (!local) return false;
  try {
    const pushed = await pushPosition(local);
    if (!pushed.applied && pushed.position) {
      await saveLocalPosition(pushed.position);
      return false;
    }
    return pushed.applied;
  } catch {
    return false;
  }
}

// ── Reciters + timing (public endpoints; cached for offline) ───────────

export async function fetchReciters(): Promise<{ id: string; label: string }[]> {
  try {
    const res = await api.get<{ reciters: { id: string; label: string }[] }>(
      "/api/v1/quran/recitation/reciters",
      { auth: false },
    );
    const list = res.reciters ?? [];
    return list.length > 0 ? list : FALLBACK_RECITERS;
  } catch {
    return FALLBACK_RECITERS;
  }
}

function timingKey(reciter: string, surah: number): string {
  return `${LISTEN_TIMING_KV_PREFIX}${reciter}:${surah}`;
}

/** Cached timing JSON (offline play); null when never fetched. */
export async function loadCachedTiming(reciter: string, surah: number): Promise<RecitationTiming | null> {
  const raw = await kvGet(timingKey(reciter, surah));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(parsed.ayahs) || typeof parsed.audioUrl !== "string") return null;
    return parsed as unknown as RecitationTiming;
  } catch {
    return null;
  }
}

export async function cacheTiming(timing: RecitationTiming): Promise<void> {
  await kvSet(timingKey(timing.reciter, timing.surah), JSON.stringify(timing));
}

/**
 * Fetch real word timings for one reciter + surah. Null on any failure
 * (404/503/network) — the caller falls back to interpolation and says
 * so. A cached copy is returned when the network fails, so an offline
 * play still highlights words from the real segments.
 */
export async function fetchRecitationTiming(reciter: string, surah: number): Promise<RecitationTiming | null> {
  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/quran/recitation/timing?reciter=${encodeURIComponent(reciter)}&surah=${surah}`,
    );
    if (!res.ok) return (await loadCachedTiming(reciter, surah)) ?? null;
    const body = (await res.json()) as {
      reciter?: unknown;
      surah?: unknown;
      audio_url?: unknown;
      source?: unknown;
      ayahs?: unknown;
    };
    if (!body || !Array.isArray(body.ayahs) || body.ayahs.length === 0) {
      return (await loadCachedTiming(reciter, surah)) ?? null;
    }
    if (typeof body.audio_url !== "string" || !body.audio_url) {
      return (await loadCachedTiming(reciter, surah)) ?? null;
    }
    const ayahs = [];
    for (const a of body.ayahs as Record<string, unknown>[]) {
      if (typeof a !== "object" || a === null) continue;
      const ayah = a.ayah;
      const fromMs = a.from_ms;
      const toMs = a.to_ms;
      if (typeof ayah !== "number" || typeof fromMs !== "number" || typeof toMs !== "number") continue;
      if (toMs <= fromMs) continue;
      const words = [];
      if (Array.isArray(a.words)) {
        for (const w of a.words as Record<string, unknown>[]) {
          if (typeof w !== "object" || w === null) continue;
          if (typeof w.word !== "number" || typeof w.start_ms !== "number" || typeof w.end_ms !== "number") continue;
          if (w.end_ms <= w.start_ms) continue;
          words.push({ word: w.word, startMs: w.start_ms, endMs: w.end_ms });
        }
      }
      words.sort((x, y) => x.startMs - y.startMs);
      ayahs.push({ ayah, fromMs, toMs, durationMs: toMs - fromMs, words });
    }
    if (ayahs.length === 0) return (await loadCachedTiming(reciter, surah)) ?? null;
    ayahs.sort((x, y) => x.ayah - y.ayah);
    const timing: RecitationTiming = {
      reciter: typeof body.reciter === "string" ? body.reciter : reciter,
      surah: typeof body.surah === "number" ? body.surah : surah,
      audioUrl: body.audio_url,
      source: typeof body.source === "string" ? body.source : "quran_com_v4",
      ayahs,
    };
    await cacheTiming(timing);
    return timing;
  } catch {
    return (await loadCachedTiming(reciter, surah)) ?? null;
  }
}
