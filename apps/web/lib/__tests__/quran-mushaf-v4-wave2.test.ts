/**
 * Wave-2 Exact-Match tests (2026-11-09): the ayah-end marker as a
 * V4 glyph (research §5/§8.1.3, probe 1), the marker palette (the
 * reference shot's dark tone, research §2.2), mobile justify with
 * inline spans + real spaces (probe 2), the 16.5px honest-max size
 * (research §4/§8.5), and the caption removal. Static checks
 * (builder + CSS/component text) plus the palette rule builder.
 * Browser behaviour (marker numbers, left-edge void, line breaks,
 * fit slack) is verified by the Playwright probe, not here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildV2PageRender } from '../hifz-page-render';
import { toArabicIndic } from '../quran-print-lines';
import {
  V4_TARTEEL_PALETTE_OVERRIDES,
  v4TarteelPaletteRule,
} from '../quran-mushaf-v4';
import type { V2MushafData } from '../quran-mushaf-v2';
import type { LineMarkerSlot, RenderLine } from '../hifz-study-types';

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

function readCss(): string {
  const css = readFirst([
    'apps/web/app/[locale]/globals.css',
    'app/[locale]/globals.css',
  ]);
  assert.ok(css, 'globals.css not found');
  return css as string;
}

function readStudy(): string {
  const src = readFirst([
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]);
  assert.ok(src, 'QuranHifzStudy.tsx not found');
  return src as string;
}

function loadV2(): V2MushafData | null {
  const raw = readFirst([
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

function loadV4Page(page: number): Map<string, string> | null {
  const raw = readFirst([
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

/** Tanzil Uthmani text as surah -> ayah -> text. */
function loadTexts(): Record<number, Record<number, string>> | null {
  const raw = readFirst([
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

function markerSlots(renderLines: RenderLine[]): LineMarkerSlot[] {
  const out: LineMarkerSlot[] = [];
  for (const line of renderLines) {
    if (line.kind !== 'text') continue;
    for (const slot of line.slots) {
      if (slot.kind === 'marker') out.push(slot);
    }
  }
  return out;
}

describe('marker-as-V4-glyph (probe 1: p584 line 2)', () => {
  it('p584 markers carry surah/ayah and the V4 marker glyph (realWordCount+1)', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(584);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    const r = buildV2PageRender(v2, v2.pages[583], 79, texts, [], undefined, v4);
    assert.ok(r, 'expected a V2 render for page 584');
    const markers = markerSlots(r.renderLines);
    assert.ok(markers.length > 0, 'page 584 has markers');
    // 79:19 ends with 3 real words -> marker key 79:19:5 (U+FC52);
    // 79:20 -> 79:20:4 (U+FC56); 79:21 -> 79:21:3 (U+FC59).
    for (const [ayah, key] of [
      [19, '79:19:5'],
      [20, '79:20:4'],
      [21, '79:21:3'],
    ] as const) {
      const m = markers.find((s) => s.surah === 79 && s.ayah === ayah);
      assert.ok(m, `marker for 79:${ayah} exists`);
      assert.equal(m.text, toArabicIndic(ayah), 'marker text is the Eastern Arabic ayah number');
      assert.equal(m.glyph, v4.get(key), `79:${ayah} glyph is the V4 marker ${key}`);
      assert.ok(
        typeof m.glyph === 'string' && m.glyph.length === 1,
        'marker glyph is a single PUA char',
      );
    }
  });

  it('a missing marker key falls back per marker (glyph undefined, never a word)', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(584);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    const partial = new Map(v4);
    partial.delete('79:19:5');
    const r = buildV2PageRender(v2, v2.pages[583], 79, texts, [], undefined, partial);
    assert.ok(r);
    const markers = markerSlots(r.renderLines);
    const dropped = markers.find((s) => s.surah === 79 && s.ayah === 19);
    assert.ok(dropped);
    assert.equal(dropped.glyph, undefined);
    const kept = markers.find((s) => s.surah === 79 && s.ayah === 20);
    assert.ok(kept);
    assert.equal(kept.glyph, v4.get('79:20:4'));
  });

  it('null/undefined V4 maps give no marker glyphs (rosette path)', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    if (!v2 || !texts) {
      t.skip('دادهٔ V2 یا متن تنزیل در دسترس نیست');
      return;
    }
    for (const map of [null, undefined] as const) {
      const r = buildV2PageRender(v2, v2.pages[583], 79, texts, [], undefined, map);
      assert.ok(r);
      assert.ok(markerSlots(r.renderLines).length > 0);
      assert.ok(markerSlots(r.renderLines).every((s) => s.glyph === undefined));
    }
  });

  it('page 451: the 37:130 marker glyph is the marker key 37:130:4, not a word', (t) => {
    const v2 = loadV2();
    const texts = loadTexts();
    const v4 = loadV4Page(451);
    if (!v2 || !texts || !v4) {
      t.skip('دادهٔ V2 یا متن تنزیل یا گلیف‌های V4 در دسترس نیست');
      return;
    }
    const r = buildV2PageRender(v2, v2.pages[450], 37, texts, [], undefined, v4);
    assert.ok(r, 'expected a V2 render for page 451');
    const m = markerSlots(r.renderLines).find((s) => s.surah === 37 && s.ayah === 130);
    assert.ok(m, 'marker for 37:130 exists');
    assert.equal(m.glyph, v4.get('37:130:4'));
  });
});

