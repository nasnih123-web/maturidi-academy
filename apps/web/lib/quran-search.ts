/**
 * Quran search — pure matching helpers + lazily-loaded ayah index.
 *
 * The ayah index (lib/quran-search-index.json, 6236 rows) is generated
 * from the SAME quran-uthmani text the reader displays (see
 * scripts/generate-quran-data.mjs). It is loaded ONLY on the first
 * search, never on page load, via a dynamic import.
 *
 * Matching rule (user-locked): a few words, typed in Persian OR Arabic,
 * must find the ayah. Both the query and the indexed text are normalized
 * the same way: Persian yeh/kaf mapped to Arabic, alif wasla mapped to
 * plain alef, Arabic diacritics and tatweel stripped. The normalization
 * is built from code points (ASCII-only source) so no invisible
 * character can ever be mangled — it MUST stay identical to the
 * generator's normalize().
 *
 * Round 4 gap fix (verified 2026-11-01): the old normalization did NOT
 * unify teh-marbuta (ة U+0629) with heh (ه) or the alif variants
 * (أ U+0623 / إ U+0625 / آ U+0622) with plain alef — so a Persian
 * keyboard query like «بقره» missed the Arabic surah name «البقرة»,
 * and «ابراهیم» missed ayah text containing «إبراهيم». A second,
 * deeper gap was found the same way: the Uthmani text itself spells
 * words with miniature/annotation letters — «ابرهۦم» (small yeh
 * U+06E6, no plain ي) for Ibrahim, «يؤمنون» (yeh-with-hamza U+0626)
 * where a Persian keyboard types «يومنون» — and leaves Quranic
 * annotation marks (U+06D6–U+06ED, maddah/hamza-above U+0653/U+0654)
 * inside words, so plain queries missed those words entirely.
 * All of these are now unified on BOTH sides (query + index): small
 * waw/yeh map to و/ي, ئ/ؤ map to ي/و, alef maksura ى maps to ي, the
 * annotation marks are stripped, and the committed index was
 * regenerated with the same function, so the two sides can never
 * drift apart again. The mappings only collapse variants — a query
 * that matched before still matches (both sides map identically).
 *
 * Two rasm phenomena need more than character mapping:
 * - Waw-alif words (صلوة، زكوة، حيوة، مشكوة، منوة، نجوة — written
 *   with و where the standard spelling has ا): whole-substring
 *   replacements on both sides (الصلوه→الصلاه, الزكوه→الزكاه,
 *   الحيوه→الحياه, مشكوه→مشكاه, منوه→مناه, النجوه→النجاه). They
 *   apply identically to query and index, so they can only merge
 *   equivalence classes, never break an existing match.
 * - The dagger alif U+0670 is MAPPED to a regular alef, not
 *   stripped. Stripping made العالمين→العلمين and
 *   الصالحات→الصلحت, which collide with unrelated words (علم
 *   inside العلمين, صلح inside الصلحت). With the alif
 *   materialized, the matcher can tell a verbatim word from a
 *   skipped-alif lookalike (see searchAyahs): plural suffixes are
 *   allowed only on verbatim matches, so «مومن» finds
 *   «المومنون» while «علم» never returns «العالمين». Words
 *   whose standard spelling OMITS the dagger alif (الرحمن، ذلك،
 *   لكن، اله) are handled by the skip-alif matcher, which lets
 *   the text carry an alif the needle lacks — but only when the
 *   rest of the word then matches exactly.
 */
import type { SurahSummary } from './quran';

