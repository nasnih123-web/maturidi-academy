/**
 * hifz-page-render: pure page-render builders moved verbatim from
 * components/QuranHifzStudy.tsx (hifz-completion refactor step 4).
 * No behavior change: same signatures, same slot/marker/ornament
 * rules, same null-fallback contract for V2 (caller falls back to
 * the QPC1 lines for the same page, never a half-mixed page).
 * The live-session, navigation and JSX code that CALLS these stays in
 * the component; only the pure builders moved here.
 */
import type { MushafExactLine } from './quran-mushaf-lines';
import { parseTextLine, RUB_EL_HIZB, toArabicIndic } from './quran-print-lines';
import {
  expandV2Page,
  v2PageAyahs,
  type V2MushafMeta,
  type V2Page,
} from './quran-mushaf-v2';
import { v4WordKey, V4_MERGED_PAIR_SLOT_KEYS, v4RealWordNumbers } from './quran-mushaf-v4';
import type {
  LineSlot,
  LineWordSlot,
  RenderLine,
  WallWord,
} from './hifz-study-types';

/** First page (0-based) whose lines cover the given ayah, else null. */
export function pageIndexFor(
  pages: MushafExactLine[][],
  surah: number,
  ayah: number,
): number | null {
  for (let p = 0; p < pages.length; p += 1) {
    for (const line of pages[p]) {
      if (line.t !== 'text' || !line.v || !line.w) continue;
      const [vs, va] = line.v.split(':').map(Number);
      const [ws, wa] = line.w.split(':').map(Number);
      if (vs === surah && ws === surah && va <= ayah && ayah <= wa) return p;
    }
  }
  return null;
}

/**
 * Surahs whose Basmalah line sits on this page: a basmala line whose
 * immediately following text line starts a new surah at ayah 1
 * (surahs 1 and 9 have no Basmalah line in the data).
 */
export function basmalaSurahsOnPage(lines: MushafExactLine[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].t !== 'basmala') continue;
    const next = lines[i + 1];
    if (next?.t === 'text' && next.v) {
      const [s, a] = next.v.split(':').map(Number);
      if (a === 1 && s !== 1 && s !== 9) out.add(s);
    }
  }
  return out;
}

/**
 * Build the render lines for ONE printed page (pure — no hooks).
 * Ayahs whose study words match the printed segment totals render
 * in line slots (revealed when written, hidden otherwise); every
 * other segment uses its printed tokens as display-only words
 * (visible plain ink), so marker positions stay true. For a surah with a Basmalah line on this
 * page, ayah 1's printed segments exclude the four Basmalah words,
 * so the study total is compared minus four.
 * Used for the current page (page/card mode) and for every page of
 * the surah (scroll mode).
 */