describe('marker palette — the reference shot governs (research §2.2)', () => {
  it('marker indices 10/11/12 are the shot dark tone, 13 is untouched', () => {
    assert.equal(V4_TARTEEL_PALETTE_OVERRIDES[10], '#000000'); // knob
    assert.equal(V4_TARTEEL_PALETTE_OVERRIDES[11], '#000000'); // ring (was Wave-1 purple)
    assert.equal(V4_TARTEEL_PALETTE_OVERRIDES[12], '#F9F7F8'); // disc -> page bg
    assert.equal(V4_TARTEEL_PALETTE_OVERRIDES[13], undefined); // number stays palette-0 black
    const rule = v4TarteelPaletteRule('QCF4584_COLOR');
    assert.match(rule, /10 #000000, 11 #000000, 12 #F9F7F8/);
    assert.doesNotMatch(rule, /#FF0080/); // palette-0 hot pink: absent from the shot's markers
    assert.doesNotMatch(rule, /#D8E9D8/); // palette-0 pale green disc
    assert.doesNotMatch(rule, /#8060C0/); // Wave-1 purple: the shot's markers are black, not purple
  });
});

describe('globals.css — justify (probe 2) and the 16.5px honest max', () => {
  it('word spans are inline (not inline-flex), so justify can distribute', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line-word { display:');
    assert.ok(at > 0, '.hifz-line-word display rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /display: inline;/);
    assert.doesNotMatch(block, /inline-flex/);
    assert.doesNotMatch(block, /gap:/);
  });

  it('ornaments are inline too (they join the justify distribution)', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line-ornament {');
    assert.ok(at > 0, '.hifz-line-ornament rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /display: inline;/);
    assert.doesNotMatch(block, /inline-flex/);
  });

  it('the rosette fallback marker stays inline-flex (its SVG needs a box)', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line-marker {');
    assert.ok(at > 0, '.hifz-line-marker rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /display: inline-flex/);
  });

  it('the glyph marker is plain inline text with no margins, on the palette', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line-marker-glyph { display:');
    assert.ok(at > 0, '.hifz-line-marker-glyph rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /display: inline;/);
    assert.match(block, /margin: 0/);
    assert.match(css, /\.hifz-line-marker-glyph \{ font-palette: --quran-v4-tarteel; \}/);
  });

  it('mobile text lines justify with text-align-last (not plain justify alone)', () => {
    const css = readCss();
    const at = css.indexOf('.hifz-line:not(.hifz-line-header):not(.hifz-line-basmala)');
    assert.ok(at > 0, 'mobile text-line justify rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /text-align: justify/);
    assert.match(block, /text-align-last: justify/);
  });

  it('the base .hifz-line rule is right-aligned (desktop keeps its ragged edge)', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line { font-family:');
    assert.ok(at > 0, 'base .hifz-line rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /text-align: right/);
    assert.doesNotMatch(block, /justify/);
  });

  it('mobile size is 16.5px — the honest max (p584 L2 caps a uniform size at 16.93px)', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line { font-size: 16.5px;');
    assert.ok(at > 0, 'mobile .hifz-line rule not found at 16.5px');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /line-height: 2\.1/); // leading untouched
  });
});

describe('QuranHifzStudy — marker glyph, separators, caption removal', () => {
  it('text lines render the marker glyph when present, else the rosette', () => {
    const src = readStudy();
    assert.match(src, /hifz-line-marker-glyph/);
    assert.match(src, /slot\.glyph !== undefined && v4FontLoaded === true/);
    assert.match(src, /<HifzRosette key=\{`m\$\{si\}`\} digit=\{slot\.text\} \/>/);
  });

  it('text lines interleave a QCF separator space, gated on V4 glyphs', () => {
    const src = readStudy();
    assert.match(src, /hifz-line-sep/);
    assert.match(src, /fontFamily: v4FontFamily/);
    assert.match(src, /if \(si === 0 \|\| v4FontLoaded !== true\) return \[node\]/);
  });

  it('the caption is gone from the page section and the placeholder (meta lives in the header card + footer)', () => {
    const src = readStudy();
    assert.doesNotMatch(src, /hifz-line-caption/);
  });
});
