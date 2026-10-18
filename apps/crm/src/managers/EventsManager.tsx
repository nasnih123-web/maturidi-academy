import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import {
  DEFAULT_DISTRIBUTION,
  EMPTY_L10N,
  HIJRI_MONTHS,
  IslamicEvent,
  WorkflowStatus,
} from "../lib/contentApi";
import {
  contentKeys,
  useArchiveContent,
  useCalendarTheme,
  useContentVersions,
  useCreateContent,
  useEvent,
  useEvents,
  useTransitionContent,
  useUpdateContent,
} from "../lib/contentHooks";
import { useI18n, type Locale } from "../lib/i18n";
import LocalizedInput from "../components/LocalizedInput";
import WorkflowBar from "../components/WorkflowBar";
import DistributionToggles from "../components/DistributionToggles";
import ScheduleFields from "../components/ScheduleFields";
import PreviewMatrix, { pickLocaleText } from "../components/PreviewMatrix";
import { useQueryClient } from "@tanstack/react-query";

const EMPTY_EVENT: IslamicEvent = {
  id: "",
  name: { ...EMPTY_L10N },
  hijri_month: 9,
  hijri_day: 1,
  recurring: true,
  starts_at: null,
  ends_at: null,
  theme_id: null,
  image_url: null,
  auto_publish: false,
  needs_admin_confirmation: true,
  workflow_status: "draft",
  distribution: { ...DEFAULT_DISTRIBUTION },
  version: 1,
  created_at: "",
  updated_at: "",
};

function statusLabel(t: (k: string) => string, s: string): string {
  const k = t(`status.${s}`);
  return k === `status.${s}` ? s : k;
}

/**
 * Shows the currently active Islamic-calendar theme from the public
 * endpoint GET /api/v1/content/public/calendar/theme — what web/mobile
 * are actually rendering today.
 */
function ActiveThemeChip(): React.ReactElement {
  const { t } = useI18n();
  const theme = useCalendarTheme();
  if (theme.isLoading || theme.isError || !theme.data) return <span />;
  return (
    <Badge tone={theme.data.theme_id ? "info" : "neutral"}>
      <span dir="ltr">
        {t("studio.activeTheme")}: {theme.data.hijri.month}/{theme.data.hijri.day}
        {" → "}
        {theme.data.theme_id ? theme.data.theme_id.slice(0, 8) + "…" : t("studio.noTheme")}
      </span>
    </Badge>
  );
}

