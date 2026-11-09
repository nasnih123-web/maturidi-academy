/**
 * apps/mobile — src/lib/quranTajweed.ts
 *
 * Port of apps/web/lib/quran-tajweed.ts (same rules, same colors —
 * kept in sync with the web copy: any rule change must land in both
 * files). Phase 12: the old 4-color copy (green/blue/pink/gray,
 * with ikhfaa wrongly painted green) is replaced by the web's
 * 8-color documented palette (phase 7).
 *
 * Tajweed letter coloring for the Uthmani text — the EIGHT colors
 * of Tarteel's official mushaf palette (support.tarteel.ai,
 * "Understanding Tajweed Colors in the Tarteel Mushaf", checked
 * 2026-11-07):
 *
 * - darkred     — madd laazim (6 counts): madd + shadda, or madd +
 *                 an inherently sakinah letter (incl. the disjointed
 *                 letters, where the maddah mark sits on a consonant).
 * - orangered   — madd wajib muttasil (4–5): madd + hamza, same word.
 * - lightorange — madd 'aarid li-sukoon (2/4/6): madd + one voweled
 *                 letter, word-final (the letter that goes sakinah
 *                 at a stop).
 * - yellow      — madd tabee'i (2): any other madd letter.
 * - green       — ghunnah: noon/meem + shadda ONLY.
 * - lightblue   — qalqalah: ق ط ب ج د with sukun.
 * - darkblue    — tafkhim: heavy raa + the isti'laa letters
 *                 (خ ص ض غ ط ق ظ).
 * - gray        — silent letters: waslah alif (ٱ), any letter marked
 *                 with the round zero (۟ U+06DF — written, never
 *                 read), the waw that only carries a dagger alef
 *                 (صلوة-type), and the lam of ال before a sun
 *                 letter (idgham shamsi).
 *
 * Deliberately NOT colored (the official palette has no color for
 * them): izhar, idgham, ikhfaa — including noon sakinah before an
 * ikhfaa letter, which the old 4-color version wrongly painted
 * green. Madd munfasil / madd silah kubra (a madd whose hamza is in
 * the NEXT word) has no palette category either: it is colored as
 * the plain madd it is inside its own word (yellow). Tajweed is
 * never detected acoustically — this is display information from
 * the written text only.
 *
 * Coloring is per grapheme (base letter + its marks). A base letter
 * takes its rule color and its marks inherit it — with one
 * exception: a dagger alef (ٰ U+0670) sitting on a consonant (e.g.
 * the lam in أُو۟لَـٰٓئِكَ, the waw in ٱلصَّلَوٰةِ) is itself a madd
 * letter, so it gets its own madd color while the base keeps its
 * own. The madd type is decided from the next NON-SILENT grapheme:
 * silent letters (round-zero marks, the alif after a plural waw)
 * are skipped, so e.g. the waw in قَالُوا is tabee'i, not laazim.
 *
 * Priority when rules overlap (first match wins): silent > madd >
 * maddah-on-consonant (laazim harfi) > qalqalah > ghunna > tafkhim.
 * A sakinah ق/ط is qalqalah (light blue), a voweled one is tafkhim
 * (dark blue). Anything uncertain stays black (never guessed).
 *
 * Differences from the web copy (mechanical only, same rules):
 * `noUncheckedIndexedAccess` is on in apps/mobile, so indexed
 * reads are guarded with explicit `undefined` checks.
 */

export type TajweedColor =
  | 'darkred'
  | 'orangered'
  | 'lightorange'
  | 'yellow'
  | 'green'
  | 'lightblue'
  | 'darkblue'
  | 'gray';

export interface TajweedSegment {
  text: string;
  color: TajweedColor | null;
}

const SHADDA = 'ّ'; // U+0651
const SUKUN = 'ْ'; // U+0652
const MADDAH = 'ٓ'; // U+0653
const FATHA = 'َ'; // U+064E
const DAMMA = 'ُ'; // U+064F
const KASRA = 'ِ'; // U+0650
const WASLAH = 'ٱ'; // U+0671
const MADDA_ALEF = 'آ'; // U+0622 (precomposed alef with madda)
const DAGGER_ALEF = 'ٰ'; // U+0670 (superscript alef)
const SIFR_ROUND = '۟'; // U+06DF (round zero: written, never read)
const SMALL_WAW = 'ۥ'; // U+06E5 (madd silah)
const SMALL_YA = 'ۦ'; // U+06E6 (madd silah)

