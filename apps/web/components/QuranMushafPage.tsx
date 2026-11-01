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
 */
import { Fragment } from 'react';
import type { DisplayAyah } from '@/lib/quran-madhhab';
import type { MushafExactLine } from '@/lib/quran-mushaf-lines';

export interface MushafSurahGroup {
  surahNumber: number;
  surahNameAr: string;
  /** True when this page contains the surah's first ayah (ornament). */
  surahStartsHere: boolean;
  /** True when the Bismillah line renders above this group's text. */
  bismillahHeader: boolean;
  items: DisplayAyah[];
}

/** Arabic-Indic digit token → circled ayah-end marker, as in the print. */
function renderLineText(text: string) {
  const tokens = text.split(' ');
  return tokens.map((tok, i) => (
    <Fragment key={i}>
      {/^[٠-٩]+$/.test(tok) ? (
        <span className="mushaf-ayah-end">
          {'\u06DD'}
          {tok}
        </span>
      ) : (
        tok
      )}
      {i < tokens.length - 1 ? ' ' : ''}
    </Fragment>
  ));
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
  onPlayAyah,
  onPlayLine,
}: {
  groups: MushafSurahGroup[];
  /** Exact print lines for this page; null → flowing fallback. */
  exactLines?: MushafExactLine[] | null;
  pageNumber: number;
  juz: number | null;
  hizb: number | null;
  /** Surah of the page's LAST ayah (Bayan's header follows the page's
   *  final content, e.g. page 106 → مائده, not نساء). */
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
  /** Play the range from this display item (surah + display item). */
  onPlayAyah: (surahNumber: number, displayItem: DisplayAyah) => void;
  /** Play from a print line's first verse (exact-lines path only). */
  onPlayLine?: (surahNumber: number, ayahNumber: number) => void;
}) {
  // Header meta, Bayan-style: page · juz · hizb · (surah) — each
  // part only when known. The footer repeats only the page number.
  const meta = [
    pageCurrent.replace('%n%', String(pageNumber)),
    juz !== null ? juzCurrent.replace('%n%', String(juz)) : null,
    hizb !== null ? hizbCurrent.replace('%n%', String(hizb)) : null,
    headerSurahTemplate.replace('%s%', headerSurah),
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const foot = pageCurrent.replace('%n%', String(pageNumber));
  return (
    <div className={`mushaf-page ${scriptClass}`}>
      <p className="mushaf-page-meta">{meta}</p>
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
            return (
              <button
                key={i}
                type="button"
                className={`mushaf-line mushaf-line-btn${playing ? ' mushaf-line-playing' : ''}`}
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
                const isPlaying = playingKey === key;
                return (
                  <span key={key} id={`range-${group.surahNumber}-${d.standardNumber}`}>
                    <button
                      type="button"
                      className={`mushaf-ayah${isPlaying ? ' mushaf-ayah-playing' : ''}`}
                      onClick={() => onPlayAyah(group.surahNumber, d)}
                      aria-label={`${group.surahNumber}:${d.standardNumber}`}
                    >
                      {d.ayah.text}{' '}
                      <span className="mushaf-ayah-end">
                        {'\u06DD'}
                        {toArabicIndicDigits(d.displayNumber)}
                      </span>
                    </button>{' '}
                  </span>
                );
              })}
            </p>
          </div>
        ))
      )}
      <p className="mushaf-page-meta mushaf-page-foot">{foot}</p>
    </div>
  );
}
