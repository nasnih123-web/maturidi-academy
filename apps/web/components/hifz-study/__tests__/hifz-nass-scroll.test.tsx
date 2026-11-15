/**
 * Locking tests for the nass scroll (user 2026-11-16): nass renders
 * the surah as scrolling mushaf pages (coloured V4 glyphs, Basmalah
 * as the SVG glyph, full page frames) instead of plain Tanzil text,
 * and the per-page V4 loads retry instead of sticking on failure.
 *
 * Source-level locks (same pattern as hifz-eye-toggle.test.tsx):
 * the component is stateful and data-driven, so the rendering itself
 * is proven by the Playwright harness shots, not here. These tests
 * lock the wiring that the harness cannot cheaply re-derive: which
 * branch renders the scroll, which branch keeps the plain-text
 * fallback, that each scroll section loads its own page's assets
 * and paints in its own font family, and that failed loads evict
 * their cache entries instead of sticking.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relatives: string[]): string {
  for (const rel of relatives) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`none of ${relatives.join(', ')} found`);
}

function readStudy(): string {
  return read([
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]);
}

function readScroll(): string {
  return read([
    'apps/web/components/hifz-study/HifzNassScroll.tsx',
    'components/hifz-study/HifzNassScroll.tsx',
  ]);
}

function readLib(name: string): string {
  return read([`apps/web/lib/${name}`, `lib/${name}`]);
}

describe('nass scroll wiring (QuranHifzStudy nass branch)', () => {
  it('renders HifzNassScroll when V2 is available, plain-text nass only as the fallback', () => {
    const src = readStudy();
    assert.match(src, /<HifzNassScroll/);
    assert.match(src, /firstPage=\{nassRange\.firstPage\}/);
    assert.match(src, /lastPage=\{nassRange\.lastPage\}/);
    // The old plain-text nass stays as the honest fallback branch.
    assert.match(src, /<div className="hifz-nass" dir="rtl" aria-label=\{labels\.displayNass\}>/);
    // While the V2 index loads the view waits instead of flashing text.
    assert.match(src, /v2Index === undefined \? \(\s*<p className="hifz-line-loading">/);
  });

  it('the scroll range comes from the V2 index', () => {
    const src = readStudy();
    assert.match(src, /v2SurahPageRange\(v2Index, surah, ayahCount\)/);
  });
});

describe('nass scroll sections (HifzNassScroll)', () => {
  it('one section per page in the range, each loading its own page assets', () => {
    const src = readScroll();
    assert.match(src, /for \(let p = startPage; p <= lastPage; p \+= 1\) out\.push\(p\)/);
    assert.match(src, /loadV2Page\(page\)/);
    assert.match(src, /loadV4PageGlyphs\(page\)/);
    assert.match(src, /ensureMushafFontFor\(qcfV4Provider, page\)/);
    assert.match(src, /IntersectionObserver/);
  });

  it('each section paints in its own page family, never the active page family', () => {
    const src = readScroll();
    assert.match(src, /qcfV4Provider\.familyForPage\(page\)\?\.family/);
    assert.match(src, /renderPageSection\(page - 1, render\.renderLines, `nass-scroll-p\$\{page\}`, \{\s*loaded: fontLoaded,\s*family: fontFamily,\s*\}\)/);
  });

  it('the header page is prepended when the ayah-1 page carries no header (spill surahs)', () => {
    const src = readScroll();
    assert.match(src, /chunk\.lines\.some\(\(line\) => line\.t === 'h' && line\.s === surah\)/);
    assert.match(src, /setStartPage\(hasHeader \|\| firstPage === 0 \? firstPage : firstPage - 1\)/);
  });

  it('a failed glyph map or font is retried while the section is on screen', () => {
    const src = readScroll();
    assert.match(src, /retryCountRef\.current < MAX_ASSET_RETRIES/);
    assert.match(src, /setRetryTick\(\(t\) => t \+ 1\)/);
  });
});

describe('flip-mode retry wiring (QuranHifzStudy V4 load effect)', () => {
  it('retries a failed glyph map or font while the page is active and preloads the next page', () => {
    const src = readStudy();
    assert.match(src, /v4RetryCountsRef\.current\.get\(page\) \?\? 0\) < 3/);
    assert.match(src, /setV4RetryTick\(\(t\) => t \+ 1\)/);
    assert.match(src, /loadV4PageGlyphs\(page \+ 1\)/);
    assert.match(src, /ensureMushafFontFor\(qcfV4Provider, page \+ 1\)/);
  });
});

describe('loader retry locks (a failed load must not stick)', () => {
  it('the font loader evicts the cached promise when the race resolves false', () => {
    const src = readLib('quran-mushaf-font.ts');
    assert.match(src, /if \(!ok\) cache\.delete\(source\.family\)/);
  });

  it('the glyph-map loader evicts the cached promise when the result is null', () => {
    const src = readLib('quran-mushaf-v4.ts');
    assert.match(src, /if \(result === null\) glyphPromises\.delete\(page\)/);
  });
});