/** The 14 sun letters (shamsiyya): the lam of ال assimilates. */
const SUN_LETTERS = new Set([
  'ت', 'ث', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ل', 'ن',
]);

/** Single-letter prefixes that can precede the definite article
    (وَٱلشَّمْسِ, بِٱللَّهِ, لِلَّهِ): the lam is still shamsiyya. */
const PREFIX_LETTERS = new Set(['و', 'ف', 'ب', 'ك', 'ل']);
const QALQALAH = new Set(['ق', 'ط', 'ب', 'ج', 'د']);

/** Isti'laa (heavy) letters — always mufakham. */
const ISTILAA = new Set(['خ', 'ص', 'ض', 'غ', 'ط', 'ق', 'ظ']);

/** Hamza in all its written forms (incl. the precomposed madda alef). */
const HAMZA_FORMS = new Set(['ء', 'أ', 'إ', 'آ', 'ؤ', 'ئ']);

/** Arabic combining marks that attach to the preceding base letter. */
function isMark(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x064b && c <= 0x0652) || // tanwin, fatha, damma, kasra, shadda, sukun
    c === 0x0653 || // maddah
    c === 0x0654 || // hamza above
    c === 0x0655 || // hamza below
    c === 0x0656 || // subscript alef
    c === 0x0657 || // inverted damma
    c === 0x0658 || // mark noon ghunna
    c === 0x0670 || // superscript alef
    (c >= 0x06d6 && c <= 0x06dc) ||
    c === 0x06df ||
    (c >= 0x06e0 && c <= 0x06e4) ||
    c === 0x06e7 ||
    c === 0x06e8
  );
}

interface Grapheme {
  base: string;
  marks: string;
}

function splitGraphemes(word: string): Grapheme[] {
  const out: Grapheme[] = [];
  for (const ch of word) {
    if (isMark(ch) && out.length > 0) {
      const last = out[out.length - 1];
      if (last) last.marks += ch;
    } else {
      out.push({ base: ch, marks: '' });
    }
  }
  return out;
}

/** True when the grapheme carries no vowel at all (Uthmani sukun). */
function hasNoVowel(g: Grapheme): boolean {
  return (
    !g.marks.includes(FATHA) &&
    !g.marks.includes(DAMMA) &&
    !g.marks.includes(KASRA) &&
    !g.marks.includes(SHADDA)
  );
}

function isSakinah(g: Grapheme): boolean {
  return g.marks.includes(SUKUN) || hasNoVowel(g);
}

/**
 * Silent letters (gray). The round zero (۟) is the mushaf's own
 * mark for "written, never read" — it covers the alif after a
 * plural waw (كَفَرُوا۟), the waw in أُو۟لَـٰٓئِكَ and the ya in
 * أَفَإِي۟ن (verified: every word-final "وا" in Tanzil carries it).
 * The shamsiyya lam is positional: word-initial ال + sun letter
 * with shadda. The waw that only carries a dagger alef (صلوة-type)
 * is silent; the dagger alef itself is a madd, colored separately.
 */
function isSilent(g: Grapheme, i: number, gs: Grapheme[]): boolean {
  if (g.base === WASLAH) return true;
  if (g.marks.includes(SIFR_ROUND)) return true;
  if (g.base === 'و' && g.marks.includes(DAGGER_ALEF) && hasNoVowel(g)) return true;
  const prev = gs[i - 1];
  const next = gs[i + 1];
  if (
    g.base === 'ل' &&
    prev !== undefined &&
    prev.base === WASLAH &&
    gs.slice(0, i - 1).every((p) => PREFIX_LETTERS.has(p.base)) &&
    next !== undefined &&
    SUN_LETTERS.has(next.base) &&
    next.marks.includes(SHADDA)
  ) {
    return true;
  }
  return false;
}

/** True when the grapheme is a madd letter (lengthened vowel). */
function isMaddLetter(g: Grapheme, prev: Grapheme | undefined): boolean {
  if (g.base === SMALL_WAW || g.base === SMALL_YA) return true; // madd silah
  if (g.base === MADDA_ALEF) return true;
  if (g.base === 'ا' || g.base === 'ى') {
    // Alif / alif maqsura after fatha; ى after kasra is a madd ya
    // (ٱلَّذِى is pronounced with a long "ee").
    if (prev === undefined) return false;
    return prev.marks.includes(FATHA) || (g.base === 'ى' && prev.marks.includes(KASRA));
  }
  if (g.base === 'و') {
    return isSakinah(g) && prev !== undefined && prev.marks.includes(DAMMA);
  }
  if (g.base === 'ي') {
    return isSakinah(g) && prev !== undefined && prev.marks.includes(KASRA);
  }
  return false;
}

