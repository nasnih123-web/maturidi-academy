import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  EMPTY_L10N,
  NavItem,
} from "../lib/contentApi";
import {
  useArchiveContent,
  useContentList,
  useCreateContent,
  useUpdateContent,
} from "../lib/contentHooks";
import { useI18n } from "../lib/i18n";
import LocalizedInput from "../components/LocalizedInput";

const EMPTY_NAV: NavItem = {
  id: "",
  parent_id: null,
  label: { ...EMPTY_L10N },
  url: "/",
  link_type: "internal",
  sort_order: 0,
  visible: true,
  locale: null,
  starts_at: null,
  ends_at: null,
};

type FlatNode = NavItem & { depth: number };

/** Flatten the nested tree depth-first for rendering (pure presentation). */
function flatten(items: NavItem[], depth = 0): FlatNode[] {
  const out: FlatNode[] = [];
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  for (const it of sorted) {
    out.push({ ...it, depth });
    if (it.children && it.children.length > 0) out.push(...flatten(it.children, depth + 1));
  }
  return out;
}

export default function NavManager(): React.ReactElement {
  const { t, locale } = useI18n();
  const list = useContentList<NavItem>("nav");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [parentForNew, setParentForNew] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<NavItem>(EMPTY_NAV);

  const createMut = useCreateContent<NavItem>("nav");
  const updateMut = useUpdateContent<NavItem>("nav");
  const archiveMut = useArchiveContent<NavItem>("nav");

  const flat = React.useMemo(
    () => (list.data ? flatten(list.data) : []),
    [list.data],
  );

  const openCreate = (parentId: string | null): void => {
    setEditingId(null);
    setParentForNew(parentId);
    setForm({ ...EMPTY_NAV, parent_id: parentId });
    setCreating(true);
  };
  const openEdit = (node: FlatNode): void => {
    setCreating(false);
    setParentForNew(null);
    setEditingId(node.id);
    setForm({
      ...EMPTY_NAV,
      ...node,
      label: { ...EMPTY_L10N, ...(node.label ?? {}) },
      locale: node.locale ?? null,
      children: undefined,
    });
  };
  const close = (): void => {
    setCreating(false);
    setEditingId(null);
    setParentForNew(null);
  };

  const saving = createMut.isPending || updateMut.isPending;
  const patch = (p: Partial<NavItem>): void => setForm({ ...form, ...p });
  const isEditor = creating || editingId !== null;

  const handleSave = (): void => {
    const { id, children, ...body } = form as NavItem & { children?: unknown };
    void children;
    if (creating) {
      createMut.mutate(body as Record<string, unknown>, {
        onSuccess: () => close(),
      });
    } else if (editingId) {
      updateMut.mutate(
        { id: editingId, body: body as Record<string, unknown> },
        { onSuccess: () => close() },
      );
    }
  };

  const handleDelete = (id: string): void => {
    if (!window.confirm(t("studio.confirmArchive"))) return;
    archiveMut.mutate(id);
  };

  /** Quick reorder: swap sort_order with the adjacent sibling under the same parent. */
  const moveNode = (node: FlatNode, dir: -1 | 1): void => {
    const siblings = flat
      .filter((n) => (n.parent_id ?? null) === (node.parent_id ?? null))
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex((n) => n.id === node.id);
    const other = siblings[idx + dir];
    if (!other) return;
    updateMut.mutate(
      { id: node.id, body: { sort_order: other.sort_order } },
      {
        onSuccess: () => {
          updateMut.mutate({ id: other.id, body: { sort_order: node.sort_order } });
        },
      },
    );
  };

  return (
    <div>
      {!isEditor && (
        <>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <span className="hint" style={{ margin: 0 }}>{t("studio.navHint")}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={() => openCreate(null)}>{t("studio.newNavItem")}</Button>
          </div>
          {list.isLoading && <div className="empty">{t("common.loading")}</div>}
          {list.isError && (
            <div className="empty">
              <p>{t("common.error")}</p>
              <Button size="sm" variant="secondary" onClick={() => list.refetch()}>{t("common.retry")}</Button>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div className="empty"><p>{t("studio.emptyNav")}</p></div>
          )}
          {flat.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("studio.menuTree")}</CardTitle></CardHeader>
              <CardContent>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {flat.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.6rem",
                        padding: "0.5rem 0.7rem",
                        paddingInlineStart: `calc(0.7rem + ${n.depth * 1.6}rem)`,
                        borderRadius: "0.5rem",
                        border: "1px solid var(--x-line)",
                        opacity: n.visible ? 1 : 0.5,
                      }}
                    >
                      {n.depth > 0 && <span className="muted">↳</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                          {n.label?.[locale] || n.label?.fa || "—"}
                        </span>{" "}
                        <code dir="ltr" style={{ fontSize: "0.72rem", opacity: 0.6 }}>
                          {n.link_type === "external" ? "↗ " : ""}
                          {n.url}
                        </code>
                      </div>
                      <Badge tone="neutral">{t(`studio.scope_${n.locale ?? "all"}`)}</Badge>
                      {!n.visible && <Badge tone="neutral">{t("studio.hidden")}</Badge>}
                      <span className="muted" style={{ fontSize: "0.75rem" }} dir="ltr">#{n.sort_order}</span>
                      <Button size="sm" variant="ghost" onClick={() => moveNode(n, -1)} disabled={updateMut.isPending}>
                        {t("studio.moveUp")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => moveNode(n, 1)} disabled={updateMut.isPending}>
                        {t("studio.moveDown")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openCreate(n.id)}>
                        {t("studio.addChild")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(n)}>
                        {t("studio.edit")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(n.id)}>
                        {t("studio.archive")}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isEditor && (
        <div style={{ maxWidth: "720px" }}>
          <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
            <Button size="sm" variant="secondary" onClick={close}>{t("studio.back")}</Button>
            <h2 style={{ margin: 0, fontSize: "1.05rem", color: "var(--x-gold2)" }}>
              {creating ? t("studio.newNavItem") : t("studio.editNavItem")}
            </h2>
          </div>
          <Card>
            <CardHeader><CardTitle>{t("studio.details")}</CardTitle></CardHeader>
            <CardContent>
              {parentForNew && (
                <p className="hint">
                  {t("studio.childOf")}:{" "}
                  {flat.find((n) => n.id === parentForNew)?.label?.[locale] ?? parentForNew}
                </p>
              )}
              <LocalizedInput id="nv-title" label={t("studio.title")} value={form.label} onChange={(v) => patch({ label: v })} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="field">
                  <label htmlFor="nv-link">{t("studio.link")}</label>
                  <input id="nv-link" className="input" dir="ltr" value={form.url} onChange={(e) => patch({ url: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="nv-kind">{t("studio.linkKind")}</label>
                  <select id="nv-kind" className="input" value={form.link_type} onChange={(e) => patch({ link_type: e.target.value as "internal" | "external" })}>
                    <option value="internal">{t("studio.ctaInternal")}</option>
                    <option value="external">{t("studio.ctaExternal")}</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                <div className="field">
                  <label htmlFor="nv-order">{t("studio.sortOrder")}</label>
                  <input id="nv-order" type="number" className="input" value={form.sort_order} onChange={(e) => patch({ sort_order: Number(e.target.value) || 0 })} />
                </div>
                <div className="field">
                  <label htmlFor="nv-locale">{t("studio.localeScope")}</label>
                  <select
                    id="nv-locale"
                    className="input"
                    value={form.locale ?? ""}
                    onChange={(e) =>
                      patch({ locale: (e.target.value || null) as NavItem["locale"] })
                    }
                  >
                    <option value="">{t("studio.scope_all")}</option>
                    {(["fa", "ar", "en"] as const).map((l) => (
                      <option key={l} value={l}>{t(`studio.scope_${l}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ justifyContent: "flex-end" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", color: "var(--x-text2)", cursor: "pointer", marginTop: "1.6rem" }}>
                    <input type="checkbox" checked={form.visible} onChange={(e) => patch({ visible: e.target.checked })} />
                    {t("studio.visible")}
                  </label>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="field">
                  <label htmlFor="nv-start">{t("studio.startsAt")}</label>
                  <input id="nv-start" type="datetime-local" className="input" value={form.starts_at ? form.starts_at.slice(0, 16) : ""} onChange={(e) => patch({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </div>
                <div className="field">
                  <label htmlFor="nv-end">{t("studio.endsAt")}</label>
                  <input id="nv-end" type="datetime-local" className="input" value={form.ends_at ? form.ends_at.slice(0, 16) : ""} onChange={(e) => patch({ ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </div>
              </div>
              <div className="hint" style={{ marginTop: "-0.25rem" }}>{t("studio.tzHintNav")}</div>
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                <Button size="sm" disabled={saving} onClick={handleSave}>
                  {saving ? t("common.loading") : t("studio.save")}
                </Button>
                <Button size="sm" variant="secondary" onClick={close}>{t("studio.cancel")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
