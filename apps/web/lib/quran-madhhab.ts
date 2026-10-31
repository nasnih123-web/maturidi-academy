/**
 * Quran display madhhab logic — pure functions, no components.
 *
 * The madhhab selector changes DISPLAY only: ayah boundaries/numbers for
 * Surah al-Fatiha, sajda markers, and the fawasil counting school. The
 * Arabic text itself is never altered, and playback always uses standard
 * mushaf numbering (see the audio mapping in QuranReader).
 *
 * Fatiha (standard mushaf numbering, 7 ayahs):
 * - Shafi'i mode: Bismillah = ayah 1, ayah 7 = the combined last part.
 *   Rendering is identical to the standard numbering.
 * - Hanafi / Hanbali / Maliki mode: Bismillah is unnumbered (rendered as
 *   the surah header, like other surahs), display 1-5 = standard 2-6,
 *   display 6 = the first four words of standard 7 (صراط الذین انعمت
 *   علیهم), display 7 = the remainder of standard 7 (غیر المغضوب علیهم
 *   ولا الضالین). Total stays 7. Translation/tafsir of standard 7 is
 *   shown ONCE, on display 6; display 7 carries none (combined display).
 * - Audio: both pair cards map to standard 1:7 audio (whole-ayah playback
 *   with combined highlight). Word-range splitting would need real
 *   word-timing data; no timings are fabricated here.
 *
 * Sajda positions use standard mushaf numbering. The agreed 10 are common
 * to all four madhhabs; the disputed 5 are 22:77, 38:24, 53:62, 84:21,
 * 96:19. Hanafi 14 = agreed + 38:24 + the 3 Mufassal (excluding 22:77);
 * Shafi'i 14 = agreed + 22:77 + the 3 Mufassal (excluding 38:24); Maliki
 * 11 = agreed + 38:24; Hanbali 15 = all. Ruling: Hanafi wajib, the other
 * three sunnah mu'akkadah. Numbering note: the An-Nahl sajda is 16:49 in
 * standard numbering (a 16:50 variant count exists in some references).
 */
import type { Ayah } from './quran';

export const MADHHABS = ['hanafi', 'shafii', 'maliki', 'hanbali'] as const;
export type MadhhabId = (typeof MADHHABS)[number];

/** Unknown / legacy values fall back to the CRM default (Hanafi). */
export function parseMadhhabId(v: unknown): MadhhabId {
  return typeof v === 'string' && (MADHHABS as readonly string[]).includes(v)
    ? (v as MadhhabId)
    : 'hanafi';
}

/* ------------------------------------------------------------------ */
/* Sajda                                                               */
/* ------------------------------------------------------------------ */

export interface SajdaRef {
  surah: number;
  ayah: number;
}

const AGREED_SAJDAS: SajdaRef[] = [
  { surah: 7, ayah: 206 },
  { surah: 13, ayah: 15 },
  { surah: 16, ayah: 49 },
  { surah: 17, ayah: 107 },
  { surah: 19, ayah: 58 },
  { surah: 22, ayah: 18 },
  { surah: 25, ayah: 60 },
  { surah: 27, ayah: 25 },
  { surah: 32, ayah: 15 },
  { surah: 41, ayah: 37 },
];

/** The three Mufassal sajdas: 53:62, 84:21, 96:19. */
const MUFASSAL_SAJDAS: SajdaRef[] = [
  { surah: 53, ayah: 62 },
  { surah: 84, ayah: 21 },
  { surah: 96, ayah: 19 },
];

/** Disputed sajdas beyond the agreed 10 and the Mufassal 3. */
const DISPUTED_EXTRA: Record<MadhhabId, SajdaRef[]> = {
  hanafi: [{ surah: 38, ayah: 24 }],
  shafii: [{ surah: 22, ayah: 77 }],
  maliki: [{ surah: 38, ayah: 24 }],
  hanbali: [
    { surah: 38, ayah: 24 },
    { surah: 22, ayah: 77 },
  ],
};

const HAS_MUFASSAL: Record<MadhhabId, boolean> = {
  hanafi: true,
  shafii: true,
  maliki: false,
  hanbali: true,
};

export function sajdaPositions(madhhab: MadhhabId): SajdaRef[] {
  const out = [...AGREED_SAJDAS, ...DISPUTED_EXTRA[madhhab]];
  if (HAS_MUFASSAL[madhhab]) out.push(...MUFASSAL_SAJDAS);
  return out;
}

export function isSajda(surah: number, ayah: number, madhhab: MadhhabId): boolean {
  return sajdaPositions(madhhab).some((s) => s.surah === surah && s.ayah === ayah);
}

export type SajdaRuling = 'wajib' | 'sunnah_muakkadah';

