import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import {
  AUDIENCES,
  BANNER_PLACEMENTS,
  Banner,
  DEFAULT_DISTRIBUTION,
  EMPTY_L10N,
  audienceSegment,
  toAudienceDict,
} from "../lib/contentApi";
import {
  useArchiveContent,
  useBanner,
  useBanners,
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

const EMPTY_BANNER: Banner = {
  id: "",
  title: { ...EMPTY_L10N },
  subtitle: null,
  media: null,
  cta: null,
  placement: "homepage",
  priority: 0,
  starts_at: null,
  ends_at: null,
  audience: { segment: "all" },
  workflow_status: "draft",
  distribution: { ...DEFAULT_DISTRIBUTION },
  version: 1,
  created_at: "",
  updated_at: "",
};

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORTS: { key: Viewport; width: string; label: string }[] = [
  { key: "desktop", width: "100%", label: "1280" },
  { key: "tablet", width: "768px", label: "768" },
  { key: "mobile", width: "390px", label: "390" },
];

function statusLabel(t: (k: string) => string, s: string): string {
  const k = t(`status.${s}`);
  return k === `status.${s}` ? s : k;
}

export default function BannersManager(): React.ReactElement {
  const { t, locale } = useI18n();
  const list = useBanners();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<Banner>(EMPTY_BANNER);
  const [viewport, setViewport] = React.useState<Viewport>("desktop");

  const detail = useBanner(editingId);
  const createMut = useCreateContent<Banner>("banners");
  const updateMut = useUpdateContent<Banner>("banners");
  const archiveMut = useArchiveContent<Banner>("banners");
  const transitionMut = useTransitionContent<Banner>("banners");

  React.useEffect(() => {
    if (detail.data) {
      setForm({
        ...EMPTY_BANNER,
        ...detail.data,
        title: { ...EMPTY_L10N, ...(detail.data.title ?? {}) },
        subtitle: detail.data.subtitle
          ? { ...EMPTY_L10N, ...detail.data.subtitle }
          : null,
        media: detail.data.media ?? null,
        cta: detail.data.cta
          ? {
              text: { ...EMPTY_L10N, ...(detail.data.cta.text ?? {}) },
              url: detail.data.cta.url ?? "",
              link_type: detail.data.cta.link_type ?? "internal",
            }
          : null,
        audience: detail.data.audience ?? { segment: "all" },
        distribution: { ...DEFAULT_DISTRIBUTION, ...(detail.data.distribution ?? {}) },
      });
    }
  }, [detail.data]);

  const openCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY_BANNER);
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
  const patch = (p: Partial<Banner>): void => setForm({ ...form, ...p });
  const patchMedia = (mp: Partial<{ type: "image" | "video"; url: string }>): void => {
    const next = { type: "image" as const, url: "", ...(form.media ?? {}), ...mp };
    patch({ media: next.url ? next : null });
  };
  const patchCta = (cp: Partial<{ text: typeof EMPTY_L10N; url: string; link_type: "internal" | "external" }>): void => {
    const next = {
      text: { ...EMPTY_L10N },
      url: "",
      link_type: "internal" as const,
      ...(form.cta ?? {}),
      ...cp,
    };
    patch({ cta: next.url || next.text.fa || next.text.ar || next.text.en ? next : null });
  };
  const isEditor = creating || editingId !== null;

  const handleSave = (): void => {
    const { id, version, created_at, updated_at, workflow_status, ...body } =
      form as Banner & Record<string, unknown>;
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

  /** Banner creative as the audience will see it (responsive shell applied by caller). */
  const renderCreative = ({ locale: l, dir }: { locale: Locale; dir: "rtl" | "ltr" }): React.ReactNode => (
    <div
      style={{
        position: "relative",
        borderRadius: "0.6rem",
        overflow: "hidden",
        background: "#14100a",
        border: "1px solid var(--x-line)",
        minHeight: "180px",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      {form.media?.url && form.media.type === "image" ? (
        <img
          src={form.media.url}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }}
        />
      ) : null}
      {form.media?.url && form.media.type === "video" ? (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "#00000088", color: "#fff", fontSize: "2rem",
          }}
        >
          ▶
        </div>
      ) : null}
      <div style={{ position: "relative", padding: "1.25rem", color: "#f5efdd" }} dir={dir}>
        <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>
          {pickLocaleText(form.title, l) || t("studio.untitled")}
        </div>
        {form.subtitle && pickLocaleText(form.subtitle, l) ? (
          <div style={{ fontSize: "0.9rem", opacity: 0.85, marginTop: "0.25rem" }}>
            {pickLocaleText(form.subtitle, l)}
          </div>
        ) : null}
        {form.cta && pickLocaleText(form.cta.text, l) ? (
          <span
            style={{
              display: "inline-block", marginTop: "0.75rem", padding: "0.45rem 1.1rem",
              borderRadius: "999px", background: "var(--x-gold)", color: "#1a1408",
              fontSize: "0.85rem", fontWeight: 700,
            }}
          >
            {pickLocaleText(form.cta.text, l)}
          </span>
        ) : null}
        {form.cta?.url ? (
          <div style={{ fontSize: "0.72rem", opacity: 0.6, marginTop: "0.6rem" }} dir="ltr">
            → {form.cta.url}
          </div>
        ) : null}
      </div>
    </div>
  );

  const vp = VIEWPORTS.find((v) => v.key === viewport) ?? VIEWPORTS[0];

  return (
    <div>
      {!isEditor && (
        <>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <span className="hint" style={{ margin: 0 }}>{t("studio.bannersHint")}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={openCreate}>{t("studio.newBanner")}</Button>
          </div>
          {list.isLoading && <div className="empty">{t("common.loading")}</div>}
          {list.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => list.refetch()}>{t("common.retry")}</Button>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="empty"><p>{t("studio.emptyBanners")}</p></div>
          )}
          {list.data && list.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("studio.title")}</th>
                    <th>{t("studio.placement")}</th>
                    <th>{t("studio.priority")}</th>
                    <th>{t("studio.audience")}</th>
                    <th>{t("content.tableStatus")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((b) => (
                    <tr key={b.id}>
                      <td>{b.title?.[locale] || b.title?.fa || "—"}</td>
                      <td><code style={{ fontSize: "0.78rem" }}>{b.placement}</code></td>
                      <td>{b.priority}</td>
                      <td>{t(`studio.audience_${audienceSegment(b.audience)}`)}</td>
                      <td><Badge tone={statusTone(b.workflow_status)}>{statusLabel(t, b.workflow_status)}</Badge></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(b.id)}>{t("studio.edit")}</Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => handleArchive(b.id)}>{t("studio.archive")}</Button>
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
              {creating ? t("studio.newBanner") : t("studio.editBanner")}
            </h2>
            <span style={{ flex: 1 }} />
            {!creating && editingId && (
              <WorkflowBar
                status={form.workflow_status}
                pending={transitionMut.isPending}
                onTransition={(to) => transitionMut.mutate({ id: editingId, to })}
              />
            )}
          </div>

          {detail.isLoading && !creating && <div className="empty">{t("common.loading")}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <Card>
              <CardHeader><CardTitle>{t("studio.details")}</CardTitle></CardHeader>
              <CardContent>
                <LocalizedInput id="bn-title" label={t("studio.title")} value={form.title} onChange={(v) => patch({ title: v })} />
                <LocalizedInput id="bn-sub" label={t("studio.subtitle")} value={form.subtitle ?? { ...EMPTY_L10N }} onChange={(v) => patch({ subtitle: v })} multiline rows={2} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="field">
                    <label htmlFor="bn-mtype">{t("studio.mediaType")}</label>
                    <select id="bn-mtype" className="input" value={form.media?.type ?? "image"} onChange={(e) => patchMedia({ type: e.target.value as "image" | "video" })}>
                      <option value="image">{t("studio.mediaImage")}</option>
                      <option value="video">{t("studio.mediaVideo")}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="bn-prio">{t("studio.priority")}</label>
                    <input id="bn-prio" type="number" className="input" value={form.priority} onChange={(e) => patch({ priority: Number(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="bn-media">{t("studio.mediaUrl")}</label>
                  <input id="bn-media" className="input" dir="ltr" placeholder="https://…" value={form.media?.url ?? ""} onChange={(e) => patchMedia({ url: e.target.value })} />
                  <div className="hint">{t("studio.mediaHint")}</div>
                </div>
                <LocalizedInput id="bn-cta" label={t("studio.ctaText")} value={form.cta?.text ?? { ...EMPTY_L10N }} onChange={(v) => patchCta({ text: v })} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="field">
                    <label htmlFor="bn-ctalink">{t("studio.ctaLink")}</label>
                    <input id="bn-ctalink" className="input" dir="ltr" placeholder="https://…" value={form.cta?.url ?? ""} onChange={(e) => patchCta({ url: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="bn-ctakind">{t("studio.ctaKind")}</label>
                    <select
                      id="bn-ctakind"
                      className="input"
                      value={form.cta?.link_type ?? "internal"}
                      onChange={(e) => patchCta({ link_type: e.target.value as "internal" | "external" })}
                    >
                      <option value="internal">{t("studio.ctaInternal")}</option>
                      <option value="external">{t("studio.ctaExternal")}</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="field">
                    <label htmlFor="bn-place">{t("studio.placement")}</label>
                    <select id="bn-place" className="input" value={form.placement} onChange={(e) => patch({ placement: e.target.value })}>
                      {BANNER_PLACEMENTS.map((pl) => (
                        <option key={pl} value={pl}>{t(`studio.slot_${pl}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="bn-aud">{t("studio.audience")}</label>
                    <select id="bn-aud" className="input" value={audienceSegment(form.audience)} onChange={(e) => patch({ audience: toAudienceDict(e.target.value) })}>
                      {AUDIENCES.map((a) => (
                        <option key={a} value={a}>{t(`studio.audience_${a}`)}</option>
                      ))}
                    </select>
                  </div>
                </div>
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

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <Card>
                <CardHeader>
                  <CardTitle>{t("studio.responsivePreview")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem" }} role="tablist" aria-label={t("studio.responsivePreview")}>
                    {VIEWPORTS.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        role="tab"
                        aria-selected={viewport === v.key}
                        onClick={() => setViewport(v.key)}
                        className="input"
                        style={{
                          width: "auto",
                          padding: "0.25rem 0.8rem", fontSize: "0.78rem", cursor: "pointer",
                          borderRadius: "999px",
                          background: viewport === v.key ? "var(--x-gold)" : "transparent",
                          color: viewport === v.key ? "#1a1408" : "var(--x-text2)",
                          border: `1px solid ${viewport === v.key ? "var(--x-gold)" : "var(--x-line)"}`,
                        }}
                      >
                        {t(`studio.viewport_${v.key}`)} · <span dir="ltr">{v.label}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ maxWidth: vp.width, marginInline: "auto", transition: "max-width 0.25s ease" }}>
                    {renderCreative({ locale, dir: locale === "en" ? "ltr" : "rtl" })}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t("content.preview")}</CardTitle></CardHeader>
                <CardContent>
                  <PreviewMatrix kind="banner" itemId={editingId ?? "new"} render={renderCreative} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
