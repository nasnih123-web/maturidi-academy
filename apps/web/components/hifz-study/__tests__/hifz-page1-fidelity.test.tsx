/**
 * Locking tests for the page-1 mushaf fidelity fix (user 2026-11-20,
 * confirmed 2026-11-20 ~19:54): page 1 (Fatiha + Baqarah start) in
 * the hifz study page (mushaf mode) must look like the printed
 * Madani Mushaf 1405 page 1.
 *
 * (a) Fatiha header: the ornate frame (sura-border.svg, like the
 *     Baqarah header on p.2) instead of plain «سورة الفاتحة» text
 *     with horizontal lines. Surah 1 has no SVG in the QUL header
 *     set (002–114 only), so the name is set in the Uthmanic font
 *     inside the frame — the printed form سُورَةُ الْفَاتِحَةِ.
 * (b) No horizontal rules between lines (the print has none).
 * (c) Word spacing: the print's lines are full and even; ours
 *     spread with wide uneven gaps (Fatiha L1 58.8px, L7 132.5px
 *     at 16.5px). The V4 glyph maps carry no per-word print
 *     positions, so exact print spacing (kashida fill) is NOT
 *     achievable with this engine — the fix grows the type to
 *     fill the lines and stops justifying a surah's last line
 *     (the print ends it naturally, right-aligned).
 * (d) Text larger, like the print — WITHOUT changing the Fatiha
 *     line breaks (verified identical in the harness: same 7
 *     lines, same words per line). Measured max is 26.5px (27px
 *     wraps L4); 26px keeps 1px of margin. A uniform size cannot
 *     grow (the global binding line p584 L2 caps it at 16.93px),
 *     so the larger size is scoped to page 1 only.
 *
 * Source-level locks (same pattern as hifz-eye-layout-shift.test.tsx):
 * jsdom cannot measure real layout, so these tests lock the wiring.
 * The pixel proof is the Playwright harness (scratch/p1-measure-probe.py
 * + p1-fontsize-probe.py): gaps, line breaks and the frame, before
 * and after, on p.1 and p.2.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRel(candidates: string[]): string {
  for (const rel of candidates) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`none found: ${candidates.join(', ')}`);
}

function readStudy(): string {
  return readRel([
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]);
}

function readCss(): string {
  return readRel([
    'apps/web/app/[locale]/globals.css',
    'app/[locale]/globals.css',
  ]);
}

/** One single-line CSS rule block by its selector prefix. */
function ruleBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  assert.ok(idx >= 0, `${selector} rule not found`);
  const end = css.indexOf('}', idx);
  assert.ok(end > idx, `${selector} rule has no closing brace`);
  return css.slice(idx, end + 1);
}

describe('Hifz page-1 mushaf fidelity (user 2026-11-20)', () => {
  it('(b) no horizontal rule between lines: .hifz-line has no border-bottom', () => {
    const css = readCss();
    const rule = ruleBlock(css, '.quran-hifz-study .hifz-line {');
    assert.doesNotMatch(rule, /border-bottom/);
    assert.doesNotMatch(css, /\.quran-hifz-study \.hifz-line:last-child/);
  });

  it('(b) the page container keeps its own edge borders (only the inter-line rules went)', () => {
    const css = readCss();
    const rule = ruleBlock(css, '.quran-hifz-study .hifz-line-page {');
    assert.match(rule, /border-top: 1px solid #e5e0d5; border-bottom: 1px solid #e5e0d5;/);
  });

  it('(a) the Fatiha header renders the ornate frame with the name, not plain text', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(headerSurah === 1 \|\| line\.text\.includes\('الفاتحة'\)\) \{/,
    );
    assert.match(
      study,
      /<span className="hifz-surah-frame">\s*\n\s*<span className="hifz-surah-frame-name">سُورَةُ الْفَاتِحَةِ<\/span>/,
    );
  });

  it('(a) the frame-name style is the Uthmanic script, sized to the cartouche', () => {
    const css = readCss();
    const rule = ruleBlock(css, '.quran-hifz-study .hifz-surah-frame-name {');
    assert.match(rule, /font-family: "KFGQPC HAFS Uthmanic Script"/);
    assert.match(rule, /font-size: 1\.5rem/);
  });

  it('(a) the plain-text header fallback still exists (SVG-failure path for surahs 2–114)', () => {
    const study = readStudy();
    assert.match(
      study,
      /<p key=\{line\.key\} className="hifz-line hifz-line-header">\s*\n\s*\{line\.text\}/,
    );
  });

  it('(c) a surah-ending line is not justified: the mobile justify rule excludes it', () => {
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-line:not\(\.hifz-line-header\):not\(\.hifz-line-basmala\):not\(\.hifz-line--surah-end\) \{ text-align: justify; text-align-last: justify; \}/,
    );
  });

  it('(c) the surah-end class is set when the next line is a header or the last marker is the surah final ayah', () => {
    const study = readStudy();
    assert.match(study, /const nextIsHeader = lines\[li \+ 1\]\?\.kind === 'header';/);
    assert.match(
      study,
      /lastSlot\.surah === surah &&\s*\n\s*lastSlot\.ayah === ayahCount\);/,
    );
    assert.match(
      study,
      /className=\{endsSurah \? 'hifz-line hifz-line--surah-end' : 'hifz-line'\}/,
    );
  });

  it('(d) the larger size is scoped to the Fatiha page only (26px, measured max 26.5px)', () => {
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-line-page--fatiha \.hifz-line:not\(\.hifz-line-header\):not\(\.hifz-line-basmala\) \{ font-size: 26px; \}/,
    );
  });

  it('(d) the global mobile size is untouched (16.5px — the uniform cap)', () => {
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-line \{ font-size: 16\.5px; line-height: 2\.1; padding: 0\.1rem 0; \}/,
    );
  });

  it('(d) the section gets the fatiha class exactly when its header is surah 1', () => {
    const study = readStudy();
    assert.match(
      study,
      /lines\.some\(\s*\n\s*\(l\) => l\.kind === 'header' && \(l\.surah === 1 \|\| l\.text\.includes\('الفاتحة'\)\),\s*\n\s*\)\s*\n\s*\? 'hifz-line-page hifz-line-page--fatiha'/,
    );
  });
});