export function buildPageRender(
  pageLines: MushafExactLine[],
  surah: number,
  texts: Record<number, string> | undefined,
  wallAyahs: { ayah: number; words: WallWord[] }[],
): { placedAyahs: Set<number>; basmalaSplit: boolean; renderLines: RenderLine[] } {
  const empty = {
    placedAyahs: new Set<number>(),
    basmalaSplit: false,
    renderLines: [] as RenderLine[],
  };
  if (!texts) return empty;
  const split = basmalaSurahsOnPage(pageLines).has(surah);
  const totals = new Map<number, number>();
  for (const line of pageLines) {
    const parsed = parseTextLine(line);
    if (!parsed || parsed.surah !== surah) continue;
    for (const seg of parsed.segments) {
      totals.set(seg.ayah, (totals.get(seg.ayah) ?? 0) + seg.words.length);
    }
  }
  const placed = new Set<number>();
  for (const [a, total] of totals) {
    const words = (texts[a] ?? '').split(/\s+/).filter(Boolean);
    const expected = a === 1 && split ? words.length - 4 : words.length;
    if (words.length > 0 && total === expected) placed.add(a);
  }
  const writtenByKey = new Map<string, WallWord>();
  for (const group of wallAyahs) {
    for (const w of group.words) writtenByKey.set(`${group.ayah}:${w.index}`, w);
  }
  const consumed = new Map<number, number>();
  const out: RenderLine[] = [];
  pageLines.forEach((line, li) => {
    if (line.t === 'surah-header') {
      if (line.x) out.push({ kind: 'header', key: `h${li}`, text: line.x });
      return;
    }
    if (line.t === 'basmala') {
      const next = pageLines[li + 1];
      const [s, a] = (next?.v ?? '').split(':').map(Number);
      const slots: LineWordSlot[] = [];
      if (next?.t === 'text' && a === 1 && s === surah && placed.has(1) && texts?.[1]) {
        const words = texts[1].split(/\s+/).filter(Boolean).slice(0, 4);
        words.forEach((text, i) => {
          const written = writtenByKey.get(`1:${i}`) ?? null;
          slots.push({
            kind: 'word',
            surah,
            ayah: 1,
            index: i,
            text,
            written,
            hidden: written === null,
          });
        });
      }
      out.push({ kind: 'basmala', key: `b${li}`, slots });
      return;
    }
    const parsed = parseTextLine(line);
    if (!parsed) return;
    const slots: LineSlot[] = [];
    for (const seg of parsed.segments) {
      if (parsed.surah === surah && placed.has(seg.ayah) && texts?.[seg.ayah]) {
        const study = texts[seg.ayah].split(/\s+/).filter(Boolean);
        const start = consumed.get(seg.ayah) ?? (seg.ayah === 1 && split ? 4 : 0);
        seg.words.forEach((_, i) => {
          for (const off of seg.ornaments) {
            if (off === i) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
          }
          const index = start + i;
          const text = study[index];
          if (text === undefined) return;
          const written = writtenByKey.get(`${seg.ayah}:${index}`) ?? null;
          slots.push({
            kind: 'word',
            surah,
            ayah: seg.ayah,
            index,
            text,
            written,
            hidden: written === null,
          });
        });
        for (const off of seg.ornaments) {
          if (off === seg.words.length) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
        }
        consumed.set(seg.ayah, start + seg.words.length);
      } else {
        seg.words.forEach((tok, i) => {
          for (const off of seg.ornaments) {
            if (off === i) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
          }
          slots.push({
            kind: 'word',
            surah: parsed.surah,
            ayah: seg.ayah,
            index: -1,
            text: tok,
            written: null,
            hidden: false,
            displayOnly: true,
          });
        });
        for (const off of seg.ornaments) {
          if (off === seg.words.length) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
        }
      }
      if (seg.marker !== null)
        slots.push({
          kind: 'marker',
          text: seg.marker,
          surah: parsed.surah,
          ayah: seg.ayah,
        });
    }
    out.push({ kind: 'text', key: `t${li}`, slots });
  });
  return { placedAyahs: placed, basmalaSplit: split, renderLines: out };
}

/**
 * Phase 3 (hifz redesign): build the SAME RenderLine[] shape from a
 * V2 mushaf page instead of the old exact lines. Word indices are
 * the provider's (Tanzil) indices and every word carries its V2
 * layout id (qulId) plus its pause sign, so Phase 4 can address any
 * word on the page by key. Returns null when the V2 page cannot be
 * built from the loaded surah texts — the caller falls back to
 * buildPageRender on the old lines for the same page, never a
 * half-mixed page. An ayah is "placed" when its words appear on this
 * page; ayahs never span pages, and ayah 1's first four words live
 * on the Basmalah line when split, so presence implies completeness.
 */
