'use client';

/**
 * AdhanWidget — the full prayer-times widget.
 *
 * Location: GPS (permission-gated, explicit user action) → manual
 * coordinates → settings default. Times come only from
 * GET /api/v1/adhan/times; when nothing is available the widget shows a
 * setup prompt, never invented times.
 */
import { useState } from 'react';
import { useAdhanCountdown } from '@/lib/hooks/useAdhanCountdown';
import { PRAYER_GRID_ORDER, type PrayerName } from '@/lib/adhan';
import type { AdhanSettings } from '@/lib/settings';

export interface AdhanWidgetLabels {
  title: string;
  subtitle: string;
  nextPrayer: string;
  prayerNames: Record<PrayerName, string>;
  useGps: string;
  manualTitle: string;
  latLabel: string;
  lngLabel: string;
  cityLabel: string;
  applyLocation: string;
  changeLocation: string;
  hijriLabel: string;
  methodLabel: string;
  needsLocation: string;
  timesFailed: string;
  timesInvalid: string;
  gpsDenied: string;
  gpsUnsupported: string;
  invalidCoords: string;
  countdownAria: string;
}

export function AdhanWidget({
  locale,
  settings,
  labels,
}: {
  locale: string;
  settings: AdhanSettings;
  labels: AdhanWidgetLabels;
}) {
  const { state, useGps, useManual, clearLocation, reload } = useAdhanCountdown(settings, locale);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [city, setCity] = useState('');
  const [coordError, setCoordError] = useState(false);

  const applyManual = () => {
    const la = Number(lat.replace(',', '.'));
    const ln = Number(lng.replace(',', '.'));
    if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
      setCoordError(true);
      return;
    }
    setCoordError(false);
    void useManual(la, ln, city.trim() || null);
  };

  const errorText =
    state.error === 'gps_denied'
      ? labels.gpsDenied
      : state.error === 'gps_unsupported'
        ? labels.gpsUnsupported
        : state.error === 'times_invalid'
          ? labels.timesInvalid
          : state.error === 'times_failed'
            ? labels.timesFailed
            : null;

  return (
    <div className="adhan-widget">
      <h1 className="page-title">{labels.title}</h1>
      <p className="page-sub">{labels.subtitle}</p>

      {state.status === 'needs_location' || state.status === 'locating' ? (
        <section className="adhan-setup" aria-label={labels.manualTitle}>
          <p>{labels.needsLocation}</p>
          <div className="adhan-setup-actions">
            <button type="button" onClick={() => void useGps()} disabled={state.status === 'locating'}>
              {labels.useGps}
            </button>
          </div>
          <div className="adhan-manual">
            <h2>{labels.manualTitle}</h2>
            <label>
              <span>{labels.latLabel}</span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="35.7"
                dir="ltr"
              />
            </label>
            <label>
              <span>{labels.lngLabel}</span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="51.4"
                dir="ltr"
              />
            </label>
            <label>
              <span>{labels.cityLabel}</span>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            {coordError ? (
              <p className="adhan-error" role="alert">
                {labels.invalidCoords}
              </p>
            ) : null}
            <button type="button" onClick={applyManual}>
              {labels.applyLocation}
            </button>
          </div>
          {errorText ? (
            <p className="adhan-error" role="alert">
              {errorText}
            </p>
          ) : null}
        </section>
      ) : null}

      {state.status === 'loading' ? <p className="adhan-loading">…</p> : null}

      {state.status === 'unavailable' ? (
        <section className="adhan-setup">
          <p className="adhan-error" role="alert">
            {errorText ?? labels.timesFailed}
          </p>
          <button type="button" onClick={reload}>
            {labels.applyLocation}
          </button>
          <button type="button" onClick={clearLocation}>
            {labels.changeLocation}
          </button>
        </section>
      ) : null}

      {state.status === 'ready' && state.times ? (
        <section className="adhan-times" aria-label={labels.title}>
          {state.next ? (
            <div className="adhan-next" role="timer" aria-label={labels.countdownAria}>
              <span className="adhan-next-label">
                {labels.nextPrayer}: {labels.prayerNames[state.next.name]} · {state.next.at}
              </span>
              <span className="adhan-countdown" aria-live="off">
                {state.countdown}
              </span>
            </div>
          ) : null}
          <ul className="adhan-grid">
            {PRAYER_GRID_ORDER.map((name) => (
              <li
                key={name}
                className={`adhan-cell${state.next?.name === name ? ' adhan-cell-next' : ''}`}
              >
                <span className="adhan-name">{labels.prayerNames[name]}</span>
                <span className="adhan-time" dir="ltr">
                  {state.times!.timings[name].slice(0, 5)}
                </span>
              </li>
            ))}
          </ul>
          <p className="adhan-meta">
            {state.hijriLine ? (
              <>
                {labels.hijriLabel}: <span>{state.hijriLine}</span> ·{' '}
              </>
            ) : null}
            {labels.methodLabel}: {state.times.methodLabel || state.times.method} · {state.times.madhab}
            {state.location?.label ? ` · ${state.location.label}` : ''}
          </p>
          <button type="button" className="adhan-change" onClick={clearLocation}>
            {labels.changeLocation}
          </button>
        </section>
      ) : null}
    </div>
  );
}
