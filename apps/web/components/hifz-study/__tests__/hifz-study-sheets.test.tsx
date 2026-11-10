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

describe('Recitation toolbar replaces the hifz bottom bar (user 2026-11-10)', () => {
  function readStudy(): string {
    const study = readFirst([
      'apps/web/components/QuranHifzStudy.tsx',
      'components/QuranHifzStudy.tsx',
    ]);
    assert.ok(study, 'QuranHifzStudy.tsx not found');
    return study;
  }

  function readCss(): string {
    const css = readFirst([
      'apps/web/app/[locale]/globals.css',
      'app/[locale]/globals.css',
    ]);
    assert.ok(css, 'globals.css not found');
    return css;
  }

  it('the old bottom bar is gone: no hifz-bottom-bar / hifz-bottom-btn / hifz-mic-3d / MicIcon / ErrorsHeadIcon', () => {
    const study = readStudy();
    assert.doesNotMatch(study, /hifz-bottom-bar/);
    assert.doesNotMatch(study, /hifz-bottom-btn/);
    assert.doesNotMatch(study, /hifz-mic-3d/);
    assert.doesNotMatch(study, /MicIcon/);
    assert.doesNotMatch(study, /ErrorsHeadIcon/);
    assert.doesNotMatch(study, /hifz-bottom-pill/);
  });

  it('the toolbar is dir=ltr with chevrons, pill, mic, eye and grid — every old control wired', () => {
    const study = readStudy();
    assert.match(study, /<div className="recitation-toolbar" dir="ltr" role="group"/);
    // Single chevron = peek next word (old ›), double = peek whole ayah (old »).
    assert.match(study, /onClick=\{\(\) => void peekNext\(\)\}/);
    assert.match(study, /onClick=\{\(\) => void peekAyah\(\)\}/);
    assert.match(study, /aria-label=\{labels\.peekWord\}/);
    assert.match(study, /aria-label=\{labels\.peekAyah\}/);
    assert.match(study, /disabled=\{!peekTarget\}/);
    // The pill is a real button with the old accuracy content that
    // opens the errors sheet (the old errors-icon button is gone).
    // Its numbers are Latin digits (user decision 2026-11-10
    // ~11:12: «100% | 0»), via the pill-only formatLatinDecimal —
    // the rest of the app keeps Eastern Arabic digits.
    assert.match(study, /<button[^>]*className=\{`progress-pill \$\{accuracyPillClass\(accuracyTone\)\}`\}/);
    assert.match(study, /onClick=\{\(\) => setErrorSheetOpen\(true\)\}/);
    assert.match(study, /formatLatinDecimal\(pillStats\.accuracy\)/);
    assert.match(study, /\{pillStats\.errors\}/);
    assert.doesNotMatch(study, /formatArabicIndicDecimal\(pillStats\.accuracy\)/);
    // The mic keeps every handler + the disabled rule + the
    // long-press mode switch, in the user's shell.
    assert.match(study, /className="mic-button"/);
    assert.match(study, /onClick=\{micOnClick\}/);
    assert.match(study, /onPointerDown=\{onMicPointerDown\}/);
    assert.match(study, /onPointerUp=\{clearMicLongPress\}/);
    assert.match(study, /disabled=\{studyMode === 'practice' && \(!authed \|\| micBusy \|\| modelUnavailable\)\}/);
    // Eye toggles the script; grid opens the display sheet.
    assert.match(study, /setScriptHidden\(\(v\) => !v\)/);
    assert.match(study, /onClick=\{\(\) => setDisplaySheetOpen\(true\)\}/);
    // The decor SVGs and the user's mic SVG are present verbatim.
    assert.match(study, /toolbar-decor toolbar-decor-left/);
    assert.match(study, /toolbar-decor toolbar-decor-right/);
    assert.match(study, /<rect x="18" y="3" width="12" height="31" rx="6" \/>/);
  });

  it('globals.css carries the user design verbatim (scoped) + fixed positioning + clearance', () => {
    const css = readCss();
    // The user's gradient, gold-ringed mic and mobile sizes.
    assert.match(css, /#b6e2ca 0%,/);
    assert.match(css, /#087d43 17%,/);
    assert.match(css, /#006535 43%,/);
    assert.match(css, /#00703a 65%,/);
    assert.match(css, /\.quran-hifz-study \.mic-button \{/);
    assert.match(css, /width: 166px;/);
    assert.match(css, /border: 9px solid var\(--gold\);/);
    assert.match(css, /height: 76px;/);
    // Mobile-only sizes, user decision 2026-11-10 ~10:22,
    // tightened 2026-11-10 ~11:26: the mic shrank 94px -> 78px
    // -> 74px so the accuracy pill («100% | 0») clears it, and
    // the chevron circles 42px -> 36px -> 34px (icons stay 22px,
    // bold like the desktop ones).
    assert.match(css, /width: 74px;/);
    assert.match(css, /\.quran-hifz-study \.toolbar-left \.tool-button \{\s*width: 34px;\s*height: 34px;\s*\}/);
    // Mobile-only packing, user decision 2026-11-10 ~11:26: the
    // left side packs from the left edge with a real gap instead
    // of space-evenly — with ~150px of content in a 153.5px track
    // the even gaps were ~1px and the two chevron circles touched
    // each other; the leftover space now lands between the pill
    // and the mic. NOTE: gap started at 5px but the first
    // measurement gave only 7px text-to-glow (target >=10), so
    // the gap is 4px and the pill min-width 56px.
    assert.match(css, /\.quran-hifz-study \.recitation-toolbar \.toolbar-left \{\s*justify-content: flex-start;\s*gap: 4px;\s*\}/);
    // Mobile-only shrink, user decision 2026-11-10 ~11:12
    // (corrected «نگیره» — the pill must NOT sit under the mic's
    // glow halo), tightened 2026-11-10 ~11:26: pill font 14px ->
    // 11px -> 10px, waveform 19px -> 14px, gap 4px -> 2px,
    // min-width 76px -> 58px -> 56px, so the Latin text clears
    // the halo. The rule MUST use the 4-class selector — the
    // toolbar-scoped `.recitation-toolbar .progress-pill
    // { font: inherit; }` (3-class) otherwise wins and the
    // font-size never applies (measured 15.6px inherited, text
    // still touching the halo).
    assert.match(css, /\.quran-hifz-study \.recitation-toolbar \.toolbar-left \.progress-pill \{\s*min-width: 56px;\s*height: 42px;\s*font-size: 10px;\s*gap: 2px;\s*\}/);
    assert.match(css, /\.quran-hifz-study \.waveform \{\s*width: 14px;\s*height: 13px;\s*\}/);
    // Icon-visibility fix (same decision): the pre-existing base
    // rule `.quran-hifz-study button` gives every button
    // `min-height: 44px` + `padding: 0 1rem`, which collapses the
    // small icon buttons' content box so the global
    // `max-inline-size: 100%` clamps the SVGs to 0px (chevrons
    // invisible) / 6px (eye, grid tiny) and stretches the circles
    // into ellipses. The toolbar resets both.
    assert.match(css, /\.quran-hifz-study \.recitation-toolbar \.tool-button \{\s*padding: 0;\s*min-height: 0;\s*\}/);
    // Integration only: fixed + bottom offset (never clipped by
    // the viewport edge) + clearance that clears the mic top.
    assert.match(css, /\.quran-hifz-study \.recitation-toolbar \{/);
    assert.match(css, /position: fixed;/);
    assert.match(css, /bottom: 15px;/);
    assert.match(css, /bottom: calc\(9px \+ env\(safe-area-inset-bottom\)\);/);
    // Grid-placement fix: the absolutely-positioned mic does not
    // occupy the centre column, so the side sections need explicit
    // columns or the right section lands under the mic.
    assert.match(css, /\.quran-hifz-study \.recitation-toolbar \.toolbar-left \{\s*grid-column: 1;\s*\}/);
    assert.match(css, /\.quran-hifz-study \.recitation-toolbar \.toolbar-right \{\s*grid-column: 3;\s*\}/);
    assert.match(css, /\.quran-hifz-study \{ padding-bottom: calc\(176px \+ env\(safe-area-inset-bottom\)\); \}/);
    assert.match(css, /body:has\(\.quran-hifz-study \.recitation-toolbar\) \.site-footer/);
    // No old bottom-bar rules survive.
    assert.doesNotMatch(css, /\.hifz-bottom-bar \{/);
    assert.doesNotMatch(css, /\.hifz-bottom-btn \{/);
    assert.doesNotMatch(css, /\.hifz-mic-3d \{/);
    assert.doesNotMatch(css, /hifz-mic-pulse/);
  });
});