export function buildV2PageRender(
  data: V2MushafMeta,
  v2Page: V2Page,
  surah: number,
  textsBySurah: Record<number, Record<number, string> | undefined>,
  wallAyahs: { ayah: number; words: WallWord[] }[],
  glyphs?: ReadonlyMap<number, string> | null,
  // Optional per-page V4 map ("surah:ayah:word" -> glyph string).
  // Unlike `glyphs` (which REPLACES word.text via expandV2Page),
  // this only fills slot.glyph on every word slot — slot.text stays
  // Tanzil text, and the renderer chooses per word whether the
  // glyph may paint (shouldUseV4Glyph). A null/undefined map leaves
  // every slot without a glyph, i.e. the whole page renders text.
  v4Glyphs?: ReadonlyMap<string, string> | null,
): { placedAyahs: Set<number>; basmalaSplit: boolean; renderLines: RenderLine[] } | null {
  const writtenByKey = new Map<string, WallWord>();
  for (const group of wallAyahs) {
    for (const w of group.words) writtenByKey.set(`${group.ayah}:${w.index}`, w);
  }
  // The strict expansion verifies the provider token sequence
  // against the V2 layout; any mismatch returns null and the caller
  // falls back to the old lines. The optional glyph map switches
  // the word text to the QPC V2 glyph strings for this page (see
  // expandV2Page); when it is absent the words stay Tanzil text.
  const tokens = new Map<string, readonly string[]>();
  for (const ref of v2PageAyahs(v2Page)) {
    const [s, a] = ref.split(':').map(Number);
    const texts = textsBySurah[s];
    if (!texts) return null;
    const words = (texts[a] ?? '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    tokens.set(ref, words);
  }
  // V4 key mapping (corrected 2026-11-08 — NOT `${s}:${a}:${index+1}`):
  // a slot's V4 word number is its ordinal among the ayah's REAL
  // words (v4RealWordNumbers: pause signs, the sajda mark and the
  // Basmalah prefix are not V4 words), computed once per ayah from
  // the token lists above. Proven by a global id-alignment check
  // (all 77,433 V2 slots: V4 entry id == slot QUL id, 0 mismatches).
  const v4WordNoByAyah = new Map<string, ReadonlyMap<number, number>>();
  for (const [ref, toks] of tokens) {
    const [s, a] = ref.split(':').map(Number);
    v4WordNoByAyah.set(ref, v4RealWordNumbers(s, a, toks));
  }
  // One slot's V4 glyph string, or undefined when the word has none:
  // Basmalah-prefix tokens are not V4 words, the 37:130 pair is
  // merged (see V4_MERGED_PAIR_SLOT_KEYS), and a key missing from
  // the page map falls back to text per word — never a rosette.
  const v4GlyphForWord = (surah: number, ayah: number, index: number): string | undefined => {
    if (V4_MERGED_PAIR_SLOT_KEYS.has(`${surah}:${ayah}:${index}`)) return undefined;
    const wordNo = v4WordNoByAyah.get(`${surah}:${ayah}`)?.get(index);
    if (wordNo === undefined) return undefined;
    return v4Glyphs?.get(v4WordKey(surah, ayah, wordNo));
  };
  // Wave 2 (2026-11-09): the ayah-end marker's V4 glyph — the
  // LAST entry of the ayah's V4 list (key realWordCount+1), whose
  // COLR layers draw the ayah number (advance 16.06px at 16px vs
  // the SVG rosette's 28.8px — this is what fixes p584 line 2).
  // Undefined when the ayah is not in the page's token map or the
  // key is missing from the V4 map: the renderer then falls back
  // to the SVG rosette, never a wrong glyph. A key above the real
  // word count can only ever be the marker, so a lookup here can
  // never return a real word's glyph. The one V4 merge in the
  // Quran (37:130: two tokens share entry :3) makes the
  // token-counted ordinal overshoot by one, so the count is
  // corrected for that ayah (marker key :4, not :5).
  const v4GlyphForMarker = (surah: number, ayah: number): string | undefined => {
    const wordNos = v4WordNoByAyah.get(`${surah}:${ayah}`);
    if (wordNos === undefined) return undefined;
    let realWordCount = 0;
    for (const n of wordNos.values()) realWordCount = Math.max(realWordCount, n);
    if (realWordCount === 0) return undefined;
    if (V4_MERGED_PAIR_SLOT_KEYS.has(`${surah}:${ayah}:2`)) realWordCount -= 1;
    return v4Glyphs?.get(v4WordKey(surah, ayah, realWordCount + 1));
  };
  const expansion = expandV2Page(data, v2Page, tokens, glyphs);
  if (!expansion.ok) return null;
  const placed = new Set<number>();
  for (const line of expansion.lines) {
    if (line.kind !== 'text') continue;
    for (const word of line.words) {
      if (word.surah === surah) placed.add(word.ayah);
    }
  }
  // The Basmalah split: the Basmalah line is followed by a text line
  // starting this surah's ayah 1 (surahs 1 and 9 never split).
  const split = expansion.lines.some((line, li) => {
    if (line.kind !== 'basmala' || surah === 1 || surah === 9) return false;
    const next = expansion.lines[li + 1];
    if (!next || next.kind !== 'text' || next.words.length === 0) return false;
    const first = next.words[0];
    return first.surah === surah && first.ayah === 1;
  });
  const out: RenderLine[] = [];
  expansion.lines.forEach((line, li) => {
    if (line.kind === 'header') {
      out.push({ kind: 'header', key: `h${li}`, text: line.name, surah: line.surah });
      return;
    }
    if (line.kind === 'basmala') {
      const slots: LineWordSlot[] = [];
      // The Basmalah line belongs to the surah whose ayah 1 follows
      // it — usually the study surah, but a page can carry the next
      // surah's Basmalah too (Al-Kahf on p293 while studying
      // Al-Isra). The old code only filled the study surah's
      // Basmalah, so the next surah's line rendered as an empty
      // `&nbsp;` row. Fill it from that surah's texts when loaded
      // (neighbour texts load with the V2 page); display-only —
      // visible plain text, the wall never holds another surah's
      // words.
      const next = expansion.lines[li + 1];
      const first = next?.kind === 'text' ? next.words[0] : undefined;
      if (first && first.ayah === 1 && first.surah !== 1 && first.surah !== 9) {
        if (first.surah === surah) {
          if (split && placed.has(1)) {
            const study = textsBySurah[surah]?.[1]?.split(/\s+/).filter(Boolean) ?? [];
            study.slice(0, 4).forEach((text, i) => {
              const written = writtenByKey.get(`1:${i}`) ?? null;
              // No glyph: Basmalah-prefix words are NOT in the V4
              // data (its ayah-1 list starts at the first real word),
              // so the Basmalah line stays Tanzil text. Do NOT look
              // these up as 18:1:1-4 — those keys are the first real
              // words after the Basmalah.
              slots.push({
                kind: 'word',
                surah,
                ayah: 1,
                index: i,
                text,
                written,
                hidden: written === null,
              });
            });
          }
        } else {
          const other = textsBySurah[first.surah]?.[1]?.split(/\s+/).filter(Boolean).slice(0, 4) ?? [];
          other.forEach((text, i) => {
            // Same: the next surah's Basmalah has no V4 glyphs either.
            // Display-only (visible plain text), like the tail words.
            slots.push({
              kind: 'word',
              surah: first.surah,
              ayah: 1,
              index: i,
              text,
              written: null,
              hidden: false,
              displayOnly: true,
            });
          });
        }
      }
      out.push({ kind: 'basmala', key: `b${li}`, slots });
      return;
    }
    const slots: LineSlot[] = [];
    if (line.leadAyah !== null) {
      // The leading marker ends the ayah that ran over from the
      // previous page; its surah comes from the V2 expansion
      // (leadSurah), falling back to the line's first word (same
      // surah — a text line never mixes surahs) and then the study
      // surah. A failed lookup leaves glyph undefined and the
      // renderer falls back to the SVG rosette.
      const leadSurah = line.leadSurah ?? line.words[0]?.surah ?? surah;
      slots.push({
        kind: 'marker',
        text: toArabicIndic(line.leadAyah),
        surah: leadSurah,
        ayah: line.leadAyah,
        glyph: v4GlyphForMarker(leadSurah, line.leadAyah),
      });
    }
    for (const word of line.words) {
      if (word.rubBefore) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
      // The wall only ever holds the STUDY surah's words: a word of
      // another surah with the same ayah number must never match it.
      // Such words are DISPLAY-ONLY: visible in plain mushaf ink
      // (the tail lines of the previous surah on this page), never
      // hidden spacers — no wall status, no grading, not tappable
      // for practice. Markers are untouched.
      const written =
        word.surah === surah ? (writtenByKey.get(`${word.ayah}:${word.index}`) ?? null) : null;
      const displayOnly = word.surah !== surah;
      const hidden = !displayOnly && written === null;
      slots.push({
        kind: 'word',
        surah: word.surah,
        ayah: word.ayah,
        index: word.index,
        text: word.text,
        written,
        hidden,
        ...(displayOnly ? { displayOnly: true as const } : {}),
        qulId: word.qulId,
        pauseAfter: word.pauseAfter,
        glyph: v4GlyphForWord(word.surah, word.ayah, word.index),
      });
      if (word.sajdaAfter) slots.push({ kind: 'ornament', text: '۩' });
      if (word.endsAyah)
        slots.push({
          kind: 'marker',
          text: toArabicIndic(word.ayah),
          surah: word.surah,
          ayah: word.ayah,
          glyph: v4GlyphForMarker(word.surah, word.ayah),
        });
    }
    out.push({ kind: 'text', key: `t${li}`, slots });
  });
  return { placedAyahs: placed, basmalaSplit: split, renderLines: out };
}
