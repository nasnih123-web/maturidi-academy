/**
 * Locking tests for the «« page-turn fix (user 2026-11-21,
 * confirmed «بله - در همه جا»): pressing «« (show next ayah) past
 * the last ayah of a mushaf page did NOT turn the page. Instead the
 * next ayah's revealed words appeared below the page in the wall
 * (`hifz-wall`) in large text — at EVERY page boundary, not just
 * one place. Evidence: the user's phone screenshot (Baqarah 1–5 on
 * Quran page 2, with «البقرة — ۶» and its words in large text
 * below) and the Playwright harness repro (scratch/peek-turn-repro.py):
 * after 6 «« presses from ayah 1 the header still said page 2,
 * the URL ayah param still said 1, and the wall showed ayah 6.
 *
 * Root cause (read from the code): `peekAyah`'s peekTarget branch
 * revealed the words of `peekTarget.ayah` and returned WITHOUT
 * `setAyah` — the selected ayah never advanced, so the displayed
 * page (derived from the selected ayah: pageIndex / v2PageIndex)
 * never turned within a surah. The revealed words of a next-page
 * ayah entered `wallAyahs` as peek mistakes and, not placed on the
 * old page, rendered in the wall via `unplacedGroups`. The only
 * `setAyah` advance in `peekAyah` ran when `peekTarget === null`
 * (whole surah written) — i.e. only at surah boundaries.
 *
 * The fix: in the peekTarget branch the revealed ayah becomes the
 * selection (`setAyah(peekTarget.ayah)`) before revealing, so the
 * page follows it. The eye is untouched (the same setAyah-only
 * turn the page-nav «آیهٔ بعد» button, PR #165, already does) and
 * scoring is unchanged (revealWords still records the peek for
 * peekTarget.ayah, kind 'ayah'). The single-word « button
 * (peekNext) got the same page-turn later (user 2026-11-21, see
 * hifz-peek-word-page-turn.test.tsx); its old "unchanged" lock
 * below was updated to the new shape.
 *
 * Source-level locks (same pattern as hifz-peek-next-ayah.test.tsx):
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

describe('Hifz «« page-turn fix (user 2026-11-21)', () => {
  it('peekAyah advances the selection to the revealed ayah before revealing it', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(peekTarget\.ayah !== ayah\) setAyah\(peekTarget\.ayah\);\s*\n\s*await revealWords\(peekTarget\.ayah, indices, 'ayah'\);/,
    );
  });

  it('peekAyah still reveals the peekTarget ayah with kind ayah (scoring unchanged)', () => {
    const study = readStudy();
    assert.match(
      study,
      /await revealWords\(peekTarget\.ayah, indices, 'ayah'\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*if \(!peekAyahNext\) return;/,
    );
  });

  it('peekAyah sees the current selection: ayah is in its dependency array', () => {
    const study = readStudy();
    assert.match(
      study,
      /\}, \[peekTarget, peekAyahNext, textsBySurah, surah, wallKeys, revealWords, ayah\]\);/,
    );
  });

  it('the displayed page is derived from the selected ayah, so advancing it turns the page', () => {
    const study = readStudy();
    assert.match(
      study,
      /\(mushafPages \? pageIndexFor\(mushafPages, surah, ayah\) : null\)/,
    );
    assert.match(
      study,
      /\(v2Index \? v2PageIndexForAyah\(v2Index, surah, ayah\) : null\)/,
    );
  });

  it('a revealed ayah placed on the turned page leaves the wall by itself (wall shows only unplaced ayahs)', () => {
    const study = readStudy();
    assert.match(
      study,
      /const unplacedGroups = useMemo\(\s*\n\s*\(\) => wallAyahs\.filter\(\(g\) => !placedAyahs\.has\(g\.ayah\)\),/,
    );
  });

  it('the cross-surah branch is unchanged: pending advance + surah reset + setAyah', () => {
    const study = readStudy();
    assert.match(
      study,
      /pendingPeekAdvanceRef\.current = \{ surah: peekAyahNext\.surah, ayah: peekAyahNext\.ayah \};\s*\n\s*setSurah\(peekAyahNext\.surah\);\s*\n\s*setEyeScope\(\{ kind: 'surah', target: peekAyahNext\.surah \}\);\s*\n\s*setEyeHidden\(true\);\s*\n\s*setRevealedWords\(new Set\(\)\);\s*\n\s*setAyah\(peekAyahNext\.ayah\);/,
    );
  });

  it('the « single-word button turns the page the same way (user 2026-11-21): setAyah before revealing one word', () => {
    const study = readStudy();
    const start = study.indexOf('const peekNext = useCallback');
    const end = study.indexOf('}, [peekTarget, revealWords, ayah]);', start);
    assert.ok(start > 0 && end > start, 'peekNext not found');
    const body = study.slice(start, end);
    assert.match(
      body,
      /if \(peekTarget\.ayah !== ayah\) setAyah\(peekTarget\.ayah\);\s*\n\s*await revealWords\(peekTarget\.ayah, \[peekTarget\.index\], 'word'\);/,
    );
  });

  it('the eye is untouched by the page-turn: no eyeScope/eyeHidden change in the peekTarget branch', () => {
    const study = readStudy();
    const start = study.indexOf('const peekAyah = useCallback');
    const end = study.indexOf('if (!peekAyahNext) return;', start);
    assert.ok(start > 0 && end > start, 'peekAyah peekTarget branch not found');
    const branch = study.slice(start, end);
    assert.doesNotMatch(branch, /setEyeScope/);
    assert.doesNotMatch(branch, /setEyeHidden/);
    assert.doesNotMatch(branch, /setRevealedWords/);
  });
});
