/**
 * HifzNassScroll: the nass display mode as scrolling mushaf pages
 * (2026-11-16, user order). One full page section per printed page
 * of the surah — surah-header frame, Basmalah as the SVG glyph,
 * coloured V4 glyph words, page footer — in one continuous scroll,
 * no page-flipping. Eye conceal, peek, grading and tap-to-practice
 * come free through the passed renderPageSection/renderLineWord.
 *
 * Each page section owns its loading state (its V2 chunk, its V4
 * glyph map, its per-page font) with lazy loading as it nears the
 * viewport (IntersectionObserver) + neighbour preload. A section
 * shows blank placeholder lines while its assets load and renders
 * Tanzil text only after genuine failure with retries exhausted.
 * When V2 is unavailable the parent keeps the old plain-text nass
 * instead of this component — never a half-built scroll.
 *
 * The first page is the page holding the surah's header: for the 18
 * spill surahs the header is the last line of the previous page, so
 * the range starts one page earlier (that page carries the previous
 * surah's tail as display-only words, exactly like flip mode on
 * that page).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  loadV2Page,
  v2PageAyahs,
  type V2MushafIndex,
  type V2Page,
} from '@/lib/quran-mushaf-v2';
import { loadV4PageGlyphs, type V4PageGlyphs } from '@/lib/quran-mushaf-v4';
import { ensureMushafFontFor, qcfV4Provider } from '@/lib/quran-mushaf-font';
import { buildV2PageRender } from '@/lib/hifz-page-render';
import { toArabicIndic } from '@/lib/quran-print-lines';
import type {
  HifzV4PageFont,
  RenderLine,
  WallWord,
} from '@/lib/hifz-study-types';

/** Bounded retries per page, so a genuinely missing file (404)
    cannot retry forever; a page change always re-attempts. */
const MAX_ASSET_RETRIES = 3;
const RETRY_DELAY_MS = 2500;

export type HifzNassScrollProps = {
  surah: number;
  /** 0-based first/last printed pages holding the surah (V2 index). */
  firstPage: number;
  lastPage: number;
  v2Index: V2MushafIndex;
  textsBySurah: Record<number, Record<number, string> | undefined>;
  wallAyahs: { ayah: number; words: WallWord[] }[];
  /** 0-based active page (the selected ayah's page): loads eagerly. */
  activePageIndex: number | null;
  loadingLabel: string;
  failedLabel: string;
  ariaLabel: string;
  renderPageSection: (
    pIdx: number,
    lines: RenderLine[],
    key: string,
    font?: HifzV4PageFont,
  ) => ReactNode;
};

export function HifzNassScroll(props: HifzNassScrollProps) {
  const {
    surah,
    firstPage,
    lastPage,
    v2Index,
    textsBySurah,
    wallAyahs,
    activePageIndex,
    loadingLabel,
    failedLabel,
    ariaLabel,
    renderPageSection,
  } = props;
  // The header page: for spill surahs the header is the last line of
  // the page before the ayah-1 page. Decided once from the first
  // page's chunk (promise-cached: the first section loads it too).
  // A failed chunk load keeps the ayah-1 page: no guessing.
  const [startPage, setStartPage] = useState<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadV2Page(firstPage + 1).then((chunk) => {
      if (cancelled) return;
      const hasHeader =
        chunk !== null && chunk.lines.some((line) => line.t === 'h' && line.s === surah);
      setStartPage(hasHeader || firstPage === 0 ? firstPage : firstPage - 1);
    });
    return () => {
      cancelled = true;
    };
  }, [firstPage, surah]);
  const pages = useMemo(() => {
    if (startPage === undefined) return null;
    const out: number[] = [];
    for (let p = startPage; p <= lastPage; p += 1) out.push(p);
    return out;
  }, [startPage, lastPage]);
  if (pages === null) {
    return (
      <div className="hifz-nass hifz-nass-scroll" dir="rtl" aria-label={ariaLabel}>
        <p className="hifz-line-loading">{loadingLabel}</p>
      </div>
    );
  }
  return (
    <div className="hifz-nass hifz-nass-scroll" dir="rtl" aria-label={ariaLabel}>
      {pages.map((pIdx) => (
        <HifzNassScrollPage
          key={pIdx}
          page={pIdx + 1}
          v2Index={v2Index}
          surah={surah}
          textsBySurah={textsBySurah}
          wallAyahs={wallAyahs}
          loadEagerly={activePageIndex === pIdx}
          preloadNext={pIdx < lastPage}
          loadingLabel={loadingLabel}
          failedLabel={failedLabel}
          renderPageSection={renderPageSection}
        />
      ))}
    </div>
  );
}

type HifzNassScrollPageProps = {
  /** 1-based printed page. */
  page: number;
  v2Index: V2MushafIndex;
  surah: number;
  textsBySurah: Record<number, Record<number, string> | undefined>;
  wallAyahs: { ayah: number; words: WallWord[] }[];
  loadEagerly: boolean;
  preloadNext: boolean;
  loadingLabel: string;
  failedLabel: string;
  renderPageSection: (
    pIdx: number,
    lines: RenderLine[],
    key: string,
    font?: HifzV4PageFont,
  ) => ReactNode;
};

