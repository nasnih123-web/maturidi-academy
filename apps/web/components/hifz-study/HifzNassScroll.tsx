/**
 * HifzNassScroll: the nass display mode as scrolling mushaf pages
 * (2026-11-16, user order; whole Quran 2026-11-21). One full page
 * section per printed page of the whole Quran — surah-header frame,
 * Basmalah as the SVG glyph, coloured V4 glyph words, page footer —
 * in one continuous scroll, no page-flipping. Eye conceal, peek,
 * grading and tap-to-practice come free through the passed
 * renderPageSection/renderLineWord.
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  loadV2Page,
  v2PageAyahs,
  type V2MushafIndex,
  type V2Page,
} from '@/lib/quran-mushaf-v2';
import { loadV4PageGlyphs, type V4PageGlyphs } from '@/lib/quran-mushaf-v4';
import {
  ensureMushafFontFor,
  protectMushafFontFamily,
  qcfV4Provider,
  unprotectMushafFontFamily,
} from '@/lib/quran-mushaf-font';
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
    sectionRef?: (el: HTMLElement | null) => void,
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Land on the active page (user 2026-11-21, whole-Quran nass):
  // the scroll spans 604 pages, so opening it must land on the
  // selected ayah's page, not page 1. Scrolls once per surah — on
  // mount and when the study surah changes (a cross-surah ««
  // advance lands on the new surah's page too); in-mode «« taps
  // within the same surah never move the view. The scroll runs on
  // mount, again after 800ms, and then polls until the neighbouring
  // pages settle: the page above the active one loads and expands
  // after landing, pushing the active page down — a single delayed
  // scroll lands two pages early when the font is slow (proven by
  // the harness: Baqarah 100 landed on p13, not p15). A manual
  // wheel, touch or scroll key stops all further correction.
  const lastScrolledSurahRef = useRef<number | null>(null);
  const userScrolledRef = useRef(false);
  useEffect(() => {
    const stop = () => {
      userScrolledRef.current = true;
    };
    const stopOnKey = (e: KeyboardEvent) => {
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'PageDown' ||
        e.key === 'PageUp' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === ' '
      ) {
        userScrolledRef.current = true;
      }
    };
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stopOnKey);
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stopOnKey);
    };
  }, []);
  useEffect(() => {
    if (pages === null || activePageIndex === null) return;
    if (lastScrolledSurahRef.current === surah) return;
    lastScrolledSurahRef.current = surah;
    const scrollToActive = () => {
      const el = rootRef.current;
      if (!el) return;
      const sections = el.querySelectorAll(':scope > section.hifz-line-page');
      const target = sections[activePageIndex - (pages[0] ?? 0)];
      target?.scrollIntoView({ behavior: 'auto', block: 'start' });
    };
    // Settled = the active page and the one above it both have their
    // final height: they render words (glyph or text), or the failed
    // note (a failed page never expands either). A placeholder has
    // neither, so while either is a placeholder its final height is
    // unknown and the scroll would land early.
    const sectionSettled = (section: Element | undefined) => {
      if (!section) return true; // no previous page (first page)
      return (
        section.querySelectorAll('.hifz-line-word').length > 0 ||
        section.querySelector('.hifz-line-failed-note') !== null
      );
    };
    const neighboursSettled = () => {
      const el = rootRef.current;
      if (!el) return false;
      const sections = el.querySelectorAll(':scope > section.hifz-line-page');
      const idx = activePageIndex - (pages[0] ?? 0);
      const active = sections[idx];
      if (!active) return false;
      return sectionSettled(active) && sectionSettled(sections[idx - 1]);
    };
    scrollToActive();
    const timer = window.setTimeout(scrollToActive, 800);
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (userScrolledRef.current || Date.now() - startedAt > 15000) {
        window.clearInterval(poll);
        return;
      }
      if (neighboursSettled()) {
        scrollToActive();
        window.clearInterval(poll);
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [pages, surah, activePageIndex]);
  if (pages === null) {
    return (
      <div className="hifz-nass hifz-nass-scroll" dir="rtl" aria-label={ariaLabel}>
        <p className="hifz-line-loading">{loadingLabel}</p>
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className="hifz-nass hifz-nass-scroll"
      dir="rtl"
      aria-label={ariaLabel}
    >
      {pages.map((pIdx) => (
        <HifzNassScrollPage
          key={pIdx}
          page={pIdx + 1}
          v2Index={v2Index}
          surah={surah}
          textsBySurah={textsBySurah}
          wallAyahs={wallAyahs}
          loadEagerly={activePageIndex === pIdx}
          // Proposal 5: only the ACTIVE page preloads its next page.
          // Before, every page except the last preloaded its next one,
          // so with the 600px observer margin ~3 in-view pages each
          // fired the next-page cascade and a dozen fonts loaded at
          // once, evicting the visible ones. The next page still loads
          // itself when it enters view; preloadNext only buys it a
          // head start from the page the user is actually reading.
          preloadNext={activePageIndex === pIdx && pIdx < lastPage}
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
    sectionRef?: (el: HTMLElement | null) => void,
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
  const [inView, setInView] = useState(loadEagerly);
  const [v2Page, setV2Page] = useState<V2Page | null | undefined>(undefined);
  const [glyphs, setGlyphs] = useState<V4PageGlyphs | null | undefined>(undefined);
  const [fontLoaded, setFontLoaded] = useState<boolean | undefined>(undefined);
  const [retryTick, setRetryTick] = useState(0);
  const retryCountRef = useRef(0);
  const fontFamily = qcfV4Provider.familyForPage(page)?.family ?? null;
  
  // A page's font is pinned while the page is in view (see
  // protectMushafFontFamily): the preload cascade loads a dozen
  // page fonts on opening nass, and without the pin a visible
  // page's font — the oldest in the cache — is evicted within
  // seconds, before the user even scrolls (user 2026-11-21: Fatiha
  // p.1, and Baqarah p.2 in the same screenshot — pinning only the
  // active page left the next visible page broken). The active page
  // is covered too: its inView starts true. When a page leaves
  // view, the pin is released and its font may be evicted; its
  // observer reloads it on re-entry.
  useEffect(() => {
    if (!inView || !fontFamily) return;
    protectMushafFontFamily(fontFamily);
    return () => unprotectMushafFontFamily(fontFamily);
  }, [inView, fontFamily]);
  
  // The section observer (lazy load + eviction recovery): attached
  // to the section itself — placeholder AND settled — via a callback
  // ref, so it survives the placeholder-to-settled swap (a plain
  // ref on the placeholder is lost when the settled section mounts,
  // and the observer would never fire again). The observer stays
  // alive and toggles inView both ways: when the section leaves the
  // margin and comes back, the asset effect below re-runs and
  // reloads the page font if the 12-family cap evicted it meanwhile.
  // Without this, a revisited page keeps rendering its glyphs in
  // the fallback font (wrong shapes) with a stale fontLoaded=true
  // — the whole-Quran scroll (user 2026-11-21) loads dozens of page
  // fonts, so eviction is the norm, not the exception. The active
  // page is observed too: it loads eagerly (inView starts true) but
  // its font is the oldest in the cache, so the preload cascade
  // evicts it within seconds of opening nass — with no observer it
  // could never come back, and a refresh replayed the same loss
  // (user 2026-11-21, Fatiha p.1). No IntersectionObserver
  // (old browsers, SSR) means load at once — never a stuck blank page.
  const ioRef = useRef<IntersectionObserver | null>(null);
  const observeSection = useCallback(
    (el: HTMLElement | null) => {
      if (ioRef.current) {
        ioRef.current.disconnect();
        ioRef.current = null;
      }
      if (!el) return;
      if (typeof IntersectionObserver === 'undefined') {
        setInView(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          setInView(entries.some((e) => e.isIntersecting));
        },
        { rootMargin: '600px 0px' },
      );
      io.observe(el);
      ioRef.current = io;
    },
    [],
  );

  // One page's assets, with the same retry rule as flip mode: a slow
  // glyph map or font is retried while the section is on screen, so
  // it upgrades from text to glyphs once the load lands (the loaders
  // evict failed entries, and a background font load that lands
  // meanwhile is found ready).
  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    let idleHandle: number | undefined;
    let idleTimer: number | undefined;
    if (preloadNext && page < 604) {
      // Proposal 6: the next page's assets load only when the browser
      // is idle (requestIdleCallback, 2s timeout; setTimeout fallback)
      // and with low fetch priority — so they never race the active
      // page's own font/glyphs. The font has no priority knob, so the
      // idle deferral is what keeps it off the critical path.
      const preloadNextPage = () => {
        if (cancelled) return;
        void loadV2Page(page + 1, { priority: 'low' });
        void loadV4PageGlyphs(page + 1, { priority: 'low' });
        void ensureMushafFontFor(qcfV4Provider, page + 1);
      };
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(preloadNextPage, {
          timeout: 2000,
        });
      } else {
        idleTimer = window.setTimeout(preloadNextPage, 0);
      }
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
      if (idleHandle !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
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
        ref={observeSection}
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
        ref={observeSection}
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
  // The observer ref rides along so the section stays observed
  // after settling (see observeSection above).
  return renderPageSection(
    page - 1,
    render.renderLines,
    `nass-scroll-p${page}`,
    {
      loaded: fontLoaded,
      family: fontFamily,
    },
    observeSection,
  );
}
