'use client';

/**
 * QuranMushafPage — one mushaf page as FLOWING continuous text.
 *
 * HONEST LIMIT: this is flowing mushaf-style text on the site's own
 * background — NOT exact 15-line Madani line layout. The provider
 * supplies per-ayah page numbers but no line-break data, so no line
 * layout is fabricated. What it does show, like the bayan-app reference:
 * the page's ayahs as continuous text, a decorative surah header
 * ornament when the page starts a surah, the Bismillah line for that
 * surah, and a header/footer with page number + juz + hizb.
 *
 * Each ayah segment is tappable to play from that ayah; the playing
 * segment highlights. Word-level highlight is card-view only — page
 * segments highlight at ayah level.
 */
import type { DisplayAyah } from '@/lib/quran-madhhab';

export interface MushafSurahGroup {
  surahNumber: number;
  surahNameAr: string;
  /** True when this page contains the surah's first ayah (ornament). */
  surahStartsHere: boolean;
  /** True when the Bismillah line renders above this group's text. */
  bismillahHeader: boolean;
  items: DisplayAyah[];
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
  pageNumber,
  juz,
  hizb,
  pageCurrent,
  juzCurrent,
  hizbCurrent,
  bismillah,
  scriptClass,
  playingKey,
  onPlayAyah,
}: {
  groups: MushafSurahGroup[];
  pageNumber: number;
  juz: number | null;
  hizb: number | null;
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
}) {
  const meta = [
    pageCurrent.replace('%n%', String(pageNumber)),
    juz !== null ? juzCurrent.replace('%n%', String(juz)) : null,
    hizb !== null ? hizbCurrent.replace('%n%', String(hizb)) : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  return (
    <div className={`mushaf-page ${scriptClass}`}>
      <p className="mushaf-page-meta">{meta}</p>
      {groups.map((group) => (
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
      ))}
      <p className="mushaf-page-meta mushaf-page-foot">{meta}</p>
    </div>
  );
}
