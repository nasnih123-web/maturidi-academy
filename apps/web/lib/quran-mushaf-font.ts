/**
 * Mushaf font loading — per-page, on demand, via the FontFace API.
 *
 * The mechanism (not the asset): a MushafFontProvider maps a page
 * number to the font that renders it. The renderer asks for exactly
 * the pages it shows; fonts load lazily, are cached, and are evicted
 * oldest-first when the cache grows past MAX_LOADED_FAMILIES, so the
 * app never pays a heavy startup load and never holds all fonts in
 * memory at once.
 *
 * The DEFAULT provider serves the real per-page QPC V2 fonts
 * (QCF2001..QCF2604, one family per page — WOFF2 files placed at
 * public/fonts/qcf-v2/p{NNN}.woff2 once the EPERM block clears;
 * until they land, the page falls back to the fallback stack, never
 * a wrong font). The previous default — the licensed KFGQPC
 * Uthmanic font (one family for every page, the font already in the
 * repo at public/fonts/UthmanicHafs-v-3.0.woff2) — stays available
 * as `kfgqpcHafsProvider` for the Tanzil-text fallback path.
 *
 * GATE OPENED 2026-11-07 (Phase-1 hifz fix, coordinator decision):
 * the per-page provider IS registered now. The user explicitly
 * directed use of these exact Drive-procured QPC V2 resources, and
 * the licence determination is recorded in writing in
 * THIRD_PARTY_NOTICES.md ("QPC V2 per-page fonts … — Phase-1 hifz
 * fix"): the KFGQPC terms allow copying, distribution and usage
 * free of charge, while the Font EULA forbids sale, modification,
 * format conversion, subsetting and reverse engineering — the files
 * are used unmodified. The glyph script + 15-line layout data
 * remain licence-UNCLEAR (recorded as such, not as licensed). The
 * Tarteel ToS provenance conflict is surfaced in the same record;
 * the user's explicit direction governs the wiring.
 *
 * VERIFIED 2026-11-07 (wave 2a, section 2 — full record in
 * docs/quran/hifz-completion-qpc-v2-font-path-a.md): the licensed
 * alternative is Quran Foundation Path A — QCF V2 fonts from the
 * official QF CDN (verses.quran.foundation/fonts/quran/hafs/v2/…)
 * may be cached/bundled ONLY with an active Developer Console
 * account + QF attribution, only as an integrated part of the app,
 * and NEVER as a prepackaged build-time bundle (Developer Terms
 * 2026-10-11, §3.1). Offline QF content must come through Content
 * Sync (mushafs:1) with a next sync at least every 7 days. AND the
 * mushafs:1 snapshot has NO code_v2 field in the official SDK's
 * typed contract (MushafWordSnapshotRecord: text/page/line/position
 * only) — so glyph codes need a live Content API fetch (1-week
 * storage rule) or a verified reading of the snapshot `text` field
 * once an account exists. NO such account exists in this project
 * (quran.qf_client_id / quran.qf_client_secret are empty config
 * slots; provider implemented: false, config_only: true), and no
 * account was created. DO NOT register a QF-CDN-backed provider
 * until: (1) the user creates the Developer Console account and
 * fills the CRM QF credentials, (2) QF attribution is in the app,
 * (3) the glyph source (snapshot `text` vs live code_v2) is
 * verified. This Path-A gate is SEPARATE from the Drive-procured
 * `qcf-v2` provider above, which is open per the gate note.
 */
import { useEffect, useState } from 'react';
import { v4TarteelPaletteRule } from './quran-mushaf-v4';

export interface MushafFontSource {
  /** CSS font-family name (must be unique per page font). */
  family: string;
  /** Full FontFace source list, e.g.
      `url("/fonts/x.woff2") format("woff2"), url("/fonts/x.ttf") format("truetype")`. */
  sources: string;
  /** Optional `@font-palette-values` rule text for this family,
      injected into the document next to the FontFace (see
      injectFontPaletteRule). Only the V4 provider sets it. */
  paletteRule?: string;
}

export interface MushafFontProvider {
  /** Stable id for diagnostics (e.g. "kfgqpc-hafs", "qcf-v2"). */
  id: string;
  /** The font for one mushaf page, or null when the provider has none. */
  familyForPage(page: number): MushafFontSource | null;
}

/** The licensed KFGQPC Uthmanic font — one family for all 604 pages. */
export const KFGQPC_HAFS_FONT: MushafFontSource = {
  family: 'KFGQPC HAFS Uthmanic Script',
  sources:
    'url("/fonts/UthmanicHafs-v-3.0.woff2") format("woff2"), ' +
    'url("/fonts/UthmanicHafs-v-3.0.ttf") format("truetype")',
};

