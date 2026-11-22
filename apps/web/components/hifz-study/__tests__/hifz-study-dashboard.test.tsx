/**
 * Tests for the hifz study dashboard (user 2026-11-22): the hamburger
 * opens a dashboard in the exact slot the session-setup panel occupied
 * (design 4: lively tiles + a 30-juz map), and the setup panel is
 * deleted — no range/repeat inputs, no listen controls, no reciter
 * picker (hifz users are reciters themselves; the reciter lives in
 * the umum section).
 *
 * The pure view renders from real dashboard data, so these tests render
 * it with a realistic payload via react-dom/server and assert all six
 * confirmed sections in DESIGN 4's exact form: green gradient header
 * with a goal ring and a gold streak pill, four pastel tiles, a week
 * card with weekday squares, a juz map with three discrete states
 * (solid green = done, amber frame = in progress, grey = not started),
 * icon rows with subtitles and pills/chips, and the gradient continue
 * button. (The first implementation kept the sections but dropped
 * this look — plain head, percentage fills, pill rows — and the user
 * called it out 2026-11-22; these tests lock the design-4 form.)
 * The container's fetching and the study-page wiring are locked by
 * source assertions; the visual proof is the Playwright harness.
 *
 * Run via the documented web-test harness (tsc to /tmp + node --test)
 * with cwd = repo root.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HifzStudyDashboard,
  HifzStudyDashboardView,
  type HifzStudyDashboardData,
} from '../HifzStudyDashboard';
import type { HifzStudyDashboardLabels } from '@/lib/hifz-study-types';

function readRel(candidates: string[]): string {
  for (const rel of candidates) {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`none of ${candidates.join(', ')} found`);
}

const readStudy = () =>
  readRel([
    'apps/web/components/QuranHifzStudy.tsx',
    'components/QuranHifzStudy.tsx',
  ]);
const readCss = () =>
  readRel(['apps/web/app/[locale]/globals.css', 'app/[locale]/globals.css']);
const readDashboard = () =>
  readRel([
    'apps/web/components/hifz-study/HifzStudyDashboard.tsx',
    'components/hifz-study/HifzStudyDashboard.tsx',
  ]);
const readMessages = (locale: string) =>
  readRel([`apps/web/messages/${locale}.json`, `messages/${locale}.json`]);

const labels = {
  title: 'DASH_TITLE',
  loading: 'DASH_LOADING',
  error: 'DASH_ERROR',
  refresh: 'DASH_REFRESH',
  close: 'DASH_CLOSE',
  signInHint: 'DASH_SIGNIN',
  todayTitle: 'DASH_TODAY',
  accuracy: 'DASH_ACC',
  wordsRead: 'DASH_WORDS',
  ayahsRead: 'DASH_AYAHS',
  errorsToday: 'DASH_ERRS',
  streakTitle: 'DASH_STREAK',
  daysUnit: 'DASH_DAYS',
  dailyGoal: 'DASH_GOAL',
  goalMet: 'DASH_GOALMET',
  weekTitle: 'DASH_WEEK',
  totalTitle: 'DASH_TOTAL',
  juzLabel: 'DASH_JUZ',
  reviewTitle: 'DASH_REVIEW',
  reviewEmpty: 'DASH_REVIEW_EMPTY',
  mistakesUnit: 'DASH_MISTAKES',
  weakTitle: 'DASH_WEAK',
  weakEmpty: 'DASH_WEAK_EMPTY',
  recentErrorsTitle: 'DASH_RECENT',
  continueTitle: 'DASH_CONTINUE',
  continueButton: 'DASH_CONTINUE_BTN',
  newSession: 'DASH_NEW',
  reviewReady: 'DASH_REVIEW_READY',
  goalToday: 'DASH_GOAL_TODAY',
  goalUnset: 'DASH_GOAL_UNSET',
  goalPerDay: 'DASH_GOAL_PER_DAY {goal}',
  ayahsReadGoal: 'DASH_READ_GOAL {today} / {goal}',
  ayahsReadToday: 'DASH_READ_TODAY {n}',
  remaining: 'DASH_REMAINING {n}',
  wordsUnit: 'DASH_WORDS_UNIT',
  ayahUnit: 'DASH_AYAH_UNIT',
  streakDays: 'DASH_STREAK_DAYS {n}',
  juzSummary: 'DASH_JUZ_SUMMARY {full} / {pct}',
  legendDone: 'DASH_LEGEND_DONE',
  legendCurrent: 'DASH_LEGEND_CURRENT {n}',
  legendTotal: 'DASH_LEGEND_TOTAL {clean}',
  lastReview: 'DASH_LAST_REVIEW',
  dueLabel: 'DASH_DUE_LABEL',
  daysAgo: 'DASH_DAYS_AGO {n}',
  yesterday: 'DASH_YESTERDAY',
  dueToday: 'DASH_DUE_TODAY',
  dueLate: 'DASH_DUE_LATE',
  needsReview: 'DASH_NEEDS_REVIEW',
  needsPractice: 'DASH_NEEDS_PRACTICE',
  mistakesLastSession: 'DASH_MISTAKES_LAST {n}',
  continueNow: 'DASH_CONTINUE_NOW',
  pageLabel: 'DASH_PAGE',
} as unknown as HifzStudyDashboardLabels;

const todayKey = new Date().toISOString().slice(0, 10);
const dayBefore = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

function payload(): HifzStudyDashboardData {
  const daily_series = Array.from({ length: 30 }, (_, i) => {
    const daysAgo = 29 - i;
    return {
      date: dayBefore(daysAgo),
      attempts: daysAgo === 0 ? 2 : daysAgo % 3 === 0 ? 1 : 0,
      graded_words: daysAgo === 0 ? 340 : daysAgo % 3 === 0 ? 120 : 0,
    };
  });
  const juz_progress = Array.from({ length: 30 }, (_, i) => {
    const juz = i + 1;
    return {
      juz,
      start_surah: juz === 30 ? 78 : 1,
      start_ayah: 1,
      total_ayahs: juz === 30 ? 564 : juz === 1 ? 148 : 111,
      clean_ayahs: juz === 30 || juz === 1 ? (juz === 30 ? 564 : 148) : juz === 2 ? 50 : 0,
    };
  });
  return {
    daily_series,
    streak_current: 14,
    streak_best: 21,
    goal_ayahs: 20,
    goal_today_ayahs: 12,
    goal_met: false,
    due_count: 18,
    due_ayahs: [
      { surah: 2, ayah: 255, mistake_count: 3, last_activity_at: `${dayBefore(0)}T05:00:00Z` },
      { surah: 36, ayah: 58, mistake_count: 5, last_activity_at: `${dayBefore(1)}T05:00:00Z` },
      { surah: 112, ayah: 1, mistake_count: 2, last_activity_at: `${dayBefore(4)}T05:00:00Z` },
      { surah: 67, ayah: 1, mistake_count: 1, last_activity_at: `${dayBefore(9)}T05:00:00Z` },
      { surah: 55, ayah: 1, mistake_count: 4, last_activity_at: `${dayBefore(6)}T05:00:00Z` },
      { surah: 18, ayah: 1, mistake_count: 1, last_activity_at: `${dayBefore(7)}T05:00:00Z` },
    ],
    weakest_ayahs: [
      { surah: 36, ayah: 58, mistake_count: 7 },
      { surah: 2, ayah: 255, mistake_count: 3 },
    ],
    today_counts: { correct: 9, close: 1, wrong: 2, skipped: 0 },
    juz_progress,
  };
}

const resume = {
  id: '7',
  surah: 2,
  start_ayah: 250,
  current_surah: 2,
  current_ayah: 255,
};

function renderView(data = payload(), res: typeof resume | null = resume) {
  return renderToStaticMarkup(
    <HifzStudyDashboardView
      data={data}
      resume={res}
      labels={labels}
      locale="fa"
      currentSurah={1}
      currentAyah={1}
      pageForAyah={() => 1}
      surahName={(n) => `SURAH_${n}`}
      onNavigate={() => undefined}
      onClose={() => undefined}
      onRefresh={() => undefined}
    />,
  );
}

describe('Hifz study dashboard (user 2026-11-22, design 4)', () => {
  it('renders all six confirmed sections in design-4 form', () => {
    const html = renderView();
    for (const key of [
      'hifz-dash-head',
      'hifz-dash-ring',
      'hifz-dash-streak',
      'hifz-dash-tiles',
      'DASH_WEEK',
      'DASH_TOTAL',
      'DASH_REVIEW',
      'DASH_WEAK',
      'DASH_CONTINUE_NOW',
      'DASH_NEW',
    ]) {
      assert.ok(html.includes(key), `${key} missing`);
    }
    // The old form is gone: no plain goal bar, no pill rows, no
    // separate recent-errors block (merged into the weak card).
    assert.ok(!html.includes('hifz-dash-goalbar'), 'old goal bar must be gone');
    assert.ok(!html.includes('hifz-dash-list'), 'old pill rows must be gone');
    assert.ok(!html.includes('DASH_RECENT'), 'separate recent-errors block must be gone');
  });

  it("today's tiles show the real numbers, never a fabricated zero", () => {
    const html = renderView();
    // 9 correct of 12 graded today = 75%; 340 words; 18 due; 2 errors.
    assert.ok(html.includes('٪۷۵'), 'accuracy 75% missing');
    assert.ok(html.includes('۳۴۰'), 'words today missing');
    assert.ok(html.includes('DASH_WORDS_UNIT'), 'words unit missing');
    assert.ok(html.includes('DASH_REVIEW_READY'), 'review-ready tile missing');
    assert.ok(html.includes('۱۸'), 'due count missing');
    assert.ok(html.includes('DASH_AYAH_UNIT'), 'ayah unit missing');
    assert.ok(html.includes('DASH_ERRS'), 'errors tile missing');
    // No words today: accuracy is a dash, not a fabricated 0%.
    const empty = payload();
    empty.today_counts = { correct: 0, close: 0, wrong: 0, skipped: 0 };
    empty.daily_series = empty.daily_series.map((d) =>
      d.date === todayKey ? { ...d, graded_words: 0 } : d,
    );
    const emptyHtml = renderView(empty);
    assert.ok(emptyHtml.includes('—'), 'no-words accuracy must be a dash');
    assert.ok(!emptyHtml.includes('٪۰'), 'no-words accuracy must not be 0%');
  });

  it('goal ring, streak pill and header lines come from the real data', () => {
    const html = renderView();
    // 12 of 20 = 60% on the ring.
    assert.ok(html.includes('٪۶۰'), 'ring must show 60%');
    assert.ok(html.includes('DASH_STREAK_DAYS ۱۴'), 'streak pill missing');
    assert.ok(html.includes('DASH_READ_GOAL ۱۲ / ۲۰'), 'header line 1 missing');
    assert.ok(html.includes('DASH_ACC: ٪۷۵'), 'header accuracy missing');
    assert.ok(html.includes('DASH_REMAINING ۸'), 'header remaining (20-12) missing');
    // Goal met: the header says so; no goal: it says the goal is unset.
    const met = payload();
    met.goal_met = true;
    met.goal_today_ayahs = 20;
    assert.ok(renderView(met).includes('DASH_GOALMET'), 'goal-met line missing');
    const unset = payload();
    unset.goal_ayahs = 0;
    unset.goal_today_ayahs = 0;
    const unsetHtml = renderView(unset);
    assert.ok(unsetHtml.includes('DASH_GOAL_UNSET'), 'unset-goal line missing');
    assert.ok(unsetHtml.includes('٪۰'), 'unset goal ring must be 0%');
  });

  it('the week card shows 7 weekday squares; done days get a check, today is amber', () => {
    const html = renderView();
    assert.equal(
      (html.match(/hifz-dash-week-day/g) || []).length,
      7,
      'week card must have 7 days',
    );
    assert.ok(html.includes('hifz-dash-week-sq--today'), 'today square missing');
    assert.ok(html.includes('DASH_DUE_TODAY'), 'today must be labelled today');
    // Last 7 days: graded on days-ago 6, 3 and 0; today shows its
    // letter, so exactly 2 check marks remain.
    assert.equal((html.match(/✓/g) || []).length, 2, 'exactly 2 done days');
  });

  it('the juz map has discrete states: 2 full, 1 in progress, the rest grey', () => {
    const html = renderView();
    assert.equal(
      (html.match(/class="hifz-dash-juz[ "]/g) || []).length,
      30,
      'juz map must have 30 tiles',
    );
    assert.equal(
      (html.match(/hifz-dash-juz--on/g) || []).length,
      2,
      'exactly juz 1 and 30 are full',
    );
    assert.equal(
      (html.match(/hifz-dash-juz--cur/g) || []).length,
      1,
      'exactly one juz in progress',
    );
    // Current ayah is 1:1 (juz 1, full), so the in-progress juz is
    // the first partial one: juz 2. Summary: 2 of 30, 762 clean of
    // 6236 = 12%.
    assert.ok(html.includes('DASH_JUZ_SUMMARY ۲ / ۱۲'), 'juz summary missing');
    assert.ok(html.includes('DASH_LEGEND_DONE'), 'legend (done) missing');
    assert.ok(html.includes('DASH_LEGEND_CURRENT ۲'), 'legend (current juz 2) missing');
    assert.ok(html.includes('DASH_LEGEND_TOTAL ۷۶۲'), 'legend (762 clean) missing');
    assert.ok(!html.includes('45%'), 'no percentage fills in the map any more');
  });

  it('review queue shows the top 5 due ayahs with subtitles and pills', () => {
    const html = renderView();
    assert.ok(html.includes('سورهٔ SURAH_2، آیهٔ ۲۵۵'), 'first due ayah missing');
    assert.ok(html.includes('سورهٔ SURAH_55، آیهٔ ۱'), 'fifth due ayah missing');
    assert.ok(!html.includes('SURAH_18'), 'sixth due ayah must be cut off');
    assert.ok(
      html.includes('DASH_LAST_REVIEW: DASH_DUE_TODAY'),
      'today subtitle missing',
    );
    assert.ok(
      html.includes('DASH_LAST_REVIEW: DASH_YESTERDAY'),
      'yesterday subtitle missing',
    );
    assert.ok(
      html.includes('DASH_LAST_REVIEW: DASH_DAYS_AGO ۴'),
      '4-days-ago subtitle missing',
    );
    // Legacy rows pill their mistake count.
    assert.ok(html.includes('۳ DASH_MISTAKES'), 'mistake pill missing');
    assert.equal(
      (html.match(/hifz-dash-due/g) || []).length,
      5,
      'five review pills',
    );
  });

  it('weak ayahs show the mistake count and when it happened', () => {
    const html = renderView();
    assert.ok(html.includes('SURAH_36، آیهٔ ۵۸'), 'weakest ayah missing');
    assert.equal(
      (html.match(/سورهٔ SURAH_36/g) || []).length,
      1,
      'only the review row prefixes the surah (design 4)',
    );
    assert.ok(html.includes('DASH_MISTAKES_LAST ۷'), 'weak subtitle missing');
    assert.ok(html.includes('۷ DASH_MISTAKES'), 'weak chip missing');
    assert.equal(
      (html.match(/hifz-dash-chip--rose/g) || []).length,
      1,
      'worst row is rose',
    );
    assert.equal(
      (html.match(/hifz-dash-chip--amber/g) || []).length,
      1,
      'other rows are amber',
    );
  });

  it('SRS-shaped due rows (no mistake count) render with a due pill', () => {
    // The API mixes two due shapes: SRS rows {due_at, source: 'srs'}
    // carry no mistake_count/last_activity_at, legacy rows do. Both
    // must render — the SRS row pills its due status.
    const data = payload();
    data.due_ayahs = [
      { surah: 18, ayah: 1, due_at: `${todayKey}T05:00:00Z`, source: 'srs' },
      { surah: 55, ayah: 1, due_at: `${dayBefore(2)}T05:00:00Z`, source: 'srs' },
      ...data.due_ayahs,
    ];
    const html = renderView(data);
    assert.ok(html.includes('سورهٔ SURAH_18، آیهٔ ۱'), 'SRS due row must render');
    assert.ok(
      html.includes('DASH_DUE_LABEL: DASH_DUE_TODAY'),
      'SRS subtitle must be its due date',
    );
    assert.ok(html.includes('DASH_DUE_TODAY'), 'due-today pill missing');
    assert.ok(html.includes('DASH_DUE_LATE'), 'overdue pill missing');
  });

  it('the continue button points at the resumable session, with its page', () => {
    const html = renderView();
    assert.ok(html.includes('DASH_CONTINUE_NOW'), 'continue button missing');
    assert.ok(
      html.includes('سورهٔ SURAH_2، آیهٔ ۲۵۵ · DASH_PAGE ۱'),
      'continue subtitle with page missing',
    );
    const none = renderView(payload(), null);
    assert.ok(
      none.includes('سورهٔ SURAH_1، آیهٔ ۱'),
      'without a resume the button targets the current ayah',
    );
    assert.ok(!none.includes('DASH_CONTINUE_BTN'), 'old resume banner must be gone');
  });

  it('guest sees only the sign-in hint; signed-in starts loading', () => {
    const guest = renderToStaticMarkup(
      <HifzStudyDashboard
        labels={labels}
        authed={false}
        locale="fa"
        currentSurah={1}
        currentAyah={1}
        surahName={(n) => `SURAH_${n}`}
        onNavigate={() => undefined}
        onClose={() => undefined}
      />,
    );
    assert.ok(guest.includes('DASH_SIGNIN'), 'guest hint missing');
    assert.ok(!guest.includes('DASH_TODAY'), 'guest must see no sections');
    const loading = renderToStaticMarkup(
      <HifzStudyDashboard
        labels={labels}
        authed
        locale="fa"
        currentSurah={1}
        currentAyah={1}
        surahName={(n) => `SURAH_${n}`}
        onNavigate={() => undefined}
        onClose={() => undefined}
      />,
    );
    assert.ok(loading.includes('DASH_LOADING'), 'loading state missing');
  });

  it('the container fetches the dashboard + resume, never sample data', () => {
    const dash = readDashboard();
    assert.match(dash, /authJson<HifzStudyDashboardData>\(`\$\{HIFZ_API\}\/dashboard`\)/);
    assert.match(dash, /authJson<HifzStudyResumeAttempt \| null>\(\s*`\$\{HIFZ_API\}\/attempts\/resume`,?\s*\)\.catch\(\(\) => null\)/);
    assert.match(dash, /sortedJuz\.map\(/);
    assert.doesNotMatch(dash, /JUZ_STARTS/);
  });

  it('the hamburger opens the dashboard in the panel slot; the setup panel is gone', () => {
    const study = readStudy();
    assert.match(study, /const \[dashboardOpen, setDashboardOpen\] = useState\(false\);/);
    assert.match(study, /menuOpen=\{dashboardOpen\}/);
    assert.match(study, /onOpenMenu=\{\(\) => setDashboardOpen\(\(v\) => !v\)\}/);
    assert.match(study, /<HifzStudyDashboard\s+labels=\{labels\.dashboard\}/);
    assert.match(study, /onNavigate=\{jumpToDashboardAyah\}/);
    assert.match(study, /locale=\{locale\}/);
    assert.match(study, /currentSurah=\{surah\}/);
    assert.match(study, /currentAyah=\{ayah\}/);
    assert.match(study, /pageForAyah=\{dashboardPageForAyah\}/);
    assert.doesNotMatch(study, /setupOpen/);
    assert.doesNotMatch(study, /hifz-setup/);
    assert.doesNotMatch(study, /HifzNumericInput/);
    assert.doesNotMatch(study, /hifz-range/);
    assert.doesNotMatch(study, /hifz-listen-controls/);
    const css = readCss();
    assert.match(
      css,
      /\.quran-hifz-study\.hifz-mode-mushaf:not\(\.hifz-has-wall\) \.hifz-dashboard-panel\.is-open \{\s*position: fixed;\s*top: 57px;/,
    );
    assert.match(css, /background: #f2f6f1;/);
    assert.match(css, /linear-gradient\(140deg,#0d5c3a/);
    assert.match(css, /\.hifz-dash-juz--cur/);
    assert.doesNotMatch(css, /hifz-setup/);
    assert.doesNotMatch(css, /hifz-picker/);
    assert.doesNotMatch(css, /hifz-range/);
    assert.doesNotMatch(css, /hifz-listen-controls/);
    assert.doesNotMatch(css, /hifz-dash-juz--full/);
    assert.doesNotMatch(css, /hifz-dash-list/);
    assert.doesNotMatch(css, /hifz-dash-goalbar/);
  });

  it('dashboard labels exist in all three locales', () => {
    for (const locale of ['fa', 'ar', 'en']) {
      const messages = JSON.parse(readMessages(locale)) as Record<string, unknown>;
      const quran = messages.quran as Record<string, unknown>;
      for (const key of [
        'hifzDashboardTitle',
        'hifzDashboardLoading',
        'hifzDashboardError',
        'hifzDashboardRefresh',
        'hifzDashboardClose',
        'hifzDashboardToday',
        'hifzDashboardAccuracy',
        'hifzDashboardWords',
        'hifzDashboardAyahs',
        'hifzDashboardErrors',
        'hifzDashboardStreak',
        'hifzDashboardDays',
        'hifzDashboardGoal',
        'hifzDashboardGoalMet',
        'hifzDashboardWeek',
        'hifzDashboardTotal',
        'hifzDashboardJuz',
        'hifzDashboardReview',
        'hifzDashboardReviewEmpty',
        'hifzDashboardMistakes',
        'hifzDashboardWeak',
        'hifzDashboardWeakEmpty',
        'hifzDashboardRecentErrors',
        'hifzDashboardContinue',
        'hifzDashboardContinueButton',
        'hifzDashboardNewSession',
        'hifzDashboardReviewReady',
        'hifzDashboardGoalToday',
        'hifzDashboardGoalUnset',
        'hifzDashboardGoalPerDay',
        'hifzDashboardAyahsReadGoal',
        'hifzDashboardAyahsReadToday',
        'hifzDashboardRemaining',
        'hifzDashboardWordsUnit',
        'hifzDashboardAyahUnit',
        'hifzDashboardStreakDays',
        'hifzDashboardJuzSummary',
        'hifzDashboardLegendDone',
        'hifzDashboardLegendCurrent',
        'hifzDashboardLegendTotal',
        'hifzDashboardLastReview',
        'hifzDashboardDueLabel',
        'hifzDashboardDaysAgo',
        'hifzDashboardYesterday',
        'hifzDashboardDueToday',
        'hifzDashboardDueLate',
        'hifzDashboardNeedsReview',
        'hifzDashboardNeedsPractice',
        'hifzDashboardMistakesLastSession',
        'hifzDashboardContinueNow',
        'hifzDashboardPageLabel',
      ]) {
        assert.ok(key in quran, `${locale}: ${key} missing`);
      }
    }
  });
});
