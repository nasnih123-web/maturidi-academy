/**
 * hifz-study/HifzLivePills: the live pills row moved verbatim from
 * components/QuranHifzStudy.tsx (hifz-completion refactor step 7).
 * Presentational only: error count (red), accuracy % (color by
 * range), session timer (gray, counts up). Shown while a live
 * session runs; the timer disappears after stop. Phase 6: the row
 * is dir=ltr so the visual order matches the frames (error left,
 * accuracy middle, timer right); the pills themselves are solid
 * Tarteel colors. The pillStats / timerText memos and the
 * accuracyTone stay in the parent and arrive as props.
 *
 * Provisional (live words present, stored grade not yet arrived):
 * show a count, not a percent - the uncalibrated live score is
 * not a final percentage. When no live words are present the
 * stored grade's final percent stands.
 */
import { accuracyPillClass, type AccuracyTone } from '@/lib/hifz-phase4';
import { formatArabicIndicDecimal, toArabicIndic } from '@/lib/quran-print-lines';
import type { HifzLabels } from '@/lib/hifz-study-types';

/** Error/accuracy counts for the live pills row. */
export type HifzPillStats = {
  errors: number;
  accuracy: number;
  total: number;
  correct: number;
  peeked: number;
};

export function HifzLivePills({
  visible,
  stats,
  accuracyTone,
  liveWordsPresent,
  showTimer,
  timerText,
  labels,
}: {
  visible: boolean;
  stats: HifzPillStats;
  accuracyTone: AccuracyTone;
  liveWordsPresent: boolean;
  showTimer: boolean;
  timerText: string;
  labels: HifzLabels;
}) {
  if (!visible) return null;
  return (
  <div className="hifz-pills" dir="ltr" aria-live="polite">
    <span className="hifz-pill hifz-pill-red">
      <svg className="hifz-pill-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.4" fill="currentColor" />
      </svg>
      <span className="hifz-pill-label">{labels.pillErrors}: </span>{toArabicIndic(stats.errors)}
    </span>
    {/* Provisional (live words present, stored grade not yet
        arrived): show a count, not a percent — the uncalibrated
        live score is not a final percentage. When no live words
        are present the stored grade's final percent stands. */}
    {liveWordsPresent ? (
      <span className="hifz-pill hifz-pill-gray">
        <span className="hifz-pill-label">{labels.pillAccuracy}: </span>{toArabicIndic(stats.correct)} از{' '}
        {toArabicIndic(stats.total)}
      </span>
    ) : (
      <span className={`hifz-pill ${accuracyPillClass(accuracyTone)}`}>
        <span className="hifz-pill-label">{labels.pillAccuracy}: </span>{formatArabicIndicDecimal(stats.accuracy)}٪
      </span>
    )}
    {showTimer && (
      <span className="hifz-pill hifz-pill-gray hifz-pill-timer">
        <span className="hifz-pill-dot" aria-hidden="true" />
        <span className="hifz-pill-label">{labels.pillTimer}: </span>{timerText}
      </span>
    )}
  </div>
  );
}
