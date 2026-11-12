'use client';

/**
 * QuranMushafDKPage — one mushaf page rendered as REAL Unicode
 * text in the Digital Khatt variable font (Tarteel-parity step 1b,
 * agent-2 PR). Madani: Digital Khatt V2 on the KFGQPC V2 1421H
 * print layout (604×15). IndoPak: Digital Khatt IndoPak on the
 * 610×15 layout (step 2 wires that variant).
 *
 * Why this renderer exists: the QPC glyph renderers cannot justify
 * a line the way the printed mushaf does — their glyphs are frozen,
 * so all slack lands between words (see the step-1a solver and the
 * note above .mushaf-v2-line in globals.css). Digital Khatt is a
 * parametric font: its glyphs are regenerated at a requested width
 * (the `SCLX` variation axis), so a line is justified by elongating
 * INSIDE the words, exactly the print's mechanism, and the
 * inter-word spaces stay at their natural width.
 *
 * Justification here is a per-line solve, in the same spirit as
 * step 1a's Mihrab band: each text line's natural width is measured
 * (canvas, at the font's default SCLX 100), the page measure is the
 * frame's content width, and the line's SCLX is solved so the line
 * fills the measure, then corrected once against the rendered
 * width. SCLX is clamped to [88, 170]; a line that would need more
 * is centred at natural width instead of being over-stretched (the
 * print's own treatment for lines that cannot reach the measure).
 * Lines the layout marks centred are never solved. Spaces are
 * never touched.
 *
 * The justification engine the font's project ships for the web
 * (digitalkhatt-js) is the digitalkhatt.org website source, not a
 * consumable library (AGPL-3.0, no published package, depends on a
 * private HarfBuzz fork build), so it is not vendored; the SCLX
 * axis is the font's designed parametric mechanism and is what a
 * layout engine is meant to drive. This trade-off is recorded in
 * docs/quran/hifz-parity-agent2/SCOPE.md's step-1 notes and in the
 * PR.
 *
 * The Basmala line renders the page's own DK-script Basmala string
 * with the font's dedicated `basm` OpenType feature enabled
 * (HarfBuzz-verified: the feature expands the Basmala
 * calligraphically, +56% width on 1:1's text) — never as a foreign
 * font's plain text.
 *
 * Word entries keep the V2 component's interaction contract
 * (selection, hide/eye, word states) with DK keys — see
 * lib/quran-mushaf-dk.ts for the key convention. Ayah-end markers
 * are real text in this script (U+06DD + digits), rendered inline
 * where the layout places them — including at the START of a line
 * when the print puts them there.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { DKPage } from '@/lib/quran-mushaf-dk';
import { DK_PAGE_COUNTS, type DKMushafVariant } from '@/lib/quran-mushaf-dk';
import type { MushafWordViews } from '@/lib/quran-mushaf-v2';
import {
  digitalKhattProvider,
  useMushafFontReadyFor,
} from '@/lib/quran-mushaf-font';
import { toArabicIndic } from '@/lib/quran-print-lines';
import { colorizeTajweedWord } from '@/lib/quran-tajweed';
import type { MushafV2NavLabels } from './QuranMushafV2Page';

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const DEFAULT_NAV_LABELS: MushafV2NavLabels = {
  prev: 'صفحهٔ قبل',
  next: 'صفحهٔ بعد',
  jump: 'رفتن',
  jumpPlaceholder: 'شمارهٔ صفحه',
  zoomIn: 'بزرگ‌تر',
  zoomOut: 'کوچک‌تر',
  zoomReset: 'بازنشانی بزرگ‌نمایی',
  width: 'عرض صفحه',
};

/** SCLX fidelity band: below 88 the glyphs would look squeezed,
    above 170 over-stretched; outside it a line is centred. */
const SCLX_MIN = 88;
const SCLX_MAX = 170;

let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();

/** Natural advance of one word at 100px in the DK font (cached).
    Arabic words never shape across spaces, so a line's natural
    width is the sum of its words plus single spaces. */
function measureWord100(text: string): number {
  let w = measureCache.get(text);
  if (w !== undefined) return w;
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) return 0;
  measureCtx.font = '100px "DigitalKhatt V2"';
  w = measureCtx.measureText(text).width;
  measureCache.set(text, w);
  return w;
}

