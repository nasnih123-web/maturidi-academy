/**
 * Phase 5 (hifz redesign) — pure player helpers for the listen /
 * follow mode of the study page.
 *
 * Sources (no invention):
 * - Speeds: the Tarteel Listening settings in the Phase 2 video
 *   spec (§11.2, `bayan_150s`): six buttons 0.5×, 0.75×, 1×, 1.25×,
 *   1.5×, 1.75×, with 1× selected. 2× is NOT in that list, so it is
 *   not a valid listen speed here (the old hook allowed it).
 * - Repeat counts come from the Phase 4 practice inputs (repeat per
 *   ayah / repeat per range, 1–20); the listen repeat *mode* (off /
 *   ayah / range / surah) picks which count applies. The range bounds
 *   come from the same Phase 4 range inputs — no duplicate UI.
 * - The listen-mode page itself was NOT observed in the videos
 *   (spec §14.11): only its settings were. Nothing here claims to
 *   be the observed Tarteel listen page; the player surface is the
 *   academy's existing glass mini player (reader visual language).
 */

/** The six Tarteel Listening speeds (spec §11.2). */
export const LISTEN_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75] as const;

/** Long-press threshold for the green-button mode switch (spec §6:
    "hold down the green button"; the gesture itself was never
    performed in the videos, only the banner text was seen, so the
    duration is the academy's own choice, not an observed value). */
export const HIFZ_LISTEN_LONG_PRESS_MS = 600;

/** Valid listen speed, or 1 when the value is not one of the six. */
export function normalizeListenSpeed(rate: unknown): number {
  if (typeof rate === 'number' && (LISTEN_SPEEDS as readonly number[]).includes(rate)) {
    return rate;
  }
  return 1;
}

/** Next speed in the Tarteel cycle (wraps 1.75× → 0.5×). */
export function nextListenSpeed(current: number): number {
  const idx = LISTEN_SPEEDS.indexOf(normalizeListenSpeed(current) as (typeof LISTEN_SPEEDS)[number]);
  return LISTEN_SPEEDS[(idx + 1) % LISTEN_SPEEDS.length];
}

/** Clamp a repeat count to the server's accepted range (1–20). */
export function clampListenRepeatCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

export type ListenRepeatMode = 'off' | 'ayah' | 'range' | 'surah';

/** Cycle the repeat mode (mini-player badge): off → ayah → range → surah. */
export function nextListenRepeatMode(mode: ListenRepeatMode): ListenRepeatMode {
  const order: ListenRepeatMode[] = ['off', 'ayah', 'range', 'surah'];
  return order[(order.indexOf(mode) + 1) % order.length];
}

