import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button } from "@maturidi/ui-web";
import { ApiError } from "../lib/api";
import { LOCALES, Locale, useI18n } from "../lib/i18n";
import { BUILT_IN_FAMILY, type UploadedFont } from "../lib/fonts";
import {
  deleteFont,
  parseUploadedFont,
  readSettingsMap,
  uploadFont,
  useAppearanceSettingsQuery,
  writeSettingsMap,
} from "../lib/appearance";

/**
 * App branding (Phase 2 spec):
 * `branding.app_display_name` (LocalizedText), `branding.app_icon_media_id`,
 * `branding.app_splash_screen_media_id` in platform_settings.
 *
 * Media pickers are stubs — the media_assets browser lands in a later phase,
 * so media ids are entered manually for now. Branding changes need a fresh
 * app build (not instant); the "rebuild apps" button comes in Phase 14.
 *
 * The live preview zone borrows turbo's VisualStudio "preview zone" concept:
 * it renders the current display name exactly as the login card would show
 * it — purely presentational, computed from the real form state.
 *
 * Plus: per-language font upload (polish milestone) — file picker
 * (woff2/woff/ttf), shows the current font (built-in name or uploaded
 * family), upload → POST /api/v1/admin/fonts, remove → DELETE
 * /api/v1/admin/fonts/{locale} (reverts to the built-in). API errors are
 * shown honestly.
 */

interface BrandingState {
  app_display_name: Record<Locale, string>;
  app_icon_media_id: string;
  app_splash_screen_media_id: string;
}

type SettingsMap = Record<string, string | null>;

const EMPTY: BrandingState = {
  app_display_name: { fa: "", ar: "", en: "" },
  app_icon_media_id: "",
  app_splash_screen_media_id: "",
};

function fromSettings(map: SettingsMap | undefined): BrandingState {
  if (!map) return EMPTY;
  let names: Record<Locale, string> = { fa: "", ar: "", en: "" };
  const raw = map["branding.app_display_name"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<Locale, string>>;
      names = {
        fa: parsed.fa ?? "",
        ar: parsed.ar ?? "",
        en: parsed.en ?? "",
      };
    } catch {
      // not JSON — treat as a single fa name
      names = { fa: raw, ar: "", en: "" };
    }
  }
  return {
    app_display_name: names,
    app_icon_media_id: map["branding.app_icon_media_id"] ?? "",
    app_splash_screen_media_id: map["branding.app_splash_media_id"] ?? "",
  };
}

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* per-language font upload                                            */
/* ------------------------------------------------------------------ */

