/**
 * HifzStudyDashboard — the hifz dashboard behind the hamburger on the
 * study page (design 4: lively tiles + a 30-juz map).
 *
 * Only real numbers, from GET /hifz/dashboard (+ the resumable attempt):
 * today's accuracy/words/review-ready/errors, streak + daily goal +
 * the last 7 days, clean juz out of 30, the review queue, the weakest
 * ayahs with the most recent errors, and continue / new session. No
 * sample data: a section with no data shows its empty state, never
 * invented numbers. Guests see the sign-in hint; the dashboard fetches
 * only when opened. Tapping an ayah row (review, weak, continue, or
 * a juz tile) jumps to that ayah on the study page, like the picker
 * does.
 *
 * LOOK (2026-11-22 restyle): the first implementation kept the six
 * sections and the data but DROPPED the chosen design's look — plain
 * head, percentage-filled juz tiles, pill rows — and the user rightly
 * called it out. This version follows design 4's artifact exactly:
 * green gradient header with a goal ring and a gold streak pill, four
 * pastel tiles with icons, white cards, weekday squares, a juz map
 * with three discrete states (solid green = done, amber frame =
 * in progress, grey = not started), icon rows with subtitles and
 * pills/chips, and the gradient continue button. Digits follow the
 * locale (Persian in fa, Arabic-Indic in ar, Latin in en).
 */
import { useCallback, useEffect, useState } from 'react';
import { authJson } from '@/lib/auth-client';
import { toArabicIndic } from '@/lib/quran-print-lines';
import type { HifzStudyDashboardLabels } from '@/lib/hifz-study-types';

const HIFZ_API = '/api/v1/quran/hifz';

/** Ring circumference for r=35 (design 4): 2π×35 = 219.9. */
const RING_CIRCUMFERENCE = 219.9;

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toFa(value: number | string): string {
  return String(value).replace(/[0-9٠-٩]/g, (d) => {
    const i = '0123456789٠١٢٣٤٥٦٧٨٩'.indexOf(d);
    return i >= 0 ? FA_DIGITS[i % 10] : d;
  });
}

interface HifzStudyDashboardCounts {
  correct: number;
  close: number;
  wrong: number;
  skipped: number;
}

interface HifzStudyDashboardDay {
  date: string;
  attempts: number;
  graded_words: number;
}

/**
 * One due ayah from GET /hifz/dashboard. Two shapes arrive mixed:
 * SRS rows {surah, ayah, due_at, source: 'srs'} carry no mistake
 * count; legacy mistake rows {surah, ayah, mistake_count,
 * last_activity_at, source: 'mistakes'} carry no due_at. Both must
 * render — the pill and the subtitle only exist for the fields the
 * row actually carries.
 */
interface HifzStudyDashboardDue {
  surah: number;
  ayah: number;
  mistake_count?: number;
  last_activity_at?: string;
  due_at?: string;
  source?: string;
}

interface HifzStudyDashboardJuz {
  juz: number;
  start_surah: number;
  start_ayah: number;
  total_ayahs: number;
  clean_ayahs: number;
}

export interface HifzStudyDashboardData {
  today_counts: HifzStudyDashboardCounts;
  daily_series: HifzStudyDashboardDay[];
  streak_current: number;
  streak_best: number;
  goal_ayahs: number;
  goal_today_ayahs: number;
  goal_met: boolean;
  due_count: number;
  due_ayahs: HifzStudyDashboardDue[];
  weakest_ayahs: { surah: number; ayah: number; mistake_count: number }[];
  juz_progress: HifzStudyDashboardJuz[];
}

export interface HifzStudyResumeAttempt {
  id: string;
  surah: number;
  start_ayah: number | null;
  current_surah: number | null;
  current_ayah: number | null;
}

function fill(
  template: string,
  vars: Record<string, string | number>,
): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    template,
  );
}

const TARGET_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </svg>
);

const BOOK_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
    <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
  </svg>
);

const WARNING_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <circle cx="12" cy="17" r=".5" fill="currentColor" />
  </svg>
);

const FLAME_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="#5c2e00"
    aria-hidden="true"
  >
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

/**
 * Pure view: all six sections from real dashboard data (no fetch here,
 * so tests render it directly with a realistic payload).
 */
