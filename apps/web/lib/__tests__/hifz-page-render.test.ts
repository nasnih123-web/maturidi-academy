/**
 * Tests for the pure page-render builders (lib/hifz-page-render.ts,
 * hifz-completion refactor step 4): moved verbatim from
 * QuranHifzStudy.tsx. Real data (QPC1 lines, QPC V2 layout, Tanzil
 * text); tests skip instead of failing when a data file is missing,
 * same pattern as quran-print-lines.test.ts / quran-mushaf-v2.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  basmalaSurahsOnPage,
  buildPageRender,
  buildV2PageRender,
  pageIndexFor,
} from '../hifz-page-render';
import type { MushafExactLine } from '../quran-mushaf-lines';
import type { V2MushafData, V2MushafIndex } from '../quran-mushaf-v2';
import type { WallWord, RenderLine } from '../hifz-study-types';

/** First existing candidate wins (repo root or apps/web cwd). */
function readFirst(envName: string, candidates: string[]): string | null {
  const env = process.env[envName];
  if (env) {
    try {
      return readFileSync(env, 'utf8');
    } catch {
      return null;
    }
  }
  for (const rel of candidates) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function loadLines(): MushafExactLine[][] | null {
  const raw = readFirst('QURAN_PRINT_LINES_JSON', [
    'apps/web/lib/quran-mushaf-lines.json',
    'lib/quran-mushaf-lines.json',
  ]);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { pages: MushafExactLine[][] }).pages;
  } catch {
    return null;
  }
}

function loadV2(): V2MushafData | null {
  const raw = readFirst('QURAN_MUSHAF_V2_JSON', [
    'apps/web/public/quran-mushaf-v2.json',
    'public/quran-mushaf-v2.json',
  ]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as V2MushafData;
  } catch {
    return null;
  }
}

/** Tanzil Uthmani text as surah -> ayah -> text. */
function loadTexts(): Record<number, Record<number, string>> | null {
  const raw = readFirst('TANZIL_TEXT', [
    'apps/api/app/modules/quran/data/tanzil_uthmani.txt',
    '../api/app/modules/quran/data/tanzil_uthmani.txt',
  ]);
  if (!raw) return null;
  const out: Record<number, Record<number, string>> = {};
  for (const line of raw.split('\n')) {
    const [s, a, text] = line.split('|');
    if (!s || !a || !text) continue;
    const sn = Number(s);
    const an = Number(a);
    (out[sn] ??= {})[an] = text;
  }
  return out;
}

function wordSlots(renderLines: ReturnType<typeof buildPageRender>['renderLines']) {
  const words: { surah: number; ayah: number; index: number; text: string; hidden: boolean; qulId?: number }[] = [];
  const markers: string[] = [];
  for (const line of renderLines) {
    if (line.kind !== 'text') continue;
    for (const slot of line.slots) {
      if (slot.kind === 'word') words.push(slot);
      if (slot.kind === 'marker') markers.push(slot.text);
    }
  }
  return { words, markers };
}

function writtenWord(ayah: number, index: number, text: string): WallWord {
  return {
    ayah,
    index,
    text,
    status: 'correct',
    prob: 0.99,
    heard: text,
    scoreId: 'test-score',
    disputed: false,
    live: false,
  };
}

describe('pageIndexFor / basmalaSurahsOnPage (QPC1 lines)', () => {
  it('page 1 covers Fatiha ayah 1; page 2 covers Baqarah ayah 1', (t) => {
    const pages = loadLines();
    if (!pages) {
      t.skip('quran-mushaf-lines.json در دسترس نیست');
      return;
    }
    assert.equal(pageIndexFor(pages, 1, 1), 0);
    assert.equal(pageIndexFor(pages, 1, 7), 0);
    assert.equal(pageIndexFor(pages, 2, 1), 1);
    assert.equal(pageIndexFor(pages, 2, 2), 1);
    assert.equal(pageIndexFor(pages, 1, 8), null);
  });

  it('page 2 has a Basmalah line for surah 2; page 1 has none', (t) => {
    const pages = loadLines();
    if (!pages) {
      t.skip('quran-mushaf-lines.json در دسترس نیست');
      return;
    }
    assert.ok(basmalaSurahsOnPage(pages[1]).has(2));
    assert.equal(basmalaSurahsOnPage(pages[0]).size, 0);
  });
});

