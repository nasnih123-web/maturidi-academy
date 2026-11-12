/**
 * Quran printed pages as inline SVG (round 6, Hafs only).
 *
 * Source: quran-ws/quran-svg — vectorised Mushaf al-Madinah pages
 * (King Fahd Complex, Hafs 'an 'Asim, kfqc edition), each page carrying
 * one transparent `<path class="ayahPolygon">` per ayah with `surah`
 * and `ayah` attributes. Pages are fetched live from
 * raw.githubusercontent.com (open CORS) and inlined — never an <img> —
 * so the polygons stay addressable for tap + highlight.
 *
 * Rules followed (from the quran.ws reference + FORMAT.md):
 * - Read the reference from the polygon's `surah`/`ayah` attributes.
 *   NEVER parse the global `id` ("verse-N" is numbered across all five
 *   mushafs, not per mushaf).
 * - Fit the artwork to its ink with getBBox + 4% padding: pages 1-2
 *   declare a 345x550 viewBox the drawing only fills about a third
 *   of, so rendering the declared box leaves a mostly-empty page.
 * - Pointer-events: the glyph groups (#content, #ayah_markers) get
 *   `pointer-events: none` so taps always land on the polygon layer
 *   (in Hafs the polygons already sit on top; this is what keeps the
 *   other riwayas working when they arrive next round).
 * - Highlight by changing fill-opacity, never by setting fill: none
 *   (under visiblePainted, fill:none stops the taps).
 * - The per-page JSON is the ayah list for the page; surah.json +
 *   bounded binary search (pageOf, at most 6 requests) resolves a
 *   reference to its page. Page numbers are per-mushaf: Warsh p42 is
 *   NOT Hafs p42, so the mushaf key always travels with a page number.
 * - If the SVG fetch fails (offline, blocked CDN, Iran), the caller
 *   renders the existing exact-line text page instead — same
 *   navigation, same Hafs page numbers, never a dead page.
 *   Reachability of raw.githubusercontent.com from inside Iran is
 *   UNVERIFIED, which is why the fallback is load-bearing, not
 *   decorative; same-origin hosting of the current page is a later
 *   weighing, not assumed here.
 * - Weight: the plain .svg is fetched live (Hafs page 1 is ~196 KB,
 *   page 42 ~618 KB — one page at a time, never the whole mushaf).
 *   Brotli copies exist beside the SVGs (svg-br/, page 1 is ~33 KB),
 *   but raw.githubusercontent.com serves them without a
 *   Content-Encoding, and browsers have no built-in brotli decoder,
 *   so the live path uses the plain file; a same-origin host could
 *   serve the .br copies properly later. Nothing is bundled: 722
 *   files per mushaf x 5 mushafs must never land in the repo.
 *
 * Licence: the ayah-polygon layer + JSON metadata are CC BY 4.0
 * (attribution waived inside a product); the page artwork belongs to
 * the King Fahd Complex, which grants free worldwide digital, web,
 * software and media use — the only restriction is printing physical
 * mushafs for commercial sale. Full statement in
 * THIRD_PARTY_NOTICES.md ("Quran printed pages (quran.ws / KFGQPC)").
 */

const RAW = 'https://raw.githubusercontent.com/quran-ws/quran-svg/main/mushafs';

/**
 * The mushaf key — ONE parameter, never hard-coded Hafs anywhere
 * except the default value. All five printed mushafs render through
 * the SAME path (SVG page + tap→reference + highlight + fallback);
 * only the data folder changes. Page numbers are per-mushaf and are
 * NEVER carried across riwayas: a reference's page in another mushaf
 * must be read from THAT mushaf's own surah.json (e.g. Warsh p42 is
 * 2:251–2:255 while Hafs p42 is 2:253–2:256). An ayah number without
 * its riwayah is not a reference, so the key travels beside every
 * page number (bookmarks, resume, deep links).
 */
export const SVG_MUSHAF_KEYS = [
  'hafs/kfqc',
  'warsh/kfqc',
  'qalon/kfqc',
  'douri/kfqc',
  'shubah/kfqc',
] as const;

export type SvgMushafKey = (typeof SVG_MUSHAF_KEYS)[number];

export const DEFAULT_SVG_MUSHAF: SvgMushafKey = 'hafs/kfqc';

/** Validate an untrusted mushaf param (URL, storage) — default on junk. */
export function parseSvgMushafKey(v: string | null | undefined): SvgMushafKey {
  return (SVG_MUSHAF_KEYS as readonly string[]).includes(v ?? '')
    ? (v as SvgMushafKey)
    : DEFAULT_SVG_MUSHAF;
}

/** Ayah totals per mushaf, from each mushaf's own surah.json. */
export const SVG_MUSHAF_AYAH_COUNTS: Record<SvgMushafKey, number> = {
  'hafs/kfqc': 6236,
  'warsh/kfqc': 6214,
  'qalon/kfqc': 6214,
  'douri/kfqc': 6218,
  'shubah/kfqc': 6236,
};

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Inline SVG artwork for a page (1..604) of the given mushaf. */
export function svgPageUrl(mushaf: SvgMushafKey, page: number): string {
  return `${RAW}/${mushaf}/svg/${pad3(page)}.svg`;
}