export function HifzStudyDashboardView({
  data,
  resume,
  labels,
  locale,
  currentSurah,
  currentAyah,
  pageForAyah,
  surahName,
  onNavigate,
  onClose,
  onRefresh,
}: {
  data: HifzStudyDashboardData;
  resume: HifzStudyResumeAttempt | null;
  labels: HifzStudyDashboardLabels;
  locale: string;
  currentSurah: number;
  currentAyah: number;
  pageForAyah?: (surah: number, ayah: number) => number | null;
  surahName: (surah: number) => string;
  onNavigate: (surah: number, ayah: number) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const digits = (n: number): string =>
    locale === 'en'
      ? String(n)
      : locale === 'ar'
        ? toArabicIndic(n)
        : toFa(n);
  const pctText = (n: number): string =>
    locale === 'en' ? `${n}%` : `٪${digits(n)}`;
  const localeTag =
    locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar' : 'en';
  const weekdayFmt = new Intl.DateTimeFormat(localeTag, {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const shortDateFmt = new Intl.DateTimeFormat(localeTag, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  // Today's progress: the UTC date the API series uses.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayDay = data.daily_series.find((d) => d.date === todayKey);
  const todayWords = todayDay?.graded_words ?? 0;
  const todayTotal =
    data.today_counts.correct +
    data.today_counts.close +
    data.today_counts.wrong +
    data.today_counts.skipped;
  const todayAccuracy =
    todayTotal > 0
      ? Math.round((100 * data.today_counts.correct) / todayTotal)
      : null;
  const todayErrors = data.today_counts.wrong + data.today_counts.skipped;
  const week = data.daily_series.slice(-7);

  // Goal ring: share of the daily goal read today (design 4's ring).
  const goalPct =
    data.goal_ayahs > 0
      ? Math.min(
          100,
          Math.round((100 * data.goal_today_ayahs) / data.goal_ayahs),
        )
      : 0;
  const remaining = Math.max(0, data.goal_ayahs - data.goal_today_ayahs);
  const headLine1 =
    data.goal_ayahs > 0
      ? fill(labels.ayahsReadGoal, {
          today: digits(data.goal_today_ayahs),
          goal: digits(data.goal_ayahs),
        })
      : fill(labels.ayahsReadToday, { n: digits(data.goal_today_ayahs) });
  const headLine2 = data.goal_met
    ? labels.goalMet
    : data.goal_ayahs === 0
      ? labels.goalUnset
      : todayAccuracy === null
        ? fill(labels.remaining, { n: digits(remaining) })
        : `${labels.accuracy}: ${pctText(todayAccuracy)} · ${fill(labels.remaining, { n: digits(remaining) })}`;

  // Juz map: fully-clean juz (solid green) + the juz in progress
  // (amber frame) — the juz of the current study ayah when it is not
  // fully clean yet, else the first partially-clean juz.
  const sortedJuz = [...data.juz_progress].sort((a, b) => a.juz - b.juz);
  const cleanJuz = sortedJuz.filter(
    (j) => j.total_ayahs > 0 && j.clean_ayahs >= j.total_ayahs,
  ).length;
  const totalClean = sortedJuz.reduce((s, j) => s + j.clean_ayahs, 0);
  const juzPct =
    totalClean > 0 ? Math.round((100 * totalClean) / 6236) : 0;
  const isFull = (j: HifzStudyDashboardJuz): boolean =>
    j.total_ayahs > 0 && j.clean_ayahs >= j.total_ayahs;
  let currentJuz = sortedJuz[sortedJuz.length - 1]?.juz ?? 1;
  for (const j of sortedJuz) {
    if (
      j.start_surah < currentSurah ||
      (j.start_surah === currentSurah && j.start_ayah <= currentAyah)
    ) {
      currentJuz = j.juz;
    } else {
      break;
    }
  }
  const inProgressJuz = isFull(
    sortedJuz.find((j) => j.juz === currentJuz) ?? sortedJuz[0],
  )
    ? sortedJuz.find((j) => !isFull(j) && j.clean_ayahs > 0)?.juz
    : currentJuz;

  // Relative day text for a UTC date: today / yesterday / N days ago
  // (future dates fall back to a short date — they should not occur
  // for past activity, only for due dates).
  const dayDiff = (dateStr: string): number =>
    Math.round(
      (Date.parse(`${todayKey}T00:00:00Z`) -
        Date.parse(`${dateStr}T00:00:00Z`)) /
        86_400_000,
    );
  const relativeDay = (dateStr: string): string => {
    const diff = dayDiff(dateStr);
    if (diff <= 0) {
      return diff === 0
        ? labels.dueToday
        : shortDateFmt.format(new Date(`${dateStr}T00:00:00Z`));
    }
    if (diff === 1) return labels.yesterday;
    return fill(labels.daysAgo, { n: digits(diff) });
  };

  // Review-row pill: SRS rows show their due status, legacy rows
  // show their mistake count (they carry no due date), rows with
  // neither show that a review is needed.
  const reviewPill = (
    a: HifzStudyDashboardDue,
  ): { text: string; late: boolean } => {
    if (a.due_at !== undefined) {
      const diff = dayDiff(a.due_at.slice(0, 10));
      if (diff > 0) return { text: labels.dueLate, late: true };
      if (diff === 0) return { text: labels.dueToday, late: false };
      return {
        text: shortDateFmt.format(
          new Date(`${a.due_at.slice(0, 10)}T00:00:00Z`),
        ),
        late: false,
      };
    }
    if (a.mistake_count !== undefined) {
      return {
        text: `${digits(a.mistake_count)} ${labels.mistakesUnit}`,
        late: false,
      };
    }
    return { text: labels.needsReview, late: false };
  };
  const reviewSubtitle = (a: HifzStudyDashboardDue): string => {
    if (a.last_activity_at !== undefined) {
      return `${labels.lastReview}: ${relativeDay(a.last_activity_at.slice(0, 10))}`;
    }
    if (a.due_at !== undefined) {
      return `${labels.dueLabel}: ${relativeDay(a.due_at.slice(0, 10))}`;
    }
    return labels.needsReview;
  };

  const resumeSurah = resume?.current_surah ?? resume?.surah;
  const resumeAyah = resume?.current_ayah ?? resume?.start_ayah ?? 1;
  const targetSurah = resumeSurah ?? currentSurah;
  const targetAyah = resumeSurah === undefined ? currentAyah : resumeAyah;
  const targetPage = pageForAyah?.(targetSurah, targetAyah) ?? null;

  const reviewRows = data.due_ayahs.slice(0, 5);
  const weakRows = data.weakest_ayahs.slice(0, 5);

  return (
    <section
      className="hifz-dashboard-panel is-open"
      aria-label={labels.title}
    >
      {/* Design-4 header: green gradient, goal ring, streak pill. */}
      <div className="hifz-dash-head">
        <div className="hifz-dash-head-top">
          <h2>{labels.title}</h2>
          <span className="hifz-dash-head-actions">
            <button
              type="button"
              className="hifz-dash-icon-btn"
              onClick={onRefresh}
              aria-label={labels.refresh}
            >
              ↻
            </button>
            <button
              type="button"
              className="hifz-dash-icon-btn"
              onClick={onClose}
              aria-label={labels.close}
            >
              ✕
            </button>
          </span>
        </div>
        <div className="hifz-dash-headrow">
          <div className="hifz-dash-ring">
            <svg width="82" height="82" viewBox="0 0 82 82" role="img" aria-label={labels.goalToday}>
              <circle
                cx="41"
                cy="41"
                r="35"
                fill="none"
                stroke="rgba(255,255,255,.25)"
                strokeWidth="8"
              />
              <circle
                cx="41"
                cy="41"
                r="35"
                fill="none"
                stroke="#ffb03a"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={
                  RING_CIRCUMFERENCE * (1 - goalPct / 100)
                }
                transform="rotate(-90 41 41)"
              />
            </svg>
            <div className="hifz-dash-ring-center">
              <b>{pctText(goalPct)}</b>
              <span>{labels.goalToday}</span>
            </div>
          </div>
          <div className="hifz-dash-headtext">
            <b>{headLine1}</b>
            <span>{headLine2}</span>
            <span className="hifz-dash-streak">
              {FLAME_ICON}{' '}
              {fill(labels.streakDays, { n: digits(data.streak_current) })}
            </span>
          </div>
        </div>
      </div>

      <div className="hifz-dash-body">
        {/* 1 — today's progress: four pastel tiles with icons. */}
        <div
          className="hifz-dash-tiles"
          role="group"
          aria-label={labels.todayTitle}
        >
          <div className="hifz-dash-tile hifz-dash-tile--green">
            <span>
              {TARGET_ICON} {labels.accuracy}
            </span>
            <b>{todayAccuracy === null ? '—' : pctText(todayAccuracy)}</b>
          </div>
          <div className="hifz-dash-tile hifz-dash-tile--teal">
            <span>
              {BOOK_ICON} {labels.wordsRead}
            </span>
            <b>
              {digits(todayWords)} <small>{labels.wordsUnit}</small>
            </b>
          </div>
          <div className="hifz-dash-tile hifz-dash-tile--amber">
            <span>↻ {labels.reviewReady}</span>
            <b>
              {digits(data.due_count)} <small>{labels.ayahUnit}</small>
            </b>
          </div>
          <div className="hifz-dash-tile hifz-dash-tile--rose">
            <span>
              {WARNING_ICON} {labels.errorsToday}
            </span>
            <b>
              {digits(todayErrors)} <small>{labels.mistakesUnit}</small>
            </b>
          </div>
        </div>

        {/* 2 — week calendar (design 4's week card). */}
        <div className="hifz-dash-card">
          <div className="hifz-dash-card-head">
            <b>{labels.weekTitle}</b>
            <span className="hifz-dash-mut">
              {fill(labels.goalPerDay, { goal: digits(data.goal_ayahs) })}
            </span>
          </div>
          <div className="hifz-dash-week">
            {week.map((d) => {
              const name = weekdayFmt.format(
                new Date(`${d.date}T00:00:00Z`),
              );
              const isToday = d.date === todayKey;
              const done = d.graded_words > 0;
              return (
                <div className="hifz-dash-week-day" key={d.date}>
                  <span
                    className={
                      isToday
                        ? 'hifz-dash-week-sq hifz-dash-week-sq--today'
                        : done
                          ? 'hifz-dash-week-sq hifz-dash-week-sq--done'
                          : 'hifz-dash-week-sq'
                    }
                  >
                    {isToday || !done ? name.slice(0, 1) : '✓'}
                  </span>
                  {isToday ? labels.dueToday : name}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3 — whole Quran: the 30-juz map with discrete states. */}
        <div className="hifz-dash-card">
          <div className="hifz-dash-card-head">
            <b>{labels.totalTitle}</b>
            <span className="hifz-dash-mut">
              {fill(labels.juzSummary, {
                full: digits(cleanJuz),
                pct: digits(juzPct),
              })}
            </span>
          </div>
          <ol className="hifz-dash-juzmap" aria-label={labels.totalTitle}>
            {sortedJuz.map((j) => (
              <li key={j.juz}>
                <button
                  type="button"
                  className={
                    isFull(j)
                      ? 'hifz-dash-juz hifz-dash-juz--on'
                      : j.juz === inProgressJuz
                        ? 'hifz-dash-juz hifz-dash-juz--cur'
                        : 'hifz-dash-juz'
                  }
                  title={`${labels.juzLabel} ${digits(j.juz)} — ${digits(j.clean_ayahs)}/${digits(j.total_ayahs)}`}
                  aria-label={`${labels.juzLabel} ${digits(j.juz)} — ${digits(j.clean_ayahs)}/${digits(j.total_ayahs)}`}
                  onClick={() => onNavigate(j.start_surah, j.start_ayah)}
                >
                  {digits(j.juz)}
                </button>
              </li>
            ))}
          </ol>
          <div className="hifz-dash-legend">
            {labels.legendDone}
            {inProgressJuz !== undefined &&
              ` · ${fill(labels.legendCurrent, { n: digits(inProgressJuz) })}`}
            {` · ${fill(labels.legendTotal, { clean: digits(totalClean) })}`}
          </div>
        </div>

        {/* 4 — review queue (due ayahs, queue order). */}
        <div className="hifz-dash-card">
          <div className="hifz-dash-card-head">
            <b>{labels.reviewTitle}</b>
            <span className="hifz-dash-count">{digits(data.due_count)}</span>
          </div>
          {data.due_ayahs.length === 0 ? (
            <p>{labels.reviewEmpty}</p>
          ) : (
            <div>
              {reviewRows.map((a) => {
                const pill = reviewPill(a);
                return (
                  <button
                    type="button"
                    className="hifz-dash-row"
                    key={`${a.surah}:${a.ayah}`}
                    onClick={() => onNavigate(a.surah, a.ayah)}
                  >
                    <span className="hifz-dash-row-ic hifz-dash-row-ic--teal">
                      ↻
                    </span>
                    <span className="hifz-dash-row-text">
                      <b>
                        سورهٔ {surahName(a.surah)}، آیهٔ {digits(a.ayah)}
                      </b>
                      <span>{reviewSubtitle(a)}</span>
                    </span>
                    <span
                      className={
                        pill.late
                          ? 'hifz-dash-due hifz-dash-due--late'
                          : 'hifz-dash-due'
                      }
                    >
                      {pill.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 5 — weakest ayahs + most recent errors (one card, like the
            design: each row carries its mistake count and when it
            happened; the worst row is rose, the rest amber). */}
        <div className="hifz-dash-card">
          <div className="hifz-dash-card-head">
            <b>{labels.weakTitle}</b>
            <span className="hifz-dash-mut">{labels.needsPractice}</span>
          </div>
          {data.weakest_ayahs.length === 0 ? (
            <p>{labels.weakEmpty}</p>
          ) : (
            <div>
              {weakRows.map((a, i) => (
                <button
                  type="button"
                  className="hifz-dash-row"
                  key={`${a.surah}:${a.ayah}`}
                  onClick={() => onNavigate(a.surah, a.ayah)}
                >
                  <span
                    className={
                      i === 0
                        ? 'hifz-dash-row-ic hifz-dash-row-ic--rose'
                        : 'hifz-dash-row-ic hifz-dash-row-ic--amber'
                    }
                  >
                    {WARNING_ICON}
                  </span>
                  <span className="hifz-dash-row-text">
                    <b>
                      {surahName(a.surah)}، آیهٔ {digits(a.ayah)}
                    </b>
                    <span>
                      {fill(labels.mistakesLastSession, {
                        n: digits(a.mistake_count),
                      })}
                    </span>
                  </span>
                  <span
                    className={
                      i === 0
                        ? 'hifz-dash-chip hifz-dash-chip--rose'
                        : 'hifz-dash-chip hifz-dash-chip--amber'
                    }
                  >
                    {digits(a.mistake_count)} {labels.mistakesUnit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 6 — continue where you left off + start a new session. */}
        <div className="hifz-dash-cta" aria-label={labels.continueTitle}>
          <button
            type="button"
            className="hifz-dash-main"
            onClick={() => onNavigate(targetSurah, targetAyah)}
          >
            <span aria-hidden="true">▶</span>
            <span className="hifz-dash-main-text">
              <b>{labels.continueNow}</b>
              <span>
                سورهٔ {surahName(targetSurah)}، آیهٔ {digits(targetAyah)}
                {targetPage !== null &&
                  ` · ${labels.pageLabel} ${digits(targetPage)}`}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="hifz-dash-ghost"
            onClick={onClose}
          >
            ＋ {labels.newSession}
          </button>
        </div>
      </div>
    </section>
  );
}

export function HifzStudyDashboard({
  labels,
  authed,
  locale,
  currentSurah,
  currentAyah,
  pageForAyah,
  surahName,
  onNavigate,
  onClose,
}: {
  labels: HifzStudyDashboardLabels;
  authed: boolean;
  locale: string;
  currentSurah: number;
  currentAyah: number;
  pageForAyah?: (surah: number, ayah: number) => number | null;
  surahName: (surah: number) => string;
  onNavigate: (surah: number, ayah: number) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<HifzStudyDashboardData | null>(null);
  const [resume, setResume] = useState<HifzStudyResumeAttempt | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [d, r] = await Promise.all([
        authJson<HifzStudyDashboardData>(`${HIFZ_API}/dashboard`),
        // A missing resumable session is null, never an error; a
        // failed resume fetch must not break the dashboard.
        authJson<HifzStudyResumeAttempt | null>(
          `${HIFZ_API}/attempts/resume`,
        ).catch(() => null),
      ]);
      setData(d);
      setResume(r);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    void load();
  }, [authed, load]);

  const plainHead = (
    <div className="hifz-dash-head hifz-dash-head--plain">
      <div className="hifz-dash-head-top">
        <h2>{labels.title}</h2>
        <span className="hifz-dash-head-actions">
          <button
            type="button"
            className="hifz-dash-icon-btn"
            onClick={onClose}
            aria-label={labels.close}
          >
            ✕
          </button>
        </span>
      </div>
    </div>
  );

  if (!authed) {
    return (
      <section
        className="hifz-dashboard-panel is-open"
        aria-label={labels.title}
      >
        {plainHead}
        <div className="hifz-dash-body">
          <p>{labels.signInHint}</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section
        className="hifz-dashboard-panel is-open"
        aria-label={labels.title}
      >
        {plainHead}
        <div className="hifz-dash-body">
          {error ? (
            <p className="hifz-error" role="alert">
              {labels.error}{' '}
              <button type="button" onClick={() => void load()}>
                {labels.refresh}
              </button>
            </p>
          ) : (
            <p>{labels.loading}</p>
          )}
        </div>
      </section>
    );
  }

  return (
    <HifzStudyDashboardView
      data={data}
      resume={resume}
      labels={labels}
      locale={locale}
      currentSurah={currentSurah}
      currentAyah={currentAyah}
      pageForAyah={pageForAyah}
      surahName={surahName}
      onNavigate={onNavigate}
      onClose={onClose}
      onRefresh={() => void load()}
    />
  );
}
