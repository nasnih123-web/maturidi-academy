/**
 * Locking tests for the wall removal (user 2026-11-21, confirmed
 * 10:37): the hifz-wall section — large-text written ayahs below
 * the mushaf page (e.g. «البقرة — ١» with بِسْمِ اللَّهِ under
 * page 3) — must not appear anywhere in the hifz section, in any
 * display mode. The previous page must also look like the mushaf.
 * Evidence: the user's phone screenshot after PR #178 merged
 * (page 5, Baqarah 25): the page turned, but the wall below still
 * showed Baqarah 1's Basmala in large text.
 *
 * Scope: only the wall SECTION's display is removed. The written-
 * words state (wallAyahs) stays — it still feeds the page render
 * (buildPageRender / buildV2PageRender), the nass scroll
 * (HifzNassScroll) and live grading. The page-failure note
 * (svgFailedNote) moved from the wall into the page area, so a
 * failed page still says so honestly instead of going blank.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readFirst(rels: string[]): string {
  for (const rel of rels) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`none of ${rels.join(', ')} found`);
}

function readStudy(): string {
  return readFirst([
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]);
}

function readCss(): string {
  return readFirst([
    'apps/web/app/[locale]/globals.css',
    'app/[locale]/globals.css',
  ]);
}

describe('Hifz wall removal (user 2026-11-21)', () => {
  it('no wall section renders: no hifz-wall, no wallVisible, no unplacedGroups, no hifz-has-wall', () => {
    const study = readStudy();
    assert.doesNotMatch(study, /hifz-wall/);
    assert.doesNotMatch(study, /wallVisible/);
    assert.doesNotMatch(study, /unplacedGroups/);
    assert.doesNotMatch(study, /hifz-has-wall/);
  });

  it('no wall CSS remains in globals.css', () => {
    const css = readCss();
    assert.doesNotMatch(css, /\.hifz-wall/);
  });

  it('the page-failure note moved to the page area (honest failure, no written ayahs)', () => {
    const study = readStudy();
    const start = study.indexOf('Page failure (2026-11-21)');
    assert.ok(start > 0, 'page-failure note not found');
    const block = study.slice(start, start + 600);
    assert.match(block, /displayMode === 'mushaf' && pageFailed &&/);
    assert.match(block, /hifz-line-failed-note/);
    assert.match(block, /labels\.svgFailedNote/);
  });

  it('the written-words state still feeds the page, nass and grading (only the display went)', () => {
    const study = readStudy();
    assert.ok(
      study.includes('buildPageRender(pageLines, surah, textsBySurah[surah], wallAyahs)'),
      'page render no longer receives wallAyahs',
    );
    assert.match(
      study,
      /buildV2PageRender\(\s*\n\s*v2Index,\s*\n\s*activeV2Page,\s*\n\s*surah,\s*\n\s*textsBySurah,\s*\n\s*wallAyahs,/,
    );
    assert.ok(study.includes('wallAyahs={wallAyahs}'), 'nass scroll no longer receives wallAyahs');
  });
});
