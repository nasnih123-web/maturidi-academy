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
 * Phase 11 Track 3 (CRM) — religious places management (`religious_places`).
 *
 * Management-plane client over the Track 1 backend contract:
 * - GET    /api/v1/places?workflow_status=&type=&q=&limit=&offset=
 * - POST   /api/v1/places
 * - PUT    /api/v1/places/{id}
 * - POST   /api/v1/places/{id}/transition      {to, note?}
 * - DELETE /api/v1/places/{id}                (archive per contract §15 §9)
 *
 * ADR-001: parsing/defaults/workflow rules live here — components render only.
 */

export { errText };

export type PlaceType = "mosque" | "shrine" | "school" | "library" | "other";

export const PLACE_TYPES: PlaceType[] = [
  "mosque",
  "shrine",
  "school",
  "library",
  "other",
];

export function parsePlaceType(v: unknown): PlaceType {
  return PLACE_TYPES.includes(v as PlaceType) ? (v as PlaceType) : "other";
}

export interface ReligiousPlace {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  lat: number;
  lng: number;
  type: PlaceType;
  /** Nullable link to a Phase-9 360° video library item. */
  video_360_id: string | null;
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

export function normalizePlace(row: Record<string, unknown>): ReligiousPlace {
  return {
    id: String(row["id"] ?? ""),
    name: toLocalized(row["name"]),
    description: toLocalized(row["description"]),
    lat: Number(row["lat"] ?? 0),
    lng: Number(row["lng"] ?? 0),
    type: parsePlaceType(row["type"]),
    video_360_id:
      row["video_360_id"] === null || row["video_360_id"] === undefined
        ? null
        : String(row["video_360_id"]),
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
      const params = new URLSearchParams();
      if (workflow_status) params.set("workflow_status", workflow_status);
      if (type) params.set("type", type);
      if (q) params.set("q", q);
      if (limit !== undefined) params.set("limit", String(limit));
      if (offset !== undefined) params.set("offset", String(offset));
      const qs = params.toString();
      const payload = await apiFetch<unknown>(
        qs ? `/api/v1/places?${qs}` : "/api/v1/places",
      );
      return asArray<Record<string, unknown>>(payload).map(normalizePlace);
    },
  });
}

export function usePlace(id: string | null) {
  return useQuery({
    queryKey: [...PLACES_KEY, "one", id],
    queryFn: () =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/places/${encodeURIComponent(id as string)}`,
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
  video_360_id: string | null;
}

export function useCreatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlaceInput) =>
      apiFetch<Record<string, unknown>>("/api/v1/places", {
        method: "POST",
        body: {
          name: body.name,
          description: body.description,
          lat: body.lat,
          lng: body.lng,
          type: body.type,
          video_360_id: body.video_360_id,
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
        `/api/v1/places/${encodeURIComponent(id)}`,
        { method: "PUT", body },
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
        `/api/v1/places/${encodeURIComponent(id)}/transition`,
        { method: "POST", body: note ? { to, note } : { to } },
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
        `/api/v1/places/${encodeURIComponent(id)}`,
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