describe('buildPageRender (QPC1): Fatiha, printed page 1', () => {
  it('places ayahs 1..7, no Basmalah split, all words hidden until written', (t) => {
    const pages = loadLines();
    const texts = loadTexts();
    if (!pages || !texts) {
      t.skip('دادهٔ خطوط یا متن تنزیل در دسترس نیست');
      return;
    }
    const r = buildPageRender(pages[0], 1, texts[1], []);
    assert.deepEqual([...r.placedAyahs].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(r.basmalaSplit, false);
    assert.ok(r.renderLines.some((l) => l.kind === 'header'));
    const { words, markers } = wordSlots(r.renderLines);
    assert.ok(words.length > 0);
    assert.ok(words.every((w) => w.hidden && w.surah === 1));
    // One ayah-end marker per ayah, Eastern Arabic digits.
    assert.deepEqual(markers, ['١', '٢', '٣', '٤', '٥', '٦', '٧']);
  });

  it('a written wall word shows (hidden=false) while its siblings stay hidden', (t) => {
    const pages = loadLines();
    const texts = loadTexts();
    if (!pages || !texts) {
      t.skip('دادهٔ خطوط یا متن تنزیل در دسترس نیست');
      return;
    }
    const first = texts[1][1].split(/\s+/).filter(Boolean)[0];
    const r = buildPageRender(pages[0], 1, texts[1], [
      { ayah: 1, words: [writtenWord(1, 0, first)] },
    ]);
    const { words } = wordSlots(r.renderLines);
    const shown = words.filter((w) => !w.hidden);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].ayah, 1);
    assert.equal(shown[0].index, 0);
    assert.equal(shown[0].text, first);
  });

  it('no texts -> empty render (placed none, no lines)', (t) => {
    const pages = loadLines();
    if (!pages) {
      t.skip('quran-mushaf-lines.json در دسترس نیست');
      return;
    }
    const r = buildPageRender(pages[0], 1, undefined, []);
    assert.equal(r.placedAyahs.size, 0);
    assert.equal(r.renderLines.length, 0);
    assert.equal(r.basmalaSplit, false);
  });

  it('page 2 for surah 2 splits the Basmalah and still places ayahs', (t) => {
    const pages = loadLines();
    const texts = loadTexts();
    if (!pages || !texts) {
      t.skip('دادهٔ خطوط یا متن تنزیل در دسترس نیست');
      return;
    }
    const r = buildPageRender(pages[1], 2, texts[2], []);
    assert.equal(r.basmalaSplit, true);
    assert.ok(r.placedAyahs.size > 0);
  });
});

describe('buildV2PageRender (QPC V2): Fatiha, page 1', () => {
  it('places ayahs 1..7, markers in Eastern Arabic, every word has a qulId', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    if (!v2 || !texts) {
      t.skip('دادهٔ V2 یا متن تنزیل در دسترس نیست');
      return;
    }
    const r = buildV2PageRender(v2, v2.pages[0], 1, texts, []);
    assert.ok(r, 'expected a V2 render for Fatiha page 1');
    assert.deepEqual([...r.placedAyahs].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(r.basmalaSplit, false);
    const { words, markers } = wordSlots(r.renderLines);
    assert.ok(words.length > 0);
    assert.ok(words.every((w) => typeof w.qulId === 'number' && w.qulId >= 1));
    assert.deepEqual(markers, ['١', '٢', '٣', '٤', '٥', '٦', '٧']);
    assert.ok(words.every((w) => w.hidden));
  });

  it('a written wall word shows (hidden=false) on the V2 page too', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    if (!v2 || !texts) {
      t.skip('دادهٔ V2 یا متن تنزیل در دسترس نیست');
      return;
    }
    const first = texts[1][1].split(/\s+/).filter(Boolean)[0];
    const r = buildV2PageRender(v2, v2.pages[0], 1, texts, [
      { ayah: 1, words: [writtenWord(1, 0, first)] },
    ]);
    assert.ok(r);
    const { words } = wordSlots(r.renderLines);
    const shown = words.filter((w) => !w.hidden);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].ayah, 1);
    assert.equal(shown[0].index, 0);
  });

  it('missing surah texts -> null (caller falls back to QPC1 lines)', (t) => {
    const v2 = loadV2();
    if (!v2) {
      t.skip('دادهٔ V2 در دسترس نیست');
      return;
    }
    assert.equal(buildV2PageRender(v2, v2.pages[0], 1, {}, []), null);
  });

  it('page 293 while studying Al-Isra: the Al-Kahf Basmalah line has 4 slots, not empty', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    if (!v2 || !texts) {
      t.skip('دادهٔ V2 یا متن تنزیل در دسترس نیست');
      return;
    }
    // V2 pages are 0-based: pages[292] is printed page 293.
    const r = buildV2PageRender(v2, v2.pages[292], 17, texts, []);
    assert.ok(r, 'expected a V2 render for page 293');
    const basmalas = r.renderLines.filter((l) => l.kind === 'basmala');
    assert.equal(basmalas.length, 1);
    assert.equal(basmalas[0].slots.length, 4);
    assert.ok(
      basmalas[0].slots.every(
        (s) => s.kind === 'word' && s.surah === 18 && s.ayah === 1 && s.hidden,
      ),
    );
    assert.deepEqual(
      basmalas[0].slots.map((s) => (s.kind === 'word' ? s.text : '')),
      texts[18][1].split(/\s+/).filter(Boolean).slice(0, 4),
    );
  });
});