export interface ListenRepeatRange {
  start: number;
  end: number;
  /** Total passes over the range (1 = play once, no repeat). */
  count: number;
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
  | { action: 'replay'; ayah: number; ayahPlays: number; rangePlays: number }
  | { action: 'goto'; ayah: number; ayahPlays: number; rangePlays: number }
  | { action: 'stop'; ayahPlays: number; rangePlays: number };

/**
 * What happens when an ayah finishes playing, given the repeat
 * mode and counts. Pure (unit-tested); the hook only applies the
 * outcome. `stop` means the surah (or the range's tail) is finished:
 * playback ends, it does not loop forever.
 *
 * - off: play straight through, once.
 * - ayah: replay the same ayah `ayahRepeatCount` times, then move on.
 * - range: play the range `range.count` times (each ayah
 *   `ayahRepeatCount` times per pass), then continue after the range
 *   (or stop at the surah end).
 * - surah: play the whole surah, then restart it (the pre-existing
 *   infinite surah loop; the count inputs do not bound it).
 */
export function listenRepeatNext(input: ListenRepeatInput): ListenRepeatOutcome {
  const ayahCount = Math.max(1, Math.floor(input.ayahCount));
  const current = Math.min(Math.max(1, Math.floor(input.currentAyah)), ayahCount);
  const ayahRepeat = clampListenRepeatCount(input.ayahRepeatCount);
  const ayahPlays = Math.max(1, Math.floor(input.ayahPlays));
  const rangePlays = Math.max(1, Math.floor(input.rangePlays));
  const replay = { action: 'replay', ayah: current, ayahPlays: ayahPlays + 1, rangePlays } as const;
  const goto = (ayah: number, nextRangePlays = rangePlays) =>
    ({ action: 'goto', ayah, ayahPlays: 1, rangePlays: nextRangePlays }) as const;
  const stop = { action: 'stop', ayahPlays, rangePlays } as const;

  // An ayah that still has replays left replays first, in every mode
  // except off (off ignores the counts entirely).
  if (input.mode !== 'off' && ayahPlays < ayahRepeat) return replay;

  switch (input.mode) {
    case 'off':
    case 'ayah':
      if (current < ayahCount) return goto(current + 1);
      return stop;
    case 'surah':
      if (current < ayahCount) return goto(current + 1);
      return goto(1);
    case 'range': {
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
    range (range mode); null when the mode has no finite remainder
    (off / infinite surah loop). */
export function listenRepeatRemaining(input: ListenRepeatInput): number | null {
  if (input.mode === 'ayah') {
    return Math.max(0, clampListenRepeatCount(input.ayahRepeatCount) - Math.max(1, input.ayahPlays) + 1);
  }
  if (input.mode === 'range' && input.range) {
    return Math.max(0, clampListenRepeatCount(input.range.count) - Math.max(1, input.rangePlays) + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Playback position + speed persistence (localStorage, per user/surah).
//
// Server-side listen position would need a dedicated endpoint: the
// Phase 4 position endpoint belongs to a practice *attempt*, and
// conflating "listened to ayah N" with "practising from ayah N"
// would corrupt the practice resume banner. So listen position lives
// in localStorage (this browser, this user) and is flagged as such in
// the Phase 5 notes. Speed is likewise per-browser.
// ---------------------------------------------------------------------------

export interface ListenPosition {
  surah: number;
  reciter: string;
  ayah: number;
  /** Surah-absolute ms in segments mode; within-ayah ms in
      interpolated mode (the hook stores whichever clock it has). */
  progressMs: number;
  savedAt: number;
}

export const LISTEN_POSITION_STORAGE_KEY = 'maturidi-hifz-listen-position-v1';
export const LISTEN_SPEED_STORAGE_KEY = 'maturidi-hifz-listen-speed-v1';

export type ListenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveListenPosition(storage: ListenStorage | null, pos: ListenPosition): void {
  if (!storage) return;
  try {
    storage.setItem(LISTEN_POSITION_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* storage unavailable — position is best-effort */
  }
}

export function clearListenPosition(storage: ListenStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(LISTEN_POSITION_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The saved position for this reciter+surah, or null (none, corrupt,
    or the ayah is outside this surah). */
export function loadListenPosition(
  storage: ListenStorage | null,
  reciter: string,
  surah: number,
  ayahCount: number,
): ListenPosition | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LISTEN_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.reciter !== reciter || p.surah !== surah) return null;
    if (typeof p.ayah !== 'number' || p.ayah < 1 || p.ayah > Math.max(1, ayahCount)) return null;
    if (typeof p.progressMs !== 'number' || p.progressMs < 0) return null;
    return {
      surah,
      reciter,
      ayah: Math.floor(p.ayah),
      progressMs: Math.floor(p.progressMs),
      savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Parse a stored speed (localStorage); corrupt / out-of-range → 1. */
export function parseStoredListenSpeed(raw: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  return normalizeListenSpeed(Number.isFinite(n) ? n : NaN);
}

export function saveListenSpeed(storage: ListenStorage | null, rate: number): void {
  if (!storage) return;
  try {
    storage.setItem(LISTEN_SPEED_STORAGE_KEY, String(normalizeListenSpeed(rate)));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Reciter photos for the mini player.
//
// Listen reciters are Quran.com v4 ids (alafasy, husary, …); the
// provider photos the reader shows are keyed by AlQuran Cloud
// edition ids (ar.alafasy, ar.husary, …). This is only the id
// mapping — the URLs themselves come from the CRM providers payload
// passed in as `photosByEditionId`, never copied here. A listen
// reciter with no edition in the 38-reciter registry (tablawi) has
// no photo and renders the ♪ fallback, exactly like the reader.
// ---------------------------------------------------------------------------

export const LISTEN_ID_TO_EDITION_ID: Record<string, string> = {
  alafasy: 'ar.alafasy',
  abdul_basit: 'ar.abdulbasitmurattal',
  abdul_basit_mujawwad: 'ar.abdulbasitmurattal',
  husary: 'ar.husary',
  husary_muallim: 'ar.husary',
  minshawi: 'ar.minshawi',
  minshawi_mujawwad: 'ar.minshawimujawwad',
  sudais: 'ar.abdurrahmaansudais',
  shatri: 'ar.shaatree',
  hani_rifai: 'ar.hanirifai',
  shuraym: 'ar.saoodshuraym',
};

export function listenReciterPhotoUrl(
  listenId: string,
  photosByEditionId: Record<string, string | null | undefined>,
): string | null {
  const editionId = LISTEN_ID_TO_EDITION_ID[listenId];
  if (!editionId) return null;
  return photosByEditionId[editionId] ?? null;
}

/** Error kinds the player distinguishes (honest states, no silent fallback).
    A timing-fetch failure alone is never an error state: the
    interpolated fallback plays and the UI says the highlight is
    estimated — so only audio failure and offline remain here. */
export type ListenErrorKind = 'audio' | 'offline';

/** Player status (loading/buffering are real states, not spinners without end). */
export type ListenStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';
