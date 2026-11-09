/**
 * apps/mobile — src/lib/listenPlayer.ts
 *
 * Pure listen-player logic for the mobile Hifz listen mode (completion
 * mission §5). Ported from the academy's own web code — never from
 * Tarteel/Bayan/Hefz:
 * - speeds / repeat decision / repeat-remaining: `apps/web/lib/hifz-player.ts`
 * - word timings: `apps/web/lib/quran-recitation-timing.ts`
 * - timing source: `GET /api/v1/quran/recitation/timing` (Quran.com v4
 *   segments, QuranicAudio surah file, streamed — never bundled).
 *
 * No React Native, no audio here: the hook (`useListenPlayer`) owns the
 * expo-audio player, this module owns the decisions. Node-testable:
 * `npm run test:listen-player` (Node >= 22 type-strips the .ts import).
 *
 * MERGE RULE (same rule as the server — `hifz_listen_sync.py`):
 * last-write-wins by `updated_at`. `mergeListenPositions(local, server)`:
 * - server null → keep local (push it when online);
 * - local null → adopt server;
 * - server.updatedAt > local.updatedAt → adopt server;
 * - otherwise (local newer, or equal) → keep local and push it.
 * Equal timestamps keep local: deterministic, and the push confirms it.
 * A stale server write is never re-pushed: `saveListenPosition` returns
 * `applied=false` with the server state, and the client adopts it.
 */

export const LISTEN_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75] as const;

export type ListenRepeatMode = "off" | "ayah" | "range" | "surah";

export interface ListenRepeatRange {
  start: number;
  end: number;
  /** Total passes over the range (1 = play once, no repeat). */
  count: number;
}

/** The six Tarteel Listening speeds (spec §11.2). 2× is not offered. */
export function normalizeListenSpeed(rate: unknown): number {
  if (typeof rate === "number" && (LISTEN_SPEEDS as readonly number[]).includes(rate)) {
    return rate;
  }
  return 1;
}

/** Next speed in the Tarteel cycle (wraps 1.75× → 0.5×). */
export function nextListenSpeed(current: number): number {
  const idx = LISTEN_SPEEDS.indexOf(normalizeListenSpeed(current) as (typeof LISTEN_SPEEDS)[number]);
  return LISTEN_SPEEDS[(idx + 1) % LISTEN_SPEEDS.length] ?? 1;
}

/** Cycle the repeat mode (mini-player badge): off → ayah → range → surah. */
export function nextListenRepeatMode(mode: ListenRepeatMode): ListenRepeatMode {
  const order: ListenRepeatMode[] = ["off", "ayah", "range", "surah"];
  return order[(order.indexOf(mode) + 1) % order.length] ?? "off";
}

/** Clamp a repeat count to the server's accepted range (1–20). */
export function clampListenRepeatCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

export interface ListenRepeatInput {
  currentAyah: number;
  ayahCount: number;
  mode: ListenRepeatMode;
  /** Total plays of each ayah (1 = play once). */
  ayahRepeatCount: number;
  /** Range repeat; null = no range configured. */
  range: ListenRepeatRange | null;
  /** Plays already done of the current ayah in the current pass (1-based). */
  ayahPlays: number;
  /** Passes already done of the range (1-based). */
  rangePlays: number;
}

export type ListenRepeatOutcome =
  | { action: "replay"; ayah: number; ayahPlays: number; rangePlays: number }
  | { action: "goto"; ayah: number; ayahPlays: number; rangePlays: number }
  | { action: "stop"; ayahPlays: number; rangePlays: number };

/**
 * What happens when an ayah finishes playing. Pure; the hook only
 * applies the outcome. `stop` means the surah (or the range's tail)
 * is finished: playback ends, it does not loop forever — except
 * `surah` mode, which restarts the surah.
 */
export function listenRepeatNext(input: ListenRepeatInput): ListenRepeatOutcome {
  const ayahCount = Math.max(1, Math.floor(input.ayahCount));
  const current = Math.min(Math.max(1, Math.floor(input.currentAyah)), ayahCount);
  const ayahRepeat = clampListenRepeatCount(input.ayahRepeatCount);
  const ayahPlays = Math.max(1, Math.floor(input.ayahPlays));
  const rangePlays = Math.max(1, Math.floor(input.rangePlays));
  const replay = { action: "replay", ayah: current, ayahPlays: ayahPlays + 1, rangePlays } as const;
  const goto = (ayah: number, nextRangePlays = rangePlays) =>
    ({ action: "goto", ayah, ayahPlays: 1, rangePlays: nextRangePlays }) as const;
  const stop = { action: "stop", ayahPlays, rangePlays } as const;

  // An ayah that still has replays left replays first, in every mode
  // except off (off ignores the counts entirely).
  if (input.mode !== "off" && ayahPlays < ayahRepeat) return replay;

  switch (input.mode) {
    case "off":
    case "ayah":
      if (current < ayahCount) return goto(current + 1);
      return stop;
    case "surah":
      if (current < ayahCount) return goto(current + 1);
      return goto(1);
    case "range": {
      const range = input.range;
      if (!range) {
        if (current < ayahCount) return goto(current + 1);
        return stop;
      }
      const start = Math.min(Math.max(1, Math.floor(range.start)), ayahCount);
      const end = Math.min(Math.max(start, Math.floor(range.end)), ayahCount);
      const count = clampListenRepeatCount(range.count);
      if (current < start) return goto(start);
      if (current < end) return goto(current + 1);
      // Last ayah of the range (current >= end).
      if (rangePlays < count) return goto(start, rangePlays + 1);
      if (end < ayahCount) return goto(end + 1);
      return stop;
    }
    default:
      return stop;
  }
}

