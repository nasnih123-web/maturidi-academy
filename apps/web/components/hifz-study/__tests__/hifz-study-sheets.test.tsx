/**
 * Render tests for the extracted hifz-study sheets (refactor steps
 * 6-7): HifzErrorSheet, HifzLivePills, HifzStudyHeader. These are
 * presentational-only moves of verbatim JSX from
 * QuranHifzStudy.tsx, so the tests render them with fake props via
 * react-dom/server and assert the moved markup (classes, labels,
 * values, branches) is intact. No component runner exists in the
 * repo; run via the documented web-test harness (tsc to /tmp +
 * node --test) with the sheets tsconfig:
 *
 *   tsc -p /tmp/web-sheets-test/tsconfig.json
 *   NODE_PATH=$PWD/apps/web/node_modules node --test /tmp/web-sheets-test/out/__tests__/hifz-study-sheets.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { HifzErrorSheet } from '../HifzErrorSheet';
import { ErrorsHeadIcon } from '../HifzErrorsIcon';
import { HifzStudyHeader } from '../HifzStudyHeader';
import { HifzLivePills } from '../HifzLivePills';
import type { HifzLabels, HifzMistakeGroup } from '@/lib/hifz-study-types';

const labels = {
  errorsTitle: 'ERR_TITLE',
  errorsClose: 'ERR_CLOSE',
  errorsEmpty: 'ERR_EMPTY',
  errorsWrong: 'ERR_WRONG',
  errorsExtra: 'ERR_EXTRA',
  errorsTransposed: 'ERR_TRANSPOSED',
  errorsExpected: 'ERR_EXPECTED',
  errorsHeard: 'ERR_HEARD',
  errorsDelete: 'ERR_DELETE',
  errorsLearn: 'ERR_LEARN',
  title: 'HDR_TITLE',
  headerPage: 'HDR_PAGE',
  headerJuz: 'HDR_JUZ',
  headerHizb: 'HDR_HIZB',
  menuOpen: 'HDR_MENU',
  searchOpen: 'HDR_SEARCH',
  searchTitle: 'HDR_SEARCH_TITLE',
  bookmarkAdd: 'HDR_BKM_ADD',
  bookmarkRemove: 'HDR_BKM_REMOVE',
  pickerLabel: 'HDR_PICKER',
  settingsOpen: 'HDR_SETTINGS',
  pillErrors: 'PILL_ERR',
  pillAccuracy: 'PILL_ACC',
  pillTimer: 'PILL_TIMER',
} as unknown as HifzLabels;

function renderSheet(props: Partial<Parameters<typeof HifzErrorSheet>[0]> = {}) {
  return renderToStaticMarkup(
    <HifzErrorSheet
      open
      groups={null}
      errorWords={[]}
      liveExtraWords={[]}
      liveExtraCount={0}
      surah={1}
      labels={labels}
      onDelete={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe('HifzErrorSheet (refactor step 6)', () => {
  it('renders nothing when closed', () => {
    assert.equal(renderSheet({ open: false }), '');
  });

  it('fallback cards: wrong words (expected vs heard) + extra words', () => {
    const html = renderSheet({
      errorWords: [{ ayah: 2, index: 0, expected: 'EXPECTED_WORD', heard: 'HEARD_WORD' }],
      liveExtraWords: ['EXTRA_WORD'],
      liveExtraCount: 1,
    });
    assert.match(html, /hifz-error-sheet/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /ERR_TITLE/);
    assert.match(html, /EXPECTED_WORD/);
    assert.match(html, /HEARD_WORD/);
    assert.match(html, /EXTRA_WORD/);
    assert.match(html, /ERR_LEARN/);
    assert.match(html, /ERR_EXPECTED/);
  });

  it('fallback cards: empty state when there is nothing to show', () => {
    const html = renderSheet();
    assert.match(html, /ERR_EMPTY/);
  });

  it('server groups: one card per ayah with delete per item', () => {
    const groups: HifzMistakeGroup[] = [
      {
        surah: 1,
        ayah: 2,
        category: 'wrong_words',
        items: [
          {
            id: 'm1',
            mistake_type: 'wrong',
            word_index: 0,
            expected_text: 'GROUP_EXPECTED',
            heard: 'GROUP_HEARD',
            created_at: '2026-01-01',
          },
        ],
      },
    ];
    const html = renderSheet({ groups });
    assert.match(html, /GROUP_EXPECTED/);
    assert.match(html, /GROUP_HEARD/);
    assert.match(html, /hifz-error-delete/);
    assert.match(html, /ERR_DELETE/);
    assert.match(html, /ERR_WRONG/);
    assert.match(html, /hifz-error-card-chip/);
  });

  it('server groups: empty list shows the empty state', () => {
    const html = renderSheet({ groups: [] });
    assert.match(html, /ERR_EMPTY/);
    assert.match(html, /hifz-error-empty-icon/);
  });

  it('ErrorsHeadIcon renders the green head-with-check', () => {
    const html = renderToStaticMarkup(<ErrorsHeadIcon />);
    assert.match(html, /<svg/);
    assert.match(html, /#22c55e/);
    assert.match(html, /#15803d/);
  });

  it('server groups: transposed items show the transposed note', () => {
    const groups: HifzMistakeGroup[] = [
      {
        surah: 1,
        ayah: 3,
        category: 'wrong_words',
        items: [
          {
            id: 'm2',
            mistake_type: 'transposed',
            word_index: 1,
            expected_text: 'TRANSPOSED_EXPECTED',
            heard: null,
            created_at: '2026-01-01',
          },
        ],
      },
    ];
    const html = renderSheet({ groups });
    assert.match(html, /ERR_TRANSPOSED/);
    assert.match(html, /TRANSPOSED_EXPECTED/);
  });
});

describe('HifzStudyHeader (Tarteel top bar, 2026-11-08)', () => {
  function renderHeader(props: Partial<Parameters<typeof HifzStudyHeader>[0]> = {}) {
    return renderToStaticMarkup(
      <HifzStudyHeader
        surahName="SURAH_NAME"
        headerMeta={{ page: 1, juz: 1, hizb: 1 }}
        liveActive
        surah={1}
        ayah={3}
        labels={labels}
        menuOpen={false}
        onOpenMenu={() => {}}
        onOpenSearch={() => {}}
        bookmarked={false}
        onToggleBookmark={() => {}}
        onOpenPicker={() => {}}
        onOpenSettings={() => {}}
        {...props}
      />,
    );
  }

  it('row 1: hamburger + surah card (sura prefix + meta + live position) + search + gear, no page title', () => {
    const html = renderHeader();
    assert.doesNotMatch(html, /HDR_TITLE/);
    assert.doesNotMatch(html, /hifz-title/);
    assert.match(html, /سُورَةُ SURAH_NAME/);
    assert.match(html, /HDR_PAGE ١/);
    assert.match(html, /HDR_JUZ ١/);
    assert.match(html, /HDR_HIZB ١/);
    assert.match(html, /hifz-header-pos/);
    assert.match(html, /١:٣/);
    assert.match(html, /HDR_MENU/);
    assert.match(html, /HDR_SEARCH/);
    assert.match(html, /HDR_SETTINGS/);
    assert.match(html, /HDR_BKM_ADD/);
    assert.doesNotMatch(html, /HDR_BKM_REMOVE/);
  });

  it('bookmark filled state: remove label + aria-pressed=true', () => {
    const html = renderHeader({ bookmarked: true });
    assert.match(html, /HDR_BKM_REMOVE/);
    assert.match(html, /aria-pressed="true"/);
  });

  it('no bookmark icon when no page is on screen (bookmarked=null)', () => {
    const html = renderHeader({ bookmarked: null });
    assert.doesNotMatch(html, /HDR_BKM_ADD/);
    assert.doesNotMatch(html, /HDR_BKM_REMOVE/);
    assert.doesNotMatch(html, /hifz-header-bookmark/);
  });

  it('no meta and no position when nothing is known / not live', () => {
    const html = renderHeader({ headerMeta: null, liveActive: false });
    assert.doesNotMatch(html, /HDR_TITLE/);
    assert.match(html, /SURAH_NAME/);
    assert.doesNotMatch(html, /hifz-header-meta/);
    assert.doesNotMatch(html, /hifz-header-pos/);
  });

  it('surah card text is a real button opening the Quran index sheet (user 2026-11-10)', () => {
    const html = renderHeader();
    // Real <button type="button"> with the picker dialog semantics,
    // wrapping the surah name + meta (never a span with onClick).
    assert.match(html, /<button[^>]*class="hifz-header-text"[^>]*>/);
    assert.match(html, /<button[^>]*hifz-header-text[^>]*aria-haspopup="dialog"[^>]*>/);
    assert.match(html, /<button[^>]*hifz-header-text[^>]*aria-label="HDR_PICKER"[^>]*>/);
    assert.match(html, /سُورَةُ SURAH_NAME/);
    assert.match(html, /HDR_PAGE ١/);
    // The bookmark stays a SEPARATE button, a sibling inside the
    // pill — the card button must close before it opens, so the
    // two buttons are never nested.
    const textClose = html.indexOf('</button>', html.indexOf('hifz-header-text'));
    const bookmarkAt = html.indexOf('hifz-header-bookmark');
    assert.ok(textClose !== -1 && bookmarkAt > textClose, 'bookmark must sit after the card button closes (sibling, never nested)');
    assert.match(html, /<button[^>]*class="hifz-header-bookmark"[^>]*aria-pressed="false"/);
  });
});

/** First existing candidate wins (repo root or apps/web cwd) — the
    same helper the wave-2 tests use. Static wiring checks: the
    card's onClick, the hifz-owned sheet, and the ?tab=hifz links
    (no DOM in this harness, so clicks are proven by the Playwright
    shots, not here). */
