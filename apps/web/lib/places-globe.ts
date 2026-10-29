/**
 * MapLibre-globe helpers — pure functions (no DOM, no business rules in
 * components, ADR-001/ADR-0002).
 *
 * Qibla math is plain great-circle geography: the initial bearing from a
 * point to the Kaaba, the haversine distance, and the great-circle polyline
 * drawn as a GeoJSON line layer. The four view modes are free raster tile
 * sources (no API key); tiles load per zoom, so zooming reveals real
 * streets and labels instead of enlarged static pixels.
 */

import type { StyleSpecification } from 'maplibre-gl';

export const KAABA = { lat: 21.4225, lng: 39.8262 } as const;

export type GlobeMode = 'satellite' | 'simple' | 'dark' | 'topology';

export const GLOBE_MODES: GlobeMode[] = ['satellite', 'simple', 'dark', 'topology'];

export function isGlobeMode(v: unknown): v is GlobeMode {
  return typeof v === 'string' && (GLOBE_MODES as string[]).includes(v);
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Initial great-circle bearing from (lat,lng) to the Kaaba, in degrees 0-360. */
export function qiblaBearing(lat: number, lng: number): number {
  const φ1 = toRad(lat);
  const φ2 = toRad(KAABA.lat);
  const Δλ = toRad(KAABA.lng - lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Haversine distance in kilometres. */
export function haversineKm(lat: number, lng: number, toLat: number, toLng: number): number {
  const R = 6371;
  const dφ = toRad(toLat - lat);
  const dλ = toRad(toLng - lng);
  const a =
    Math.sin(dφ / 2) * Math.sin(dφ / 2) +
    Math.cos(toRad(lat)) * Math.cos(toRad(toLat)) * Math.sin(dλ / 2) * Math.sin(dλ / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Distance from a point to the Kaaba, in kilometres (rounded). */
export function qiblaDistanceKm(lat: number, lng: number): number {
  return Math.round(haversineKm(lat, lng, KAABA.lat, KAABA.lng));
}

type Vec3 = [number, number, number];

function toVec(lat: number, lng: number): Vec3 {
  const φ = toRad(lat);
  const λ = toRad(lng);
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

/**
 * Great-circle polyline from (lat,lng) to the Kaaba as [lng, lat] pairs
 * for a GeoJSON LineString. Spherical interpolation (slerp); a straight
 * two-point line would cut through the globe on a sphere projection.
 */
export function greatCircleToKaaba(lat: number, lng: number, segments = 64): Array<[number, number]> {
  const p0 = toVec(lat, lng);
  const p1 = toVec(KAABA.lat, KAABA.lng);
  const dot = Math.min(1, Math.max(-1, p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [[lng, lat], [KAABA.lng, KAABA.lat]];
  const sinOmega = Math.sin(omega);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    const x = a * p0[0] + b * p1[0];
    const y = a * p0[1] + b * p1[1];
    const z = Math.min(1, Math.max(-1, a * p0[2] + b * p1[2]));
    pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.asin(z))]);
  }
  return pts;
}

/**
 * Map the old react-globe.gl camera altitude to an equivalent MapLibre
 * zoom: altitude 2.5 (the CRM default) becomes zoom 1.5 (whole globe),
 * smaller altitudes zoom in. Clamped to MapLibre's zoom range.
 */
export function altitudeToZoom(altitude: number): number {
  const z = 1.5 + Math.log2(2.5 / altitude);
  return Math.min(18, Math.max(0, z));
}

export interface TileSourceDef {
  tiles: string[];
  attribution: string;
  /** Max native zoom; above it MapLibre overzooms (scales) instead of 404ing. */
  maxzoom?: number;
}

/**
 * Free raster tile sources, one per mode — no API key. Esri's endpoint
 * takes /tile/{z}/{y}/{x} (row before column), so the placeholders are
 * written in that order; MapLibre substitutes each token by name.
 */
export const GLOBE_TILE_SOURCES: Record<GlobeMode, TileSourceDef> = {
  satellite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  simple: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
  },
  dark: {
    tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors © CARTO',
  },
  topology: {
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: 'Map data: © OpenStreetMap contributors, SRTM | map style: © OpenTopoMap (CC-BY-SA)',
    maxzoom: 17,
  },
};

/** Full raster style for one mode: dark background under one tile layer. */
export function globeStyle(mode: GlobeMode): StyleSpecification {
  const src = GLOBE_TILE_SOURCES[mode];
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: src.tiles,
        tileSize: 256,
        attribution: src.attribution,
        ...(src.maxzoom !== undefined ? { maxzoom: src.maxzoom } : {}),
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b0e13' } },
      { id: 'basemap', type: 'raster', source: 'basemap' },
    ],
  };
}
