import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { errText } from "./library";
import {
  EMPTY_L10N,
  WORKFLOW_TRANSITIONS,
  type LocalizedText,
  type WorkflowStatus,
} from "./contentApi";

/**
 * Phase 11 Track 3 (CRM) — religious places management (`religious_places`),
 * globe phase.
 *
 * Management-plane client over the Track 1 backend contract (ADMIN prefix —
 * the public prefix exposes published-only reads and has no create/update/
 * transition/delete routes; the previous public-prefix calls 404'd):
 * - GET    /api/v1/admin/places?status=&type=&limit=  (no q/offset params)
 * - GET    /api/v1/admin/places/{id}
 * - POST   /api/v1/admin/places
 * - PATCH  /api/v1/admin/places/{id}
 * - POST   /api/v1/admin/places/{id}/transition      {target}
 * - DELETE /api/v1/admin/places/{id}  (draft-only, physical delete)
 *
 * Text search (q) and offset/limit paging are applied CLIENT-SIDE over the
 * fetched admin list, because the admin list has no q/offset params.
 * ADR-001: parsing/defaults/workflow rules live here — components render only.
 */

export { errText };

/** A place type is a settings-driven key (see `places.types`); legacy keys
 *  (shrine / holy_site / school) still parse — they render with the
 *  `other` fallback until an admin retypes them. */
export type PlaceType = string;

export interface PlaceTypeDef {
  key: string;
  emoji: string;
  fa: string;
  ar: string;
  en: string;
}

export const DEFAULT_PLACE_TYPES: PlaceTypeDef[] = [
  { key: "mosque", emoji: "🕌", fa: "مسجد", ar: "مسجد", en: "Mosque" },
  { key: "haramain", emoji: "🕋", fa: "حرمین شریفین", ar: "الحرمان الشريفان", en: "The Two Holy Mosques" },
  { key: "library", emoji: "📚", fa: "کتابخانه", ar: "مكتبة", en: "Library" },
  { key: "museum", emoji: "🏛️", fa: "موزه", ar: "متحف", en: "Museum" },
  { key: "pilgrimage", emoji: "🌙", fa: "مکان زیارتی", ar: "مكان زيارة", en: "Pilgrimage site" },
  { key: "other", emoji: "📍", fa: "سایر", ar: "أخرى", en: "Other" },
];

/** Defensive parse of a stored `places.types` value; never throws. */
export function parsePlaceTypes(v: unknown): PlaceTypeDef[] {
  let list: unknown = v;
  if (typeof v === "string" && v.trim()) {
    try {
      list = JSON.parse(v) as unknown;
    } catch {
      return [...DEFAULT_PLACE_TYPES];
    }
  }
  if (!Array.isArray(list) || list.length === 0) return [...DEFAULT_PLACE_TYPES];
  const out: PlaceTypeDef[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.trim() : "";
    if (!key || key.length > 32 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      emoji: typeof r.emoji === "string" && r.emoji.trim() ? r.emoji : "📍",
      fa: typeof r.fa === "string" && r.fa ? r.fa : key,
      ar: typeof r.ar === "string" && r.ar ? r.ar : key,
      en: typeof r.en === "string" && r.en ? r.en : key,
    });
  }
  return out.length > 0 ? out : [...DEFAULT_PLACE_TYPES];
}

export function typeEmoji(defs: PlaceTypeDef[], key: string): string {
  return defs.find((d) => d.key === key)?.emoji ?? "📍";
}

export interface PlaceImage {
  url: string;
  caption: string;
}

export interface ReligiousPlace {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  lat: number;
  lng: number;
  type: PlaceType;
  /** Free-text city label (manual fallback — never geocoded). */
  city: string | null;
  /** Optional http(s) image URL for detail page + map popups. */
  image_url: string | null;
  /** Gallery (globe phase): http(s) image URLs with optional captions. */
  images: PlaceImage[];
  /** Nullable link to a Phase-9 360° video library item. */
  video_360_id: string | null;
  /** Regular-video URL (YouTube/Vimeo/Aparat embeds on the web). */
  video_url: string | null;
  submitted_by: string | null;
  workflow_status: WorkflowStatus;
  created_at: string;
  updated_at: string;
}

export interface PlaceFilters {
  workflow_status?: WorkflowStatus | "";
  type?: PlaceType | "";
  q?: string;
  limit?: number;
  offset?: number;
}

export const PLACES_KEY = ["places"] as const;

