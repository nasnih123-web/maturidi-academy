'use client';

/**
 * GlobeExplorer — the 3D-globe places page (globe phase).
 *
 * A react-globe.gl globe (three-globe) with emoji markers for published
 * places, a corner legend (symbol + label per type, click to toggle that
 * type), a basemap-mode switcher, name search, a "my location" button with
 * a qibla arc to the Kaaba, and a side panel for the selected place
 * (gallery, videos, description, city, type, detail link, qibla button).
 * Pure presentation: all data arrives as props from the RSC shell; the
 * only logic here is view state + the qibla math in lib/places-globe.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import {
  GLOBE_TEXTURES,
  KAABA,
  qiblaBearing,
  qiblaDistanceKm,
  type GlobeMode,
} from '@/lib/places-globe';
import { coverImage, typeEmoji, typeLabel, type PlaceTypeDef, type PlaceView, type PlacesPopupConfig } from '@/lib/places-view';
import { videoEmbedUrl } from '@/lib/video-embed';
import type { PlacesGlobeSettings } from '@/lib/settings';

export interface GlobeExplorerLabels {
  legendTitle: string;
  allTypes: string;
  modeSatellite: string;
  modeSimple: string;
  modeDark: string;
  modeTopology: string;
  searchPlaceholder: string;
  searchNoResults: string;
  myLocation: string;
  locating: string;
  located: string;
  locationDenied: string;
  locationUnsupported: string;
  autoRotateOn: string;
  autoRotateOff: string;
  qiblaFromHere: string;
  /** Template with {deg} and {km}. */
  qiblaInfo: string;
  qiblaArcLabel: string;
  closePanel: string;
  galleryPrev: string;
  galleryNext: string;
  galleryCounter: string;
  video360: string;
  videoRegular: string;
  videoLinkFallback: string;
  viewDetail: string;
  cityLabel: string;
  typeLabel: string;
  loading: string;
}

interface PlaceDatum {
  kind: 'place' | 'me';
  place?: PlaceView;
  lat: number;
  lng: number;
}

interface Qibla {
  fromLat: number;
  fromLng: number;
  fromName: string;
}

const MODE_LABEL_KEYS: { mode: GlobeMode; key: keyof GlobeExplorerLabels }[] = [
  { mode: 'satellite', key: 'modeSatellite' },
  { mode: 'simple', key: 'modeSimple' },
  { mode: 'dark', key: 'modeDark' },
  { mode: 'topology', key: 'modeTopology' },
];

