/**
 * HifzDashboard — the separate hifz flow (NOT the study page).
 *
 * Only real, traceable numbers: sessions, ayahs, graded words, errors
 * by type, the 30-day series, due ayahs, plans with real progress,
 * and suggested cards (shown only when the user declared memorized
 * ranges and has enough history; otherwise a setup notice).
 */
import { useCallback, useEffect, useState } from 'react';
import { authJson } from '@/lib/auth-client';
import { surahAyahCount } from '@/lib/hifz-phase4';
import { HifzNumericInput } from './HifzNumericInput';

const HIFZ_API = '/api/v1/quran/hifz';

export interface HifzActivityDay {
  date: string;
  attempts: number;
  graded_words: number;
  reviews: number;
  ayahs: number;
}

export interface HifzActivityData {
  days: HifzActivityDay[];
  streak_current: number;
  streak_best: number;
  goal_ayahs: number;
  today_ayahs: number;
  goal_met: boolean;
}

export interface HifzDashboardData {
  attempts: number;
  graded_words: number;
  counts: Record<string, number>;
  errors_by_type: Record<string, number>;
  daily_series: { date: string; attempts: number; graded_words: number }[];
  streak_current: number;
  streak_best: number;
  goal_ayahs: number;
  goal_today_ayahs: number;
  goal_met: boolean;
  due_count: number;
  due_ayahs: { surah: number; ayah: number; source: string }[];
  plans: {
    id: string;
    title: string;
    kind: string;
    direction: string;
    status: string;
    total_ayahs: number;
    done_ayahs: number;
  }[];
  weakest_ayahs: { surah: number; ayah: number; mistake_count: number }[];
}

export interface HifzSuggestedData {
  available: boolean;
  reason: string;
  detail: string;
  cards: { surah: number; ayah: number; kind: string; mistake_count: number; reason: string }[];
}

export interface HifzDashboardLabels {
  title: string;
  loading: string;
  error: string;
  resumeTitle: string;
  resumeContinue: string;
  resumeDismiss: string;
  attempts: string;
  gradedWords: string;
  correct: string;
  close: string;
  wrong: string;
  skipped: string;
  errorsByType: string;
  dailySeries: string;
  dueAyahs: string;
  dueCount: string;
  plans: string;
  planTitle: string;
  planKind: string;
  planDirection: string;
  planDirectionNormal: string;
  planDirectionReverse: string;
  planKindMemorize: string;
  planKindReview: string;
  planKindRecite: string;
  planStartSurah: string;
  planStartAyah: string;
  planEndSurah: string;
  planEndAyah: string;
  planDailyNew: string;
  planDailyReview: string;
  planCreate: string;
  planPause: string;
  planResume: string;
  planProgress: string;
  weakestAyahs: string;
  suggested: string;
  suggestedSetup: string;
  suggestedWarmUp: string;
  suggestedWeakest: string;
  noData: string;
  refresh: string;
  streak: string;
  streakBest: string;
  dailyGoal: string;
  goalProgress: string;
  goalMet: string;
  saveGoal: string;
  heatmap: string;
  reviews: string;
}

/** Heat level for one activity day: graded words + reviews. */
function heatLevel(day: HifzActivityDay): number {
  const total = day.graded_words + day.reviews;
  if (total <= 0) return 0;
  if (total <= 4) return 1;
  if (total <= 14) return 2;
  if (total <= 29) return 3;
  return 4;
}

const SURAHS = Array.from({ length: 114 }, (_, i) => i + 1);

export interface HifzResumeAttempt {
  id: string;
  surah: number;
  start_ayah: number | null;
  current_surah: number | null;
  current_ayah: number | null;
}

