/**
 * Locking tests for the hifz eye button (user 2026-11-12): the eye
 * in the recitation toolbar hides / shows the ayahs of the selected
 * unit — page (that page only), surah (the whole surah), juz (the
 * whole juz), hizb (the whole hizb) — default hidden (slashed eye).
 *
 * Source-level locks (same pattern as hifz-study-sheets.test.tsx):
 * the component is stateful and data-driven, so clicks and page
 * turns are proven by the Playwright harness shots, not here. These
 * tests lock the wiring that the harness cannot cheaply re-derive:
 * the default, the scope mapping, and which branches the eye feeds.
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

describe('Hifz eye button (user 2026-11-12)', () => {
  it('defaults to hidden: eyeHidden starts true (slashed eye)', () => {
    const study = readStudy();
    assert.match(study, /const \[eyeHidden, setEyeHidden\] = useState\(true\);/);
    // The old script-hide keeps its own default: listen / nass /
    // translation must not start concealed.
    assert.match(study, /const \[scriptHidden, setScriptHidden\] = useState\(false\);/);
  });

  it('initial scope mirrors the deep link: page target = page scope, else surah scope', () => {
    const study = readStudy();
    assert.match(
      study,
      /initialPageTarget !== null &&\s*initialPageTarget !== undefined &&\s*initialAyah === null\s*\?\s*\{\s*kind: 'page', target: initialPageTarget \}\s*:\s*\{\s*kind: 'surah', target: initialSurah \}/,
    );
  });

  it('a picker range becomes the new eye scope, starting hidden again', () => {
    const study = readStudy();
    // jumpToPickerRange uses the kind/target it used to ignore.
    assert.match(study, /const jumpToPickerRange = useCallback\(\s*\(kind: RangeKind, target: number, firstPage: number\)/);
    assert.match(study, /setEyeScope\(\{ kind, target \}\);/);
    assert.match(study, /setPickerOpen\(false\);\s*setEyeScope\(\{ kind, target \}\);\s*setEyeHidden\(true\);/);
  });

  it('a surah picked in the setup panel becomes a surah scope, starting hidden', () => {
    const study = readStudy();
    assert.match(
      study,
      /setSurah\(n\);\s*setEyeScope\(\{ kind: 'surah', target: n \}\);\s*setEyeHidden\(true\);/,
    );
  });

  it('the eye applies only in mushaf practice mode', () => {
    const study = readStudy();
    assert.match(
      study,
      /const eyeApplies = displayMode === 'mushaf' && studyMode === 'practice';/,
    );
    // The icon follows the mode it controls.
    assert.match(study, /const eyeHiddenNow = eyeApplies \? eyeHidden : scriptHidden;/);
    assert.match(study, /aria-pressed=\{eyeHiddenNow\}/);
  });

  it('the eye button toggles eyeHidden in mushaf practice, scriptHidden elsewhere', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeApplies\) setEyeHidden\(\(v\) => !v\);\s*else setScriptHidden\(\(v\) => !v\);/,
    );
  });

  it('scope membership: surah by word surah, page by the page on screen, juz/hizb by the word itself', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeScope\.kind === 'surah'\) return wordSurah === eyeScope\.target;/,
    );
    assert.match(
      study,
      /if \(eyeScope\.kind === 'page'\) return \(headerMeta\?\.page \?\? null\) === eyeScope\.target;/,
    );
    assert.match(study, /const containing = rangeContaining\(boundaries, wordSurah, wordAyah\);/);
  });

  it('inside the unit the eye shows unwritten words and hides every word as a dotted placeholder', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeApplies && slot\.index >= 0 && eyeCoversWord\(slot\.surah, slot\.ayah\)\) \{/,
    );
    // Hidden state: the same dotted placeholder as a hidden written
    // word, tappable to reveal just that word.
    assert.match(
      study,
      /if \(eyeHidden && !revealedWords\.has\(eyeKey\)\) \{/,
    );
  });

  it('a peeked word is never re-hidden by the eye (peek must work while hidden)', () => {
    const study = readStudy();
    assert.match(
      study,
      /const eyeConcealsWritten =\s*eyeApplies &&\s*eyeHidden &&\s*w\.status !== 'peeked' &&/,
    );
  });

  it('a juz / hizb eye scope loads the boundaries table lazily (it is null on a healthy V2 load)', () => {
    // The header-fallback effect only loads boundaries when V2 failed
    // outright, so a juz / hizb scope would silently cover nothing
    // without its own load. This effect fires only for a juz / hizb
    // eye scope and only while boundaries are still null.
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeScope\.kind !== 'juz' && eyeScope\.kind !== 'hizb'\) return;\s*if \(boundaries !== null\) return;\s*let cancelled = false;\s*loadBoundaries\(\)\.then\(\(b\) => \{\s*if \(!cancelled\) setBoundaries\(b\);\s*\}\);/,
    );
  });

  it('the Basmalah follows the eye instead of bypassing it through the SVG branch', () => {
    const study = readStudy();
    assert.match(study, /const basmalaInScope =/);
    assert.match(study, /!\(basmalaInScope && eyeHidden\) &&/);
    assert.match(study, /basmalaAllHidden && !basmalaEyeShown/);
  });
});