function toLocalized(v: unknown): LocalizedText {
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    return {
      fa: typeof r.fa === "string" ? r.fa : "",
      ar: typeof r.ar === "string" ? r.ar : "",
      en: typeof r.en === "string" ? r.en : "",
    };
  }
  if (typeof v === "string") return { fa: v, ar: "", en: "" };
  return { ...EMPTY_L10N };
}

function toImages(v: unknown): PlaceImage[] {
  if (!Array.isArray(v)) return [];
  const out: PlaceImage[] = [];
  for (const im of v.slice(0, 20)) {
    if (!im || typeof im !== "object") continue;
    const r = im as Record<string, unknown>;
    if (typeof r.url !== "string" || !r.url) continue;
    out.push({
      url: r.url,
      caption: typeof r.caption === "string" ? r.caption.slice(0, 200) : "",
    });
  }
  return out;
}

export function normalizePlace(row: Record<string, unknown>): ReligiousPlace {
  return {
    id: String(row["id"] ?? ""),
    name: toLocalized(row["name"]),
    description: toLocalized(row["description"]),
    lat: Number(row["lat"] ?? 0),
    lng: Number(row["lng"] ?? 0),
    type: typeof row["type"] === "string" && row["type"] ? row["type"] : "other",
    city:
      row["city"] === null || row["city"] === undefined
        ? null
        : String(row["city"]),
    image_url:
      row["image_url"] === null || row["image_url"] === undefined
        ? null
        : String(row["image_url"]),
    images: toImages(row["images"]),
    video_360_id:
      row["video_360_id"] === null || row["video_360_id"] === undefined
        ? null
        : String(row["video_360_id"]),
    video_url:
      row["video_url"] === null || row["video_url"] === undefined
        ? null
        : String(row["video_url"]),
    submitted_by:
      row["submitted_by"] === null || row["submitted_by"] === undefined
        ? null
        : String(row["submitted_by"]),
    workflow_status: (row["workflow_status"] as WorkflowStatus) ?? "draft",
    created_at: String(row["created_at"] ?? ""),
    updated_at: String(row["updated_at"] ?? ""),
  };
}

function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

export function usePlaces(filters: PlaceFilters = {}) {
  const { workflow_status, type, q, limit, offset } = filters;
  return useQuery({
    queryKey: [...PLACES_KEY, workflow_status, type, q, limit, offset],
    queryFn: async () => {
      // Admin list: status + type + limit only (max 500). q/offset are
      // applied client-side below — the admin endpoint has no such params.
      const params = new URLSearchParams();
      if (workflow_status) params.set("status", workflow_status);
      if (type) params.set("type", type);
      params.set("limit", "500");
      const payload = await apiFetch<unknown>(
        `/api/v1/admin/places?${params.toString()}`,
      );
      let rows = asArray<Record<string, unknown>>(payload).map(normalizePlace);
      const needle = (q ?? "").trim().toLowerCase();
      if (needle) {
        rows = rows.filter((p) => {
          const hay = [p.name.fa, p.name.ar, p.name.en, p.city ?? ""]
            .join(" ")
            .toLowerCase();
          return hay.includes(needle);
        });
      }
      const start = offset ?? 0;
      return rows.slice(start, limit !== undefined ? start + limit : undefined);
    },
  });
}

