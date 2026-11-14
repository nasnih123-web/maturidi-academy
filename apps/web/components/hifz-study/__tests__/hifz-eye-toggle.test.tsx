/**
 * Locking tests for the hifz eye button (user 2026-11-12): the eye
 * in the recitation toolbar hides / shows the ayahs of the selected
 * unit — page (that page only), surah (the whole surah), juz (the
 * whole juz), hizb (the whole hizb) — default hidden (slashed eye).
 *
 * Round 2 (user 2026-11-12): the hidden words are INVISIBLE
 * placeholders (no dotted box, no dotted line) and the eye works in
 * nass and translation too, with the same unit scope.
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

function readCss(): string {
  for (const rel of [
    'apps/web/app/[locale]/globals.css',
    'app/[locale]/globals.css',
  ]) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('globals.css not found');
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

  it('the eye applies in practice in every display mode, not in listen (round 2)', () => {
    const study = readStudy();
    assert.match(
      study,
      /const eyeApplies = studyMode === 'practice';/,
    );
    // The icon follows the mode it controls.
    assert.match(study, /const eyeHiddenNow = eyeApplies \? eyeHidden : scriptHidden;/);
    assert.match(study, /aria-pressed=\{eyeHiddenNow\}/);
  });

  it('the eye button toggles eyeHidden in practice, scriptHidden in listen', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeApplies\) setEyeHidden\(\(v\) => !v\);\s*else setScriptHidden\(\(v\) => !v\);/,
    );
  });

  it('scope membership: surah by word surah, page by the page on screen in mushaf and by the ayah start page elsewhere, juz/hizb by the word itself', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeScope\.kind === 'surah'\) return wordSurah === eyeScope\.target;/,
    );
    assert.match(
      study,
      /if \(displayMode === 'mushaf'\) return \(headerMeta\?\.page \?\? null\) === eyeScope\.target;/,
    );
    assert.match(
      study,
      /return rangeContaining\(boundaries, wordSurah, wordAyah\)\.page === eyeScope\.target;/,
    );
    assert.match(study, /const containing = rangeContaining\(boundaries, wordSurah, wordAyah\);/);
  });

  it('inside the unit the eye shows unwritten words and hides every word as an INVISIBLE placeholder (round 2: no dotted box)', () => {
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeApplies && slot\.index >= 0 && eyeCoversWord\(slot\.surah, slot\.ayah\)\) \{/,
    );
    // Hidden state: the invisible eye placeholder, tappable to
    // reveal just that word.
    assert.match(
      study,
      /if \(eyeHidden && !revealedWords\.has\(eyeKey\)\) \{/,
    );
    assert.match(study, /className="hifz-line-word hifz-line-word-eye-hidden"/);
    // The eye's placeholder carries no dotted line; the old dotted
    // class is kept only for the script-hide paths (listen mode).
    // The border is transparent but keeps the old widths (1px sides,
    // 2px bottom) so the hidden placeholder has byte-identical
    // geometry to the round-1 dotted box (same line breaks and
    // word positions).
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-line-word-eye-hidden \{[^}]*border: 1px solid transparent; border-bottom-width: 2px;[^}]*appearance: none;[^}]*\}/,
    );
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-line-word-eye-hidden,\s*\.quran-hifz-study \.hifz-line-word-eye-hidden \* \{ color: transparent !important; \}/,
    );
    assert.match(study, /className="hifz-line-word hifz-line-word-concealed"/);
  });

  it('a peeked word is never re-hidden by the eye (peek must work while hidden)', () => {
    const study = readStudy();
    assert.match(
      study,
      /const eyeConcealsWritten =\s*eyeApplies &&\s*eyeHidden &&\s*w\.status !== 'peeked' &&/,
    );
  });

  it('a juz / hizb eye scope loads the boundaries table lazily (it is null on a healthy V2 load); round 2 also loads it for a page scope outside mushaf', () => {
    // The header-fallback effect only loads boundaries when V2 failed
    // outright, so a juz / hizb scope would silently cover nothing
    // without its own load. This effect fires for every scope that
    // needs the table (juz / hizb always, page only in nass /
    // translation where the ayah's start page decides) and only
    // while boundaries are still null.
    const study = readStudy();
    assert.match(
      study,
      /if \(eyeScope\.kind === 'surah'\) return;\s*if \(eyeScope\.kind === 'page' && displayMode === 'mushaf'\) return;\s*if \(boundaries !== null\) return;\s*let cancelled = false;\s*loadBoundaries\(\)\.then\(\(b\) => \{\s*if \(!cancelled\) setBoundaries\(b\);\s*\}\);/,
    );
  });

  it('translation: the eye hides the translation text of the unit ayahs, ref and edition name stay (round 2)', () => {
    const study = readStudy();
    assert.match(
      study,
      /const trConcealed =\s*eyeApplies && eyeHidden && eyeCoversWord\(surah, a\);/,
    );
    assert.match(
      study,
      /className=\{trConcealed \? 'hifz-translation-concealed' : undefined\}/,
    );
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study \.hifz-translation-concealed \{ visibility: hidden; \}/,
    );
  });

  it('the Basmalah follows the eye instead of bypassing it through the SVG branch', () => {
    const study = readStudy();
    assert.match(study, /const basmalaInScope =/);
    assert.match(study, /const basmalaHideSvg =/);
    assert.match(study, /scriptHidden \|\| \(basmalaInScope && eyeHidden && !basmalaAnyWritten\)/);
    assert.match(study, /hifz-basmala-svg hifz-line-word-hidden/);
  });
});
