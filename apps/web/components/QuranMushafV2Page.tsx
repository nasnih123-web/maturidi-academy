'use client';

/**
 * QuranMushafV2Page — ONE real Madani (QPC V2, 1421H) mushaf page,
 * rendered word-by-word from public/quran-mushaf-v2.json.
 *
 * Phase-1 hifz fix (2026-11-07): when the expansion ran in glyph
 * mode (expansion.glyph === true), the words are the real QPC V2
 * glyph strings rendered in the CURRENT page's QCF2NNN family
 * (per-page font via the qcf-v2 provider), solid black like the
 * print — tajweed colours are NEVER applied to PUA glyph text
 * (colorizeTajweedWord cannot work on it). When the glyph map was
 * unavailable, the words fall back to licensed Tanzil text in the
 * licensed KFGQPC Uthmanic font, with tajweed colours where the
 * caller asked for them. The layout (15 lines, line breaks, word
 * order and positions) is V2-exact in both modes; the ayah-end
 * marker stays the painted V2Rosette until visual rendering proves
 * the ayah number sits inside the marker glyph. Surah headers use
 * the licensed CC BY 4.0 header SVGs (public/quran/surah-headers/);
 * surah 1 has no SVG in that set, so it falls back to the existing
 * code-drawn ornament with the surah name. The Basmalah line still
 * renders the Tanzil Basmalah text (the layout gives the 'b' line
 * no segments, so no glyph ids exist for it).
 *
 * Phase 4 hooks (built here, behaviours in Phase 4): per-word
 * reveal/hide and colour states via `wordViews`, ayah visibility
 * via `hiddenAyahs`, word/ayah selection via onSelectWord /
 * onSelectAyah. The component never grades and never records.
 *
 * Font loading is gated: until the page font is ready (or the load
 * times out) the frame shows blank placeholder lines of the same
 * count and line-height, so the page never shifts layout when the
 * font arrives. Zoom and page width are local controls on the page.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import type { V2Expansion, V2Page, MushafWordViews } from '@/lib/quran-mushaf-v2';
import { getMushafFontProvider, useMushafFontReady } from '@/lib/quran-mushaf-font';
import { toArabicIndic } from '@/lib/quran-print-lines';
import { colorizeTajweedWord } from '@/lib/quran-tajweed';

export interface MushafV2NavLabels {
  prev: string;
  next: string;
  jump: string;
  jumpPlaceholder: string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  width: string;
}

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

/** Ayah-end rosette: thin dark double ring with the ayah number
    inside and eight small teeth around the outer ring (the printed
    mushaf / Tarteel manner — no fill, no gold, no top diamond).
    Reader rebuild 2026-11-08, area 2. */
