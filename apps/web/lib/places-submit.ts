import { apiBaseUrl } from './api-base';
import { PLACE_TYPES } from './places-view';

/**
 * Public place registration client (maps phase).
 *
 * POST /api/v1/places/submissions — anonymous, draft-only. The server
 * never publishes a submission; a CRM admin reviews it through the §9
 * workflow first. This module only validates + posts; it renders nothing
 * (ADR-0002: no business logic in components).
 */

export interface PlaceSubmissionInput {
  name: string;
  description: string;
  city: string;
  imageUrl: string;
  lat: number;
  lng: number;
  type: string;
}

export function validCoords(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function validImageUrl(v: string): boolean {
  const t = v.trim();
  return t === '' || t.startsWith('https://') || t.startsWith('http://');
}

export async function submitPlace(
  input: PlaceSubmissionInput,
  locale: string,
  allowedKeys?: string[],
): Promise<{ id: string }> {
  if (!input.name.trim()) throw new Error('name_required');
  if (!validCoords(input.lat, input.lng)) throw new Error('invalid_coords');
  if (!validImageUrl(input.imageUrl)) throw new Error('invalid_image_url');
  const keys = allowedKeys && allowedKeys.length > 0 ? allowedKeys : [...PLACE_TYPES];
  const type = keys.includes(input.type) ? input.type : keys[0];
  const name: Record<string, string> = { fa: '', ar: '', en: '' };
  name[locale] = input.name.trim();
  const description: Record<string, string> = { fa: '', ar: '', en: '' };
  if (input.description.trim()) description[locale] = input.description.trim();
  const res = await fetch(`${apiBaseUrl()}/api/v1/places/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name,
      description: input.description.trim() ? description : null,
      lat: input.lat,
      lng: input.lng,
      type,
      city: input.city.trim() || null,
      image_url: input.imageUrl.trim() || null,
    }),
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body?.error?.code) code = body.error.code;
    } catch {
      /* keep the HTTP code */
    }
    throw new Error(code);
  }
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) throw new Error('bad_response');
  return { id: body.id };
}