/** Plays left of the current ayah (ayah mode) or passes left of the
    range (range mode); null when the mode has no finite remainder. */
export function listenRepeatRemaining(input: ListenRepeatInput): number | null {
  if (input.mode === "ayah") {
    return Math.max(0, clampListenRepeatCount(input.ayahRepeatCount) - Math.max(1, input.ayahPlays) + 1);
  }
  if (input.mode === "range" && input.range) {
    return Math.max(0, clampListenRepeatCount(input.range.count) - Math.max(1, input.rangePlays) + 1);
  }
  return null;
}

// ── Word timings (segments / interpolated) ─────────────────────────────

export interface RecitationWordTiming {
  /** 1-based word position inside the ayah. */
  word: number;
  /** Start, in ms, relative to the start of the ayah's audio. */
  startMs: number;
  /** End, in ms, relative to the start of the ayah's audio. */
  endMs: number;
}

export interface RecitationAyahTiming {
  ayah: number;
  /** Start of this ayah inside the surah audio file (ms). */
  fromMs: number;
  /** End of this ayah inside the surah audio file (ms). */
  toMs: number;
  durationMs: number;
  words: RecitationWordTiming[];
}

export interface RecitationTiming {
  reciter: string;
  surah: number;
  /** Per-surah audio file (QuranicAudio). Streamed, never bundled. */
  audioUrl: string;
  source: string;
  ayahs: RecitationAyahTiming[];
}

export type TimingSource = "segments" | "interpolated";

/** The word (1-based) whose [startMs, endMs) contains tMs, or null
    when no word covers t (before the first word / after the last). */
export function wordIndexAtTimeMs(timings: RecitationWordTiming[], tMs: number): number | null {
  for (const w of timings) {
    if (tMs >= w.startMs && tMs < w.endMs) return w.word;
  }
  return null;
}

/** Spread an ayah's audio duration across its words in proportion
    to word length (character count). Only when real segments are
    unavailable — the UI labels the highlight as estimated. */
export function interpolateWordTimings(words: string[], durationMs: number): RecitationWordTiming[] {
  if (words.length === 0 || durationMs <= 0) return [];
  const lengths = words.map((w) => Math.max(1, [...w].length));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: RecitationWordTiming[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i += 1) {
    const span = ((lengths[i] ?? 1) / total) * durationMs;
    const startMs = i === 0 ? 0 : Math.round(cursor);
    const endMs = i === words.length - 1 ? Math.round(durationMs) : Math.round(cursor + span);
    out.push({ word: i + 1, startMs, endMs: Math.max(endMs, startMs + 1) });
    cursor += span;
  }
  return out;
}

// ── Playback position + merge rule ─────────────────────────────────────

/** Persisted listen position (local kv + server `hifz_listen_positions`).
    `progressMs` is surah-absolute in segments mode, within-ayah in
    interpolated mode — the hook stores whichever clock it has, and
    resumes inside the saved ayah either way. */
export interface ListenPosition {
  reciter: string;
  surah: number;
  ayah: number;
  progressMs: number;
  speed: number;
  repeatMode: ListenRepeatMode;
  repeatAyah: number;
  repeatRangeStart: number | null;
  repeatRangeEnd: number | null;
  repeatRangeCount: number;
  /** ms since epoch of the last local change (the LWW version clock). */
  updatedAt: number;
}

export const LISTEN_POSITION_KV_KEY = "listen:position:v1";
export const LISTEN_TIMING_KV_PREFIX = "listen:timing:v1:";

export function defaultListenPosition(reciter: string, surah: number): ListenPosition {
  return {
    reciter,
    surah,
    ayah: 1,
    progressMs: 0,
    speed: 1,
    repeatMode: "off",
    repeatAyah: 1,
    repeatRangeStart: null,
    repeatRangeEnd: null,
    repeatRangeCount: 1,
    updatedAt: Date.now(),
  };
}

