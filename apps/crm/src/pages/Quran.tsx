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
  parseFlag,
  parseFontSize,
  parseHighlightMode,
  parseMunajatWindow,
  parsePlayback,
  parseProviderId,
  parseStringList,
  useQuranProvidersQuery,
  useQuranSettingsQuery,
  useWriteQuranKeys,
  type HighlightMode,
  type MunajatWindow,
  type PlaybackConfig,
  type RepeatMode,
} from "../lib/quran";

/**
 * Quran management (مدیریت قرآن) — super_admin only.
 *
 * Three configuration areas backed by platform_settings (Phase 5, json type,
 * keys as registered by the Track 1 backend — see lib/quran.ts):
 *   1. Providers → quran.provider, quran.translations, quran.tafsirs, quran.reciters
 *   2. Display   → quran.active_languages, quran.show_translation,
 *                   quran.show_tafsir, quran.highlight_mode, quran.font_size,
 *                   quran.playback
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

function ProvidersPanel(): React.ReactElement {
  const { t } = useI18n();
  const settings = useQuranSettingsQuery();
  const providers = useQuranProvidersQuery();
  const writer = useWriteQuranKeys();

  const [provider, setProvider] = React.useState("");
  const [translations, setTranslations] = React.useState<string[]>([]);
  const [tafsirs, setTafsirs] = React.useState<string[]>([]);
  const [reciters, setReciters] = React.useState<string[]>([]);
  const [saved, setSaved] = React.useState({ text: 0, tr: 0, tafsir: 0, rec: 0 });

  React.useEffect(() => {
    if (settings.data) {
      setProvider(parseProviderId(settings.data[QURAN_SETTINGS_KEYS.provider]));
      setTranslations(parseStringList(settings.data[QURAN_SETTINGS_KEYS.translations]));
      setTafsirs(parseStringList(settings.data[QURAN_SETTINGS_KEYS.tafsirs]));
      setReciters(parseStringList(settings.data[QURAN_SETTINGS_KEYS.reciters]));
    }
  }, [settings.data]);

  const bump = (k: keyof typeof saved): void => setSaved((p) => ({ ...p, [k]: p[k] + 1 }));
  const writeErr = writer.isError ? writer.error : null;

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
          <section className="panel" aria-label={t("quran.textSourceTitle")}>
            <div className="panel-head">
              <h2>{t("quran.textSourceTitle")}</h2>
              <span className="panel-hint">{QURAN_SETTINGS_KEYS.provider}</span>
            </div>
            {providers.isLoading && <div className="empty">{t("common.loading")}</div>}
            {providers.isError && (
              <div className="empty">
                <p>{t("common.error")}</p>
                <Button size="sm" variant="secondary" onClick={() => providers.refetch()}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
            {providers.data && providers.data.providers.length === 0 && (
              <div className="empty">{t("quran.noEntries")}</div>
            )}
            <div role="radiogroup" aria-label={t("quran.textSourceTitle")}>
              {providers.data?.providers.map((p) => (
                <label className="check-row" key={p.id} style={{ marginBottom: "0.5rem" }}>
                  <input
                    type="radio"
                    name="quran-provider"
                    checked={provider === p.id}
                    onChange={() => setProvider(p.id)}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <span className="hint">
                      {" "}
                      — <code dir="ltr">{p.id}</code>
                      {p.base_url ? ` · ${p.base_url}` : ""}
                    </span>
                    {p.active && (
                      <span style={{ marginInlineStart: "0.5rem" }}>
                        <Badge tone="success">{t("quran.activeProvider")}</Badge>
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {providers.data && providers.data.text_edition && (
              <p className="hint">
                {t("quran.textEdition")}: <code dir="ltr">{providers.data.text_edition}</code>
              </p>
            )}
            <SaveRow
              pending={writer.isPending}
              savedTick={saved.text}
              error={writeErr}
              onSave={() =>
                writer.mutate(
                  { [QURAN_SETTINGS_KEYS.provider]: provider },
                  { onSuccess: () => bump("text") },
                )
              }
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
