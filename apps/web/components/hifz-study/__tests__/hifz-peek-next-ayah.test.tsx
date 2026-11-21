/**
 * Locking tests for the «« (show next ayah) toolbar button
 * (user 2026-11-20): the button used to show at most 6–7 ayahs
 * (one surah) then go faded and stop. It must walk ayah by ayah
 * through the WHOLE Quran, crossing surah boundaries — Fatiha 1:7
 * fully revealed advances to Baqarah 2:1, and so on to 114:6.
 *
 * The single-word « button got the same page-turn later (user
 * 2026-11-21, see hifz-peek-word-page-turn.test.tsx): it now
 * advances the selection to the revealed word's ayah, but stays
 * surah-limited by the user's explicit decision (2026-11-20), so
 * its surah-limited wiring is locked unchanged here.
 *
 * Source-level locks (same pattern as hifz-eye-toggle.test.tsx):
 * the component is stateful and data-driven, so the actual walk
 * is proven by the Playwright harness shots, not here. These
 * tests lock the wiring the harness cannot cheaply re-derive:
 * which button is disabled when, what peekAyah does at the end
 * of a surah, and that peekTarget stays surah-limited.
 * The advance target itself is unit-tested with real assertions
 * in apps/web/lib/__tests__/hifz-phase4.test.ts
 * (nextPeekAyahPosition).
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

describe('Hifz «« show-next-ayah button (whole Quran, user 2026-11-20)', () => {
  it('the «« button stays enabled at the end of a surah: disabled only when no peek target AND no next ayah', () => {
    const study = readStudy();
    assert.match(
      study,
      /disabled=\{!peekTarget && !peekAyahNext\}\s*\n\s*onClick=\{\(\) => void peekAyah\(\)\}\s*\n\s*aria-label=\{labels\.peekAyah\}/,
    );
  });

  it('the « single-word button is unchanged: still disabled by !peekTarget alone (surah-limited)', () => {
    const study = readStudy();
    assert.match(
      study,
      /disabled=\{!peekTarget\}\s*\n\s*onClick=\{\(\) => void peekNext\(\)\}\s*\n\s*aria-label=\{labels\.peekWord\}/,
    );
  });

  it('peekNext turns the page the same way (user 2026-11-21): setAyah to the revealed word\'s ayah, still one word, kind word, no surah crossing', () => {
    const study = readStudy();
    const start = study.indexOf('const peekNext = useCallback');
    const end = study.indexOf('}, [peekTarget, revealWords, ayah]);', start);
    assert.ok(start > 0 && end > start, 'peekNext not found');
    const body = study.slice(start, end);
    assert.match(
      body,
      /if \(peekTarget\.ayah !== ayah\) setAyah\(peekTarget\.ayah\);\s*\n\s*await revealWords\(peekTarget\.ayah, \[peekTarget\.index\], 'word'\);/,
    );
    assert.doesNotMatch(body, /setSurah/);
    assert.doesNotMatch(body, /peekAyahNext/);
  });

  it('peekTarget still scans only to the end of the CURRENT surah (surah-limited)', () => {
    const study = readStudy();
    assert.match(
      study,
      /for \(let a = ayah; a <= ayahCount; a \+= 1\) \{\s*\n\s*const words = \(texts\[a\] \?\? ''\)\.split\(\/\\s\+\/\)\.filter\(Boolean\);/,
    );
  });

  it('peekAyahNext is the first ayah of the next surah once this surah is fully revealed', () => {
    const study = readStudy();
    assert.match(study, /const peekAyahNext = useMemo\(\(\) => \{/);
    assert.match(study, /return nextPeekAyahPosition\(surah, ayahCount, peekTarget !== null\);/);
    assert.match(study, /const texts = textsBySurah\[surah\];\s*\n\s*if \(!texts\) return null;\s*\n\s*return nextPeekAyahPosition\(surah, ayahCount, peekTarget !== null\);/);
  });

  it('peekAyah reveals the rest of the current ayah first, then advances across the surah boundary', () => {
    const study = readStudy();
    assert.match(
      study,
      /const peekAyah = useCallback\(async \(\) => \{\s*\n\s*if \(peekTarget\) \{/,
    );
    assert.match(study, /await revealWords\(peekTarget\.ayah, indices, 'ayah'\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*if \(!peekAyahNext\) return;/);
    assert.match(study, /pendingPeekAdvanceRef\.current = \{ surah: peekAyahNext\.surah, ayah: peekAyahNext\.ayah \};/);
    assert.match(study, /setSurah\(peekAyahNext\.surah\);\s*\n\s*setEyeScope\(\{ kind: 'surah', target: peekAyahNext\.surah \}\);\s*\n\s*setEyeHidden\(true\);\s*\n\s*setRevealedWords\(new Set\(\)\);\s*\n\s*setAyah\(peekAyahNext\.ayah\);/);
  });

  it('the pending-advance effect reveals the new ayah through the same revealWords path (kind ayah)', () => {
    const study = readStudy();
    assert.match(study, /const pendingPeekAdvanceRef = useRef<\{ surah: number; ayah: number \} \| null>\(null\);/);
    assert.match(study, /if \(pending\.surah !== surah \|\| pending\.ayah !== ayah\) \{\s*\n\s*pendingPeekAdvanceRef\.current = null;/);
    assert.match(study, /void revealWords\(pending\.ayah, indices, 'ayah'\);/);
  });

  it('the page-nav «آیهٔ بعد» button is untouched (PR #165)', () => {
    const study = readStudy();
    assert.match(
      study,
      /disabled=\{nextAyahPosition\(surah, ayah, ayahCount\) === null\}/,
    );
  });
});
