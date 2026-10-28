'use client';

/**
 * PlaceRegisterForm — public mosque/place registration (maps phase).
 *
 * Location, in order of preference:
 *   1. Browser geolocation ("use my location") — fills lat/lng from the
 *      device, only after the visitor grants permission; a denial or an
 *      unsupported browser leaves the manual fields untouched.
 *   2. Manual fallback — typed lat/lng, plus a free-text city label. The
 *      city name is stored as a label only; it is NOT geocoded into
 *      coordinates (no geocoding service is wired in this phase).
 *
 * Submission is draft-only on the server: the place appears on the public
 * map only after CRM review + publish. Pure presentation + the lib
 * submit client — no business rules live in this component.
 */
import { useState } from 'react';
import { submitPlace, validCoords, validImageUrl } from '@/lib/places-submit';

export interface PlaceRegisterLabels {
  name: string;
  description: string;
  city: string;
  cityHint: string;
  imageUrl: string;
  imageUrlHint: string;
  lat: string;
  lng: string;
  type: string;
  useMyLocation: string;
  locating: string;
  located: string;
  locationDenied: string;
  locationUnsupported: string;
  manualHint: string;
  submit: string;
  submitting: string;
  success: string;
  successHint: string;
  error: string;
  nameRequired: string;
  invalidCoords: string;
  invalidImageUrl: string;
  backToMap: string;
}

export function PlaceRegisterForm({
  locale,
  labels,
  typeLabels,
  typeKeys,
}: {
  locale: string;
  labels: PlaceRegisterLabels;
  typeLabels: Record<string, string>;
  typeKeys: string[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [type, setType] = useState<string>(typeKeys[0] ?? 'mosque');
  const [locStatus, setLocStatus] = useState<'idle' | 'busy' | 'ok' | 'denied' | 'unsupported'>('idle');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocStatus('unsupported');
      return;
    }
    setLocStatus('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude.toFixed(6)));
        setLng(String(pos.coords.longitude.toFixed(6)));
        setLocStatus('ok');
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  const submit = async () => {
    setError('');
    if (!name.trim()) {
      setError(labels.nameRequired);
      return;
    }
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (!validCoords(nLat, nLng)) {
      setError(labels.invalidCoords);
      return;
    }
    if (!validImageUrl(imageUrl)) {
      setError(labels.invalidImageUrl);
      return;
    }
    setBusy(true);
    try {
      await submitPlace(
        { name, description, city, imageUrl, lat: nLat, lng: nLng, type },
        locale,
        typeKeys,
      );
      setDone(true);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="place-register-done" role="status">
        <p>{labels.success}</p>
        <p className="place-register-hint">{labels.successHint}</p>
        <a className="place-back" href={`/${locale}/places`}>
          {labels.backToMap}
        </a>
      </div>
    );
  }

  return (
    <div className="place-register-form">
      <div className="field">
        <label htmlFor="pr-name">{labels.name}</label>
        <input
          id="pr-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pr-desc">{labels.description}</label>
        <textarea
          id="pr-desc"
          className="input"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pr-city">{labels.city}</label>
        <input
          id="pr-city"
          className="input"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <p className="hint">{labels.cityHint}</p>
      </div>
      <div className="field">
        <label htmlFor="pr-img">{labels.imageUrl}</label>
        <input
          id="pr-img"
          className="input"
          dir="ltr"
          inputMode="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <p className="hint">{labels.imageUrlHint}</p>
      </div>
      <div className="field">
        <label htmlFor="pr-type">{labels.type}</label>
        <select
          id="pr-type"
          className="input"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {typeKeys.map((k) => (
            <option key={k} value={k}>
              {typeLabels[k] ?? k}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>
        <div className="field">
          <label htmlFor="pr-lat">{labels.lat}</label>
          <input
            id="pr-lat"
            className="input"
            dir="ltr"
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pr-lng">{labels.lng}</label>
          <input
            id="pr-lng"
            className="input"
            dir="ltr"
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
      </div>
      <div>
        <button
          type="button"
          className="places-retry"
          onClick={useMyLocation}
          disabled={locStatus === 'busy'}
        >
          {locStatus === 'busy' ? labels.locating : labels.useMyLocation}
        </button>
        {locStatus === 'ok' ? <p className="hint" role="status">{labels.located}</p> : null}
        {locStatus === 'denied' ? <p className="hint" role="status">{labels.locationDenied}</p> : null}
        {locStatus === 'unsupported' ? (
          <p className="hint" role="status">{labels.locationUnsupported}</p>
        ) : null}
        <p className="hint">{labels.manualHint}</p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="place-tour-link" onClick={() => void submit()} disabled={busy}>
        {busy ? labels.submitting : labels.submit}
      </button>
    </div>
  );
}
