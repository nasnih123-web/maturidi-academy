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
  type V2MushafData,
  type V2Page,
} from './quran-mushaf-v2';
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
 * other segment uses its printed tokens as hidden spacers, so marker
 * positions stay true. For a surah with a Basmalah line on this
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
            hidden: true,
          });
        });
        for (const off of seg.ornaments) {
          if (off === seg.words.length) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
        }
      }
      if (seg.marker !== null) slots.push({ kind: 'marker', text: seg.marker });
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
  data: V2MushafData,
  v2Page: V2Page,
  surah: number,
  textsBySurah: Record<number, Record<number, string> | undefined>,
  wallAyahs: { ayah: number; words: WallWord[] }[],
  glyphs?: ReadonlyMap<number, string> | null,
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
      if (split && placed.has(1)) {
        const study = textsBySurah[surah]?.[1]?.split(/\s+/).filter(Boolean) ?? [];
        study.slice(0, 4).forEach((text, i) => {
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
    const slots: LineSlot[] = [];
    if (line.leadAyah !== null) {
      slots.push({ kind: 'marker', text: toArabicIndic(line.leadAyah) });
    }
    for (const word of line.words) {
      if (word.rubBefore) slots.push({ kind: 'ornament', text: RUB_EL_HIZB });
      // The wall only ever holds the STUDY surah's words: a word of
      // another surah with the same ayah number must never match it.
      const written =
        word.surah === surah ? (writtenByKey.get(`${word.ayah}:${word.index}`) ?? null) : null;
      const hidden = word.surah === surah ? written === null : true;
      slots.push({
        kind: 'word',
        surah: word.surah,
        ayah: word.ayah,
        index: word.index,
        text: word.text,
        written,
        hidden,
        qulId: word.qulId,
        pauseAfter: word.pauseAfter,
      });
      if (word.sajdaAfter) slots.push({ kind: 'ornament', text: '۩' });
      if (word.endsAyah) slots.push({ kind: 'marker', text: toArabicIndic(word.ayah) });
    }
    out.push({ kind: 'text', key: `t${li}`, slots });
  });
  return { placedAyahs: placed, basmalaSplit: split, renderLines: out };
}
