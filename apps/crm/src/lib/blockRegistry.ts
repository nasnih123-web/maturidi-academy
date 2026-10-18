/**
 * Block registry for the Phase-4 visual editor (pure logic — no JSX, no
 * grapesjs import; ADR-001). A block is the CMS unit the web renderer
 * understands (`{type, props}`, same shape as apps/web CmsBlock).
 *
 * Palette = general widgets (hero, text, image, quote, CTA banner, divider)
 * + the Phase-3 homepage rows (hero, latest_fatwas, quran_of_day,
 * suggested_lessons, fresh_library, community, donation_banner).
 *
 * The GrapesJS canvas stores each block as a component with
 * `data-cms-type` / `data-cms-props` attributes; `canvasToBlocks` reads
 * them back losslessly, so save = blocks JSON → page API.
 */

import { CmsBlock, EMPTY_L10N, LocalizedText } from "./contentApi";

export type PropKind = "l10n" | "text" | "url" | "select";

export interface PropDef {
  name: string;
  kind: PropKind;
  options?: string[];
  /** i18n key for the prop label, under `studio.` */
  labelKey: string;
}

export interface BlockDef {
  type: string;
  /** i18n key for the palette label, under `studio.` */
  labelKey: string;
  category: "general" | "homepage";
  props: PropDef[];
  defaults: Record<string, unknown>;
}

const L = (): LocalizedText => ({ ...EMPTY_L10N });

export const BLOCK_DEFS: BlockDef[] = [
  {
    type: "hero",
    labelKey: "block_hero",
    category: "general",
    props: [
      { name: "heading", kind: "l10n", labelKey: "prop_heading" },
      { name: "sub", kind: "l10n", labelKey: "prop_sub" },
      { name: "cta_label", kind: "l10n", labelKey: "prop_cta_label" },
      { name: "cta_link", kind: "url", labelKey: "prop_cta_link" },
      {
        name: "theme",
        kind: "select",
        options: ["default", "ramadan", "muharram", "eid-fitr", "eid-adha", "mawlid"],
        labelKey: "prop_theme",
      },
    ],
    defaults: { heading: L(), sub: L(), cta_label: L(), cta_link: "", theme: "default" },
  },
  {
    type: "rich-text",
    labelKey: "block_text",
    category: "general",
    props: [
      { name: "heading", kind: "l10n", labelKey: "prop_heading" },
      { name: "body", kind: "l10n", labelKey: "prop_body" },
    ],
    defaults: { heading: L(), body: L() },
  },
  {
    type: "image",
    labelKey: "block_image",
    category: "general",
    props: [
      { name: "src", kind: "url", labelKey: "prop_src" },
      { name: "alt", kind: "l10n", labelKey: "prop_alt" },
      { name: "caption", kind: "l10n", labelKey: "prop_caption" },
    ],
    defaults: { src: "", alt: L(), caption: L() },
  },
  {
    type: "quote",
    labelKey: "block_quote",
    category: "general",
    props: [
      { name: "text", kind: "l10n", labelKey: "prop_text" },
      { name: "author", kind: "l10n", labelKey: "prop_author" },
    ],
    defaults: { text: L(), author: L() },
  },
  {
    type: "cta-banner",
    labelKey: "block_cta_banner",
    category: "general",
    props: [
      { name: "title", kind: "l10n", labelKey: "prop_title" },
      { name: "body", kind: "l10n", labelKey: "prop_body" },
      { name: "cta_label", kind: "l10n", labelKey: "prop_cta_label" },
      { name: "cta_link", kind: "url", labelKey: "prop_cta_link" },
    ],
    defaults: { title: L(), body: L(), cta_label: L(), cta_link: "" },
  },
  {
    type: "divider",
    labelKey: "block_divider",
    category: "general",
    props: [],
    defaults: {},
  },
  /* Phase-3 homepage rows — dropped onto a page as live sections. */
  ...[
    "hero",
    "latest_fatwas",
    "quran_of_day",
    "suggested_lessons",
    "fresh_library",
    "community",
    "donation_banner",
  ].map(
    (key): BlockDef => ({
      type: `section-${key}`,
      labelKey: `block_section_${key}`,
      category: "homepage",
      props: [],
      defaults: { section_key: key },
    }),
  ),
];

export function blockDefOf(type: string): BlockDef | undefined {
  return BLOCK_DEFS.find((d) => d.type === type);
}

/** Deep-clone defaults so palette drops never share object identity. */
export function defaultPropsOf(type: string): Record<string, unknown> {
  const def = blockDefOf(type);
  return def ? JSON.parse(JSON.stringify(def.defaults)) : {};
}

/* ------------------------------------------------------------------ */
/* Canvas ↔ blocks conversion (the grapesjs component contract)         */
/* ------------------------------------------------------------------ */

export const CMS_TYPE_ATTR = "data-cms-type";
export const CMS_PROPS_ATTR = "data-cms-props";

export interface CanvasComponent {
  type: string;
  attributes: Record<string, string>;
}

/** Blocks → the component list handed to grapesjs `components`. */
export function blocksToCanvas(blocks: CmsBlock[]): CanvasComponent[] {
  return (Array.isArray(blocks) ? blocks : []).map((b) => ({
    type: "cms-block",
    attributes: {
      [CMS_TYPE_ATTR]: b.type,
      [CMS_PROPS_ATTR]: JSON.stringify(b.props ?? {}),
    },
  }));
}

export interface RawComponent {
  getAttributes: () => Record<string, string | undefined>;
}

/** Canvas wrapper children → blocks JSON for the page API. */
export function canvasChildrenToBlocks(children: RawComponent[]): CmsBlock[] {
  const out: CmsBlock[] = [];
  for (const child of children) {
    const attrs = child.getAttributes();
    const type = attrs[CMS_TYPE_ATTR];
    if (!type) continue; // not a CMS block (e.g. stray wrapper) — skip
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(attrs[CMS_PROPS_ATTR] ?? "{}") as Record<string, unknown>;
    } catch {
      props = {};
    }
    out.push({ type, props });
  }
  return out;
}

/** Merge a partial props patch into the stored JSON (used by the props panel). */
export function patchStoredProps(
  raw: string | undefined,
  patch: Record<string, unknown>,
): string {
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    props = {};
  }
  return JSON.stringify({ ...props, ...patch });
}

/** Read one prop out of the stored JSON for the props panel. */
export function readStoredProp(raw: string | undefined, name: string): unknown {
  try {
    const props = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    return props[name];
  } catch {
    return undefined;
  }
}

export function asLocalizedText(v: unknown): LocalizedText {
  if (v && typeof v === "object") {
    const m = v as Record<string, unknown>;
    return {
      fa: typeof m["fa"] === "string" ? (m["fa"] as string) : "",
      ar: typeof m["ar"] === "string" ? (m["ar"] as string) : "",
      en: typeof m["en"] === "string" ? (m["en"] as string) : "",
    };
  }
  return { ...EMPTY_L10N };
}
