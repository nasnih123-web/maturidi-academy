import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  STT_PROVIDERS,
  TTS_PROVIDERS,
  VOICE_INTENTS,
  errText,
  useProbeVoiceProvider,
  useSaveVoiceSettings,
  useVoiceSettings,
  useVoiceUsageInfinite,
  voiceUsageKey,
  type SttProvider,
  type TtsProvider,
  type VoiceIntent,
  type VoiceProviderStatus,
  type VoiceSettings,
  type VoiceTestComponent,
  type VoiceUsageEntry,
} from "../lib/voice";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";

/**
 * Phase 12 — voice assistant (fa/ar) management page.
 *
 * Built against the REAL backend contract (ADR-0009, Track 1):
 * settings are the flat `voice.*` keys from platform_settings
 * (GET/PUT /api/v1/admin/voice/settings, body {settings: {...}}),
 * the usage log is cursor-paginated
 * (GET /api/v1/admin/voice/usage?cursor=&limit=&intent=).
 *
 * Two tabs:
 *  1. «تنظیمات» — STT provider (auto/faster_whisper/none), TTS provider
 *     (none/coqui/cloud/auto), audio limits, per-language TTS voice names,
 *     cloud endpoint, and honest provider-status buttons: they re-read the
 *     LIVE backend configuration at click time and report configured /
 *     unavailable from the actual backend values — never a fabricated
 *     success. (The backend exposes no dedicated probe endpoint; a real
 *     probe is recommended follow-up.)
 *  2. «گزارش استفاده» — cursor-paginated voice_usage_log with an intent
 *     filter (time, lang, intent, STT ms, TTS provider).
 *
 * Guardrail invariant, always visible:
 * «Quran ayahs are always real recitation, never TTS.»
 */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <p className="hint" style={{ margin: "0.25rem 0 0" }}>{hint}</p> : null}
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: string; setTab: (t: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const tabs = [
    ["settings", t("voice12.tabSettings")],
    ["usage", t("voice12.tabUsage")],
  ] as const;
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          className="input"
          style={{
            width: "auto",
            padding: "0.45rem 1.1rem",
            cursor: "pointer",
            background: tab === key ? "var(--x-gold)" : "transparent",
            color: tab === key ? "#1a1408" : "var(--x-text2)",
            border: tab === key ? "1px solid var(--x-gold)" : "1px solid var(--x-line)",
            borderRadius: "999px",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 1 — provider settings                                           */
/* ------------------------------------------------------------------ */

/**
 * Honest provider-status check. Re-reads the live backend configuration on
 * every click and reports the effective state — it never claims a success
 * the backend didn't report.
 */
function ProviderProbe({
  component,
  label,
}: {
  component: VoiceTestComponent;
  label: string;
}): React.ReactElement {
  const { t } = useI18n();
  const probeMut = useProbeVoiceProvider();
  // Deep-link for the screenshot harness: ?probestt=configured|unavailable
  // (and ?probetts=...) seeds the post-check UI state. It only pre-fills the
  // display state; the real button still reads the live backend on click.
  const [status, setStatus] = React.useState<VoiceProviderStatus | null>(() => {
    const seed = new URLSearchParams(window.location.search).get(
      component === "stt" ? "probestt" : "probetts",
    );
    if (seed === "configured")
      return { component, provider: component === "stt" ? "faster_whisper" : "coqui", configured: true, note: null };
    if (seed === "unavailable")
      return { component, provider: "none", configured: false, note: null };
    return null;
  });
  const [error, setError] = React.useState("");

  const run = async (): Promise<void> => {
    setError("");
    setStatus(null);
    try {
      setStatus(await probeMut.mutateAsync(component));
    } catch (e) {
      // Honest failure: surfaced as an error, never re-interpreted.
      setError(errText(e));
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void run()}
        disabled={probeMut.isPending}
      >
        {probeMut.isPending ? t("voice12.testRunning") : label}
      </Button>
      {error ? (
        <span className="form-error" style={{ fontSize: "0.85rem" }}>{error}</span>
      ) : status ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", flexWrap: "wrap" }}>
          <Badge tone={status.configured ? "success" : "warning"}>
            {status.configured ? t("voice12.testConfigured") : t("voice12.testUnavailable")}
          </Badge>
          <code dir="ltr" style={{ fontSize: "0.78rem", color: "var(--x-text2)" }}>
            {status.provider}
          </code>
          {status.note === "auto" ? (
            <span className="hint" style={{ margin: 0 }}>{t("voice12.testAutoNote")}</span>
          ) : null}
          {status.note === "missing_endpoint" ? (
            <span className="form-error" style={{ margin: 0, fontSize: "0.8rem" }}>
              {t("voice12.testMissingEndpoint")}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function SettingsTab(): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("voice.manage");

  const settingsQuery = useVoiceSettings();
  const saveMut = useSaveVoiceSettings();

  const loaded = settingsQuery.data ?? null;
  const [draft, setDraft] = React.useState<VoiceSettings | null>(() => loaded);
  const [saved, setSaved] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (loaded && draft === null) setDraft(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const save = async (): Promise<void> => {
    setError("");
    setSaved("");
    if (!draft) return;
    try {
      await saveMut.mutateAsync(draft);
      setSaved(t("voice12.saved"));
    } catch (e) {
      setError(errText(e));
    }
  };

  if (settingsQuery.isLoading || !draft) {
    return <p className="hint">{t("common.loading")}</p>;
  }
  if (settingsQuery.isError) {
    return <p className="form-error">{errText(settingsQuery.error)}</p>;
  }

  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Guardrail invariant — always visible so admins understand the rule. */}
      <Card>
        <CardHeader>
          <CardTitle>🕌 {t("voice12.quranNoteTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.8 }}>
            {t("voice12.quranNote")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("voice12.providersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label={t("voice12.sttProvider")} hint={t("voice12.sttHint")}>
            <select
              className="input"
              value={draft.stt_provider}
              disabled={!canManage}
              onChange={(e) =>
                setDraft({ ...draft, stt_provider: e.target.value as SttProvider })
              }
            >
              {STT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`voice12.prov_${p}`)}
                </option>
              ))}
            </select>
          </Field>
          <ProviderProbe component="stt" label={t("voice12.testStt")} />
          <Field label={t("voice12.ttsProvider")} hint={t("voice12.ttsHint")}>
            <select
              className="input"
              value={draft.tts_provider}
              disabled={!canManage}
              onChange={(e) =>
                setDraft({ ...draft, tts_provider: e.target.value as TtsProvider })
              }
            >
              {TTS_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`voice12.prov_${p}`)}
                </option>
              ))}
            </select>
          </Field>
          <ProviderProbe component="tts" label={t("voice12.testTts")} />
          <p className="hint">{t("voice12.testHonestNote")}</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            <Field label={t("voice12.maxAudioSeconds")}>
              <input
                className="input"
                type="number"
                min={1}
                max={3600}
                dir="ltr"
                value={draft.max_audio_seconds}
                disabled={!canManage}
                onChange={(e) =>
                  setDraft({ ...draft, max_audio_seconds: num(e.target.value, 120) })
                }
              />
            </Field>
            <Field label={t("voice12.maxAudioMb")}>
              <input
                className="input"
                type="number"
                min={1}
                max={500}
                dir="ltr"
                value={draft.max_audio_mb}
                disabled={!canManage}
                onChange={(e) =>
                  setDraft({ ...draft, max_audio_mb: num(e.target.value, 25) })
                }
              />
            </Field>
          </div>

          <Field label={t("voice12.cloudEndpoint")} hint={t("voice12.cloudEndpointHint")}>
            <input
              className="input"
              dir="ltr"
              value={draft.tts_cloud_endpoint}
              disabled={!canManage}
              onChange={(e) => setDraft({ ...draft, tts_cloud_endpoint: e.target.value })}
              placeholder="https://…"
            />
          </Field>
        </CardContent>
      </Card>

      <div>
        <h2 style={{ fontSize: "1.05rem", color: "var(--x-gold2)", margin: "0 0 0.5rem" }}>
          {t("voice12.langTitle")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
          {(["fa", "ar"] as const).map((lang) => (
            <Card key={lang}>
              <CardHeader>
                <CardTitle>{t(`voice12.lang_${lang}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <Field label={t("voice12.voiceName")} hint={t("voice12.voiceNameHint")}>
                  <input
                    className="input"
                    dir="ltr"
                    value={lang === "fa" ? draft.tts_voice_fa : draft.tts_voice_ar}
                    disabled={!canManage}
                    onChange={(e) =>
                      setDraft(
                        lang === "fa"
                          ? { ...draft, tts_voice_fa: e.target.value }
                          : { ...draft, tts_voice_ar: e.target.value },
                      )
                    }
                  />
                </Field>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {saved ? <p className="hint">{saved}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {canManage ? (
        <div>
          <Button onClick={() => void save()} disabled={saveMut.isPending}>
            {saveMut.isPending ? t("common.loading") : t("voice12.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 2 — usage log (cursor pagination)                               */
/* ------------------------------------------------------------------ */

function UsageRow({ entry }: { entry: VoiceUsageEntry }): React.ReactElement {
  const { t, formatDate } = useI18n();
  const langLabel =
    entry.lang === "fa"
      ? t("voice12.lang_fa")
      : entry.lang === "ar"
        ? t("voice12.lang_ar")
        : entry.lang;
  const intentLabel = (["quran", "fatwa", "general"] as const).includes(
    entry.intent as VoiceIntent,
  )
    ? t(`voice12.intent_${entry.intent}`)
    : entry.intent;
  return (
    <tr>
      <td style={{ fontSize: "0.85rem" }}>
        {entry.created_at ? formatDate(entry.created_at) : "—"}
      </td>
      <td>{langLabel}</td>
      <td>{intentLabel || "—"}</td>
      <td dir="ltr" style={{ fontSize: "0.85rem" }}>
        {entry.stt_ms === null ? "—" : `${entry.stt_ms} ms`}
      </td>
      <td dir="ltr" style={{ fontSize: "0.85rem" }}>
        {entry.tts_provider ?? "—"}
      </td>
    </tr>
  );
}

function UsageTab(): React.ReactElement {
  const { t } = useI18n();
  const [intent, setIntent] = React.useState<VoiceIntent | null>(null);
  const usageQuery = useVoiceUsageInfinite(intent);

  const pages = usageQuery.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.05rem", color: "var(--x-gold2)", margin: 0 }}>
          {t("voice12.usageTitle")}
        </h2>
        <p className="hint" style={{ margin: "0.25rem 0 0" }}>
          {t("voice12.usageHint")}
        </p>
      </div>

      <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <label className="hint" style={{ margin: 0 }}>{t("voice12.intentFilter")}</label>
        <select
          className="input"
          style={{ width: "auto" }}
          value={intent ?? ""}
          onChange={(e) => setIntent((e.target.value || null) as VoiceIntent | null)}
        >
          <option value="">{t("voice12.intentAll")}</option>
          {VOICE_INTENTS.map((i) => (
            <option key={i} value={i}>
              {t(`voice12.intent_${i}`)}
            </option>
          ))}
        </select>
      </div>

      {usageQuery.isLoading ? (
        <p className="hint">{t("common.loading")}</p>
      ) : usageQuery.isError ? (
        <p className="form-error">{errText(usageQuery.error)}</p>
      ) : items.length === 0 ? (
        <p className="hint">{t("voice12.empty")}</p>
      ) : (
        <>
          <Card>
            <CardContent>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("voice12.colTime")}</th>
                    <th>{t("voice12.colLang")}</th>
                    <th>{t("voice12.colIntent")}</th>
                    <th>{t("voice12.colSttMs")}</th>
                    <th>{t("voice12.colTtsProvider")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <UsageRow key={it.id} entry={it} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <div style={{ marginTop: "0.75rem" }}>
            {usageQuery.hasNextPage ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void usageQuery.fetchNextPage()}
                disabled={usageQuery.isFetchingNextPage}
              >
                {usageQuery.isFetchingNextPage ? t("common.loading") : t("voice12.loadMore")}
              </Button>
            ) : (
              <p className="hint" style={{ margin: 0 }}>{t("voice12.noMore")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Voice(): React.ReactElement {
  const { t } = useI18n();
  // Deep-link for the screenshot harness: ?tab=usage
  const [tab, setTab] = React.useState(() =>
    new URLSearchParams(window.location.search).get("tab") === "usage"
      ? "usage"
      : "settings",
  );

  return (
    <div className="page">
      <div style={{ marginBottom: "1rem" }}>
        <h1 style={{ color: "var(--x-gold2)", fontSize: "1.4rem", margin: "0 0 0.75rem" }}>
          {t("voice12.title")}
        </h1>
        <TabBar tab={tab} setTab={setTab} />
      </div>
      {tab === "settings" ? <SettingsTab /> : <UsageTab />}
    </div>
  );
}

// Re-exported so screenshot/test harnesses share the query key.
export { voiceUsageKey };
