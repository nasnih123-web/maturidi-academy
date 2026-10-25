import { getApiBaseUrl, ApiError } from './api';
import {
  normalizePlace,
  normalizePlacesList,
  type PlacesListResponse,
  type ReligiousPlace,
} from './places-view';

/**
 * Server-side places client (RSC only — never imported from client
 * components). All data access for the Phase-11 map goes through this
 * layer; components render view models.
 */

function apiUrl(path: string): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}${path}`;
}

async function fetchJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      next: { revalidate: 300 },
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ApiError(
      `API unreachable at ${getApiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    throw new ApiError(`GET ${path} → ${res.status}`, res.status);
  }
  return res.json();
}

/**
 * One page of published places (public contract: {items, total}).
 * Supports the backend's type filter, limit and bounding-box params.
 * Throws ApiError on unreachable API or non-2xx — callers render a graceful
 * error state (contract §15: no mock data in the production path).
 */
export async function getPlacesPage(opts: {
  type?: string;
  limit?: number;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
} = {}): Promise<PlacesListResponse> {
  const params = new URLSearchParams();
  if (opts.type && opts.type !== 'all') params.set('type', opts.type);
  params.set('limit', String(Math.min(Math.max(opts.limit ?? 500, 1), 500)));
  if (opts.bbox) {
    params.set('min_lat', String(opts.bbox.minLat));
    params.set('max_lat', String(opts.bbox.maxLat));
    params.set('min_lng', String(opts.bbox.minLng));
    params.set('max_lng', String(opts.bbox.maxLng));
  }
  const qs = params.toString();
  const body = await fetchJson(`/api/v1/places${qs ? `?${qs}` : ''}`);
  return normalizePlacesList(body);
}

/**
 * All published places for the map. The domain is admin-curated and small;
 * a single max-limit request covers it (backend caps limit at 500).
 */
export async function getAllPlaces(): Promise<ReligiousPlace[]> {
  const res = await getPlacesPage({ limit: 500 });
  return res.items;
}

/** Single published place for the detail route. 404 → ApiError(404). */
export async function getPlace(id: string): Promise<ReligiousPlace> {
  const body = await fetchJson(`/api/v1/places/${encodeURIComponent(id)}`);
  const place = normalizePlace(body);
  if (!place) throw new ApiError(`GET /api/v1/places/${id} → unparseable`, 502);
  return place;
}
