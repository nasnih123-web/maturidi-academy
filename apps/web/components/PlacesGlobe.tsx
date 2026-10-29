'use client';

/**
 * PlacesGlobe — the MapLibre places page (globe-fixes phase).
 *
 * A MapLibre GL globe (globe projection, free raster tile sources) with
 * emoji markers for published places, a corner legend (symbol + label per
 * type, click to toggle that type), a tile-mode switcher, name search, a
 * visible places list (click a name to fly to it), a "show all" view fit,
 * a "my location" button with a qibla arc to the Kaaba, and a full-details
 * popup on the globe page itself (gallery, videos, description, city,
 * type, qibla button). Nothing navigates away to a separate detail page.
 *
 * Pure presentation: all data arrives as props from the RSC shell; the
 * only logic here is view state + the pure math in lib/places-globe.
 * The qibla arc is a GeoJSON great-circle line layer — the old
 * three-globe arcs path (which blanked the canvas when drawn) is gone.
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
  galleryPrev: string;
  galleryNext: string;
  galleryCounter: string;
  video360: string;
  videoLinkFallback: string;
  cityLabel: string;
  typeLabel: string;
  listTitle: string;
  showAll: string;
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
 * Build the popup's DOM imperatively (no React root inside the MapLibre
 * popup): user strings go through textContent only, never innerHTML, and
 * image/video URLs are already allowlisted upstream (safeImageUrl /
 * videoEmbedUrl). Gallery prev/next rewrite the <img> src in place.
 */
