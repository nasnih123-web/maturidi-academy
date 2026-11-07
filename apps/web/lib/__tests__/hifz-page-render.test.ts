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
import type { V2MushafData } from '../quran-mushaf-v2';
import type { WallWord } from '../hifz-study-types';

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
});
