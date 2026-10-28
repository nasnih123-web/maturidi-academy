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

/**
 * CRM-extensible place types (globe phase). The live list comes from the
 * `places.types` platform setting; these defaults are the fallback when
 * the setting is absent, and the shape mirrors the backend registry.
 */
export interface PlaceTypeDef {
  key: string;
  emoji: string;
  fa: string;
  ar: string;
  en: string;
}

export const DEFAULT_PLACE_TYPES: PlaceTypeDef[] = [
  { key: 'mosque', emoji: '🕌', fa: 'مسجد', ar: 'مسجد', en: 'Mosque' },
  { key: 'haramain', emoji: '🕋', fa: 'حرمین شریفین', ar: 'الحرمان الشريفان', en: 'The Two Holy Mosques' },
  { key: 'library', emoji: '📚', fa: 'کتابخانه', ar: 'مكتبة', en: 'Library' },
  { key: 'museum', emoji: '🏛️', fa: 'موزه', ar: 'متحف', en: 'Museum' },
  { key: 'pilgrimage', emoji: '🌙', fa: 'مکان زیارتی', ar: 'مكان زيارة', en: 'Pilgrimage site' },
  { key: 'other', emoji: '📍', fa: 'سایر', ar: 'أخرى', en: 'Other' },
];

export const FALLBACK_TYPE_EMOJI = '📍';

/** Defensive parse of a stored `places.types` value; never throws. */
export function parsePlaceTypes(v: unknown): PlaceTypeDef[] {
  if (!Array.isArray(v) || v.length === 0) return [...DEFAULT_PLACE_TYPES];
  const out: PlaceTypeDef[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    if (!key || key.length > 32 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      emoji: typeof r.emoji === 'string' && r.emoji.trim() ? r.emoji : FALLBACK_TYPE_EMOJI,
      fa: typeof r.fa === 'string' && r.fa ? r.fa : key,
      ar: typeof r.ar === 'string' && r.ar ? r.ar : key,
      en: typeof r.en === 'string' && r.en ? r.en : key,
    });
  }
  return out.length > 0 ? out : [...DEFAULT_PLACE_TYPES];
}

export function typeEmoji(defs: PlaceTypeDef[], key: string): string {
  return defs.find((d) => d.key === key)?.emoji ?? FALLBACK_TYPE_EMOJI;
}

export function typeLabel(defs: PlaceTypeDef[], key: string, locale: string): string {
  const d = defs.find((x) => x.key === key);
  if (!d) return key;
  if (locale === 'ar') return d.ar;
  if (locale === 'en') return d.en;
  return d.fa;
}

export interface PlaceImage {
  url: string;
  caption: string;
}

export interface ReligiousPlace {
  id: string;
  name: LocalizedText;
  /** Place-type key, e.g. "mosque" | "haramain" | "library" | "museum" | "pilgrimage" | "other". */
  type: string;
  lat: number;
  lng: number;
  description: LocalizedText | null;
  /** Free-text city label (manual fallback — never geocoded by the server). */
  city: string | null;
  /** Optional http(s) image URL for the detail page and map popups. */
  image_url: string | null;
  /** Gallery (globe phase): http(s) image URLs with optional captions. */
  images: PlaceImage[] | null;
  /** Phase-9 library item id for the 360° virtual tour, when available. */
  video_360_id: string | null;
  /** Regular-video URL (YouTube/Vimeo/Aparat embeds on the web). */
  video_url: string | null;
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
  city: string | null;
  imageUrl: string | null;
  images: PlaceImage[];
  video360Id: string | null;
  videoUrl: string | null;
}

/** Cover image: the explicit cover first, then the gallery's first image. */
export function coverImage(view: PlaceView): string | null {
  return view.imageUrl ?? view.images[0]?.url ?? null;
}

/** CRM-controlled popup shape (`places.popup` setting; all default true). */
export interface PlacesPopupConfig {
  showImage: boolean;
  showDescription: boolean;
  showType: boolean;
  showCity: boolean;
}

export const DEFAULT_POPUP_CONFIG: PlacesPopupConfig = {
  showImage: true,
  showDescription: true,
  showType: true,
  showCity: true,
};

/**
 * Image URLs reach the DOM (popup HTML + <img>) — accept only http(s).
 * Anything else (javascript:, data:, relative) is dropped, never rendered.
 */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || !(t.startsWith('https://') || t.startsWith('http://'))) return null;
  return t.length > 1024 ? null : t;
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
  const images: PlaceImage[] = [];
  if (Array.isArray(r.images)) {
    for (const im of r.images.slice(0, 20)) {
      if (!im || typeof im !== 'object') continue;
      const url = safeImageUrl((im as Record<string, unknown>).url);
      if (!url) continue;
      const caption = (im as Record<string, unknown>).caption;
      images.push({ url, caption: typeof caption === 'string' ? caption.slice(0, 200) : '' });
    }
  }
  const videoUrl = safeImageUrl(r.video_url);
  return {
    id,
    name: name && typeof name === 'object' ? name : { fa: id },
    type: asText(r.type) || 'other',
    lat,
    lng,
    description: (r.description as LocalizedText | null) ?? null,
    city: asText(r.city) || null,
    image_url: safeImageUrl(r.image_url),
    images: images.length > 0 ? images : null,
    video_360_id: typeof r.video_360_id === 'string' && r.video_360_id ? r.video_360_id : null,
    video_url: videoUrl,
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
    city: place.city,
    imageUrl: place.image_url,
    images: place.images ?? [],
    video360Id: place.video_360_id,
    videoUrl: place.video_url,
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