/* ------------------------------------------------------------------ */
/* V4 glyph plumbing: buildV2PageRender fills slot.glyph by the       */
/* corrected key (real-word ordinal, not token index + 1).            */
/* ------------------------------------------------------------------ */

function loadV4Page(page: number): Map<string, string> | null {
  const raw = readFirst('QURAN_MUSHAF_V4_GLYPHS_JSON', [
    `apps/web/public/quran-mushaf-v4-glyphs/p${page}.json`,
    `public/quran-mushaf-v4-glyphs/p${page}.json`,
  ]);
  if (!raw) return null;
  try {
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return null;
  }
}

function allWordSlots(renderLines: RenderLine[]) {
  const out: { surah: number; ayah: number; index: number; text: string; glyph?: string; hidden: boolean }[] = [];
  for (const line of renderLines) {
    if (line.kind === 'basmala') {
      for (const s of line.slots) out.push({ ...s, hidden: s.hidden });
      continue;
    }
    if (line.kind !== 'text') continue;
    for (const slot of line.slots) {
      if (slot.kind === 'word') out.push(slot);
    }
  }
  return out;
}

describe('buildV2PageRender with V4 glyphs (corrected key)', () => {
  it('page 293: every text-line word gets its glyph, text stays Tanzil', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(293);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    const r = buildV2PageRender(v2, v2.pages[292], 17, texts, [], undefined, v4);
    assert.ok(r, 'expected a V2 render for page 293');
    const slots = allWordSlots(r.renderLines);
    const textSlots = slots.filter((s) => !(s.surah === 18 && s.ayah === 1 && s.index < 4));
    assert.ok(textSlots.length > 0);
    // Every real word has a glyph from the page map…
    for (const s of textSlots) {
      assert.ok(typeof s.glyph === 'string' && s.glyph.length > 0, `${s.surah}:${s.ayah}:${s.index}`);
    }
    // …and slot.text is still the Tanzil token, never the PUA glyph.
    const first = textSlots.find((s) => s.surah === 17 && s.ayah === 105 && s.index === 0);
    assert.ok(first);
    assert.equal(first.text, texts[17][105].split(/\s+/).filter(Boolean)[0]);
    assert.notEqual(first.glyph, first.text);
    // A word after a pause sign maps by real-word ordinal, not
    // token index + 1: 17:105 token 5 (وَمَآ, after ۗ) is V4 word 5.
    const afterPause = textSlots.find((s) => s.surah === 17 && s.ayah === 105 && s.index === 5);
    assert.ok(afterPause);
    assert.equal(afterPause.glyph, v4.get('17:105:5'));
  });

  it('page 293: the Basmalah line has NO glyphs (it is not in the V4 data)', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(293);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    const r = buildV2PageRender(v2, v2.pages[292], 17, texts, [], undefined, v4);
    assert.ok(r, 'expected a V2 render for page 293');
    const basmala = r.renderLines.find((l) => l.kind === 'basmala');
    assert.ok(basmala && basmala.kind === 'basmala');
    assert.equal(basmala.slots.length, 4);
    assert.ok(basmala.slots.every((s) => s.glyph === undefined));
    // …while the first real word of 18:1 on the same page DOES.
    const firstReal = allWordSlots(r.renderLines).find(
      (s) => s.surah === 18 && s.ayah === 1 && s.index === 4,
    );
    assert.ok(firstReal);
    assert.equal(firstReal.glyph, v4.get('18:1:1'));
  });

  it('a partial map falls back per word; null/undefined maps give no glyphs', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(293);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    // Drop one key: only that word loses its glyph (never the page).
    const partial = new Map(v4);
    partial.delete('17:105:1');
    const r = buildV2PageRender(v2, v2.pages[292], 17, texts, [], undefined, partial);
    assert.ok(r);
    const slots = allWordSlots(r.renderLines);
    const dropped = slots.find((s) => s.surah === 17 && s.ayah === 105 && s.index === 0);
    assert.ok(dropped);
    assert.equal(dropped.glyph, undefined);
    const kept = slots.find((s) => s.surah === 17 && s.ayah === 105 && s.index === 1);
    assert.ok(kept);
    assert.equal(kept.glyph, v4.get('17:105:2'));
    for (const map of [null, undefined] as const) {
      const rn = buildV2PageRender(v2, v2.pages[292], 17, texts, [], undefined, map);
      assert.ok(rn);
      assert.ok(allWordSlots(rn.renderLines).every((s) => s.glyph === undefined));
    }
  });

  it('page 451: the 37:130 pair stays text (merged glyph + marker must not paint)', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(451);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    const r = buildV2PageRender(v2, v2.pages[450], 37, texts, [], undefined, v4);
    assert.ok(r, 'expected a V2 render for page 451');
    const slots = allWordSlots(r.renderLines);
    const first = slots.find((s) => s.surah === 37 && s.ayah === 130 && s.index === 2);
    const second = slots.find((s) => s.surah === 37 && s.ayah === 130 && s.index === 3);
    assert.ok(first && second, 'both pair slots exist');
    assert.equal(first.glyph, undefined);
    assert.equal(second.glyph, undefined);
    // Neighbours on the same page still get glyphs.
    const neighbour = slots.find((s) => s.surah === 37 && s.ayah === 130 && s.index === 0);
    assert.ok(neighbour);
    assert.ok(typeof neighbour.glyph === 'string' && neighbour.glyph.length > 0);
  });
});