const PERSIAN_YEH = String.fromCharCode(0x06cc);
const ARABIC_YEH = String.fromCharCode(0x064a);
const PERSIAN_KAF = String.fromCharCode(0x06a9);
const ARABIC_KAF = String.fromCharCode(0x0643);
const ALIF_WASLA = String.fromCharCode(0x0671);
const ALEF = String.fromCharCode(0x0627);
const TEH_MARBUTA = String.fromCharCode(0x0629);
const HEH = String.fromCharCode(0x0647);
const ALIF_HAMZA_ABOVE = String.fromCharCode(0x0623);
const ALIF_HAMZA_BELOW = String.fromCharCode(0x0625);
const ALIF_MADDA = String.fromCharCode(0x0622);
const YEH_HAMZA = String.fromCharCode(0x0626);
const WAW_HAMZA = String.fromCharCode(0x0624);
const WAW = String.fromCharCode(0x0648);
const SMALL_WAW = String.fromCharCode(0x06e5);
const SMALL_YEH = String.fromCharCode(0x06e6);
const ALEF_MAKSURA = String.fromCharCode(0x0649);
const DAGGER_ALIF = String.fromCharCode(0x0670);
/** Waw-alif rasm words → standard spelling (both sides, see above).
 * Each word has two source forms: with the dagger alif materialized
 * (الصلواه — the form the mapped index actually contains, since
 * Uthmani writes الصلوٰة) and without it (الصلوه, kept for safety),
 * plus the bare form without ال (صلواه — «صلاة الفجر» has no ال
 * on صلاة itself). Substring replacement covers the ال-form via
 * the bare form too, so both are listed. */
