/**
 * QPC V4 Tajweed glyphs for the hifz study page — per-page data loader
 * plus the per-word glyph-vs-text rule.
 *
 * Data: public/quran-mushaf-v4-tajweed.json (83,668 entries keyed
 * "surah:ayah:word"), split into per-page files by
 * scripts/split-quran-mushaf-v4-glyphs.py. A page's file holds ONLY
 * that page's words, keyed by the V4 native key — glyph codes are
 * PAGE-RELATIVE (the same codepoint is a different glyph on another
 * page), so a glyph string must only ever render in its own page's
 * QCF4NNN_COLOR family, with the map from the same page.
 *
 * THE KEY (corrected 2026-11-08 — the investigation brief's
 * `${surah}:${ayah}:${index+1}` is WRONG, proven by a global
 * id-alignment check: for all 77,433 V2 slots, the V4 entry id equals
 * the slot's QUL id exactly under this formula, 0 mismatches):
 * V4's `word` is the 1-based ordinal among the ayah's REAL words —
 * NOT the Tanzil token index. Three things do not count as V4 words:
 *   (a) standalone pause signs (ۚ ۖ ۗ ۙ ۘ ۛ ۜ) — they attach to the
 *       preceding word's glyph string (often making it 2 chars);
 *   (b) the Basmalah prefix of ayah 1 (surahs 2–114, tokens 0–3) —
 *       it is NOT in the V4 data at all, so Basmalah slots never get
 *       glyphs and stay Tanzil text (the brief's §7 Basmalah verdict
 *       is refuted: "18:1:1–4" are الْحَمْدُ لِلَّهِ الَّذِي أَنزَلَ,
 *       not the Basmalah);
 *   (c) the ayah-end marker — the LAST entry of every ayah's V4 list
 *       (key realWordCount+1) is the rosette/number glyph, never a
 *       word; no slot ever maps to it under this formula.
 * Surah 1 ayah 1 is the exception to (b): its Basmalah IS the ayah,
 * so its 4 tokens are real words (keys 1:1:1–4 + marker 1:1:5).
 * Surah 9 ayah 1 has no Basmalah prefix. The one merge in the whole
 * Quran is 37:130 (see V4_MERGED_PAIR_SLOT_KEYS below).
 *
 * The glyph strings are COLR-layered: their tajweed colours come
 * from the font's palette 0, never from CSS `color`. That is why
 * the render rule below exists — any state the page expresses with
 * ink colour (grades, newest live word, listen-now) or
 * with `color: transparent` (concealed words) must fall back to
 * Tanzil text, which the rule-based tajweed engine can colour.
 * Peeked words are the exception (user directive 2026-11-09:
 * pages and font first, like the reference shots): they keep
 * their glyph and tajweed colours, and only the faint beige tint
 * marks them as peeked (no outline — user directive
 * 2026-11-09 ~19:28).
 * `visibility: hidden` (unwritten/spacer words) hides COLR glyphs
 * fine, so hidden words may stay glyphs.
 */
import type { WallWord } from './hifz-study-types';
import {
  MUSHAF_PAUSE_SIGNS,
  MUSHAF_SAJDA_MARK,
  type V2Page,
  type V2PageGlyphs,
} from './quran-mushaf-v2';

/** Per-page V4 data: "surah:ayah:word" (word 1-based) → glyph string. */
export type V4PageGlyphs = ReadonlyMap<string, string>;

/** Public URL of one page's V4 glyph file (same-origin static file). */
export function v4PageGlyphsUrl(page: number): string {
  return `/quran-mushaf-v4-glyphs/p${page}.json`;
}

/**
 * The V4 key for one real word: `wordNo` is the 1-based ordinal
 * among the ayah's real words (see v4RealWordNumbers), NOT the
 * Tanzil token index.
 */
export function v4WordKey(surah: number, ayah: number, wordNo: number): string {
  return `${surah}:${ayah}:${wordNo}`;
}