function HifzNassScrollPage(props: HifzNassScrollPageProps) {
  const {
    page,
    v2Index,
    surah,
    textsBySurah,
    wallAyahs,
    loadEagerly,
    preloadNext,
    loadingLabel,
    failedLabel,
    renderPageSection,
  } = props;
  const rootRef = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(loadEagerly);
  const [v2Page, setV2Page] = useState<V2Page | null | undefined>(undefined);
  const [glyphs, setGlyphs] = useState<V4PageGlyphs | null | undefined>(undefined);
  const [fontLoaded, setFontLoaded] = useState<boolean | undefined>(undefined);
  const [retryTick, setRetryTick] = useState(0);
  const retryCountRef = useRef(0);
  const fontFamily = qcfV4Provider.familyForPage(page)?.family ?? null;

  // Lazy load: start only when the section nears the viewport (the
  // active page loads eagerly). No IntersectionObserver (old
  // browsers, SSR) means load at once — never a stuck blank page.
  useEffect(() => {
    if (loadEagerly) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadEagerly]);

  // One page's assets, with the same retry rule as flip mode: a slow
  // glyph map or font is retried while the section is on screen, so
  // it upgrades from text to glyphs once the load lands (the loaders
  // evict failed entries, and a background font load that lands
  // meanwhile is found ready).
  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    if (preloadNext && page < 604) {
      void loadV2Page(page + 1);
      void loadV4PageGlyphs(page + 1);
      void ensureMushafFontFor(qcfV4Provider, page + 1);
    }
    void loadV2Page(page).then((pg) => {
      if (!cancelled) setV2Page(pg);
    });
    void Promise.all([
      loadV4PageGlyphs(page),
      ensureMushafFontFor(qcfV4Provider, page),
    ]).then(([g, ok]) => {
      if (cancelled) return;
      setGlyphs(g);
      setFontLoaded(ok);
      if ((g === null || ok === false) && retryCountRef.current < MAX_ASSET_RETRIES) {
        retryCountRef.current += 1;
        retryTimer = window.setTimeout(() => {
          if (!cancelled) setRetryTick((t) => t + 1);
        }, RETRY_DELAY_MS);
      }
    });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [inView, page, preloadNext, retryTick]);

  const render = useMemo(() => {
    if (!v2Page) return null;
    return buildV2PageRender(v2Index, v2Page, surah, textsBySurah, wallAyahs, undefined, glyphs);
  }, [v2Index, v2Page, surah, textsBySurah, wallAyahs, glyphs]);

  // A null render with neighbour texts still missing is loading, not
  // failure: the parent loads them, and the render recovers. A null
  // render with every needed surah present is a genuine failure.
  const neededSurahs = useMemo(() => {
    if (!v2Page) return [];
    return [...new Set(v2PageAyahs(v2Page).map((r) => Number(r.split(':')[0])))];
  }, [v2Page]);
  const textsMissing = neededSurahs.some((s) => textsBySurah[s] === undefined);

  // Placeholder: the same page frame + footer as the real section,
  // so the scroll never jumps between states. Blank lines match the
  // real line count once the chunk is known (flip-mode pattern).
  if (v2Page === undefined || (render === null && textsMissing)) {
    return (
      <section
        ref={rootRef}
        className="hifz-line-page"
        aria-busy="true"
        aria-label={loadingLabel}
      >
        <p className="hifz-line-loading">{loadingLabel}</p>
        <p className="hifz-page-footer" aria-hidden="true">
          {toArabicIndic(page)}
        </p>
      </section>
    );
  }
  if (v2Page === null || render === null) {
    return (
      <section className="hifz-line-page" aria-label={failedLabel}>
        <p className="hifz-line-failed-note">{failedLabel}</p>
        <p className="hifz-page-footer" aria-hidden="true">
          {toArabicIndic(page)}
        </p>
      </section>
    );
  }
  if (glyphs === undefined || fontLoaded === undefined) {
    return (
      <section
        ref={rootRef}
        className="hifz-line-page"
        aria-busy="true"
        aria-label={loadingLabel}
      >
        {render.renderLines.map((line) => (
          <p
            key={line.key}
            className={
              line.kind === 'header'
                ? 'hifz-line hifz-line-header'
                : line.kind === 'basmala'
                  ? 'hifz-line hifz-line-basmala'
                  : 'hifz-line'
            }
            aria-hidden="true"
          >
            {'\u00a0'}
          </p>
        ))}
        <p className="hifz-page-footer" aria-hidden="true">
          {toArabicIndic(page)}
        </p>
      </section>
    );
  }
  // Settled (glyphs and font loaded, or failed after retries): the
  // real section in this page's own font family. A failed font or
  // map renders Tanzil text through the same code path as flip mode.
  return renderPageSection(page - 1, render.renderLines, `nass-scroll-p${page}`, {
    loaded: fontLoaded,
    family: fontFamily,
  });
}
