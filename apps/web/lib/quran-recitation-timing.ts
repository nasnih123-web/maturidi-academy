/**
 * quran-recitation-timing: word-level recitation timings for the
 * hifz listen/follow mode.
 *
 * Two sources, both honest about which one is in use:
 * - REAL segments: GET /api/v1/quran/recitation/timing?reciter=&surah=
 *   (backend fetches Quran.com API v4, normalizes to ayah-relative
 *   word segments in ms). The audio is the per-surah file whose URL
 *   comes with the timings, so audio and timings stay in sync.
 * - INTERPOLATED (fallback): when the API has no timings for that
 *   reciter/surah (404/503), the ayah's audio duration is spread
 *   across its words in proportion to word length. The UI says so
 *   (label: estimated), so an interpolated highlight is never
 *   presented as a real segment.
 *
 * Segment shape (ms, ayah-relative): { word, startMs, endMs }.
 * The current word at time t is the segment whose [startMs, endMs)
 * contains t; before the first segment and after the last, no word
 * is highlighted (like the QUL Segment builder).
 */
import { apiBaseUrl } from '@/lib/api-base';

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

export type TimingSource = 'segments' | 'interpolated';

/** Fetch real word timings for one reciter + surah. Null on any
    failure (404/503/network) — the caller falls back to
    interpolation and says so. The API speaks snake_case; the wire
    shape is mapped to the camelCase RecitationTiming here. */
export async function fetchRecitationTiming(
  reciter: string,
  surah: number,
): Promise<RecitationTiming | null> {
  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/quran/recitation/timing?reciter=${encodeURIComponent(reciter)}&surah=${surah}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      reciter?: unknown;
      surah?: unknown;
      audio_url?: unknown;
      source?: unknown;
      ayahs?: unknown;
    };
    if (!body || !Array.isArray(body.ayahs) || body.ayahs.length === 0) return null;
    if (typeof body.audio_url !== 'string' || !body.audio_url) return null;
    const ayahs: RecitationAyahTiming[] = [];
    for (const a of body.ayahs as Record<string, unknown>[]) {
      if (typeof a !== 'object' || a === null) continue;
      const ayah = a.ayah;
      const fromMs = a.from_ms;
      const toMs = a.to_ms;
      if (typeof ayah !== 'number' || typeof fromMs !== 'number' || typeof toMs !== 'number') continue;
      if (toMs <= fromMs) continue;
      const words: RecitationWordTiming[] = [];
      if (Array.isArray(a.words)) {
        for (const w of a.words as Record<string, unknown>[]) {
          if (typeof w !== 'object' || w === null) continue;
          const word = w.word;
          const startMs = w.start_ms;
          const endMs = w.end_ms;
          if (typeof word !== 'number' || typeof startMs !== 'number' || typeof endMs !== 'number') continue;
          if (endMs <= startMs) continue;
          words.push({ word, startMs, endMs });
        }
      }
      words.sort((x, y) => x.startMs - y.startMs);
      ayahs.push({ ayah, fromMs, toMs, durationMs: toMs - fromMs, words });
    }
    if (ayahs.length === 0) return null;
    ayahs.sort((x, y) => x.ayah - y.ayah);
    return {
      reciter: typeof body.reciter === 'string' ? body.reciter : reciter,
      surah: typeof body.surah === 'number' ? body.surah : surah,
      audioUrl: body.audio_url,
      source: typeof body.source === 'string' ? body.source : 'quran_com_v4',
      ayahs,
    };
  } catch {
    return null;
  }
}

/** Spread an ayah's audio duration across its words in proportion
    to word length (character count). The first word starts at 0 and
    the last ends at durationMs; gaps are zero. Used only when real
    segments are unavailable. */
export function interpolateWordTimings(
  words: string[],
  durationMs: number,
): RecitationWordTiming[] {
  if (words.length === 0 || durationMs <= 0) return [];
  const lengths = words.map((w) => Math.max(1, [...w].length));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: RecitationWordTiming[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i += 1) {
    const span = (lengths[i] / total) * durationMs;
    const startMs = i === 0 ? 0 : Math.round(cursor);
    const endMs = i === words.length - 1 ? Math.round(durationMs) : Math.round(cursor + span);
    out.push({ word: i + 1, startMs, endMs: Math.max(endMs, startMs + 1) });
    cursor += span;
  }
  return out;
}

/** The word (1-based) whose [startMs, endMs) contains tMs, or null
    when no word covers t (before the first word / after the last). */
export function wordIndexAtTimeMs(
  timings: RecitationWordTiming[],
  tMs: number,
): number | null {
  for (const w of timings) {
    if (tMs >= w.startMs && tMs < w.endMs) return w.word;
  }
  return null;
}
