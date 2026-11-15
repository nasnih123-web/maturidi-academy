import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button } from "@maturidi/ui-web";
import { apiFetch, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * Platform settings (super_admin only — Phase 2 spec).
 *
 * Tabbed layout: every tab (AI / Telegram / gateway / card-to-card /
 * crypto / PayPal / comms) saves INDEPENDENTLY — its payload carries
 * only that tab's keys, so one tab's empty or invalid fields can never
 * fail another tab's save. The payment area is split per donation
 * method on purpose: the operator can enable ONLY card-to-card, with
 * every other method unset, and save it successfully.
 *
 * Field kinds:
 * - secret: write-only; the API never returns values and the input
 *   starts empty. Empty secret = no change (never sent).
 * - flag: boolean setting rendered as a select (unset/on/off) — the
 *   operator no longer types raw "true/false" text.
 * - localized: trilingual object; the input edits the fa text and
 *   preserves any stored ar/en texts.
 * - json: structured value edited as JSON text (crypto wallets).
 * - text: plain string/number input.
 *
 * Server errors are shown verbatim (they name the failing key) instead
 * of a generic failure badge.
 */

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

type FieldKind = "text" | "secret" | "flag" | "localized" | "json";

interface FieldDef {
  key: string;
  labelKey: string;
  kind: FieldKind;
}

interface TabDef {
  id: string;
  titleKey: string;
  fields: FieldDef[];
}

const TABS: TabDef[] = [
  {
    id: "ai",
    titleKey: "settings.sections.ai",
    fields: [
      { key: "ai.model", labelKey: "settings.fields.model", kind: "text" },
      { key: "ai.api_key", labelKey: "settings.fields.apiKey", kind: "secret" },
      { key: "ai.fallback_model", labelKey: "settings.fields.fallback", kind: "text" },
      // Phase 6 AI production controls (backend track registers these in SETTING_DEFS).
      { key: "ai.provider", labelKey: "settings.fields.aiProvider", kind: "text" },
      { key: "ai.claude_model", labelKey: "settings.fields.aiClaudeModel", kind: "text" },
      { key: "ai.daily_quota_per_user", labelKey: "settings.fields.aiDailyQuota", kind: "text" },
      { key: "ai.rate_per_minute", labelKey: "settings.fields.aiRatePerMinute", kind: "text" },
      { key: "ai.external_research_enabled", labelKey: "settings.fields.aiExternalResearch", kind: "flag" },
    ],
  },
  {
    id: "telegram",
    titleKey: "settings.sections.telegram",
    fields: [
      { key: "telegram.bot_token", labelKey: "settings.fields.botToken", kind: "secret" },
      { key: "telegram.api_id", labelKey: "settings.fields.telegramApiId", kind: "secret" },
      { key: "telegram.api_hash", labelKey: "settings.fields.telegramApiHash", kind: "secret" },
      { key: "telegram.channel", labelKey: "settings.fields.channel", kind: "text" },
    ],
  },
  {
    id: "gateway",
    titleKey: "settings.sections.gateway",
    fields: [
      { key: "payment.zarinpal_key", labelKey: "settings.fields.zarinpal", kind: "secret" },
      { key: "payment.idpay_key", labelKey: "settings.fields.idpay", kind: "secret" },
      { key: "payment.idpay_sandbox", labelKey: "settings.fields.idpaySandbox", kind: "flag" },
      { key: "donation.online_enabled", labelKey: "settings.fields.donationOnline", kind: "flag" },
    ],
  },
  {
    id: "card",
    titleKey: "settings.sections.card",
    fields: [
      { key: "donation.card_enabled", labelKey: "settings.fields.donationCardEnabled", kind: "flag" },
      { key: "donation.card_number", labelKey: "settings.fields.donationCardNumber", kind: "text" },
      { key: "donation.card_holder", labelKey: "settings.fields.donationCardHolder", kind: "text" },
      { key: "donation.card_instructions", labelKey: "settings.fields.donationCardInstructions", kind: "localized" },
    ],
  },
  {
    id: "crypto",
    titleKey: "settings.sections.crypto",
    fields: [
      { key: "donation.crypto_enabled", labelKey: "settings.fields.donationCryptoEnabled", kind: "flag" },
      { key: "donation.crypto_wallets", labelKey: "settings.fields.donationCryptoWallets", kind: "json" },
      { key: "donation.crypto_instructions", labelKey: "settings.fields.donationCryptoInstructions", kind: "localized" },
    ],
  },
  {
    id: "paypal",
    titleKey: "settings.sections.paypal",
    fields: [
      { key: "donation.paypal_enabled", labelKey: "settings.fields.donationPaypalEnabled", kind: "flag" },
      { key: "donation.paypal_account", labelKey: "settings.fields.donationPaypalAccount", kind: "text" },
      { key: "donation.paypal_instructions", labelKey: "settings.fields.donationPaypalInstructions", kind: "localized" },
    ],
  },
  {
    id: "comms",
    titleKey: "settings.sections.comms",
    fields: [
      { key: "email.smtp_password", labelKey: "settings.fields.emailKey", kind: "secret" },
      { key: "sms.api_key", labelKey: "settings.fields.smsKey", kind: "secret" },
    ],
  },
];

type Values = Record<string, unknown>;

function normalizeFlag(v: unknown): boolean | null {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return null;
}

function seedValues(data: SettingsResponse): Values {
  const server = new Map<string, SettingItem>();
  for (const item of data.settings ?? []) server.set(item.key, item);
  const next: Values = {};
  for (const tab of TABS) {
    for (const f of tab.fields) {
      if (f.kind === "secret") continue; // secrets always start empty
      const item = server.get(f.key);
      const v = item && !item.masked ? item.value : null;
      if (f.kind === "flag") {
        next[f.key] = normalizeFlag(v);
      } else if (f.kind === "localized") {
        next[f.key] =
          v && typeof v === "object" ? v : typeof v === "string" && v ? { fa: v } : null;
      } else if (f.kind === "json") {
        next[f.key] =
          v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2);
      } else {
        next[f.key] = v ?? null;
      }
    }
  }
  return next;
}

