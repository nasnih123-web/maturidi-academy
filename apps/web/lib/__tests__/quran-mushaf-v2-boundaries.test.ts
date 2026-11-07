/**
 * Tests for the V2 reader navigation (hifz completion, section 4,
 * item 5): page starts derived from the QPC V2 layout, juz/hizb
 * starts reused from QPC1, and the 56-ayah QPC1/V2 page difference.
 *
 * Data files are read from the repo (paths relative to the repo
 * root, overridable with QURAN_MUSHAF_V2_JSON / QURAN_BOUNDARIES_JSON);
 * if a file is missing the data tests skip instead of failing — same
 * pattern as quran-mushaf-v2.test.ts. The pure builder is also tested
 * against small synthetic V2 data, so the merge logic itself does
 * not depend on the data files.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildV2Boundaries,
  v2PageStarts,
} from '../quran-mushaf-v2-boundaries';
import type { V2MushafData } from '../quran-mushaf-v2';
import {
  rangeContaining,
  type QuranBoundaries,
} from '../quran-view-modes';

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

function loadReal(): { v2: V2MushafData; qpc1: QuranBoundaries } | null {
  const v2Raw = readFirst('QURAN_MUSHAF_V2_JSON', [
    'apps/web/public/quran-mushaf-v2.json',
    'public/quran-mushaf-v2.json',
  ]);
  const qpc1Raw = readFirst('QURAN_BOUNDARIES_JSON', [
    'apps/web/lib/quran-boundaries.json',
    'lib/quran-boundaries.json',
  ]);
  if (!v2Raw || !qpc1Raw) return null;
  return {
    v2: JSON.parse(v2Raw) as V2MushafData,
    qpc1: JSON.parse(qpc1Raw) as QuranBoundaries,
  };
}

/** Max ayah per surah, from the V2 segments (total must be 6236). */
function surahAyahCounts(v2: V2MushafData): number[] {
  const max: Record<number, number> = {};
  for (const page of v2.pages) {
    for (const line of page.lines) {
      if (line.t !== 'x') continue;
      for (const seg of line.seg) max[seg.s] = Math.max(max[seg.s] ?? 0, seg.a);
    }
  }
  return Array.from({ length: 114 }, (_, i) => max[i + 1] ?? 0);
}

describe('v2PageStarts (real V2 layout)', () => {
  it('has 604 strictly increasing starts, first 1:1, last 112:1', () => {
    const real = loadReal();
    if (!real) {
      console.log('SKIP: V2 data not found');
      return;
    }
    const starts = v2PageStarts(real.v2.pages);
    assert.equal(starts.length, 604);
    assert.deepEqual(
      [starts[0].surah, starts[0].ayah],
      [1, 1],
    );
    assert.deepEqual(
      [starts[603].surah, starts[603].ayah],
      [112, 1],
    );
    const counts = surahAyahCounts(real.v2);
    assert.equal(counts.reduce((a, b) => a + b, 0), 6236);
    const order = new Map<string, number>();
    let g = 0;
    for (let s = 1; s <= 114; s += 1) {
      for (let a = 1; a <= counts[s - 1]; a += 1) order.set(`${s}:${a}`, (g += 1));
    }
    for (let i = 0; i < 603; i += 1) {
      const cur = order.get(`${starts[i].surah}:${starts[i].ayah}`) ?? -1;
      const nxt = order.get(`${starts[i + 1].surah}:${starts[i + 1].ayah}`) ?? -1;
      assert.ok(cur > 0 && nxt > cur, `page ${i + 1} -> ${i + 2} not increasing`);
    }
  });

  it('throws when a page has no text line (synthetic)', () => {
    const bad = {
      version: 1,
      source: 'test',
      pages: [{ n: 1, juz: 1, hizb: 1, lines: [{ t: 'b' }] }],
      rubAyahs: [],
      sajdaWords: [],
    } as unknown as V2MushafData;
    assert.throws(() => v2PageStarts(bad.pages), /no text line/);
  });
});