function buildPopupDom(
  place: PlaceView,
  popupConfig: PlacesPopupConfig,
  typeDefs: PlaceTypeDef[],
  locale: string,
  labels: PlacesGlobeLabels,
  onQibla: (place: PlaceView) => void,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'places-popup';
  const title = document.createElement('h3');
  title.textContent = place.name;
  root.appendChild(title);

  const images =
    place.images.length > 0
      ? place.images
      : coverImage(place)
        ? [{ url: coverImage(place) as string, caption: '' }]
        : [];
  if (popupConfig.showImage && images.length > 0) {
    const gallery = document.createElement('div');
    gallery.className = 'places-popup-gallery';
    const img = document.createElement('img');
    img.src = images[0].url;
    img.alt = images[0].caption || place.name;
    img.loading = 'lazy';
    gallery.appendChild(img);
    if (images.length > 1) {
      let idx = 0;
      const nav = document.createElement('div');
      nav.className = 'places-popup-gallery-nav';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.textContent = labels.galleryPrev;
      const counter = document.createElement('span');
      const render = (): void => {
        img.src = images[idx].url;
        img.alt = images[idx].caption || place.name;
        counter.textContent = labels.galleryCounter
          .replace('{i}', String(idx + 1))
          .replace('{n}', String(images.length));
      };
      prev.addEventListener('click', () => {
        idx = (idx - 1 + images.length) % images.length;
        render();
      });
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = labels.galleryNext;
      next.addEventListener('click', () => {
        idx = (idx + 1) % images.length;
        render();
      });
      render();
      nav.append(prev, counter, next);
      gallery.appendChild(nav);
    }
    root.appendChild(gallery);
  }

  if (popupConfig.showDescription && place.description) {
    const desc = document.createElement('p');
    desc.className = 'place-desc';
    desc.textContent = place.description;
    root.appendChild(desc);
  }

  const meta = document.createElement('dl');
  meta.className = 'place-meta';
  if (popupConfig.showType) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = labels.typeLabel;
    const dd = document.createElement('dd');
    dd.textContent = `${typeEmoji(typeDefs, place.type)} ${typeLabel(typeDefs, place.type, locale)}`;
    row.append(dt, dd);
    meta.appendChild(row);
  }
  if (popupConfig.showCity && place.city) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = labels.cityLabel;
    const dd = document.createElement('dd');
    dd.textContent = place.city;
    row.append(dt, dd);
    meta.appendChild(row);
  }
  if (meta.childElementCount > 0) root.appendChild(meta);

  if (place.video360Id) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.className = 'place-tour-link';
    a.href = `/${locale}/library/${place.video360Id}`;
    a.textContent = labels.video360;
    p.appendChild(a);
    root.appendChild(p);
  }
  if (place.videoUrl) {
    const embed = videoEmbedUrl(place.videoUrl);
    if (embed) {
      const frame = document.createElement('iframe');
      frame.title = place.name;
      frame.src = embed;
      frame.loading = 'lazy';
      frame.allowFullscreen = true;
      frame.style.width = '100%';
      frame.style.height = '220px';
      frame.style.border = '0';
      frame.style.borderRadius = '0.6rem';
      root.appendChild(frame);
    } else {
      const p = document.createElement('p');
      const a = document.createElement('a');
      a.className = 'place-tour-link';
      a.href = place.videoUrl;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = labels.videoLinkFallback;
      p.appendChild(a);
      root.appendChild(p);
    }
  }

  const qiblaBtn = document.createElement('button');
  qiblaBtn.type = 'button';
  qiblaBtn.className = 'globe-tool-btn';
  qiblaBtn.textContent = labels.qiblaFromHere;
  qiblaBtn.addEventListener('click', () => onQibla(place));
  root.appendChild(qiblaBtn);
  return root;
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
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const suppressPopupCloseRef = useRef(false);
  const popupOpenRef = useRef(false);
  const pointerDownRef = useRef(false);
  const qiblaRef = useRef<Qibla | null>(null);
  const firstModeRef = useRef(true);

  const [mode, setMode] = useState<GlobeMode>(globeSettings.defaultMode);
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<PlaceView | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'busy' | 'ok' | 'denied' | 'unsupported'>('idle');
  const [qibla, setQibla] = useState<Qibla | null>(null);
  const [autoRotate, setAutoRotate] = useState(globeSettings.autoRotate);

  const visiblePlaces = useMemo(
    () => places.filter((p) => !hiddenTypes.has(p.type)),
    [places, hiddenTypes],
  );

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

  const addQiblaLayer = (q: Qibla): void => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const lineData = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: greatCircleToKaaba(q.fromLat, q.fromLng) },
    };
    const existing = map.getSource('qibla-arc') as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(lineData);
      return;
    }
    map.addSource('qibla-arc', { type: 'geojson', data: lineData });
    map.addLayer({
      id: 'qibla-arc',
      type: 'line',
      source: 'qibla-arc',
      paint: { 'line-color': '#e8c766', 'line-width': 3, 'line-opacity': 0.95 },
    });
    map.addSource('qibla-kaaba', {
      type: 'geojson',
      data: {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [KAABA.lng, KAABA.lat] },
      },
    });
    map.addLayer({
      id: 'qibla-kaaba',
      type: 'circle',
      source: 'qibla-kaaba',
      paint: { 'circle-color': '#e8c766', 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#12161d' },
    });
  };

  const removeQiblaLayer = (): void => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer('qibla-arc')) map.removeLayer('qibla-arc');
    if (map.getLayer('qibla-kaaba')) map.removeLayer('qibla-kaaba');
    if (map.getSource('qibla-arc')) map.removeSource('qibla-arc');
    if (map.getSource('qibla-kaaba')) map.removeSource('qibla-kaaba');
  };

  const fitArc = (fromLat: number, fromLng: number): void => {
    const map = mapRef.current;
    if (!map) return;
    if (qiblaDistanceKm(fromLat, fromLng) < 50) {
      map.flyTo({ center: [fromLng, fromLat], zoom: 10, duration: 1500 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([fromLng, fromLat]);
    bounds.extend([KAABA.lng, KAABA.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 6, duration: 1500 });
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
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setMyLoc({ lat, lng });
        setLocStatus('ok');
        setQibla({ fromLat: lat, fromLng: lng, fromName: labels.myLocation });
        fitArc(lat, lng);
      },
      () => setLocStatus('denied'),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  // Map creation — once. Pixel ratio is capped at 2 so mid-range phones
  // do not render 3x pixels; the globe projection is set explicitly.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const map = new maplibregl.Map({
      container,
      style: globeStyle(globeSettings.defaultMode),
      center: [globeSettings.defaultLng, globeSettings.defaultLat],
      zoom: altitudeToZoom(globeSettings.defaultAltitude),
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      attributionControl: { compact: true },
      maxZoom: 18,
    });
    map.setProjection({ type: 'globe' });
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

  // Mode switch: setStyle drops custom sources/layers, so the qibla arc
  // is re-added once the new style loads.
  useEffect(() => {
    if (firstModeRef.current) {
      firstModeRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(globeStyle(mode));
    if (qiblaRef.current) {
      map.once('style.load', () => {
        if (qiblaRef.current) addQiblaLayer(qiblaRef.current);
      });
    }
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
    if (map.isStyleLoaded()) addQiblaLayer(qibla);
    else map.once('style.load', () => addQiblaLayer(qibla));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qibla]);

  // Popup lifecycle. Programmatic removal (selection change / unmount)
  // suppresses the close handler so it cannot clear the new selection;
  // only the user's own × click clears it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) {
      popupOpenRef.current = false;
      return;
    }
    const place = selected;
    const popup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '340px',
      offset: 18,
      className: 'places-globe-popup',
    });
    popup.setLngLat([place.lng, place.lat]);
    popup.setDOMContent(
      buildPopupDom(place, popupConfig, typeDefs, locale, labels, showQiblaFromPlace),
    );
    popup.on('close', () => {
      if (suppressPopupCloseRef.current) {
        suppressPopupCloseRef.current = false;
        return;
      }
      popupRef.current = null;
      popupOpenRef.current = false;
      setSelected(null);
    });
    popup.addTo(map);
    popupRef.current = popup;
    popupOpenRef.current = true;
    return () => {
      if (popupRef.current === popup) {
        suppressPopupCloseRef.current = true;
        popup.remove();
        popupRef.current = null;
      }
      popupOpenRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Auto-rotate: slowly advance center longitude. Paused while the user
  // holds the map or while a popup is open, so the popup never drifts away.
  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    const step = (): void => {
      const map = mapRef.current;
      if (map && !pointerDownRef.current && !popupOpenRef.current) {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + 0.02, c.lat] });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

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

      <div className="globe-layout">
        <div className="globe-frame">
          <div ref={containerRef} className="places-globe-map" />
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

        <div className="globe-places-list">
          <div className="globe-places-list-head">
            <h2>{labels.listTitle}</h2>
            <button type="button" className="globe-tool-btn" onClick={fitAll}>
              {labels.showAll}
            </button>
          </div>
          {visiblePlaces.map((p) => (
            <button
              key={p.id}
              type="button"
              className="globe-places-item"
              onClick={() => selectPlace(p)}
            >
              <span aria-hidden>{typeEmoji(typeDefs, p.type)}</span> {p.name}
              {p.city ? <span className="globe-places-city"> — {p.city}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
