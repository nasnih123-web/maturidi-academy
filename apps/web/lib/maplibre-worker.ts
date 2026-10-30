/**
 * Shared MapLibre worker setup — import this module (side effect) from
 * every component that builds a MapLibre map, BEFORE any map exists.
 *
 * MapLibre's GeoJSON rendering runs in a module worker whose file the
 * library locates dynamically (./maplibre-gl-worker.mjs relative to its
 * own module URL). No bundler can trace that dynamic URL, so Next never
 * emits the file and the runtime URL 404s to an HTML page — the exact
 * "module script with non-JavaScript MIME type text/html" + "Worker
 * failed to load" errors seen on /places before PR #75. A dead worker
 * silently kills every GeoJSON feature while raster tiles, DOM markers
 * and pure-math UI keep working. Point the worker at a bundler-emitted
 * asset instead, before any map exists. If the bundler cannot resolve
 * it, this falls back to the library default.
 *
 * Side-effect imports run before the importing module's body, so the
 * worker URL is set before any map constructor runs. Do NOT build a
 * second map component that imports maplibre-gl without importing this
 * module first — that reintroduces the PR #75 failure on the new map.
 */
import * as maplibregl from 'maplibre-gl';

if (typeof window !== 'undefined') {
  try {
    maplibregl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
  } catch {
    // Keep the library default; the failure stays visible in the console.
  }
}

export {};
