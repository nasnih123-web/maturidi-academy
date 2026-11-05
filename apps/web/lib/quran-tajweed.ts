/**
 * Tajweed letter coloring for the Uthmani text, as rendered by the
 * Tarteel Hifz page (the reference clip): a word is written in black
 * ink, with a few letters colored by tajweed rule. Only the rules
 * verified against the clip are implemented here; any letter whose
 * color is uncertain stays black (never guessed).
 *
 * Verified rules (clip: Al-Baqarah 2:6-2:7, measured per-pixel):
 * - green: ghunnah (noon/meem + shadda) and ikhfaa (noon sakinah
 *   before an ikhfaa letter; meem sakinah before baa = ikhfaa
 *   shafawi). Examples: the noon in إِنَّ, the noon before ذ in
 *   ءَأَنذَرْتَهُمْ and تُنذِرْهُمْ. Note: in Uthmani orthography a
 *   noon sakinah before an ikhfaa letter carries NO explicit sukun
 *   mark — the absence of any vowel mark IS the sukun.
 * - blue: heavy (mufakham) raa — raa with fatha/dammah, or raa
 *   sakinah after fatha/dammah. Examples: the raa in كَفَرُوا, the
 *   sakinah raa in ءَأَنذَرْتَهُمْ. Light raa (kasrah, or sakinah
 *   after kasrah, as in تُنذِرْهُمْ) stays black.
 * - pink: the maddah mark itself (U+0653), and the hamza of madd
 *   muttasil (a hamza right after a maddah alif). Examples: the
 *   hamza in سَوَآءٌ, the maddah on وَعَلَىٰٓ. The maddah alif
 *   itself (U+0622) stays black.
 * - gray: the waslah alif (U+0671), which is not pronounced.
 *   Example: the alif in ٱلَّذِينَ and ٱللَّهُ.
 * Deliberately NOT colored (no clip evidence): qalqalah, iqlab,
 * idgham, light raa, tanwin-ikhfaa. Those letters stay black.
 *
 * Coloring is per character: a base letter takes its rule color and
 * its vowel marks inherit it — except the maddah mark, which is
 * always pink while its base letter stays black.
 */

export type TajweedColor = 'green' | 'blue' | 'pink' | 'gray';

export interface TajweedSegment {
  text: string;
  color: TajweedColor | null;
}

const SHADDA = 'ّ'; // U+0651
const SUKUN = 'ْ'; // U+0652
const MADDAH = 'ٓ'; // U+0653
const FATHA = 'َ'; // U+064E
const DAMMA = 'ُ'; // U+064F
const WASLAH = 'ٱ'; // U+0671
const HAMZA = 'ء'; // U+0621
const MADDA_ALEF = 'آ'; // U+0622 (precomposed alef with madda)

/** The 15 ikhfaa letters (noon sakinah hides before these). */
const IKHFAA = new Set([
  'ت', 'ث', 'ج', 'د', 'ذ', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ف', 'ق', 'ك',
]);

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
      out[out.length - 1].marks += ch;
    } else {
      out.push({ base: ch, marks: '' });
    }
  }
  return out;
}

/** True when the grapheme carries no vowel at all (Uthmani sukun). */
function hasNoVowel(g: Grapheme): boolean {
  return (
    !g.marks.includes('َ') && // fatha
    !g.marks.includes('ُ') && // damma
    !g.marks.includes('ِ') && // kasra
    !g.marks.includes(SHADDA)
  );
}

function isSakinah(g: Grapheme): boolean {
  return g.marks.includes(SUKUN) || hasNoVowel(g);
}

/** The rule color of one base letter (its marks inherit it). */
function baseColor(g: Grapheme, prev: Grapheme | undefined, next: Grapheme | undefined): TajweedColor | null {
  if (g.base === WASLAH) return 'gray';
  if (g.base === HAMZA && prev !== undefined && (prev.base === MADDA_ALEF || prev.marks.includes(MADDAH))) {
    // Hamza of madd muttasil (e.g. the hamza in سَوَآءٌ).
    return 'pink';
  }
  if (g.base === 'ن' || g.base === 'م') {
    if (g.marks.includes(SHADDA)) return 'green'; // ghunnah
    if (isSakinah(g) && next !== undefined) {
      if (g.base === 'ن' && IKHFAA.has(next.base)) return 'green'; // ikhfaa
      if (g.base === 'م' && next.base === 'ب') return 'green'; // ikhfaa shafawi
    }
    return null;
  }
  if (g.base === 'ر') {
    const heavy =
      g.marks.includes(FATHA) ||
      g.marks.includes(DAMMA) ||
      (isSakinah(g) &&
        prev !== undefined &&
        (prev.marks.includes(FATHA) || prev.marks.includes(DAMMA)));
    if (heavy) return 'blue';
    // Light raa (kasrah, or sakinah after kasrah) stays black.
    return null;
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
    const color = baseColor(g, graphemes[i - 1], graphemes[i + 1]);
    push(g.base, color);
    // Marks inherit the base color, except the maddah mark itself,
    // which is always pink while its base letter stays black.
    for (const mark of g.marks) {
      push(mark, mark === MADDAH ? 'pink' : color);
    }
  }
  return segments;
}
