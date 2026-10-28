import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  DEFAULT_GLOBE_SETTINGS,
  DEFAULT_PLACE_TYPES,
  DEFAULT_POPUP_CONFIG,
  PLACE_TRANSITIONS,
  errText,
  hideTarget,
  osmEmbedUrl,
  parseGlobeSettings,
  parsePlaceTypes,
  parsePopupConfig,
  useCreatePlace,
  useDeletePlace,
  usePlaces,
  useTransitionPlace,
  useUpdatePlace,
  validCoords,
  type PlaceFilters,
  type PlaceImage,
  type PlaceInput,
  type PlaceType,
  type PlaceTypeDef,
  type PlacesGlobeSettings,
  type PlacesPopupConfig,
  type ReligiousPlace,
} from "../lib/places";
import { useLibraryItemsQuery } from "../lib/library";
import { readSettingsMap, writeSettingsMap } from "../lib/appearance";
import { EMPTY_L10N, type LocalizedText, type WorkflowStatus } from "../lib/contentApi";
import { useI18n, formatDate } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import LocalizedInput from "../components/LocalizedInput";
import WorkflowBar from "../components/WorkflowBar";

/**
 * Phase 11 — religious places management (`religious_places`).
 *
 * List with workflow-status/type filters; create/edit form with
 * per-locale name+description, lat/lng numeric inputs with a live
 * OpenStreetMap preview (the "small map picker": no extra deps, no
 * network call beyond the embed), place-type selector, 360° video link
 * picker (from Phase-9 library `video_360` items), submitter shown
 * read-only, and transitions through the shared §9 state machine.
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

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  published: "success",
  approved: "success",
  in_review: "warning",
  draft: "neutral",
  rejected: "danger",
  archived: "neutral",
};

function statusLabel(t: (p: string) => string, s: WorkflowStatus): string {
  const k = t(`status.${s}`);
  return k === `status.${s}` ? s : k;
}

/* ------------------------------------------------------------------ */
/* form                                                                */
/* ------------------------------------------------------------------ */

