/**
 * Wave-1 Exact-Match tests (2026-11-09): the Basmalah CSS-order fix,
 * zero glyph padding, the dedicated Basmalah SVG, and the
 * Tarteel-approx COLR palette override (research §2/§6/§8).
 * Static checks (CSS/SVG/component text) plus the palette rule
 * builder. Browser behaviour (computed sizes, painted colours, line
 * breaks) is verified by the Playwright probe, not here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  V4_TARTEEL_PALETTE_NAME,
  V4_TARTEEL_PALETTE_OVERRIDES,
  v4TarteelPaletteRule,
} from '../quran-mushaf-v4';
import { injectFontPaletteRule, qcfV4Provider } from '../quran-mushaf-font';

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

function readSvg(): string {
  const svg = readFirst([
    'apps/web/public/quran/surah-headers/basmalah.svg',
    'public/quran/surah-headers/basmalah.svg',
  ]);
  assert.ok(svg, 'basmalah.svg not found');
  return svg as string;
}

describe('v4TarteelPaletteRule (reference shot governs, not palette 0)', () => {
  it('names the palette and the page family, selects base palette 0', () => {
    const rule = v4TarteelPaletteRule('QCF4293_COLOR');
    assert.equal(V4_TARTEEL_PALETTE_NAME, '--quran-v4-tarteel');
    assert.match(rule, /@font-palette-values --quran-v4-tarteel/);
    assert.match(rule, /font-family: QCF4293_COLOR/);
    assert.match(rule, /base-palette: 0/);
  });

  it('overrides the shot-absent colours with the shot tones', () => {
    assert.deepEqual(V4_TARTEEL_PALETTE_OVERRIDES, {
      6: '#008060',
      7: '#006080',
      8: '#0090C0',
      9: '#C04090',
      10: '#000000',
      11: '#000000',
      12: '#F9F7F8',
    });
    const rule = v4TarteelPaletteRule('QCF4293_COLOR');
    assert.match(
      rule,
      /override-colors: 6 #008060, 7 #006080, 8 #0090C0, 9 #C04090, 10 #000000, 11 #000000, 12 #F9F7F8/,
    );
  });

  it('contains neither shot-absent palette-0 colour', () => {
    const rule = v4TarteelPaletteRule('QCF4293_COLOR');
    assert.doesNotMatch(rule, /#09B000/); // pure green: absent from the shot
    assert.doesNotMatch(rule, /#3F48E6/); // royal blue: absent from the shot
  });

  it('the V4 provider supplies the rule for its family', () => {
    const src = qcfV4Provider.familyForPage(293);
    assert.ok(src);
    assert.equal(src?.family, 'QCF4293_COLOR');
    assert.match(src?.paletteRule ?? '', /font-family: QCF4293_COLOR/);
    assert.match(src?.paletteRule ?? '', /override-colors:/);
  });

  it('injectFontPaletteRule is a safe no-op without a document', () => {
    assert.equal(typeof document, 'undefined');
    assert.doesNotThrow(() =>
      injectFontPaletteRule('QCF4293_COLOR', v4TarteelPaletteRule('QCF4293_COLOR')),
    );
  });
});

describe('globals.css — Basmalah order bug (research §6.3)', () => {
  it('the .hifz-line-basmala rule comes AFTER the mobile .hifz-line rule', () => {
    const css = readCss();
    const mobile = css.indexOf('.quran-hifz-study .hifz-line { font-size: 16.5px;');
    assert.ok(mobile > 0, 'mobile .hifz-line rule not found');
    const basmala = css.indexOf('.quran-hifz-study .hifz-line-basmala {');
    assert.ok(basmala > 0, '.hifz-line-basmala rule not found');
    assert.ok(
      basmala > mobile,
      'basmala rule must follow the mobile rule (same specificity, order wins)',
    );
  });

  it('the basmala rule still asks for ~21.6px with a compact line', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line-basmala {');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /font-size: clamp\(1\.35rem, 5\.5vw, 2rem\)/);
    assert.match(block, /line-height: 1\.25/);
  });
});

describe('globals.css — glyph padding (research §6.1) and palette', () => {
  it('glyph words get padding: 0 (the 8px/word written-state overflow)', () => {
    const css = readCss();
    const at = css.indexOf('.quran-hifz-study .hifz-line-word.hifz-line-word-glyph,');
    assert.ok(at > 0, 'glyph rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /margin-inline-end: 0/);
    assert.match(block, /padding: 0/);
  });

  it('text words keep the 0.25em inter-word margin', () => {
    const css = readCss();
    assert.match(css, /margin-inline-end: 0\.25em/);
  });

  it('glyph words select the Tarteel-approx palette', () => {
    const css = readCss();
    assert.match(css, /font-palette: --quran-v4-tarteel/);
  });

  it('the Basmalah SVG is centred at the reference width', () => {
    const css = readCss();
    const at = css.indexOf('.hifz-basmala-svg');
    assert.ok(at > 0, '.hifz-basmala-svg rule not found');
    const block = css.slice(at, css.indexOf('}', at));
    assert.match(block, /width: 212px/);
    assert.match(block, /margin: 0 auto/);
  });
});

describe('basmalah.svg — dedicated header Basmalah (research §8.2)', () => {
  it('exists, is an SVG with the composed glyph paths', () => {
    const svg = readSvg();
    assert.match(svg, /^<svg /);
    assert.match(svg, /viewBox="/);
    const paths = svg.match(/<path /g) ?? [];
    assert.ok(paths.length >= 10, `expected >=10 paths, got ${paths.length}`);
  });

  it('has the stretched header form (aspect ~8:1, not the 4.3:1 Fatiha form)', () => {
    const svg = readSvg();
    const m = svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
    assert.ok(m, 'viewBox not parsed');
    const ratio = Number(m?.[1]) / Number(m?.[2]);
    assert.ok(ratio > 7.5 && ratio < 9, `aspect ${ratio} should be ~8.1`);
  });

  it('uses the override palette fills and no Tarteel asset', () => {
    const svg = readSvg();
    assert.match(svg, /#006080/); // dark teal (was royal blue)
    assert.match(svg, /#FF7B00/); // orange segment, as in the shot
    assert.doesNotMatch(svg, /bismallah/i);
    assert.doesNotMatch(svg, /tarteel/i);
  });

  it('the provenance notice records the p1-font source', () => {
    const notice = readFirst([
      'apps/web/public/quran/surah-headers/basmalah-NOTICE.md',
      'public/quran/surah-headers/basmalah-NOTICE.md',
    ]);
    assert.ok(notice, 'basmalah-NOTICE.md not found');
    assert.match(notice as string, /U\+FC41/);
    assert.match(notice as string, /never/i);
  });
});

describe('QuranHifzStudy — Basmalah SVG wiring', () => {
  function readStudy(): string {
    const src = readFirst([
      'apps/web/components/QuranHifzStudy.tsx',
      'components/QuranHifzStudy.tsx',
    ]);
    assert.ok(src, 'QuranHifzStudy.tsx not found');
    return src as string;
  }

  it('renders the SVG only in a plain state, with the word-span fallback', () => {
    const src = readStudy();
    const uses = src.match(/src="\/quran\/surah-headers\/basmalah\.svg"/g) ?? [];
    assert.equal(uses.length, 1, 'the SVG must be rendered exactly once (mushaf page only)');
    assert.match(src, /basmalaAllHidden \|\| basmalaAllPlain/);
    assert.match(src, /studyMode !== 'listen'/);
    assert.match(src, /!scriptHidden/);
    assert.match(src, /hifz-basmala-svg hifz-line-word-hidden/);
  });

  it('the nass-mode Basmalah still uses word spans (no SVG there)', () => {
    const src = readStudy();
    const nassAt = src.indexOf("displayMode === 'nass'");
    assert.ok(nassAt > 0);
    const svgAt = src.indexOf('basmalah.svg');
    assert.ok(svgAt > 0 && svgAt < nassAt, 'SVG reference must be before (not inside) the nass block');
  });
});