/**
 * Token index → real-word ordinal (1-based) for one ayah, from the
 * ayah's verbatim Tanzil tokens (whitespace split). Pause signs and
 * the sajda mark attach to their word and are not words; the
 * Basmalah prefix of ayah 1 (surahs 2–114, tokens 0–3) is not in
 * the V4 data. Tokens with no entry in the returned map (pause
 * signs, Basmalah-prefix words) have no V4 glyph. Pure — unit
 * tested in quran-mushaf-v4.test.ts.
 */
export function v4RealWordNumbers(
  surah: number,
  ayah: number,
  tokens: readonly string[],
): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  let n = 0;
  tokens.forEach((tok, i) => {
    if (MUSHAF_PAUSE_SIGNS.has(tok) || tok === MUSHAF_SAJDA_MARK) return;
    if (ayah === 1 && surah !== 1 && surah !== 9 && i < 4) return;
    n += 1;
    out.set(i, n);
  });
  return out;
}

/** Slot keys ("surah:ayah:token-index", 0-based — the v2WordKey
    format) of the one word pair V4 merges into a single glyph
    entry: 37:130 tokens 2 and 3 ("إِلْ", "يَاسِينَ") share V4 entry
    37:130:3 (a 2-char string holding both halves, QUL id 61958),
    and key 37:130:4 is the ayah-end marker. Neither slot may use
    its keyed glyph — the first would draw both words, the second
    would draw a rosette as a word — so both slots stay Tanzil text
    (exactly today's rendering). Verified by the totals: V4 =
    real words + 1 marker per ayah − exactly this 1 merge. */
export const V4_MERGED_PAIR_SLOT_KEYS: ReadonlySet<string> = new Set([
  '37:130:2',
  '37:130:3',
]);

const glyphPromises = new Map<number, Promise<V4PageGlyphs | null>>();

/** One page's "surah:ayah:word" → glyph-string map, or null when the
    file is missing or unreadable (the caller then renders Tanzil
    text — the honest fallback, never a silent substitution).
    Promise-cached per page. Mirrors loadV2PageGlyphs. */
export function loadV4PageGlyphs(page: number): Promise<V4PageGlyphs | null> {
  const existing = glyphPromises.get(page);
  if (existing) return existing;
  const promise = fetch(v4PageGlyphsUrl(page))
    .then((res) => {
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, string>>;
    })
    .then((obj) => {
      if (!obj) return null;
      return new Map(Object.entries(obj)) as V4PageGlyphs;
    })
    .catch(() => null);
  glyphPromises.set(page, promise);
  return promise;
}

/** The grading states whose signal IS the ink colour: a COLR glyph
    cannot turn red/amber/gray/brown, so those words render as text.
    Peeked is NOT here (user directive 2026-11-09: pages and font
    first, like the reference shots): a peeked word keeps its glyph
    and tajweed colours, and only its faint beige tint marks it
    (no outline — user directive 2026-11-09 ~19:28). */
export const V4_TEXT_STATUSES: ReadonlySet<WallWord['status']> = new Set([
  'wrong',
  'close',
  'skipped',
]);

/**
 * The §5 rule (investigation brief): a word renders as a V4 glyph
 * if and only if it HAS a glyph and is in its plain state — not
 * concealed, not the newest live word, not graded wrong/close/
 * skipped, and not the listen-now word. Every other word
 * renders as Tanzil text via renderTajweedText. Peeked words DO
 * keep their glyph (user directive 2026-11-09 ~19:15): the faint
 * beige tint is the peek cue, not the ink (no outline — user
 * directive 2026-11-09 ~19:28).
 *
 * `status` is the wall word's status, or null for unwritten words
 * (no grade to express — hidden words may stay glyphs, and
 * listen-mode follow-along words have no status either).
 * `concealed` is true only when the word is hidden by the
 * `color: transparent` mechanism (script hidden, not revealed) —
 * COLR glyphs ignore `color`, so a concealed glyph would show.
 */