function PlaceForm({
  initial,
  onClose,
  typeDefs,
}: {
  initial: ReligiousPlace | null;
  onClose: () => void;
  typeDefs: PlaceTypeDef[];
}): React.ReactElement {
  const { t, locale } = useI18n();
  const createMut = useCreatePlace();
  const updateMut = useUpdatePlace();

  const [name, setName] = React.useState<LocalizedText>(
    initial?.name ?? { ...EMPTY_L10N },
  );
  const [description, setDescription] = React.useState<LocalizedText>(
    initial?.description ?? { ...EMPTY_L10N },
  );
  const [lat, setLat] = React.useState(initial ? String(initial.lat) : "");
  const [lng, setLng] = React.useState(initial ? String(initial.lng) : "");
  const [type, setType] = React.useState<PlaceType>(initial?.type ?? "mosque");
  const [city, setCity] = React.useState(initial?.city ?? "");
  const [imageUrl, setImageUrl] = React.useState(initial?.image_url ?? "");
  // Gallery editor (globe phase): add/remove/reorder rows, caption per
  // image. The cover stays the single image_url field above; the web
  // falls back to images[0] when no cover is set.
  const [images, setImages] = React.useState<PlaceImage[]>(initial?.images ?? []);
  const [videoUrl, setVideoUrl] = React.useState(initial?.video_url ?? "");
  const [video360, setVideo360] = React.useState<string>(initial?.video_360_id ?? "");
  const [geoStatus, setGeoStatus] = React.useState<"idle" | "busy" | "ok" | "denied" | "unsupported">("idle");
  const [error, setError] = React.useState("");

  // Type options come from the CRM `places.types` setting. A legacy type
  // on the edited row (not in the setting) is kept as an extra option so
  // saving without touching the select never changes the stored type.
  const typeOptions: PlaceTypeDef[] =
    initial && !typeDefs.some((d) => d.key === initial.type)
      ? [...typeDefs, { key: initial.type, emoji: "📍", fa: initial.type, ar: initial.type, en: initial.type }]
      : typeDefs;
  const typeLabel = (def: PlaceTypeDef): string =>
    locale === "ar" ? def.ar : locale === "en" ? def.en : def.fa;

  // Browser geolocation (maps phase): fills lat/lng from the device after
  // the admin grants permission. Denial/unsupported browsers leave the
  // manual coordinate + city fields as the fallback — nothing is cleared.
  const useMyLocation = (): void => {
    if (!("geolocation" in navigator)) {
      setGeoStatus("unsupported");
      return;
    }
    setGeoStatus("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude.toFixed(6)));
        setLng(String(pos.coords.longitude.toFixed(6)));
        setGeoStatus("ok");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  const videosQuery = useLibraryItemsQuery({ kind: "video_360" });
  const videos = videosQuery.data?.items ?? [];

  const coordsOk = validCoords(Number(lat), Number(lng));

  const save = async (): Promise<void> => {
    setError("");
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (!validCoords(nLat, nLng)) {
      setError(t("places11.invalidCoords"));
      return;
    }
    const body: PlaceInput = {
      name,
      description,
      lat: nLat,
      lng: nLng,
      type,
      city: city.trim() || null,
      image_url: imageUrl.trim() || null,
      images: images.length > 0
        ? images
            .map((im) => ({ url: im.url.trim(), caption: im.caption.trim() }))
            .filter((im) => im.url)
        : null,
      video_360_id: video360 || null,
      video_url: videoUrl.trim() || null,
    };
    try {
      if (initial) {
        await updateMut.mutateAsync({ id: initial.id, body });
      } else {
        await createMut.mutateAsync(body);
      }
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };

  const display = (l: LocalizedText): string =>
    l[locale] || l.fa || l.ar || l.en || "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("places11.formTitle")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "2rem 1rem",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(56rem, 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              {initial ? t("places11.editTitle") : t("places11.newTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "0.9rem" }}>
              <LocalizedInput id="pl-name" label={t("places11.name")} value={name} onChange={setName} />
              <LocalizedInput
                id="pl-desc"
                label={t("places11.description")}
                value={description}
                onChange={setDescription}
                multiline
                rows={4}
              />

              <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
                <Field label={t("places11.lat")} hint="90- … 90">
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="decimal"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                  />
                </Field>
                <Field label={t("places11.lng")} hint="180- … 180">
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="decimal"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                  />
                </Field>
                <Field label={t("places11.type")}>
                  <select
                    className="input"
                    value={type}
                    onChange={(e) => setType(e.target.value as PlaceType)}
                  >
                    {typeOptions.map((def) => (
                      <option key={def.key} value={def.key}>{def.emoji} {typeLabel(def)}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
                <Field label={t("places11.city")} hint={t("places11.cityHint")}>
                  <input
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </Field>
                <Field label={t("places11.imageUrl")} hint={t("places11.imageUrlHint")}>
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                </Field>
              </div>

              <div>
                <Button
                  variant="secondary"
                  onClick={useMyLocation}
                  disabled={geoStatus === "busy"}
                >
                  {geoStatus === "busy" ? t("places11.locating") : t("places11.useMyLocation")}
                </Button>
                {geoStatus === "ok" ? <p className="hint" style={{ margin: "0.4rem 0 0" }}>{t("places11.located")}</p> : null}
                {geoStatus === "denied" ? <p className="hint" style={{ margin: "0.4rem 0 0" }}>{t("places11.locationDenied")}</p> : null}
                {geoStatus === "unsupported" ? <p className="hint" style={{ margin: "0.4rem 0 0" }}>{t("places11.locationUnsupported")}</p> : null}
                <p className="hint" style={{ margin: "0.4rem 0 0" }}>{t("places11.manualHint")}</p>
              </div>

              {coordsOk ? (
                <div>
                  <p className="hint" style={{ margin: "0 0 0.4rem" }}>
                    {t("places11.mapPreview")}
                  </p>
                  <iframe
                    title={t("places11.mapPreview")}
                    src={osmEmbedUrl(Number(lat), Number(lng))}
                    style={{ width: "100%", height: "260px", border: "1px solid var(--x-line)", borderRadius: "0.6rem" }}
                    loading="lazy"
                  />
                </div>
              ) : null}

              <Field label={t("places11.video360")} hint={t("places11.video360Hint")}>
                <select
                  className="input"
                  value={video360}
                  onChange={(e) => setVideo360(e.target.value)}
                >
                  <option value="">{t("places11.none")}</option>
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {display(v.title)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("places11.videoUrl")} hint={t("places11.videoUrlHint")}>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
              </Field>

              <div>
                <p className="hint" style={{ margin: "0 0 0.5rem" }}>
                  {t("places11.galleryTitle")}
                </p>
                {images.length === 0 ? (
                  <p className="hint" style={{ margin: "0 0 0.5rem" }}>{t("places11.galleryEmpty")}</p>
                ) : null}
                <div style={{ display: "grid", gap: "0.6rem" }}>
                  {images.map((im, i) => (
                    <div
                      key={i}
                      style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}
                    >
                      <Field label={t("places11.galleryUrl")}>
                        <input
                          className="input"
                          dir="ltr"
                          inputMode="url"
                          value={im.url}
                          onChange={(e) =>
                            setImages((list) => list.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                          }
                        />
                      </Field>
                      <Field label={t("places11.galleryCaption")}>
                        <input
                          className="input"
                          value={im.caption}
                          onChange={(e) =>
                            setImages((list) => list.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))
                          }
                        />
                      </Field>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={i === 0}
                          onClick={() =>
                            setImages((list) => {
                              const next = [...list];
                              [next[i - 1], next[i]] = [next[i], next[i - 1]];
                              return next;
                            })
                          }
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={i === images.length - 1}
                          onClick={() =>
                            setImages((list) => {
                              const next = [...list];
                              [next[i], next[i + 1]] = [next[i + 1], next[i]];
                              return next;
                            })
                          }
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
                        >
                          {t("places11.galleryRemove")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <Button
                    variant="secondary"
                    onClick={() => setImages((list) => [...list, { url: "", caption: "" }])}
                  >
                    {t("places11.galleryAdd")}
                  </Button>
                </div>
              </div>

              {initial?.submitted_by ? (
                <p className="hint" style={{ margin: 0 }}>
                  {t("places11.submitter")}: <span dir="ltr">{initial.submitted_by}</span>
                </p>
              ) : null}

              {error ? <p className="form-error">{error}</p> : null}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Button
                  onClick={() => void save()}
                  disabled={createMut.isPending || updateMut.isPending}
                >
                  {t("common.save")}
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* map display control (maps phase — CRM control of the public popup)  */
/* ------------------------------------------------------------------ */

/**
 * Which fields the public map popup shows, per place: image, description,
 * type badge and city. Stored in the `places.popup` platform setting (JSON);
 * the web map reads it from GET /api/v1/settings/public. Field *values*
 * still come from each place record — this only toggles their display.
 */
function MapDisplayControl(): React.ReactElement {
  const { t } = useI18n();
  const [cfg, setCfg] = React.useState<PlacesPopupConfig>({ ...DEFAULT_POPUP_CONFIG });
  const [loaded, setLoaded] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void readSettingsMap()
      .then((map) => {
        if (!cancelled) {
          setCfg(parsePopupConfig(map["places.popup"] ?? null));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true); // defaults stand; save still works
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (): Promise<void> => {
    setError("");
    setSaved(false);
    try {
      await writeSettingsMap({ "places.popup": JSON.stringify(cfg) });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(errText(e));
    }
  };

  const fields: { key: keyof PlacesPopupConfig; label: string }[] = [
    { key: "show_image", label: t("places11.popupImage") },
    { key: "show_description", label: t("places11.popupDescription") },
    { key: "show_type", label: t("places11.popupType") },
    { key: "show_city", label: t("places11.popupCity") },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("places11.mapDisplayTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="hint" style={{ margin: "0 0 0.8rem" }}>
          {t("places11.mapDisplayHint")}
        </p>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {fields.map((f) => (
            <label key={f.key} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={cfg[f.key]}
                disabled={!loaded}
                onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.checked }))}
              />
              {f.label}
            </label>
          ))}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {saved ? <p className="hint" style={{ margin: "0.6rem 0 0" }}>{t("places11.mapDisplaySaved")}</p> : null}
        <div style={{ marginTop: "0.8rem" }}>
          <Button onClick={() => void save()}>{t("common.save")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* globe settings (globe phase — CRM control of the default globe view) */
/* ------------------------------------------------------------------ */

/**
 * Default globe view, stored in the `places.globe` platform setting (JSON)
 * and read by the web globe page from GET /api/v1/settings/public:
 * start point, altitude, basemap mode and auto-rotate. Kaaba-centered
 * defaults (21.4225, 39.8262) when the setting is absent.
 */
function GlobeSettingsControl(): React.ReactElement {
  const { t } = useI18n();
  const [cfg, setCfg] = React.useState<PlacesGlobeSettings>({ ...DEFAULT_GLOBE_SETTINGS });
  const [loaded, setLoaded] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void readSettingsMap()
      .then((map) => {
        if (!cancelled) {
          setCfg(parseGlobeSettings(map["places.globe"] ?? null));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (): Promise<void> => {
    setError("");
    setSaved(false);
    try {
      await writeSettingsMap({ "places.globe": JSON.stringify(cfg) });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(errText(e));
    }
  };

  const modes = [
    { key: "satellite", label: t("places11.globeModeSatellite") },
    { key: "simple", label: t("places11.globeModeSimple") },
    { key: "dark", label: t("places11.globeModeDark") },
    { key: "topology", label: t("places11.globeModeTopology") },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("places11.globeTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="hint" style={{ margin: "0 0 0.8rem" }}>
          {t("places11.globeHint")}
        </p>
        <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
          <Field label={t("places11.globeLat")}>
            <input
              className="input"
              dir="ltr"
              inputMode="decimal"
              disabled={!loaded}
              value={String(cfg.defaultLat)}
              onChange={(e) => setCfg((c) => ({ ...c, defaultLat: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label={t("places11.globeLng")}>
            <input
              className="input"
              dir="ltr"
              inputMode="decimal"
              disabled={!loaded}
              value={String(cfg.defaultLng)}
              onChange={(e) => setCfg((c) => ({ ...c, defaultLng: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label={t("places11.globeAltitude")}>
            <input
              className="input"
              dir="ltr"
              inputMode="decimal"
              disabled={!loaded}
              value={String(cfg.defaultAltitude)}
              onChange={(e) => setCfg((c) => ({ ...c, defaultAltitude: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label={t("places11.globeMode")}>
            <select
              className="input"
              disabled={!loaded}
              value={cfg.defaultMode}
              onChange={(e) => setCfg((c) => ({ ...c, defaultMode: e.target.value }))}
            >
              {modes.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginTop: "0.8rem" }}>
          <input
            type="checkbox"
            checked={cfg.autoRotate}
            disabled={!loaded}
            onChange={(e) => setCfg((c) => ({ ...c, autoRotate: e.target.checked }))}
          />
          {t("places11.globeAutoRotate")}
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {saved ? <p className="hint" style={{ margin: "0.6rem 0 0" }}>{t("places11.globeSaved")}</p> : null}
        <div style={{ marginTop: "0.8rem" }}>
          <Button onClick={() => void save()}>{t("common.save")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* place types (globe phase — CRM-extensible marker types)             */
/* ------------------------------------------------------------------ */

/**
 * The `places.types` platform setting: the list of {key, emoji, fa, ar,
 * en} the globe legend, the marker symbols and the registration forms
 * read. Adding a type here makes it immediately selectable in the place
 * form and visible in the legend; removing one hides it from new places
 * (existing rows keep their key and render with the 📍 fallback).
 */
function TypesControl(): React.ReactElement {
  const { t } = useI18n();
  const [rows, setRows] = React.useState<PlaceTypeDef[]>([...DEFAULT_PLACE_TYPES]);
  const [loaded, setLoaded] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void readSettingsMap()
      .then((map) => {
        if (!cancelled) {
          setRows(parsePlaceTypes(map["places.types"] ?? null));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (): Promise<void> => {
    setError("");
    setSaved(false);
    const keys = rows.map((r) => r.key.trim()).filter(Boolean);
    if (keys.length !== rows.length || new Set(keys).size !== keys.length) {
      setError(t("places11.typesInvalid"));
      return;
    }
    try {
      await writeSettingsMap({
        "places.types": JSON.stringify(rows.map((r) => ({ ...r, key: r.key.trim() }))),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("places11.typesTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="hint" style={{ margin: "0 0 0.8rem" }}>
          {t("places11.typesHint")}
        </p>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {rows.map((row, i) => (
            <div
              key={i}
              style={{ display: "grid", gap: "0.4rem", gridTemplateColumns: "6rem 3.5rem 1fr 1fr 1fr auto", alignItems: "end" }}
            >
              <Field label={t("places11.typesKey")}>
                <input
                  className="input"
                  dir="ltr"
                  value={row.key}
                  disabled={!loaded}
                  onChange={(e) =>
                    setRows((list) => list.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label={t("places11.typesEmoji")}>
                <input
                  className="input"
                  value={row.emoji}
                  disabled={!loaded}
                  onChange={(e) =>
                    setRows((list) => list.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)))
                  }
                />
              </Field>
              {(["fa", "ar", "en"] as const).map((lg) => (
                <Field key={lg} label={lg}>
                  <input
                    className="input"
                    value={row[lg]}
                    disabled={!loaded}
                    onChange={(e) =>
                      setRows((list) => list.map((x, j) => (j === i ? { ...x, [lg]: e.target.value } : x)))
                    }
                  />
                </Field>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
              >
                {t("places11.typesRemove")}
              </Button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
          <Button
            variant="secondary"
            onClick={() => setRows((list) => [...list, { key: "", emoji: "📍", fa: "", ar: "", en: "" }])}
          >
            {t("places11.typesAdd")}
          </Button>
          <Button onClick={() => void save()}>{t("common.save")}</Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {saved ? <p className="hint" style={{ margin: "0.6rem 0 0" }}>{t("places11.typesSaved")}</p> : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Places(): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("places.manage");

  const [filters, setFilters] = React.useState<PlaceFilters>({ limit: 50 });
  // Deep-link for the screenshot harness: ?form=new|edit[&place=<id>]
  const [formOpen, setFormOpen] = React.useState(
    () => {
      const f = new URLSearchParams(window.location.search).get("form");
      return f === "new" || f === "edit";
    },
  );
  const [editing, setEditing] = React.useState<ReligiousPlace | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<ReligiousPlace | null>(null);

  const listQuery = usePlaces(filters);
  const transitionMut = useTransitionPlace();
  const deleteMut = useDeletePlace();

  // Place-type defs for the form, the filter and the list labels come from
  // the CRM `places.types` setting (defaults while it loads or is absent).
  const [typeDefs, setTypeDefs] = React.useState<PlaceTypeDef[]>([...DEFAULT_PLACE_TYPES]);
  React.useEffect(() => {
    let cancelled = false;
    void readSettingsMap()
      .then((map) => {
        if (!cancelled) setTypeDefs(parsePlaceTypes(map["places.types"] ?? null));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const typeLabel = (key: string): string => {
    const def = typeDefs.find((d) => d.key === key);
    if (!def) return key;
    return locale === "ar" ? def.ar : locale === "en" ? def.en : def.fa;
  };
  const typeEmoji = (key: string): string =>
    typeDefs.find((d) => d.key === key)?.emoji ?? "📍";

  // Resolve a deep-linked place for the edit form once the list is available.
  React.useEffect(() => {
    if (formOpen && !editing) {
      const pid = new URLSearchParams(window.location.search).get("place");
      if (pid) {
        const found = (listQuery.data ?? []).find((p) => p.id === pid);
        if (found) setEditing(found);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, listQuery.data]);

  const display = (l: LocalizedText): string =>
    l[locale] || l.fa || l.ar || l.en || "—";

  const openNew = (): void => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (p: ReligiousPlace): void => {
    setEditing(p);
    setFormOpen(true);
  };

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h1 style={{ color: "var(--x-gold2)", fontSize: "1.4rem", margin: 0 }}>
          {t("places11.title")}
        </h1>
        {canManage ? (
          <Button onClick={openNew}>{t("places11.new")}</Button>
        ) : null}
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <MapDisplayControl />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <GlobeSettingsControl />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <TypesControl />
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <Field label={t("places11.filterStatus")}>
          <select
            className="input"
            value={filters.workflow_status ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, workflow_status: (e.target.value || undefined) as PlaceFilters["workflow_status"] }))
            }
            style={{ maxWidth: "14rem" }}
          >
            <option value="">{t("places11.allStatuses")}</option>
            {Object.keys(PLACE_TRANSITIONS).map((s) => (
              <option key={s} value={s}>{statusLabel(t, s as WorkflowStatus)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("places11.filterType")}>
          <select
            className="input"
            value={filters.type ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, type: (e.target.value || undefined) as PlaceFilters["type"] }))
            }
            style={{ maxWidth: "14rem" }}
          >
            <option value="">{t("places11.allTypes")}</option>
            {typeDefs.map((def) => (
              <option key={def.key} value={def.key}>{def.emoji} {typeLabel(def.key)}</option>
            ))}
          </select>
        </Field>
      </div>

      {listQuery.isLoading ? (
        <p className="hint">{t("common.loading")}</p>
      ) : listQuery.isError ? (
        <p className="form-error">{errText(listQuery.error)}</p>
      ) : (listQuery.data ?? []).length === 0 ? (
        <p className="hint">{t("places11.empty")}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.9rem" }}>
          {(listQuery.data ?? []).map((p) => (
            <Card key={p.id}>
              <CardContent>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ minWidth: "16rem", flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                      <strong style={{ color: "var(--x-gold2)" }} dir="auto">
                        {display(p.name)}
                      </strong>
                      <Badge tone={STATUS_TONE[p.workflow_status] ?? "neutral"}>
                        {statusLabel(t, p.workflow_status)}
                      </Badge>
                      <span className="hint" style={{ margin: 0 }}>
                        {typeEmoji(p.type)} {typeLabel(p.type)}
                      </span>
                    </div>
                    {display(p.description) !== "—" ? (
                      <p className="hint" dir="auto" style={{ margin: "0.4rem 0 0" }}>
                        {display(p.description)}
                      </p>
                    ) : null}
                    <p className="hint" style={{ margin: "0.4rem 0 0" }} dir="ltr">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      {p.city ? ` · ${p.city}` : ""}
                      {p.video_360_id ? ` · 360°` : ""}
                      {p.video_url ? ` · ▶` : ""}
                      {p.images.length > 0 ? ` · ${p.images.length} 🖼` : ""}
                    </p>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        loading="lazy"
                        style={{ display: "block", maxWidth: "12rem", maxHeight: "7rem", objectFit: "cover", borderRadius: "0.5rem", marginTop: "0.4rem" }}
                      />
                    ) : null}
                    <p className="hint" style={{ margin: "0.25rem 0 0" }}>
                      {formatDate(locale, p.updated_at)}
                    </p>
                    <div style={{ marginTop: "0.6rem" }}>
                      <WorkflowBar
                        status={p.workflow_status}
                        pending={transitionMut.isPending}
                        onTransition={(to) =>
                          void transitionMut.mutateAsync({ id: p.id, to })
                        }
                      />
                    </div>
                  </div>
                  {canManage ? (
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>
                        {t("common.edit")}
                      </Button>
                      {hideTarget(p.workflow_status) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={transitionMut.isPending}
                          onClick={() => {
                            const to = hideTarget(p.workflow_status);
                            if (to) void transitionMut.mutateAsync({ id: p.id, to });
                          }}
                        >
                          {t("places11.hide")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setConfirmDelete(p)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen ? (
        // Key on the place id: when a deep-linked place resolves after mount,
        // the form remounts and its useState initializers see the real values.
        <PlaceForm
          key={editing ? editing.id : "new"}
          initial={editing}
          onClose={() => setFormOpen(false)}
          typeDefs={typeDefs}
        />
      ) : null}

      {confirmDelete ? (
        <div
          role="alertdialog"
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(0,0,0,0.55)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(28rem, 100%)" }}>
            <Card>
              <CardHeader><CardTitle>{t("places11.deleteTitle")}</CardTitle></CardHeader>
              <CardContent>
                <p className="hint" dir="auto">{t("places11.deleteConfirm")}</p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button
                    disabled={deleteMut.isPending}
                    onClick={() =>
                      void deleteMut.mutateAsync(confirmDelete.id).then(() => setConfirmDelete(null))
                    }
                  >
                    {t("common.delete")}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