function renderTajweed(text: string) {
  return colorizeTajweedWord(text).map((seg, i) =>
    seg.color ? (
      <span key={i} className={`hifz-tj-${seg.color}`}>
        {seg.text}
      </span>
    ) : (
      seg.text
    ),
  );
}

export function QuranMushafDKPage({
  page,
  variant = 'madani',
  bismillahLabel,
  pageCurrent,
  juzCurrent,
  hizbCurrent,
  headerSurahTemplate,
  resolveSurahName,
  tajweed = false,
  hideText = false,
  wordViews,
  hiddenAyahs,
  selectedWord,
  selectedAyah,
  onSelectWord,
  onSelectAyah,
  onPlayLine,
  linesClickable = true,
  onNavigate,
  showNav = true,
  hideMeta = false,
  navLabels,
}: {
  page: DKPage;
  variant?: DKMushafVariant;
  /** Accessible name for the Basmala line (the locale string). */
  bismillahLabel: string;
  pageCurrent?: string;
  juzCurrent?: string;
  hizbCurrent?: string;
  headerSurahTemplate?: string;
  resolveSurahName?: (surahNumber: number) => string;
  tajweed?: boolean;
  hideText?: boolean;
  wordViews?: MushafWordViews;
  hiddenAyahs?: ReadonlySet<string>;
  selectedWord?: string | null;
  selectedAyah?: string | null;
  onSelectWord?: (key: string) => void;
  onSelectAyah?: (surah: number, ayah: number) => void;
  onPlayLine?: (surah: number, ayah: number) => void;
  linesClickable?: boolean;
  onNavigate?: (pageNumber: number) => void;
  showNav?: boolean;
  hideMeta?: boolean;
  navLabels?: Partial<MushafV2NavLabels>;
}) {
  const labels: MushafV2NavLabels = { ...DEFAULT_NAV_LABELS, ...navLabels };
  const pageCount = DK_PAGE_COUNTS[variant];
  // The hook settles on timeout too; solving additionally re-runs
  // when the FontFaceSet reports loading done, so a late-arriving
  // font re-solves with its own metrics.
  const fontSettled = useMushafFontReadyFor(digitalKhattProvider, 1);
  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState<'narrow' | 'standard' | 'wide'>('standard');
  const [jumpValue, setJumpValue] = useState('');
  const [failedHeaders, setFailedHeaders] = useState<ReadonlySet<number>>(new Set());
  const linesRef = useRef<HTMLDivElement | null>(null);

  const lastAyah = useMemo(() => {
    for (let i = page.lines.length - 1; i >= 0; i -= 1) {
      const line = page.lines[i];
      if (line.t === 'x' && line.words.length > 0) {
        const [s, a] = line.words[line.words.length - 1].k.split(':').map(Number);
        return { surah: s, ayah: a };
      }
    }
    return null;
  }, [page]);
  const headerSurah =
    lastAyah && resolveSurahName ? resolveSurahName(lastAyah.surah) : '';

  const meta = [
    (pageCurrent ?? 'صفحهٔ %n%').replace('%n%', toArabicIndic(page.n)),
    page.juz !== null
      ? (juzCurrent ?? 'جزء %n%').replace('%n%', toArabicIndic(page.juz))
      : null,
    page.hizb !== null
      ? (hizbCurrent ?? 'حزب %n%').replace('%n%', toArabicIndic(page.hizb))
      : null,
    headerSurah
      ? (headerSurahTemplate ?? '(سورهٔ %s%)').replace('%s%', headerSurah)
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  const wordSelectable = onSelectWord !== undefined;
  const lineIsButton = !wordSelectable && linesClickable && onPlayLine !== undefined;

  // ── Per-line SCLX justification solve (see the file header). ──
  useIsoLayoutEffect(() => {
    if (!fontSettled) return;
    const root = linesRef.current;
    if (!root) return;
    let cancelled = false;
    const solve = () => {
      if (cancelled) return;
      const els = root.querySelectorAll<HTMLElement>('[data-dk-textline]');
      if (!els.length) return;
      const space100 = measureWord100(' ');
      els.forEach((el) => {
        const li = Number(el.dataset.dkTextline);
        const line = page.lines[li];
        if (!line || line.t !== 'x') return;
        if (line.c) {
          // Data-centred lines are never solved; clear any stale
          // setting a previous page's solve left on this element.
          el.style.fontVariationSettings = '';
          return;
        }
        const fontPx = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (!fontPx) return;
        let natural100 = 0;
        line.words.forEach((w, wi) => {
          natural100 += measureWord100(w.x);
          if (wi < line.words.length - 1) natural100 += space100;
        });
        const target = el.clientWidth;
        const naturalPx = (natural100 / 100) * fontPx;
        if (!target || !naturalPx) return;
        let sclx = (100 * target) / naturalPx;
        if (sclx > SCLX_MAX) {
          el.style.fontVariationSettings = '';
          el.classList.add('mushaf-dk-line--centered');
          return;
        }
        el.classList.remove('mushaf-dk-line--centered');
        sclx = Math.max(SCLX_MIN, sclx);
        el.style.fontVariationSettings = `"SCLX" ${sclx.toFixed(1)}`;
        // One correction pass against the rendered width (the
        // parametric axis is near-linear, not exact).
        const rendered = el.scrollWidth;
        if (rendered > 0 && Math.abs(rendered - target) / target > 0.01) {
          const corrected = sclx * (target / rendered);
          if (corrected >= SCLX_MIN && corrected <= SCLX_MAX) {
            el.style.fontVariationSettings = `"SCLX" ${corrected.toFixed(1)}`;
          }
        }
      });
    };
    solve();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => solve());
      ro.observe(root);
    }
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    const onFonts = () => solve();
    fonts?.addEventListener?.('loadingdone', onFonts);
    return () => {
      cancelled = true;
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', onFonts);
    };
  }, [fontSettled, page]);

  const submitJump = () => {
    const n = Number(jumpValue);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount) {
      onNavigate?.(n);
      setJumpValue('');
    }
  };

  return (
    <div
      className={`mushaf-page mushaf-dk mushaf-dk--w-${width}${hideText ? ' mushaf-dk--hide-text' : ''}`}
      style={{ '--mushaf-dk-scale': String(scale) } as CSSProperties}
    >
      {hideMeta ? null : <p className="mushaf-page-meta">{meta}</p>}
      <div className="mushaf-frame mushaf-dk-frame">
        {!fontSettled ? (
          <div aria-busy="true" aria-label={meta}>
            {page.lines.map((line, i) => (
              <div key={i} className="mushaf-dk-line mushaf-dk-placeholder-line" aria-hidden="true">
                {'\u00a0'}
              </div>
            ))}
          </div>
        ) : (
          <div lang="ar" dir="rtl" ref={linesRef}>
            {page.lines.map((line, li) => {
              if (line.t === 'h') {
                const padded = String(line.s).padStart(3, '0');
                if (line.s !== 1 && !failedHeaders.has(line.s)) {
                  return (
                    <div key={li} className="mushaf-v2-surah-header">
                      <img
                        src={`/quran/surah-headers/surah-${padded}.svg`}
                        alt={line.x}
                        onError={() =>
                          setFailedHeaders((prev) => new Set(prev).add(line.s))
                        }
                      />
                    </div>
                  );
                }
                return (
                  <div key={li} className="mushaf-surah-ornament" lang="ar" dir="rtl">
                    {line.x}
                  </div>
                );
              }
              if (line.t === 'b') {
                return (
                  <p
                    key={li}
                    className="mushaf-dk-basmala"
                    lang="ar"
                    dir="rtl"
                    aria-label={bismillahLabel}
                  >
                    {page.basmala}
                  </p>
                );
              }
              const first = line.words[0];
              // Play target = the line's first REAL word (a leading
              // ayah-end marker belongs to the previous ayah).
              const firstReal = line.words.find((w) => !w.m) ?? first;
              const firstRef = firstReal
                ? firstReal.k.split(':').map(Number)
                : null;
              const lineContent = (
                <>
                  {line.words.map((word, wi) => {
                    const [ws, wa] = word.k.split(':').map(Number);
                    const view = wordViews?.[word.k];
                    const ayahHidden =
                      hiddenAyahs?.has(`${ws}:${wa}`) ?? false;
                    const hidden = hideText || ayahHidden || view?.hidden === true;
                    const state = view?.state ?? null;
                    const isSelectedWord = selectedWord === word.k;
                    const isSelectedAyah = selectedAyah === `${ws}:${wa}`;
                    if (word.m) {
                      return (
                        <span key={word.k}>
                          <span
                            className="mushaf-dk-marker"
                            data-qul-id={word.g}
                            aria-label={`${ws}:${wa}`}
                          >
                            {word.x}
                          </span>
                          {wi < line.words.length - 1 ? ' ' : ''}
                        </span>
                      );
                    }
                    const classes = [
                      'mushaf-dk-word',
                      hidden ? 'mushaf-dk-word--hidden' : '',
                      state ? `mushaf-dk-word--${state}` : '',
                      isSelectedWord ? 'is-selected' : '',
                      isSelectedAyah ? 'is-ayah-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const inner = tajweed ? renderTajweed(word.x) : word.x;
                    const wordEl = wordSelectable ? (
                      <button
                        key={word.k}
                        type="button"
                        data-word-key={word.k}
                        data-qul-id={word.g}
                        className={classes}
                        aria-hidden={hidden || undefined}
                        onClick={() => onSelectWord?.(word.k)}
                      >
                        {inner}
                      </button>
                    ) : (
                      <span
                        key={word.k}
                        data-word-key={word.k}
                        data-qul-id={word.g}
                        className={classes}
                        aria-hidden={hidden || undefined}
                      >
                        {inner}
                      </span>
                    );
                    return (
                      <span key={word.k}>
                        {wordEl}
                        {wi < line.words.length - 1 ? ' ' : ''}
                      </span>
                    );
                  })}
                </>
              );
              const lineCls = `mushaf-dk-line${line.c ? ' mushaf-dk-line--centered' : ''}`;
              if (lineIsButton && first && firstRef) {
                return (
                  <button
                    key={li}
                    type="button"
                    data-dk-textline={li}
                    className={`mushaf-line-btn ${lineCls}`}
                    onClick={() => onPlayLine?.(firstRef[0], firstRef[1])}
                    aria-label={`${firstRef[0]}:${firstRef[1]}`}
                  >
                    {lineContent}
                  </button>
                );
              }
              return (
                <div key={li} data-dk-textline={li} className={`mushaf-line ${lineCls}`}>
                  {lineContent}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {hideMeta ? null : (
        <p className="mushaf-page-meta mushaf-page-foot">
          {(pageCurrent ?? 'صفحهٔ %n%').replace('%n%', toArabicIndic(page.n))}
        </p>
      )}
      {showNav && onNavigate ? (
        <div className="mushaf-v2-nav" dir="rtl">
          <button
            type="button"
            disabled={page.n <= 1}
            onClick={() => onNavigate(page.n - 1)}
            aria-label={labels.prev}
          >
            {labels.prev}
          </button>
          <form
            className="mushaf-v2-jump"
            onSubmit={(e) => {
              e.preventDefault();
              submitJump();
            }}
          >
            <input
              type="number"
              min={1}
              max={pageCount}
              value={jumpValue}
              placeholder={labels.jumpPlaceholder}
              aria-label={labels.jumpPlaceholder}
              onChange={(e) => setJumpValue(e.target.value)}
            />
            <button type="submit">{labels.jump}</button>
          </form>
          <button
            type="button"
            disabled={page.n >= pageCount}
            onClick={() => onNavigate(page.n + 1)}
            aria-label={labels.next}
          >
            {labels.next}
          </button>
          <span className="mushaf-v2-zoom" role="group" aria-label={labels.zoomReset}>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.8, +(s - 0.1).toFixed(2)))}
              aria-label={labels.zoomOut}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setScale(1)}
              aria-label={labels.zoomReset}
            >
              {Math.round(scale * 100)}٪
            </button>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(1.6, +(s + 0.1).toFixed(2)))}
              aria-label={labels.zoomIn}
            >
              +
            </button>
            <button
              type="button"
              onClick={() =>
                setWidth((w) =>
                  w === 'narrow' ? 'standard' : w === 'standard' ? 'wide' : 'narrow',
                )
              }
              aria-label={labels.width}
            >
              {width === 'narrow' ? '▤' : width === 'standard' ? '▦' : '▧'}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
