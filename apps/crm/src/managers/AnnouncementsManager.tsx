import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import {
  ANNOUNCEMENT_PLACEMENTS,
  AUDIENCES,
  Announcement,
  DEFAULT_DISTRIBUTION,
  EMPTY_L10N,
  WorkflowStatus,
  audienceSegment,
  toAudienceDict,
} from "../lib/contentApi";
import {
  useAnnouncement,
  useAnnouncements,
  useArchiveContent,
  useCreateContent,
  useTransitionContent,
  useUpdateContent,
} from "../lib/contentHooks";
import { useI18n, type Locale } from "../lib/i18n";
import LocalizedInput from "../components/LocalizedInput";
import WorkflowBar from "../components/WorkflowBar";
import DistributionToggles from "../components/DistributionToggles";
import ScheduleFields from "../components/ScheduleFields";
import PreviewMatrix, { pickLocaleText } from "../components/PreviewMatrix";

const EMPTY_ANNOUNCEMENT: Announcement = {
  id: "",
  message: { ...EMPTY_L10N },
  audience: { segment: "all" },
  placement: "global",
  dismissible: true,
  starts_at: null,
  ends_at: null,
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

export default function AnnouncementsManager(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const list = useAnnouncements();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<Announcement>(EMPTY_ANNOUNCEMENT);

  const detail = useAnnouncement(editingId);
  const createMut = useCreateContent<Announcement>("announcements");
  const updateMut = useUpdateContent<Announcement>("announcements");
  const archiveMut = useArchiveContent<Announcement>("announcements");
  const transitionMut = useTransitionContent<Announcement>("announcements");

  React.useEffect(() => {
    if (detail.data) {
      setForm({
        ...EMPTY_ANNOUNCEMENT,
        ...detail.data,
        message: { ...EMPTY_L10N, ...(detail.data.message ?? {}) },
        audience: detail.data.audience ?? { segment: "all" },
        distribution: { ...DEFAULT_DISTRIBUTION, ...(detail.data.distribution ?? {}) },
      });
    }
  }, [detail.data]);

  const openCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY_ANNOUNCEMENT);
    setCreating(true);
  };
  const openEdit = (id: string): void => {
    setCreating(false);
    setEditingId(id);
  };
  const close = (): void => {
    setCreating(false);
    setEditingId(null);
  };

  const saving = createMut.isPending || updateMut.isPending;
  const patch = (p: Partial<Announcement>): void => setForm({ ...form, ...p });
  const isEditor = creating || editingId !== null;

  const handleSave = (): void => {
    const { id, version, created_at, updated_at, workflow_status, ...body } =
      form as Announcement & Record<string, unknown>;
    void version; void created_at; void updated_at; void workflow_status;
    if (creating) {
      createMut.mutate(body, {
        onSuccess: (row) => {
          setCreating(false);
          setEditingId(row.id);
        },
      });
    } else if (editingId) {
      updateMut.mutate({ id: editingId, body });
    }
  };

  const handleArchive = (id: string): void => {
    if (!window.confirm(t("studio.confirmArchive"))) return;
    archiveMut.mutate(id, { onSuccess: () => { if (id === editingId) close(); } });
  };

  const renderPreview = ({ locale: l, dir }: { locale: Locale; dir: "rtl" | "ltr" }): React.ReactNode => (
    <div
      dir={dir}
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.9rem 1.1rem",
        borderRadius: "0.6rem",
        background: "#2a2113",
        border: "1px solid var(--x-gold)",
        color: "#f2ead6",
      }}
    >
      <span style={{ fontSize: "1.2rem" }} aria-hidden="true">📢</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
          {pickLocaleText(form.message, l) || t("studio.untitled")}
        </div>
        <div style={{ fontSize: "0.72rem", opacity: 0.65, marginTop: "0.4rem" }}>
          {t(`studio.ap_${form.placement}`)} · {t(`studio.audience_${audienceSegment(form.audience)}`)}
          {form.starts_at ? ` · ${formatDate(form.starts_at)}` : ""}
        </div>
      </div>
      {form.dismissible && (
        <button
          type="button"
          aria-label={t("studio.dismiss")}
          style={{
            background: "transparent", border: 0, color: "inherit",
            fontSize: "1rem", cursor: "pointer", opacity: 0.7,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div>
      {!isEditor && (
        <>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <span className="hint" style={{ margin: 0 }}>{t("studio.announcementsHint")}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={openCreate}>{t("studio.newAnnouncement")}</Button>
          </div>
          {list.isLoading && <div className="empty">{t("common.loading")}</div>}
          {list.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => list.refetch()}>{t("common.retry")}</Button>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="empty"><p>{t("studio.emptyAnnouncements")}</p></div>
          )}
          {list.data && list.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("studio.title")}</th>
                    <th>{t("studio.placement")}</th>
                    <th>{t("studio.audience")}</th>
                    <th>{t("studio.schedule")}</th>
                    <th>{t("content.tableStatus")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((a) => (
                    <tr key={a.id}>
                      <td style={{ maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message?.[locale] || a.message?.fa || "—"}</td>
                      <td>{t(`studio.ap_${a.placement}`)}</td>
                      <td>{t(`studio.audience_${audienceSegment(a.audience)}`)}</td>
                      <td style={{ fontSize: "0.8rem" }}>
                        {a.starts_at ? formatDate(a.starts_at) : "—"}
                        {" → "}
                        {a.ends_at ? formatDate(a.ends_at) : "—"}
                      </td>
                      <td><Badge tone={statusTone(a.workflow_status)}>{statusLabel(t, a.workflow_status)}</Badge></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(a.id)}>{t("studio.edit")}</Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => handleArchive(a.id)}>{t("studio.archive")}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {isEditor && (
        <div>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <Button size="sm" variant="secondary" onClick={close}>{t("studio.back")}</Button>
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
              {creating ? t("studio.newAnnouncement") : t("studio.editAnnouncement")}
            </h2>
            <span style={{ flex: 1 }} />
            {!creating && editingId && (
              <WorkflowBar
                status={form.workflow_status}
                pending={transitionMut.isPending}
                onTransition={(to: WorkflowStatus) => transitionMut.mutate({ id: editingId, to })}
              />
            )}
          </div>

          {detail.isLoading && !creating && <div className="empty">{t("common.loading")}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Card>
              <CardHeader><CardTitle>{t("studio.details")}</CardTitle></CardHeader>
              <CardContent>
                <LocalizedInput id="an-message" label={t("studio.message")} value={form.message} onChange={(v) => patch({ message: v })} multiline rows={4} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="field">
                    <label htmlFor="an-place">{t("studio.placement")}</label>
                    <select id="an-place" className="input" value={form.placement} onChange={(e) => patch({ placement: e.target.value })}>
                      {ANNOUNCEMENT_PLACEMENTS.map((p) => (
                        <option key={p} value={p}>{t(`studio.ap_${p}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="an-aud">{t("studio.audience")}</label>
                    <select id="an-aud" className="input" value={audienceSegment(form.audience)} onChange={(e) => patch({ audience: toAudienceDict(e.target.value) })}>
                      {AUDIENCES.map((a) => (
                        <option key={a} value={a}>{t(`studio.audience_${a}`)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", color: "var(--x-text2)", marginBottom: "0.75rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.dismissible} onChange={(e) => patch({ dismissible: e.target.checked })} />
                  {t("studio.dismissible")}
                </label>
                <ScheduleFields startsAt={form.starts_at} endsAt={form.ends_at} onChange={(p) => patch(p)} />
                <div style={{ marginTop: "0.75rem" }}>
                  <DistributionToggles value={form.distribution} onChange={(v) => patch({ distribution: v })} />
                </div>
                <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                  <Button size="sm" disabled={saving} onClick={handleSave}>
                    {saving ? t("common.loading") : t("studio.save")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={close}>{t("studio.cancel")}</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("content.preview")}</CardTitle></CardHeader>
              <CardContent>
                <PreviewMatrix kind="announcement" itemId={editingId ?? "new"} render={renderPreview} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