export const kfgqpcHafsProvider: MushafFontProvider = {
  id: 'kfgqpc-hafs',
  familyForPage: () => KFGQPC_HAFS_FONT,
};

/** The real per-page QPC V2 fonts — one family per mushaf page.
    Family rule (verified 2026-11-07 for all 604 files): page N
    uses family `QCF2` + N zero-padded to 3 digits (p1 → QCF2001,
    p293 → QCF2293, p604 → QCF2604). WOFF2 only for web; each file
    holds ONLY its page's glyphs (page-relative PUA codes from
    U+FC41), so a page's glyph text must never render in another
    page's family. Files: public/fonts/qcf-v2/p{NNN}.woff2. */
export const qcfV2Provider: MushafFontProvider = {
  id: 'qcf-v2',
  familyForPage: (page) => ({
    family: `QCF2${String(page).padStart(3, '0')}`,
    sources: `url("/fonts/qcf-v2/p${page}.woff2") format("woff2")`,
  }),
};

/** The per-page QPC V4 Tajweed fonts (COLR) — one family per mushaf
    page. Family rule (verified 2026-11-08 by fontTools for p1/p120/
    p293/p604): page N uses family `QCF4` + N zero-padded to 3 digits
    + `_COLOR` (p293 → QCF4293_COLOR). WOFF2 only for web; each file
    holds ONLY its page's glyphs (page-relative PUA codes), so a
    page's glyph text must never render in another page's family.
    Files: public/fonts/qcf-v4-tajweed/p{NNN}.woff2. The COLR palette
    is the tajweed palette itself — base palette 0 with the Wave-1
    Tarteel-approx `override-colors` (see v4TarteelPaletteRule in
    quran-mushaf-v4.ts: the reference shot, not the printed palette,
    governs the visual). The override rule is injected per family by
    the loader (injectFontPaletteRule); glyph spans select it with
    `font-palette: --quran-v4-tarteel` (globals.css).
    This provider is NEVER registered globally (see below): the
    reader depends on the V2 singleton, so V4 loads through
    ensureMushafFontFor / useMushafFontReadyFor with its OWN loaded
    map and its own 8-family cap instead. */
export const qcfV4Provider: MushafFontProvider = {
  id: 'qcf-v4',
  familyForPage: (page) => {
    const family = `QCF4${String(page).padStart(3, '0')}_COLOR`;
    return {
      family,
      sources: `url("/fonts/qcf-v4-tajweed/p${page}.woff2") format("woff2")`,
      paletteRule: v4TarteelPaletteRule(family),
    };
  },
};

let provider: MushafFontProvider = qcfV2Provider;

/** Replace the font provider (e.g. with licensed per-page fonts).
    The renderer never imports a concrete font list — it only asks
    this registry. */
export function registerMushafFontProvider(p: MushafFontProvider): void {
  provider = p;
}

export function getMushafFontProvider(): MushafFontProvider {
  return provider;
}

/** Max font families kept loaded at once (oldest-first eviction;
    no family is pinned — every page has its own family now). */
export const MAX_LOADED_FAMILIES = 8;

/** Families already loaded (or loading), oldest-first for eviction. */
const loaded = new Map<string, { face: FontFace | null; promise: Promise<boolean> }>();

function isFontReady(family: string): boolean {
  // NEVER probe with document.fonts.check(): it returns true
  // whenever ANY font in the stack can render the probe codepoint,
  // and U+FC41 (Arabic Presentation Forms-A) is already covered by
  // the loaded KFGQPC Uthmanic font — so the check passed for the
  // QCF family even though its FontFace was never created, the WOFF2
  // was never fetched, and the glyph words rendered in the fallback
  // font (wrong shapes, not the printed page). Test the family
  // itself instead: a FontFace with exactly this family name must be
  // present and loaded in the document's FontFaceSet.
  try {
    return (
      typeof document !== 'undefined' &&
      [...document.fonts].some((f) => f.family === family && f.status === 'loaded')
    );
  } catch {
    return false;
  }
}

/**
 * Ensure the font for one page is loaded. Resolves true when the
 * family is usable (already loaded, or freshly loaded), false on
 * timeout/error — the caller then renders with the fallback stack
 * instead of blocking. Never throws. Server-side (no document)
 * resolves true immediately: the server renders with the fallback
 * stack and the client upgrades on hydration.
 */
export function ensureMushafFont(page: number, timeoutMs = 1500): Promise<boolean> {
  return ensureMushafFontWith(provider, loaded, page, timeoutMs);
}

/**
 * Provider-parameterized font load: same contract as
 * ensureMushafFont, but for an explicitly passed provider with its
 * OWN loaded map and its own 8-family cap — so the hifz page can
 * load V4 fonts without touching the reader's V2 singleton. The
 * `loaded` map above stays the V2/global one; V4 families live in
 * `loadedV4` and never evict (or get evicted by) V2 families.
 */
