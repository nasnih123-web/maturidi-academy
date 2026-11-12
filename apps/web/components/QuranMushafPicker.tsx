'use client';

/**
 * QuranMushafPicker — mushaf selector (round 6: five real mushafs).
 *
 * The five printed mushafs from quran-ws/quran-svg render through the
 * SAME SVG path, only the data folder changes — so all five rows are
 * real, selectable buttons. The current row is a non-interactive row
 * with a ✓ marker (not a control). The margins variants and Tajweed
 * rows stay disabled AND labeled «به‌زودی»: they need their own
 * sources and are never faked with another mushaf's pages.
 *
 * Step 1b (Tarteel parity): the Madina mushaf is REAL now — as the
 * Digital Khatt text renderer (real Unicode text in the Digital
 * Khatt V2 variable font on the KFGQPC V2 1421H print layout), not
 * as an SVG facsimile. Its row renders when the reader passes
 * onSelectDigitalKhatt; it is a renderer of the Hafs mushaf, so it
 * shares the Hafs page numbering.
 *
 * Step 2: the IndoPak mushaf is REAL too — Digital Khatt IndoPak
 * on its own 610-page × 15-line layout (onSelectDigitalKhattIndoPak)
 * — and the «به‌زودی» list is GONE: the margins variants have no
 * source anywhere, and "Tajweed" is a colouring of the text
 * renderers / the V4 study fonts, not a separate print with its
 * own data. Rows that cannot be real are removed, not promised.
 * (The margins/tajweed/soon label fields stay in the labels type
 * for schema compatibility; nothing renders them any more.)
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
  /** Step 1b: label of the real Digital Khatt (Madina) row. */
  digitalKhatt: string;
  /** Step 2: label of the real Digital Khatt IndoPak row. */
  digitalKhattIndoPak: string;
  /** Step 2: label of the real QPC V4 (1441) row. */
  qpcV4: string;
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

export function QuranMushafPicker({
  onClose,
  labels,
  currentMushaf,
  onSelect,
  currentRenderer,
  onSelectDigitalKhatt,
  onSelectDigitalKhattIndoPak,
  onSelectQpcV4,
}: {
  onClose: () => void;
  labels: MushafPickerLabels;
  currentMushaf: SvgMushafKey;
  /** Picking a mushaf lands the reader on that mushaf's page view. */
  onSelect: (mushaf: SvgMushafKey) => void;
  /** Step 1b/2: which renderer the reader currently shows. */
  currentRenderer?: 'standard' | 'digital-khatt' | 'digital-khatt-indopak' | 'qpc-v4';
  /** Step 1b: present → the Digital Khatt (Madina) row is real. */
  onSelectDigitalKhatt?: () => void;
  /** Step 2: present → the Digital Khatt IndoPak row is real. */
  onSelectDigitalKhattIndoPak?: () => void;
  /** Step 2: present → the QPC V4 (1441) row is real. */
  onSelectQpcV4?: () => void;
}) {
  return (
    <QuranSheetShell title={labels.title} closeLabel={labels.closeLabel} onClose={onClose}>
      <ul className="quran-mushaf-list">
        {REAL_ROWS.map((row) => {
          const label = row.label(labels);
          if (row.key === currentMushaf && currentRenderer !== 'digital-khatt') {
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
        {onSelectDigitalKhatt ? (
          currentRenderer === 'digital-khatt' ? (
            <li className="quran-mushaf-row quran-mushaf-row-current" aria-current="true">
              <span className="quran-mushaf-check" aria-hidden="true">
                ✓
              </span>
              <span className="quran-mushaf-name" lang="ar" dir="rtl">
                {labels.digitalKhatt}
              </span>
              <span className="quran-mushaf-badge">{labels.current}</span>
            </li>
          ) : (
            <li className="quran-mushaf-row">
              <button
                type="button"
                className="quran-mushaf-btn"
                onClick={() => onSelectDigitalKhatt()}
              >
                <span className="quran-mushaf-name" lang="ar" dir="rtl">
                  {labels.digitalKhatt}
                </span>
              </button>
            </li>
          )
        ) : null}
        {onSelectQpcV4 ? (
          currentRenderer === 'qpc-v4' ? (
            <li className="quran-mushaf-row quran-mushaf-row-current" aria-current="true">
              <span className="quran-mushaf-check" aria-hidden="true">
                ✓
              </span>
              <span className="quran-mushaf-name" lang="ar" dir="rtl">
                {labels.qpcV4}
              </span>
              <span className="quran-mushaf-badge">{labels.current}</span>
            </li>
          ) : (
            <li className="quran-mushaf-row">
              <button
                type="button"
                className="quran-mushaf-btn"
                onClick={() => onSelectQpcV4()}
              >
                <span className="quran-mushaf-name" lang="ar" dir="rtl">
                  {labels.qpcV4}
                </span>
              </button>
            </li>
          )
        ) : null}
        {onSelectDigitalKhattIndoPak ? (
          currentRenderer === 'digital-khatt-indopak' ? (
            <li className="quran-mushaf-row quran-mushaf-row-current" aria-current="true">
              <span className="quran-mushaf-check" aria-hidden="true">
                ✓
              </span>
              <span className="quran-mushaf-name" lang="ar" dir="rtl">
                {labels.digitalKhattIndoPak}
              </span>
              <span className="quran-mushaf-badge">{labels.current}</span>
            </li>
          ) : (
            <li className="quran-mushaf-row">
              <button
                type="button"
                className="quran-mushaf-btn"
                onClick={() => onSelectDigitalKhattIndoPak()}
              >
                <span className="quran-mushaf-name" lang="ar" dir="rtl">
                  {labels.digitalKhattIndoPak}
                </span>
              </button>
            </li>
          )
        ) : null}
      </ul>
      <p className="quran-mushaf-note">{labels.note}</p>
    </QuranSheetShell>
  );
}