export function sajdaRuling(madhhab: MadhhabId): SajdaRuling {
  return madhhab === 'hanafi' ? 'wajib' : 'sunnah_muakkadah';
}

/* ------------------------------------------------------------------ */
/* Fatiha display mapping                                              */
/* ------------------------------------------------------------------ */

export interface DisplayAyah {
  /** Ayah object to render (a copy for the split pair, original otherwise). */
  ayah: Ayah;
  /** Number shown in the badge and used for the card id (ayah-{displayNumber}). */
  displayNumber: number;
  /** Standard mushaf number — stable across madhhabs; used for links/notes. */
  standardNumber: number;
  /** 0-based index into the original ayahs array — used for playback. */
  standardIndex: number;
  /** True for the second card of the Fatiha 6+7 pair. */
  isPairSecond: boolean;
}

export interface DisplayResult {
  ayahs: DisplayAyah[];
  /**
   * True when Bismillah must render as an unnumbered header (split mode).
   * False in standard mode, where Bismillah is ayah card 1.
   */
  bismillahAsHeader: boolean;
}

/** Words of standard 1:7 that form display 6 (صراط الذین انعمت علیهم). */
const FATIHA_SPLIT_WORDS = 4;

function standardMapping(ayahs: Ayah[]): DisplayAyah[] {
  return ayahs.map((ayah, i) => ({
    ayah,
    displayNumber: ayah.number,
    standardNumber: ayah.number,
    standardIndex: i,
    isPairSecond: false,
  }));
}

export function toDisplayAyahs(
  surahNumber: number,
  ayahs: Ayah[],
  madhhab: MadhhabId,
): DisplayResult {
  if (surahNumber !== 1) {
    return { ayahs: standardMapping(ayahs), bismillahAsHeader: false };
  }
  // Shafi'i mode: standard rendering unchanged (Bismillah = ayah 1).
  if (madhhab === 'shafii') {
    return { ayahs: standardMapping(ayahs), bismillahAsHeader: false };
  }
  // Hanafi / Hanbali / Maliki mode: split rendering. Degenerate provider
  // text (standard 7 too short to split) falls back to the standard
  // mapping rather than fabricating a boundary — the header flag follows
  // the mapping actually produced, so Bismillah is never rendered twice.
  const byStandard = new Map(ayahs.map((a, i) => [a.number, { ayah: a, index: i }]));
  const seven = byStandard.get(7);
  const words = seven ? seven.ayah.text.split(/\s+/).filter(Boolean) : [];
  if (!seven || words.length <= FATIHA_SPLIT_WORDS) {
    return { ayahs: standardMapping(ayahs), bismillahAsHeader: false };
  }
  const out: DisplayAyah[] = [];
  for (let s = 2; s <= 6; s++) {
    const hit = byStandard.get(s);
    if (hit) {
      out.push({
        // AyahCard renders ayah.number for badge + card id, so the copy
        // carries the DISPLAY number; the standard number lives on the
        // DisplayAyah itself (links, notes, playback use it explicitly).
        ayah: { ...hit.ayah, number: s - 1 },
        displayNumber: s - 1,
        standardNumber: s,
        standardIndex: hit.index,
        isPairSecond: false,
      });
    }
  }
  out.push({
    ayah: { ...seven.ayah, number: 6, text: words.slice(0, FATIHA_SPLIT_WORDS).join(' ') },
    displayNumber: 6,
    standardNumber: 7,
    standardIndex: seven.index,
    isPairSecond: false,
  });
  out.push({
    // Combined display: translation/tafsir of standard 7 shown once, on
    // display 6 — the second card carries none.
    ayah: {
      ...seven.ayah,
      number: 7,
      text: words.slice(FATIHA_SPLIT_WORDS).join(' '),
      translation: null,
      tafsir: null,
    },
    displayNumber: 7,
    standardNumber: 7,
    standardIndex: seven.index,
    isPairSecond: true,
  });
  return { ayahs: out, bismillahAsHeader: true };
}

/**
 * Map the playback hook's standard-ayah word index (1-based, -1 = n/a)
 * onto a display card's word space. For the Fatiha pair, words 1-4 belong
 * to display 6 and the rest to display 7 — this uses real provider
 * timings only; with no timings the hook reports -1 and nothing is
 * highlighted at word level.
 */
export function wordIndexForCard(d: DisplayAyah, standardWordIndex: number): number {
  if (standardWordIndex < 1) return -1;
  if (d.isPairSecond) {
    return standardWordIndex > FATIHA_SPLIT_WORDS
      ? standardWordIndex - FATIHA_SPLIT_WORDS
      : -1;
  }
  if (d.standardNumber === 7 && d.displayNumber === 6) {
    return standardWordIndex <= FATIHA_SPLIT_WORDS ? standardWordIndex : -1;
  }
  return standardWordIndex;
}