export function HifzDashboard({
  labels,
  onNavigate,
}: {
  labels: HifzDashboardLabels;
  onNavigate: (surah: number, ayah: number) => void;
}) {
  const [data, setData] = useState<HifzDashboardData | null>(null);
  // Step 4 (Tarteel parity) — activity series for the heatmap; a
  // failed fetch hides the map but never breaks the dashboard.
  const [activity, setActivity] = useState<HifzActivityData | null>(null);
  const [goalInput, setGoalInput] = useState(0);
  const [suggested, setSuggested] = useState<HifzSuggestedData | null>(null);
  // Phase 4 — the latest open session, for the «continue» card.
  const [resume, setResume] = useState<HifzResumeAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('memorize');
  const [direction, setDirection] = useState('normal');
  const [startSurah, setStartSurah] = useState(112);
  const [startAyah, setStartAyah] = useState(1);
  const [endSurah, setEndSurah] = useState(114);
  const [endAyah, setEndAyah] = useState(6);
  const [dailyNew, setDailyNew] = useState(1);
  const [dailyReview, setDailyReview] = useState(5);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, s, r, a] = await Promise.all([
        authJson<HifzDashboardData>(`${HIFZ_API}/dashboard`),
        authJson<HifzSuggestedData>(`${HIFZ_API}/suggested`),
        // Phase 4 — a missing resumable session is null, never an
        // error; a failed fetch must not break the dashboard.
        authJson<HifzResumeAttempt | null>(`${HIFZ_API}/attempts/resume`).catch(
          () => null,
        ),
        authJson<HifzActivityData>(`${HIFZ_API}/activity?days=371`).catch(
          () => null,
        ),
      ]);
      setData(d);
      setSuggested(s);
      setResume(r);
      setActivity(a);
      setGoalInput(d.goal_ayahs);
    } catch {
      setError(labels.error);
    }
  }, [labels.error]);

  const saveGoal = async () => {
    try {
      await authJson(`${HIFZ_API}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_goal_ayahs: goalInput }),
      });
      await load();
    } catch {
      setError(labels.error);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const createPlan = async () => {
    if (title.trim() === '') return;
    try {
      await authJson(`${HIFZ_API}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          direction,
          start_surah: startSurah,
          start_ayah: startAyah,
          end_surah: endSurah,
          end_ayah: endAyah,
          daily_target_new: dailyNew,
          daily_target_review: dailyReview,
        }),
      });
      setTitle('');
      await load();
    } catch {
      setError(labels.error);
    }
  };

  const setPlanStatus = async (id: string, status: string) => {
    await authJson(`${HIFZ_API}/plans/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
  };

  if (!data) {
    return (
      <section aria-label={labels.title}>
        <h3>{labels.title}</h3>
        {error ? (
          <p className="hifz-error" role="alert">
            {error}
          </p>
        ) : (
          <p>{labels.loading}</p>
        )}
      </section>
    );
  }

  return (
    <section className="hifz-dashboard" aria-label={labels.title}>
      <h3>{labels.title}</h3>
      <button type="button" onClick={load}>
        {labels.refresh}
      </button>
      {/* Phase 4 — continue the latest open session from its stored
          position (the study page shows the same banner). */}
      {resume !== null && (
        <div className="hifz-resume-banner" role="status">
          <span>
            {labels.resumeTitle}: {resume.current_surah ?? resume.surah}:
            {resume.current_ayah ?? resume.start_ayah ?? 1}
          </span>
          <button
            type="button"
            onClick={() =>
              onNavigate(
                resume.current_surah ?? resume.surah,
                resume.current_ayah ?? resume.start_ayah ?? 1,
              )
            }
          >
            {labels.resumeContinue}
          </button>
          <button type="button" onClick={() => setResume(null)}>
            {labels.resumeDismiss}
          </button>
        </div>
      )}
      <dl>
        <div>
          <dt>{labels.attempts}</dt>
          <dd>{data.attempts}</dd>
        </div>
        <div>
          <dt>{labels.gradedWords}</dt>
          <dd>{data.graded_words}</dd>
        </div>
        <div>
          <dt>{labels.correct}</dt>
          <dd>{data.counts.correct ?? 0}</dd>
        </div>
        <div>
          <dt>{labels.close}</dt>
          <dd>{data.counts.close ?? 0}</dd>
        </div>
        <div>
          <dt>{labels.wrong}</dt>
          <dd>{data.counts.wrong ?? 0}</dd>
        </div>
        <div>
          <dt>{labels.skipped}</dt>
          <dd>{data.counts.skipped ?? 0}</dd>
        </div>
        <div>
          <dt>{labels.dueCount}</dt>
          <dd>{data.due_count}</dd>
        </div>
        <div>
          <dt>{labels.streak}</dt>
          <dd>{data.streak_current}</dd>
        </div>
        <div>
          <dt>{labels.streakBest}</dt>
          <dd>{data.streak_best}</dd>
        </div>
      </dl>

      {/* Step 4 — daily goal: today's distinct practiced/reviewed
          ayahs against the goal stored in the user's settings. */}
      <h4>{labels.dailyGoal}</h4>
      <p>
        {labels.goalProgress}: {data.goal_today_ayahs}
        {data.goal_ayahs > 0 ? ` / ${data.goal_ayahs}` : ''}
        {data.goal_met ? ` — ${labels.goalMet}` : ''}
      </p>
      {data.goal_ayahs > 0 && (
        <div
          className="hifz-goal-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={data.goal_ayahs}
          aria-valuenow={Math.min(data.goal_today_ayahs, data.goal_ayahs)}
          aria-label={labels.dailyGoal}
        >
          <span
            style={{
              width: `${Math.min(100, (data.goal_today_ayahs / data.goal_ayahs) * 100)}%`,
            }}
          />
        </div>
      )}
      <div>
        <label>
          {labels.dailyGoal}
          <HifzNumericInput
            value={goalInput}
            onChange={(v) => setGoalInput(v ?? 0)}
            ariaLabel={labels.dailyGoal}
            min={0}
            max={6236}
          />
        </label>
        <button type="button" onClick={saveGoal}>
          {labels.saveGoal}
        </button>
      </div>

      {/* Step 4 — review/activity heatmap (last 53 weeks, real days). */}
      {activity && (
        <>
          <h4>{labels.heatmap}</h4>
          <div className="hifz-heatmap" dir="ltr" role="img" aria-label={labels.heatmap}>
            {(() => {
              // Pad the first week so columns align to weekdays.
              const firstDow = new Date(`${activity.days[0]?.date}T00:00:00Z`).getUTCDay();
              const cells: (HifzActivityDay | null)[] = [
                ...Array.from({ length: firstDow }, () => null),
                ...activity.days,
              ];
              const weeks: (HifzActivityDay | null)[][] = [];
              for (let i = 0; i < cells.length; i += 7) {
                weeks.push(cells.slice(i, i + 7));
              }
              return weeks.map((week, wi) => (
                <div className="hifz-heat-week" key={wi}>
                  {week.map((day, di) =>
                    day === null ? (
                      <span className="hifz-heat-cell hifz-heat-pad" key={di} />
                    ) : (
                      <span
                        className={`hifz-heat-cell hifz-heat-l${heatLevel(day)}`}
                        key={di}
                        title={`${day.date} — ${labels.gradedWords}: ${day.graded_words} · ${labels.reviews}: ${day.reviews}`}
                      />
                    ),
                  )}
                </div>
              ));
            })()}
          </div>
        </>
      )}

      <h4>{labels.errorsByType}</h4>
      {Object.keys(data.errors_by_type).length === 0 ? (
        <p>{labels.noData}</p>
      ) : (
        <ul>
          {Object.entries(data.errors_by_type).map(([t, n]) => (
            <li key={t}>
              {t}: {n}
            </li>
          ))}
        </ul>
      )}

      <h4>{labels.dailySeries}</h4>
      <table>
        <thead>
          <tr>
            <th>{labels.dailySeries}</th>
            <th>{labels.attempts}</th>
            <th>{labels.gradedWords}</th>
          </tr>
        </thead>
        <tbody>
          {data.daily_series
            .filter((d) => d.attempts > 0 || d.graded_words > 0)
            .map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{d.attempts}</td>
                <td>{d.graded_words}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {data.daily_series.every((d) => d.attempts === 0 && d.graded_words === 0) && (
        <p>{labels.noData}</p>
      )}

      <h4>{labels.dueAyahs}</h4>
      {data.due_ayahs.length === 0 ? (
        <p>{labels.noData}</p>
      ) : (
        <ul>
          {data.due_ayahs.map((a) => (
            <li key={`${a.surah}:${a.ayah}`}>
              <button type="button" onClick={() => onNavigate(a.surah, a.ayah)}>
                {a.surah}:{a.ayah}
              </button>{' '}
              ({a.source})
            </li>
          ))}
        </ul>
      )}

      <h4>{labels.weakestAyahs}</h4>
      {data.weakest_ayahs.length === 0 ? (
        <p>{labels.noData}</p>
      ) : (
        <ul>
          {data.weakest_ayahs.map((a) => (
            <li key={`${a.surah}:${a.ayah}`}>
              <button type="button" onClick={() => onNavigate(a.surah, a.ayah)}>
                {a.surah}:{a.ayah}
              </button>{' '}
              — {a.mistake_count}
            </li>
          ))}
        </ul>
      )}

      <h4>{labels.suggested}</h4>
      {suggested && !suggested.available && <p>{labels.suggestedSetup}: {suggested.detail}</p>}
      {suggested && suggested.available && (
        <ul>
          {suggested.cards.map((c) => (
            <li key={`${c.surah}:${c.ayah}`}>
              <button type="button" onClick={() => onNavigate(c.surah, c.ayah)}>
                {c.surah}:{c.ayah}
              </button>{' '}
              — {c.kind === 'weakest_link' ? labels.suggestedWeakest : labels.suggestedWarmUp} ·{' '}
              {c.reason}
            </li>
          ))}
        </ul>
      )}

      <h4>{labels.plans}</h4>
      {data.plans.length === 0 ? (
        <p>{labels.noData}</p>
      ) : (
        <ul>
          {data.plans.map((p) => (
            <li key={p.id}>
              {p.title} — {p.kind} ·{' '}
              {p.direction === 'reverse' ? labels.planDirectionReverse : labels.planDirectionNormal}{' '}
              · {labels.planProgress}: {p.done_ayahs}/{p.total_ayahs} · {p.status}{' '}
              {p.status === 'active' && (
                <button type="button" onClick={() => setPlanStatus(p.id, 'paused')}>
                  {labels.planPause}
                </button>
              )}
              {p.status === 'paused' && (
                <button type="button" onClick={() => setPlanStatus(p.id, 'active')}>
                  {labels.planResume}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
        <label>
          {labels.planTitle}
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {labels.planKind}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="memorize">{labels.planKindMemorize}</option>
            <option value="review">{labels.planKindReview}</option>
            <option value="recite">{labels.planKindRecite}</option>
          </select>
        </label>
        <label>
          {labels.planDirection}
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="normal">{labels.planDirectionNormal}</option>
            <option value="reverse">{labels.planDirectionReverse}</option>
          </select>
        </label>
        <label>
          {labels.planStartSurah}
          <select value={startSurah} onChange={(e) => setStartSurah(Number(e.target.value))}>
            {SURAHS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.planStartAyah}
          <HifzNumericInput
            value={startAyah}
            onChange={(v) => setStartAyah(v ?? 1)}
            ariaLabel={labels.planStartAyah}
            min={1}
            max={surahAyahCount(startSurah) ?? undefined}
          />
        </label>
        <label>
          {labels.planEndSurah}
          <select value={endSurah} onChange={(e) => setEndSurah(Number(e.target.value))}>
            {SURAHS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.planEndAyah}
          <HifzNumericInput
            value={endAyah}
            onChange={(v) => setEndAyah(v ?? 1)}
            ariaLabel={labels.planEndAyah}
            min={1}
            max={surahAyahCount(endSurah) ?? undefined}
          />
        </label>
        <label>
          {labels.planDailyNew}
          <HifzNumericInput
            value={dailyNew}
            onChange={(v) => setDailyNew(v ?? 0)}
            ariaLabel={labels.planDailyNew}
            min={0}
          />
        </label>
        <label>
          {labels.planDailyReview}
          <HifzNumericInput
            value={dailyReview}
            onChange={(v) => setDailyReview(v ?? 0)}
            ariaLabel={labels.planDailyReview}
            min={0}
          />
        </label>
        <button type="button" onClick={createPlan} disabled={title.trim() === ''}>
          {labels.planCreate}
        </button>
      </div>
      {error && (
        <p className="hifz-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