/**
 * The madd type of the madd letter (or dagger alef) at index i,
 * decided from the next non-silent grapheme after it.
 */
function maddType(i: number, gs: Grapheme[]): TajweedColor {
  let next: Grapheme | undefined;
  let nextIndex = -1;
  for (let j = i + 1; j < gs.length; j += 1) {
    const g = gs[j];
    if (g === undefined) continue;
    if (isSilent(g, j, gs)) continue;
    next = g;
    nextIndex = j;
    break;
  }
  if (next === undefined) return 'yellow'; // word-final madd: tabee'i
  if (HAMZA_FORMS.has(next.base)) return 'orangered'; // muttasil
  if (next.marks.includes(SHADDA)) return 'darkred'; // laazim muthaqqal
  if (isSakinah(next)) return 'darkred'; // laazim mukhaffaf
  // One voweled letter left, word-final: it goes sakinah at a stop.
  let more = false;
  for (let j = nextIndex + 1; j < gs.length; j += 1) {
    const g = gs[j];
    if (g === undefined) continue;
    if (!isSilent(g, j, gs)) {
      more = true;
      break;
    }
  }
  return more ? 'yellow' : 'lightorange'; // tabee'i vs 'aarid
}

/** True when the raa is heavy (mufakham). */
function isHeavyRaa(g: Grapheme, prev: Grapheme | undefined): boolean {
  return (
    g.marks.includes(FATHA) ||
    g.marks.includes(DAMMA) ||
    (isSakinah(g) &&
      prev !== undefined &&
      (prev.marks.includes(FATHA) || prev.marks.includes(DAMMA)))
  );
}

/** The rule color of one base letter (its marks inherit it). */
function baseColor(g: Grapheme, i: number, gs: Grapheme[]): TajweedColor | null {
  const prev = gs[i - 1];
  if (isSilent(g, i, gs)) return 'gray';
  if (isMaddLetter(g, prev)) return maddType(i, gs);
  // A maddah mark on a consonant is the lengthened letter-name
  // (madd laazim harfi, e.g. الٓمٓ: the lam and the meem) — but
  // NOT when the maddah sits on a dagger alef: then it belongs to
  // the dagger alef (the madd), and the consonant stays its own
  // color (the lam in أُو۟لَـٰٓئِكَ is black; its dagger alef is
  // muttasil).
  if (g.marks.includes(MADDAH) && !g.marks.includes(DAGGER_ALEF)) return 'darkred';
  if (QALQALAH.has(g.base) && isSakinah(g)) return 'lightblue';
  if ((g.base === 'ن' || g.base === 'م') && g.marks.includes(SHADDA)) {
    return 'green'; // ghunna — ikhfaa is NOT colored (no palette color)
  }
  if (g.base === 'ر' ? isHeavyRaa(g, prev) : ISTILAA.has(g.base)) {
    return 'darkblue'; // tafkhim
  }
  return null;
}

/**
 * Split one Uthmani word into colored segments. Adjacent characters
 * with the same color are merged, so a word usually yields few spans.
 */
export function colorizeTajweedWord(word: string): TajweedSegment[] {
  const graphemes = splitGraphemes(word);
  const segments: TajweedSegment[] = [];
  const push = (text: string, color: TajweedColor | null): void => {
    const last = segments[segments.length - 1];
    if (last && last.color === color) last.text += text;
    else segments.push({ text, color });
  };
  for (let i = 0; i < graphemes.length; i += 1) {
    const g = graphemes[i];
    if (g === undefined) continue;
    const color = baseColor(g, i, graphemes);
    push(g.base, color);
    // Marks inherit the base color — except a dagger alef on a
    // consonant (not itself a madd letter): the dagger alef IS the
    // madd, so it gets its own madd color (e.g. the lam in
    // أُو۟لَـٰٓئِكَ is black, its dagger alef is muttasil orange-red),
    // and a maddah mark sitting on that dagger alef belongs to the
    // madd too (same color), not to the consonant.
    const daggerColor =
      g.marks.includes(DAGGER_ALEF) && !isMaddLetter(g, graphemes[i - 1])
        ? maddType(i, graphemes)
        : null;
    for (const mark of g.marks) {
      if (mark === DAGGER_ALEF && daggerColor !== null) {
        push(mark, daggerColor);
      } else if (mark === MADDAH && daggerColor !== null) {
        push(mark, daggerColor);
      } else {
        push(mark, color);
      }
    }
  }
  return segments;
}
