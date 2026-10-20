import React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { useMetabaseUrl, METABASE_URL_KEY } from "../lib/ops14";
import { useI18n } from "../lib/i18n";

/**
 * Phase 14 — Track 3 (CRM): BI page embedding Metabase.
 *
 * The Metabase base URL is a non-secret platform setting (key
 * "bi.metabase_url"). Metabase itself is a separate service started with
 *   docker compose -f infra/metabase/docker-compose.metabase.yml up
 * — this page only embeds/links to it; it never re-implements BI.
 *
 * Renders only; the settings read lives in lib/ops14.ts (ADR-001).
 */

const DASHBOARDS = [
  "user_growth",
  "module_engagement",
  "popular_content",
  "fatwa_volume",
  "widget_embeds",
  "conversion_funnel",
  "finance_reports",
] as const;

export default function Analytics(): React.ReactElement {
  const { t } = useI18n();
  const metabaseUrl = useMetabaseUrl();

  return (
    <div className="page">
      <h1>{t("analytics14.title")}</h1>
      <p className="hint">{t("analytics14.hint")}</p>

      {!metabaseUrl ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("analytics14.notConfiguredTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{t("analytics14.notConfigured")}</p>
            <p className="hint">
              {t("analytics14.settingKey")}: <code dir="ltr">{METABASE_URL_KEY}</code>
            </p>
            <p className="hint">{t("analytics14.composeNote")}</p>
            <pre dir="ltr" className="conn-code">
              docker compose -f infra/metabase/docker-compose.metabase.yml up -d
            </pre>
          </CardContent>
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <a href={metabaseUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="primary">{t("analytics14.openMetabase")}</Button>
            </a>
          </div>
          <Card>
            <CardContent>
              <iframe
                title={t("analytics14.title")}
                src={metabaseUrl}
                className="bi-frame"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </CardContent>
          </Card>
        </>
      )}

      <Card style={{ marginTop: "1rem" }}>
        <CardHeader>
          <CardTitle>{t("analytics14.dashboardsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="hint" style={{ marginTop: 0 }}>{t("analytics14.dashboardsHint")}</p>
          <ul className="bi-dashboards">
            {DASHBOARDS.map((d) => (
              <li key={d}>
                <strong>{t(`analytics14.dash_${d}`)}</strong>
                <span className="hint"> — {t(`analytics14.dash_${d}_desc`)}</span>
              </li>
            ))}
          </ul>
          <p className="hint">
            <code dir="ltr">infra/metabase/seed-dashboards.md</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
