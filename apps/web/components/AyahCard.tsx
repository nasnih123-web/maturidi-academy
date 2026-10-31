/**
 * AyahCard — pure presentation for one ayah.
 *
 * Renders Arabic text (+ translation / tafsir when provided), the play
 * button for this ayah, and a slot for the notes UI. Highlight state
 * (current ayah / current word) arrives as props — no playback logic here.
 */
import type { Ayah } from '@/lib/quran';

export interface AyahCardLabels {
  playAyah: string;
  playing: string;
  translationLabel: string;
  tafsirLabel: string;
  ayahNumber: string;
  ayahLink: string;
}

export function AyahCard({
  ayah,
  surahNumber,
  highlighted,
  wordIndex,
  showTranslation,
  showTafsir,
  isCurrent,
  labels,
  notes,
  ayahHref,
  sajdaTitle,
}: {
  ayah: Ayah;
  surahNumber: number;
  highlighted: boolean;
  wordIndex: number;
  showTranslation: boolean;
  showTafsir: boolean;
  isCurrent: boolean;
  labels: AyahCardLabels;
  notes: React.ReactNode;
  /** Deep-link href for this ayah (e.g. /fa/quran/2?ayah=255). */
  ayahHref: string;
  /**
   * Sajda marker title (ruling included, e.g. "سجدهٔ تلاوت — واجب").
   * Null = no sajda at this ayah under the selected madhhab.
   */
  sajdaTitle?: string | null;
}) {
  const words = ayah.text.split(/\s+/).filter(Boolean);
  return (
    <article
      id={`ayah-${ayah.number}`}
      className={`ayah-card${highlighted ? ' ayah-active' : ''}`}
      aria-current={highlighted ? 'true' : undefined}
      data-surah={surahNumber}
      data-ayah={ayah.number}
    >
      <div className="ayah-head">
        <a
          className="ayah-badge"
          href={ayahHref}
          aria-label={`${labels.ayahNumber} ${ayah.number}`}
          title={labels.ayahLink}
        >
          {ayah.number}
        </a>
        {sajdaTitle ? (
          <span className="ayah-sajda" title={sajdaTitle} aria-label={sajdaTitle}>
            ۩
          </span>
        ) : null}
        <span className="ayah-actions">{notes}</span>
      </div>

      <p className="ayah-text" lang="ar" dir="rtl">
        {wordIndex >= 1 && highlighted
          ? words.map((w, i) => (
              <span key={i} className={i + 1 === wordIndex ? 'word-active' : undefined}>
                {w}
                {i < words.length - 1 ? ' ' : ''}
              </span>
            ))
          : ayah.text}
      </p>

      {showTranslation && ayah.translation ? (
        <div className="ayah-translation">
          <span className="ayah-sub-label">{labels.translationLabel}</span>
          <p>{ayah.translation}</p>
        </div>
      ) : null}

      {showTafsir && ayah.tafsir ? (
        <details className="ayah-tafsir">
          <summary>{labels.tafsirLabel}</summary>
          <p>{ayah.tafsir}</p>
        </details>
      ) : null}

      {isCurrent ? <span className="sr-only">{labels.playing}</span> : null}
    </article>
  );
}
