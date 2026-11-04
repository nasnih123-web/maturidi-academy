import React from "react";
import { Badge, Button } from "@maturidi/ui-web";
import { LOCALES, useI18n, type Locale } from "../lib/i18n";
import {
  DEFAULT_MUNAJAT_WINDOW,
  DEFAULT_PLAYBACK,
  QURAN_SETTINGS_KEYS,
  errText,
  isTimeString,
  moveString,
  parseActiveLanguages,
  parseCustomProviders,
  parseFlag,
  parseFontSize,
  parseHighlightMode,
  parseDisplayFont,
  parseDisplayTheme,
  parseMadhhabDefault,
  parseMunajatWindow,
  parsePhotosMap,
  parsePlainString,
  parsePlayback,
  parsePlayerSpeed,
  parseProvidersByType,
  parseWaveformStyle,
  parseStringList,
  setCustomProviderKey,
  useQuranProvidersQuery,
  useQuranSettingsQuery,
  useWriteQuranKeys,
  type CustomProviderInfo,
  type DisplayFont,
  type DisplayTheme,
  type HighlightMode,
  type MunajatWindow,
  type PlaybackConfig,
  type ProviderContentType,
  type QuranMadhhab,
  type RepeatMode,
  type WaveformStyle,
} from "../lib/quran";

/**
 * Quran management (مدیریت قرآن) — super_admin only.
 *
 * Three configuration areas backed by platform_settings (Phase 5, json type,
 * keys as registered by the Track 1 backend — see lib/quran.ts):
 *   1. Providers → quran.providers_by_type (one provider per content type),
 *      quran.custom_providers, quran.qf_base_url / qf_client_id /
 *      qf_client_secret, quran.translations, quran.tafsirs, quran.reciters
 *      (Phase 2 registry; the old single quran.provider radio is gone)
 *   2. Display   → quran.active_languages, quran.show_translation,
 *                   quran.show_tafsir, quran.highlight_mode, quran.font_size,
 *                   quran.playback, quran.madhhab_default,
 *                   quran.player_default_speed, quran.player_show_photo
 *   3. Munajat   → munajat.enabled, munajat.window
 * (Adhan moved to its own section — pages/Adhan.tsx, route /adhan —
 * since 2026-10-28; it is no longer a tab here.)
 *
 * Values are sent to PUT /api/v1/admin/settings as parsed JSON values
 * (dict/list/bool/str/number) — that is what the backend validators expect
 * (see encode_setting_value / the phase-5 tests).
 *
 * Canonical-text integrity: the Quran text is NOT editable from the CRM.
 * There is deliberately no text-editing affordance for ayahs anywhere here.
 */

type QuranTab = "providers" | "display" | "munajat";
const TABS: QuranTab[] = ["providers", "display", "munajat"];

const TAB_KEY: Record<QuranTab, string> = {
  providers: "quran.tabProviders",
  display: "quran.tabDisplay",
  munajat: "quran.tabMunajat",
};

function initialTab(): QuranTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "display" || t === "munajat" || t === "providers") return t;
  } catch {
    // ignore
  }
  return "providers";
}

