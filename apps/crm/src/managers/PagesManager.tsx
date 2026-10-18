import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import {
  CmsBlock,
  ContentPageResource,
  DEFAULT_DISTRIBUTION,
  EMPTY_L10N,
  PageContentType,
  WorkflowStatus,
} from "../lib/contentApi";
import {
  useArchiveContent,
  useCreateContent,
  usePage,
  usePages,
  useTransitionContent,
  useUpdateContent,
} from "../lib/contentHooks";
import { useI18n } from "../lib/i18n";
import LocalizedInput from "../components/LocalizedInput";
import WorkflowBar from "../components/WorkflowBar";
import DistributionToggles from "../components/DistributionToggles";
import GrapesEditor from "../components/GrapesEditor";

const EMPTY_PAGE: ContentPageResource = {
  id: "",
  slug: "",
  title: { ...EMPTY_L10N },
  blocks: [],
  seo_meta: {},
  content_type: "page",
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

export default function PagesManager(): React.ReactElement {
  const { t, locale } = useI18n();
  const list = usePages();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<ContentPageResource>(EMPTY_PAGE);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [blocksDirty, setBlocksDirty] = React.useState(false);

  const detail = usePage(editingId);
  const createMut = useCreateContent<ContentPageResource>("pages");
  const updateMut = useUpdateContent<ContentPageResource>("pages");
  const archiveMut = useArchiveContent<ContentPageResource>("pages");
  const transitionMut = useTransitionContent<ContentPageResource>("pages");

  React.useEffect(() => {
    if (detail.data) {
      setForm({
        ...EMPTY_PAGE,
        ...detail.data,
        title: { ...EMPTY_L10N, ...(detail.data.title ?? {}) },
        seo_meta: (detail.data.seo_meta ?? {}) as Record<string, unknown>,
        content_type: detail.data.content_type ?? "page",
        blocks: Array.isArray(detail.data.blocks) ? detail.data.blocks : [],
        distribution: { ...DEFAULT_DISTRIBUTION, ...(detail.data.distribution ?? {}) },
      });
      setBlocksDirty(false);
    }
  }, [detail.data]);

  const openCreate = (): void => {
    setEditingId(null);
    setForm(EMPTY_PAGE);
    setCreating(true);
    setEditorOpen(false);
  };
  const openEdit = (id: string): void => {
    setCreating(false);
    setEditingId(id);
    setEditorOpen(false);
  };
  const close = (): void => {
    setCreating(false);
    setEditingId(null);
    setEditorOpen(false);
    setBlocksDirty(false);
  };

  const saving = createMut.isPending || updateMut.isPending;
  const patch = (p: Partial<ContentPageResource>): void => setForm({ ...form, ...p });
  const seoL10n = (key: string): { fa: string; ar: string; en: string } => {
    const v = (form.seo_meta as Record<string, unknown>)[key];
    return v && typeof v === "object"
      ? { ...EMPTY_L10N, ...(v as Record<string, string>) }
      : { ...EMPTY_L10N };
  };
  const patchSeo = (key: string, v: { fa: string; ar: string; en: string }): void =>
    patch({ seo_meta: { ...(form.seo_meta as Record<string, unknown>), [key]: v } });
  const isEditor = creating || editingId !== null;

  const handleSave = (): void => {
    const { id, version, created_at, updated_at, workflow_status, ...body } =
      form as ContentPageResource & Record<string, unknown>;
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

  const handleSaveBlocks = (blocks: CmsBlock[]): void => {
    patch({ blocks });
    if (!editingId) {
      // New page: stash blocks in the form; they persist with the first save.
      setBlocksDirty(false);
      return;
    }
    updateMut.mutate(
      { id: editingId, body: { blocks } },
      {
        onSuccess: () => {
          setBlocksDirty(false);
          patch({ version: form.version + 1 });
        },
      },
    );
  };

  const handleArchive = (id: string): void => {
    if (!window.confirm(t("studio.confirmArchive"))) return;
    archiveMut.mutate(id, { onSuccess: () => { if (id === editingId) close(); } });
  };

  return (
    <div>
      {!isEditor && (
        <>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <span className="hint" style={{ margin: 0 }}>{t("studio.pagesHint")}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={openCreate}>{t("studio.newPage")}</Button>
          </div>
          {list.isLoading && <div className="empty">{t("common.loading")}</div>}
          {list.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => list.refetch()}>{t("common.retry")}</Button>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="empty"><p>{t("studio.emptyPages")}</p></div>
          )}
          {list.data && list.data.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("studio.title")}</th>
                    <th>{t("studio.slug")}</th>
                    <th>{t("studio.blocksCount")}</th>
                    <th>{t("content.tableStatus")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((p) => (
                    <tr key={p.id}>
                      <td>{p.title?.[locale] || p.title?.fa || "—"}</td>
                      <td><code dir="ltr" style={{ fontSize: "0.78rem" }}>/{p.slug}</code></td>
                      <td>{Array.isArray(p.blocks) ? p.blocks.length : 0}</td>
                      <td><Badge tone={statusTone(p.workflow_status)}>{statusLabel(t, p.workflow_status)}</Badge></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(p.id)}>{t("studio.edit")}</Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => handleArchive(p.id)}>{t("studio.archive")}</Button>
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
              {creating ? t("studio.newPage") : t("studio.editPage")}
            </h2>
            <span style={{ flex: 1 }} />
            {!creating && editingId && (
              <WorkflowBar
                status={form.workflow_status}
                pending={transitionMut.isPending}
                onTransition={(to: WorkflowStatus) => transitionMut.mutate({ id: editingId, to })}
              />
            )}
            <Button
              size="sm"
              variant={editorOpen ? "secondary" : undefined}
              onClick={() => setEditorOpen((v) => !v)}
            >
              {editorOpen ? t("studio.pageSettings") : t("studio.openEditor")}
            </Button>
          </div>

          {detail.isLoading && !creating && <div className="empty">{t("common.loading")}</div>}

          {!editorOpen && (
            <Card style={{ maxWidth: "860px" }}>
              <CardHeader><CardTitle>{t("studio.details")}</CardTitle></CardHeader>
              <CardContent>
                <div className="field">
                  <label htmlFor="pg-slug">{t("studio.slug")}</label>
                  <input
                    id="pg-slug"
                    className="input"
                    dir="ltr"
                    value={form.slug}
                    onChange={(e) =>
                      patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "-") })
                    }
                    placeholder="about-us"
                  />
                  <div className="hint">{t("studio.slugHint")}</div>
                </div>
                <LocalizedInput id="pg-title" label={t("studio.title")} value={form.title} onChange={(v) => patch({ title: v })} />
                <div className="field">
                  <label htmlFor="pg-ctype">{t("studio.contentType")}</label>
                  <select
                    id="pg-ctype"
                    className="input"
                    value={form.content_type}
                    onChange={(e) => patch({ content_type: e.target.value as PageContentType })}
                  >
                    {(["page", "article", "faq"] as const).map((ct) => (
                      <option key={ct} value={ct}>
                        {t(`studio.ctype_${ct}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <LocalizedInput id="pg-seo-t" label={t("studio.seoTitle")} value={seoL10n("title")} onChange={(v) => patchSeo("title", v)} />
                <LocalizedInput id="pg-seo-d" label={t("studio.seoDescription")} value={seoL10n("description")} onChange={(v) => patchSeo("description", v)} multiline rows={2} />
                <div style={{ marginTop: "0.75rem" }}>
                  <DistributionToggles value={form.distribution} onChange={(v) => patch({ distribution: v })} />
                </div>
                <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                  <Button size="sm" disabled={saving} onClick={handleSave}>
                    {saving ? t("common.loading") : t("studio.save")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditorOpen(true)}>
                    {t("studio.openEditor")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {editorOpen && (
            <div>
              <p className="hint">
                {t("studio.visualEditorHint")}
                {blocksDirty ? ` · ${t("studio.unsavedBlocks")}` : ""}
              </p>
              <GrapesEditor
                key={editingId ?? "new"}
                initialBlocks={form.blocks}
                saving={updateMut.isPending}
                onSave={handleSaveBlocks}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