export function shouldUseV4Glyph(
  glyph: string | undefined,
  opts: {
    concealed: boolean;
    newestLive: boolean;
    status: WallWord['status'] | null;
    listenNow: boolean;
  },
): boolean {
  if (glyph === undefined) return false;
  if (opts.concealed) return false;
  if (opts.newestLive) return false;
  if (opts.listenNow) return false;
  if (opts.status !== null && V4_TEXT_STATUSES.has(opts.status)) return false;
  return true;
}

/**
 * Wave-1 Tarteel-approx palette (2026-11-09, research §2/§8.3).
 *
 * CHOICE: the visual target is the Tarteel REFERENCE SHOT, not the
 * printed palette 0. The user compares the page against the shot
 * they sent, and the user decision is "the real mushaf AND exactly
 * like Tarteel" — so where palette 0 and the shot conflict, the shot
 * governs. Palette 0's two most-used tajweed colours on p293 are
 * exactly the two the shot does NOT have: pure green #09B000
 * (ghunnah, 19 layers) and royal blue #3F48E6 (tafkhim, 37 layers —
 * the single most-used colour). The shot's ink is a teal family
 * (dominant dark teal (0,96,128), teal-green (0,128,64), light
 * cyan-teal (0,160,192)) plus purple (128,96,192) — measured by
 * fresh pixel sampling of the reference shot (this mission), agreeing
 * with the research report's §2.1 clusters.
 *
 * Only the indices that conflict with the shot are overridden;
 * everything else keeps palette 0 (base black, silent grays, gold,
 * orange, teal #2CA4AB — the shot's own teal cluster already matches
 * it — and the pale marker tints). Index 3 (dark red, madd lazim)
 * is kept: it does not occur on p293 at all, so the shot gives no
 * evidence against it. The mapping is an APPROXIMATION from a
 * compressed screenshot — the app's exact hex palette is unknown
 * (research §9.1) — not the app's real values. Darkened one step
 * where the sampled tone would be too light on white (idx 6/8).
 *
 * Wave 2 (2026-11-09) — the ayah-end MARKER indices 10/11/12:
 * the reference shot's markers are a single dark tone (thin black
 * rosette, white interior, black number — sampled: dominant ink
 * (0,0,0) with gray anti-aliasing), while palette 0 paints the
 * marker glyph pink #FF0080 (idx 11, the rosette ring) + teal
 * #2CA4AB (idx 10, the top knob) + pale green #D8E9D8 (idx 12,
 * the disc fill). So 10/11 go to #000000 (the shot's black ink)
 * and 12 to the page background #F9F7F8 (the disc disappears into
 * the page, leaving the dark ring + black number like the shot).
 * This is SAFE for words: a fontTools scan of all 604 pages
 * proves no word glyph anywhere in the Quran uses indices 10/11/
 * 12 (0 uses; ayahs never span pages, so the scan is airtight) —
 * the override touches markers only. Index 13 (the marker number,
 * already #000000) is NOT overridden: 4 word glyphs in the Quran
 * (2:119:5, 2:205:10, 9:17:11, 98:1:4) use it. Index 11's Wave-1
 * value (#8060C0 purple, "madd") is replaced: the same scan proves
 * 11 is marker-only, so the purple never coloured a word — it only
 * ever purpled the markers, which the shot shows black.
 */
export const V4_TARTEEL_PALETTE_NAME = '--quran-v4-tarteel';

/** Palette index → override hex (only the changed indices). */
export const V4_TARTEEL_PALETTE_OVERRIDES: Readonly<Record<number, string>> = {
  6: '#008060', // ghunnah green -> shot teal-green (0,128,64)
  7: '#006080', // tafkhim dark blue -> shot dominant dark teal (0,96,128)
  8: '#0090C0', // qalqalah light blue -> shot light cyan-teal (0,160,192)
  9: '#C04090', // red -> shot purple-pink (no pure red in the shot)
  10: '#000000', // marker knob (teal in palette 0) -> shot black marker ink
  11: '#000000', // marker ring (pink in palette 0; Wave 1's purple) -> shot black
  12: '#F9F7F8', // marker disc fill (pale green) -> page bg, white interior like the shot
};

