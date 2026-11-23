'use client';

/**
 * QuranChildrenDashboard — the children home view (mockup screen 1).
 *
 * Mirrors HifzDashboard: one authJson load on mount, sections as
 * <h4> blocks, navigation back to the study page via onNavigate.
 * Guests see the sign-in note (progress is per-user); a failed load
 * shows the error with retry — never fake numbers.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SurahSummary } from '@/lib/quran';
import {
  fetchChildrenDashboard,
  formatNum,
  isAuthError401,
  type ChildrenDashboard,
  type ChildrenLabels,
} from '@/lib/quran-children';

export type ChildrenView = 'home' | 'list' | 'study' | 'quiz';

export function QuranChildrenDashboard({
  labels,
  locale,
  surahList,
  returnUrl,
  onNavigate,
}: {
  labels: ChildrenLabels;
  locale: string;
  surahList: SurahSummary[];
  returnUrl: string;
  onNavigate: (surah: number, view: 'study' | 'quiz', ayah?: number) => void;
}): React.ReactElement {
  const [data, setData] = useState<ChildrenDashboard | null>(null);
  const [guest, setGuest] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setGuest(false);
    try {
      setData(await fetchChildrenDashboard());
    } catch (err) {
      if (isAuthError401(err)) setGuest(true);
      else setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const firstSurahOfJuz = useCallback(
    (juz: number): number | null => {
      const found = surahList.filter((s) => s.juz.includes(juz));
      if (found.length === 0) return null;
      return Math.min(...found.map((s) => s.number));
    },
    [surahList],
  );

  const weekLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : locale, {
      weekday: 'narrow',
    });
    return (data?.week ?? []).map((d) => ({
      ...d,
      label: fmt.format(new Date(`${d.date}T12:00:00`)),
    }));
  }, [data, locale]);

  const goalPct =
    data && data.goal_surahs > 0
      ? Math.min(1, data.goal_today_surahs / data.goal_surahs)
      : 0;
  const ringR = 34;
  const ringC = 2 * Math.PI * ringR;

  if (loading) {
    return (
      <section className="quran-children-dashboard" aria-busy="true">
        <p className="quran-children-loading">{labels.audioLoading}</p>
      </section>
    );
  }

  if (guest) {
    return (
      <section className="quran-children-dashboard">
        <div className="quran-children-signin">
          <h3>{labels.signInTitle}</h3>
          <p>{labels.signInHint}</p>
          <Link className="quran-children-btn-primary" href={returnUrl ? `/${locale}/profile?next=${encodeURIComponent(returnUrl)}` : `/${locale}/profile`}>
            {labels.signInButton}
          </Link>
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="quran-children-dashboard">
        <p role="alert">{labels.error}</p>
        <button
          type="button"
          className="quran-children-btn"
          onClick={() => void load()}
        >
          {labels.retry}
        </button>
      </section>
    );
  }

  return (
    <section className="quran-children-dashboard">
      <header className="quran-children-dash-head">
        <h2>{labels.homeTitle}</h2>
        <p>{labels.homeSubtitle}</p>
      </header>

      {/* Daily goal ring + week strip */}
      <div className="quran-children-goal-card">
        <div
          className="quran-children-ring"
          role="img"
          aria-label={labels.goalOf
            .replace('%done%', formatNum(data.goal_today_surahs, locale))
            .replace('%goal%', formatNum(data.goal_surahs, locale))}
        >
          <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
            <circle cx="42" cy="42" r={ringR} className="quran-children-ring-bg" />
            <circle
              cx="42"
              cy="42"
              r={ringR}
              className="quran-children-ring-fg"
              strokeDasharray={`${goalPct * ringC} ${ringC}`}
            />
          </svg>
          <span className="quran-children-ring-text">
            {formatNum(data.goal_today_surahs, locale)}
            {' / '}
            {formatNum(data.goal_surahs, locale)}
          </span>
        </div>
        <div className="quran-children-goal-side">
          <h3>{labels.goalTitle}</h3>
          {data.goal_met ? (
            <p className="quran-children-goal-met">{labels.goalMet}</p>
          ) : (
            <p>
              {labels.goalOf
                .replace('%done%', formatNum(data.goal_today_surahs, locale))
                .replace('%goal%', formatNum(data.goal_surahs, locale))}
            </p>
          )}
          <h4>{labels.weekTitle}</h4>
          <ol className="quran-children-week">
            {weekLabels.map((d) => (
              <li
                key={d.date}
                className={[
                  'quran-children-week-day',
                  d.active ? 'is-active' : '',
                  d.is_today ? 'is-today' : '',
                ].join(' ')}
                aria-label={d.date}
              >
                <span>{d.label}</span>
                <i aria-hidden="true" />
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Streak + stars + learned tiles */}
      <div className="quran-children-tiles">
        <div className="quran-children-tile">
          <span className="quran-children-tile-num">{formatNum(data.streak_current, locale)}</span>
          <span>{labels.streakTitle}</span>
        </div>
        <div className="quran-children-tile">
          <span className="quran-children-tile-num">
            {'★'.repeat(1)}
            {formatNum(data.total_stars, locale)}
          </span>
          <span>{labels.starsTitle}</span>
        </div>
        <div className="quran-children-tile">
          <span className="quran-children-tile-num">{formatNum(data.learned_count, locale)}</span>
          <span>{labels.learnedTitle}</span>
        </div>
      </div>

      {/* 30-juz house map */}
      <h3>{labels.juzMapTitle}</h3>
      <ol className="quran-children-juzmap">
        {data.juz_progress.map((j) => {
          const first = firstSurahOfJuz(j.juz);
          return (
            <li key={j.juz} className={`quran-children-juz is-${j.state}`}>
              <button
                type="button"
                disabled={first === null}
                onClick={() => {
                  if (first !== null) onNavigate(first, 'study');
                }}
                aria-label={`${labels.juzMapTitle} ${formatNum(j.juz, locale)}`}
              >
                <span className="quran-children-juz-house" aria-hidden="true">
                  ⌂
                </span>
                <span>{formatNum(j.juz, locale)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Continue where left off */}
      {data.continue_surah && (
        <div className="quran-children-continue">
          <h3>{labels.continueTitle}</h3>
          <button
            type="button"
            className="quran-children-continue-card"
            onClick={() =>
              onNavigate(
                data.continue_surah!.surah,
                'study',
                data.continue_surah!.last_ayah && data.continue_surah!.last_ayah > 0
                  ? data.continue_surah!.last_ayah
                  : 1,
              )
            }
          >
            <span className="quran-children-continue-name">
              {data.continue_surah.name_ar}
            </span>
            <span className="quran-children-continue-ayah">
              {labels.continueFrom.replace(
                '%ayah%',
                formatNum(data.continue_surah.last_ayah ?? 1, locale),
              )}
            </span>
            <span className="quran-children-stars" aria-hidden="true">
              {'★'.repeat(Math.max(0, Math.min(3, data.continue_surah.stars)))}
              {'☆'.repeat(3 - Math.max(0, Math.min(3, data.continue_surah.stars)))}
            </span>
          </button>
        </div>
      )}

      {/* Weak surahs — retry */}
      <h3>{labels.retryTitle}</h3>
      {data.weak_surahs.length === 0 ? (
        <p>{labels.weakEmpty}</p>
      ) : (
        <ul className="quran-children-weak">
          {data.weak_surahs.map((s) => (
            <li key={s.surah}>
              <button
                type="button"
                onClick={() => onNavigate(s.surah, 'quiz')}
              >
                <span>{s.name_ar}</span>
                <span className="quran-children-stars" aria-hidden="true">
                  {'★'.repeat(Math.max(0, Math.min(3, s.stars)))}
                  {'☆'.repeat(3 - Math.max(0, Math.min(3, s.stars)))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Today */}
      <h3>{labels.todayTitle}</h3>
      {data.today_surahs.length === 0 ? (
        <p>{labels.todayEmpty}</p>
      ) : (
        <ul className="quran-children-today">
          {data.today_surahs.map((s) => (
            <li key={s.surah}>
              <button
                type="button"
                onClick={() => onNavigate(s.surah, 'study')}
              >
                <span>{s.name_ar}</span>
                <span className="quran-children-stars" aria-hidden="true">
                  {'★'.repeat(Math.max(0, Math.min(3, s.stars)))}
                  {'☆'.repeat(3 - Math.max(0, Math.min(3, s.stars)))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