/** Validate a parsed position (local kv / server payload); corrupt or
    out-of-range → null. Never throws. */
export function parseListenPosition(raw: unknown): ListenPosition | null {
  try {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.reciter !== "string" || p.reciter.length === 0 || p.reciter.length > 40) return null;
    if (typeof p.surah !== "number" || p.surah < 1 || p.surah > 114) return null;
    if (typeof p.ayah !== "number" || p.ayah < 1 || p.ayah > 286) return null;
    if (typeof p.progressMs !== "number" || p.progressMs < 0 || p.progressMs > 3 * 60 * 60 * 1000) return null;
    const speed = normalizeListenSpeed(p.speed);
    const repeatMode =
      p.repeatMode === "ayah" || p.repeatMode === "range" || p.repeatMode === "surah" ? p.repeatMode : "off";
    const repeatAyah = clampListenRepeatCount(typeof p.repeatAyah === "number" ? p.repeatAyah : 1);
    const rangeStart = typeof p.repeatRangeStart === "number" ? Math.floor(p.repeatRangeStart) : null;
    const rangeEnd = typeof p.repeatRangeEnd === "number" ? Math.floor(p.repeatRangeEnd) : null;
    if (repeatMode === "range" && (rangeStart === null || rangeEnd === null || rangeStart > rangeEnd)) return null;
    return {
      reciter: p.reciter,
      surah: Math.floor(p.surah),
      ayah: Math.floor(p.ayah),
      progressMs: Math.floor(p.progressMs),
      speed,
      repeatMode,
      repeatAyah,
      repeatRangeStart: rangeStart,
      repeatRangeEnd: rangeEnd,
      repeatRangeCount: clampListenRepeatCount(typeof p.repeatRangeCount === "number" ? p.repeatRangeCount : 1),
      updatedAt: typeof p.updatedAt === "number" && Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export type MergeOutcome =
  | { source: "local"; shouldPush: true; position: ListenPosition }
  | { source: "server"; shouldPush: false; position: ListenPosition }
  | { source: "none"; shouldPush: false; position: null };

/**
 * Merge a local position with the server's (last-write-wins by
 * updatedAt — the same rule the server enforces on PUT). The caller
 * saves the returned position locally; when `shouldPush` is true it
 * also PUTs it to the server. Server disconnect never deletes the
 * local position — this function is only called with a fetched
 * server state, and offline callers skip the merge entirely.
 */
export function mergeListenPositions(
  local: ListenPosition | null,
  server: ListenPosition | null,
): MergeOutcome {
  if (server === null && local === null) return { source: "none", shouldPush: false, position: null };
  if (server === null) return { source: "local", shouldPush: true, position: local as ListenPosition };
  if (local === null) return { source: "server", shouldPush: false, position: server };
  if (server.updatedAt > local.updatedAt) return { source: "server", shouldPush: false, position: server };
  return { source: "local", shouldPush: true, position: local };
}

/** Server wire shape → ListenPosition (snake_case → camelCase). */
export function serverPositionToLocal(body: unknown): ListenPosition | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const updatedAt =
    typeof b.updated_at === "string" ? Date.parse(b.updated_at) : typeof b.updated_at === "number" ? b.updated_at : 0;
  return parseListenPosition({
    reciter: b.reciter,
    surah: b.surah,
    ayah: b.ayah,
    progressMs: b.progress_ms,
    speed: b.speed,
    repeatMode: b.repeat_mode,
    repeatAyah: b.repeat_ayah,
    repeatRangeStart: b.repeat_range_start ?? null,
    repeatRangeEnd: b.repeat_range_end ?? null,
    repeatRangeCount: b.repeat_range_count ?? 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  });
}

/** Local position → server wire shape (PUT body). */
export function localPositionToServer(pos: ListenPosition): Record<string, unknown> {
  return {
    reciter: pos.reciter,
    surah: pos.surah,
    ayah: pos.ayah,
    progress_ms: pos.progressMs,
    speed: pos.speed,
    repeat_mode: pos.repeatMode,
    repeat_ayah: pos.repeatAyah,
    repeat_range_start: pos.repeatRangeStart,
    repeat_range_end: pos.repeatRangeEnd,
    repeat_range_count: pos.repeatRangeCount,
    updated_at: new Date(pos.updatedAt).toISOString(),
  };
}

/** Error kinds the player distinguishes (honest states, no silent fallback). */
export type ListenErrorKind = "audio" | "offline" | "timing";

/** Player status (loading/buffering are real states, not spinners without end). */
export type ListenStatus = "idle" | "loading" | "buffering" | "playing" | "paused" | "error";

/** Format ms as m:ss for the position display. */
export function formatListenClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