function V2Rosette({ n, label }: { n: string; label?: string }) {
  return (
    <span className="mushaf-v2-rosette" aria-label={label ?? n}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="14" />
        <circle cx="20" cy="20" r="10" />
        <circle cx="35" cy="20" r="1.3" />
        <circle cx="30.6" cy="30.6" r="1.3" />
        <circle cx="20" cy="35" r="1.3" />
        <circle cx="9.4" cy="30.6" r="1.3" />
        <circle cx="5" cy="20" r="1.3" />
        <circle cx="9.4" cy="9.4" r="1.3" />
        <circle cx="20" cy="5" r="1.3" />
        <circle cx="30.6" cy="9.4" r="1.3" />
        <text x="20" y="20" textAnchor="middle" dominantBaseline="central">
          {n}
        </text>
      </svg>
    </span>
  );
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

export function QuranMushafV2Page({
  page,
  expansion,
  bismillah,
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
  expansionFailedNote,
}: {
  page: V2Page;
  /** Strict expansion of this page (see expandV2Page). When !ok the
      component shows a note and the caller falls back to the old
      exact-line rendering — never a wrong page. */
  expansion: V2Expansion;
  bismillah: string;
  pageCurrent?: string;
  juzCurrent?: string;
  hizbCurrent?: string;
  headerSurahTemplate?: string;
  resolveSurahName?: (surahNumber: number) => string;
  /** Tajweed letter colours (study page: true; reader: false). */
  tajweed?: boolean;
  /** Reader rebuild (2026-11-08, area 2): hide the mushaf text
      for hifz (eye toggle in the reader bottom bar, state
      `hideText` in QuranReader, threaded via QuranMushafPage).
      When true, every word renders `visibility: hidden` (layout
      preserved — same line count, tops and heights), while the
      surah header, Basmalah and ayah rosettes stay visible and
      each text line gets a faint guide rule (Tarteel p582 manner).
      Toggling back restores the text. */
  hideText?: boolean;
  /** Phase 4 hook: per-word hidden/state, keyed "surah:ayah:word". */
  wordViews?: MushafWordViews;
  /** Phase 4 hook: ayahs to hide entirely ("surah:ayah"). */
  hiddenAyahs?: ReadonlySet<string>;
  /** "surah:ayah:word" of the selected word, or null. */
  selectedWord?: string | null;
  /** "surah:ayah" of the selected ayah, or null. */
  selectedAyah?: string | null;
  onSelectWord?: (key: string) => void;
  onSelectAyah?: (surah: number, ayah: number) => void;
  /** Play from a line's first verse (line-tap). */
  onPlayLine?: (surah: number, ayah: number) => void;
  linesClickable?: boolean;
  onNavigate?: (pageNumber: number) => void;
  showNav?: boolean;
  hideMeta?: boolean;
  navLabels?: Partial<MushafV2NavLabels>;
  expansionFailedNote?: string;
}) {
  const labels: MushafV2NavLabels = { ...DEFAULT_NAV_LABELS, ...navLabels };
  const fontReady = useMushafFontReady(page.n);
  // Glyph mode: this page's own QCF2NNN family. Glyph codes are
  // page-relative — a page's glyph string must never render in
  // another page's family. In Tanzil fallback mode this is null and
  // the CSS KFGQPC stack applies instead.
  const pageFontFamily = expansion.glyph
    ? (getMushafFontProvider().familyForPage(page.n)?.family ?? null)
    : null;
  // Tajweed letter colours only exist for readable Arabic text.
  // In glyph mode the words are PUA glyph strings rendered solid
  // black (the printed-mushaf look); renderTajweed is never called
  // on them, and no tajweed mapping is invented.
  const useTajweed = tajweed && !expansion.glyph;
  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState<'narrow' | 'standard' | 'wide'>('standard');
  const [jumpValue, setJumpValue] = useState('');
  const [failedHeaders, setFailedHeaders] = useState<ReadonlySet<number>>(new Set());

  const lastAyah = useMemo(() => {
    for (let i = page.lines.length - 1; i >= 0; i -= 1) {
      const line = page.lines[i];
      if (line.t === 'x' && line.seg.length > 0) {
        const seg = line.seg[line.seg.length - 1];
        return { surah: seg.s, ayah: seg.a };
      }
    }
    return null;
  }, [page]);
  const headerSurah =
    lastAyah && resolveSurahName ? resolveSurahName(lastAyah.surah) : '';

  const meta = [
    (pageCurrent ?? 'صفحهٔ %n%').replace('%n%', toArabicIndic(page.n)),
    page.juz !== null ? (juzCurrent ?? 'جزء %n%').replace('%n%', toArabicIndic(page.juz)) : null,
    page.hizb !== null ? (hizbCurrent ?? 'حزب %n%').replace('%n%', toArabicIndic(page.hizb)) : null,
    headerSurah
      ? (headerSurahTemplate ?? '(سورهٔ %s%)').replace('%s%', headerSurah)
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  // Word selection and line play cannot both own the click: when a
  // word-selection handler is present, words are buttons and lines
  // are plain divs; otherwise the whole line is the play button
  // (the reader's long-standing line-tap behaviour).
  const wordSelectable = onSelectWord !== undefined;
  const lineIsButton = !wordSelectable && linesClickable && onPlayLine !== undefined;

  const submitJump = () => {
    const n = Number(jumpValue);
    if (Number.isInteger(n) && n >= 1 && n <= 604) {
      onNavigate?.(n);
      setJumpValue('');
    }
  };

  return (
    <div
      className={`mushaf-page mushaf-v2 mushaf-v2--w-${width}${expansion.glyph ? ' mushaf-v2--glyph' : ''}${hideText ? ' mushaf-v2--hide-text' : ''}`}
      style={
        {
          '--mushaf-v2-scale': String(scale),
          ...(pageFontFamily ? { '--mushaf-v2-page-font': `"${pageFontFamily}"` } : {}),
        } as CSSProperties
      }
    >
      {hideMeta ? null : <p className="mushaf-page-meta">{meta}</p>}
      <div className="mushaf-frame mushaf-v2-frame">
        {!expansion.ok ? (
          <p className="quran-svg-fallback-note" role="note">
            {expansionFailedNote ?? 'متن این صفحه بارگذاری نشد.'}
          </p>
        ) : !fontReady ? (
          <div aria-busy="true" aria-label={meta}>
            {page.lines.map((line, i) => (
              <div
                key={i}
                className="mushaf-v2-line mushaf-v2-placeholder-line"
                aria-hidden="true"
              >
                {'\u00a0'}
              </div>
            ))}
          </div>
        ) : (
          <div lang="ar" dir="rtl">
            {expansion.lines.map((line, li) => {
              if (line.kind === 'header') {
                const padded = String(line.surah).padStart(3, '0');
                if (line.surah !== 1 && !failedHeaders.has(line.surah)) {
                  return (
                    <div key={li} className="mushaf-v2-surah-header">
                      <img
                        src={`/quran/surah-headers/surah-${padded}.svg`}
                        alt={line.name}
                        onError={() =>
                          setFailedHeaders((prev) => new Set(prev).add(line.surah))
                        }
                      />
                    </div>
                  );
                }
                return (
                  <div key={li} className="mushaf-surah-ornament" lang="ar" dir="rtl">
                    {line.name}
                  </div>
                );
              }
              if (line.kind === 'basmala') {
                return (
                  <p key={li} className="mushaf-bismillah" lang="ar" dir="rtl">
                    {bismillah}
                  </p>
                );
              }
              const first = line.words[0];
              const lineContent = (
                <>
                  {line.leadAyah !== null ? (
                    <V2Rosette n={toArabicIndic(line.leadAyah)} />
                  ) : null}
                  {line.words.map((word, wi) => {
                    const view = wordViews?.[word.key];
                    const ayahHidden = hiddenAyahs?.has(`${word.surah}:${word.ayah}`) ?? false;
                    // hideText hides EVERY word (visibility keeps its
                    // slot, so line breaks and rosette positions do
                    // not move); the rosette is a sibling and stays.
                    const hidden = hideText || ayahHidden || view?.hidden === true;
                    const state = view?.state ?? null;
                    const isSelectedWord = selectedWord === word.key;
                    const isSelectedAyah =
                      selectedAyah === `${word.surah}:${word.ayah}`;
                    const classes = [
                      'mushaf-v2-word',
                      hidden ? 'mushaf-v2-word--hidden' : '',
                      state ? `mushaf-v2-word--${state}` : '',
                      isSelectedWord ? 'is-selected' : '',
                      isSelectedAyah ? 'is-ayah-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const inner = (
                      <>
                        {word.rubBefore ? (
                          <span className="mushaf-v2-rub" aria-hidden="true">
                            {'۞'}
                          </span>
                        ) : null}
                        {useTajweed ? renderTajweed(word.text) : word.text}
                        {word.pauseAfter ? (
                          <span className="mushaf-v2-pause" aria-hidden="true">
                            {word.pauseAfter}
                          </span>
                        ) : null}
                        {word.sajdaAfter ? (
                          <span className="mushaf-v2-sajda" aria-label="سجده">
                            {'۩'}
                          </span>
                        ) : null}
                      </>
                    );
                    const rosette = word.endsAyah ? (
                      onSelectAyah && !lineIsButton ? (
                        <button
                          key={`r-${word.key}`}
                          type="button"
                          className="mushaf-v2-rosette-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAyah(word.surah, word.ayah);
                          }}
                          aria-label={`${word.surah}:${word.ayah}`}
                        >
                          <V2Rosette n={toArabicIndic(word.ayah)} />
                        </button>
                      ) : (
                        <V2Rosette key={`r-${word.key}`} n={toArabicIndic(word.ayah)} />
                      )
                    ) : null;
                    const wordEl = wordSelectable ? (
                      <button
                        key={word.key}
                        type="button"
                        data-word-key={word.key}
                        data-qul-id={word.qulId}
                        className={classes}
                        aria-hidden={hidden || undefined}
                        onClick={() => onSelectWord?.(word.key)}
                      >
                        {inner}
                      </button>
                    ) : (
                      <span
                        key={word.key}
                        data-word-key={word.key}
                        data-qul-id={word.qulId}
                        className={classes}
                        aria-hidden={hidden || undefined}
                      >
                        {inner}
                      </span>
                    );
                    return (
                      <span key={word.key}>
                        {wordEl}
                        {rosette}
                        {wi < line.words.length - 1 ? ' ' : ''}
                      </span>
                    );
                  })}
                </>
              );
              if (lineIsButton && first) {
                return (
                  <button
                    key={li}
                    type="button"
                    className={`mushaf-line-btn mushaf-v2-line${line.centered ? ' mushaf-v2-line--centered' : ''}`}
                    onClick={() => onPlayLine?.(first.surah, first.ayah)}
                    aria-label={`${first.surah}:${first.ayah}`}
                  >
                    {lineContent}
                  </button>
                );
              }
              return (
                <div
                  key={li}
                  className={`mushaf-line mushaf-v2-line${line.centered ? ' mushaf-v2-line--centered' : ''}`}
                >
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
              max={604}
              value={jumpValue}
              placeholder={labels.jumpPlaceholder}
              aria-label={labels.jumpPlaceholder}
              onChange={(e) => setJumpValue(e.target.value)}
            />
            <button type="submit">{labels.jump}</button>
          </form>
          <button
            type="button"
            disabled={page.n >= 604}
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