describe('buildV2Boundaries (real data)', () => {
  it('keeps the QPC1 juz/hizb starts verbatim (layout-independent)', () => {
    const real = loadReal();
    if (!real) {
      console.log('SKIP: V2 data not found');
      return;
    }
    const merged = buildV2Boundaries(real.v2, real.qpc1);
    assert.deepEqual(merged.juz, real.qpc1.juz);
    assert.deepEqual(merged.hizb, real.qpc1.hizb);
    assert.equal(merged.juz.length, 30);
    assert.equal(merged.hizb.length, 120);
    assert.equal(merged.page.length, 604);
    // Every juz/hizb start sits on a V2 page whose own juz/hizb
    // field equals the start number (0 mismatches — the reuse proof).
    for (const e of real.qpc1.juz) {
      const p = rangeContaining(merged, e.surah, e.ayah).page;
      assert.ok(p !== null, `juz ${e.n} start has no V2 page`);
      assert.equal(real.v2.pages[p - 1].juz, e.n, `juz ${e.n} start page juz`);
    }
    for (const e of real.qpc1.hizb) {
      const p = rangeContaining(merged, e.surah, e.ayah).page;
      assert.ok(p !== null, `hizb ${e.n} start has no V2 page`);
      assert.equal(real.v2.pages[p - 1].hizb, e.n, `hizb ${e.n} start page hizb`);
    }
  });

  it('puts 5:77 on V2 page 120 (not QPC1 121) and the neighbours right', () => {
    const real = loadReal();
    if (!real) {
      console.log('SKIP: V2 data not found');
      return;
    }
    const merged = buildV2Boundaries(real.v2, real.qpc1);
    assert.equal(rangeContaining(merged, 5, 77).page, 120);
    assert.equal(rangeContaining(real.qpc1, 5, 77).page, 121);
    // Page 120 starts at 5:71 in BOTH editions — the shift is at
    // its end (V2 holds 5:71–77, QPC1 only 5:71–76), so the next
    // page starts differ: V2 page 121 starts 5:78, QPC1 5:77.
    assert.equal(rangeContaining(merged, 5, 71).page, 120);
    assert.equal(rangeContaining(real.qpc1, 5, 71).page, 120);
    assert.equal(rangeContaining(merged, 5, 78).page, 121);
    assert.equal(rangeContaining(real.qpc1, 5, 78).page, 121);
    assert.equal(rangeContaining(merged, 5, 83).page, 121);
    assert.equal(rangeContaining(merged, 6, 131).page, 145);
    assert.equal(rangeContaining(merged, 55, 17).page, 531);
  });

  it('differs from QPC1 on exactly 56 ayahs (the phase-3 count)', () => {
    const real = loadReal();
    if (!real) {
      console.log('SKIP: V2 data not found');
      return;
    }
    const merged = buildV2Boundaries(real.v2, real.qpc1);
    const counts = surahAyahCounts(real.v2);
    let diff = 0;
    for (let s = 1; s <= 114; s += 1) {
      for (let a = 1; a <= counts[s - 1]; a += 1) {
        if (rangeContaining(merged, s, a).page !== rangeContaining(real.qpc1, s, a).page) {
          diff += 1;
        }
      }
    }
    assert.equal(diff, 56);
  });

  it('reuses QPC1 preview text where the ayah matches, empty otherwise', () => {
    const real = loadReal();
    if (!real) {
      console.log('SKIP: V2 data not found');
      return;
    }
    const merged = buildV2Boundaries(real.v2, real.qpc1);
    const qpc1Text = new Map<string, string>();
    for (const kind of ['juz', 'hizb', 'page'] as const) {
      for (const e of real.qpc1[kind]) qpc1Text.set(`${e.surah}:${e.ayah}`, e.text);
    }
    let empty = 0;
    for (const s of merged.page) {
      const expected = qpc1Text.get(`${s.surah}:${s.ayah}`);
      if (expected === undefined) {
        assert.equal(s.text, '');
        empty += 1;
      } else {
        assert.equal(s.text, expected);
      }
    }
    // 25 V2 page starts are new ayahs (no QPC1 preview text).
    assert.equal(empty, 25);
  });
});
