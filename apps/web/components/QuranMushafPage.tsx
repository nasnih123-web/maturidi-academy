'use client';

/**
 * QuranMushafPage — one mushaf page as EXACT Madani print lines when
 * `exactLines` is provided (one print line per block, justified like
 * the printed page), falling back to flowing continuous text when it
 * is null (line data failed to load — never a blank page).
 *
 * Exact-line data: lib/quran-mushaf-lines.json, derived from the open
 * Madani mushaf-layout dataset (Hafs 'an 'Asim, KFGQPC V2 1421H layout
 * family, distributed via QUL for packaging with attribution). Only
 * line text + line type + verse range are bundled — no QPC glyphs,
 * no per-word objects. The page IS the printed page, so it shows the
 * dataset's standard numbering (e.g. Fatiha's Bismillah numbered as
 * in the print); the madhhab display mapping applies to card/ayah
 * views, not to the printed page.
 *
 * Each exact text line is tappable to play from its first verse; the
 * line containing the playing ayah highlights. Word-level highlight
 * is card-view only — page segments highlight at line level.
 *
 * Printed-page dress (original code-drawn ornaments, never copied
 * artwork): a double gold frame with geometric corner motifs around
 * the text block, a full-width surah-heading band, and thin dark
 * double-ring ayah-end markers with the ayah number inside. Page
 * numbers use Arabic-Indic digits throughout, as in the print.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { DisplayAyah } from '@/lib/quran-madhhab';
import type { MushafExactLine } from '@/lib/quran-mushaf-lines';
import {
  expandV2Page,
  loadV2Index,
  loadV2Page,
  loadV2PageGlyphs,
  type V2Expansion,
  type V2MushafIndex,
  type V2Page,
  type V2PageGlyphs,
} from '@/lib/quran-mushaf-v2';
import { BASMALA_QCF_TEXT } from '@/lib/quran-basmala';
import { QuranMushafV2Page } from './QuranMushafV2Page';
import {
  DEFAULT_SVG_MUSHAF,
  type SvgMushafKey,
  type SvgPageAyah,
} from '@/lib/quran-svg-page';
import { QuranSvgPage } from './QuranSvgPage';

export interface MushafSurahGroup {
  surahNumber: number;
  surahNameAr: string;
  /** True when this page contains the surah's first ayah (ornament). */
  surahStartsHere: boolean;
  /** True when the Bismillah line renders above this group's text. */
  bismillahHeader: boolean;
  items: DisplayAyah[];
}

/**
 * Ayah-end marker — an original inline-SVG ornament in the apps'
 * circular-marker manner (round 5): a thin dark DOUBLE ring with
 * the Arabic-Indic ayah number centered inside and a small dark
 * diamond flourish on the ring's top. Reader rebuild 2026-11-08
 * (area 2): the diamond is now an outline, not a gold fill, and
 * the rings carry no fill — the Tarteel manner. Drawn here from
 * basic geometry (circles + one rotated square); no artwork is
 * copied from any mushaf, app, or scan.
 */
function AyahRosette({ n }: { n: string }) {
  return (
    <span className="mushaf-ayah-end" aria-label={n}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="15" />
        <circle cx="20" cy="20" r="10.5" />
        <rect x="17.5" y="1" width="5" height="5" transform="rotate(45 20 3.5)" />
        <text x="20" y="20" textAnchor="middle" dominantBaseline="central">
          {n}
        </text>
      </svg>
    </span>
  );
}

/** Arabic-Indic digit token → rosette ayah-end marker, as in the print. */
function renderLineText(text: string) {
  const tokens = text.split(' ');
  return tokens.map((tok, i) => (
    <Fragment key={i}>
      {/^[٠-٩]+$/.test(tok) ? <AyahRosette n={tok} /> : tok}
      {i < tokens.length - 1 ? ' ' : ''}
    </Fragment>
  ));
}

/**
 * Corner motif for the page frame — an original geometric diamond +
 * dot motif (gold stroke on a parchment disc so it sits cleanly on
 * the frame rule). One instance per corner, rotated by CSS.
 */
function MushafCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <span className={`mushaf-corner mushaf-corner-${pos}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="19" />
        <rect x="12" y="12" width="16" height="16" transform="rotate(45 20 20)" />
        <circle cx="20" cy="20" r="4" />
      </svg>
    </span>
  );
}

/** True when (surah, ayah) lies inside the print line's verse range. */
function refInLine(surah: number, ayah: number, line: MushafExactLine): boolean {
  if (line.t !== 'text' || !line.v) return false;
  const [vs, va] = line.v.split(':').map(Number);
  const [ws, wa] = (line.w || line.v).split(':').map(Number);
  const cmp = (s1: number, a1: number, s2: number, a2: number): number =>
    s1 !== s2 ? s1 - s2 : a1 - a2;
  return cmp(surah, ayah, vs, va) >= 0 && cmp(surah, ayah, ws, wa) <= 0;
}

/** True when playingKey "S:A" falls inside the line's verse range. */
function lineIsPlaying(line: MushafExactLine, playingKey: string | null): boolean {
  if (!playingKey || line.t !== 'text' || !line.v) return false;
  const [ps, pa] = playingKey.split(':').map(Number);
  const [vs, va] = line.v.split(':').map(Number);
  const [ws, wa] = (line.w || line.v).split(':').map(Number);
  if (ps < vs || ps > ws) return false;
  if (ps === vs && pa < va) return false;
  if (ps === ws && pa > wa) return false;
  return true;
}

/** Latin digits → Arabic-Indic digits (code-point math, ASCII-only). */
export function toArabicIndicDigits(n: number): string {
  return String(n)
    .split('')
    .map((d) => String.fromCharCode(0x660 + Number(d)))
    .join('');
}

export function QuranMushafPage({
  groups,
  exactLines,
  pageNumber,
  juz,
  hizb,
  headerSurah,
  headerSurahTemplate,
  pageCurrent,
  juzCurrent,
  hizbCurrent,
  bismillah,
  scriptClass,
  playingKey,
  highlightKey,
  linesClickable,
  hideMeta,
  onPlayAyah,
  onPlayLine,
  hideText,
  svgPage,
  onSelectAyah,
  svgFallbackNote,
  svgUnavailableNote,
  mushafKey,
  resolveSurahName,
  onNavigatePage,
}: {
  groups: MushafSurahGroup[];
  /** Exact print lines for this page; null → flowing fallback. */
  exactLines?: MushafExactLine[] | null;
  pageNumber: number;
  juz: number | null;
  hizb: number | null;
  /** Arabic name of the page's last surah, for the "(سورهٔ …)" header part. */
  headerSurah: string;
  /** Template with %s% (surah name), e.g. "(سورهٔ %s%)". */
  headerSurahTemplate: string;
  /** Templates with %n%. */
  pageCurrent: string;
  juzCurrent: string;
  hizbCurrent: string;
  bismillah: string;
  /** 'quran-script-uthmani' | 'quran-script-indopak' (typeface only). */
  scriptClass: string;
  /** `${surah}:${standardNumber}` of the playing ayah, or null. */
  playingKey: string | null;
  /** `${surah}:${standardNumber}` of a selected ayah to highlight (ayah
   *  mode), or null. Renders with the same gold highlight as playing. */
  highlightKey?: string | null;
  /** False renders lines/ayahs as plain text (ayah mode: the page is
   *  for reading + highlight; navigation is the mode's prev/next). */
  linesClickable?: boolean;
  /** True hides the in-page meta header + footer (round 5 reading
   *  view: the reading top bar already carries page · juz · hizb ·
   *  surah, so repeating them inside the page would duplicate). */
  hideMeta?: boolean;
  /** Play the range from this display item (surah + display item). */
  onPlayAyah: (surahNumber: number, displayItem: DisplayAyah) => void;
  /** Play from a print line's first verse (exact-lines path only). */
  onPlayLine?: (surahNumber: number, ayahNumber: number) => void;
  /** Reader rebuild (2026-11-08, area 2): hide the mushaf text
      for hifz; forwarded to QuranMushafV2Page. Only the V2 path
      honours it — the exact-line / SVG fallback paths render the
      text as before. */
  hideText?: boolean;
  /**
   * Round 6: true when this view shows the REAL printed page as
   * inline SVG (page view, ayah view's page, reading view). False
   * keeps the exact-line text page. Round 11: page, juz and hizb
   * views all pass true — each shows ONE page at a time, so the
   * old "20 scrolling SVG pages" trap (rendering a whole juz at
   * once) does not apply.
   */
  svgPage?: boolean;
  /** SVG tap on a polygon: (surah, ayah) in Hafs print numbering. */
  onSelectAyah?: (surahNumber: number, ayahNumber: number) => void;
  /** Plain note shown only when the SVG fetch failed (fallback). */
  svgFallbackNote?: string;
  /** Note shown only when a NON-Hafs SVG page failed (no text exists). */
  svgUnavailableNote?: string;
  /**
   * The mushaf key: the SVG folder AND the numbering of every tap
   * and header on this page. Default Hafs; never render one mushaf's
   * page under another's key.
   */
  mushafKey?: SvgMushafKey;
  /** Surah number → Arabic name, for the non-Hafs page header. */
  resolveSurahName?: (surahNumber: number) => string;
  /**
   * Page-mode navigation for the V2 page's own prev/next/jump row.
   * The reader passes it only in page view (in juz/hizb views the
   * reader's own range navigation owns paging, so the V2 row hides).
   */
  onNavigatePage?: (page: number) => void;
}) {
  const mushaf = mushafKey ?? DEFAULT_SVG_MUSHAF;
  // A failed SVG load falls back to the text page for the SAME page
  // number — but ONLY for Hafs, whose exact lines exist. A non-Hafs
  // failure shows a note and NO text: the Hafs lines are a different
  // mushaf's pagination and must never stand in for Warsh/Qalun/
  // Duri/Shubah. The flags reset whenever the page/key changes.
  const [svgFailed, setSvgFailed] = useState(false);
  const [svgAyahs, setSvgAyahs] = useState<SvgPageAyah[] | null>(null);
  // Phase 3 (hifz redesign): the real V2 mushaf page. The V2 data
  // loads lazily once (same pattern as the old exact lines) and the
  // expansion is strict — any token mismatch falls back to the old
  // exact-line rendering, never a wrong page. Round 2 §8: only the
  // index (~3.7KB gzip) and this page's chunk (~0.7KB gzip) load —
  // not the whole 193KB file.
  const [v2Index, setV2Index] = useState<V2MushafIndex | null | undefined>(undefined);
  const [v2SelectedWord, setV2SelectedWord] = useState<string | null>(null);
  useEffect(() => {
    if (mushaf !== DEFAULT_SVG_MUSHAF) return;
    let cancelled = false;
    loadV2Index().then((index) => {
      if (!cancelled) setV2Index(index);
    });
    return () => {
      cancelled = true;
    };
  }, [mushaf]);
  // This page's layout chunk (round 2 §8). undefined = still loading,
  // null = the chunk (and the full-data fallback) failed.
  const [v2Page, setV2Page] = useState<V2Page | null | undefined>(undefined);
  useEffect(() => {
    if (mushaf !== DEFAULT_SVG_MUSHAF) return;
    let cancelled = false;
    loadV2Page(pageNumber).then((page) => {
      if (!cancelled) setV2Page(page);
    });
    return () => {
      cancelled = true;
    };
  }, [mushaf, pageNumber]);
  // Phase-1 hifz fix: this page's glyph map (QUL id → glyph
  // string). Loads alongside the V2 data; null (file missing, fetch
  // failed) keeps the Tanzil-text expansion — the honest fallback.
  // While the new page's map loads, the old one is cleared so a
  // stale page's map can never render under the new page.
  const [v2Glyphs, setV2Glyphs] = useState<V2PageGlyphs | null | undefined>(undefined);
  useEffect(() => {
    if (mushaf !== DEFAULT_SVG_MUSHAF) return;
    let cancelled = false;
    loadV2PageGlyphs(pageNumber).then((glyphs) => {
      if (!cancelled) setV2Glyphs(glyphs);
    });
    return () => {
      cancelled = true;
    };
  }, [mushaf, pageNumber]);
  useEffect(() => {
    setSvgFailed(false);
    setSvgAyahs(null);
    setV2SelectedWord(null);
    setV2Glyphs(undefined);
    setV2Page(undefined);
  }, [pageNumber, svgPage, mushaf]);
  const showSvg = svgPage === true && !svgFailed;
  const nonHafsFallback = svgPage === true && svgFailed && mushaf !== DEFAULT_SVG_MUSHAF;
  // Word tokens for the V2 expansion, from this page's own ayah
  // groups. The reader's display groups are NOT raw Tanzil tokens:
  // the madhhab mapping remaps Fatiha (Basmalah as an unnumbered
  // header, ayah 7 split into two cards) and the double-Bismillah
  // fix strips the 4 Basmalah words from the first ayah of surahs
  // 2..114 (strippedWords). The V2 layout counts standard Tanzil
  // tokens, so restore them: prepend the reader's own Basmalah
  // tokens where stripped, concatenate the two Fatiha-7 cards in
  // display order, and restore surah 1 ayah 1 (the Basmalah itself)
  // from the label when no card carries it. Only the COUNTS are
  // verified by the strict expansion; the Basmalah words render in
  // the reader's own label spelling, as they do elsewhere.
  const v2Expansion: V2Expansion | null = useMemo(() => {
    if (mushaf !== DEFAULT_SVG_MUSHAF || !v2Index || !v2Page || showSvg) return null;
    const bismillahTokens = bismillah.split(/\s+/).filter(Boolean);
    const tokens = new Map<string, readonly string[]>();
    for (const group of groups) {
      for (const item of group.items) {
        const key = `${group.surahNumber}:${item.standardNumber}`;
        let toks = item.ayah.text.split(/\s+/).filter(Boolean);
        if (item.strippedWords) toks = [...bismillahTokens, ...toks];
        const prev = tokens.get(key);
        tokens.set(key, prev ? [...prev, ...toks] : toks);
      }
      if (group.surahNumber === 1 && group.bismillahHeader && !tokens.has('1:1')) {
        tokens.set('1:1', bismillahTokens);
      }
    }
    return expandV2Page(v2Index, v2Page, tokens, v2Glyphs ?? undefined);
  }, [mushaf, v2Index, v2Page, showSvg, pageNumber, groups, bismillah, v2Glyphs]);
  if (v2Expansion?.ok && v2Page) {
    return (
      <QuranMushafV2Page
        page={v2Page}
        expansion={v2Expansion}
        bismillah={bismillah}
        pageCurrent={pageCurrent}
        juzCurrent={juzCurrent}
        hizbCurrent={hizbCurrent}
        headerSurahTemplate={headerSurahTemplate}
        resolveSurahName={resolveSurahName}
        hideText={hideText}
        selectedAyah={highlightKey ?? null}
        selectedWord={v2SelectedWord}
        onSelectWord={setV2SelectedWord}
        onSelectAyah={onSelectAyah}
        onPlayLine={onPlayLine}
        linesClickable={linesClickable}
        onNavigate={onNavigatePage}
        showNav={onNavigatePage !== undefined}
        hideMeta={hideMeta}
      />
    );
  }
  // Non-Hafs header comes from the page's OWN ayah list (last ayah's
  // surah), never from the Hafs pipeline's groups: juz/hizb stay null
  // (the caller passes null) and the surah part is omitted until the
  // list loads, rather than showing a Hafs-derived surah.
  const effectiveHeaderSurah =
    mushaf !== DEFAULT_SVG_MUSHAF
      ? svgAyahs && svgAyahs.length > 0
        ? (resolveSurahName?.(svgAyahs[svgAyahs.length - 1].surah) ?? '')
        : ''
      : headerSurah;
  // Header meta, Bayan-style: page · juz · hizb · (surah) — each
  // part only when known. The footer repeats only the page number.
  const meta = [
    pageCurrent.replace('%n%', toArabicIndicDigits(pageNumber)),
    juz !== null ? juzCurrent.replace('%n%', toArabicIndicDigits(juz)) : null,
    hizb !== null ? hizbCurrent.replace('%n%', toArabicIndicDigits(hizb)) : null,
    effectiveHeaderSurah ? headerSurahTemplate.replace('%s%', effectiveHeaderSurah) : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const foot = pageCurrent.replace('%n%', toArabicIndicDigits(pageNumber));
  return (
    <div className={`mushaf-page ${scriptClass}`}>
      {hideMeta ? null : <p className="mushaf-page-meta">{meta}</p>}
      {svgPage === true && svgFailed ? (
        <p className="quran-svg-fallback-note" role="note">
          {nonHafsFallback ? svgUnavailableNote : svgFallbackNote}
        </p>
      ) : null}
      {showSvg ? (
        <QuranSvgPage
          mushaf={mushaf}
          pageNumber={pageNumber}
          highlightKey={highlightKey ?? null}
          onSelectAyah={(s, a) => onSelectAyah?.(s, a)}
          onFailed={() => setSvgFailed(true)}
          onAyahs={setSvgAyahs}
        />
      ) : nonHafsFallback ? null : (
      <div className="mushaf-frame">
        <MushafCorner pos="tl" />
        <MushafCorner pos="tr" />
        <MushafCorner pos="bl" />
        <MushafCorner pos="br" />
        {exactLines ? (
          <div lang="ar" dir="rtl">
          {exactLines.map((line, i) => {
            if (line.t === 'surah-header') {
              return (
                <div key={i} className="mushaf-surah-ornament" lang="ar" dir="rtl">
                  {line.x}
                </div>
              );
            }
            if (line.t === 'basmala') {
              // Step 1a: dedicated QCF BSML calligraphy rendering
              // (see lib/quran-basmala.ts), same as the V2 page.
              return (
                <p
                  key={i}
                  className="mushaf-bismillah"
                  lang="ar"
                  dir="rtl"
                  aria-label={bismillah}
                >
                  {BASMALA_QCF_TEXT}
                </p>
              );
            }
            const playing = lineIsPlaying(line, playingKey);
            const [vs, va] = (line.v || '0:0').split(':').map(Number);
            const highlighted =
              playing ||
              (highlightKey
                ? (() => {
                    const [hs, ha] = highlightKey.split(':').map(Number);
                    return refInLine(hs, ha, line);
                  })()
                : false);
            const lineClass = `mushaf-line${highlighted ? ' mushaf-line-playing' : ''}`;
            if (linesClickable === false) {
              return (
                <div key={i} className={lineClass} aria-label={line.v || undefined}>
                  {renderLineText(line.x || '')}
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                className={`mushaf-line-btn ${lineClass}`}
                onClick={() => onPlayLine?.(vs, va)}
                aria-label={line.v || undefined}
              >
                {renderLineText(line.x || '')}
              </button>
            );
          })}
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.surahNumber} className="mushaf-surah-block">
            {group.surahStartsHere ? (
              <div className="mushaf-surah-ornament" lang="ar" dir="rtl">
                {group.surahNameAr}
              </div>
            ) : null}
            {group.bismillahHeader ? (
              <p className="mushaf-bismillah" lang="ar" dir="rtl" aria-label={bismillah}>
                {BASMALA_QCF_TEXT}
              </p>
            ) : null}
            <p className="mushaf-text" lang="ar" dir="rtl">
              {group.items.map((d) => {
                const key = `${group.surahNumber}:${d.standardNumber}`;
                const highlighted = playingKey === key || highlightKey === key;
                return (
                  <span key={key} id={`range-${group.surahNumber}-${d.standardNumber}`}>
                    {linesClickable === false ? (
                      <span
                        className={`mushaf-ayah${highlighted ? ' mushaf-ayah-playing' : ''}`}
                      >
                        {d.ayah.text} <AyahRosette n={toArabicIndicDigits(d.displayNumber)} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`mushaf-ayah${highlighted ? ' mushaf-ayah-playing' : ''}`}
                        onClick={() => onPlayAyah(group.surahNumber, d)}
                        aria-label={`${group.surahNumber}:${d.standardNumber}`}
                      >
                        {d.ayah.text} <AyahRosette n={toArabicIndicDigits(d.displayNumber)} />
                      </button>
                    )}{' '}
                  </span>
                );
              })}
            </p>
          </div>
          ))
        )}
      </div>
      )}
      {hideMeta ? null : <p className="mushaf-page-meta mushaf-page-foot">{foot}</p>}
    </div>
  );
}
