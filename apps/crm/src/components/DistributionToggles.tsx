import React from "react";
import { DISTRIBUTION_CHANNELS, DistributionPolicy } from "../lib/contentApi";
import { useI18n } from "../lib/i18n";

/**
 * §9.5 Distribution Policy toggles — each channel (web/mobile/desktop/
 * telegram/ai_knowledge) is independently on/off. Publishing the item
 * ≠ publishing everywhere: these toggles are the per-channel gate.
 * Presentation only: value/onChange owned by the caller.
 */
export default function DistributionToggles({
  value,
  onChange,
}: {
  value: Partial<DistributionPolicy>;
  onChange: (v: Partial<DistributionPolicy>) => void;
}): React.ReactElement {
  const { t } = useI18n();

  return (
    <fieldset
      style={{
        border: "1px solid var(--x-line)",
        borderRadius: "0.6rem",
        padding: "0.75rem 1rem",
        margin: 0,
      }}
    >
      <legend
        className="hint"
        style={{ padding: "0 0.5rem", marginBottom: 0 }}
      >
        {t("content.distribution")}
      </legend>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {DISTRIBUTION_CHANNELS.map((ch) => (
          <label
            key={ch}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.85rem",
              color: "var(--x-text2)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={value[ch] === true}
              onChange={(e) => onChange({ ...value, [ch]: e.target.checked })}
            />
            {t(`studio.channel_${ch}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
