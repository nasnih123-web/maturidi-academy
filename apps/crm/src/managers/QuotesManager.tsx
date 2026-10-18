import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import {
  DEFAULT_DISTRIBUTION,
  EMPTY_L10N,
  QUOTE_PLACEMENTS,
  ScholarQuote,
  WorkflowStatus,
} from "../lib/contentApi";
import {
  useArchiveContent,
  useCreateContent,
  useQuote,
  useQuotes,
  useTransitionContent,
  useUpdateContent,
} from "../lib/contentHooks";
import { useI18n, type Locale } from "../lib/i18n";
import LocalizedInput from "../components/LocalizedInput";
import WorkflowBar from "../components/WorkflowBar";
import DistributionToggles from "../components/DistributionToggles";
import PreviewMatrix, { pickLocaleText } from "../components/PreviewMatrix";

const EMPTY_QUOTE: ScholarQuote = {
  id: "",
  scholar: { ...EMPTY_L10N },
  text: { ...EMPTY_L10N },
  source: null,
  quote_date: null,
  avatar_url: null,
  placements: ["quote_section"],
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

export default function QuotesManager(): React.ReactElement {
  const { t, locale, formatDate } = useI18n();
  const list = useQuotes();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<ScholarQuote>(EMPTY_QUOTE);

  const detail = useQuote(editingId);
  const createMut = useCreateContent<ScholarQuote>("quotes");
  const updateMut = useUpdateContent<ScholarQuote>("quotes");
  const archiveMut = useArchiveContent<ScholarQuote>("quotes");
  const transitionMut = useTransitionContent<ScholarQuote>("quotes");

  React.useEffect(() => {
    if (detail.data) {
      setForm({
        ...EMPTY_QUOTE,
        ...detail.data,
        scholar: { ...EMPTY_L10N, ...(detail.data.scholar ?? {}) },
        text: { ...EMPTY_L10N, ...(detail.data.text ?? {}) },
        distribution: { ...DEFAULT_DISTRIBUTION, ...(detail.data.distribution ?? {}) },
        placements: detail.data.placements ?? ["quote_section"],
      });
    }
  }, [detail.data]);

  const openCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY_QUOTE);
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
  const patch = (p: Partial<ScholarQuote>): void => setForm({ ...form, ...p });
  const isEditor = creating || editingId !== null;

  const handleSave = (): void => {
    const { id, version, created_at, updated_at, workflow_status, ...body } =
      form as ScholarQuote & Record<string, unknown>;
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

  const togglePlacement = (p: string): void => {
    patch({
      placements: form.placements.includes(p)
        ? form.placements.filter((x) => x !== p)
        : [...form.placements, p],
    });
  };

  const renderPreview = ({ locale: l, dir }: { locale: Locale; dir: "rtl" | "ltr" }): React.ReactNode => (
    <figure
      dir={dir}
      style={{
        margin: 0,
        padding: "1.5rem",
        borderRadius: "0.6rem",
        background: "linear-gradient(135deg, #1a1408, #241b0c)",
        border: "1px solid var(--x-gold)",
        color: "#f2ead6",
      }}
    >
      <div style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start" }}>
        {form.avatar_url ? (
          <img
            src={form.avatar_url}
            alt=""
            style={{ width: "56px", height: "56px", borderRadius: "50%", objectFit: "cover", border: "2px solid var(--x-gold)" }}
          />
        ) : (
          <div
            style={{
              width: "56px", height: "56px", borderRadius: "50%", flexShrink: 0,
              background: "#c9a22733", border: "2px solid var(--x-gold)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.4rem", color: "var(--x-gold)",
            }}
          >
            ❝
          </div>
        )}
        <div>
          <blockquote style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.9 }}>
            {pickLocaleText(form.text, l) || t("studio.untitled")}
          </blockquote>
          <figcaption style={{ marginTop: "0.6rem", fontSize: "0.85rem", color: "var(--x-gold2)" }}>
            — {pickLocaleText(form.scholar, l) || "…"}
            {form.source ? <span style={{ opacity: 0.7 }}> · {form.source}</span> : null}
            {form.quote_date ? <span style={{ opacity: 0.7 }}> · {formatDate(form.quote_date)}</span> : null}
          </figcaption>
        </div>
      </div>
    </figure>
  );

  return (
    <div>
      {!isEditor && (
        <>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <span className="hint" style={{ margin: 0 }}>{t("studio.quotesHint")}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={openCreate}>{t("studio.newQuote")}</Button>
          </div>
          {list.isLoading && <div className="empty">{t("common.loading")}</div>}
          {list.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => list.refetch()}>{t("common.retry")}</Button>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="empty"><p>{t("studio.emptyQuotes")}</p></div>
          )}
          {list.data && list.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("studio.scholarName")}</th>
                    <th>{t("studio.text")}</th>
                    <th>{t("studio.source")}</th>
                    <th>{t("studio.placementsLabel")}</th>
                    <th>{t("content.tableStatus")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((q) => (
                    <tr key={q.id}>
                      <td>{q.scholar?.[locale] || q.scholar?.fa || "—"}</td>
                      <td style={{ maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {q.text?.[locale] || q.text?.fa || "—"}
                      </td>
                      <td>{q.source || "—"}</td>
                      <td>
                        {(q.placements ?? []).map((p) => (
                          <Badge key={p} tone="neutral" style={{ marginInlineEnd: "0.25rem" }}>
                            {t(`studio.qp_${p}`)}
                          </Badge>
                        ))}
                      </td>
                      <td><Badge tone={statusTone(q.workflow_status)}>{statusLabel(t, q.workflow_status)}</Badge></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(q.id)}>{t("studio.edit")}</Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => handleArchive(q.id)}>{t("studio.archive")}</Button>
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
              {creating ? t("studio.newQuote") : t("studio.editQuote")}
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
                <LocalizedInput id="q-scholar" label={t("studio.scholarName")} value={form.scholar} onChange={(v) => patch({ scholar: v })} />
                <LocalizedInput id="q-text" label={t("studio.text")} value={form.text} onChange={(v) => patch({ text: v })} multiline rows={4} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="field">
                    <label htmlFor="q-source">{t("studio.source")}</label>
                    <input id="q-source" className="input" value={form.source ?? ""} onChange={(e) => patch({ source: e.target.value || null })} placeholder={t("studio.sourceHint")} />
                  </div>
                  <div className="field">
                    <label htmlFor="q-date">{t("studio.quoteDate")}</label>
                    <input id="q-date" type="date" className="input" value={form.quote_date ? form.quote_date.slice(0, 10) : ""} onChange={(e) => patch({ quote_date: e.target.value || null })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="q-avatar">{t("studio.avatarUrl")}</label>
                  <input id="q-avatar" className="input" dir="ltr" placeholder="https://…" value={form.avatar_url ?? ""} onChange={(e) => patch({ avatar_url: e.target.value || null })} />
                  <div className="hint">{t("studio.mediaHint")}</div>
                </div>
                <fieldset style={{ border: "1px solid var(--x-line)", borderRadius: "0.6rem", padding: "0.75rem 1rem", margin: "0 0 0.75rem" }}>
                  <legend className="hint" style={{ padding: "0 0.5rem", marginBottom: 0 }}>{t("studio.placementsLabel")}</legend>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    {QUOTE_PLACEMENTS.map((p) => (
                      <label key={p} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", color: "var(--x-text2)", cursor: "pointer" }}>
                        <input type="checkbox" checked={form.placements.includes(p)} onChange={() => togglePlacement(p)} />
                        {t(`studio.qp_${p}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <DistributionToggles value={form.distribution} onChange={(v) => patch({ distribution: v })} />
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
                <PreviewMatrix kind="quote" itemId={editingId ?? "new"} render={renderPreview} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
