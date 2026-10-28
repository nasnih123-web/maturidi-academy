'use client';

/**
 * AdhanTimesPage — the full prayer-times page (/adhan).
 *
 * Server shell (page.tsx) only passes settings + translations; every time
 * on this page comes from GET /api/v1/adhan/* — the web NEVER computes or
 * invents times. Selection (place, method, madhab) is saved to localStorage
 * (ma.adhan_choice) so the header strip on every page follows it live.
 *
 * Sections: today's hero (6 cards + live countdown + Jalali/Qamari/Miladi
 * dates) → method selector cards (with today's minute-difference vs the
 * council default) → madhab toggle (Asr only) → location (worldwide search
 * + GPS reverse-geocode, no city field) → week/month/year timetable tabs.
 * The method cards already carry each method's details, so there is no
 * separate transparency block and no per-source note on this page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ADHAN_CHOICE_EVENT,
  formatCountdown,
  formatHijri,
  getAdhanOptions,
  getAdhanRange,
  getAdhanTimesForChoice,
  loadAdhanChoice,
  localTzOffset,
  nextPrayer,
  requestBrowserLocationOnce,
  reversePlace,
  saveAdhanChoice,
  searchPlaces,
  type AdhanChoice,
  type AdhanDay,
  type AdhanMethodOption,
  type AdhanOptions,
  type AdhanPlace,
  type AdhanTimes,
  type GeocodePlace,
  type PrayerName,
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
  locationLabel: string;
  searchPlaceholder: string;
  searching: string;
  searchNoResults: string;
  searchFailed: string;
  useMyLocation: string;
  gpsLocating: string;
  tabWeek: string;
  tabMonth: string;
  tabYear: string;
  methods: Record<string, AdhanMethodLabels>;
  cities: Record<string, string>;
  jalaliMonths: string[];
  diffLabel: string;
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
  needsLocation: string;
  prevMonth: string;
  nextMonth: string;
  selectDayHint: string;
}

const HERO_ORDER: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const DEFAULT_METHOD = 'council';

interface Selection {
  place: AdhanPlace;
  method: string;
  madhab: string;
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

/** Display name for a place: localized city name for legacy slugs, else the
 *  Nominatim short name as-is. Null when the place has no name at all. */
function placeName(place: AdhanPlace, cities: Record<string, string>): string | null {
  if (!place.name) return null;
  return cities[place.name] ?? place.name;
}

