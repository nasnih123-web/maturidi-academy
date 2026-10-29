'use client';

/**
 * PlacesGlobe — the MapLibre places page (globe-fixes phase).
 *
 * A MapLibre GL globe (globe projection, free raster tile sources) with
 * dot markers at far zoom (emoji symbols when zoomed in), a tile-mode
 * switcher, name search, a categorized collapsible places list (click a
 * name to fly to it, per-type filter toggles), a "show all" view fit,
 * a "my location" button with a qibla arc to the Kaaba, and a full-page
 * details panel on the globe page itself (gallery, videos, description,
 * city, type, qibla button). Nothing navigates away to a separate page.
 *
 * Pure presentation: all data arrives as props from the RSC shell; the
 * only logic here is view state + the pure math in lib/places-globe.
 * The qibla arc is a GeoJSON great-circle line layer — the old
 * three-globe arcs path (which blanked the canvas when drawn) is gone.
 * Satellite tiles come from Google (Esri blocks some regions); if
 * satellite tiles fail in bulk, the globe falls back to the simple mode.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  altitudeToZoom,
  globeStyle,
  greatCircleToKaaba,
  KAABA,
  qiblaBearing,
  qiblaDistanceKm,
  type GlobeMode,
} from '@/lib/places-globe';
import { coverImage, typeEmoji, typeLabel, type PlaceTypeDef, type PlaceView, type PlacesPopupConfig } from '@/lib/places-view';
import { videoEmbedUrl } from '@/lib/video-embed';
import type { PlacesGlobeSettings } from '@/lib/settings';

export interface PlacesGlobeLabels {
  allTypes: string;
  tileFallbackNotice: string;
  locationError: string;
  toggleTypeFilter: string;
  closePanel: string;
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
  galleryPrev: string;
  galleryNext: string;
  galleryCounter: string;
  video360: string;
  videoLinkFallback: string;
  cityLabel: string;
  typeLabel: string;
  listTitle: string;
  showAll: string;
  mapLoadError: string;
}

interface Qibla {
  fromLat: number;
  fromLng: number;
  fromName: string;
}

const MODE_LABEL_KEYS: { mode: GlobeMode; key: keyof PlacesGlobeLabels }[] = [
  { mode: 'satellite', key: 'modeSatellite' },
  { mode: 'simple', key: 'modeSimple' },
  { mode: 'dark', key: 'modeDark' },
  { mode: 'topology', key: 'modeTopology' },
];

/**
 * Full-page place panel: replaces the old 340px MapLibre popup, which
 * rendered half off-screen for markers near the globe edge. The panel
 * covers the whole explorer, scrolls, and closes with an x; the qibla
 * button closes it too, so the map and the arc stay visible.
 */
