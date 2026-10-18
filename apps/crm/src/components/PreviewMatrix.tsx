import React from "react";
import { Badge } from "@maturidi/ui-web";
import { LocalizedText } from "../lib/contentApi";
import { LOCALES, useI18n, type Locale } from "../lib/i18n";

/**
 * Preview Matrix (§9.5 Preview): renders a content item the way the target
 * surface will show it, in fa/ar/en with correct RTL/LTR, BEFORE publish.
 *
 * Preferred source is the web app's preview route in an iframe
 * (`VITE_WEB_URL/preview?kind=…&id=…&locale=…` — set when the web track
 * ships it); until then it falls back to a locale-switched render of the
 * content data itself. Either way the operator sees direction, fonts and
 * localized text exactly as the audience will.
 *
 * Presentation only: `render` turns the item + locale into JSX; the matrix
 * handles locale/surface switching and the iframe fallback.
 */
export type PreviewSurface = "web" | "mobile" | "desktop" | "telegram";

export const PREVIEW_SURFACES: PreviewSurface[] = ["web", "mobile", "desktop", "telegram"];

export default function PreviewMatrix({
  kind,
  itemId,
  surfaces = PREVIEW_SURFACES,
  render,
}: {
  /** Content kind for the web preview route, e.g. "banner", "page", "event". */
  kind: string;
  itemId: string;
  surfaces?: PreviewSurface[];
  render: (item: { locale: Locale; dir: "rtl" | "ltr" }) => React.ReactNode;
}): React.ReactElement {
  const { t } = useI18n();
  const [locale, setLocale] = React.useState<Locale>("fa");
  const [surface, setSurface] = React.useState<PreviewSurface>(surfaces[0]);
  const [mode, setMode] = React.useState<"data" | "iframe">("data");

  const webUrl = (import.meta.env.VITE_WEB_URL as string | undefined)?.replace(/\/$/, "");
  const iframeSrc = webUrl
    ? `${webUrl}/preview?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(itemId)}&locale=${locale}&surface=${surface}`
    : null;

  const dir: "rtl" | "ltr" = locale === "en" ? "ltr" : "rtl";
  const width = surface === "mobile" ? "390px" : surface === "desktop" ? "1280px" : "100%";

  return (
    <div>
      <div
        className="toolbar"
        style={{ marginBottom: "0.75rem", gap: "0.5rem" }}
      >
        <span className="hint" style={{ margin: 0 }}>
          {t("studio.previewMatrix")}
        </span>
        <div style={{ display: "flex", gap: "0.25rem" }} role="tablist" aria-label={t("studio.locale")}>
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={locale === l}
              onClick={() => setLocale(l)}
              className="input"
              style={{
                width: "auto",
                padding: "0.2rem 0.7rem",
                fontSize: "0.78rem",
                cursor: "pointer",
                borderRadius: "999px",
                background: locale === l ? "var(--x-gold)" : "transparent",
                color: locale === l ? "#1a1408" : "var(--x-text2)",
                border: `1px solid ${locale === l ? "var(--x-gold)" : "var(--x-line)"}`,
              }}
            >
              {t(`studio.locale_${l}`)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {surfaces.map((s) => (
            <Badge
              key={s}
              tone={surface === s ? "info" : "neutral"}
              style={{ cursor: "pointer" }}
              // Badge has no onClick prop typed; wrap in button semantics via span role
              // — keep simple: clickable chip
            >
              <span
                role="button"
                tabIndex={0}
                onClick={() => setSurface(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSurface(s);
                  }
                }}
              >
                {t(`studio.surface_${s}`)}
              </span>
            </Badge>
          ))}
        </div>
        {iframeSrc && (
          <button
            type="button"
            className="input"
            style={{ width: "auto", fontSize: "0.78rem", cursor: "pointer", borderRadius: "999px" }}
            onClick={() => setMode(mode === "data" ? "iframe" : "data")}
          >
            {mode === "data" ? t("studio.useWebPreview") : t("studio.useDataPreview")}
          </button>
        )}
      </div>

      <div
        dir={dir}
        lang={locale}
        style={{
          border: "1px solid var(--x-line)",
          borderRadius: "0.75rem",
          overflow: "hidden",
          background: "var(--x-bg2)",
          maxWidth: width,
          marginInline: "auto",
          transition: "max-width 0.25s ease",
        }}
      >
        <div
          className="hint"
          style={{
            padding: "0.35rem 0.75rem",
            borderBottom: "1px solid var(--x-line)",
            margin: 0,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>
            {t(`studio.locale_${locale}`)} · {t(`studio.surface_${surface}`)}
          </span>
          <span dir="ltr">{dir.toUpperCase()}</span>
        </div>
        {mode === "iframe" && iframeSrc ? (
          <iframe
            title={`${kind}-${itemId}-${locale}`}
            src={iframeSrc}
            style={{ width: "100%", height: "520px", border: 0, background: "#fff" }}
          />
        ) : (
          <div style={{ padding: "1rem" }}>{render({ locale, dir })}</div>
        )}
      </div>
      {!iframeSrc && (
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {t("studio.noWebPreview")}
        </p>
      )}
    </div>
  );
}

/** Pick the right LocalizedText variant for a preview locale. */
export function pickLocaleText(v: LocalizedText | null | undefined, locale: Locale): string {
  if (!v) return "";
  return v[locale] || v.fa || v.ar || v.en || "";
}
