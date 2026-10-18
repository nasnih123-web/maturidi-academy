import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { apiFetch } from "../lib/api";
import { LOCALES, Locale, useI18n } from "../lib/i18n";

/**
 * App branding (Phase 2 spec):
 * `app_display_name` (LocalizedText), `app_icon_media_id`,
 * `app_splash_screen_media_id` in platform_settings.
 *
 * Media pickers are stubs — the media_assets browser lands in a later phase,
 * so media ids are entered manually for now. Branding changes need a fresh
 * app build (not instant); the "rebuild apps" button comes in Phase 14.
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
  const raw = map["app_display_name"];
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
    app_icon_media_id: map["app_icon_media_id"] ?? "",
    app_splash_screen_media_id: map["app_splash_screen_media_id"] ?? "",
  };
}

export default function Branding(): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<BrandingState>(EMPTY);
  const [saved, setSaved] = React.useState(false);

  const brandingQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => apiFetch<SettingsMap>("/api/v1/admin/settings"),
  });

  React.useEffect(() => {
    if (brandingQuery.data) setState(fromSettings(brandingQuery.data));
  }, [brandingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: SettingsMap) =>
      apiFetch<SettingsMap>("/api/v1/admin/settings", { method: "PUT", body: payload }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      window.setTimeout(() => setSaved(false), 3000);
    },
  });

  function handleSave(): void {
    saveMutation.mutate({
      app_display_name: JSON.stringify(state.app_display_name),
      app_icon_media_id: state.app_icon_media_id || null,
      app_splash_screen_media_id: state.app_splash_screen_media_id || null,
    });
  }

  return (
    <div className="page">
      <h1>{t("branding.title")}</h1>
      <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
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

      {brandingQuery.data && (
        <>
          <Card style={{ marginBottom: "1rem" }}>
            <CardHeader>
              <CardTitle>{t("branding.displayName")}</CardTitle>
            </CardHeader>
            <CardContent>
              {LOCALES.map((locale) => (
                <div className="field" key={locale}>
                  <label htmlFor={`name-${locale}`}>
                    {t("branding.displayName")} ({locale})
                  </label>
                  <input
                    id={`name-${locale}`}
                    className="input"
                    dir={locale === "en" ? "ltr" : "rtl"}
                    value={state.app_display_name[locale]}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        app_display_name: { ...prev.app_display_name, [locale]: e.target.value },
                      }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card style={{ marginBottom: "1rem" }}>
            <CardHeader>
              <CardTitle>{t("branding.icon")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ fontSize: "0.82rem", color: "#64748b" }}>{t("branding.mediaStub")}</p>
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
            </CardContent>
          </Card>

          <Card style={{ marginBottom: "1rem" }}>
            <CardHeader>
              <CardTitle>{t("branding.splash")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ fontSize: "0.82rem", color: "#64748b" }}>{t("branding.mediaStub")}</p>
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
            </CardContent>
          </Card>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              {saveMutation.isPending ? t("branding.saving") : t("branding.save")}
            </Button>
            {saved && <Badge tone="success">{t("branding.saved")}</Badge>}
            {saveMutation.isError && <span className="form-error" style={{ marginBottom: 0 }}>{t("common.error")}</span>}
          </div>
        </>
      )}
    </div>
  );
}
