/**
 * 3D-globe helpers — pure functions (no DOM, no business rules in
 * components, ADR-001/ADR-0002).
 *
 * Qibla math is plain great-circle geography: the initial bearing from a
 * point to the Kaaba and the haversine distance. No new dependency.
 */

export const KAABA = { lat: 21.4225, lng: 39.8262 } as const;

export type GlobeMode = 'satellite' | 'simple' | 'dark' | 'topology';

export const GLOBE_MODES: GlobeMode[] = ['satellite', 'simple', 'dark', 'topology'];

/**
 * Earth textures from the three-globe example CDN (runtime assets — no
 * binaries enter the repo). All four URLs were verified to return 200 at
 * build time; note the topology texture is a PNG (the .jpg 404s).
 */
export const GLOBE_TEXTURES: Record<GlobeMode, string> = {
  satellite: 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
  simple: 'https://unpkg.com/three-globe/example/img/earth-day.jpg',
  dark: 'https://unpkg.com/three-globe/example/img/earth-night.jpg',
  topology: 'https://unpkg.com/three-globe/example/img/earth-topology.png',
};

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
