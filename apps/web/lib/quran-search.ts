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
export async function searchAyahs(query: string, limit = 30): Promise<AyahSearchResult> {
  const words = normalizeQueryWords(query);
  if (words.length === 0) return { hits: [], total: 0 };
  const escapeChar = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Within each word, any two needle letters may have one text alif
  // between them; words themselves are joined by a single space.
  const pattern = words
    .map((w) => [...w].map(escapeChar).join(`${ALEF}?`))
    .join(' ');
  const re = new RegExp(pattern, 'g');
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