/**
 * The `@font-palette-values` rule for one page's V4 family, selecting
 * base palette 0 with the overrides above. One rule per family is
 * needed because the family name is per-page (QCF4NNN_COLOR); the
 * font loader injects the rule next to the FontFace. Pure — unit
 * tested in quran-mushaf-v4-tarteel.test.ts.
 */
export function v4TarteelPaletteRule(family: string): string {
  const overrides = Object.entries(V4_TARTEEL_PALETTE_OVERRIDES)
    .map(([index, hex]) => `${index} ${hex}`)
    .join(', ');
  return (
    `@font-palette-values ${V4_TARTEEL_PALETTE_NAME} { ` +
    `font-family: ${family}; base-palette: 0; override-colors: ${overrides}; }`
  );
}

// ─── Step 2 (Tarteel parity): the QPC V4 (1441) READER pages ───
// The study module above uses V4 glyphs on V2 layout lines. The
// reader's 1441 mushaf instead uses the print's OWN layout: the
// pages in public/quran-mushaf-v4-pages/ are generated from the
// QUL qpc_v4_layout dataset (scripts/generate-quran-mushaf-v4.py)
// in the exact V2Page shape, and the glyph maps in
// public/quran-mushaf-v4qpc-glyphs/ are this file's study maps
// re-keyed by QUL id — the keying expandV2Page consumes. The
// generator fail-hard-validates the whole corpus (segment token
// accounting, glyph coverage of all 83,668 ids, and the token
// index formula against all 17,110 segment starts of the repo's
// V2 pages); the pages then still pass through the same strict,
// fail-closed expansion at runtime.

const v4LayoutPromises = new Map<number, Promise<V2Page | null>>();
const v4QpcGlyphPromises = new Map<number, Promise<V2PageGlyphs | null>>();
let v4LayoutFullPromise: Promise<V2Page[] | null> | null = null;

function loadV4LayoutFull(): Promise<V2Page[] | null> {
  if (!v4LayoutFullPromise) {
    v4LayoutFullPromise = fetch('/quran-mushaf-v4.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { pages?: V2Page[] } | null) =>
        data && Array.isArray(data.pages) ? data.pages : null,
      )
      .catch(() => null);
  }
  return v4LayoutFullPromise;
}

/** One QPC V4 layout page (per-page chunk, full-file fallback),
    or null when unavailable — the caller falls back to the
    standard renderers, never to a fabricated page. */
export function loadV4LayoutPage(page: number): Promise<V2Page | null> {
  if (!Number.isInteger(page) || page < 1 || page > 604) {
    return Promise.resolve(null);
  }
  let p = v4LayoutPromises.get(page);
  if (!p) {
    p = fetch(`/quran-mushaf-v4-pages/p${page}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<V2Page>) : null))
      .catch(() => null)
      .then((pg) => {
        if (pg && pg.n === page && Array.isArray(pg.lines)) return pg;
        return loadV4LayoutFull().then(
          (pages) => pages?.find((x) => x.n === page) ?? null,
        );
      });
    v4LayoutPromises.set(page, p);
  }
  return p;
}

/** One page's V4 glyph map keyed by QUL id (the expansion's
    keying), or null when the file is missing — the expansion then
    renders the whole page in Tanzil text, its honest fallback. */
export function loadV4QpcPageGlyphs(
  page: number,
): Promise<V2PageGlyphs | null> {
  if (!Number.isInteger(page) || page < 1 || page > 604) {
    return Promise.resolve(null);
  }
  let p = v4QpcGlyphPromises.get(page);
  if (!p) {
    p = fetch(`/quran-mushaf-v4qpc-glyphs/p${page}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((obj: Record<string, string> | null) => {
        if (!obj) return null;
        const map = new Map<number, string>();
        for (const [k, v] of Object.entries(obj)) map.set(Number(k), v);
        return map as V2PageGlyphs;
      })
      .catch(() => null);
    v4QpcGlyphPromises.set(page, p);
  }
  return p;
}
