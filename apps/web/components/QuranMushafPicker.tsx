'use client';

/**
 * QuranMushafPicker — mushaf selector (round 5).
 *
 * Lists the mushaf editions the reference apps offer (Hafs / Warsh /
 * Qalun, with-margins variants, Madina, Tajweed) with one HONESTY
 * HARD RULE: only Hafs has a verified text in this app (the bundled
 * QPC exact lines). Every other row is disabled AND labeled
 * «به‌زودی» (or the locale's equivalent) — never a working option
 * that silently shows Hafs text, never an unlabeled dead control.
 * Sourcing verified Warsh/Qalun texts is separate future work, not
 * this round. The Hafs row is the current selection, shown as a
 * non-interactive row (not a button) with a ✓ marker — it performs
 * no action, so it is not a control at all.
 *
 * Shares the QuranSheetShell look with the picker sheet. All visuals
 * are our own CSS — nothing is copied from any app.
 */
import { QuranSheetShell } from './QuranPickerSheet';

export interface MushafPickerLabels {
  title: string;
  closeLabel: string;
  hafs: string;
  warsh: string;
  qalun: string;
  hafsMargins: string;
  warshMargins: string;
  qalunMargins: string;
  madina: string;
  tajweed: string;
  current: string;
  soon: string;
  note: string;
}

const SOON_ROWS = (labels: MushafPickerLabels): { id: string; label: string }[] => [
  { id: 'warsh', label: labels.warsh },
  { id: 'qalun', label: labels.qalun },
  { id: 'hafs-margins', label: labels.hafsMargins },
  { id: 'warsh-margins', label: labels.warshMargins },
  { id: 'qalun-margins', label: labels.qalunMargins },
  { id: 'madina', label: labels.madina },
  { id: 'tajweed', label: labels.tajweed },
];

export function QuranMushafPicker({
  onClose,
  labels,
}: {
  onClose: () => void;
  labels: MushafPickerLabels;
}) {
  return (
    <QuranSheetShell title={labels.title} closeLabel={labels.closeLabel} onClose={onClose}>
      <ul className="quran-mushaf-list">
        <li className="quran-mushaf-row quran-mushaf-row-current" aria-current="true">
          <span className="quran-mushaf-check" aria-hidden="true">
            ✓
          </span>
          <span className="quran-mushaf-name" lang="ar" dir="rtl">
            {labels.hafs}
          </span>
          <span className="quran-mushaf-badge">{labels.current}</span>
        </li>
        {SOON_ROWS(labels).map((row) => (
          <li key={row.id} className="quran-mushaf-row">
            <button type="button" className="quran-mushaf-btn" disabled aria-disabled="true">
              <span className="quran-mushaf-name" lang="ar" dir="rtl">
                {row.label}
              </span>
              <span className="quran-mushaf-badge quran-mushaf-badge-soon">{labels.soon}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="quran-mushaf-note">{labels.note}</p>
    </QuranSheetShell>
  );
}
