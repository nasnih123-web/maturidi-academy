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
 * the text block, a full-width surah-heading band, and gold circular
 * double-ring ayah-end markers with the ayah number inside. Page
 * numbers use Arabic-Indic digits throughout, as in the print.
 */
import { Fragment, useEffect, useState } from 'react';
import type { DisplayAyah } from '@/lib/quran-madhhab';
import type { MushafExactLine } from '@/lib/quran-mushaf-lines';
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
 * circular-marker manner (round 5): a DOUBLE gold ring with the
 * Arabic-Indic ayah number centered inside and a small gold diamond
 * flourish on the ring's top, like the circular ornate markers in
 * the user's Bayan reference. Drawn here from basic geometry
 * (circles + one rotated square); no artwork is copied from any
 * mushaf, app, or scan.
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
  svgPage,
  onSelectAyah,
  svgFallbackNote,
  svgUnavailableNote,
  svgCredit,
  mushafKey,
  resolveSurahName,
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
  /**
   * Round 6: true when this view shows the REAL printed page as
   * inline SVG (page view, ayah view's page, reading view). False
   * keeps the exact-line text page — the juz view stays text-lines
   * on purpose: 20 scrolling SVG pages is the documented mobile
   * performance trap (a page is a few hundred KB of path data).
   */
  svgPage?: boolean;
  /** SVG tap on a polygon: (surah, ayah) in Hafs print numbering. */
  onSelectAyah?: (surahNumber: number, ayahNumber: number) => void;
  /** Plain note shown only when the SVG fetch failed (fallback). */
  svgFallbackNote?: string;
  /** Note shown only when a NON-Hafs SVG page failed (no text exists). */
  svgUnavailableNote?: string;
  /** Small credit line under a rendered SVG page. */
  svgCredit?: string;
  /**
   * The mushaf key: the SVG folder AND the numbering of every tap
   * and header on this page. Default Hafs; never render one mushaf's
   * page under another's key.
   */
  mushafKey?: SvgMushafKey;
  /** Surah number → Arabic name, for the non-Hafs page header. */
  resolveSurahName?: (surahNumber: number) => string;
}) {
  const mushaf = mushafKey ?? DEFAULT_SVG_MUSHAF;
  // A failed SVG load falls back to the text page for the SAME page
  // number — but ONLY for Hafs, whose exact lines exist. A non-Hafs
  // failure shows a note and NO text: the Hafs lines are a different
  // mushaf's pagination and must never stand in for Warsh/Qalun/
  // Duri/Shubah. The flags reset whenever the page/key changes.
  const [svgFailed, setSvgFailed] = useState(false);
  const [svgAyahs, setSvgAyahs] = useState<SvgPageAyah[] | null>(null);
  useEffect(() => {
    setSvgFailed(false);
    setSvgAyahs(null);
  }, [pageNumber, svgPage, mushaf]);
  const showSvg = svgPage === true && !svgFailed;
  const nonHafsFallback = svgPage === true && svgFailed && mushaf !== DEFAULT_SVG_MUSHAF;
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
              return (
                <p key={i} className="mushaf-bismillah" lang="ar" dir="rtl">
                  {bismillah}
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
              <p className="mushaf-bismillah" lang="ar" dir="rtl">
                {bismillah}
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
      {showSvg && svgCredit ? <p className="quran-svg-credit">{svgCredit}</p> : null}
      {hideMeta ? null : <p className="mushaf-page-meta mushaf-page-foot">{foot}</p>}
    </div>
  );
}
