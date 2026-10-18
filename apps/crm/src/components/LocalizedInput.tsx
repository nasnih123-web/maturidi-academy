import React from "react";
import { EMPTY_L10N, LocalizedText } from "../lib/contentApi";
import { LOCALES, useI18n, type Locale } from "../lib/i18n";

/**
 * Trilingual text field (contract §15.4 — no hardcoded user-visible text).
 * Renders locale tabs; emits the full LocalizedText on change.
 * Presentation only: value/onChange are owned by the caller.
 */
export default function LocalizedInput({
  id,
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
}: {
  id: string;
  label: string;
  value: LocalizedText;
  onChange: (v: LocalizedText) => void;
  multiline?: boolean;
  rows?: number;
}): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<Locale>("fa");
  const merged: LocalizedText = { ...EMPTY_L10N, ...value };

  const dirFor = (l: Locale): "rtl" | "ltr" => (l === "en" ? "ltr" : "rtl");

  return (
    <div className="field">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.35rem",
        }}
      >
        <label htmlFor={`${id}-${tab}`} style={{ marginBottom: 0 }}>
          {label}
        </label>
        <div role="tablist" aria-label={label} style={{ display: "flex", gap: "0.25rem" }}>
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={tab === l}
              onClick={() => setTab(l)}
              className="input"
              style={{
                width: "auto",
                padding: "0.15rem 0.6rem",
                fontSize: "0.75rem",
                cursor: "pointer",
                background:
                  tab === l ? "var(--x-gold)" : "transparent",
                color: tab === l ? "#1a1408" : "var(--x-text2)",
                border:
                  tab === l
                    ? "1px solid var(--x-gold)"
                    : "1px solid var(--x-line)",
                borderRadius: "999px",
                minWidth: "2.2rem",
              }}
            >
              {t(`studio.locale_${l}`)}
            </button>
          ))}
        </div>
      </div>
      {multiline ? (
        <textarea
          id={`${id}-${tab}`}
          className="input"
          dir={dirFor(tab)}
          rows={rows}
          value={merged[tab]}
          onChange={(e) => onChange({ ...merged, [tab]: e.target.value })}
        />
      ) : (
        <input
          id={`${id}-${tab}`}
          className="input"
          dir={dirFor(tab)}
          value={merged[tab]}
          onChange={(e) => onChange({ ...merged, [tab]: e.target.value })}
        />
      )}
    </div>
  );
}