/** Per-page ayah-polygon JSON for a page (1..604) of the given mushaf. */
export function svgPageJsonUrl(mushaf: SvgMushafKey, page: number): string {
  return `${RAW}/${mushaf}/json/${pad3(page)}.json`;
}

/** Surah index: 114 entries, in surah order, of the given mushaf. */
export function svgSurahIndexUrl(mushaf: SvgMushafKey): string {
  return `${RAW}/${mushaf}/json/surah.json`;
}

export interface SvgPageAyah {
  surah: number;
  ayah: number;
}

export interface SvgSurahIndexEntry {
  number: number;
  pageNumber: number;
  ayahCount: number;
  nameEnglish: string;
}

interface RawPolyEntry {
  surahNumber: number;
  ayahNumber: number;
}

/** Fetch one page's SVG text; throws on any non-OK response. */
export async function fetchSvgPageText(
  mushaf: SvgMushafKey,
  page: number,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(svgPageUrl(mushaf, page), { signal });
  if (!res.ok) throw new Error(`SVG page ${mushaf} ${page}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Fetch one page's ayah list from its per-page JSON. Auxiliary only:
 * the rendered polygons are the authority for taps; a JSON failure
 * must never take down a page whose SVG loaded.
 */
export async function fetchSvgPageAyahs(
  mushaf: SvgMushafKey,
  page: number,
  signal?: AbortSignal,
): Promise<SvgPageAyah[]> {
  const res = await fetch(svgPageJsonUrl(mushaf, page), { signal });
  if (!res.ok) throw new Error(`SVG page JSON ${mushaf} ${page}: HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error(`SVG page JSON ${page}: not an array`);
  return (data as RawPolyEntry[])
    .filter(
      (e) =>
        typeof e.surahNumber === 'number' && typeof e.ayahNumber === 'number',
    )
    .map((e) => ({ surah: e.surahNumber, ayah: e.ayahNumber }));
}

const surahIndexPromises = new Map<SvgMushafKey, Promise<SvgSurahIndexEntry[]>>();

/** The 114-entry surah index of one mushaf (cached per session). */
export function loadSvgSurahIndex(mushaf: SvgMushafKey): Promise<SvgSurahIndexEntry[]> {
  const cached = surahIndexPromises.get(mushaf);
  if (cached) return cached;
  const p = fetch(svgSurahIndexUrl(mushaf))
    .then(async (res) => {
      if (!res.ok) throw new Error(`surah.json ${mushaf}: HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (!Array.isArray(data) || data.length < 114) {
        throw new Error(`surah.json ${mushaf}: unexpected shape`);
      }
      return (data as SvgSurahIndexEntry[]).slice(0, 114);
    })
    .catch((err: unknown) => {
      surahIndexPromises.delete(mushaf);
      throw err;
    });
  surahIndexPromises.set(mushaf, p);
  return p;
}

/**
 * Resolve a (surah, ayah) reference to its Hafs page via bounded
 * binary search over the per-page JSON files (at most 6 requests for
 * the whole mushaf). Returns null when the reference is not found.
 * The caller already has page boundaries for the views it renders;
 * this is the quran.ws reference resolver for taps/links that arrive
 * without a page.
 */
export async function svgPageOf(
  mushaf: SvgMushafKey,
  surah: number,
  ayah: number,
): Promise<number | null> {
  const surahs = await loadSvgSurahIndex(mushaf);
  if (surah < 1 || surah > 114) return null;
  let lo = surahs[surah - 1].pageNumber;
  let hi = surah < 114 ? surahs[surah].pageNumber : 604;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let entries: SvgPageAyah[];
    try {
      entries = await fetchSvgPageAyahs(mushaf, mid);
    } catch {
      return null;
    }
    if (entries.some((e) => e.surah === surah && e.ayah === ayah)) return mid;
    const below = entries.some(
      (e) => e.surah < surah || (e.surah === surah && e.ayah < ayah),
    );
    if (below) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * Parse fetched SVG text into a clean inline element: scripts,
 * foreign objects and event handlers are stripped before insertion.
 * Returns the <svg> element, or null when the text does not parse.
 */
export function parseSvgPage(text: string): SVGSVGElement | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const root = doc.querySelector('svg');
  if (!root) return null;
  root.querySelectorAll('script, foreignObject, object, embed, iframe, link, meta').forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name.startsWith('on') ||
        attr.name === 'href' ||
        attr.name === 'xlink:href'
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  root.setAttribute('style', 'width:100%;height:auto;display:block');
  return root as unknown as SVGSVGElement;
}

/**
 * Fit the mounted SVG to its ink (getBBox + 4% breathing room),
 * per the quran.ws reference. Runs a frame later because getBBox
 * needs layout; silently keeps the declared viewBox on any failure.
 */
export function fitSvgToInk(root: SVGSVGElement): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => {
    try {
      const b = (root as unknown as SVGGraphicsElement).getBBox();
      if (b.width > 0 && b.height > 0) {
        const p = Math.max(b.width, b.height) * 0.04;
        root.setAttribute(
          'viewBox',
          `${b.x - p} ${b.y - p} ${b.width + p * 2} ${b.height + p * 2}`,
        );
      }
    } catch {
      /* keep the declared viewBox */
    }
  });
}
