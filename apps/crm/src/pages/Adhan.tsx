import React from "react";
import { Badge, Button } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import {
  ADHAN_METHODS,
  DEFAULT_ADHAN,
  QURAN_SETTINGS_KEYS,
  parseAdhanDefaults,
  useQuranSettingsQuery,
  useWriteQuranKeys,
  type AdhanDefaults,
  type Madhab,
} from "../lib/quran";
import { SaveRow } from "./Quran";

/**
 * Adhan management (اوقات شرعی) — super_admin only.
 *
 * Own CRM section (route /adhan, menu «اوقات شرعی») since 2026-10-28: the
 * panel used to live as a tab of the Quran page; it moved here unchanged
 * except the removed default-city field. There is NO default city anymore —
 * visitors get their location from the browser (auto-locate once per
 * session) or pick a place on the /adhan page; times never silently fall
 * back to any city. This panel keeps only the two site-wide defaults:
 * calculation method + madhab (Asr), written to `adhan.defaults`
 * {calculation_method, madhab} via PUT /api/v1/admin/settings.
 */

const MADHABS: { id: Madhab; key: string }[] = [
  { id: "hanafi", key: "quran.madhabHanafi" },
  { id: "shafi", key: "quran.madhabShafi" },
];

export default function Adhan(): React.ReactElement {
  const { t } = useI18n();
  const settings = useQuranSettingsQuery();
  const writer = useWriteQuranKeys();
  const [adhan, setAdhan] = React.useState<AdhanDefaults>(DEFAULT_ADHAN);
  const [savedTick, setSavedTick] = React.useState(0);

  React.useEffect(() => {
    if (settings.data) setAdhan(parseAdhanDefaults(settings.data[QURAN_SETTINGS_KEYS.adhanDefaults]));
  }, [settings.data]);

  if (settings.isLoading)
    return (
      <div className="page">
        <div className="empty">{t("common.loading")}</div>
      </div>
    );
  if (settings.isError)
    return (
      <div className="page">
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="page" style={{ maxWidth: "1100px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>{t("nav.adhan")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <section className="panel" aria-label={t("nav.adhan")}>
        <div className="panel-head">
          <h2>{t("nav.adhan")}</h2>
          <span className="panel-hint">{t("quran.adhanHint")}</span>
        </div>

        <div className="field">
          <label htmlFor="adhan-method">{t("quran.adhanMethod")}</label>
          <select
            id="adhan-method"
            className="input"
            style={{ maxWidth: "320px" }}
            value={adhan.calculation_method}
            onChange={(e) => setAdhan((a) => ({ ...a, calculation_method: e.target.value }))}
          >
            <option value="">{t("quran.selectPlaceholder")}</option>
            {ADHAN_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`quran.method_${m}`)} ({m})
              </option>
            ))}
          </select>
          <span className="hint">{t("quran.adhanMethodHint")}</span>
        </div>

        <div className="field">
          <span className="field-label">{t("quran.adhanMadhab")}</span>
          <div
            style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}
            role="radiogroup"
            aria-label={t("quran.adhanMadhab")}
          >
            {MADHABS.map((m) => (
              <label className="check-row" key={m.id}>
                <input
                  type="radio"
                  name="adhan-madhab"
                  checked={adhan.madhab === m.id}
                  onChange={() => setAdhan((a) => ({ ...a, madhab: m.id }))}
                />
                {t(m.key)}
              </label>
            ))}
          </div>
        </div>

        <SaveRow
          pending={writer.isPending}
          savedTick={savedTick}
          error={writer.isError ? writer.error : null}
          onSave={() =>
            writer.mutate(
              { [QURAN_SETTINGS_KEYS.adhanDefaults]: adhan },
              { onSuccess: () => setSavedTick((n) => n + 1) },
            )
          }
        />
      </section>
    </div>
  );
}