export function SaveRow({
  pending,
  savedTick,
  error,
  onSave,
}: {
  pending: boolean;
  savedTick: number;
  error: Error | unknown;
  onSave: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const errorMsg = error instanceof Error ? errText(error) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" }}>
      <button type="button" className="btn-gold" onClick={onSave} disabled={pending}>
        {pending ? t("appearance.saving") : t("appearance.save")}
      </button>
      {savedTick > 0 && !errorMsg && <Badge tone="success">{t("appearance.saved")}</Badge>}
      {errorMsg && (
        <span className="form-error" style={{ marginBottom: 0 }}>
          {t("appearance.saveFailed")}: {errorMsg}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* providers                                                           */
/* ------------------------------------------------------------------ */

/**
 * An ordered list of edition ids (translations / tafsirs / reciters).
 * Backend contract: plain string arrays; membership = enabled, array
 * order = display order. Edition ids are free-form (no catalog endpoint),
 * so new ids are typed in.
 */
function EditionListManager({
  settingKey,
  titleKey,
  items,
  setItems,
  onSave,
  pending,
  savedTick,
  error,
}: {
  settingKey: string;
  titleKey: string;
  items: string[];
  setItems: (items: string[]) => void;
  onSave: () => void;
  pending: boolean;
  savedTick: number;
  error: unknown;
}): React.ReactElement {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState("");

  const addDraft = (): void => {
    const id = draft.trim();
    if (!id || items.includes(id)) return;
    setItems([...items, id]);
    setDraft("");
  };

  return (
    <section className="panel" aria-label={t(titleKey)}>
      <div className="panel-head">
        <h2>{t(titleKey)}</h2>
        <span className="panel-hint">{settingKey}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("quran.editionHint")}
      </p>

      {items.length === 0 && <div className="empty">{t("quran.noEntries")}</div>}

      <ol className="slot-list">
        {items.map((id, i) => (
          <li key={id} className="slot-row">
            <span className="slot-pos" dir="ltr">
              {i + 1}
            </span>
            <div className="slot-main">
              <code className="slot-id" dir="ltr">
                {id}
              </code>
            </div>
            <div className="slot-actions">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setItems(moveString(items, i, -1))}
                disabled={i === 0}
                aria-label={t("appearance.moveUp")}
              >
                ▲
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setItems(moveString(items, i, 1))}
                disabled={i === items.length - 1}
                aria-label={t("appearance.moveDown")}
              >
                ▼
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setItems(items.filter((_, k) => k !== i))}
              >
                {t("quran.removeEntry")}
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: "320px" }}
          dir="ltr"
          value={draft}
          placeholder={t("quran.editionPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addDraft();
          }}
          aria-label={t("quran.addEdition")}
        />
        <Button size="sm" variant="secondary" onClick={addDraft} disabled={!draft.trim()}>
          {t("quran.addEdition")}
        </Button>
      </div>

      <SaveRow pending={pending} savedTick={savedTick} error={error} onSave={onSave} />
    </section>
  );
}

/**
 * Per-reciter photo URLs (quran.reciter_photos: id -> URL).
 * One row per reciter id in the active reciters list; empty URL means the
 * reader keeps its ♪ placeholder. Keys for ids no longer in the list are
 * preserved untouched (they live in `photos` state but render no row).
 */
function ReciterPhotoManager({
  reciters,
  photos,
  setPhotos,
  onSave,
  pending,
  savedTick,
  error,
}: {
  reciters: string[];
  photos: Record<string, string>;
  setPhotos: (photos: Record<string, string>) => void;
  onSave: () => void;
  pending: boolean;
  savedTick: number;
  error: unknown;
}): React.ReactElement {
  const { t } = useI18n();
  return (
    <section className="panel" aria-label={t("quran.reciterPhotosTitle")}>
      <div className="panel-head">
        <h2>{t("quran.reciterPhotosTitle")}</h2>
        <span className="panel-hint">{QURAN_SETTINGS_KEYS.reciterPhotos}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("quran.reciterPhotosHint")}
      </p>

      {reciters.length === 0 && <div className="empty">{t("quran.noEntries")}</div>}

      <ol className="slot-list">
        {reciters.map((id) => {
          const url = photos[id] ?? "";
          return (
            <li key={id} className="slot-row">
              <div className="slot-main">
                <code className="slot-id" dir="ltr">
                  {id}
                </code>
                <input
                  className="input"
                  dir="ltr"
                  value={url}
                  placeholder="https://…"
                  onChange={(e) =>
                    setPhotos({ ...photos, [id]: e.target.value })
                  }
                  aria-label={id}
                />
              </div>
              <div className="slot-actions">
                {url ? (
                  <img
                    src={url}
                    alt=""
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "50%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <span aria-hidden="true">♪</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <SaveRow pending={pending} savedTick={savedTick} error={error} onSave={onSave} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 2 registry: per-type selection + custom providers + catalog   */
/* ------------------------------------------------------------------ */

const PROVIDER_TYPE_KEYS: { id: ProviderContentType; key: string }[] = [
  { id: "audio", key: "quran.providerTypeAudio" },
  { id: "text", key: "quran.providerTypeText" },
  { id: "translation", key: "quran.providerTypeTranslation" },
  { id: "tafsir", key: "quran.providerTypeTafsir" },
];

function CustomProviderManager({
  items,
  setItems,
  savedItems,
  keySetIds,
  onSave,
  pending,
  savedTick,
  error,
  onKeysChanged,
}: {
  items: CustomProviderInfo[];
  setItems: (items: CustomProviderInfo[]) => void;
  savedItems: CustomProviderInfo[];
  keySetIds: string[];
  onSave: () => void;
  pending: boolean;
  savedTick: number;
  error: unknown;
  onKeysChanged: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [newName, setNewName] = React.useState("");
  const [newUrl, setNewUrl] = React.useState("");
  const [newType, setNewType] = React.useState<ProviderContentType>("translation");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = React.useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = React.useState<string | null>(null);
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const savedIds = new Set(savedItems.map((i) => i.id));

  const addItem = (): void => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name) {
      setFormError(t("quran.customProviderNameRequired"));
      return;
    }
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      setFormError(t("quran.customProviderUrlInvalid"));
      return;
    }
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!id || items.some((i) => i.id === id)) {
      setFormError(t("quran.customProviderIdInvalid"));
      return;
    }
    setFormError(null);
    setItems([...items, { id, name, base_url: url, type: newType }]);
    setNewName("");
    setNewUrl("");
  };

  const saveKey = async (id: string, key: string | null): Promise<void> => {
    setKeyBusy(id);
    setKeyError(null);
    try {
      await setCustomProviderKey(id, key);
      setKeyDrafts((d) => ({ ...d, [id]: "" }));
      onKeysChanged();
    } catch (e) {
      setKeyError(errText(e));
    } finally {
      setKeyBusy(null);
    }
  };

  return (
    <section className="panel" aria-label={t("quran.customProvidersTitle")}>
      <div className="panel-head">
        <h2>{t("quran.customProvidersTitle")}</h2>
        <span className="panel-hint">{QURAN_SETTINGS_KEYS.customProviders}</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("quran.customProvidersHint")}
      </p>

      {items.length === 0 && <div className="empty">{t("quran.noEntries")}</div>}

      <ol className="slot-list">
        {items.map((item) => (
          <li key={item.id} className="slot-row">
            <div className="slot-main">
              <code className="slot-id" dir="ltr">
                {item.id}
              </code>
              <span>
                <strong>{item.name}</strong>
                <span className="hint">
                  {" "}
                  · <code dir="ltr">{item.base_url}</code> ·{" "}
                  {t(
                    PROVIDER_TYPE_KEYS.find((k) => k.id === item.type)?.key ??
                      "quran.providerTypeTranslation",
                  )}
                </span>
              </span>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {savedIds.has(item.id) ? (
                  <>
                    <input
                      className="input"
                      dir="ltr"
                      type="password"
                      value={keyDrafts[item.id] ?? ""}
                      placeholder={t("quran.customProviderKey")}
                      onChange={(e) =>
                        setKeyDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                      }
                      aria-label={t("quran.customProviderKey")}
                      autoComplete="off"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={keyBusy === item.id || !(keyDrafts[item.id] ?? "").trim()}
                      onClick={() => void saveKey(item.id, keyDrafts[item.id] ?? "")}
                    >
                      {t("quran.customProviderSaveKey")}
                    </Button>
                    {keySetIds.includes(item.id) && (
                      <>
                        <Badge tone="success">{t("quran.customProviderKeySet")}</Badge>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={keyBusy === item.id}
                          onClick={() => void saveKey(item.id, null)}
                        >
                          {t("quran.customProviderClearKey")}
                        </Button>
                      </>
                    )}
                    {!keySetIds.includes(item.id) && (
                      <Badge tone="info">{t("quran.customProviderKeyEmpty")}</Badge>
                    )}
                  </>
                ) : (
                  <span className="hint">{t("quran.customProviderSaveFirst")}</span>
                )}
              </div>
            </div>
            <div className="slot-actions">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                {t("quran.removeEntry")}
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <input
          className="input"
          value={newName}
          placeholder={t("quran.customProviderName")}
          onChange={(e) => setNewName(e.target.value)}
          aria-label={t("quran.customProviderName")}
        />
        <input
          className="input"
          dir="ltr"
          value={newUrl}
          placeholder="https://…"
          onChange={(e) => setNewUrl(e.target.value)}
          aria-label={t("quran.customProviderUrl")}
        />
        <select
          className="input"
          value={newType}
          onChange={(e) => setNewType(e.target.value as ProviderContentType)}
          aria-label={t("quran.customProviderType")}
        >
          {PROVIDER_TYPE_KEYS.map((k) => (
            <option key={k.id} value={k.id}>
              {t(k.key)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={addItem}>
          {t("quran.customProviderAdd")}
        </Button>
      </div>
      {formError && (
        <p className="hint" role="alert" style={{ color: "var(--danger, #c0392b)" }}>
          {formError}
        </p>
      )}
      {keyError && (
        <p className="hint" role="alert" style={{ color: "var(--danger, #c0392b)" }}>
          {keyError}
        </p>
      )}

      <SaveRow pending={pending} savedTick={savedTick} error={error} onSave={onSave} />
    </section>
  );
}

function ProvidersPanel(): React.ReactElement {
  const { t } = useI18n();
  const settings = useQuranSettingsQuery();
  const providers = useQuranProvidersQuery();
  const writer = useWriteQuranKeys();

  const [byType, setByType] = React.useState<Record<string, string> | null>(null);
  const [translations, setTranslations] = React.useState<string[]>([]);
  const [tafsirs, setTafsirs] = React.useState<string[]>([]);
  const [reciters, setReciters] = React.useState<string[]>([]);
  const [reciterPhotos, setReciterPhotos] = React.useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = React.useState<CustomProviderInfo[]>([]);
  const [qfBaseUrl, setQfBaseUrl] = React.useState("");
  const [qfClientId, setQfClientId] = React.useState("");
  const [qfSecret, setQfSecret] = React.useState("");
  const [saved, setSaved] = React.useState({
    byType: 0,
    tr: 0,
    tafsir: 0,
    rec: 0,
    photos: 0,
    custom: 0,
    qf: 0,
  });

  React.useEffect(() => {
    if (settings.data) {
      const parsed = parseProvidersByType(settings.data[QURAN_SETTINGS_KEYS.providersByType]);
      if (Object.keys(parsed).length > 0) setByType(parsed);
      setTranslations(parseStringList(settings.data[QURAN_SETTINGS_KEYS.translations]));
      setTafsirs(parseStringList(settings.data[QURAN_SETTINGS_KEYS.tafsirs]));
      setReciters(parseStringList(settings.data[QURAN_SETTINGS_KEYS.reciters]));
      setReciterPhotos(parsePhotosMap(settings.data[QURAN_SETTINGS_KEYS.reciterPhotos]));
      setCustomProviders(
        parseCustomProviders(settings.data[QURAN_SETTINGS_KEYS.customProviders]),
      );
      setQfBaseUrl(parsePlainString(settings.data[QURAN_SETTINGS_KEYS.qfBaseUrl]));
      setQfClientId(parsePlainString(settings.data[QURAN_SETTINGS_KEYS.qfClientId]));
    }
  }, [settings.data]);

  React.useEffect(() => {
    if (byType === null && providers.data && Object.keys(providers.data.providers_by_type).length > 0) {
      setByType(providers.data.providers_by_type);
    }
  }, [byType, providers.data]);

  const bump = (k: keyof typeof saved): void => setSaved((p) => ({ ...p, [k]: p[k] + 1 }));
  const writeErr = writer.isError ? writer.error : null;
  const selectedFor = (type: string): string =>
    byType?.[type] ?? providers.data?.providers_by_type?.[type] ?? "";
  const eligibleFor = (type: string): { id: string; name: string; base_url: string }[] =>
    (providers.data?.providers ?? []).filter(
      (p) => p.implemented && p.types.includes(type),
    );

  return (
    <>
      <section className="panel" aria-label={t("quran.integrityTitle")}>
        <div className="panel-head">
          <h2>{t("quran.integrityTitle")}</h2>
          <Badge tone="info">{t("quran.textSourceTitle")}</Badge>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {t("quran.integrityBody")}
        </p>
      </section>

      {settings.isLoading && <div className="empty">{t("common.loading")}</div>}
      {settings.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {settings.data && (
        <>
          <section className="panel" aria-label={t("quran.registryByTypeTitle")}>
            <div className="panel-head">
              <h2>{t("quran.registryByTypeTitle")}</h2>
              <span className="panel-hint">{QURAN_SETTINGS_KEYS.providersByType}</span>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {t("quran.registryByTypeHint")}
            </p>
            {providers.isLoading && <div className="empty">{t("common.loading")}</div>}
            {providers.isError && (
              <div className="empty">
                <p>{t("common.error")}</p>
                <Button size="sm" variant="secondary" onClick={() => providers.refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
            {PROVIDER_TYPE_KEYS.map((tk) => (
              <div key={tk.id} style={{ marginBottom: "1rem" }}>
                <h3 style={{ margin: "0 0 0.5rem" }}>{t(tk.key)}</h3>
                {eligibleFor(tk.id).length === 0 && (
                  <div className="empty">{t("quran.noEntries")}</div>
                )}
                <div role="radiogroup" aria-label={t(tk.key)}>
                  {eligibleFor(tk.id).map((p) => (
                    <label className="check-row" key={p.id} style={{ marginBottom: "0.5rem" }}>
                      <input
                        type="radio"
                        name={`quran-provider-${tk.id}`}
                        checked={selectedFor(tk.id) === p.id}
                        onChange={() =>
                          setByType((prev) => ({ ...(prev ?? {}), [tk.id]: p.id }))
                        }
                      />
                      <span>
                        <strong>{p.name}</strong>
                        <span className="hint">
                          {" "}
                          · <code dir="ltr">{p.id}</code>
                          {p.base_url ? ` · ${p.base_url}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {providers.data && providers.data.text_edition && (
              <p className="hint">
                {t("quran.textEdition")}: <code dir="ltr">{providers.data.text_edition}</code>
              </p>
            )}
            <SaveRow
              pending={writer.isPending}
              savedTick={saved.byType}
              error={writeErr}
              onSave={() =>
                writer.mutate(
                  { [QURAN_SETTINGS_KEYS.providersByType]: byType ?? {} },
                  {
                    onSuccess: () => {
                      bump("byType");
                      void providers.refetch();
                    },
                  },
                )
              }
            />
          </section>

          <CustomProviderManager
            items={customProviders}
            setItems={setCustomProviders}
            savedItems={providers.data?.custom_providers ?? []}
            keySetIds={providers.data?.custom_provider_keys_set ?? []}
            pending={writer.isPending}
            savedTick={saved.custom}
            error={writeErr}
            onSave={() =>
              writer.mutate(
                { [QURAN_SETTINGS_KEYS.customProviders]: customProviders },
                {
                  onSuccess: () => {
                    bump("custom");
                    void providers.refetch();
                  },
                },
              )
            }
            onKeysChanged={() => void providers.refetch()}
          />

          <section className="panel" aria-label={t("quran.providerCatalogTitle")}>
            <div className="panel-head">
              <h2>{t("quran.providerCatalogTitle")}</h2>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {t("quran.providerCatalogHint")}
            </p>
            {providers.isLoading && <div className="empty">{t("common.loading")}</div>}
            {(providers.data?.provider_catalog ?? []).length === 0 &&
              !providers.isLoading && <div className="empty">{t("quran.noEntries")}</div>}
            <ol className="slot-list">
              {(providers.data?.provider_catalog ?? []).map((entry) => (
                <li key={entry.id} className="slot-row">
                  <div className="slot-main">
                    <code className="slot-id" dir="ltr">
                      {entry.id}
                    </code>
                    <span>
                      <strong>{entry.name}</strong>
                      <span className="hint">
                        {" "}
                        · <code dir="ltr">{entry.base_url}</code>
                        {entry.types.length > 0 ? ` · ${entry.types.join(", ")}` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="slot-actions">
                    <Badge tone="info">
                      {entry.config_only
                        ? t("quran.providerConfigOnly")
                        : t("quran.providerNotConnected")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel" aria-label={t("quran.qfConfigTitle")}>
            <div className="panel-head">
              <h2>{t("quran.qfConfigTitle")}</h2>
              <span className="panel-hint">{QURAN_SETTINGS_KEYS.qfBaseUrl}</span>
              {providers.data?.qf_client_secret_set && (
                <span style={{ marginInlineStart: "0.5rem" }}>
                  <Badge tone="success">{t("quran.customProviderKeySet")}</Badge>
                </span>
              )}
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              {t("quran.qfConfigHint")}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                className="input"
                dir="ltr"
                value={qfBaseUrl}
                placeholder="https://api.quran.com/api/v4"
                onChange={(e) => setQfBaseUrl(e.target.value)}
                aria-label={t("quran.customProviderUrl")}
              />
              <input
                className="input"
                dir="ltr"
                value={qfClientId}
                placeholder={t("quran.qfClientId")}
                onChange={(e) => setQfClientId(e.target.value)}
                aria-label={t("quran.qfClientId")}
              />
              <input
                className="input"
                dir="ltr"
                type="password"
                value={qfSecret}
                placeholder={t("quran.qfClientSecret")}
                onChange={(e) => setQfSecret(e.target.value)}
                aria-label={t("quran.qfClientSecret")}
                autoComplete="off"
              />
            </div>
            <p className="hint">{t("quran.qfSecretHint")}</p>
            <SaveRow
              pending={writer.isPending}
              savedTick={saved.qf}
              error={writeErr}
              onSave={() => {
                const entries: Record<string, unknown> = {
                  [QURAN_SETTINGS_KEYS.qfBaseUrl]: qfBaseUrl,
                  [QURAN_SETTINGS_KEYS.qfClientId]: qfClientId,
                };
                if (qfSecret.trim()) {
                  entries[QURAN_SETTINGS_KEYS.qfClientSecret] = qfSecret;
                }
                writer.mutate(entries, {
                  onSuccess: () => {
                    setQfSecret("");
                    bump("qf");
                    void providers.refetch();
                  },
                });
              }}
            />
          </section>

          <EditionListManager
            settingKey={QURAN_SETTINGS_KEYS.translations}
            titleKey="quran.translationsTitle"
            items={translations}
            setItems={setTranslations}
            pending={writer.isPending}
            savedTick={saved.tr}
            error={writeErr}
            onSave={() =>
              writer.mutate(
                { [QURAN_SETTINGS_KEYS.translations]: translations },
                { onSuccess: () => bump("tr") },
              )
            }
          />

          <EditionListManager
            settingKey={QURAN_SETTINGS_KEYS.tafsirs}
            titleKey="quran.tafsirsTitle"
            items={tafsirs}
            setItems={setTafsirs}
            pending={writer.isPending}
            savedTick={saved.tafsir}
            error={writeErr}
            onSave={() =>
              writer.mutate(
                { [QURAN_SETTINGS_KEYS.tafsirs]: tafsirs },
                { onSuccess: () => bump("tafsir") },
              )
            }
          />

          <EditionListManager
            settingKey={QURAN_SETTINGS_KEYS.reciters}
            titleKey="quran.recitersTitle"
            items={reciters}
            setItems={setReciters}
            pending={writer.isPending}
            savedTick={saved.rec}
            error={writeErr}
            onSave={() =>
              writer.mutate(
                { [QURAN_SETTINGS_KEYS.reciters]: reciters },
                { onSuccess: () => bump("rec") },
              )
            }
          />

          <ReciterPhotoManager
            reciters={reciters}
            photos={reciterPhotos}
            setPhotos={setReciterPhotos}
            pending={writer.isPending}
            savedTick={saved.photos}
            error={writeErr}
            onSave={() =>
              writer.mutate(
                { [QURAN_SETTINGS_KEYS.reciterPhotos]: reciterPhotos },
                { onSuccess: () => bump("photos") },
              )
            }
          />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* display                                                             */
/* ------------------------------------------------------------------ */

const HIGHLIGHT_MODES: { id: HighlightMode; key: string }[] = [
  { id: "word", key: "quran.highlightWord" },
  { id: "ayah", key: "quran.highlightAyah" },
  { id: "off", key: "quran.highlightOff" },
];

const REPEAT_MODES: { id: RepeatMode; key: string }[] = [
  { id: "off", key: "quran.repeatOff" },
  { id: "ayah", key: "quran.repeatAyah" },
  { id: "surah", key: "quran.repeatSurah" },
];

/* Quran Phase 1: display madhhab options (adhan keys reused for the two
   shared names; Maliki/Hanbali are new keys below). */
const DISPLAY_MADHHABS: { id: QuranMadhhab; key: string }[] = [
  { id: "hanafi", key: "quran.madhabHanafi" },
  { id: "shafii", key: "quran.madhabShafi" },
  { id: "maliki", key: "quran.madhabMaliki" },
  { id: "hanbali", key: "quran.madhabHanbali" },
];

const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/* Quran UX rework: player waveform equalizer styles (CRM-selectable). */
const WAVEFORM_STYLE_OPTIONS: { id: WaveformStyle; key: string }[] = [
  { id: "bars", key: "quran.waveformBars" },
  { id: "dotted", key: "quran.waveformDotted" },
  { id: "line", key: "quran.waveformLine" },
  { id: "mirrored", key: "quran.waveformMirrored" },
  { id: "neon", key: "quran.waveformNeon" },
];

/* Quran UX rework round 4: reader display defaults (CRM-selectable). */
const DISPLAY_FONT_OPTIONS: { id: DisplayFont; key: string }[] = [
  { id: "system", key: "quran.displayFontSystem" },
  { id: "amiri", key: "quran.displayFontAmiri" },
  { id: "scheherazade", key: "quran.displayFontScheherazade" },
];

const DISPLAY_THEME_OPTIONS: { id: DisplayTheme; key: string }[] = [
  { id: "dark", key: "quran.displayThemeDark" },
  { id: "sepia", key: "quran.displayThemeSepia" },
  { id: "light", key: "quran.displayThemeLight" },
  { id: "green", key: "quran.displayThemeGreen" },
];

function DisplayPanel(): React.ReactElement {
  const { t } = useI18n();
  const settings = useQuranSettingsQuery();
  const writer = useWriteQuranKeys();
  const [languages, setLanguages] = React.useState<string[]>(["fa"]);
  const [showTranslation, setShowTranslation] = React.useState(true);
  const [showTafsir, setShowTafsir] = React.useState(false);
  const [highlightMode, setHighlightMode] = React.useState<HighlightMode>("ayah");
  const [fontSize, setFontSize] = React.useState(20);
  const [playback, setPlayback] = React.useState<PlaybackConfig>({ ...DEFAULT_PLAYBACK });
  const [madhhabDefault, setMadhhabDefault] = React.useState<QuranMadhhab>("hanafi");
  const [playerSpeed, setPlayerSpeed] = React.useState(1);
  const [playerShowPhoto, setPlayerShowPhoto] = React.useState(true);
  const [waveformStyle, setWaveformStyle] = React.useState<WaveformStyle>("bars");
  const [displayFont, setDisplayFont] = React.useState<DisplayFont>("system");
  const [displayTheme, setDisplayTheme] = React.useState<DisplayTheme>("dark");
  const [savedTick, setSavedTick] = React.useState(0);

  React.useEffect(() => {
    if (settings.data) {
      setLanguages(parseActiveLanguages(settings.data[QURAN_SETTINGS_KEYS.activeLanguages]));
      setShowTranslation(parseFlag(settings.data[QURAN_SETTINGS_KEYS.showTranslation], true));
      setShowTafsir(parseFlag(settings.data[QURAN_SETTINGS_KEYS.showTafsir], false));
      setHighlightMode(
        parseHighlightMode(
          (() => {
            try {
              return JSON.parse(settings.data[QURAN_SETTINGS_KEYS.highlightMode] ?? "");
            } catch {
              return undefined;
            }
          })(),
        ),
      );
      setFontSize(parseFontSize(settings.data[QURAN_SETTINGS_KEYS.fontSize]));
      setPlayback(parsePlayback(settings.data[QURAN_SETTINGS_KEYS.playback]));
      setMadhhabDefault(parseMadhhabDefault(settings.data[QURAN_SETTINGS_KEYS.madhhabDefault]));
      setPlayerSpeed(parsePlayerSpeed(settings.data[QURAN_SETTINGS_KEYS.playerDefaultSpeed]));
      setPlayerShowPhoto(parseFlag(settings.data[QURAN_SETTINGS_KEYS.playerShowPhoto], true));
      setWaveformStyle(parseWaveformStyle(settings.data[QURAN_SETTINGS_KEYS.waveformStyle]));
      setDisplayFont(parseDisplayFont(settings.data[QURAN_SETTINGS_KEYS.displayFont]));
      setDisplayTheme(parseDisplayTheme(settings.data[QURAN_SETTINGS_KEYS.displayTheme]));
    }
  }, [settings.data]);

  // The backend rejects an empty language list — never let the last one go.
  const toggleLanguage = (l: Locale): void =>
    setLanguages((prev) =>
      prev.includes(l) ? (prev.length > 1 ? prev.filter((x) => x !== l) : prev) : [...prev, l],
    );

  if (settings.isLoading) return <div className="empty">{t("common.loading")}</div>;
  if (settings.isError)
    return (
      <div className="empty">
        <p>{t("common.error")}</p>
        <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );

  const handleSave = (): void =>
    writer.mutate(
      {
        [QURAN_SETTINGS_KEYS.activeLanguages]: languages,
        [QURAN_SETTINGS_KEYS.showTranslation]: showTranslation,
        [QURAN_SETTINGS_KEYS.showTafsir]: showTafsir,
        [QURAN_SETTINGS_KEYS.highlightMode]: highlightMode,
        [QURAN_SETTINGS_KEYS.fontSize]: Math.min(72, Math.max(12, fontSize || 20)),
        [QURAN_SETTINGS_KEYS.playback]: playback,
        [QURAN_SETTINGS_KEYS.madhhabDefault]: madhhabDefault,
        [QURAN_SETTINGS_KEYS.playerDefaultSpeed]: playerSpeed,
        [QURAN_SETTINGS_KEYS.playerShowPhoto]: playerShowPhoto,
        [QURAN_SETTINGS_KEYS.waveformStyle]: waveformStyle,
        [QURAN_SETTINGS_KEYS.displayFont]: displayFont,
        [QURAN_SETTINGS_KEYS.displayTheme]: displayTheme,
      },
      { onSuccess: () => setSavedTick((n) => n + 1) },
    );

  return (
    <section className="panel" aria-label={t("quran.tabDisplay")}>
      <div className="panel-head">
        <h2>{t("quran.tabDisplay")}</h2>
        <span className="panel-hint">{t("quran.displayKeysHint")}</span>
      </div>

      <div className="field">
        <span className="field-label">{t("quran.displayLocales")}</span>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {LOCALES.map((l) => (
            <label className="check-row" key={l}>
              <input
                type="checkbox"
                checked={languages.includes(l)}
                onChange={() => toggleLanguage(l)}
              />
              {t(`studio.locale_${l}`)}
            </label>
          ))}
        </div>
        <span className="hint">{t("quran.atLeastOne")}</span>
      </div>

      <div className="field">
        <label className="check-row">
          <input
            type="checkbox"
            checked={showTranslation}
            onChange={(e) => setShowTranslation(e.target.checked)}
          />
          {t("quran.showTranslation")}
        </label>
      </div>
      <div className="field">
        <label className="check-row">
          <input
            type="checkbox"
            checked={showTafsir}
            onChange={(e) => setShowTafsir(e.target.checked)}
          />
          {t("quran.showTafsir")}
        </label>
      </div>

      <div className="field">
        <span className="field-label">{t("quran.highlightMode")}</span>
        <div
          style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}
          role="radiogroup"
          aria-label={t("quran.highlightMode")}
        >
          {HIGHLIGHT_MODES.map((m) => (
            <label className="check-row" key={m.id}>
              <input
                type="radio"
                name="quran-highlight"
                checked={highlightMode === m.id}
                onChange={() => setHighlightMode(m.id)}
              />
              {t(m.key)}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="quran-font-size">{t("quran.baseFontSize")}</label>
        <input
          id="quran-font-size"
          className="input"
          type="number"
          min={12}
          max={72}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          style={{ maxWidth: "140px" }}
          dir="ltr"
        />
        <span className="hint">{t("quran.fontSizeHint")}</span>
      </div>

      <div className="field">
        <span className="field-label">{t("quran.repeat")}</span>
        <label className="check-row" style={{ marginBottom: "0.5rem" }}>
          <input
            type="checkbox"
            checked={playback.autoplay}
            onChange={(e) => setPlayback((p) => ({ ...p, autoplay: e.target.checked }))}
          />
          {t("quran.autoplayNext")}
        </label>
        <select
          className="input"
          style={{ maxWidth: "280px" }}
          value={playback.repeat}
          onChange={(e) => setPlayback((p) => ({ ...p, repeat: e.target.value as RepeatMode }))}
          aria-label={t("quran.repeat")}
        >
          {REPEAT_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="quran-madhhab-default">{t("quran.madhhabDefault")}</label>
        <select
          id="quran-madhhab-default"
          className="input"
          style={{ maxWidth: "280px" }}
          value={madhhabDefault}
          onChange={(e) => setMadhhabDefault(e.target.value as QuranMadhhab)}
        >
          {DISPLAY_MADHHABS.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="quran-player-speed">{t("quran.playerDefaultSpeed")}</label>
        <select
          id="quran-player-speed"
          className="input"
          style={{ maxWidth: "280px" }}
          value={playerSpeed}
          onChange={(e) => setPlayerSpeed(Number(e.target.value))}
        >
          {PLAYER_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="check-row">
          <input
            type="checkbox"
            checked={playerShowPhoto}
            onChange={(e) => setPlayerShowPhoto(e.target.checked)}
          />
          {t("quran.playerShowPhoto")}
        </label>
      </div>

      <div className="field">
        <label htmlFor="quran-waveform-style">{t("quran.waveformStyle")}</label>
        <select
          id="quran-waveform-style"
          className="input"
          style={{ maxWidth: "280px" }}
          value={waveformStyle}
          onChange={(e) => setWaveformStyle(e.target.value as WaveformStyle)}
        >
          {WAVEFORM_STYLE_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="quran-display-font">{t("quran.displayFont")}</label>
        <select
          id="quran-display-font"
          className="input"
          style={{ maxWidth: "280px" }}
          value={displayFont}
          onChange={(e) => setDisplayFont(e.target.value as DisplayFont)}
        >
          {DISPLAY_FONT_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.key)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="quran-display-theme">{t("quran.displayTheme")}</label>
        <select
          id="quran-display-theme"
          className="input"
          style={{ maxWidth: "280px" }}
          value={displayTheme}
          onChange={(e) => setDisplayTheme(e.target.value as DisplayTheme)}
        >
          {DISPLAY_THEME_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.key)}
            </option>
          ))}
        </select>
      </div>

      <SaveRow
        pending={writer.isPending}
        savedTick={savedTick}
        error={writer.isError ? writer.error : null}
        onSave={handleSave}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* munajat                                                             */
/* ------------------------------------------------------------------ */

function MunajatPanel(): React.ReactElement {
  const { t } = useI18n();
  const settings = useQuranSettingsQuery();
  const writer = useWriteQuranKeys();
  const [enabled, setEnabled] = React.useState(false);
  const [window_, setWindow] = React.useState<MunajatWindow>(DEFAULT_MUNAJAT_WINDOW);
  const [savedTick, setSavedTick] = React.useState(0);

  React.useEffect(() => {
    if (settings.data) {
      setEnabled(parseFlag(settings.data[QURAN_SETTINGS_KEYS.munajatEnabled], false));
      setWindow(parseMunajatWindow(settings.data[QURAN_SETTINGS_KEYS.munajatWindow]));
    }
  }, [settings.data]);

  const valid = isTimeString(window_.start) && isTimeString(window_.end);

  if (settings.isLoading) return <div className="empty">{t("common.loading")}</div>;
  if (settings.isError)
    return (
      <div className="empty">
        <p>{t("common.error")}</p>
        <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );

  return (
    <section className="panel" aria-label={t("quran.tabMunajat")}>
      <div className="panel-head">
        <h2>{t("quran.tabMunajat")}</h2>
        <span className="panel-hint">{t("quran.munajatHint")}</span>
      </div>

      <div className="field">
        <label className="check-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("quran.munajatEnable")}
        </label>
      </div>

      <div className="field">
        <span className="field-label">{t("quran.munajatWindow")}</span>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            type="time"
            dir="ltr"
            value={window_.start}
            onChange={(e) => setWindow((w) => ({ ...w, start: e.target.value }))}
            aria-label={t("quran.munajatWindow")}
            style={{ maxWidth: "140px" }}
          />
          <span aria-hidden="true">–</span>
          <input
            className="input"
            type="time"
            dir="ltr"
            value={window_.end}
            onChange={(e) => setWindow((w) => ({ ...w, end: e.target.value }))}
            aria-label={t("quran.munajatWindow")}
            style={{ maxWidth: "140px" }}
          />
        </div>
        {!valid && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {t("common.error")}
          </span>
        )}
      </div>

      <SaveRow
        pending={writer.isPending}
        savedTick={savedTick}
        error={writer.isError ? writer.error : null}
        onSave={() =>
          writer.mutate(
            {
              [QURAN_SETTINGS_KEYS.munajatEnabled]: enabled,
              [QURAN_SETTINGS_KEYS.munajatWindow]: window_,
            },
            { onSuccess: () => setSavedTick((n) => n + 1) },
          )
        }
      />
    </section>
  );
}

/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Quran(): React.ReactElement {
  const { t, setLocale } = useI18n();
  const [tab, setTab] = React.useState<QuranTab>(initialTab);

  // Deep-link support for screenshots / shared links: ?locale=fa|ar|en
  React.useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("locale");
      if (l === "fa" || l === "ar" || l === "en") setLocale(l);
    } catch {
      // ignore
    }
  }, [setLocale]);

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
        <h1 style={{ margin: 0 }}>{t("quran.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("quran.liveHint")}
      </p>

      <div className="locale-tabs" role="tablist" aria-label={t("quran.title")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`locale-tab${tab === tb ? " on" : ""}`}
            onClick={() => setTab(tb)}
          >
            {t(TAB_KEY[tb])}
          </button>
        ))}
      </div>

      {tab === "providers" && <ProvidersPanel />}
      {tab === "display" && <DisplayPanel />}
      {tab === "munajat" && <MunajatPanel />}
    </div>
  );
}
