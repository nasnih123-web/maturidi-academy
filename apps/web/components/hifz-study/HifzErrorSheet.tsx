/**
 * hifz-study/HifzErrorSheet: the error bottom sheet moved verbatim
 * from components/QuranHifzStudy.tsx (hifz-completion refactor
 * step 6). Presentational only: all state (groupedMistakes,
 * errorWords, liveExtraWords) and the delete call stay in the
 * parent; the sheet receives them as props and reports back via
 * onDelete / onClose. The dispute call is not used here (it lives
 * on the wall / line words in the parent).
 *
 * Moved with it, the two comments that documented the sheet:
 * Error sheet (bottom sheet, opened by hand during the session):
 * wrong words (expected vs recited) and extra words. No
 * end-of-session results page exists. Phase 4: the server-side
 * groups render as one card per ayah - expected (green) vs
 * recited (red) with a "surah:ayah" label, plus a per-item delete.
 * Without a server group (guest / load failed), the local
 * live/graded words render as before.
 * Phase 6: Tarteel card layout - eye-slash icon + category +
 * "surah:ayah" chip in the card head; expected (green) and heard
 * (red) as two rows with side labels; the info pill at the bottom.
 * The expected text is no longer printed twice (it used to appear
 * both large and inside the meta line).
 */
import { toArabicIndic } from '@/lib/quran-print-lines';
import type { HifzLabels, HifzMistakeGroup } from '@/lib/hifz-study-types';
import { ErrorsHeadIcon } from './HifzErrorsIcon';

/** One wrong/close word for the fallback (no server group) card. */
export type HifzErrorWord = {
  ayah: number;
  index: number;
  expected: string;
  heard: string | null;
};

export function HifzErrorSheet({
  open,
  groups,
  errorWords,
  liveExtraWords,
  liveExtraCount,
  surah,
  labels,
  onDelete,
  onClose,
}: {
  open: boolean;
  groups: HifzMistakeGroup[] | null;
  errorWords: HifzErrorWord[];
  liveExtraWords: string[];
  liveExtraCount: number;
  surah: number;
  labels: HifzLabels;
  onDelete: (mistakeId: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  // Whole-sheet empty (no errors anywhere): the Tarteel empty state
  // (user image 1) — big green head icon + the empty text, instead
  // of empty cards. Per-category empties below keep the plain text.
  const isEmpty =
    groups !== null
      ? groups.length === 0
      : errorWords.length === 0 && liveExtraWords.length === 0 && liveExtraCount === 0;
  return (
  <>
    <div
      className="hifz-sheet-backdrop"
      aria-hidden="true"
      onClick={onClose}
    />
    <div className="hifz-error-sheet" role="dialog" aria-modal="true" aria-label={labels.errorsTitle}>
      <span className="hifz-sheet-handle" aria-hidden="true" />
      <div className="hifz-error-sheet-head">
        <h3>{labels.errorsTitle}</h3>
        <button type="button" onClick={onClose}>
          {labels.errorsClose}
        </button>
      </div>
      {isEmpty ? (
        <div className="hifz-error-empty">
          <ErrorsHeadIcon className="hifz-error-empty-icon" />
          <p>{labels.errorsEmpty}</p>
        </div>
      ) : groups !== null ? (
        groups.map((group) => (
            <article
              key={`${group.surah}:${group.ayah}:${group.category}`}
              className="hifz-error-card"
            >
              <div className="hifz-error-card-head">
                <svg className="hifz-error-card-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 10 7-.4.7-1 1.6-1.9 2.5M6.6 6.6C4.9 7.9 3.4 9.9 2 12c1.5 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span className="hifz-error-card-cat">
                  {group.category === 'wrong_words' ? labels.errorsWrong : labels.errorsExtra}
                </span>
                <span className="hifz-error-card-chip">
                  {toArabicIndic(group.surah)}:{toArabicIndic(group.ayah)}
                </span>
              </div>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id} className="hifz-error-item">
                    {item.mistake_type === 'transposed' && (
                      <p className="hifz-error-meta">{labels.errorsTransposed}</p>
                    )}
                    {group.category === 'wrong_words' ? (
                      <>
                        <p className="hifz-error-row">
                          <span className="hifz-error-expected">{item.expected_text}</span>
                          <span className="hifz-error-row-label">{labels.errorsExpected}</span>
                        </p>
                        {item.heard && (
                          <p className="hifz-error-row">
                            <span className="hifz-error-heard">{item.heard}</span>
                            <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="hifz-error-row">
                        <span className="hifz-error-heard">{item.heard}</span>
                        <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                      </p>
                    )}
                    <button
                      type="button"
                      className="hifz-error-delete"
                      onClick={() => void onDelete(item.id)}
                    >
                      {labels.errorsDelete}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))
      ) : (
        <>
          <article className="hifz-error-card">
            <div className="hifz-error-card-head">
              <span className="hifz-error-card-cat">{labels.errorsWrong}</span>
            </div>
            {errorWords.length === 0 ? (
              <p>{labels.errorsEmpty}</p>
            ) : (
              <ul>
                {errorWords.map((w) => (
                  <li key={`${w.ayah}:${w.index}`} className="hifz-error-item">
                    <p className="hifz-error-row">
                      <span className="hifz-error-expected">{w.expected}</span>
                      <span className="hifz-error-row-label">{labels.errorsExpected}</span>
                    </p>
                    {w.heard && (
                      <p className="hifz-error-row">
                        <span className="hifz-error-heard">{w.heard}</span>
                        <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                      </p>
                    )}
                    <span className="hifz-error-card-chip">
                      {toArabicIndic(surah)}:{toArabicIndic(w.ayah)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="hifz-error-card">
            <div className="hifz-error-card-head">
              <span className="hifz-error-card-cat">{labels.errorsExtra}</span>
            </div>
            {liveExtraWords.length === 0 && liveExtraCount === 0 ? (
              <p>{labels.errorsEmpty}</p>
            ) : liveExtraWords.length > 0 ? (
              <ul>
                {liveExtraWords.map((t, i) => (
                  <li key={i} className="hifz-error-item">
                    <p className="hifz-error-row">
                      <span className="hifz-error-heard">{t}</span>
                      <span className="hifz-error-row-label">{labels.errorsHeard}</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {labels.errorsExtra}: {toArabicIndic(liveExtraCount)}
              </p>
            )}
          </article>
        </>
      )}
      <p className="hifz-error-learn">
        <span className="hifz-error-learn-icon" aria-hidden="true">
          i
        </span>
        {labels.errorsLearn}
      </p>
    </div>
  </>
  );
}
