import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button } from "@maturidi/ui-web";
import { apiFetch, ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { COUNTRIES, countryFlag } from "../lib/countries";

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
 * - smsCountries: searchable country checklist stored as a JSON array
 *   of ISO codes (auth.sms_required_countries) — always saved, because
 *   the empty list is itself the meaningful "email for everyone" state.
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

type FieldKind = "text" | "secret" | "flag" | "localized" | "json" | "smsCountries" | "socialLinks";

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
  {
    // Phase B: section gating — when a flag is on, signed-in users
    // with an incomplete profile are walled out of that section (web
    // wall + API 403 profile_incomplete). Off/unset = today's behavior.
    id: "profile",
    titleKey: "settings.sections.profile",
    fields: [
      { key: "profile.require_for_fatwa_question", labelKey: "settings.fields.profileRequireFatwa", kind: "flag" },
      { key: "profile.require_for_hifz_advanced", labelKey: "settings.fields.profileRequireHifz", kind: "flag" },
    ],
  },
  {
    // شبکه‌های اجتماعی منوی سایت (site.social_links): لینک و ترتیب و
    // فعال/غیرفعال هر شبکه؛ وب فقط فعال‌های دارای لینک را نشان می‌دهد.
    id: "social",
    titleKey: "settings.sections.social",
    fields: [
      { key: "site.social_links", labelKey: "settings.fields.socialLinks", kind: "socialLinks" },
    ],
  },
  {
    // Registration verification policy: listed countries must verify
    // by SMS; everywhere else email is enough. Empty (the default) =
    // no SMS requirement — the state the operator wants while no SMS
    // panel is connected yet.
    id: "auth",
    titleKey: "settings.sections.auth",
    fields: [
      { key: "auth.sms_required_countries", labelKey: "settings.fields.smsRequiredCountries", kind: "smsCountries" },
    ],
  },
];

type Values = Record<string, unknown>;

/** شبکه‌های اجتماعی شناخته‌شده — همان مجموعهٔ API (SOCIAL_NETWORKS). */
const SOCIAL_NETWORKS = [
  "telegram",
  "instagram",
  "whatsapp",
  "youtube",
  "aparat",
  "eitaa",
  "bale",
  "x",
  "facebook",
] as const;

interface SocialLink {
  network: string;
  url: string;
  enabled: boolean;
  /** لوگوی دلخواه: data-URI تصویر فشرده (≤128px) یا URL؛ خالی = آیکن آماده. */
  logo: string;
}

/** تصویر انتخاب‌شده را روی canvas تا حداکثر ۱۲۸px کوچک و به data-URI
 * فشرده تبدیل می‌کند تا داخل همان تنظیم ذخیره شود (بدون نیاز به آپلود
 * جدا). اگر حتی در ۶۴px هم از سقف سرور بزرگ‌تر شد، رشتهٔ خالی برمی‌گردد. */
function fileToLogoDataUri(file: File, done: (uri: string) => void): void {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    for (const size of [128, 96, 64]) {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const uri = canvas.toDataURL("image/webp", 0.85);
      if (uri.startsWith("data:image/") && uri.length <= 60000) {
        done(uri);
        return;
      }
    }
    done("");
  };
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    done("");
  };
  img.src = objectUrl;
}

/** نرمال‌سازی مقدار site.social_links: ردیف‌های ذخیره‌شده (با ترتیبشان)
 * + بقیهٔ شبکه‌ها در انتها — تا ویرایشگر همیشه هر ۹ شبکه را نشان دهد. */
function normalizeSocialLinks(v: unknown): SocialLink[] {
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const network = typeof o.network === "string" ? o.network : "";
      if (!(SOCIAL_NETWORKS as readonly string[]).includes(network) || seen.has(network)) {
        continue;
      }
      seen.add(network);
      out.push({
        network,
        url: typeof o.url === "string" ? o.url : "",
        enabled: o.enabled !== false,
        logo: typeof o.logo === "string" ? o.logo : "",
      });
    }
  }
  for (const network of SOCIAL_NETWORKS) {
    if (!seen.has(network)) out.push({ network, url: "", enabled: true, logo: "" });
  }
  return out;
}