export default function EventsManager(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const qc = useQueryClient();
  const list = useEvents();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<IslamicEvent>(EMPTY_EVENT);
  const [showVersions, setShowVersions] = React.useState(false);

  const detail = useEvent(editingId);
  const versions = useContentVersions("events", showVersions ? editingId : null);
  const createMut = useCreateContent<IslamicEvent>("events");
  const updateMut = useUpdateContent<IslamicEvent>("events");
  const archiveMut = useArchiveContent<IslamicEvent>("events");
  const transitionMut = useTransitionContent<IslamicEvent>("events");

  React.useEffect(() => {
    if (detail.data) {
      setForm({
        ...EMPTY_EVENT,
        ...detail.data,
        name: { ...EMPTY_L10N, ...(detail.data.name ?? {}) },
        distribution: { ...DEFAULT_DISTRIBUTION, ...(detail.data.distribution ?? {}) },
      });
    }
  }, [detail.data]);

  const openCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY_EVENT);
    setCreating(true);
    setShowVersions(false);
  };
  const openEdit = (id: string): void => {
    setCreating(false);
    setEditingId(id);
    setShowVersions(false);
  };
  const close = (): void => {
    setCreating(false);
    setEditingId(null);
    setShowVersions(false);
  };

  const saving = createMut.isPending || updateMut.isPending;

  const handleSave = (): void => {
    const { id, version, created_at, updated_at, workflow_status, ...body } =
      form as IslamicEvent & Record<string, unknown>;
    void version;
    void created_at;
    void updated_at;
    void workflow_status;
    if (creating) {
      createMut.mutate(body, {
        onSuccess: (row) => {
          void qc.invalidateQueries({ queryKey: contentKeys.list("events") });
          setCreating(false);
          setEditingId(row.id);
        },
      });
    } else if (editingId) {
      updateMut.mutate({ id: editingId, body });
    }
  };

  const handleTransition = (to: WorkflowStatus): void => {
    if (!editingId) return;
    transitionMut.mutate({ id: editingId, to });
  };

  const handleArchive = (id: string): void => {
    if (!window.confirm(t("studio.confirmArchive"))) return;
    archiveMut.mutate(id, {
      onSuccess: () => {
        if (id === editingId) close();
      },
    });
  };

  const patch = (p: Partial<IslamicEvent>): void => setForm({ ...form, ...p });
  const isEditor = creating || editingId !== null;

  const renderPreview = ({ locale: l, dir }: { locale: Locale; dir: "rtl" | "ltr" }): React.ReactNode => {
    const monthKey = HIJRI_MONTHS.find((m) => m.value === form.hijri_month)?.key ?? "";
    return (
      <div
        style={{
          borderRadius: "0.6rem",
          overflow: "hidden",
          background: "#14100a",
          color: "#f2ead6",
          border: "1px solid #c9a22755",
        }}
      >
        {form.image_url ? (
          <img src={form.image_url} alt="" style={{ width: "100%", height: "140px", objectFit: "cover" }} />
        ) : null}
        <div style={{ padding: "1rem 1.25rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#c9a227", marginBottom: "0.35rem" }}>
            {form.hijri_day} {t(`studio.month_${monthKey}`)}
            {form.recurring ? ` · ${t("studio.recurring")}` : ""}
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }} dir={dir}>
            {pickLocaleText(form.name, l) || t("studio.untitled")}
          </div>
          <div style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: "0.35rem" }} dir={dir}>
            {t("studio.themeLabel")}:{" "}
            <code dir="ltr" style={{ fontSize: "0.72rem" }}>
              {form.theme_id ? form.theme_id.slice(0, 8) + "…" : "—"}
            </code>
            {form.starts_at ? ` · ${formatDate(form.starts_at)}` : ""}
          </div>
        </div>
      </div>
    );
  };

  /**
   * Before/after activation: the site hero as it looks today vs with this
   * event active. The event's theme is referenced by UUID (resolved by the
   * web app), so the "after" panel shows the event identity + theme ref —
   * never invented colors.
   */
  const themeCompare = (withTheme: boolean): React.ReactNode => {
    return (
      <div style={{ flex: 1, minWidth: "220px" }}>
        <div className="hint" style={{ marginBottom: "0.35rem" }}>
          {withTheme ? t("studio.afterActivation") : t("studio.beforeActivation")}
        </div>
        <div
          style={{
            borderRadius: "0.6rem",
            padding: "1.5rem 1.25rem",
            background: withTheme
              ? "linear-gradient(135deg, #241b0c, #14100a)"
              : "#14100a",
            border: `1px solid ${withTheme ? "#c9a227" : "var(--x-line)"}`,
            color: "#f2ead6",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.72rem", letterSpacing: "0.08em", color: "#c9a227" }}>
            {t("studio.siteHeroMock")}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 800, margin: "0.5rem 0" }}>
            {t("app.subtitle")}
          </div>
          <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
            {withTheme ? (
              <>
                {pickLocaleText(form.name, locale) || t("studio.untitled")}
                <br />
                <code dir="ltr" style={{ fontSize: "0.7rem", opacity: 0.75 }}>
                  theme: {form.theme_id ? form.theme_id.slice(0, 13) + "…" : t("studio.noTheme")}
                </code>
              </>
            ) : (
              t("studio.theme_default")
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {!isEditor && (
        <>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <span className="hint" style={{ margin: 0 }}>
              {t("studio.eventsHint")}
            </span>
            <ActiveThemeChip />
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={openCreate}>
              {t("studio.newEvent")}
            </Button>
          </div>
          {list.isLoading && <div className="empty">{t("common.loading")}</div>}
          {list.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => list.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="empty">
              <p>{t("studio.emptyEvents")}</p>
              <p style={{ fontSize: "0.85rem" }}>{t("studio.emptyEventsHint")}</p>
            </div>
          )}
          {list.data && list.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("studio.name")}</th>
                    <th>{t("studio.hijriDate")}</th>
                    <th>{t("studio.themeLabel")}</th>
                    <th>{t("content.tableStatus")}</th>
                    <th>{t("studio.version")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((e) => {
                    const monthKey =
                      HIJRI_MONTHS.find((m) => m.value === e.hijri_month)?.key ?? "";
                    return (
                      <tr key={e.id}>
                        <td>{e.name?.[locale] || e.name?.fa || "—"}</td>
                        <td>
                          {e.hijri_day} {t(`studio.month_${monthKey}`)}
                          {e.recurring ? ` · ${t("studio.recurringShort")}` : ""}
                        </td>
                        <td>
                          <code dir="ltr" style={{ fontSize: "0.72rem" }}>
                            {e.theme_id ? e.theme_id.slice(0, 8) + "…" : "—"}
                          </code>
                        </td>
                        <td>
                          <Badge tone={statusTone(e.workflow_status)}>
                            {statusLabel(t, e.workflow_status)}
                          </Badge>
                        </td>
                        <td>v{e.version}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <Button size="sm" variant="secondary" onClick={() => openEdit(e.id)}>
                            {t("studio.edit")}
                          </Button>{" "}
                          <Button size="sm" variant="ghost" onClick={() => handleArchive(e.id)}>
                            {t("studio.archive")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {isEditor && (
        <div>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <Button size="sm" variant="secondary" onClick={close}>
              {t("studio.back")}
            </Button>
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
              {creating ? t("studio.newEvent") : t("studio.editEvent")}
            </h2>
            <span style={{ flex: 1 }} />
            {!creating && editingId && (
              <>
                <WorkflowBar
                  status={form.workflow_status}
                  pending={transitionMut.isPending}
                  onTransition={handleTransition}
                />
                <Button size="sm" variant="ghost" onClick={() => setShowVersions((v) => !v)}>
                  {t("studio.versions")} (v{form.version})
                </Button>
              </>
            )}
          </div>

          {detail.isLoading && !creating && <div className="empty">{t("common.loading")}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Card>
              <CardHeader>
                <CardTitle>{t("studio.details")}</CardTitle>
              </CardHeader>
              <CardContent>
                <LocalizedInput
                  id="ev-name"
                  label={t("studio.name")}
                  value={form.name}
                  onChange={(v) => patch({ name: v })}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="field">
                    <label htmlFor="ev-month">{t("studio.hijriMonth")}</label>
                    <select
                      id="ev-month"
                      className="input"
                      value={form.hijri_month}
                      onChange={(e) => patch({ hijri_month: Number(e.target.value) })}
                    >
                      {HIJRI_MONTHS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {t(`studio.month_${m.key}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="ev-day">{t("studio.hijriDay")}</label>
                    <input
                      id="ev-day"
                      type="number"
                      min={1}
                      max={30}
                      className="input"
                      value={form.hijri_day}
                      onChange={(e) =>
                        patch({
                          hijri_day: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="ev-theme">{t("studio.themeId")}</label>
                  <input
                    id="ev-theme"
                    className="input"
                    dir="ltr"
                    placeholder="uuid"
                    value={form.theme_id ?? ""}
                    onChange={(e) => patch({ theme_id: e.target.value.trim() || null })}
                  />
                  <div className="hint">{t("studio.themeIdHint")}</div>
                </div>
                <div className="field">
                  <label htmlFor="ev-banner">{t("studio.bannerImage")}</label>
                  <input
                    id="ev-banner"
                    className="input"
                    dir="ltr"
                    placeholder="https://…"
                    value={form.image_url ?? ""}
                    onChange={(e) => patch({ image_url: e.target.value || null })}
                  />
                  <div className="hint">{t("studio.mediaHint")}</div>
                </div>
                <ScheduleFields
                  startsAt={form.starts_at}
                  endsAt={form.ends_at}
                  onChange={(p) => patch(p)}
                />
                <div style={{ display: "flex", gap: "1.25rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", color: "var(--x-text2)" }}>
                    <input
                      type="checkbox"
                      checked={form.recurring}
                      onChange={(e) => patch({ recurring: e.target.checked })}
                    />
                    {t("studio.recurring")}
                  </label>
                  <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", color: "var(--x-text2)" }}>
                    <input
                      type="checkbox"
                      checked={form.auto_publish}
                      onChange={(e) => patch({ auto_publish: e.target.checked })}
                    />
                    {t("studio.autoPublish")}
                  </label>
                  <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", color: "var(--x-text2)" }}>
                    <input
                      type="checkbox"
                      checked={form.needs_admin_confirmation}
                      onChange={(e) => patch({ needs_admin_confirmation: e.target.checked })}
                    />
                    {t("studio.needsAdminConfirmation")}
                  </label>
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  <DistributionToggles
                    value={form.distribution}
                    onChange={(v) => patch({ distribution: v })}
                  />
                </div>
                <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                  <Button size="sm" disabled={saving} onClick={handleSave}>
                    {saving ? t("common.loading") : t("studio.save")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={close}>
                    {t("studio.cancel")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <Card>
                <CardHeader>
                  <CardTitle>{t("studio.activationPreview")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    {themeCompare(false)}
                    {themeCompare(true)}
                  </div>
                  <p className="hint" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                    {t("studio.activationPreviewHint")}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t("content.preview")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <PreviewMatrix kind="event" itemId={editingId ?? "new"} render={renderPreview} />
                </CardContent>
              </Card>
              {showVersions && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("studio.versionHistory")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {versions.isLoading && <p className="muted">{t("common.loading")}</p>}
                    {versions.data && versions.data.length === 0 && (
                      <p className="muted">{t("studio.noVersions")}</p>
                    )}
                    {versions.data?.map((v) => (
                      <div
                        key={v.version}
                        style={{
                          padding: "0.5rem 0",
                          borderBottom: "1px solid var(--x-line)",
                          fontSize: "0.85rem",
                        }}
                      >
                        <Badge tone="neutral">v{v.version}</Badge>{" "}
                        <span style={{ color: "var(--x-text2)" }}>
                          {v.created_at ? formatDate(v.created_at) : "—"}
                        </span>
                        {v.summary ? <div>{v.summary}</div> : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
