/**
 * Locking tests for the umum-reader display-prefs hydration fix
 * (React #418, 2026-11-11): the `prefs` useState initializer in
 * QuranReader.tsx used to merge loadDisplayPrefs() from localStorage
 * during render, so whenever a saved pref differed from the CRM
 * default the first client render differed from SSR HTML — prefs
 * feed the root div className (font/theme) and the
 * --quran-ayah-size style — and React discarded the SSR HTML
 * (#418). The initializer must return CRM defaults only on both
 * sides; the saved prefs apply in a mount effect (same pattern as
 * the hifz displayMode fix in PR #127). No DOM in this harness, so
 * the wiring is locked on source, like the hifz sheet tests; the
 * behaviour itself is proven by the Playwright harness shots.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readReader(): string {
  for (const rel of [
    'apps/web/components/QuranReader.tsx',
    'components/QuranReader.tsx',
  ]) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('QuranReader.tsx not found');
}

describe('QuranReader display prefs never mismatch SSR (#418)', () => {
  it('the prefs initializer returns CRM defaults only — no storage read during render', () => {
    const reader = readReader();
    // Object-literal initializer (no block body, no window check,
    // no loadDisplayPrefs merge). Before the fix this was a block
    // ending in `return { ...crm, ...(loadDisplayPrefs() ?? {}) };`.
    assert.match(
      reader,
      /const \[prefs, setPrefs\] = useState<DisplayPrefs>\(\(\) => \(\{/,
    );
    assert.doesNotMatch(
      reader,
      /return \{ \.\.\.crm, \.\.\.\(loadDisplayPrefs\(\) \?\? \{\}\) \};/,
    );
  });

  it('the saved prefs apply in a mount effect, after hydration', () => {
    const reader = readReader();
    assert.match(
      reader,
      /useEffect\(\(\) => \{\s*const saved = loadDisplayPrefs\(\);\s*if \(saved\) setPrefs\(\(prev\) => \(\{\s*\.\.\.prev,\s*\.\.\.saved\s*\}\)\);\s*\}, \[\]\);/,
    );
  });

  it('the CRM-default derivation is intact (font/theme/size/repeat still come from settings)', () => {
    const reader = readReader();
    assert.match(reader, /font: parseDisplayFont\(settings\.displayFont\)/);
    assert.match(reader, /theme: parseDisplayTheme\(settings\.displayTheme\)/);
    assert.match(reader, /fontSize: parseDisplayFontSize\(/);
  });
});
