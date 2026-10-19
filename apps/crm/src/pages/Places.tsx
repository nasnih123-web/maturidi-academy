import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  PLACE_TRANSITIONS,
  PLACE_TYPES,
  errText,
  osmEmbedUrl,
  useCreatePlace,
  useDeletePlace,
  usePlaces,
  useTransitionPlace,
  useUpdatePlace,
  validCoords,
  type PlaceFilters,
  type PlaceInput,
  type PlaceType,
  type ReligiousPlace,
} from "../lib/places";
import { useLibraryItemsQuery } from "../lib/library";
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
}: {
  initial: ReligiousPlace | null;
  onClose: () => void;
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
  const [video360, setVideo360] = React.useState<string>(initial?.video_360_id ?? "");
  const [error, setError] = React.useState("");

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
      video_360_id: video360 || null,
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
                    {PLACE_TYPES.map((pt) => (
                      <option key={pt} value={pt}>{t(`places11.ptype_${pt}`)}</option>
                    ))}
                  </select>
                </Field>
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
            {PLACE_TYPES.map((pt) => (
              <option key={pt} value={pt}>{t(`places11.ptype_${pt}`)}</option>
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
                        {t(`places11.ptype_${p.type}`)}
                      </span>
                    </div>
                    {display(p.description) !== "—" ? (
                      <p className="hint" dir="auto" style={{ margin: "0.4rem 0 0" }}>
                        {display(p.description)}
                      </p>
                    ) : null}
                    <p className="hint" style={{ margin: "0.4rem 0 0" }} dir="ltr">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      {p.video_360_id ? ` · 360°` : ""}
                    </p>
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
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>
                        {t("common.edit")}
                      </Button>
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
