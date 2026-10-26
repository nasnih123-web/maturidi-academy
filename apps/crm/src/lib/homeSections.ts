/**
 * Homepage section data — admin transport for HomeSection.data.
 *
 * - GET /api/v1/home/sections (public) lists sections with their current
 *   data payloads; the Appearance panel uses it to prefill the editor.
 * - PUT /api/v1/admin/home/sections/{key}/data (platform.settings) replaces
 *   a section's data payload. The server validates the web's section-data
 *   contract: at most 12 items, a non-empty localized title per item, and
 *   safe hrefs (same-origin paths or http(s) URLs).
 */
import { apiFetch } from "./api";

export interface HomeSectionData {
  key: string;
  data: Record<string, unknown> | null;
}

interface HomeSectionsResponse {
  sections?: Array<{ key?: unknown; data?: unknown }>;
}

function parseSections(raw: unknown): HomeSectionData[] {
  if (!raw || typeof raw !== "object") return [];
  const sections = (raw as HomeSectionsResponse).sections;
  if (!Array.isArray(sections)) return [];
  const out: HomeSectionData[] = [];
  for (const s of sections) {
    if (!s || typeof s.key !== "string") continue;
    out.push({
      key: s.key,
      data:
        s.data && typeof s.data === "object"
          ? (s.data as Record<string, unknown>)
          : null,
    });
  }
  return out;
}

export async function fetchHomeSections(): Promise<HomeSectionData[]> {
  const raw = await apiFetch<unknown>("/api/v1/home/sections");
  return parseSections(raw);
}

export async function putSectionData(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  await apiFetch(`/api/v1/admin/home/sections/${encodeURIComponent(key)}/data`, {
    method: "PUT",
    body: data,
  });
}
