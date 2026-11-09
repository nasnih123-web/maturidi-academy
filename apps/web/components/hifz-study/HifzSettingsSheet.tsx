/**
 * hifz-study/HifzSettingsSheet: the Phase 4 settings sheet moved
 * verbatim from components/QuranHifzStudy.tsx (hifz-completion
 * refactor step 5). Presentational only: all state (hifzSettings,
 * settingsOpen) and persistence (saveHifzSettings) stay in the
 * parent; the sheet receives them as props and reports changes.
 * Freeze defaults OFF = premium behaviour: the page never freezes
 * on a misread.
 */
import type { HifzUserSettings } from '@/lib/hifz-phase4';
import type { HifzLabels } from '@/lib/hifz-study-types';

export function HifzSettingsSheet({
  open,
  settings,
  labels,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: HifzUserSettings;
  labels: HifzLabels;
  onChange: (next: HifzUserSettings) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
<>
  <div
    className="hifz-sheet-backdrop"
    aria-hidden="true"
    onClick={onClose}
  />
  <div className="hifz-error-sheet" role="dialog" aria-modal="true" aria-label={labels.settingsTitle}>
    <span className="hifz-sheet-handle" aria-hidden="true" />
    <div className="hifz-error-sheet-head">
      <h3>{labels.settingsTitle}</h3>
      <button type="button" onClick={onClose}>
        {labels.errorsClose}
      </button>
    </div>
    {/* Phase 6: Tarteel-style card + toggle switches (green
        when on, gray when off; the switch sits at the far
        end of the row). The freeze explanation is the
        sub-text of its own row, as in the frames. */}
    <div className="hifz-settings-card">
      <label className="hifz-setting-row">
        <span className="hifz-setting-text">
          {labels.freezeSetting}
          <span className="hifz-setting-hint">{labels.freezeHint}</span>
        </span>
        <input
          type="checkbox"
          checked={settings.freezeOnError}
          onChange={(e) => void onChange({ ...settings, freezeOnError: e.target.checked })}
        />
      </label>
      <label className="hifz-setting-row">
        <span className="hifz-setting-text">{labels.mistakeDetection}</span>
        <input
          type="checkbox"
          checked={settings.mistakeDetection}
          onChange={(e) => void onChange({ ...settings, mistakeDetection: e.target.checked })}
        />
      </label>
      <label className="hifz-setting-row">
        <span className="hifz-setting-text">{labels.tashkeelDetection}</span>
        <input
          type="checkbox"
          checked={settings.tashkeelDetection}
          onChange={(e) => void onChange({ ...settings, tashkeelDetection: e.target.checked })}
        />
      </label>
      <label className="hifz-setting-row">
        <span className="hifz-setting-text">{labels.resumableSessions}</span>
        <input
          type="checkbox"
          checked={settings.resumableSessions}
          onChange={(e) => void onChange({ ...settings, resumableSessions: e.target.checked })}
        />
      </label>
      <label className="hifz-setting-row">
        <span className="hifz-setting-text">{labels.hideMarkers}</span>
        <input
          type="checkbox"
          checked={settings.hideAyahMarkers}
          onChange={(e) => void onChange({ ...settings, hideAyahMarkers: e.target.checked })}
        />
      </label>
    </div>
  </div>
</>
  );
}