export function ensureMushafFontFor(
  providerArg: MushafFontProvider,
  page: number,
  timeoutMs = 1500,
): Promise<boolean> {
  return ensureMushafFontWith(providerArg, loadedV4, page, timeoutMs);
}

/** Families already loaded (or loading) by the V4 provider,
    oldest-first for eviction — separate from the V2 `loaded` map. */
const loadedV4 = new Map<string, { face: FontFace | null; promise: Promise<boolean> }>();

/** Families whose `@font-palette-values` rule is already in the
    document (once per family for the page lifetime — an evicted
    family's rule stays and still applies if the font reloads). */
const injectedPalettes = new Set<string>();

/**
 * Inject one `@font-palette-values` rule for a family (a <style>
 * tag in document.head, tagged `data-font-palette`). No-op on the
 * server, on a second call for the same family, or when the rule
 * text is empty. Never throws. Pure except for the DOM write.
 */
export function injectFontPaletteRule(family: string, cssText: string): void {
  if (typeof document === 'undefined' || !cssText || injectedPalettes.has(family)) return;
  injectedPalettes.add(family);
  try {
    const el = document.createElement('style');
    el.setAttribute('data-font-palette', family);
    el.textContent = cssText;
    document.head.appendChild(el);
  } catch {
    /* non-DOM environment */
  }
}

function ensureMushafFontWith(
  providerArg: MushafFontProvider,
  cache: Map<string, { face: FontFace | null; promise: Promise<boolean> }>,
  page: number,
  timeoutMs = 1500,
): Promise<boolean> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    return Promise.resolve(true);
  }
  const source = providerArg.familyForPage(page);
  if (!source) return Promise.resolve(true);
  // The palette rule must exist before the first glyph paints, so
  // inject it with the FontFace, not after the load resolves.
  if (source.paletteRule) injectFontPaletteRule(source.family, source.paletteRule);
  const existing = cache.get(source.family);
  if (existing) return existing.promise;
  if (isFontReady(source.family)) {
    const done = Promise.resolve(true);
    cache.set(source.family, { face: null, promise: done });
    return done;
  }
  let face: FontFace;
  try {
    face = new FontFace(source.family, source.sources, { display: 'swap' });
  } catch {
    return Promise.resolve(false);
  }
  const promise: Promise<boolean> = Promise.race([
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        return true;
      })
      .catch(() => false),
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  cache.set(source.family, { face, promise });
  // Evict oldest families past the cap. No family is pinned: with
  // per-page fonts every page has its own family, so the oldest
  // loaded family goes first (an evicted page's font reloads on
  // demand when the page is shown again).
  if (cache.size > MAX_LOADED_FAMILIES) {
    for (const [family, entry] of cache) {
      if (cache.size <= MAX_LOADED_FAMILIES) break;
      try {
        if (entry.face) document.fonts.delete(entry.face);
      } catch {
        /* already gone */
      }
      cache.delete(family);
    }
  }
  return promise;
}

/** Number of families currently tracked (test/diagnostics hook). */
export function loadedMushafFontCount(): number {
  return loaded.size;
}

/** Number of V4 families currently tracked (test/diagnostics hook). */
export function loadedMushafV4FontCount(): number {
  return loadedV4.size;
}

/**
 * React hook: true once the page's font is ready (or the load timed
 * out / failed, so the page renders with the fallback stack instead
 * of waiting forever). While false, the renderer shows blank
 * placeholder lines of the same count and line-height, so the page
 * never shifts layout when the font arrives.
 */
export function useMushafFontReady(page: number): boolean {
  const [ready, setReady] = useState<boolean>(
    () => typeof document === 'undefined' || isFontReady(provider.familyForPage(page)?.family ?? ''),
  );
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    // Settles true on success AND on timeout/failure: the page then
    // renders with the fallback stack instead of waiting forever.
    ensureMushafFont(page).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);
  return ready;
}

/**
 * Provider-parameterized version of useMushafFontReady, for the V4
 * provider: same settle-true-on-timeout contract, but the load goes
 * through ensureMushafFontFor (own cache, own cap) and never touches
 * the global provider. NOTE: this hook settling true does NOT prove
 * the font actually loaded (timeout also settles it) — callers that
 * must only paint glyphs in a truly loaded font should also await
 * ensureMushafFontFor's boolean.
 */
export function useMushafFontReadyFor(providerArg: MushafFontProvider, page: number): boolean {
  const [ready, setReady] = useState<boolean>(
    () =>
      typeof document === 'undefined' ||
      isFontReady(providerArg.familyForPage(page)?.family ?? ''),
  );
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    ensureMushafFontFor(providerArg, page).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [providerArg, page]);
  return ready;
}
