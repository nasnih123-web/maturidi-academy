'use client';

/**
 * QuranSvgPage — one REAL printed Hafs page (round 6).
 *
 * Fetches the page's SVG from quran-ws/quran-svg (raw.githubusercontent
 * .com, open CORS), parses + sanitizes it, inlines it (never <img>)
 * and fits it to its ink with getBBox. Tapping an ayah polygon reads
 * its `surah`/`ayah` attributes (never the global id) and reports the
 * reference to the parent, which runs the existing ayah actions
 * (highlight, audio, bookmark, translation/tafsir below in ayah mode).
 *
 * Highlight uses the site's gold highlight language: fill #D6AD64 at
 * 0.35 opacity on the selected polygon, 0 elsewhere — never fill:none,
 * which would silently stop the taps (visiblePainted).
 *
 * Failure is not a dead page: on any fetch/parse failure the component
 * reports via onFailed and renders nothing, and the parent renders the
 * existing exact-line text page for the same page number, plus a plain
 * note saying the printed page was unavailable.
 */
import { useEffect, useRef, useState } from 'react';
import {
  fetchSvgPageAyahs,
  fetchSvgPageText,
  fitSvgToInk,
  parseSvgPage,
  type SvgMushafKey,
  type SvgPageAyah,
} from '@/lib/quran-svg-page';

const HIGHLIGHT_FILL = '#D6AD64';
const HIGHLIGHT_OPACITY = '0.35';

const svgTextCache = new Map<string, string>();

export function QuranSvgPage({
  mushaf,
  pageNumber,
  highlightKey,
  onSelectAyah,
  onFailed,
  onAyahs,
}: {
  /** The mushaf key: the data folder AND the numbering of every tap. */
  mushaf: SvgMushafKey;
  pageNumber: number;
  /** `${surah}:${ayah}` of the ayah to gold-highlight, or null. */
  highlightKey: string | null;
  /** Tap on a polygon: (surah, ayah) in THIS mushaf's numbering. */
  onSelectAyah: (surah: number, ayah: number) => void;
  /** Called once when this page cannot be shown as SVG. */
  onFailed: () => void;
  /** The page's ayah list from its per-page JSON (header + panels). */
  onAyahs?: (ayahs: SvgPageAyah[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const failedRef = useRef(false);
  const prevHighlightRef = useRef<SVGPathElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [ayahs, setAyahs] = useState<SvgPageAyah[] | null>(null);

  // Mount the page: fetch SVG text (cached per mushaf+page), parse, insert.
  useEffect(() => {
    failedRef.current = false;
    setStatus('loading');
    setAyahs(null);
    svgRef.current = null;
    const host = hostRef.current;
    if (host) host.innerHTML = '';
    let cancelled = false;
    const ctrl = new AbortController();
    const cacheKey = `${mushaf}:${pageNumber}`;
    const cached = svgTextCache.get(cacheKey);
    const textPromise = cached
      ? Promise.resolve(cached)
      : fetchSvgPageText(mushaf, pageNumber, ctrl.signal).then((t) => {
          svgTextCache.set(cacheKey, t);
          return t;
        });
    textPromise
      .then((text) => {
        if (cancelled) return;
        const root = parseSvgPage(text);
        if (!root) throw new Error('SVG parse failed');
        if (host) {
          host.innerHTML = '';
          host.appendChild(root);
        }
        svgRef.current = root;
        // Glyph groups must not eat taps (Hafs polygons sit on top,
        // but this is what keeps the other riwayas working too).
        root.querySelectorAll('#content, #ayah_markers').forEach((g) => {
          (g as SVGElement).style.pointerEvents = 'none';
        });
        root.querySelectorAll('.ayahPolygon').forEach((p) => {
          (p as SVGElement).style.cursor = 'pointer';
        });
        fitSvgToInk(root);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        failedRef.current = true;
        setStatus('failed');
        onFailed();
      });
    // The per-page JSON is the page's ayah list (aria label + count
    // + parent header). Auxiliary: its failure never takes down a
    // loaded SVG page.
    fetchSvgPageAyahs(mushaf, pageNumber, ctrl.signal)
      .then((list) => {
        if (cancelled) return;
        setAyahs(list);
        onAyahs?.(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // onFailed/onAyahs are stable parent callbacks in practice;
    // mushaf + pageNumber are the dependencies that re-run the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mushaf, pageNumber]);

  // Gold highlight: exactly one polygon lit, the previous one cleared.
  useEffect(() => {
    const prev = prevHighlightRef.current;
    if (prev) {
      prev.removeAttribute('fill');
      prev.setAttribute('fill-opacity', '0');
      prevHighlightRef.current = null;
    }
    if (!highlightKey || status !== 'ready') return;
    const [s, a] = highlightKey.split(':').map(Number);
    const root = svgRef.current;
    if (!root) return;
    const match = root.querySelector(
      `.ayahPolygon[surah="${s}"][ayah="${a}"]`,
    ) as SVGPathElement | null;
    if (match) {
      match.setAttribute('fill', HIGHLIGHT_FILL);
      match.setAttribute('fill-opacity', HIGHLIGHT_OPACITY);
      prevHighlightRef.current = match;
    }
  }, [highlightKey, status, mushaf, pageNumber]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as Element | null;
    const poly = target?.closest?.('.ayahPolygon') as Element | null;
    if (!poly) return;
    const surah = Number(poly.getAttribute('surah'));
    const ayah = Number(poly.getAttribute('ayah'));
    if (Number.isFinite(surah) && Number.isFinite(ayah) && surah >= 1 && ayah >= 1) {
      onSelectAyah(surah, ayah);
    }
  };

  if (status === 'failed') return null;
  return (
    <div
      ref={hostRef}
      className="quran-svg-page"
      dir="ltr"
      role="img"
      aria-label={
        ayahs
          ? `Printed page ${pageNumber} (${mushaf}), ${ayahs.length} ayahs`
          : `Printed page ${pageNumber} (${mushaf})`
      }
      onClick={handleClick}
    />
  );
}
