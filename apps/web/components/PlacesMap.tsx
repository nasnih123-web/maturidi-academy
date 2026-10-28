'use client';

/**
 * PlacesMap — Phase-11 live map of religious places (Leaflet + OSM).
 *
 * Client component, code-split with `ssr: false` from the places page so
 * Leaflet never touches the homepage bundle. Pure presentation (ADR-001):
 * receives ready-made PlaceView models + labels, keeps only the selected
 * filter key as UI state; filtering itself is the pure `filterPlacesByType`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import {
  DEFAULT_POPUP_CONFIG,
  filterPlacesByType,
  presentTypes,
  type PlacesPopupConfig,
  type PlaceView,
} from '@/lib/places-view';

export interface PlacesMapLabels {
  mapAria: string;
  filterLabel: string;
  all: string;
  openDetail: string;
  loading: string;
  loadFailed: string;
  retry: string;
  /** Raw template with {n}, substituted here (next-intl FORMATTING_ERROR guard). */
  resultsCount: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function PlacesMap({
  locale,
  places,
  typeLabels,
  labels,
  popupConfig = DEFAULT_POPUP_CONFIG,
}: {
  locale: string;
  places: PlaceView[];
  typeLabels: Record<string, string>;
  labels: PlacesMapLabels;
  /**
   * CRM-controlled popup shape (`places.popup` setting). Defaults to every
   * field shown; the places page passes the live site config.
   */
  popupConfig?: PlacesPopupConfig;
}) {
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const [filter, setFilter] = useState('all');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const mapHost = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<import('leaflet').LayerGroup | null>(null);

  const filtered = useMemo(() => filterPlacesByType(places, filter), [places, filter]);
  const types = useMemo(() => presentTypes(places), [places]);

  // One-time Leaflet init (client only — Leaflet needs `window`).
  useEffect(() => {
    let cancelled = false;
    let map: import('leaflet').Map | null = null;
    setReady(false);
    setFailed(false);
    (async () => {
      try {
        const L = await import('leaflet');
        if (cancelled || !mapHost.current) return;
        leafletRef.current = L;
        map = L.map(mapHost.current, { scrollWheelZoom: true }).setView([32, 54], 5);
        map.zoomControl.setPosition(dir === 'rtl' ? 'topright' : 'topleft');
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        mapRef.current = map;
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markersRef.current = null;
      leafletRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, dir]);

  // Markers for the current filter.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !ready) return;
    markersRef.current?.remove();
    const layer = L.layerGroup().addTo(map);
    markersRef.current = layer;
    for (const p of filtered) {
      const icon = L.divIcon({
        className: 'place-pin',
        html: '<span class="place-dot" aria-hidden="true"></span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
      });
      const typeLabel = typeLabels[p.type] ?? p.type;
      // Popup content is built from already-sanitized pieces: text is
      // escaped, and the image URL passed safeImageUrl (http(s) only) in
      // the view layer — a hostile URL can never become an attribute here.
      const img =
        popupConfig.showImage && p.imageUrl
          ? `<img class="pp-img" src="${esc(p.imageUrl)}" alt="" loading="lazy" />`
          : '';
      const meta =
        popupConfig.showType || (popupConfig.showCity && p.city)
          ? `<span class="pp-type">${[
              popupConfig.showType ? esc(typeLabel) : '',
              popupConfig.showCity && p.city ? esc(p.city) : '',
            ]
              .filter(Boolean)
              .join(' · ')}</span>`
          : '';
      const desc =
        popupConfig.showDescription && p.description
          ? `<p class="pp-desc">${esc(p.description)}</p>`
          : '';
      const html =
        `<div class="place-popup">${img}<strong>${esc(p.name)}</strong>` +
        meta +
        desc +
        `<a class="pp-link" href="/${esc(locale)}/places/${esc(p.id)}">${esc(labels.openDetail)}</a></div>`;
      L.marker([p.lat, p.lng], { icon, title: p.name, keyboard: true })
        .bindPopup(html)
        .addTo(layer);
    }
    if (filtered.length > 1) {
      map.fitBounds(
        L.latLngBounds(filtered.map((p) => [p.lat, p.lng] as [number, number])).pad(0.18),
      );
    } else if (filtered.length === 1) {
      map.setView([filtered[0].lat, filtered[0].lng], 13);
    }
  }, [filtered, ready, locale, typeLabels, labels.openDetail, popupConfig]);

  const countText = labels.resultsCount.replace('{n}', String(filtered.length));

  return (
    <div className="places-map-block">
      {types.length > 1 ? (
        <div className="places-filter" role="group" aria-label={labels.filterLabel}>
          <button
            type="button"
            className="places-chip"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            {labels.all}
          </button>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              className="places-chip"
              aria-pressed={filter === t}
              onClick={() => setFilter(t)}
            >
              {typeLabels[t] ?? t}
            </button>
          ))}
        </div>
      ) : null}

      <div className="places-map-shell">
        <div ref={mapHost} className="places-map" role="application" aria-label={labels.mapAria} />
        {!ready && !failed ? (
          <div className="places-map-overlay" role="status">
            <span className="places-spinner" aria-hidden="true" />
            <span>{labels.loading}</span>
          </div>
        ) : null}
        {failed ? (
          <div className="places-map-overlay" role="alert">
            <p>{labels.loadFailed}</p>
            <button type="button" className="places-retry" onClick={() => setAttempt((a) => a + 1)}>
              {labels.retry}
            </button>
          </div>
        ) : null}
      </div>

      <p className="places-count" role="status">
        {countText}
      </p>
    </div>
  );
}
