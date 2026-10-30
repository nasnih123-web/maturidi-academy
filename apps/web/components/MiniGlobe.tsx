'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Shared worker setup (side effect): must run before any map exists.
// Every map component must import this — see lib/maplibre-worker.ts.
import '@/lib/maplibre-worker';
import { globeStyle, KAABA } from '@/lib/places-globe';
import type { PlaceView } from '@/lib/places-view';

/**
 * MiniGlobe — the homepage اماکن slot's small live globe.
 *
 * Deliberately minimal next to the full /places explorer: a rotating
 * globe with gold dot markers for the published places, nothing else.
 * No mode switcher, no list, no panel, no search, no qibla arc — the
 * link beside it leads to the full experience on /places.
 *
 * Resilience notes:
 * - Place dots are DOM markers, not a GeoJSON source, so they render
 *   even if a tile or worker problem ever recurs; the worker setup is
 *   still imported so a future GeoJSON layer would not silently die
 *   the way the qibla arc did before PR #75.
 * - Scroll zoom is disabled so the page scroll wins over the globe;
 *   drag rotates, pinch zooms on touch.
 * - Auto-rotate pauses while the pointer is down (same pattern as the
 *   full globe) and resumes after.
 * - Any map creation failure leaves the 🌍 placeholder instead of
 *   breaking the homepage; the link beside the globe always works.
 */
export function MiniGlobe({ places }: { places: PlaceView[] }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: maplibregl.Map | null = null;
    let raf = 0;
    let pointerDown = false;
    try {
      map = new maplibregl.Map({
        container,
        style: globeStyle('satellite'),
        center: [KAABA.lng, KAABA.lat],
        zoom: 2,
      });
      // Same safe pattern as the full globe: setProjection only once
      // the style is parsed, never synchronously after construction.
      const applyGlobeProjection = (): void => {
        try {
          map?.setProjection({ type: 'globe' });
        } catch (e) {
          console.error('mini globe projection failed', e);
        }
      };
      if (map.isStyleLoaded()) applyGlobeProjection();
      else map.once('style.load', applyGlobeProjection);
      map.scrollZoom.disable();
      // Position BEFORE addTo: addTo() positions immediately, and an
      // unpositioned marker throws (the PR #71 lesson).
      for (const p of places) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const el = document.createElement('div');
        el.className = 'mini-globe-dot';
        el.title = p.name;
        new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      }
      const onDown = (): void => {
        pointerDown = true;
      };
      const onUp = (): void => {
        pointerDown = false;
      };
      container.addEventListener('pointerdown', onDown);
      container.addEventListener('pointerup', onUp);
      const step = (): void => {
        if (map && !pointerDown) {
          const c = map.getCenter();
          map.jumpTo({ center: [c.lng + 0.02, c.lat] });
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => {
        cancelAnimationFrame(raf);
        container.removeEventListener('pointerdown', onDown);
        container.removeEventListener('pointerup', onUp);
        map?.remove();
        map = null;
      };
    } catch (e) {
      console.error('mini globe failed', e);
      setFailed(true);
      map?.remove();
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  return (
    <div ref={frameRef} className="mini-globe-frame">
      {failed ? (
        <span className="mini-globe-placeholder" aria-hidden>
          🌍
        </span>
      ) : (
        <div ref={containerRef} className="mini-globe-map" />
      )}
    </div>
  );
}
