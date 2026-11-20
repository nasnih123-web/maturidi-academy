/**
 * Locking tests for the hifz eye layout-shift bug (user 2026-11-20):
 * with the eye CLOSED (text hidden) while reciting, the page size
 * changed and the ayah-end markers (۝) moved while reading — their
 * position was not exact. Measured on mushaf p.1 (393px, Fatiha):
 * a hidden word was a 44px-tall, 16px <button> (the generic
 * `.quran-hifz-study button` rule: min-height 44px, font-size 1rem)
 * with a 1px/2px transparent border and Tanzil text, while the
 * revealed word was a 16.5px inline span with a V4 glyph — so a
 * line holding a hidden word was 45px tall and collapsed to 36.6px
 * when its last hidden word was revealed (markers jumped up 5-6px),
 * and mid-line markers slid +7-8px sideways from the width delta
 * (hidden text + padding + border vs the V4 glyph advance).
 *
 * The fix: a hidden word renders EXACTLY its revealed word's box —
 * same element box (font, min-height, border, display), same
 * padding/margin (via the .hifz-line-word-glyph rules), same content
 * (V4 glyph iff the revealed word is a glyph, else Tanzil text) —
 * so revealing changes only visibility, never size or position.
 *
 * Source-level locks (same pattern as hifz-peek-next-ayah.test.tsx):
 * jsdom cannot measure real layout, so these tests lock the wiring
 * the harness cannot cheaply re-derive. The pixel proof is the
 * Playwright harness (scratch/layoutshift-probe.py): after the fix,
 * marker positions, line boxes, page height and font size are
 * identical before and after reveals on p.1.
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

/** The .hifz-line-word-eye-hidden rule block (single-line rule). */
function eyeHiddenRule(css: string): string {
  const m = css.match(
    /\.quran-hifz-study \.hifz-line-word-eye-hidden \{[^}]*\}/,
  );
  assert.ok(m, 'eye-hidden CSS rule not found');
  return m[0];
}

describe('Hifz eye layout-shift fix (user 2026-11-20)', () => {
  it('the hidden word inherits the line font (16.5px), not the generic button 1rem', () => {
    const rule = eyeHiddenRule(readCss());
    assert.match(rule, /font: inherit/);
  });

  it('the hidden word has no 44px tap-target min-height', () => {
    const rule = eyeHiddenRule(readCss());
    assert.match(rule, /min-height: 0/);
  });

  it('the hidden word has no border (the old transparent border added 2px width + 3px height)', () => {
    const rule = eyeHiddenRule(readCss());
    assert.match(rule, /border: 0/);
    assert.doesNotMatch(rule, /border: 1px solid transparent/);
    assert.doesNotMatch(rule, /border-bottom-width/);
  });

  it('the hidden word is display:inline like the revealed span, not inline-block', () => {
    const css = readCss();
    const rule = eyeHiddenRule(css);
    assert.match(rule, /display: inline/);
    assert.doesNotMatch(
      css,
      /\.hifz-line-word\.hifz-line-word-eye-hidden \{ display: inline-block/,
    );
  });

  it('the hidden word sets no padding/margin of its own: the glyph/text rules supply them', () => {
    const rule = eyeHiddenRule(readCss());
    assert.doesNotMatch(rule, /padding:/);
    assert.doesNotMatch(rule, /margin/);
  });

  it('the generic hifz button rule (44px / 1rem, for real controls) is untouched', () => {
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study button \{ min-height: 44px; padding: 0 1rem; border-radius: 999px; border: 1px solid rgba\(0,0,0,0\.30\); background: #f3efe7; color: #1c1710; font-size: 1rem; cursor: pointer; \}/,
    );
  });

  it('unwritten eye-hidden word: glyph class follows the revealed word (useGlyphShown)', () => {
    const study = readStudy();
    assert.match(
      study,
      /'hifz-line-word-eye-hidden',\s*\n\s*useGlyphShown \? 'hifz-line-word-glyph' : '',/,
    );
  });

  it('unwritten eye-hidden word: glyph content hides with visibility:hidden (COLR ignores color:transparent)', () => {
    const study = readStudy();
    assert.match(
      study,
      /<span aria-hidden="true" style=\{\{ visibility: 'hidden' \}\}>\s*\n\s*\{renderV4Glyph\(slot, fontFamily\)\}/,
    );
  });

  it('written eye-hidden word: glyph class follows the revealed word (useGlyph, hoisted above the concealment branches)', () => {
    const study = readStudy();
    assert.match(
      study,
      /'hifz-line-word-eye-hidden',\s*\n\s*useGlyph \? 'hifz-line-word-glyph' : '',/,
    );
    // useGlyph is computed before the eye-concealment branch reads it.
    const glyphAt = study.indexOf('const useGlyph =');
    const eyeAt = study.indexOf('if (eyeConcealsWritten) {');
    assert.ok(glyphAt > 0 && eyeAt > 0 && glyphAt < eyeAt);
  });

  it('the listen-mode dotted placeholder is unchanged (Tanzil text only, no glyph)', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(scriptConcealsWritten\) \{\s*\n\s*return \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*key=\{key\}\s*\n\s*className="hifz-line-word hifz-line-word-concealed"/,
    );
  });

  it('hidden eye buttons render the pause mark too, like the revealed words', () => {
    const study = readStudy();
    // Two eye-hidden buttons (unwritten + written) each carry the pause span.
    const hits = study.match(
      /hifz-line-word-eye-hidden[\s\S]{0,1200}?<span className="hifz-word-pause"/g,
    );
    assert.ok(hits && hits.length === 2, `expected 2 eye-hidden pause spans, got ${hits?.length ?? 0}`);
  });

  it('translation concealment stays visibility:hidden on the whole paragraph (already layout-stable)', () => {
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-translation-concealed \{ visibility: hidden; \}/,
    );
  });
});