const RASM_WAW_WORDS: [string, string][] = [
  ['الصلواه', 'الصلاه'],
  ['الزكواه', 'الزكاه'],
  ['الحيواه', 'الحياه'],
  ['مشكواه', 'مشكاه'],
  ['منواه', 'مناه'],
  ['النجواه', 'النجاه'],
  ['الصلوه', 'الصلاه'],
  ['الزكوه', 'الزكاه'],
  ['الحيوه', 'الحياه'],
  ['مشكوه', 'مشكاه'],
  ['منوه', 'مناه'],
  ['النجوه', 'النجاه'],
  ['صلواه', 'صلاه'],
  ['زكواه', 'زكاه'],
  ['حيواه', 'حياه'],
  ['مشكواه', 'مشكاه'],
  ['منواه', 'مناه'],
  ['نجواه', 'نجاه'],
  ['صلوه', 'صلاه'],
  ['زكوه', 'زكاه'],
  ['حيوه', 'حياه'],
  ['مشكوه', 'مشكاه'],
  ['منوه', 'مناه'],
  ['نجوه', 'نجاه'],
];
const DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x064b)}-${String.fromCharCode(0x0652)}${String.fromCharCode(0x0640)}]`,
  'g',
);
/** Quranic annotation marks: maddah/hamza-above + the U+06D6–U+06ED
 * block (small-high ligatures, stops, sajda, rub-el-hizb) except the
 * two miniature letters, which map to full letters instead. */
const ANNOTATIONS = new RegExp(
  `[${String.fromCharCode(0x0653)}${String.fromCharCode(0x0654)}${String.fromCharCode(0x06d6)}-${String.fromCharCode(0x06e4)}${String.fromCharCode(0x06e7)}-${String.fromCharCode(0x06ed)}]`,
  'g',
);

/** Rasm waw-alif unification (both sides — see the header comment). */
function unifyRasmWords(normalized: string): string {
  let out = normalized;
  for (const [from, to] of RASM_WAW_WORDS) {
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * Normalize Arabic-script text for search matching (both query and
 * index). Ends with the waw-alif unification, so the generator's
 * normalize() must apply the same step (it does — same list).
 */
export function normalizeQuranText(text: string): string {
  const chars = text
    .split(PERSIAN_YEH)
    .join(ARABIC_YEH)
    .split(PERSIAN_KAF)
    .join(ARABIC_KAF)
    .split(ALIF_WASLA)
    .join(ALEF)
    .split(ALIF_HAMZA_ABOVE)
    .join(ALEF)
    .split(ALIF_HAMZA_BELOW)
    .join(ALEF)
    .split(ALIF_MADDA)
    .join(ALEF)
    .split(TEH_MARBUTA)
    .join(HEH)
    .split(YEH_HAMZA)
    .join(ARABIC_YEH)
    .split(WAW_HAMZA)
    .join(WAW)
    .split(SMALL_WAW)
    .join(WAW)
    .split(SMALL_YEH)
    .join(ARABIC_YEH)
    .split(ALEF_MAKSURA)
    .join(ARABIC_YEH)
    .split(DAGGER_ALIF)
    .join(ALEF)
    .replace(DIACRITICS, '')
    .replace(ANNOTATIONS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return unifyRasmWords(chars);
}

/** Query words after normalization (empty list = no searchable words). */
export function normalizeQueryWords(query: string): string[] {
  return normalizeQuranText(query)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/** Persian/Arabic-Indic digits -> ASCII digits (code-point ranges only). */
export function toLatinDigits(text: string): string {
  return [...text]
    .map((d) => {
      const code = d.charCodeAt(0);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      return d;
    })
    .join('');
}

/** True when the trimmed input is digits only (any digit script). */
export function isNumericQuery(query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  return [...q].every((d) => {
    const code = d.charCodeAt(0);
    return (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x06f0 && code <= 0x06f9) ||
      (code >= 0x0660 && code <= 0x0669)
    );
  });
}

export interface SearchIndexRow {
  /** Global mushaf number (1..6236). */
  g: number;
  /** Surah number (1..114). */
  s: number;
  /** Ayah number inside the surah. */
  a: number;
  /** NORMALIZED Arabic text (diacritics stripped, yeh/kaf unified). */
  t: string;
}

let indexPromise: Promise<SearchIndexRow[]> | null = null;

/** Lazily load the full-Quran search index (first search only). */
export function loadSearchIndex(): Promise<SearchIndexRow[]> {
  if (!indexPromise) {
    indexPromise = import('./quran-search-index.json').then(
      (m) => (m as unknown as { default: SearchIndexRow[] }).default,
    );
  }
  return indexPromise;
}

export interface AyahSearchResult {
  hits: SearchIndexRow[];
  /** Total matches (hits may be capped by `limit`). */
  total: number;
}

/**
 * Arabic separable prefixes that may sit between a word's start and
 * a match (و، ف، ب، ل، ك، س, and ال with or without one of them),
 * plus verb prefixes (ي/ت/ن), the agent-noun م («مصلحون» for
 * «صلح») and the joined vocative يا («ياموسي» / «ياابراهيم»
 * — the dagger alif now materializes, so the vocative surfaces
 * as يا, with bare ي kept for safety).
 * Anything else between word start and match start means the match
 * is a fragment inside an unrelated word (e.g. «حيت» inside
 * «اوحيت»), not a word occurrence. Verb prefixes restore
 * root-family recall — «صلح» finds «يصلح»/«تصلح»/«نصلح» — at the
 * price of rare lookalikes such as «تنور» (oven) for «نور»
 * (light); the old pure-substring behavior matched far more such
 * fragments.
 */
const MATCH_PREFIXES = new Set([
  '',
  'و',
  'ف',
  'ب',
  'ل',
  'ك',
  'س',
  'ي',
  'ت',
  'ن',
  'م',
  'يا',
  'ال',
  'بال',
  'وال',
  'فال',
  'كال',
  'لل',
]);

/** Single letters that may start a two-letter prefix cluster. */
const CLUSTER_HEADS = new Set(['و', 'ف', 'ل', 'ب', 'ك', 'س', 'ا']);
/** Second letters of a cluster: verb prefix, or a preposition after أ. */
const CLUSTER_TAILS = new Set(['ا', 'ي', 'ت', 'ن', 'ب', 'ف', 'ل', 'ك', 'س']);

/**
 * Pronoun suffixes that may follow a match before the word ends,
 * plus the accusative/tanwin alif («ايمانا» = إيمانًا) and the
 * vocative م («اللهم» = O Allah). The miniature-waw pronoun
 * («ولكنهۥ» → «ولكنهو», but He) needs هو as well. Plural/dual
 * endings (ين/ون/ات/ان/وا) are allowed only on VERBATIM matches
 * of 3+ letter needles: «مومن» finds «المومنون» and «صالح»
 * finds «الصالحات», but «علم» never returns «العالمين» (its
 * match «عالم» skipped the dagger alif, so it is not verbatim)
 * and «منوا» (they bestowed) is not «من» (from). Known edge
 * loss of the verbatim gate: dagger-alif words' own inflections
 * («ذالكن», «ذالكما» for «ذلك») do not qualify, because their
 * match skips their own dagger alif — 2 verses, accepted.
 */
const MATCH_SUFFIXES = new Set([
  'ه',
  'ها',
  'هم',
  'كم',
  'كن',
  'نا',
  'ك',
  'ي',
  'ني',
  'هما',
  'هن',
  'كما',
  'ا',
  'م',
  'هو',
]);
const PLURAL_SUFFIXES = new Set(['ين', 'ون', 'ات', 'ان', 'وا']);

/**
 * True when a regex match inside ayah text is a real word occurrence:
 * it starts at a word start (or after a separable prefix) and ends
 * at a word end (or before a pronoun suffix). Interior needle words
 * are already whole words by construction (needle words are joined
 * by single spaces, as in the text), so only the two edges need
 * checking. A leading ء is allowed only before an alif-initial
 * match («ءايت» = آيات with its hamza seat) — otherwise «ءمن»
 * (أمن, he believed) would falsely match a «من» (from) query.
 * Two-letter prefix clusters (و+أ in «وأصلح», و+ت in «وتالله»,
 * أ+ب in «أبالله») and a single-alif gap are allowed for
 * multi-word needles («بن مريم» inside «ابن مريم» is the same
 * phrase) and for single-word needles of 3+ letters («صلح»
 * inside «أصلح» is the same root); a lone 2-letter «من» inside
 * «امن» is a different word, so short single-word needles never
 * get them. The `verbatim` flag says whether the match's last
 * word equals the needle's last word exactly (no alif skipped by
 * the skip-alif matcher); plural suffixes require it.
 */
function isWordOccurrence(
  text: string,
  start: number,
  end: number,
  multiWord: boolean,
  firstWordLen: number,
  lastWordLen: number,
  verbatim: boolean,
): boolean {
  let wordStart = start;
  while (wordStart > 0 && text[wordStart - 1] !== ' ') wordStart -= 1;
  const gap = text.slice(wordStart, start);
  if (!MATCH_PREFIXES.has(gap)) {
    const hamza = String.fromCharCode(0x0621);
    const longNeedle = multiWord || firstWordLen >= 3;
    const cluster =
      longNeedle &&
      gap.length === 2 &&
      CLUSTER_HEADS.has(gap[0]) &&
      CLUSTER_TAILS.has(gap[1]);
    const singleAlif = gap === ALEF && longNeedle;
    if (!cluster && !singleAlif && !(gap === hamza && text[start] === ALEF)) {
      return false;
    }
  }
  let wordEnd = end;
  while (wordEnd < text.length && text[wordEnd] !== ' ') wordEnd += 1;
  const suffix = text.slice(end, wordEnd);
  if (suffix === '' || MATCH_SUFFIXES.has(suffix)) return true;
  return PLURAL_SUFFIXES.has(suffix) && verbatim && lastWordLen >= 3;
}

/**
 * Whole-Quran ayah-text search: every query word must appear, in order,
 * as a consecutive word sequence in the normalized ayah text. Returns
 * hits capped at `limit` plus the true total.
 *
 * Skip-alif tolerance (round 4): between any two needle letters the
 * text may carry one extra alif (ا?) — the dagger alif the standard
 * spelling omits (الرحمن in «الرحمان», ذلك in «ذالك», لكن in
 * «لاكن», اله in «الاه»). Needle letters themselves are mandatory,
 * so «ايات» never matches the verb «يات» (its first alif is a real
 * letter, not a skippable one), and «الله» never matches «الاه».
 * A match that skipped an alif is NOT verbatim, so it cannot take a
 * plural suffix: «علم» in «العالمين» is «عالم» with a skipped alif
 * plus ين — rejected — while «صالح» in «الصالحين» is verbatim
 * plus ين — kept. (Known price: word-initial alif omissions such
 * as ابن→بن are not forgiven; «ابن مريم» matches only the
 * with-alif occurrences, while «بن مريم» typed as written matches
 * via the multi-word alif-gap rule.) A match must also be a word
 * occurrence (see isWordOccurrence): without that guard, «حيات»
 * would match «حيت» inside «اوحيت» — a fragment of an unrelated
 * word, not the occurrence the user asked for.
 */
/** Build the skip-alif needle pattern shared by search + snippet spans. */
function buildNeedlePattern(words: string[]): RegExp {
  const escapeChar = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Within each word, any two needle letters may have one text alif
  // between them; words themselves are joined by a single space.
  const pattern = words
    .map((w) => [...w].map(escapeChar).join(`${ALEF}?`))
    .join(' ');
  return new RegExp(pattern, 'g');
}

export async function searchAyahs(query: string, limit = 30): Promise<AyahSearchResult> {
  const words = normalizeQueryWords(query);
  if (words.length === 0) return { hits: [], total: 0 };
  const re = buildNeedlePattern(words);
  const rows = await loadSearchIndex();
  const multiWord = words.length > 1;
  const firstWordLen = words[0].length;
  const lastWord = words[words.length - 1];
  const lastWordLen = lastWord.length;
  const matches = rows.filter((r) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.t)) !== null) {
      const lastSegment = m[0].slice(m[0].lastIndexOf(' ') + 1);
      if (
        isWordOccurrence(
          r.t,
          m.index,
          m.index + m[0].length,
          multiWord,
          firstWordLen,
          lastWordLen,
          lastSegment === lastWord,
        )
      )
        return true;
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return false;
  });
  return { hits: matches.slice(0, limit), total: matches.length };
}

/**
 * Surah-name match over the local surah list (fa/ar/en names + number).
 * Arabic-script names match after normalization, so a Persian-keyboard
 * query finds the Arabic name and vice versa.
 */
export function matchSurahs(surahs: SurahSummary[], query: string): SurahSummary[] {
  const raw = query.trim();
  if (!raw) return [];
  const digits = toLatinDigits(raw);
  if (/^[0-9]+$/.test(digits)) {
    const n = Number(digits);
    return surahs.filter((s) => s.number === n);
  }
  const nq = normalizeQuranText(raw);
  const lq = raw.toLowerCase();
  return surahs.filter(
    (s) =>
      normalizeQuranText(s.nameAr).includes(nq) ||
      normalizeQuranText(s.name).includes(nq) ||
      s.name.toLowerCase().includes(lq) ||
      s.englishName.toLowerCase().includes(lq),
  );
}

/* ------------------------------------------------------------------ */
/* Round 8 — live-search strip additions. Nothing above this line     */
/* changed behavior: normalization, searchAyahs and matchSurahs are    */
/* untouched. These helpers only ADD: surah aliases, match spans,     */
/* two-stage ranking, and a full ranked result set for the strip.     */
/* ------------------------------------------------------------------ */

/** Drop the search-index cache so a failed load can be retried. */
export function resetSearchIndex(): void {
  indexPromise = null;
}

/**
 * Span of the first word-occurrence match of `query` inside the
 * NORMALIZED ayah text, or null. Used only to place the snippet
 * window and the <mark> highlight in the live strip.
 */
export function findAyahMatchSpan(
  text: string,
  query: string,
): { start: number; end: number } | null {
  const words = normalizeQueryWords(query);
  if (words.length === 0) return null;
  const re = buildNeedlePattern(words);
  const multiWord = words.length > 1;
  const firstWordLen = words[0].length;
  const lastWord = words[words.length - 1];
  const lastWordLen = lastWord.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lastSegment = m[0].slice(m[0].lastIndexOf(' ') + 1);
    if (
      isWordOccurrence(
        text,
        m.index,
        m.index + m[0].length,
        multiWord,
        firstWordLen,
        lastWordLen,
        lastSegment === lastWord,
      )
    )
      return { start: m.index, end: m.index + m[0].length };
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return null;
}

/**
 * Two-stage ranking (Tarteel-style): exact-word matches first,
 * substring matches after, mushaf order preserved inside each stage.
 * Single word: exact = a space-delimited token equals the word, or
 * equals ال + the word. Multi-word: exact = consecutive tokens
 * equal the query words.
 */
export function rankAyahHits(hits: SearchIndexRow[], query: string): SearchIndexRow[] {
  const words = normalizeQueryWords(query);
  if (words.length === 0) return hits;
  const isExact = (r: SearchIndexRow): boolean => {
    const tokens = r.t.split(' ');
    if (words.length === 1) {
      const w = words[0];
      return tokens.some((tok) => tok === w || tok === `ال${w}`);
    }
    for (let i = 0; i + words.length <= tokens.length; i += 1) {
      let ok = true;
      for (let j = 0; j < words.length; j += 1) {
        if (tokens[i + j] !== words[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };
  const exact: SearchIndexRow[] = [];
  const rest: SearchIndexRow[] = [];
  for (const h of hits) (isExact(h) ? exact : rest).push(h);
  return [...exact, ...rest];
}

/**
 * Full ranked result set for the live strip: ALL matches (not the
 * 30-cap of the old box) plus the true total. The lazy index load
 * is unchanged — still first-search only.
 */
export async function searchAyahsRanked(query: string): Promise<AyahSearchResult> {
  const r = await searchAyahs(query, Number.MAX_SAFE_INTEGER);
  return { hits: rankAyahHits(r.hits, query), total: r.total };
}

/** Well-known Latin transliteration per surah (1..114), no invented forms. */
export const SURAH_LATIN_NAMES: Record<number, string> = {
  1: 'Al-Fatihah', 2: 'Al-Baqarah', 3: 'Aal-e-Imran', 4: 'An-Nisa',
  5: "Al-Ma'idah", 6: "Al-An'am", 7: "Al-A'raf", 8: 'Al-Anfal',
  9: 'At-Tawbah', 10: 'Yunus', 11: 'Hud', 12: 'Yusuf', 13: "Ar-Ra'd",
  14: 'Ibrahim', 15: 'Al-Hijr', 16: 'An-Nahl', 17: 'Al-Isra',
  18: 'Al-Kahf', 19: 'Maryam', 20: 'Ta-Ha', 21: 'Al-Anbiya',
  22: 'Al-Hajj', 23: "Al-Mu'minun", 24: 'An-Nur', 25: 'Al-Furqan',
  26: "Ash-Shu'ara", 27: 'An-Naml', 28: 'Al-Qasas', 29: 'Al-Ankabut',
  30: 'Ar-Rum', 31: 'Luqman', 32: 'As-Sajdah', 33: 'Al-Ahzab',
  34: 'Saba', 35: 'Fatir', 36: 'Ya-Sin', 37: 'As-Saffat', 38: 'Sad',
  39: 'Az-Zumar', 40: 'Ghafir', 41: 'Fussilat', 42: 'Ash-Shura',
  43: 'Az-Zukhruf', 44: 'Ad-Dukhan', 45: 'Al-Jathiyah', 46: 'Al-Ahqaf',
  47: 'Muhammad', 48: 'Al-Fath', 49: 'Al-Hujurat', 50: 'Qaf',
  51: 'Adh-Dhariyat', 52: 'At-Tur', 53: 'An-Najm', 54: 'Al-Qamar',
  55: 'Ar-Rahman', 56: "Al-Waqi'ah", 57: 'Al-Hadid', 58: 'Al-Mujadila',
  59: 'Al-Hashr', 60: 'Al-Mumtahanah', 61: 'As-Saff', 62: "Al-Jumu'ah",
  63: 'Al-Munafiqun', 64: 'At-Taghabun', 65: 'At-Talaq', 66: 'At-Tahrim',
  67: 'Al-Mulk', 68: 'Al-Qalam', 69: 'Al-Haqqah', 70: "Al-Ma'arij",
  71: 'Nuh', 72: 'Al-Jinn', 73: 'Al-Muzzammil', 74: 'Al-Muddaththir',
  75: 'Al-Qiyamah', 76: 'Al-Insan', 77: 'Al-Mursalat', 78: 'An-Naba',
  79: "An-Nazi'at", 80: 'Abasa', 81: 'At-Takwir', 82: 'Al-Infitar',
  83: 'Al-Mutaffifin', 84: 'Al-Inshiqaq', 85: 'Al-Buruj', 86: 'At-Tariq',
  87: "Al-A'la", 88: 'Al-Ghashiyah', 89: 'Al-Fajr', 90: 'Al-Balad',
  91: 'Ash-Shams', 92: 'Al-Layl', 93: 'Ad-Duha', 94: 'Ash-Sharh',
  95: 'At-Tin', 96: 'Al-Alaq', 97: 'Al-Qadr', 98: 'Al-Bayyinah',
  99: 'Az-Zalzalah', 100: 'Al-Adiyat', 101: "Al-Qari'ah", 102: 'At-Takathur',
  103: 'Al-Asr', 104: 'Al-Humazah', 105: 'Al-Fil', 106: 'Quraysh',
  107: "Al-Ma'un", 108: 'Al-Kawthar', 109: 'Al-Kafirun', 110: 'An-Nasr',
  111: 'Al-Masad', 112: 'Al-Ikhlas', 113: 'Al-Falaq', 114: 'An-Nas',
};

/** A few common Latin spelling variants (only well-attested ones). */
const SURAH_LATIN_VARIANTS: Record<number, string[]> = {
  1: ['fatiha'],
  2: ['baqara'],
  5: ['maida'],
  9: ['tawba'],
  12: ['yousuf'],
  36: ['yaseen'],
  55: ['rehman'],
};

/**
 * Famous alternative names (Arabic/Persian). Only widely attested
 * names are listed; when in doubt a name is omitted, never invented.
 * Pair names (الزهراوان، المعوذتین) map to both surahs of the pair.
 */
const SURAH_ALT_NAMES: Record<number, string[]> = {
  1: ['فاتحة الکتاب', 'ام الکتاب', 'السبع المثانی', 'الحمد'],
  2: ['سنام القرآن', 'فسطاط القرآن', 'الزهراوان'],
  3: ['الزهراوان'],
  17: ['بنی اسرائیل', 'سبحان'],
  26: ['طسم'],
  27: ['طس'],
  28: ['طسم'],
  36: ['قلب القرآن'],
  47: ['القتال'],
  55: ['عروس القرآن'],
  67: ['تبارک', 'المنجیة', 'المانعة'],
  68: ['نون'],
  78: ['عم یتسائلون'],
  112: ['التوحید', 'قل هو الله احد'],
  113: ['المعوذتین'],
  114: ['المعوذتین'],
};

/** Latin key: lowercase, hyphens/apostrophes/spaces stripped. */
function latinKey(s: string): string {
  return s.toLowerCase().replace(/[-'’\s]/g, '');
}

/** Strip a leading surah word (سوره/سورة/surah) from the query. */
function stripSurahWord(query: string): string {
  return query.replace(/^(سورهٔ?|سورة|surah)\s*/i, '').trim();
}

function stripSpaces(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * Surah-name match for the live strip: fa name + ar name + localized
 * name + famous alternative names + Latin transliteration (and its
 * common variants) + attached/spaced forms (space-stripped compare).
 * Bare numbers are DELIBERATELY not matched here: a bare number
 * means PAGE, never surah (user rule; differs from Tarteel).
 */
export function matchSurahsWithAliases(
  surahs: SurahSummary[],
  query: string,
): SurahSummary[] {
  const raw = query.trim();
  if (!raw) return [];
  const digits = toLatinDigits(raw);
  if (/^[0-9]+$/.test(digits)) return [];
  const q = stripSurahWord(raw);
  if (!q) return [];
  const nq = normalizeQuranText(q);
  const sq = stripSpaces(nq);
  const isLatin = /[a-zA-Z]/.test(q);
  const lq = latinKey(q);
  return surahs.filter((s) => {
    const candidates = [
      s.nameAr,
      s.name,
      s.englishName,
      ...(SURAH_ALT_NAMES[s.number] ?? []),
    ];
    for (const c of candidates) {
      const nc = normalizeQuranText(c);
      if (nc.includes(nq) || stripSpaces(nc).includes(sq)) return true;
    }
    if (isLatin) {
      const latinForms = [
        latinKey(SURAH_LATIN_NAMES[s.number] ?? s.englishName),
        ...(SURAH_LATIN_VARIANTS[s.number] ?? []).map(latinKey),
      ];
      for (const f of latinForms) {
        if (f === lq || (lq.length >= 3 && f.includes(lq))) return true;
      }
    }
    return false;
  });
}
