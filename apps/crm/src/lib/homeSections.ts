/**
 * Homepage section data — admin transport for HomeSection.data.
 *
 * - GET /api/v1/home/sections (public) lists sections with their current
 *   data payloads; the Appearance panel uses it to prefill the editor.
 * - PUT /api/v1/admin/home/sections/{key}/data (platform.settings) replaces
 *   a section's data payload. The server validates the web's section-data
 *   contract: at most 12 items, a non-empty localized title per item, and
 *   safe hrefs (same-origin paths or http(s) URLs).
 * - The footer section uses the same endpoint with a different payload
 *   shape instead of items: `{ columns: FooterColumn[], brand: { tagline?,
 *   rights? } }` — at most 6 columns, at most 12 links per column, every
 *   heading/label localized (fa/ar/en) and every href a safe href. The
 *   web falls back to its built-in footer text/columns whenever the saved
 *   footer payload is null or a field is empty, so clearing the form never
 *   breaks the live footer.
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

/* ------------------------------------------------------------------ */
/* Footer (footer section data — structured form, not the JSON panel)  */
/* ------------------------------------------------------------------ */

export type FooterLocale = "fa" | "ar" | "en";
export type FooterLocalized = Record<FooterLocale, string>;

export interface FooterLinkDraft {
  label: FooterLocalized;
  href: string;
}

export interface FooterColumnDraft {
  heading: FooterLocalized;
  links: FooterLinkDraft[];
}

export interface FooterBrandDraft {
  tagline: FooterLocalized;
  rights: FooterLocalized;
}

export interface FooterDataDraft {
  columns: FooterColumnDraft[];
  brand: FooterBrandDraft;
}

export function emptyLocalized(): FooterLocalized {
  return { fa: "", ar: "", en: "" };
}

/** Client-side mirror of the web's safeHref: same-origin path or http(s). */
export function isSafeHref(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  return /^https?:\/\//i.test(trimmed);
}

function hasAnyText(t: FooterLocalized): boolean {
  return Object.values(t).some((v) => v.trim() !== "");
}

/**
 * Validate a footer draft before saving. Returns the first problem as a
 * message key suffix (the panel maps it to an i18n string), or null when
 * valid. The server re-validates everything (422 on unsafe hrefs, empty
 * headings/labels, or over-limit columns/links); this only catches the
 * common mistakes early, before a round-trip.
 */
export function validateFooterDraft(draft: FooterDataDraft): string | null {
  if (draft.columns.length > 6) return "footerTooManyColumns";
  for (const col of draft.columns) {
    if (!hasAnyText(col.heading)) return "footerEmptyHeading";
    if (col.links.length > 12) return "footerTooManyLinks";
    for (const link of col.links) {
      if (!hasAnyText(link.label)) return "footerEmptyLabel";
      if (!isSafeHref(link.href)) return "footerUnsafeHref";
    }
  }
  return null;
}

/** Parse a saved footer `data` payload back into a draft (unknown fields ignored). */
export function parseFooterData(data: Record<string, unknown> | null): FooterDataDraft {
  const loc = (v: unknown): FooterLocalized => {
    const out = emptyLocalized();
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      for (const l of ["fa", "ar", "en"] as const) {
        if (typeof rec[l] === "string") out[l] = rec[l] as string;
      }
    } else if (typeof v === "string") {
      out.fa = v;
    }
    return out;
  };
  const columns: FooterColumnDraft[] = [];
  if (data && Array.isArray(data.columns)) {
    for (const raw of data.columns.slice(0, 6)) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const links: FooterLinkDraft[] = [];
      if (Array.isArray(rec.links)) {
        for (const l of rec.links.slice(0, 12)) {
          if (!l || typeof l !== "object") continue;
          const lr = l as Record<string, unknown>;
          links.push({
            label: loc(lr.label),
            href: typeof lr.href === "string" ? lr.href : "",
          });
        }
      }
      columns.push({ heading: loc(rec.heading), links });
    }
  }
  const brandRec =
    data && data.brand && typeof data.brand === "object"
      ? (data.brand as Record<string, unknown>)
      : {};
  return {
    columns,
    brand: { tagline: loc(brandRec.tagline), rights: loc(brandRec.rights) },
  };
}

/** Save a footer draft via the shared section-data endpoint (key "footer"). */
export async function putFooterData(draft: FooterDataDraft): Promise<void> {
  await putSectionData("footer", {
    columns: draft.columns.map((c) => ({
      heading: c.heading,
      links: c.links.map((l) => ({ label: l.label, href: l.href.trim() })),
    })),
    brand: draft.brand,
  });
}