export function GlobeExplorer({
  locale,
  places,
  typeDefs,
  popupConfig,
  globeSettings,
  labels,
}: {
  locale: string;
  places: PlaceView[];
  typeDefs: PlaceTypeDef[];
  popupConfig: PlacesPopupConfig;
  globeSettings: PlacesGlobeSettings;
  labels: GlobeExplorerLabels;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [mode, setMode] = useState<GlobeMode>(globeSettings.defaultMode);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<PlaceView | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'busy' | 'ok' | 'denied' | 'unsupported'>('idle');
  const [qibla, setQibla] = useState<Qibla | null>(null);
  const [autoRotate, setAutoRotate] = useState(globeSettings.autoRotate);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) setSize({ w: Math.floor(rect.width), h: 520 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.5;
    }
  }, [autoRotate]);

  const visiblePlaces = useMemo(
    () => places.filter((p) => !hiddenTypes.has(p.type)),
    [places, hiddenTypes],
  );

  const markers = useMemo<PlaceDatum[]>(() => {
    const out: PlaceDatum[] = visiblePlaces.map((place) => ({
      kind: 'place' as const,
      place,
      lat: place.lat,
      lng: place.lng,
    }));
    if (myLoc) out.push({ kind: 'me', lat: myLoc.lat, lng: myLoc.lng });
    return out;
  }, [visiblePlaces, myLoc]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) m.set(p.type, (m.get(p.type) ?? 0) + 1);
    return m;
  }, [places]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return places.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [places, query]);

  const flyTo = (lat: number, lng: number, altitude: number): void => {
    globeRef.current?.pointOfView({ lat, lng, altitude }, 1500);
  };

  const selectPlace = (place: PlaceView): void => {
    setSelected(place);
    setGalleryIndex(0);
    flyTo(place.lat, place.lng, 1.0);
  };

  const toggleType = (key: string): void => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const useMyLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setLocStatus('unsupported');
      return;
    }
    setLocStatus('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyLoc({ lat, lng });
        setLocStatus('ok');
        setQibla({ fromLat: lat, fromLng: lng, fromName: labels.myLocation });
        flyTo(lat, lng, 1.2);
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  const showQiblaFromPlace = (place: PlaceView): void => {
    setQibla({ fromLat: place.lat, fromLng: place.lng, fromName: place.name });
  };

  const htmlElement = (d: object): HTMLElement => {
    const datum = d as PlaceDatum;
    const el = document.createElement('div');
    if (datum.kind === 'me') {
      el.className = 'globe-marker globe-marker-me';
      el.textContent = '📍';
      el.title = labels.myLocation;
      return el;
    }
    const place = datum.place as PlaceView;
    el.className = 'globe-marker';
    el.textContent = typeEmoji(typeDefs, place.type);
    el.title = place.name;
    el.addEventListener('click', () => selectPlace(place));
    return el;
  };

  const arcs = qibla
    ? [{ startLat: qibla.fromLat, startLng: qibla.fromLng, endLat: KAABA.lat, endLng: KAABA.lng }]
    : [];

  const panelImages = selected
    ? selected.images.length > 0
      ? selected.images
      : coverImage(selected)
        ? [{ url: coverImage(selected) as string, caption: '' }]
        : []
    : [];
  const panelEmbed = selected?.videoUrl ? videoEmbedUrl(selected.videoUrl) : null;

  return (
    <div className="globe-explorer">
      <div className="globe-toolbar">
        <div className="globe-modes" role="group">
          {MODE_LABEL_KEYS.map(({ mode: m, key }) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'globe-mode-btn active' : 'globe-mode-btn'}
              onClick={() => setMode(m)}
            >
              {labels[key]}
            </button>
          ))}
        </div>
        <div className="globe-search">
          <input
            className="input"
            type="search"
            value={query}
            placeholder={labels.searchPlaceholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
          />
          {searchOpen && query.trim() ? (
            <div className="globe-search-results" role="listbox">
              {searchResults.length === 0 ? (
                <p className="hint">{labels.searchNoResults}</p>
              ) : (
                searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="globe-search-item"
                    onClick={() => {
                      selectPlace(p);
                      setSearchOpen(false);
                    }}
                  >
                    <span>{typeEmoji(typeDefs, p.type)}</span> {p.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="globe-tool-btn"
          onClick={useMyLocation}
          disabled={locStatus === 'busy'}
        >
          {locStatus === 'busy' ? labels.locating : labels.myLocation}
        </button>
        <button
          type="button"
          className="globe-tool-btn"
          onClick={() => setAutoRotate((v) => !v)}
        >
          {autoRotate ? labels.autoRotateOff : labels.autoRotateOn}
        </button>
      </div>

      {locStatus === 'ok' ? <p className="hint" role="status">{labels.located}</p> : null}
      {locStatus === 'denied' ? <p className="hint" role="status">{labels.locationDenied}</p> : null}
      {locStatus === 'unsupported' ? <p className="hint" role="status">{labels.locationUnsupported}</p> : null}
      {qibla ? (
        <p className="hint globe-qibla-info" role="status">
          {labels.qiblaInfo
            .replace('{deg}', String(Math.round(qiblaBearing(qibla.fromLat, qibla.fromLng))))
            .replace('{km}', String(qiblaDistanceKm(qibla.fromLat, qibla.fromLng)))}
          {' — '}
          {qibla.fromName}
        </p>
      ) : null}

      <div className="globe-frame" ref={wrapRef}>
        <Globe
          ref={globeRef}
          width={size.w}
          height={size.h}
          globeImageUrl={GLOBE_TEXTURES[mode]}
          backgroundColor="rgba(0,0,0,0)"
          htmlElementsData={markers}
          htmlElement={htmlElement}
          arcsData={arcs}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor="#e8c766"
          arcStroke={1.2}
          onGlobeReady={() => {
            globeRef.current?.pointOfView(
              {
                lat: globeSettings.defaultLat,
                lng: globeSettings.defaultLng,
                altitude: globeSettings.defaultAltitude,
              },
              0,
            );
            const controls = globeRef.current?.controls();
            if (controls) {
              controls.autoRotate = autoRotate;
              controls.autoRotateSpeed = 0.5;
            }
          }}
        />
        <div className="globe-legend" aria-label={labels.legendTitle}>
          <p className="globe-legend-title">{labels.legendTitle}</p>
          <button type="button" className="globe-legend-row" onClick={() => setHiddenTypes(new Set())}>
            <span aria-hidden>🌍</span> {labels.allTypes} ({places.length})
          </button>
          {typeDefs.map((def) => {
            const n = counts.get(def.key) ?? 0;
            if (n === 0) return null;
            const hidden = hiddenTypes.has(def.key);
            return (
              <button
                key={def.key}
                type="button"
                className={hidden ? 'globe-legend-row hidden-type' : 'globe-legend-row'}
                onClick={() => toggleType(def.key)}
                aria-pressed={!hidden}
              >
                <span aria-hidden>{def.emoji}</span>{' '}
                {locale === 'ar' ? def.ar : locale === 'en' ? def.en : def.fa} ({n})
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="globe-panel" role="dialog" aria-label={selected.name}>
          <div className="globe-panel-head">
            <h2>{selected.name}</h2>
            <button type="button" className="globe-tool-btn" onClick={() => setSelected(null)}>
              {labels.closePanel}
            </button>
          </div>
          {popupConfig.showImage && panelImages.length > 0 ? (
            <div className="globe-gallery">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={panelImages[Math.min(galleryIndex, panelImages.length - 1)].url}
                alt={panelImages[Math.min(galleryIndex, panelImages.length - 1)].caption || selected.name}
                loading="lazy"
              />
              {panelImages.length > 1 ? (
                <div className="globe-gallery-nav">
                  <button
                    type="button"
                    onClick={() => setGalleryIndex((i) => (i - 1 + panelImages.length) % panelImages.length)}
                  >
                    {labels.galleryPrev}
                  </button>
                  <span>
                    {labels.galleryCounter
                      .replace('{i}', String(Math.min(galleryIndex, panelImages.length - 1) + 1))
                      .replace('{n}', String(panelImages.length))}
                  </span>
                  <button
                    type="button"
                    onClick={() => setGalleryIndex((i) => (i + 1) % panelImages.length)}
                  >
                    {labels.galleryNext}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {popupConfig.showDescription && selected.description ? (
            <p className="place-desc">{selected.description}</p>
          ) : null}
          <dl className="place-meta">
            {popupConfig.showType ? (
              <div>
                <dt>{labels.typeLabel}</dt>
                <dd>
                  {typeEmoji(typeDefs, selected.type)} {typeLabel(typeDefs, selected.type, locale)}
                </dd>
              </div>
            ) : null}
            {popupConfig.showCity && selected.city ? (
              <div>
                <dt>{labels.cityLabel}</dt>
                <dd>{selected.city}</dd>
              </div>
            ) : null}
          </dl>
          {selected.video360Id ? (
            <p>
              <a className="place-tour-link" href={`/${locale}/library/${selected.video360Id}`}>
                {labels.video360}
              </a>
            </p>
          ) : null}
          {selected.videoUrl ? (
            panelEmbed ? (
              <iframe
                title={selected.name}
                src={panelEmbed}
                loading="lazy"
                allowFullScreen
                style={{ width: '100%', height: '260px', border: 0, borderRadius: '0.6rem' }}
              />
            ) : (
              <p>
                <a className="place-tour-link" href={selected.videoUrl} target="_blank" rel="noreferrer">
                  {labels.videoLinkFallback}
                </a>
              </p>
            )
          ) : null}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
            <button type="button" className="globe-tool-btn" onClick={() => showQiblaFromPlace(selected)}>
              {labels.qiblaFromHere}
            </button>
            <a className="place-tour-link" href={`/${locale}/places/${selected.id}`}>
              {labels.viewDetail}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