function PlacesPanel({
  place,
  popupConfig,
  typeDefs,
  locale,
  labels,
  onQibla,
  onClose,
}: {
  place: PlaceView;
  popupConfig: PlacesPopupConfig;
  typeDefs: PlaceTypeDef[];
  locale: string;
  labels: PlacesGlobeLabels;
  onQibla: (place: PlaceView) => void;
  onClose: () => void;
}) {
  const images =
    place.images.length > 0
      ? place.images
      : coverImage(place)
        ? [{ url: coverImage(place) as string, caption: '' }]
        : [];
  const [idx, setIdx] = useState(0);
  const videoEmbed = place.videoUrl ? videoEmbedUrl(place.videoUrl) : null;
  return (
    <div className="places-panel" role="dialog" aria-label={place.name}>
      <div className="places-panel-head">
        <h3>{place.name}</h3>
        <button type="button" className="places-panel-close" onClick={onClose} aria-label={labels.closePanel}>
          \u00d7
        </button>
      </div>
      {popupConfig.showImage && images.length > 0 ? (
        <div className="places-panel-gallery">
          <img src={images[idx].url} alt={images[idx].caption || place.name} loading="lazy" />
          {images.length > 1 ? (
            <div className="places-panel-gallery-nav">
              <button type="button" onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)}>
                {labels.galleryPrev}
              </button>
              <span>
                {labels.galleryCounter.replace('{i}', String(idx + 1)).replace('{n}', String(images.length))}
              </span>
              <button type="button" onClick={() => setIdx((i) => (i + 1) % images.length)}>
                {labels.galleryNext}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {popupConfig.showDescription && place.description ? (
        <p className="place-desc">{place.description}</p>
      ) : null}
      <dl className="place-meta">
        {popupConfig.showType ? (
          <div>
            <dt>{labels.typeLabel}</dt>
            <dd>
              {typeEmoji(typeDefs, place.type)} {typeLabel(typeDefs, place.type, locale)}
            </dd>
          </div>
        ) : null}
        {popupConfig.showCity && place.city ? (
          <div>
            <dt>{labels.cityLabel}</dt>
            <dd>{place.city}</dd>
          </div>
        ) : null}
      </dl>
      {place.video360Id ? (
        <p>
          <a className="place-tour-link" href={`/${locale}/library/${place.video360Id}`}>
            {labels.video360}
          </a>
        </p>
      ) : null}
      {place.videoUrl ? (
        videoEmbed ? (
          <iframe
            title={place.name}
            src={videoEmbed}
            loading="lazy"
            allowFullScreen
            className="places-panel-video"
          />
        ) : (
          <p>
            <a className="place-tour-link" href={place.videoUrl} target="_blank" rel="noreferrer">
              {labels.videoLinkFallback}
            </a>
          </p>
        )
      ) : null}
      <button
        type="button"
        className="globe-tool-btn"
        onClick={() => {
          onQibla(place);
          onClose();
        }}
      >
        {labels.qiblaFromHere}
      </button>
    </div>
  );
}

export function PlacesGlobe({
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
  labels: PlacesGlobeLabels;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<GlobeMode>(globeSettings.defaultMode);
  const tileErrorCountRef = useRef(0);
  const tileFallbackRef = useRef(false);
  const pointerDownRef = useRef(false);
  const qiblaRef = useRef<Qibla | null>(null);
  const firstModeRef = useRef(true);

  const [mode, setMode] = useState<GlobeMode>(globeSettings.defaultMode);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<PlaceView | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'busy' | 'ok' | 'denied' | 'unsupported' | 'error'>('idle');
  const [qibla, setQibla] = useState<Qibla | null>(null);
  const [autoRotate, setAutoRotate] = useState(globeSettings.autoRotate);
  const [mapError, setMapError] = useState(false);
  const [tileFallback, setTileFallback] = useState(false);
  const [openCats, setOpenCats] = useState<ReadonlySet<string>>(new Set());

  const visiblePlaces = useMemo(
    () => places.filter((p) => !hiddenTypes.has(p.type)),
    [places, hiddenTypes],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) m.set(p.type, (m.get(p.type) ?? 0) + 1);
    return m;
  }, [places]);

  const groups = useMemo(
    () =>
      typeDefs
        .map((def) => ({
          def,
          items: visiblePlaces.filter((p) => p.type === def.key),
          total: counts.get(def.key) ?? 0,
        }))
        .filter((g) => g.total > 0),
    [typeDefs, visiblePlaces, counts],
  );

  const toggleCat = (key: string): void => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return places.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [places, query]);

  const addQiblaLayer = (q: Qibla): void => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      const lineData = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: greatCircleToKaaba(q.fromLat, q.fromLng) },
      };
      const arcSource = map.getSource('qibla-arc') as maplibregl.GeoJSONSource | undefined;
      if (arcSource) arcSource.setData(lineData);
      else map.addSource('qibla-arc', { type: 'geojson', data: lineData });
      // Casing first (wide, dark, translucent) so the gold line stays
      // visible on any imagery. Each layer is added only if missing, so
      // a half-added state (source without layer) repairs itself.
      if (!map.getLayer('qibla-arc-casing')) {
        map.addLayer({
          id: 'qibla-arc-casing',
          type: 'line',
          source: 'qibla-arc',
          paint: { 'line-color': '#12161d', 'line-width': 8, 'line-opacity': 0.55 },
        });
      }
      if (!map.getLayer('qibla-arc')) {
        map.addLayer({
          id: 'qibla-arc',
          type: 'line',
          source: 'qibla-arc',
          paint: { 'line-color': '#e8c766', 'line-width': 4, 'line-opacity': 0.95 },
        });
      }
      if (!map.getSource('qibla-kaaba')) {
        map.addSource('qibla-kaaba', {
          type: 'geojson',
          data: {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'Point' as const, coordinates: [KAABA.lng, KAABA.lat] },
          },
        });
      }
      if (!map.getLayer('qibla-kaaba')) {
        map.addLayer({
          id: 'qibla-kaaba',
          type: 'circle',
          source: 'qibla-kaaba',
          paint: { 'circle-color': '#e8c766', 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#12161d' },
        });
      }
    } catch (e) {
      // Never let a layer failure blank the page: the bar still shows
      // the bearing/distance, and the error stays in the console.
      console.error('qibla layer failed', e);
    }
  };

  const removeQiblaLayer = (): void => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      if (map.getLayer('qibla-arc')) map.removeLayer('qibla-arc');
      if (map.getLayer('qibla-arc-casing')) map.removeLayer('qibla-arc-casing');
      if (map.getLayer('qibla-kaaba')) map.removeLayer('qibla-kaaba');
      if (map.getSource('qibla-arc')) map.removeSource('qibla-arc');
      if (map.getSource('qibla-kaaba')) map.removeSource('qibla-kaaba');
    } catch (e) {
      console.error('qibla layer removal failed', e);
    }
  };

  const fitArc = (fromLat: number, fromLng: number): void => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (qiblaDistanceKm(fromLat, fromLng) < 50) {
        map.flyTo({ center: [fromLng, fromLat], zoom: 10, duration: 1500 });
        return;
      }
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend([fromLng, fromLat]);
      bounds.extend([KAABA.lng, KAABA.lat]);
      map.fitBounds(bounds, { padding: 80, maxZoom: 6, duration: 1500 });
    } catch (e) {
      console.error('qibla camera move failed', e);
    }
  };

  const selectPlace = (place: PlaceView): void => {
    setSelected(place);
    mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 12, duration: 1500 });
  };

  const fitAll = (): void => {
    const map = mapRef.current;
    if (!map || places.length === 0) return;
    if (places.length === 1) {
      map.flyTo({ center: [places[0].lng, places[0].lat], zoom: 10, duration: 1500 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const p of places) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 1500 });
  };

  const toggleType = (key: string): void => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const changeMode = (m: GlobeMode): void => {
    modeRef.current = m;
    if (m === 'satellite') {
      tileErrorCountRef.current = 0;
      tileFallbackRef.current = false;
      setTileFallback(false);
    }
    setMode(m);
  };

  const showQiblaFromPlace = (place: PlaceView): void => {
    setQibla({ fromLat: place.lat, fromLng: place.lng, fromName: place.name });
    fitArc(place.lat, place.lng);
  };

  const useMyLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setLocStatus('unsupported');
      return;
    }
    setLocStatus('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setMyLoc({ lat, lng });
          setLocStatus('ok');
          setQibla({ fromLat: lat, fromLng: lng, fromName: labels.myLocation });
          fitArc(lat, lng);
        } catch (e) {
          // A failure here used to blank the page; surface it as a
          // status line instead, with the error in the console.
          console.error('my location failed', e);
          setLocStatus('error');
        }
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  // Globe projection must only be applied once the style is loaded:
  // setProjection before that throws "Style is not done loading", and
  // an uncaught throw here used to kill the whole page. A failed
  // projection now shows the fallback message instead.
  const applyGlobeProjection = (m: maplibregl.Map): void => {
    try {
      m.setProjection({ type: 'globe' });
    } catch {
      setMapError(true);
    }
  };

  // Map creation — once. Pixel ratio is capped at 2 so mid-range phones
  // do not render 3x pixels; the globe projection is applied once the
  // style is ready (see applyGlobeProjection).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: globeStyle(globeSettings.defaultMode),
        center: [globeSettings.defaultLng, globeSettings.defaultLat],
        zoom: altitudeToZoom(globeSettings.defaultAltitude),
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        attributionControl: { compact: true },
        maxZoom: 18,
      });
    } catch {
      setMapError(true);
      return;
    }
    const onStyleLoad = (): void => {
      applyGlobeProjection(map);
      if (qiblaRef.current) addQiblaLayer(qiblaRef.current);
    };
    if (map.isStyleLoaded()) onStyleLoad();
    else map.on('style.load', onStyleLoad);
    map.on('error', () => {
      // Satellite tiles failing in bulk (e.g. a region block) must not
      // leave a blank map: fall back to the simple mode once, with a
      // notice. Other modes keep their errors visible in the console.
      if (modeRef.current !== 'satellite' || tileFallbackRef.current) return;
      tileErrorCountRef.current += 1;
      if (tileErrorCountRef.current >= 8) {
        tileFallbackRef.current = true;
        setTileFallback(true);
        setMode('simple');
        modeRef.current = 'simple';
      }
    });
    const updateFar = (): void => {
      const frame = frameRef.current;
      if (frame) frame.classList.toggle('globe-far', map.getZoom() < 5);
    };
    map.on('zoom', updateFar);
    updateFar();
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;
    const onDown = (): void => {
      pointerDownRef.current = true;
    };
    const onUp = (): void => {
      pointerDownRef.current = false;
    };
    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      container.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode switch: setStyle drops custom sources/layers, so the globe
  // projection and the qibla arc are re-applied once the new style loads.
  useEffect(() => {
    if (firstModeRef.current) {
      firstModeRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    // The persistent style.load handler from the creation effect
    // re-applies the globe projection and the qibla arc.
    map.setStyle(globeStyle(mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Markers: one DOM marker per visible place + the own-location marker.
  // Markers are DOM overlays, so they survive style (mode) switches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const keep = new Set(visiblePlaces.map((p) => p.id));
    markersRef.current.forEach((m, id) => {
      if (!keep.has(id)) {
        m.remove();
        markersRef.current.delete(id);
      }
    });
    for (const place of visiblePlaces) {
      if (markersRef.current.has(place.id)) continue;
      const el = document.createElement('div');
      el.className = 'globe-marker';
      el.textContent = typeEmoji(typeDefs, place.type);
      el.title = place.name;
      el.addEventListener('click', () => selectPlace(place));
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([place.lng, place.lat])
        .addTo(map);
      markersRef.current.set(place.id, marker);
    }
    if (myLoc) {
      if (!meMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'globe-marker globe-marker-me';
        el.textContent = '📍';
        el.title = labels.myLocation;
        meMarkerRef.current = new maplibregl.Marker({ element: el }).addTo(map);
      }
      meMarkerRef.current.setLngLat([myLoc.lng, myLoc.lat]);
    } else if (meMarkerRef.current) {
      meMarkerRef.current.remove();
      meMarkerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePlaces, myLoc]);

  // Qibla arc layer lifecycle. A style swap clears custom layers, so the
  // add path also runs from the mode effect's style.load listener.
  useEffect(() => {
    qiblaRef.current = qibla;
    const map = mapRef.current;
    if (!map) return;
    if (!qibla) {
      removeQiblaLayer();
      return;
    }
    // If the style is still loading, the persistent style.load handler
    // adds the arc once it arrives (qiblaRef is already set above).
    if (map.isStyleLoaded()) addQiblaLayer(qibla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qibla]);

  // Auto-rotate: slowly advance center longitude. Paused while the user
  // holds the map or while a popup is open, so the popup never drifts away.
  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    const step = (): void => {
      const map = mapRef.current;
      if (map && !pointerDownRef.current && !selected) {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + 0.02, c.lat] });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, selected]);

  return (
    <div className="globe-explorer">
      <div className="globe-toolbar">
        <div className="globe-modes" role="group">
          {MODE_LABEL_KEYS.map(({ mode: m, key }) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'globe-mode-btn active' : 'globe-mode-btn'}
              onClick={() => changeMode(m)}
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
      {locStatus === 'error' ? <p className="hint" role="status">{labels.locationError}</p> : null}
      {tileFallback ? <p className="hint" role="status">{labels.tileFallbackNotice}</p> : null}
      {qibla ? (
        <p className="hint globe-qibla-info" role="status">
          {labels.qiblaInfo
            .replace('{deg}', String(Math.round(qiblaBearing(qibla.fromLat, qibla.fromLng))))
            .replace('{km}', String(qiblaDistanceKm(qibla.fromLat, qibla.fromLng)))}
          {' — '}
          {qibla.fromName}
        </p>
      ) : null}

      <div className="globe-layout">
        <div className="globe-frame" ref={frameRef}>
          {mapError ? <p className="hint" role="alert">{labels.mapLoadError}</p> : null}
          <div ref={containerRef} className="places-globe-map" />
        </div>

        <div className="globe-places-list">
          <div className="globe-places-list-head">
            <h2>{labels.listTitle}</h2>
            <button type="button" className="globe-tool-btn" onClick={fitAll}>
              {labels.showAll}
            </button>
          </div>
          <button type="button" className="globe-places-item" onClick={() => setHiddenTypes(new Set())}>
            <span aria-hidden>🌍</span> {labels.allTypes} ({places.length})
          </button>
          {groups.map(({ def, items, total }) => {
            const hidden = hiddenTypes.has(def.key);
            const open = openCats.has(def.key);
            const name = locale === 'ar' ? def.ar : locale === 'en' ? def.en : def.fa;
            return (
              <div key={def.key} className={hidden ? 'globe-places-cat hidden-cat' : 'globe-places-cat'}>
                <div className="globe-places-cat-head">
                  <button
                    type="button"
                    className="globe-places-cat-name"
                    aria-expanded={open}
                    onClick={() => toggleCat(def.key)}
                  >
                    <span aria-hidden>{open ? '▾' : '▸'}</span> {def.emoji} {name} ({total})
                  </button>
                  <button
                    type="button"
                    className="globe-places-cat-filter"
                    aria-label={labels.toggleTypeFilter}
                    aria-pressed={!hidden}
                    onClick={() => toggleType(def.key)}
                  >
                    {hidden ? '🚫' : '👁'}
                  </button>
                </div>
                {open && !hidden
                  ? items.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="globe-places-item"
                        onClick={() => selectPlace(p)}
                      >
                        <span aria-hidden>{typeEmoji(typeDefs, p.type)}</span> {p.name}
                        {p.city ? <span className="globe-places-city"> — {p.city}</span> : null}
                      </button>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      </div>
      {selected ? (
        <PlacesPanel
          key={selected.id}
          place={selected}
          popupConfig={popupConfig}
          typeDefs={typeDefs}
          locale={locale}
          labels={labels}
          onQibla={(place) => {
            showQiblaFromPlace(place);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