function readFirst(candidates: string[]): string | null {
  for (const rel of candidates) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

describe('Surah card opens the hifz-owned Quran picker (user 2026-11-10)', () => {
  it('header wires the card button to onOpenPicker; the study owns the sheet and stays in hifz', () => {
    const header = readFirst([
      'apps/web/components/hifz-study/HifzStudyHeader.tsx',
      'components/hifz-study/HifzStudyHeader.tsx',
    ]);
    assert.ok(header, 'HifzStudyHeader.tsx not found');
    assert.match(header, /onClick=\{onOpenPicker\}/);
    const study = readFirst([
      'apps/web/components/QuranHifzStudy.tsx',
      'components/QuranHifzStudy.tsx',
    ]);
    assert.ok(study, 'QuranHifzStudy.tsx not found');
    assert.match(study, /onOpenPicker=\{\(\) => setPickerOpen\(true\)\}/);
    assert.match(study, /<QuranPickerSheet/);
    assert.match(study, /onSelectRange=\{jumpToPickerRange\}/);
    assert.match(study, /surahHref=\{\(n\) => `\/\$\{locale\}\/quran\/\$\{n\}\?tab=hifz`\}/);
    assert.match(study, /setPickerOpen\(false\)/);
    // Range jump resolves the range's first page to its first ayah
    // (V2 pageFirstAyahs, boundaries fallback) and moves the surah
    // too when the range starts in another surah.
    assert.match(study, /pageFirstAyahs\.find\(\(\[, , p\]\) => p === firstPage\)/);
    assert.match(study, /resumeAyahRef\.current = first\.ayah;/);
  });

  it('the hifz labels carry the picker labels (page.tsx passes the same values as the reader)', () => {
    const page = readFirst([
      'apps/web/app/[locale]/quran/[surah]/page.tsx',
      'app/[locale]/quran/[surah]/page.tsx',
    ]);
    assert.ok(page, 'page.tsx not found');
    assert.match(page, /pickerLabel: t\('pickerLabel'\)/);
    assert.match(page, /picker: \{/);
    assert.match(page, /title: t\('pickerTitle'\)/);
    assert.match(page, /noResults: t\('noResults'\)/);
    assert.match(page, /loading: t\('rangeLoading'\)/);
  });
});

describe('HifzLivePills (refactor step 7)', () => {
  const stats = { errors: 2, accuracy: 98.5, total: 10, correct: 8, peeked: 0 };

  function renderPills(props: Partial<Parameters<typeof HifzLivePills>[0]> = {}) {
    return renderToStaticMarkup(
      <HifzLivePills
        visible
        stats={stats}
        accuracyTone="lime"
        liveWordsPresent={false}
        showTimer
        timerText="٠١:٢٣"
        labels={labels}
        {...props}
      />,
    );
  }

  it('renders nothing when hidden', () => {
    assert.equal(renderPills({ visible: false }), '');
  });

  it('percent branch: errors + accuracy percent + timer', () => {
    const html = renderPills();
    assert.match(html, /hifz-pills/);
    assert.match(html, /PILL_ERR/);
    assert.match(html, /hifz-pill-lime/);
    assert.match(html, /٩٨٫٥٪/);
    assert.match(html, /hifz-pill-timer/);
    assert.match(html, /٠١:٢٣/);
  });

  it('count branch while live words are present: no percent', () => {
    const html = renderPills({ liveWordsPresent: true });
    assert.match(html, /٨ از ١٠/);
    assert.doesNotMatch(html, /٪/);
  });

  it('timer hidden when not listening', () => {
    assert.doesNotMatch(renderPills({ showTimer: false }), /hifz-pill-timer/);
  });
});
