/**
 * hifz-study/HifzSearchSheet: the Tarteel top-bar search, opened by
 * the magnifier (2026-11-08, Tarteel topbar mission). Same hifz
 * sheet pattern as HifzSettingsSheet / HifzDisplaySheet: backdrop
 * (tap closes) + .hifz-error-sheet + drag handle. The body is the
 * one Quran search (QuranSearchBox): digits jump to a mushaf page,
 * text matches surah names or ayah text, and results navigate to
 * the reader (the component's existing behaviour). Presentational
 * only: the open state lives in the parent (QuranHifzStudy).
 */
import { QuranSearchBox, type QuranSearchLabels } from '../QuranSearchBox';
import type { SurahSummary } from '@/lib/quran';
import type { HifzLabels } from '@/lib/hifz-study-types';

export function HifzSearchSheet({
  open,
  locale,
  surahList,
  labels,
  searchLabels,
  onClose,
}: {
  open: boolean;
  locale: string;
  surahList: SurahSummary[];
  labels: HifzLabels;
  searchLabels: QuranSearchLabels;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <>
      <div className="hifz-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        className="hifz-error-sheet hifz-search-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={labels.searchTitle}
      >
        <span className="hifz-sheet-handle" aria-hidden="true" />
        <div className="hifz-error-sheet-head">
          <h3>{labels.searchTitle}</h3>
          <button type="button" onClick={onClose}>
            {labels.errorsClose}
          </button>
        </div>
        <QuranSearchBox locale={locale} surahs={surahList} labels={searchLabels} />
      </div>
    </>
  );
}
