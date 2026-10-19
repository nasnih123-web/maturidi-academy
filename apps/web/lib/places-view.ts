import type { LocalizedText } from './types';
import { pickText } from './localize';

/**
 * Religious places — pure view layer (Phase 11).
 *
 * Types, the LocalizedText → plain-string view mapping and the type filter
 * predicate live here so both RSC pages and the client map share them
 * without business logic leaking into components (ADR-001).
 *
 * API contract (Track 1 backend — ADR-0008):
 *   GET /api/v1/places?type=&limit=&min_lat=&max_lat=&min_lng=&max_lng=
 *       -> { items: ReligiousPlace[], total: number }  (published only)
 *   GET /api/v1/places/{id} -> ReligiousPlace  (id is a UUID string)
 * Only places with workflow_status "published" are returned for anonymous
 * callers.
 */

/** Place-type enum — mirrors the backend PLACE_TYPES exactly (ADR-0008). */
export const PLACE_TYPES = ['mosque', 'shrine', 'holy_site', 'museum', 'other'] as const;
export type KnownPlaceType = (typeof PLACE_TYPES)[number];

export interface ReligiousPlace {
  id: string;
  name: LocalizedText;
  /** Place-type key, e.g. "mosque" | "shrine" | "holy_site" | "museum" | "other". */
  type: string;
  lat: number;
  lng: number;
  description: LocalizedText | null;
  /** Phase-9 library item id for the 360° virtual tour, when available. */
  video_360_id: string | null;
  workflow_status: string;
}

export interface PlacesListResponse {
  items: ReligiousPlace[];
  total: number;
}

/**
 * Plain-string view model handed to components. Components never see
 * LocalizedText — locale resolution is a pure service-layer function.
 */
export interface PlaceView {
  id: string;
  name: string;
  description: string;
  type: string;
  lat: number;
  lng: number;
  video360Id: string | null;
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Defensive normalization — never throws on unexpected payloads. */
export function normalizePlace(raw: unknown): ReligiousPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = toNumber(r.lat);
  const lng = toNumber(r.lng);
  const id = asText(r.id);
  if (!id || lat === null || lng === null) return null;
  const name = r.name as LocalizedText | undefined;
  return {
    id,
    name: name && typeof name === 'object' ? name : { fa: id },
    type: asText(r.type) || 'other',
    lat,
    lng,
    description: (r.description as LocalizedText | null) ?? null,
    video_360_id: typeof r.video_360_id === 'string' && r.video_360_id ? r.video_360_id : null,
    workflow_status: asText(r.workflow_status) || 'published',
  };
}

export function normalizePlacesList(body: unknown): PlacesListResponse {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(b.items) ? b.items : [];
  const items: ReligiousPlace[] = [];
  for (const raw of rawItems) {
    const p = normalizePlace(raw);
    if (p) items.push(p);
  }
  const total = typeof b.total === 'number' ? b.total : items.length;
  return { items, total };
}

/** Pure mapping: domain place -> render-ready view for a locale. */
export function toPlaceView(place: ReligiousPlace, locale: string): PlaceView {
  return {
    id: place.id,
    name: pickText(place.name, locale) || place.id,
    description: pickText(place.description, locale),
    type: place.type,
    lat: place.lat,
    lng: place.lng,
    video360Id: place.video_360_id,
  };
}

/**
 * Pure type filter for the client map. "all" (or unknown) returns everything;
 * components only pass the selected key through.
 */
export function filterPlacesByType(places: PlaceView[], type: string): PlaceView[] {
  if (!type || type === 'all') return places;
  return places.filter((p) => p.type === type);
}

/** Distinct types present in a list, in PLACE_TYPES order, then unknowns. */
export function presentTypes(places: PlaceView[]): string[] {
  const seen = new Set(places.map((p) => p.type));
  const ordered: string[] = PLACE_TYPES.filter((t) => seen.has(t));
  for (const t of seen) if (!(PLACE_TYPES as readonly string[]).includes(t)) ordered.push(t);
  return ordered;
}
