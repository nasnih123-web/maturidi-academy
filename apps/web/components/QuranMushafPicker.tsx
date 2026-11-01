'use client';

/**
 * QuranMushafPicker — mushaf selector (round 6: five real mushafs).
 *
 * The five printed mushafs from quran-ws/quran-svg render through the
 * SAME SVG path, only the data folder changes — so all five rows are
 * real, selectable buttons. The current row is a non-interactive row
 * with a ✓ marker (not a control). The margins variants, Madina and
 * Tajweed rows stay disabled AND labeled «به‌زودی»: they need their
 * own sources and are never faked with another mushaf's pages.
 *
 * HONESTY HARD RULE (unchanged): a row that cannot show its own
 * mushaf's pages is disabled + labeled, never a working option that
 * silently shows another mushaf's content. Page numbers are
 * per-mushaf — switching rows keeps the page NUMBER but re-resolves
 * it under the new key (Warsh p42 is not Hafs p42).
 *
 * Shares the QuranSheetShell look with the picker sheet. All visuals
 * are our own CSS — nothing is copied from any app.
 */
import type { SvgMushafKey } from '@/lib/quran-svg-page';
import { QuranSheetShell } from './QuranPickerSheet';

export interface MushafPickerLabels {
  title: string;
  closeLabel: string;
  hafs: string;
  warsh: string;
  qalun: string;
  douri: string;
  shubah: string;
  hafsMargins: string;
  warshMargins: string;
  qalunMargins: string;
  madina: string;
  tajweed: string;
  current: string;
  soon: string;
  note: string;
}

const REAL_ROWS: { key: SvgMushafKey; label: (l: MushafPickerLabels) => string }[] = [
  { key: 'hafs/kfqc', label: (l) => l.hafs },
  { key: 'warsh/kfqc', label: (l) => l.warsh },
  { key: 'qalon/kfqc', label: (l) => l.qalun },
  { key: 'douri/kfqc', label: (l) => l.douri },
  { key: 'shubah/kfqc', label: (l) => l.shubah },
];

const SOON_ROWS = (labels: MushafPickerLabels): { id: string; label: string }[] => [
  { id: 'hafs-margins', label: labels.hafsMargins },
  { id: 'warsh-margins', label: labels.warshMargins },
  { id: 'qalun-margins', label: labels.qalunMargins },
  { id: 'madina', label: labels.madina },
  { id: 'tajweed', label: labels.tajweed },
];

export function QuranMushafPicker({
  onClose,
  labels,
  currentMushaf,
  onSelect,
}: {
  onClose: () => void;
  labels: MushafPickerLabels;
  currentMushaf: SvgMushafKey;
  /** Picking a mushaf lands the reader on that mushaf's page view. */
  onSelect: (mushaf: SvgMushafKey) => void;
}) {
  return (
    <QuranSheetShell title={labels.title} closeLabel={labels.closeLabel} onClose={onClose}>
      <ul className="quran-mushaf-list">
        {REAL_ROWS.map((row) => {
          const label = row.label(labels);
          if (row.key === currentMushaf) {
            return (
              <li key={row.key} className="quran-mushaf-row quran-mushaf-row-current" aria-current="true">
                <span className="quran-mushaf-check" aria-hidden="true">
                  ✓
                </span>
                <span className="quran-mushaf-name" lang="ar" dir="rtl">
                  {label}
                </span>
                <span className="quran-mushaf-badge">{labels.current}</span>
              </li>
            );
          }
          return (
            <li key={row.key} className="quran-mushaf-row">
              <button
                type="button"
                className="quran-mushaf-btn"
                onClick={() => onSelect(row.key)}
              >
                <span className="quran-mushaf-name" lang="ar" dir="rtl">
                  {label}
                </span>
              </button>
            </li>
          );
        })}
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
