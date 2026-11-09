/**
 * Tests for the QPC V4 Tajweed glyphs (lib/quran-mushaf-v4.ts): the
 * per-page loader, the "surah:ayah:word" key rule, and the per-word
 * glyph-vs-text rule (investigation brief §5). The split output
 * itself (scripts/split-quran-mushaf-v4-glyphs.py) is checked against
 * the real p293 file when it exists; tests skip instead of failing
 * when a data file is missing, same pattern as
 * quran-mushaf-v2.test.ts / hifz-page-render.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  loadV4PageGlyphs,
  shouldUseV4Glyph,
  v4PageGlyphsUrl,
  v4RealWordNumbers,
  v4WordKey,
} from '../quran-mushaf-v4';

/** First existing candidate wins (repo root or apps/web cwd). */
function readFirst(candidates: string[]): string | null {
  for (const rel of candidates) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

describe('v4PageGlyphsUrl / v4WordKey', () => {
  it('page files are p<page>.json, not zero-padded', () => {
    assert.equal(v4PageGlyphsUrl(1), '/quran-mushaf-v4-glyphs/p1.json');
    assert.equal(v4PageGlyphsUrl(293), '/quran-mushaf-v4-glyphs/p293.json');
    assert.equal(v4PageGlyphsUrl(604), '/quran-mushaf-v4-glyphs/p604.json');
  });

  it('the key is "surah:ayah:word" with word the 1-based real-word ordinal', () => {
    assert.equal(v4WordKey(17, 105, 1), '17:105:1');
    assert.equal(v4WordKey(18, 1, 12), '18:1:12');
    assert.equal(v4WordKey(1, 1, 1), '1:1:1');
  });
});

describe('v4RealWordNumbers (the corrected key mapping)', () => {
  it('plain ayahs: token index + 1, no shifts', () => {
    // 2:3 has 8 tokens, no pauses, not ayah 1.
    const toks = ['ٱلَّذِينَ', 'يُؤْمِنُونَ', 'بِٱلْغَيْبِ', 'وَيُقِيمُونَ', 'ٱلصَّلَوٰةَ', 'وَمِمَّا', 'رَزَقْنَـٰهُمْ', 'يُنفِقُونَ'];
    const m = v4RealWordNumbers(2, 3, toks);
    assert.equal(m.size, 8);
    toks.forEach((_, i) => assert.equal(m.get(i), i + 1));
  });

  it('pause signs are not words: words after a pause keep their ordinal', () => {
    // 17:105 tokens: 4 real words, pause ۗ, then 5 real words.
    const toks = ['وَبِٱلْحَقِّ', 'أَنزَلْنَـٰهُ', 'وَبِٱلْحَقِّ', 'نَزَلَ', 'ۗ', 'وَمَآ', 'أَرْسَلْنَـٰكَ', 'إِلَّا', 'مُبَشِّرًا', 'وَنَذِيرًا'];
    const m = v4RealWordNumbers(17, 105, toks);
    assert.equal(m.size, 9);
    assert.equal(m.get(4), undefined);
    assert.equal(m.get(5), 5);
    assert.equal(m.get(9), 9);
  });

  it('the Basmalah prefix of ayah 1 (surahs 2-114) is not in the V4 data', () => {
    // 18:1 tokens: 4 Basmalah + 11 real words + pause ۜ.
    const toks = ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ', 'ٱلرَّحِيمِ', 'ٱلْحَمْدُ', 'لِلَّهِ', 'ٱلَّذِىٓ', 'أَنزَلَ', 'عَلَىٰ', 'عَبْدِهِ', 'ٱلْكِتَـٰبَ', 'وَلَمْ', 'يَجْعَل', 'لَّهُۥ', 'عِوَجَا', 'ۜ'];
    const m = v4RealWordNumbers(18, 1, toks);
    assert.equal(m.size, 11);
    for (let i = 0; i < 4; i += 1) assert.equal(m.get(i), undefined);
    assert.equal(m.get(4), 1);
    assert.equal(m.get(14), 11);
    assert.equal(m.get(15), undefined);
  });

  it('surah 1 ayah 1 (Basmalah IS the ayah) and surah 9 ayah 1 count every token', () => {
    const fatiha = ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ', 'ٱلرَّحِيمِ'];
    const m1 = v4RealWordNumbers(1, 1, fatiha);
    assert.equal(m1.size, 4);
    assert.equal(m1.get(0), 1);
    assert.equal(m1.get(3), 4);
    const tawba = ['بَرَآءَةٌ', 'مِّنَ', 'ٱللَّهِ', 'وَرَسُولِهِۦٓ'];
    const m9 = v4RealWordNumbers(9, 1, tawba);
    assert.equal(m9.size, 4);
    assert.equal(m9.get(0), 1);
  });
});

describe('shouldUseV4Glyph (brief §5 rule)', () => {
  const plain = { concealed: false, newestLive: false, status: null, listenNow: false } as const;

  it('plain words with a glyph render as glyphs', () => {
    assert.equal(shouldUseV4Glyph('G', plain), true);
  });

  it('a missing glyph is always text', () => {
    assert.equal(shouldUseV4Glyph(undefined, plain), false);
  });

  it('concealed words are text (color:transparent cannot hide COLR)', () => {
    assert.equal(shouldUseV4Glyph('G', { ...plain, concealed: true }), false);
  });

  it('the newest live word is text (its grade IS the ink colour)', () => {
    assert.equal(shouldUseV4Glyph('G', { ...plain, newestLive: true }), false);
  });

  it('the listen-now word is text', () => {
    assert.equal(shouldUseV4Glyph('G', { ...plain, listenNow: true }), false);
  });

  it('wrong / close / skipped grades are text', () => {
    for (const status of ['wrong', 'close', 'skipped'] as const) {
      assert.equal(shouldUseV4Glyph('G', { ...plain, status }), false, status);
    }
  });

  it('peeked words keep their glyph (user directive 2026-11-09: pages and font first, like the reference shots)', () => {
    // The faint beige tint marks a peeked word (no outline — user
    // directive 2026-11-09 ~19:28); the glyph keeps its
    // tajweed colours — the grade colour must NOT win here.
    assert.equal(shouldUseV4Glyph('G', { ...plain, status: 'peeked' }), true);
  });

  it('correct and older-live words keep their glyph', () => {
    // Older live words carry status 'correct' with live=true; the
    // rule only excludes the newest live word, not live words.
    assert.equal(shouldUseV4Glyph('G', { ...plain, status: 'correct' }), true);
  });
});

describe('loadV4PageGlyphs (stubbed fetch)', () => {
  it('a served file becomes a "surah:ayah:word" map; a 404 becomes null', async () => {
    const origFetch = globalThis.fetch;
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/quran-mushaf-v4-glyphs/p293.json')) {
          return {
            ok: true,
            json: async () => ({ '17:105:1': 'GLYPH-A', '18:1:1': 'GLYPH-B' }),
          };
        }
        return { ok: false, json: async () => null };
      };
      const map = await loadV4PageGlyphs(293);
      assert.ok(map);
      assert.equal(map.get('17:105:1'), 'GLYPH-A');
      assert.equal(map.get('18:1:1'), 'GLYPH-B');
      assert.equal(map.get('17:105:2'), undefined);
      assert.equal(await loadV4PageGlyphs(294), null);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  });
});

describe('split output: p293 file on disk', () => {
  it('p293 holds 138 entries incl. the Basmalah words, all non-empty', (t) => {
    const raw = readFirst([
      'apps/web/public/quran-mushaf-v4-glyphs/p293.json',
      'public/quran-mushaf-v4-glyphs/p293.json',
    ]);
    if (!raw) {
      t.skip('quran-mushaf-v4-glyphs/p293.json در دسترس نیست');
      return;
    }
    const entries = JSON.parse(raw) as Record<string, string>;
    assert.equal(Object.keys(entries).length, 138);
    // 18:1:1 is the first REAL word after the Basmalah (الْحَمْدُ);
    // the Basmalah prefix has no V4 entries.
    for (const key of ['17:105:1', '17:105:10', '17:111:1', '18:1:1', '18:1:4', '18:1:12']) {
      assert.ok(typeof entries[key] === 'string' && entries[key].length > 0, key);
    }
    assert.ok(Object.values(entries).every((v) => typeof v === 'string' && v.length > 0));
  });
});
