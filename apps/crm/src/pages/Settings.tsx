import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button } from "@maturidi/ui-web";
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

/** Backend shape: { settings: [{key, value, masked, type, updated_at}], version } */
interface SettingItem {
  key: string;
  value: unknown;
  masked: boolean;
  type: string;
  updated_at: string | null;
}

interface SettingsResponse {
  settings: SettingItem[];
  version: number;
}

function toMap(data: SettingsResponse | undefined): SettingsMap {
  const map: SettingsMap = {};
  for (const item of data?.settings ?? []) {
    map[item.key] = item.masked ? null : (item.value as string | null);
  }
  return map;
}

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
      { key: "ai.model", labelKey: "settings.fields.model", secret: false },
      { key: "ai.api_key", labelKey: "settings.fields.apiKey", secret: true },
      { key: "ai.fallback_model", labelKey: "settings.fields.fallback", secret: false },
      // Phase 6 AI production controls (backend track registers these in SETTING_DEFS).
      { key: "ai.provider", labelKey: "settings.fields.aiProvider", secret: false },
      { key: "ai.claude_model", labelKey: "settings.fields.aiClaudeModel", secret: false },
      { key: "ai.daily_quota_per_user", labelKey: "settings.fields.aiDailyQuota", secret: false },
      { key: "ai.rate_per_minute", labelKey: "settings.fields.aiRatePerMinute", secret: false },
      { key: "ai.external_research_enabled", labelKey: "settings.fields.aiExternalResearch", secret: false },
    ],
  },
  {
    titleKey: "settings.sections.telegram",
    fields: [
      { key: "telegram.bot_token", labelKey: "settings.fields.botToken", secret: true },
      { key: "telegram.api_id", labelKey: "settings.fields.telegramApiId", secret: true },
      { key: "telegram.api_hash", labelKey: "settings.fields.telegramApiHash", secret: true },
      { key: "telegram.channel", labelKey: "settings.fields.channel", secret: false },
    ],
  },
  {
    titleKey: "settings.sections.payments",
    fields: [
      { key: "payment.zarinpal_key", labelKey: "settings.fields.zarinpal", secret: true },
      { key: "payment.idpay_key", labelKey: "settings.fields.idpay", secret: true },
    ],
  },
  {
    titleKey: "settings.sections.comms",
    fields: [
      { key: "email.smtp_password", labelKey: "settings.fields.emailKey", secret: true },
      { key: "sms.api_key", labelKey: "settings.fields.smsKey", secret: true },
    ],
  },
];

export default function Settings(): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [values, setValues] = React.useState<SettingsMap>({});
  const [savedSection, setSavedSection] = React.useState<string | null>(null);
  const [failedSection, setFailedSection] = React.useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => apiFetch<SettingsResponse>("/api/v1/admin/settings"),
  });

  const saveMutation = useMutation({
    mutationFn: ({ payload }: { section: string; payload: SettingsMap }) =>
      apiFetch<SettingsResponse>("/api/v1/admin/settings", {
        method: "PUT",
        body: { settings: payload },
      }),
    onSuccess: (_data, variables) => {
      // Secrets are write-only: clear only the saved section's secret
      // inputs, keep everything else (including other sections' typed
      // secrets) so each section saves independently.
      const section = SECTIONS.find((s) => s.titleKey === variables.section);
      setValues((prev) => {
        const next: SettingsMap = { ...prev };
        for (const f of section?.fields ?? []) {
          if (f.secret) next[f.key] = null;
        }
        return next;
      });
      setSavedSection(variables.section);
      setFailedSection(null);
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      window.setTimeout(() => setSavedSection(null), 3000);
    },
    onError: (_error, variables) => {
      setFailedSection(variables.section);
    },
  });

  // Seed non-secret fields from the server; secret fields always start empty.
  React.useEffect(() => {
    if (settingsQuery.data) {
      const server = toMap(settingsQuery.data);
      const next: SettingsMap = {};
      for (const s of SECTIONS) {
        for (const f of s.fields) {
          if (!f.secret) next[f.key] = server[f.key] ?? null;
        }
      }
      setValues(next);
    }
  }, [settingsQuery.data]);

  // Each section saves on its own: the payload contains only that
  // section's fields, so a save never depends on (or fails because of)
  // any other section's values.
  function handleSaveSection(section: SectionDef): void {
    const payload: SettingsMap = {};
    for (const f of section.fields) {
      const v = values[f.key];
      // Only send secrets when the operator actually typed a new value.
      if (f.secret) {
        if (v !== undefined && v !== null && v !== "") payload[f.key] = v;
      } else if (v !== undefined && v !== null) {
        // Unset fields have no DB row; sending null makes the backend
        // reject the WHOLE save (400, all-or-nothing) and nothing
        // persists — including freshly typed secrets. Omit them instead;
        // clearing a field still sends "" and stores an empty string.
        payload[f.key] = v;
      }
    }
    setFailedSection(null);
    saveMutation.mutate({ section: section.titleKey, payload });
  }

  return (
    <div className="page" style={{ maxWidth: "900px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>{t("settings.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
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
            <section className="panel" key={section.titleKey} aria-label={t(section.titleKey)}>
              <div className="panel-head">
                <h2>{t(section.titleKey)}</h2>
              </div>
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
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                  {field.secret && <span className="hint">{t("settings.secretHint")}</span>}
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="btn-gold"
                  onClick={() => handleSaveSection(section)}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? t("settings.saving") : t("settings.save")}
                </button>
                {savedSection === section.titleKey && <Badge tone="success">{t("settings.saved")}</Badge>}
                {failedSection === section.titleKey && (
                  <span className="form-error" style={{ marginBottom: 0 }}>
                    {t("common.error")}
                  </span>
                )}
              </div>
            </section>
          ))}

        </>
      )}
    </div>
  );
}
