import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * Platform settings (super_admin only — Phase 2 spec).
 *
 * AI model/key + fallback, Telegram bot token/channel/session,
 * ZarinPal/IDPay keys, email/SMS provider keys — per the §3 secrets
 * architecture the values are encrypted server-side and take effect
 * without a restart.
 *
 * Secrets are NEVER displayed: existing values are not returned by the API
 * and inputs stay empty unless the operator types a new value.
 */

type SettingsMap = Record<string, string | null>;

interface FieldDef {
  key: string;
  labelKey: string;
  secret: boolean;
}

interface SectionDef {
  titleKey: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    titleKey: "settings.sections.ai",
    fields: [
      { key: "ai_model", labelKey: "settings.fields.model", secret: false },
      { key: "ai_api_key", labelKey: "settings.fields.apiKey", secret: true },
      { key: "ai_fallback_model", labelKey: "settings.fields.fallback", secret: false },
    ],
  },
  {
    titleKey: "settings.sections.telegram",
    fields: [
      { key: "telegram_bot_token", labelKey: "settings.fields.botToken", secret: true },
      { key: "telegram_channel", labelKey: "settings.fields.channel", secret: false },
      { key: "telegram_session", labelKey: "settings.fields.session", secret: true },
    ],
  },
  {
    titleKey: "settings.sections.payments",
    fields: [
      { key: "zarinpal_api_key", labelKey: "settings.fields.zarinpal", secret: true },
      { key: "idpay_api_key", labelKey: "settings.fields.idpay", secret: true },
    ],
  },
  {
    titleKey: "settings.sections.comms",
    fields: [
      { key: "email_provider_key", labelKey: "settings.fields.emailKey", secret: true },
      { key: "sms_provider_key", labelKey: "settings.fields.smsKey", secret: true },
    ],
  },
];

export default function Settings(): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [values, setValues] = React.useState<SettingsMap>({});
  const [saved, setSaved] = React.useState(false);

  const settingsQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => apiFetch<SettingsMap>("/api/v1/admin/settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: SettingsMap) =>
      apiFetch<SettingsMap>("/api/v1/admin/settings", { method: "PUT", body: payload }),
    onSuccess: () => {
      // Secrets are write-only: clear local inputs, keep non-secret values.
      setValues((prev) => {
        const next: SettingsMap = {};
        for (const s of SECTIONS) {
          for (const f of s.fields) {
            if (!f.secret) next[f.key] = prev[f.key] ?? null;
          }
        }
        return next;
      });
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      window.setTimeout(() => setSaved(false), 3000);
    },
  });

  // Seed non-secret fields from the server; secret fields always start empty.
  React.useEffect(() => {
    if (settingsQuery.data) {
      const next: SettingsMap = {};
      for (const s of SECTIONS) {
        for (const f of s.fields) {
          if (!f.secret) next[f.key] = settingsQuery.data[f.key] ?? null;
        }
      }
      setValues(next);
    }
  }, [settingsQuery.data]);

  function handleSave(): void {
    const payload: SettingsMap = {};
    for (const s of SECTIONS) {
      for (const f of s.fields) {
        const v = values[f.key];
        // Only send secrets when the operator actually typed a new value.
        if (f.secret) {
          if (v !== undefined && v !== null && v !== "") payload[f.key] = v;
        } else {
          payload[f.key] = v ?? null;
        }
      }
    }
    saveMutation.mutate(payload);
  }

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <h1 style={{ margin: 0 }}>{t("settings.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("settings.noRestart")}
      </p>

      {settingsQuery.isLoading && <div className="empty">{t("common.loading")}</div>}
      {settingsQuery.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settingsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {settingsQuery.data && (
        <>
          {SECTIONS.map((section) => (
            <Card key={section.titleKey} style={{ marginBottom: "1rem" }}>
              <CardHeader>
                <CardTitle>{t(section.titleKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                {section.fields.map((field) => (
                  <div className="field" key={field.key}>
                    <label htmlFor={field.key}>{t(field.labelKey)}</label>
                    <input
                      id={field.key}
                      className="input"
                      type={field.secret ? "password" : "text"}
                      autoComplete="off"
                      placeholder={field.secret ? t("settings.secretPlaceholder") : undefined}
                      value={values[field.key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                    {field.secret && (
                      <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                        {t("settings.secretHint")}
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              {saveMutation.isPending ? t("settings.saving") : t("settings.save")}
            </Button>
            {saved && <Badge tone="success">{t("settings.saved")}</Badge>}
            {saveMutation.isError && <span className="form-error" style={{ marginBottom: 0 }}>{t("common.error")}</span>}
          </div>
        </>
      )}
    </div>
  );
}
