/**
 * Locking tests for the « (single-word peek) page-turn fix (user
 * 2026-11-21): the same latent shape as the «« bug fixed in
 * hifz-peek-page-turn.test.tsx, in the other peek button. Pressing
 * « (show next word) past the last word of a mushaf page did NOT
 * turn the page: the first word of the next-page ayah appeared
 * below the page in the wall (`hifz-wall`) in large text.
 * Evidence: the Playwright harness repro
 * (scratch/peek-word-before.py) — from Baqarah 1, after 44 «
 * presses the header still said page 2, the URL ayah param still
 * said 1, and the wall showed «البقرة — ٦» with «إِنَّ»; from
 * Mu'minun 42, after 7 « presses the header still said page 344
 * and the wall showed «المؤمنون — ٤٣» with «مَا».
 *
 * Root cause (read from the code): `peekNext` revealed the word
 * at `peekTarget` and returned WITHOUT `setAyah` — the selected
 * ayah never advanced, so the displayed page (derived from the
 * selected ayah: pageIndex / v2PageIndex) never turned. The
 * revealed word of a next-page ayah entered `wallAyahs` as a peek
 * mistake and, not placed on the old page, rendered in the wall
 * via `unplacedGroups`.
 *
 * The fix: the same one line as the «« fix — in `peekNext` the
 * revealed word's ayah becomes the selection
 * (`setAyah(peekTarget.ayah)`) before revealing, so the page
 * follows it. The eye is untouched and scoring is unchanged
 * (revealWords still records the peek for peekTarget.ayah, kind
 * 'word', one word).
 *
 * HARD CONSTRAINT (user decision 2026-11-20): « stays
 * SURAH-LIMITED. It holds by construction: `peekTarget` scans
 * only this surah's texts (`textsBySurah[surah]`, ayah..ayahCount)
 * and never points across a surah, so the added `setAyah` can only
 * move the selection within the same surah. `peekNext` has no
 * setSurah and no peekAyahNext (the cross-surah advance belongs
 * to «« only).
 *
 * Source-level locks (same pattern as hifz-peek-page-turn.test.tsx):
 * the component is stateful and data-driven, so the actual page
 * turn is proven by the Playwright harness shots (before/after),
 * not here. These tests lock the wiring the harness cannot
 * cheaply re-derive.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readStudy(): string {
  for (const rel of [
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('QuranHifzStudy.tsx not found');
}

function peekNextBody(study: string): string {
  const start = study.indexOf('const peekNext = useCallback');
  const end = study.indexOf('}, [peekTarget, revealWords, ayah]);', start);
  assert.ok(start > 0 && end > start, 'peekNext not found');
  return study.slice(start, end);
}

describe('Hifz « single-word page-turn fix (user 2026-11-21)', () => {
  it('peekNext advances the selection to the revealed word\'s ayah before revealing it', () => {
    const study = readStudy();
    const body = peekNextBody(study);
    assert.match(
      body,
      /if \(peekTarget\.ayah !== ayah\) setAyah\(peekTarget\.ayah\);\s*\n\s*await revealWords\(peekTarget\.ayah, \[peekTarget\.index\], 'word'\);/,
    );
  });

  it('peekNext still reveals exactly one word with kind word (scoring unchanged)', () => {
    const study = readStudy();
    const body = peekNextBody(study);
    assert.match(
      body,
      /await revealWords\(peekTarget\.ayah, \[peekTarget\.index\], 'word'\);/,
    );
    assert.doesNotMatch(body, /'ayah'/);
  });

  it('peekNext sees the current selection: ayah is in its dependency array', () => {
    const study = readStudy();
    assert.match(
      study,
      /const peekNext = useCallback\(async \(\) => \{[\s\S]*?\}, \[peekTarget, revealWords, ayah\]\);/,
    );
  });

  it('peekTarget is surah-limited by construction: only this surah\'s texts, ayah..ayahCount', () => {
    const study = readStudy();
    const start = study.indexOf('const peekTarget = useMemo');
    const end = study.indexOf('}, [textsBySurah, surah, ayah, ayahCount, wallKeys]);', start);
    assert.ok(start > 0 && end > start, 'peekTarget memo not found');
    const memo = study.slice(start, end);
    assert.match(memo, /const texts = textsBySurah\[surah\];/);
    assert.match(memo, /for \(let a = ayah; a <= ayahCount; a \+= 1\) \{/);
    assert.doesNotMatch(memo, /setSurah/);
    assert.doesNotMatch(memo, /peekAyahNext/);
  });

  it('peekNext never crosses a surah and never touches the eye: no setSurah, no eye changes', () => {
    const study = readStudy();
    const body = peekNextBody(study);
    assert.doesNotMatch(body, /setSurah/);
    assert.doesNotMatch(body, /peekAyahNext/);
    assert.doesNotMatch(body, /setEyeScope/);
    assert.doesNotMatch(body, /setEyeHidden/);
    assert.doesNotMatch(body, /setRevealedWords/);
  });

  it('a revealed word placed on the turned page leaves the wall by itself (wall shows only unplaced ayahs)', () => {
    const study = readStudy();
    assert.match(
      study,
      /const unplacedGroups = useMemo\(\s*\n\s*\(\) => wallAyahs\.filter\(\(g\) => !placedAyahs\.has\(g\.ayah\)\),/,
    );
  });
});