/* ------------------------------------------------------------------ */
/* Round 2 §8 — buildV2PageRender takes the V2 index as its metadata. */
/* ------------------------------------------------------------------ */

function loadV2Index(): V2MushafIndex | null {
  const raw = readFirst('QURAN_MUSHAF_V2_INDEX_JSON', [
    'apps/web/public/quran-mushaf-v2-index.json',
    'public/quran-mushaf-v2-index.json',
  ]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as V2MushafIndex;
  } catch {
    return null;
  }
}

describe('buildV2PageRender with the V2 index (round 2 §8)', () => {
  it('index-as-meta renders Fatiha page 1 identically to full-data-as-meta', (t) => {
    const v2 = loadV2();
    const index = loadV2Index();
    const texts = loadTexts();
    if (!v2 || !index || !texts) {
      t.skip('دادهٔ V2 یا ایندکس یا متن تنزیل در دسترس نیست');
      return;
    }
    const fromFull = buildV2PageRender(v2, v2.pages[0], 1, texts, []);
    const fromIndex = buildV2PageRender(index, v2.pages[0], 1, texts, []);
    assert.ok(fromFull, 'full-data render');
    assert.ok(fromIndex, 'index render');
    assert.deepEqual(
      [...fromIndex.placedAyahs].sort((a, b) => a - b),
      [...fromFull.placedAyahs].sort((a, b) => a - b),
    );
    assert.equal(fromIndex.basmalaSplit, fromFull.basmalaSplit);
    assert.equal(
      JSON.stringify(fromIndex.renderLines),
      JSON.stringify(fromFull.renderLines),
    );
  });
});
