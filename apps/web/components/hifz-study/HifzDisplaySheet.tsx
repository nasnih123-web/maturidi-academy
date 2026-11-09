/**
 * hifz-study/HifzDisplaySheet: the Tarteel "تنسيق المصحف" bottom
 * sheet (2026-11-08, Tarteel pixel-perfect mission, step 7).
 * Same hifz sheet pattern as HifzSettingsSheet / HifzErrorSheet:
 * backdrop (tap closes) + .hifz-error-sheet + drag handle.
 * Three cards, one per display mode — Mushaf (printed page,
 * swipe), Nass (scrolling Uthmani text), Translation (scrolling,
 * read-only). Presentational only: the mode state and persistence
 * stay in the parent (QuranHifzStudy); the sheet reports the
 * choice and closes.
 */
import type { HifzLabels } from '@/lib/hifz-study-types';

/** The three Tarteel display modes (stored in 'hifz-display-mode'). */
export type HifzDisplayMode = 'mushaf' | 'nass' | 'translation';

export function HifzDisplaySheet({
  open,
  mode,
  labels,
  onSelect,
  onClose,
}: {
  open: boolean;
  mode: HifzDisplayMode;
  labels: HifzLabels;
  onSelect: (m: HifzDisplayMode) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const cards: { id: HifzDisplayMode; title: string; desc: string }[] = [
    { id: 'mushaf', title: labels.displayMushaf, desc: labels.displayMushafDesc },
    { id: 'nass', title: labels.displayNass, desc: labels.displayNassDesc },
    { id: 'translation', title: labels.displayTranslation, desc: labels.displayTranslationDesc },
  ];
  return (
    <>
      <div className="hifz-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        className="hifz-error-sheet hifz-display-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={labels.displaySheetTitle}
      >
        <span className="hifz-sheet-handle" aria-hidden="true" />
        <div className="hifz-error-sheet-head">
          <h3>{labels.displaySheetTitle}</h3>
          <button type="button" onClick={onClose}>
            {labels.errorsClose}
          </button>
        </div>
        <div className="hifz-display-cards" role="group" aria-label={labels.displaySheetTitle}>
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`hifz-display-card${mode === card.id ? ' is-active' : ''}`}
              aria-pressed={mode === card.id}
              onClick={() => {
                onSelect(card.id);
                onClose();
              }}
            >
              <span className="hifz-display-card-title">{card.title}</span>
              <span className="hifz-display-card-desc">{card.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