export function usePlace(id: string | null) {
  return useQuery({
    queryKey: [...PLACES_KEY, "one", id],
    queryFn: () =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/admin/places/${encodeURIComponent(id as string)}`,
      ).then(normalizePlace),
    enabled: id !== null,
  });
}

export interface PlaceInput {
  name: LocalizedText;
  description: LocalizedText;
  lat: number;
  lng: number;
  type: PlaceType;
  city: string | null;
  image_url: string | null;
  images: PlaceImage[] | null;
  video_360_id: string | null;
  video_url: string | null;
}

/** CRM control for the public map popup (`places.popup` setting). */
export interface PlacesPopupConfig {
  show_image: boolean;
  show_description: boolean;
  show_type: boolean;
  show_city: boolean;
}

export const DEFAULT_POPUP_CONFIG: PlacesPopupConfig = {
  show_image: true,
  show_description: true,
  show_type: true,
  show_city: true,
};

/** Defensive parse of the stored `places.popup` JSON (string or object). */
export function parsePopupConfig(v: unknown): PlacesPopupConfig {
  let o: Record<string, unknown> | null = null;
  if (typeof v === "string" && v.trim()) {
    try {
      const p: unknown = JSON.parse(v);
      o = p && typeof p === "object" ? (p as Record<string, unknown>) : null;
    } catch {
      o = null;
    }
  } else if (v && typeof v === "object") {
    o = v as Record<string, unknown>;
  }
  if (!o) return { ...DEFAULT_POPUP_CONFIG };
  const b = (k: string): boolean => (typeof o[k] === "boolean" ? (o[k] as boolean) : true);
  return {
    show_image: b("show_image"),
    show_description: b("show_description"),
    show_type: b("show_type"),
    show_city: b("show_city"),
  };
}

/** CRM control for the default globe view (`places.globe` setting). */
export interface PlacesGlobeSettings {
  defaultLat: number;
  defaultLng: number;
  defaultAltitude: number;
  defaultMode: string;
  autoRotate: boolean;
}

export const DEFAULT_GLOBE_SETTINGS: PlacesGlobeSettings = {
  defaultLat: 21.4225,
  defaultLng: 39.8262,
  defaultAltitude: 2.5,
  defaultMode: "satellite",
  autoRotate: false,
};

/** Defensive parse of the stored `places.globe` JSON (string or object). */
export function parseGlobeSettings(v: unknown): PlacesGlobeSettings {
  let o: Record<string, unknown> | null = null;
  if (typeof v === "string" && v.trim()) {
    try {
      const p: unknown = JSON.parse(v);
      o = p && typeof p === "object" ? (p as Record<string, unknown>) : null;
    } catch {
      o = null;
    }
  } else if (v && typeof v === "object") {
    o = v as Record<string, unknown>;
  }
  if (!o) return { ...DEFAULT_GLOBE_SETTINGS };
  const num = (k: string, dflt: number, min: number, max: number): number => {
    const n = o[k];
    return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : dflt;
  };
  const mode = typeof o.defaultMode === "string" &&
    ["satellite", "simple", "dark", "topology"].includes(o.defaultMode)
    ? (o.defaultMode as string)
    : "satellite";
  return {
    defaultLat: num("defaultLat", 21.4225, -90, 90),
    defaultLng: num("defaultLng", 39.8262, -180, 180),
    defaultAltitude: num("defaultAltitude", 2.5, 0.1, 10),
    defaultMode: mode,
    autoRotate: typeof o.autoRotate === "boolean" ? o.autoRotate : false,
  };
}

export function useCreatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlaceInput) =>
      apiFetch<Record<string, unknown>>("/api/v1/admin/places", {
        method: "POST",
        body: {
          name: body.name,
          description: body.description,
          lat: body.lat,
          lng: body.lng,
          type: body.type,
          city: body.city,
          image_url: body.image_url,
          images: body.images,
          video_360_id: body.video_360_id,
          video_url: body.video_url,
        },
      }).then(normalizePlace),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PLACES_KEY });
    },
  });
}

export function useUpdatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PlaceInput> }) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/admin/places/${encodeURIComponent(id)}`,
        { method: "PATCH", body },
      ).then(normalizePlace),
    onSuccess: (place) => {
      void qc.invalidateQueries({ queryKey: PLACES_KEY });
      void qc.invalidateQueries({ queryKey: [...PLACES_KEY, "one", place.id] });
    },
  });
}

export function useTransitionPlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, note }: { id: string; to: WorkflowStatus; note?: string }) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/admin/places/${encodeURIComponent(id)}/transition`,
        { method: "POST", body: note ? { target: to, note } : { target: to } },
      ).then(normalizePlace),
    onSuccess: (place) => {
      void qc.invalidateQueries({ queryKey: PLACES_KEY });
      void qc.invalidateQueries({ queryKey: [...PLACES_KEY, "one", place.id] });
    },
  });
}

export function useDeletePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/admin/places/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PLACES_KEY });
    },
  });
}

/** The shared Phase-0 workflow machine (contract §9) — never a separate one. */
export const PLACE_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> =
  WORKFLOW_TRANSITIONS;

/**
 * Hide target for a place (globe phase): the workflow machine allows
 * PUBLISHED -> {ARCHIVED} only, so a published place hides by archiving;
 * any other status hides by returning to draft when that transition is
 * valid. Archived places leave the public globe (published-only filter)
 * and restore via archived -> draft -> review -> approve -> publish.
 */
export function hideTarget(status: WorkflowStatus): WorkflowStatus | null {
  if (status === "published") return "archived";
  const valid = WORKFLOW_TRANSITIONS[status] ?? [];
  return valid.includes("draft") ? "draft" : null;
}

/** Validate lat/lng bounds before sending (presentation-time guard). */
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

/** OpenStreetMap embed URL for a coordinate preview (presentation only). */
export function osmEmbedUrl(lat: number, lng: number): string {
  const d = 0.01;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