/** ویرایشگر شبکه‌های اجتماعی منوی سایت: لینک + فعال/غیرفعال + ترتیب. */
function SocialLinksField({
  value,
  onChange,
  t,
}: {
  value: SocialLink[];
  onChange: (next: SocialLink[]) => void;
  t: (key: string) => string;
}): React.ReactElement {
  const [logoError, setLogoError] = React.useState("");
  const update = (i: number, patch: Partial<SocialLink>): void => {
    onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const pickLogo = (i: number, file: File | undefined): void => {
    if (!file) return;
    fileToLogoDataUri(file, (uri) => {
      if (uri) {
        setLogoError("");
        update(i, { logo: uri });
      } else {
        setLogoError(t("settings.fields.socialLogoTooLarge"));
      }
    });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {value.map((row, i) => (
        <div
          key={row.network}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            aria-label={t(`settings.fields.network_${row.network}`)}
          />
          <span style={{ minWidth: "6.5rem", fontWeight: 600 }}>
            {t(`settings.fields.network_${row.network}`)}
          </span>
          {row.logo ? (
            <img
              src={row.logo}
              alt=""
              style={{
                width: "1.9rem",
                height: "1.9rem",
                borderRadius: "50%",
                objectFit: "contain",
                border: "1px solid rgba(212,175,55,0.5)",
              }}
            />
          ) : null}
          <label className="btn" style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
            {t("settings.fields.socialLogo")}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pickLogo(i, e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {row.logo ? (
            <button
              type="button"
              className="btn"
              onClick={() => update(i, { logo: "" })}
              aria-label={t("settings.fields.socialLogoRemove")}
            >
              ×
            </button>
          ) : null}
          <input
            className="input"
            type="url"
            dir="ltr"
            style={{ flex: 1 }}
            value={row.url}
            placeholder={t("settings.fields.socialUrlPlaceholder")}
            onChange={(e) => update(i, { url: e.target.value })}
          />
          <button
            type="button"
            className="btn"
            onClick={() => move(i, -1)}
            disabled={i === 0}
            aria-label={t("settings.fields.socialMoveUp")}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => move(i, 1)}
            disabled={i === value.length - 1}
            aria-label={t("settings.fields.socialMoveDown")}
          >
            ↓
          </button>
        </div>
      ))}
      {logoError ? (
        <div style={{ color: "#e57373", fontSize: "0.85rem" }}>{logoError}</div>
      ) : null}
    </div>
  );
}

/** Searchable checklist of all countries for auth.sms_required_countries. */
function SmsCountriesField({
  value,
  onChange,
  t,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  t: (key: string) => string;
}): React.ReactElement {
  const [q, setQ] = React.useState("");
  const selected = new Set(value);
  const needle = q.trim().toLowerCase();
  const list = COUNTRIES.filter(
    (c) =>
      !needle ||
      c.nameFa.toLowerCase().includes(needle) ||
      c.iso.toLowerCase().includes(needle),
  );
  const toggle = (iso: string): void => {
    const next = new Set(selected);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    // Keep table order so the saved list is stable and diff-friendly.
    onChange(COUNTRIES.map((c) => c.iso).filter((code) => next.has(code)));
  };
  return (
    <div>
      <input
        className="input"
        type="search"
        value={q}
        placeholder={t("settings.fields.smsCountriesSearch")}
        onChange={(e) => setQ(e.target.value)}
      />
      {value.length === 0 && <p className="hint">{t("settings.fields.smsCountriesNone")}</p>}
      <div
        style={{
          maxHeight: "260px",
          overflowY: "auto",
          marginTop: "0.5rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "0.25rem 0.75rem",
        }}
      >
        {list.map((c) => (
          <label
            key={c.iso}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={selected.has(c.iso)}
              onChange={() => toggle(c.iso)}
            />
            <span>
              {countryFlag(c.iso)} {c.nameFa} <span className="hint mono">{c.iso}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

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
      } else if (f.kind === "smsCountries") {
        next[f.key] = Array.isArray(v) ? v : [];
      } else if (f.kind === "socialLinks") {
        next[f.key] = normalizeSocialLinks(v);
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
      case "smsCountries":
        // Always sent — the empty list is a real state (email for all).
        payload[f.key] = Array.isArray(v) ? v : [];
        break;
      case "socialLinks":
        // Always sent — order/enabled/url are all meaningful state.
        payload[f.key] = normalizeSocialLinks(v);
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
    if (f.kind === "socialLinks") {
      const rows = normalizeSocialLinks(v);
      return (
        <div className="field" key={f.key}>
          <label>{t(f.labelKey)}</label>
          <SocialLinksField value={rows} onChange={(next) => setValue(f.key, next)} t={t} />
          <span className="hint">{t("settings.fields.socialLinksHint")}</span>
        </div>
      );
    }
    if (f.kind === "smsCountries") {
      const arr = Array.isArray(v) ? (v as string[]) : [];
      return (
        <div className="field" key={f.key}>
          <label>{t(f.labelKey)}</label>
          <SmsCountriesField value={arr} onChange={(next) => setValue(f.key, next)} t={t} />
          <span className="hint">{t("settings.fields.smsCountriesHint")}</span>
        </div>
      );
    }
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
