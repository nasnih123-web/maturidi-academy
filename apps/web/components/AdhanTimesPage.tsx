'use client';

/**
 * AdhanTimesPage — the full prayer-times page (/adhan).
 *
 * Server shell (page.tsx) only passes settings + translations; every time
 * on this page comes from GET /api/v1/adhan/* — the web NEVER computes or
 * invents times. Selection (city, method, madhab) is saved to localStorage
 * (ma.adhan_choice) so the header strip on every page follows it live.
 *
 * Sections: today's hero (6 cards + live countdown + Jalali/Qamari/Miladi
 * dates) → method selector cards (with today's minute-difference vs the
 * council default) → madhab toggle (Asr only) → city selector + GPS →
 * week/month/year timetable tabs → transparency block.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ADHAN_CITIES,
  findCity,
  formatCountdown,
  formatHijri,
  getAdhanOptions,
  getAdhanRange,
  getAdhanTimesForChoice,
  loadAdhanChoice,
  localTzOffset,
  nextPrayer,
  saveAdhanChoice,
  type AdhanChoice,
  type AdhanDay,
  type AdhanMethodOption,
  type AdhanOptions,
  type AdhanTimes,
  type PrayerName,
  type PrayerTimings,
} from '@/lib/adhan';
import type { AdhanSettings } from '@/lib/settings';
import {
  addDays,
  formatJalali,
  fromJalali,
  jalaliMonthLength,
  toISODate,
  toJalali,
  type JalaliDate,
} from '@/lib/jalali';

export interface AdhanMethodLabels {
  name: string;
  authority: string;
  note: string;
}

export interface AdhanTimesPageLabels {
  title: string;
  subtitle: string;
  nextPrayer: string;
  prayers: Record<PrayerName, string>;
  methodLabel: string;
  madhabLabel: string;
  madhabHanafi: string;
  madhabShafi: string;
  madhabNote: string;
  citySelectLabel: string;
  useMyLocation: string;
  customLocation: string;
  customLocationHint: string;
  tabWeek: string;
  tabMonth: string;
  tabYear: string;
  methods: Record<string, AdhanMethodLabels>;
  cities: Record<string, string>;
  jalaliMonths: string[];
  diffLabel: string;
  sourceTable: string;
  sourceComputed: string;
  sourceMixed: string;
  transparencyTitle: string;
  transparencyMethod: string;
  transparencyAsr: string;
  trueDawnNote: string;
  scholarNote: string;
  loading: string;
  loadFailed: string;
  retry: string;
  jalaliLabel: string;
  miladiLabel: string;
  qamariLabel: string;
  tableToday: string;
  methodUnavailable: string;
  maghribSunset: string;
  stripPrefix: string;
  countdownAria: string;
  gpsDenied: string;
  gpsUnsupported: string;
  timesFailed: string;
}

const HERO_ORDER: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const DEFAULT_METHOD = 'council';

interface Selection {
  city: string | null;
  lat: number;
  lng: number;
  method: string;
  madhab: string;
}

function selectionFromSettings(settings: AdhanSettings): Selection {
  const city = findCity(settings.defaultCity);
  if (city) {
    return { city: city.slug, lat: city.lat, lng: city.lng, method: settings.method, madhab: settings.madhab };
  }
  if (settings.defaultLat !== null && settings.defaultLng !== null) {
    return { city: null, lat: settings.defaultLat, lng: settings.defaultLng, method: settings.method, madhab: settings.madhab };
  }
  const torbat = findCity('torbat-e-jam') ?? ADHAN_CITIES[0];
  return { city: torbat.slug, lat: torbat.lat, lng: torbat.lng, method: settings.method, madhab: settings.madhab };
}

function minutesDiff(a: string, b: string): number | null {
  const parse = (s: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const x = parse(a);
  const y = parse(b);
  if (x === null || y === null) return null;
  return x - y;
}

function fmtDiff(d: number | null): string {
  if (d === null) return '–';
  if (d === 0) return '0';
  return d > 0 ? `+${d}` : `${d}`;
}

function methodSummary(
  m: AdhanMethodOption,
  labels: AdhanTimesPageLabels,
): string {
  if (!m.available) return labels.methodUnavailable;
  const parts: string[] = [];
  if (m.fajr !== null) parts.push(`${labels.prayers.fajr} ${m.fajr}°`);
  if (m.isha !== null) parts.push(`${labels.prayers.isha} ${m.isha}°`);
  if (m.maghrib !== null) parts.push(`${labels.prayers.maghrib} ${m.maghrib}°`);
  else parts.push(`${labels.prayers.maghrib} ${labels.maghribSunset}`);
  if (m.isha_minutes !== null) {
    parts.push(
      `${labels.prayers.isha} ${m.isha_minutes}′${m.isha_minutes_ramadan !== null ? ` (${m.isha_minutes_ramadan}′)` : ''}`,
    );
  }
  return parts.join(' · ');
}

export function AdhanTimesPage({
  locale,
  settings,
  labels,
}: {
  locale: string;
  settings: AdhanSettings;
  labels: AdhanTimesPageLabels;
}) {
  const [options, setOptions] = useState<AdhanOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [sel, setSel] = useState<Selection>(() => selectionFromSettings(settings));
  const [today, setToday] = useState<AdhanTimes | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, { fajr: number | null; isha: number | null }>>({});
  const [tab, setTab] = useState<'week' | 'month' | 'year'>('week');
  const [range, setRange] = useState<AdhanDay[] | null>(null);
  const [rangeError, setRangeError] = useState(false);
  const [rangeMeta, setRangeMeta] = useState<{ start: string; end: string } | null>(null);
  const [rangeRetry, setRangeRetry] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [choiceLoaded, setChoiceLoaded] = useState(false);
  const selRef = useRef(sel);
  selRef.current = sel;

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const jalaliToday: JalaliDate = useMemo(() => toJalali(new Date()), []);
  const miladiLine = useMemo(() => {
    try {
      const tag = locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar-SA' : 'en';
      return new Intl.DateTimeFormat(tag, { dateStyle: 'long' }).format(new Date());
    } catch {
      return todayIso;
    }
  }, [locale, todayIso]);
  const qamariLine = useMemo(() => formatHijri(locale) || '', [locale]);

  // Ticking clock for the countdown + day/night gradient.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load the method/city catalog once.
  useEffect(() => {
    let cancelled = false;
    getAdhanOptions()
      .then((o) => {
        if (!cancelled) setOptions(o);
      })
      .catch(() => {
        if (!cancelled) setOptionsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the saved choice once (client-only; avoids hydration mismatch).
  useEffect(() => {
    const saved = loadAdhanChoice();
    if (saved) {
      const city = saved.city ? findCity(saved.city) : null;
      setSel({
        city: city ? city.slug : null,
        lat: city ? city.lat : saved.lat,
        lng: city ? city.lng : saved.lng,
        method: saved.method,
        madhab: saved.madhab,
      });
    }
    setChoiceLoaded(true);
  }, []);

  // Persist every selection change so the header strip follows it live.
  useEffect(() => {
    if (!choiceLoaded) return;
    const choice: AdhanChoice = {
      city: sel.city,
      lat: sel.lat,
      lng: sel.lng,
      method: sel.method,
      madhab: sel.madhab,
    };
    saveAdhanChoice(choice);
  }, [sel, choiceLoaded]);

  const loadToday = useCallback(async (s: Selection) => {
    setTodayError(null);
    try {
      const t = await getAdhanTimesForChoice({
        day: toISODate(new Date()),
        city: s.city,
        lat: s.city ? undefined : s.lat,
        lng: s.city ? undefined : s.lng,
        method: s.method,
        madhab: s.madhab,
        tz: localTzOffset(),
      });
      setToday(t);
    } catch {
      setToday(null);
      setTodayError('times_failed');
    }
  }, []);

  // Today's times + per-method diffs vs the council default.
  useEffect(() => {
    if (!choiceLoaded) return;
    void loadToday(sel);
    if (!options) return;
    const tz = localTzOffset();
    const day = toISODate(new Date());
    const fetchOne = (method: string) =>
      getAdhanTimesForChoice({
        day,
        city: sel.city,
        lat: sel.city ? undefined : sel.lat,
        lng: sel.city ? undefined : sel.lng,
        method,
        madhab: sel.madhab,
        tz,
      }).catch(() => null);
    void Promise.all(
      options.methods
        .filter((m) => m.available)
        .map(async (m) => {
          const t = await fetchOne(m.id);
          return [m.id, t] as const;
        }),
    ).then(async (rows) => {
      const byId = new Map(rows.map(([id, t]) => [id, t]));
      const base = byId.get(DEFAULT_METHOD)?.timings;
      const next: Record<string, { fajr: number | null; isha: number | null }> = {};
      for (const [id, t] of byId) {
        if (!t || !base) {
          next[id] = { fajr: null, isha: null };
        } else {
          next[id] = {
            fajr: minutesDiff(t.timings.fajr, base.fajr),
            isha: minutesDiff(t.timings.isha, base.isha),
          };
        }
      }
      setDiffs(next);
    });
  }, [sel, options, choiceLoaded, loadToday]);

  // Timetable ranges.
  const rangeSpan = useMemo(() => {
    const nowDate = new Date();
    if (tab === 'week') {
      // Jalali week: Saturday-first. JS getDay(): 0 = Sunday … 6 = Saturday.
      const sinceSaturday = (nowDate.getDay() + 1) % 7;
      const start = addDays(nowDate, -sinceSaturday);
      return { start: toISODate(start), end: toISODate(addDays(start, 6)) };
    }
    if (tab === 'month') {
      const j = toJalali(nowDate);
      const start = fromJalali(j.y, j.m, 1);
      return { start: toISODate(start), end: toISODate(addDays(start, jalaliMonthLength(j.y, j.m) - 1)) };
    }
    const j = toJalali(nowDate);
    const start = fromJalali(j.y, 1, 1);
    const end = addDays(fromJalali(j.y + 1, 1, 1), -1);
    return { start: toISODate(start), end: toISODate(end) };
  }, [tab]);

  useEffect(() => {
    if (!choiceLoaded) return;
    setRangeError(false);
    setRange(null);
    getAdhanRange({
      start: rangeSpan.start,
      end: rangeSpan.end,
      city: sel.city,
      lat: sel.city ? undefined : sel.lat,
      lng: sel.city ? undefined : sel.lng,
      method: sel.method,
      madhab: sel.madhab,
      tz: localTzOffset(),
    })
      .then((r) => {
        setRange(r.days);
        setRangeMeta({ start: r.start, end: r.end });
      })
      .catch(() => setRangeError(true));
  }, [rangeSpan, sel, choiceLoaded, rangeRetry]);

  const next = today ? nextPrayer(today.timings, now) : null;
  const isDay = useMemo(() => {
    if (!today) return true;
    const mins = (s: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const sr = mins(today.timings.sunrise);
    const mg = mins(today.timings.maghrib);
    if (sr === null || mg === null) return true;
    const cur = now.getHours() * 60 + now.getMinutes();
    return cur >= sr && cur < mg;
  }, [today, now]);

  const useGps = useCallback(() => {
    setGpsError(null);
    if (!('geolocation' in navigator)) {
      setGpsError('gps_unsupported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSel((s) => ({ ...s, city: null, lat: pos.coords.latitude, lng: pos.coords.longitude }));
      },
      () => setGpsError('gps_denied'),
      { timeout: 10000, maximumAge: 600000 },
    );
  }, []);

  const selectedMethod = options?.methods.find((m) => m.id === sel.method) ?? null;
  const selectedCityName = sel.city
    ? (labels.cities[sel.city] ?? sel.city)
    : labels.customLocation;

  const yearGroups = useMemo(() => {
    if (tab !== 'year' || !range) return [];
    const groups = new Map<string, AdhanDay[]>();
    for (const d of range) {
      const [y, m, dd] = d.date.split('-').map(Number);
      const j = toJalali(new Date(y, m - 1, dd));
      const key = `${j.y}/${String(j.m).padStart(2, '0')}`;
      const arr = groups.get(key) ?? [];
      arr.push(d);
      groups.set(key, arr);
    }
    return [...groups.entries()].map(([key, days]) => {
      const [, mm] = key.split('/');
      return { key, monthName: labels.jalaliMonths[Number(mm) - 1] ?? key, days };
    });
  }, [tab, range, labels.jalaliMonths]);

  const sourceLabel = (source: string): string =>
    source === 'table'
      ? labels.sourceTable
      : source === 'mixed'
        ? labels.sourceMixed
        : labels.sourceComputed;

  const renderTable = (days: AdhanDay[], highlightToday: boolean) => (
    <div className="adhan-table-wrap">
      <table className="adhan-table">
        <thead>
          <tr>
            <th>{labels.jalaliLabel}</th>
            <th>{labels.miladiLabel}</th>
            {HERO_ORDER.map((p) => (
              <th key={p}>{labels.prayers[p]}</th>
            ))}
            <th>{labels.transparencyMethod}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const [y, m, dd] = d.date.split('-').map(Number);
            const j = toJalali(new Date(y, m - 1, dd));
            const isToday = highlightToday && d.date === todayIso;
            return (
              <tr key={d.date} className={isToday ? 'adhan-today-row' : undefined}>
                <td>
                  {formatJalali(j)}
                  {isToday ? ` (${labels.tableToday})` : ''}
                </td>
                <td dir="ltr">{d.date}</td>
                {HERO_ORDER.map((p) => (
                  <td key={p} dir="ltr">
                    {d.times[p]}
                  </td>
                ))}
                <td>{sourceLabel(d.source)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={`adhan-page ${isDay ? 'adhan-day' : 'adhan-night'}`}>
      {/* Today's hero */}
      <section className="adhan-hero" aria-label={labels.title}>
        <div className="section-head">
          <h1>{labels.title}</h1>
          <p className="section-sub">
            {labels.subtitle} — {selectedCityName}
          </p>
        </div>
        <div className="adhan-dates">
          <span>
            {labels.jalaliLabel}: {formatJalali(jalaliToday)} ({labels.jalaliMonths[jalaliToday.m - 1]})
          </span>
          <span>
            {labels.qamariLabel}: {qamariLine}
          </span>
          <span>
            {labels.miladiLabel}: {miladiLine}
          </span>
        </div>
        {todayError ? (
          <div className="adhan-error" role="alert">
            {labels.timesFailed}{' '}
            <button type="button" className="adhan-btn" onClick={() => void loadToday(selRef.current)}>
              {labels.retry}
            </button>
          </div>
        ) : !today ? (
          <div className="adhan-skeleton" aria-label={labels.loading}>
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : (
          <>
            <div className="adhan-hero-grid">
              {HERO_ORDER.map((p) => (
                <div
                  key={p}
                  className={`adhan-card${next?.name === p ? ' adhan-card-next' : ''}`}
                >
                  <span className="adhan-card-name">{labels.prayers[p]}</span>
                  <span className="adhan-card-time" dir="ltr">
                    {today.timings[p]}
                  </span>
                  {next?.name === p ? (
                    <span className="adhan-card-count" role="timer" aria-label={labels.countdownAria}>
                      {labels.stripPrefix} {formatCountdown(next.inSeconds)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="adhan-source-note">
              {sourceLabel(today.source)}
              {today.city ? ` · ${labels.cities[today.city] ?? today.city}` : ''}
            </p>
          </>
        )}
      </section>

      {/* Method selector */}
      <section className="adhan-section" aria-label={labels.methodLabel}>
        <div className="section-head">
          <h2>{labels.methodLabel}</h2>
        </div>
        {optionsError ? (
          <p className="adhan-error" role="alert">
            {labels.loadFailed}
          </p>
        ) : !options ? (
          <div className="adhan-skeleton" aria-label={labels.loading}>
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="adhan-methods">
            {options.methods.map((m) => {
              const meta = labels.methods[m.id];
              const d = diffs[m.id];
              const selected = sel.method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`adhan-method-card${selected ? ' adhan-method-selected' : ''}`}
                  disabled={!m.available}
                  aria-pressed={selected}
                  onClick={() => setSel((s) => ({ ...s, method: m.id }))}
                >
                  <span className="adhan-method-name">{meta?.name ?? m.label}</span>
                  <span className="adhan-method-auth">{meta?.authority ?? m.authority}</span>
                  <span className="adhan-method-angles">{methodSummary(m, labels)}</span>
                  {m.available && d && m.id !== DEFAULT_METHOD ? (
                    <span className="adhan-method-diff">
                      {labels.diffLabel}: {labels.prayers.fajr} {fmtDiff(d.fajr)} · {labels.prayers.isha}{' '}
                      {fmtDiff(d.isha)}
                    </span>
                  ) : null}
                  {meta?.note ? <span className="adhan-method-note">{meta.note}</span> : null}
                  {m.note && meta?.note !== m.note ? (
                    <span className="adhan-method-note">{m.note}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Madhab + city */}
      <section className="adhan-section adhan-controls" aria-label={labels.madhabLabel}>
        <div className="adhan-field">
          <span className="adhan-field-label">{labels.madhabLabel}</span>
          <div role="radiogroup" aria-label={labels.madhabLabel} className="adhan-radios">
            <label>
              <input
                type="radio"
                name="adhan-madhab"
                checked={sel.madhab === 'hanafi'}
                onChange={() => setSel((s) => ({ ...s, madhab: 'hanafi' }))}
              />{' '}
              {labels.madhabHanafi}
            </label>
            <label>
              <input
                type="radio"
                name="adhan-madhab"
                checked={sel.madhab === 'shafi'}
                onChange={() => setSel((s) => ({ ...s, madhab: 'shafi' }))}
              />{' '}
              {labels.madhabShafi}
            </label>
          </div>
          <p className="adhan-hint">{labels.madhabNote}</p>
        </div>
        <div className="adhan-field">
          <label className="adhan-field-label" htmlFor="adhan-city">
            {labels.citySelectLabel}
          </label>
          <select
            id="adhan-city"
            className="adhan-select"
            value={sel.city ?? '__custom'}
            onChange={(e) => {
              const slug = e.target.value;
              if (slug === '__custom') return;
              const c = findCity(slug) ?? ADHAN_CITIES.find((x) => x.slug === slug);
              if (c) setSel((s) => ({ ...s, city: c.slug, lat: c.lat, lng: c.lng }));
            }}
          >
            {(options?.cities ?? ADHAN_CITIES).map((c) => (
              <option key={c.slug} value={c.slug}>
                {labels.cities[c.slug] ?? c.slug}
              </option>
            ))}
            {sel.city === null ? (
              <option value="__custom">{labels.customLocation}</option>
            ) : null}
          </select>
          <button type="button" className="adhan-btn" onClick={useGps}>
            {labels.useMyLocation}
          </button>
          {sel.city === null ? <p className="adhan-hint">{labels.customLocationHint}</p> : null}
          {gpsError ? (
            <p className="adhan-error" role="alert">
              {gpsError === 'gps_denied' ? labels.gpsDenied : labels.gpsUnsupported}
            </p>
          ) : null}
        </div>
      </section>

      {/* Timetable tabs */}
      <section className="adhan-section" aria-label={labels.tabWeek}>
        <div className="adhan-tabs" role="tablist">
          {(
            [
              ['week', labels.tabWeek],
              ['month', labels.tabMonth],
              ['year', labels.tabYear],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`adhan-tab${tab === id ? ' adhan-tab-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {text}
            </button>
          ))}
        </div>
        {rangeMeta ? (
          <p className="adhan-range-meta" dir="ltr">
            {rangeMeta.start} → {rangeMeta.end}
          </p>
        ) : null}
        {rangeError ? (
          <div className="adhan-error" role="alert">
            {labels.loadFailed}{' '}
            <button
              type="button"
              className="adhan-btn"
              onClick={() => setRangeRetry((n) => n + 1)}
            >
              {labels.retry}
            </button>
          </div>
        ) : !range ? (
          <div className="adhan-skeleton" aria-label={labels.loading}>
            <span />
            <span />
            <span />
          </div>
        ) : tab === 'year' ? (
          <div className="adhan-year">
            {yearGroups.map((g) => (
              <section key={g.key} className="adhan-year-month">
                <h3>{g.monthName}</h3>
                {renderTable(g.days, true)}
              </section>
            ))}
          </div>
        ) : (
          renderTable(range, true)
        )}
      </section>

      {/* Transparency */}
      <section className="adhan-section adhan-transparency" aria-label={labels.transparencyTitle}>
        <div className="section-head">
          <h2>{labels.transparencyTitle}</h2>
        </div>
        {selectedMethod ? (
          <dl className="adhan-facts">
            <div>
              <dt>{labels.transparencyMethod}</dt>
              <dd>
                {labels.methods[selectedMethod.id]?.name ?? selectedMethod.label} —{' '}
                {labels.methods[selectedMethod.id]?.authority ?? selectedMethod.authority} —{' '}
                {methodSummary(selectedMethod, labels)}
              </dd>
            </div>
            <div>
              <dt>{labels.transparencyAsr}</dt>
              <dd>{sel.madhab === 'hanafi' ? '×2' : '×1'}</dd>
            </div>
          </dl>
        ) : null}
        <p>{labels.trueDawnNote}</p>
        <p>{labels.scholarNote}</p>
      </section>
    </div>
  );
}