/** Build one tab's save payload — only that tab's keys, empties omitted. */
function buildPayload(tab: TabDef, values: Values): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of tab.fields) {
    const v = values[f.key];
    switch (f.kind) {
      case "secret":
        // Only a freshly typed secret is sent; empty means "no change".
        if (typeof v === "string" && v !== "") payload[f.key] = v;
        break;
      case "flag":
        if (v === true || v === false) payload[f.key] = v;
        break;
      case "localized": {
        if (v && typeof v === "object") {
          const obj = v as Record<string, unknown>;
          const hasText = Object.values(obj).some(
            (x) => typeof x === "string" && x.trim() !== "",
          );
          if (hasText) payload[f.key] = obj;
        } else if (typeof v === "string" && v.trim() !== "") {
          payload[f.key] = { fa: v };
        }
        break;
      }
      case "json":
        if (typeof v === "string" && v.trim() !== "") payload[f.key] = v;
        break;
      default: // text
        if (v !== undefined && v !== null) payload[f.key] = v;
    }
  }
  return payload;
}

export default function Settings(): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<string>(TABS[0].id);
  const [values, setValues] = React.useState<Values>({});
  const [savedTab, setSavedTab] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<{ tab: string; message: string } | null>(null);
  const seededRef = React.useRef(false);

  const settingsQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => apiFetch<SettingsResponse>("/api/v1/admin/settings"),
  });

  // Seed the form once from the server snapshot. Later refetches must
  // not wipe unsaved edits in other tabs (the old page reseeded on
  // every refetch and silently discarded typed values).
  React.useEffect(() => {
    if (settingsQuery.data && !seededRef.current) {
      seededRef.current = true;
      setValues(seedValues(settingsQuery.data));
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: ({ payload }: { tab: string; payload: Record<string, unknown> }) =>
      apiFetch<SettingsResponse>("/api/v1/admin/settings", {
        method: "PUT",
        body: { settings: payload },
      }),
    onSuccess: (_data, variables) => {
      // Secrets are write-only: clear only the saved tab's secret inputs.
      const tabDef = TABS.find((x) => x.id === variables.tab);
      setValues((prev) => {
        const next: Values = { ...prev };
        for (const f of tabDef?.fields ?? []) {
          if (f.kind === "secret") next[f.key] = "";
        }
        return next;
      });
      setSavedTab(variables.tab);
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      window.setTimeout(() => setSavedTab(null), 3000);
    },
    onError: (error, variables) => {
      // Show the server's field-specific message (it names the key).
      setSaveError({
        tab: variables.tab,
        message: error instanceof ApiError ? error.message : t("common.error"),
      });
      setSavedTab(null);
    },
  });

  function handleSave(tabDef: TabDef): void {
    setSaveError(null);
    saveMutation.mutate({ tab: tabDef.id, payload: buildPayload(tabDef, values) });
  }

  function setValue(key: string, v: unknown): void {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function renderField(f: FieldDef): React.ReactElement {
    const v = values[f.key];
    if (f.kind === "flag") {
      const flag = normalizeFlag(v);
      return (
        <div className="field" key={f.key}>
          <label htmlFor={f.key}>{t(f.labelKey)}</label>
          <select
            id={f.key}
            className="input"
            value={flag === null ? "" : String(flag)}
            onChange={(e) =>
              setValue(f.key, e.target.value === "" ? null : e.target.value === "true")
            }
          >
            <option value="">{t("settings.flagUnset")}</option>
            <option value="true">{t("settings.flagOn")}</option>
            <option value="false">{t("settings.flagOff")}</option>
          </select>
        </div>
      );
    }
    if (f.kind === "localized") {
      const obj = (v && typeof v === "object" ? (v as Record<string, unknown>) : {}) as Record<
        string,
        unknown
      >;
      const faText = typeof obj.fa === "string" ? obj.fa : typeof v === "string" ? v : "";
      return (
        <div className="field" key={f.key}>
          <label htmlFor={f.key}>{t(f.labelKey)}</label>
          <input
            id={f.key}
            className="input"
            type="text"
            autoComplete="off"
            value={faText}
            onChange={(e) => setValue(f.key, { ...obj, fa: e.target.value })}
          />
        </div>
      );
    }
    if (f.kind === "json") {
      return (
        <div className="field" key={f.key}>
          <label htmlFor={f.key}>{t(f.labelKey)}</label>
          <textarea
            id={f.key}
            className="input"
            dir="ltr"
            rows={5}
            autoComplete="off"
            value={typeof v === "string" ? v : ""}
            onChange={(e) => setValue(f.key, e.target.value)}
          />
          <span className="hint">{t("settings.walletsHint")}</span>
        </div>
      );
    }
    const isSecret = f.kind === "secret";
    return (
      <div className="field" key={f.key}>
        <label htmlFor={f.key}>{t(f.labelKey)}</label>
        <input
          id={f.key}
          className="input"
          type={isSecret ? "password" : "text"}
          autoComplete="off"
          placeholder={isSecret ? t("settings.secretPlaceholder") : undefined}
          value={typeof v === "string" || typeof v === "number" ? String(v) : ""}
          onChange={(e) => setValue(f.key, e.target.value)}
        />
        {isSecret && <span className="hint">{t("settings.secretHint")}</span>}
      </div>
    );
  }

  const activeTab = TABS.find((x) => x.id === tab) ?? TABS[0];

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
          <div className="tabs" role="tablist" style={{ marginBottom: "1rem" }}>
            {TABS.map((tabDef) => (
              <button
                key={tabDef.id}
                type="button"
                role="tab"
                aria-selected={tab === tabDef.id}
                className={`tab${tab === tabDef.id ? " active" : ""}`}
                onClick={() => setTab(tabDef.id)}
              >
                {t(tabDef.titleKey)}
              </button>
            ))}
          </div>

          <section className="panel" aria-label={t(activeTab.titleKey)}>
            <div className="panel-head">
              <h2>{t(activeTab.titleKey)}</h2>
            </div>
            {activeTab.fields.map((f) => renderField(f))}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn-gold"
                onClick={() => handleSave(activeTab)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? t("settings.saving") : t("settings.save")}
              </button>
              {savedTab === activeTab.id && <Badge tone="success">{t("settings.saved")}</Badge>}
              {saveError && saveError.tab === activeTab.id && (
                <span className="form-error" style={{ marginBottom: 0 }}>
                  {saveError.message}
                </span>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