function FontUploadRow({
  locale,
  uploaded,
}: {
  locale: Locale;
  uploaded: UploadedFont | null;
}): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [family, setFamily] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  React.useEffect(() => {
    setFamily(uploaded?.family ?? "");
  }, [uploaded]);

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
  };

  const describe = (): string =>
    uploaded
      ? uploaded.family
      : `${BUILT_IN_FAMILY[locale]} (${t("appearance.fontBuiltIn")})`;

  async function handleUpload(): Promise<void> {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      fileRef.current?.click();
      return;
    }
    const fam = family.trim() || file.name.replace(/\.(woff2?|ttf)$/i, "");
    setBusy(true);
    setNote(null);
    try {
      await uploadFont(locale, fam, file);
      setNote({ kind: "ok", text: t("appearance.fontUploaded") });
      invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNote({ kind: "err", text: t("appearance.fontPending") });
      } else {
        setNote({ kind: "err", text: errText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(): Promise<void> {
    if (!uploaded) return;
    if (!window.confirm(t("studio.confirmArchive"))) return;
    setBusy(true);
    setNote(null);
    try {
      await deleteFont(locale);
      setNote({ kind: "ok", text: t("appearance.fontRemoved") });
      invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNote({ kind: "err", text: t("appearance.fontPending") });
      } else {
        setNote({ kind: "err", text: errText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="font-row">
      <div className="font-row-head">
        <strong>{t(`studio.locale_${locale}`)}</strong>
        <span className="hint" style={{ margin: 0 }}>
          {t("appearance.fontCurrent")}: <bdi>{describe()}</bdi>
        </span>
      </div>
      <div className="font-row-controls">
        <input
          ref={fileRef}
          type="file"
          accept=".woff2,.woff,.ttf"
          className="input"
          aria-label={t("appearance.fontPick")}
          disabled={busy}
          style={{ flex: "1 1 12rem" }}
        />
        <input
          className="input"
          dir="ltr"
          placeholder={t("appearance.fontFamilyLabel")}
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          disabled={busy}
          style={{ flex: "1 1 10rem" }}
        />
        <Button size="sm" onClick={() => void handleUpload()} disabled={busy}>
          {t("appearance.fontUpload")}
        </Button>
        {uploaded && (
          <Button size="sm" variant="ghost" onClick={() => void handleRemove()} disabled={busy}>
            {t("appearance.fontRemove")}
          </Button>
        )}
      </div>
      {note && (
        <p className={note.kind === "ok" ? "hint" : "form-error"} style={{ margin: "0.4rem 0 0" }}>
          {note.text}
        </p>
      )}
    </div>
  );
}

function FontUploadSection(): React.ReactElement {
  const { t } = useI18n();
  const settings = useAppearanceSettingsQuery();

  const uploaded = React.useMemo<Record<Locale, UploadedFont | null>>(
    () => ({
      fa: parseUploadedFont(settings.data?.["fonts.fa"]),
      ar: parseUploadedFont(settings.data?.["fonts.ar"]),
      en: parseUploadedFont(settings.data?.["fonts.en"]),
    }),
    [settings.data],
  );

  return (
    <section className="panel" aria-label={t("appearance.fontsTitle")}>
      <div className="panel-head">
        <h2>{t("appearance.fontsTitle")}</h2>
        <span className="panel-hint">{t("appearance.fontsHint")}</span>
      </div>
      {settings.isLoading && <div className="empty">{t("common.loading")}</div>}
      {settings.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => settings.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {settings.data &&
        LOCALES.map((l) => <FontUploadRow key={l} locale={l} uploaded={uploaded[l]} />)}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export default function Branding(): React.ReactElement {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<BrandingState>(EMPTY);
  const [saved, setSaved] = React.useState(false);

  const brandingQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: readSettingsMap,
  });

  React.useEffect(() => {
    if (brandingQuery.data) setState(fromSettings(brandingQuery.data));
  }, [brandingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: SettingsMap) => writeSettingsMap(payload),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      window.setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSave(): void {
    saveMutation.mutate({
      "branding.app_display_name": JSON.stringify(state.app_display_name),
      "branding.app_icon_media_id": state.app_icon_media_id || null,
      "branding.app_splash_media_id": state.app_splash_screen_media_id || null,
    });
  }

  const previewName = state.app_display_name[locale] || state.app_display_name.fa;

  return (
    <div className="page" style={{ maxWidth: "1200px" }}>
      <h1>{t("branding.title")}</h1>
      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("branding.rebuildNote")}
      </p>

      {brandingQuery.isLoading && <div className="empty">{t("common.loading")}</div>}
      {brandingQuery.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => brandingQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      <FontUploadSection />

      {brandingQuery.data && (
        <div className="two-col">
          <div>
            <section className="panel">
              <div className="panel-head">
                <h2>{t("branding.displayName")}</h2>
              </div>
              {LOCALES.map((l) => (
                <div className="field" key={l}>
                  <label htmlFor={`name-${l}`}>
                    {t("branding.displayName")} ({l})
                  </label>
                  <input
                    id={`name-${l}`}
                    className="input"
                    dir={l === "en" ? "ltr" : "rtl"}
                    value={state.app_display_name[l]}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        app_display_name: { ...prev.app_display_name, [l]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>{t("branding.icon")}</h2>
              </div>
              <p className="hint">{t("branding.mediaStub")}</p>
              <div className="field">
                <label htmlFor="icon-media">media id</label>
                <input
                  id="icon-media"
                  className="input"
                  dir="ltr"
                  placeholder={t("branding.pickMedia")}
                  value={state.app_icon_media_id}
                  onChange={(e) => setState((prev) => ({ ...prev, app_icon_media_id: e.target.value }))}
                />
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>{t("branding.splash")}</h2>
              </div>
              <p className="hint">{t("branding.mediaStub")}</p>
              <div className="field">
                <label htmlFor="splash-media">media id</label>
                <input
                  id="splash-media"
                  className="input"
                  dir="ltr"
                  placeholder={t("branding.pickMedia")}
                  value={state.app_splash_screen_media_id}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, app_splash_screen_media_id: e.target.value }))
                  }
                />
              </div>
            </section>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                type="button"
                className="btn-gold"
                onClick={handleSave}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? t("branding.saving") : t("branding.save")}
              </button>
              {saved && <Badge tone="success">{t("branding.saved")}</Badge>}
              {saveMutation.isError && (
                <span className="form-error" style={{ marginBottom: 0 }}>
                  {errText(saveMutation.error)}
                </span>
              )}
            </div>
          </div>

          <aside>
            <section className="panel" aria-label={t("branding.previewTitle")}>
              <div className="panel-head">
                <h2>{t("branding.previewTitle")}</h2>
                <span className="panel-hint">{t("branding.previewHint")}</span>
              </div>
              <div className="preview-cartouche">
                <div>
                  <span className="login-logo-wrap login-logo-wrap-sm" aria-hidden="true">
                    <span className="login-mark" aria-hidden="true">
                      {t("app.mark")}
                    </span>
                    <img
                      src="/brand/logo.jpg"
                      alt=""
                      className="login-logo"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </span>
                  <div className="preview-name">
                    {previewName || <span className="muted">—</span>}
                  </div>
                  <div className="preview-sub">{t("app.subtitle")}</div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