/** Coordinates label used when a place has no name (GPS reverse gave none). */
function coordsLabel(place: AdhanPlace): string {
  return `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;
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
  // Null until a place exists: there is NO default city and no fallback
  // location. The restore effect below resolves saved choice → shared
  // once-per-session auto-locate → still null (honest needs-location state).
  const [sel, setSel] = useState<Selection | null>(null);
  const [today, setToday] = useState<AdhanTimes | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, { fajr: number | null; isha: number | null }>>({});
  const [tab, setTab] = useState<'week' | 'month' | 'year'>('week');
  const [viewMonth, setViewMonth] = useState(() => {
    const j = toJalali(new Date());
    return { y: j.y, m: j.m };
  });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [range, setRange] = useState<AdhanDay[] | null>(null);
  const [rangeError, setRangeError] = useState(false);
  const [rangeRetry, setRangeRetry] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const [choiceLoaded, setChoiceLoaded] = useState(false);
  const selRef = useRef(sel);
  selRef.current = sel;

  // Place search (debounced autocomplete, worldwide via the API proxy).
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodePlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchSeq = useRef(0);

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const jalaliToday: JalaliDate = useMemo(() => toJalali(new Date()), []);
  const miladiLine = useMemo(() => {
    try {
      // fa-IR's DEFAULT calendar is Jalali, so the Gregorian line must force
      // the Gregorian calendar explicitly — otherwise it renders the same
      // Jalali date as the Shamsi line. Same for ar-SA (Islamic default).
      const tag =
        locale === 'fa'
          ? 'fa-IR-u-ca-gregory'
          : locale === 'ar'
            ? 'ar-SA-u-ca-gregory'
            : 'en-u-ca-gregory';
      return new Intl.DateTimeFormat(tag, { dateStyle: 'long' }).format(new Date());
    } catch {
      return todayIso;
    }
  }, [locale, todayIso]);
  const qamariLine = useMemo(() => formatHijri(locale) || '', [locale]);
  const weekdayTag = locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar-SA' : 'en';

  // Ticking clock for the countdown + day/night gradient.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load the method catalog once.
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

  // Patch the selection only when one exists (all patching controls render
  // only while sel is non-null; GPS/search construct a full selection).
  const updateSel = useCallback((patch: Partial<Selection>) => {
    setSel((s) => (s ? { ...s, ...patch } : s));
  }, []);

  // Restore the saved choice once (client-only; avoids hydration mismatch).
  // With no saved choice, auto-locate once per session via the shared
  // helper (same helper the banner strip uses — concurrent callers share
  // one attempt, so strip + page never double-prompt). Still null after
  // that means: denied/unavailable → honest needs-location state; the
  // search + GPS controls below stay usable to fix it. Also listen for
  // ma:adhan-choice so a strip-side success reaches this page live.
  useEffect(() => {
    const applySaved = () => {
      const saved = loadAdhanChoice();
      if (!saved) return;
      // Equality guard: the persist effect below re-saves (and re-fires
      // this event) on every sel change — without this check the page
      // would loop save → event → setSel → save forever.
      const cur = selRef.current;
      if (
        cur &&
        cur.place.lat === saved.place.lat &&
        cur.place.lng === saved.place.lng &&
        cur.place.name === saved.place.name &&
        cur.method === saved.method &&
        cur.madhab === saved.madhab
      ) {
        return;
      }
      setSel({ place: saved.place, method: saved.method, madhab: saved.madhab });
    };
    applySaved();
    if (!loadAdhanChoice()) {
      void requestBrowserLocationOnce({
        method: settings.method,
        madhab: settings.madhab,
      }).then((place) => {
        if (place) {
          setSel({ place, method: settings.method, madhab: settings.madhab });
        }
      });
    }
    window.addEventListener(ADHAN_CHOICE_EVENT, applySaved);
    setChoiceLoaded(true);
    return () => window.removeEventListener(ADHAN_CHOICE_EVENT, applySaved);
  }, [settings.method, settings.madhab]);

  // Persist every selection change so the header strip follows it live.
  useEffect(() => {
    if (!choiceLoaded || !sel) return;
    const choice: AdhanChoice = {
      place: sel.place,
      method: sel.method,
      madhab: sel.madhab,
    };
    saveAdhanChoice(choice);
  }, [sel, choiceLoaded]);

  // Debounced place search: min 2 chars, 300ms, stale responses ignored.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchOpen(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    const seq = ++searchSeq.current;
    const id = setTimeout(() => {
      searchPlaces(q)
        .then((r) => {
          if (searchSeq.current !== seq) return;
          setResults(r);
          setSearchOpen(true);
        })
        .catch(() => {
          if (searchSeq.current !== seq) return;
          setResults([]);
          setSearchError(true);
          setSearchOpen(true);
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const loadToday = useCallback(async (s: Selection) => {
    setTodayError(null);
    try {
      const t = await getAdhanTimesForChoice({
        day: toISODate(new Date()),
        lat: s.place.lat,
        lng: s.place.lng,
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
    if (!choiceLoaded || !sel) return;
    void loadToday(sel);
    if (!options) return;
    const tz = localTzOffset();
    const day = toISODate(new Date());
    const fetchOne = (method: string) =>
      getAdhanTimesForChoice({
        day,
        lat: sel.place.lat,
        lng: sel.place.lng,
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
      const start = fromJalali(viewMonth.y, viewMonth.m, 1);
      const len = jalaliMonthLength(viewMonth.y, viewMonth.m);
      return { start: toISODate(start), end: toISODate(addDays(start, len - 1)) };
    }
    const j = toJalali(nowDate);
    const start = fromJalali(j.y, 1, 1);
    const end = addDays(fromJalali(j.y + 1, 1, 1), -1);
    return { start: toISODate(start), end: toISODate(end) };
  }, [tab, viewMonth]);

  useEffect(() => {
    if (!choiceLoaded || !sel) return;
    setRangeError(false);
    setRange(null);
    getAdhanRange({
      start: rangeSpan.start,
      end: rangeSpan.end,
      lat: sel.place.lat,
      lng: sel.place.lng,
      method: sel.method,
      madhab: sel.madhab,
      tz: localTzOffset(),
    })
      .then((r) => {
        setRange(r.days);
        if (tab === 'month') {
          // Preselect today when it is inside this month, else nothing.
          const todayRow = r.days.find((d) => d.date === todayIso);
          if (todayRow) {
            const [y, m, dd] = todayRow.date.split('-').map(Number);
            setSelectedDay(toJalali(new Date(y, m - 1, dd)).d);
          } else {
            setSelectedDay(null);
          }
        }
      })
      .catch(() => setRangeError(true));
  }, [rangeSpan, sel, choiceLoaded, rangeRetry, tab, todayIso]);

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
    setGpsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Reverse-geocode for a name; a naming failure never blocks times.
        // (User-initiated GPS: not gated by the once-per-session guard.)
        reversePlace(lat, lng)
          .then((p) => {
            const place = { name: p.name, lat, lng };
            setSel((s) => (s ? { ...s, place } : { place, method: settings.method, madhab: settings.madhab }));
          })
          .catch(() => {
            const place = { name: null, lat, lng };
            setSel((s) => (s ? { ...s, place } : { place, method: settings.method, madhab: settings.madhab }));
          })
          .finally(() => setGpsLocating(false));
      },
      () => {
        setGpsLocating(false);
        setGpsError('gps_denied');
      },
      { timeout: 10000, maximumAge: 600000 },
    );
  }, [settings.method, settings.madhab]);

  const pickPlace = useCallback(
    (p: GeocodePlace) => {
      const place = { name: p.name, lat: p.lat, lng: p.lng };
      setSel((s) => (s ? { ...s, place } : { place, method: settings.method, madhab: settings.madhab }));
      setQuery('');
      setResults([]);
      setSearchOpen(false);
    },
    [settings.method, settings.madhab],
  );

  const goToMonth = useCallback((y: number, m: number) => {
    setViewMonth({ y, m });
    setSelectedDay(null);
    setTab('month');
  }, []);

  const shiftMonth = useCallback(
    (delta: number) => {
      setViewMonth((v) => {
        let { y, m } = v;
        m += delta;
        if (m < 1) {
          y -= 1;
          m = 12;
        } else if (m > 12) {
          y += 1;
          m = 1;
        }
        return { y, m };
      });
      setSelectedDay(null);
    },
    [],
  );

  const heroPlaceName = sel ? placeName(sel.place, labels.cities) : null;
  const currentPlaceDisplay = sel ? (heroPlaceName ?? coordsLabel(sel.place)) : '';

  // Month grid data: Jalali day number → range day (month tab only).
  const monthDays = useMemo(() => {
    const map = new Map<number, AdhanDay>();
    if (tab !== 'month' || !range) return map;
    for (const d of range) {
      const [y, m, dd] = d.date.split('-').map(Number);
      const j = toJalali(new Date(y, m - 1, dd));
      if (j.y === viewMonth.y && j.m === viewMonth.m) map.set(j.d, d);
    }
    return map;
  }, [tab, range, viewMonth]);

  const monthFirstOffset = useMemo(() => {
    const first = fromJalali(viewMonth.y, viewMonth.m, 1);
    return (first.getDay() + 1) % 7; // Saturday-first blanks
  }, [viewMonth]);

  const monthLen = jalaliMonthLength(viewMonth.y, viewMonth.m);
  const selectedDayData = selectedDay !== null ? monthDays.get(selectedDay) : undefined;

  // Year tab: 12 month cards grouped client-side by Jalali month.
  const yearCards = useMemo(() => {
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
      const [yy, mm] = key.split('/').map(Number);
      return {
        key,
        year: yy,
        month: mm,
        monthName: labels.jalaliMonths[mm - 1] ?? key,
        first: days[0],
      };
    });
  }, [tab, range, labels.jalaliMonths]);

  const weekDayName = useCallback(
    (iso: string): string => {
      try {
        const [y, m, dd] = iso.split('-').map(Number);
        return new Intl.DateTimeFormat(weekdayTag, { weekday: 'long' }).format(
          new Date(y, m - 1, dd),
        );
      } catch {
        return iso;
      }
    },
    [weekdayTag],
  );

  return (
    <div className={`adhan-page ${isDay ? 'adhan-day' : 'adhan-night'}`}>
      {/* Today's hero */}
      <section className="adhan-hero" aria-label={labels.title}>
        <div className="section-head">
          <h1>{labels.title}</h1>
          <p className="section-sub">
            {labels.subtitle}
            {heroPlaceName ? ` — ${heroPlaceName}` : ''}
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
        {!choiceLoaded ? (
          <div className="adhan-skeleton" aria-label={labels.loading}>
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : !sel ? (
          <p className="adhan-hint" role="status">
            {labels.needsLocation}
          </p>
        ) : todayError ? (
          <div className="adhan-error" role="alert">
            {labels.timesFailed}{' '}
            <button
              type="button"
              className="adhan-btn"
              onClick={() => {
                const s = selRef.current;
                if (s) void loadToday(s);
              }}
            >
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
        )}
      </section>

      {/* Method selector — only once a place exists (no silent fallback). */}
      {sel ? (
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
                  onClick={() => updateSel({ method: m.id })}
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
      ) : null}

      {/* Madhab + location — the location field always renders: it is how
          a visitor without a place fixes the needs-location state. */}
      <section className="adhan-section adhan-controls" aria-label={labels.madhabLabel}>
        {sel ? (
        <div className="adhan-field">
          <span className="adhan-field-label">{labels.madhabLabel}</span>
          <div role="radiogroup" aria-label={labels.madhabLabel} className="adhan-radios">
            <label>
              <input
                type="radio"
                name="adhan-madhab"
                checked={sel.madhab === 'hanafi'}
                onChange={() => updateSel({ madhab: 'hanafi' })}
              />{' '}
              {labels.madhabHanafi}
            </label>
            <label>
              <input
                type="radio"
                name="adhan-madhab"
                checked={sel.madhab === 'shafi'}
                onChange={() => updateSel({ madhab: 'shafi' })}
              />{' '}
              {labels.madhabShafi}
            </label>
          </div>
          <p className="adhan-hint">{labels.madhabNote}</p>
        </div>
        ) : null}
        <div className="adhan-field">
          <span className="adhan-field-label">{labels.locationLabel}</span>
          {sel ? (
          <p className="adhan-place-current" dir="auto">
            {currentPlaceDisplay}
          </p>
          ) : null}
          <div className="adhan-search">
            <input
              type="search"
              className="adhan-search-input"
              value={query}
              placeholder={labels.searchPlaceholder}
              aria-label={labels.searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                if (results.length > 0 || searchError) setSearchOpen(true);
              }}
              onBlur={() => {
                // Delay so a click on a result still lands before close.
                setTimeout(() => setSearchOpen(false), 150);
              }}
            />
            {searchOpen ? (
              <div className="adhan-search-results" role="listbox">
                {searching ? (
                  <p className="adhan-search-state">{labels.searching}</p>
                ) : searchError ? (
                  <p className="adhan-search-state" role="alert">
                    {labels.searchFailed}
                  </p>
                ) : results.length === 0 ? (
                  <p className="adhan-search-state">{labels.searchNoResults}</p>
                ) : (
                  results.map((r) => (
                    <button
                      key={`${r.lat},${r.lng},${r.display_name}`}
                      type="button"
                      className="adhan-search-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickPlace(r)}
                    >
                      <span className="adhan-search-item-name">
                        {r.name ?? r.display_name}
                      </span>
                      {r.display_name ? (
                        <span className="adhan-search-item-sub">{r.display_name}</span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="adhan-btn"
            onClick={useGps}
            disabled={gpsLocating}
          >
            {gpsLocating ? labels.gpsLocating : labels.useMyLocation}
          </button>
          {gpsError ? (
            <p className="adhan-error" role="alert">
              {gpsError === 'gps_denied' ? labels.gpsDenied : labels.gpsUnsupported}
            </p>
          ) : null}
        </div>
      </section>

      {/* Timetable tabs — only once a place exists (no silent fallback). */}
      {sel ? (
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
              onClick={() => {
                if (id === 'month') {
                  const j = toJalali(new Date());
                  setViewMonth({ y: j.y, m: j.m });
                  setSelectedDay(null);
                }
                setTab(id);
              }}
            >
              {text}
            </button>
          ))}
        </div>
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
        ) : tab === 'week' ? (
          <div className="adhan-week-rail">
            {range.map((d) => {
              const [y, m, dd] = d.date.split('-').map(Number);
              const j = toJalali(new Date(y, m - 1, dd));
              const isToday = d.date === todayIso;
              return (
                <article
                  key={d.date}
                  className={`adhan-day-card${isToday ? ' adhan-day-today' : ''}`}
                >
                  <header className="adhan-day-head">
                    <span className="adhan-day-weekday">{weekDayName(d.date)}</span>
                    <span className="adhan-day-date">{formatJalali(j)}</span>
                    {isToday ? <span className="adhan-day-badge">{labels.tableToday}</span> : null}
                  </header>
                  <dl className="adhan-day-times">
                    {HERO_ORDER.map((p) => (
                      <div key={p} className="adhan-day-time-row">
                        <dt>{labels.prayers[p]}</dt>
                        <dd dir="ltr">{d.times[p]}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        ) : tab === 'month' ? (
          <div>
            <div className="adhan-cal-nav">
              <button type="button" className="adhan-btn" onClick={() => shiftMonth(-1)}>
                {labels.prevMonth}
              </button>
              <h3>
                {labels.jalaliMonths[viewMonth.m - 1]} {viewMonth.y}
              </h3>
              <button type="button" className="adhan-btn" onClick={() => shiftMonth(1)}>
                {labels.nextMonth}
              </button>
            </div>
            <div className="adhan-cal-grid" role="grid">
              {Array.from({ length: monthFirstOffset }).map((_, i) => (
                <span key={`blank-${i}`} className="adhan-cal-blank" />
              ))}
              {Array.from({ length: monthLen }).map((_, i) => {
                const dayNum = i + 1;
                const day = monthDays.get(dayNum);
                const isToday =
                  day !== undefined && day.date === todayIso;
                const isSelected = selectedDay === dayNum;
                return (
                  <button
                    key={dayNum}
                    type="button"
                    className={`adhan-cal-cell${isToday ? ' adhan-cal-today' : ''}${isSelected ? ' adhan-cal-selected' : ''}`}
                    disabled={!day}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedDay(dayNum)}
                  >
                    <span className="adhan-cal-num">{dayNum}</span>
                    {day ? (
                      <>
                        <span className="adhan-cal-fajr" dir="ltr">
                          {day.times.fajr}
                        </span>
                        <span className="adhan-cal-maghrib" dir="ltr">
                          {day.times.maghrib}
                        </span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {selectedDayData ? (
              <div className="adhan-cal-detail">
                <h4>
                  {formatJalali(
                    toJalali(
                      new Date(
                        Number(selectedDayData.date.split('-')[0]),
                        Number(selectedDayData.date.split('-')[1]) - 1,
                        Number(selectedDayData.date.split('-')[2]),
                      ),
                    ),
                  )}
                  {selectedDayData.date === todayIso ? ` (${labels.tableToday})` : ''}
                </h4>
                <dl className="adhan-cal-detail-grid">
                  {HERO_ORDER.map((p) => (
                    <div key={p} className="adhan-day-time-row">
                      <dt>{labels.prayers[p]}</dt>
                      <dd dir="ltr">{selectedDayData.times[p]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="adhan-hint">{labels.selectDayHint}</p>
            )}
          </div>
        ) : (
          <div className="adhan-year-cards">
            {yearCards.map((g) => (
              <button
                key={g.key}
                type="button"
                className="adhan-month-card"
                onClick={() => goToMonth(g.year, g.month)}
              >
                <span className="adhan-month-card-name">
                  {g.monthName} {g.year}
                </span>
                <span className="adhan-month-card-times">
                  {labels.prayers.fajr} <span dir="ltr">{g.first.times.fajr}</span> ·{' '}
                  {labels.prayers.maghrib} <span dir="ltr">{g.first.times.maghrib}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}
