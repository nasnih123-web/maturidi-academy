/**
 * Locking tests for the whole-Quran nass scroll (user 2026-11-21,
 * confirmed 16:55): in nass mode the scroll used to stop at the end
 * of the study surah; now it spans all 604 pages, so scrolling past
 * a surah's end continues into the next surah, to the end of the
 * Quran. Two pieces make that work: the parent preloads every
 * surah's texts in the background while nass mode is open, and the
 * scroll lands on the selected ayah's page when it opens (page 1
 * would strand anyone past Fatiha).
 *
 * Source-level locks (same pattern as hifz-nass-scroll.test.tsx):
 * the rendering itself is proven by the Playwright harness shots,
 * not here. These tests lock the wiring the harness cannot cheaply
 * re-derive.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relatives: string[]): string {
  for (const rel of relatives) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`none of ${relatives.join(', ')} found`);
}

function readStudy(): string {
  return read([
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]);
}

function readScroll(): string {
  return read([
    'apps/web/components/hifz-study/HifzNassScroll.tsx',
    'components/hifz-study/HifzNassScroll.tsx',
  ]);
}

function readFont(): string {
  return read([
    'apps/web/lib/quran-mushaf-font.ts',
    'lib/quran-mushaf-font.ts',
  ]);
}

describe('whole-Quran nass text preload (QuranHifzStudy)', () => {
  it('loads every other surah while nass mode is open, forward first then backward', () => {
    const src = readStudy();
    assert.match(src, /if \(displayMode !== 'nass' \|\| !nassRange\) return;/);
    // Forward first (the user scrolls down, into the next surahs),
    // then backward; the study surah ± 1 stay with the neighbour
    // effect above (the active page needs them first).
    assert.match(src, /for \(let s = surah \+ 2; s <= 114; s \+= 1\) order\.push\(s\)/);
    assert.match(src, /for \(let s = surah - 2; s >= 1; s -= 1\) order\.push\(s\)/);
  });

  it('retries dropped loads in a second pass and skips surahs already loaded', () => {
    const src = readStudy();
    assert.match(src, /for \(let pass = 0; pass < 2; pass \+= 1\)/);
    assert.match(src, /if \(textsBySurahRef\.current\[s\] !== undefined\) continue;/);
    assert.match(src, /const view = await getSurah\(s\);/);
  });

  it('the preload loop runs once per nass entry and cancels on leaving nass mode', () => {
    const src = readStudy();
    // No textsBySurah dep: a dep would cancel + restart the loop on
    // every load (113 restarts); the ref mirror covers loaded-ness.
    assert.match(src, /}, \[displayMode, surah, nassRange\]\);/);
    assert.match(src, /textsBySurahRef = useRef\(textsBySurah\)/);
  });
});

describe('whole-Quran nass landing (HifzNassScroll)', () => {
  it('scrolls to the selected ayah page once per surah, never on in-mode taps', () => {
    const src = readScroll();
    assert.match(src, /if \(lastScrolledSurahRef\.current === surah\) return;/);
    assert.match(src, /lastScrolledSurahRef = useRef<number \| null>\(null\)/);
  });

  it('the section observer stays alive so a revisited page reloads an evicted font', () => {
    const src = readScroll();
    const study = readStudy();
    // The 8-family cap evicts page fonts as the user scrolls the
    // whole Quran; a one-shot observer would leave a revisited page
    // rendering glyphs in the fallback font (wrong shapes) with a
    // stale fontLoaded=true. Toggling inView re-runs the asset
    // effect, which reloads the evicted font. The observer rides a
    // callback ref — a plain ref on the placeholder is lost when the
    // settled section mounts, so the settled section carries it
    // through renderPageSection's optional ref instead.
    assert.match(src, /setInView\(entries\.some\(\(e\) => e\.isIntersecting\)\)/);
    assert.doesNotMatch(src, /setInView\(true\);\s*io\.disconnect\(\)/);
    // The active page is observed too (user 2026-11-21): skipping
    // it left Fatiha p.1 with no way back once its font was evicted.
    assert.doesNotMatch(src, /if \(loadEagerly\) return;/);
    assert.match(src, /const observeSection = useCallback\(/);
    assert.match(src, /ioRef = useRef<IntersectionObserver \| null>\(null\)/);
    assert.match(src, /ref=\{observeSection\}/);
    assert.match(src, /observeSection,\n  \);/);
    assert.match(src, /sectionRef\?: \(el: HTMLElement \| null\) => void/);
    assert.match(study, /sectionRef\?: \(el: HTMLElement \| null\) => void/);
    assert.match(study, /ref=\{sectionRef\}/);
  });

  it('a page in view keeps its font: pinned while visible, observed like the rest', () => {
    const src = readScroll();
    const font = readFont();
    // User 2026-11-21: Fatiha p.1 rendered as broken fragments in
    // nass, and a refresh did not fix it — the preload cascade loads
    // a dozen page fonts on opening nass, evicting a visible page's
    // font (the oldest) within seconds. Pinning only the active page
    // left Baqarah p.2 broken in the same screenshot, so the pin
    // covers every page currently in view (the active page's inView
    // starts true). Leaving and re-entering view re-runs the asset
    // effect and reloads an evicted font.
    assert.match(src, /protectMushafFontFamily\(fontFamily\)/);
    assert.match(src, /unprotectMushafFontFamily\(fontFamily\)/);
    assert.match(src, /\[inView, fontFamily\]/);
    assert.match(src, /protectMushafFontFamily,/);
    assert.match(src, /unprotectMushafFontFamily,/);
    assert.match(font, /export function protectMushafFontFamily\(family: string\): void/);
    assert.match(font, /export function unprotectMushafFontFamily\(family: string\): void/);
    assert.match(font, /if \(protectedFamilies\.has\(family\)\) continue;/);
  });

  it('targets the active page section in DOM order and re-scrolls after neighbour expansion', () => {
    const src = readScroll();
    assert.match(src, /querySelectorAll\(':scope > section\.hifz-line-page'\)/);
    assert.match(src, /sections\[activePageIndex - \(pages\[0\] \?\? 0\)\]/);
    assert.match(src, /scrollIntoView\(\{ behavior: 'auto', block: 'start' \}\)/);
    assert.match(src, /window\.setTimeout\(scrollToActive, 800\)/);
    // A single delayed scroll lands early when the page above is
    // still expanding (harness: Baqarah 100 landed on p13, not
    // p15) — the poll re-scrolls once the neighbours settle, and a
    // manual wheel/touch/scroll-key stops all further correction.
    assert.match(src, /neighboursSettled/);
    assert.match(src, /querySelectorAll\('\.hifz-line-word'\)\.length > 0/);
    assert.match(src, /querySelector\('\.hifz-line-failed-note'\) !== null/);
    assert.match(src, /window\.setInterval\(/);
    assert.match(src, /Date\.now\(\) - startedAt > 15000/);
    assert.match(src, /userScrolledRef\.current/);
  });
});
