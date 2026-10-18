import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  HomeSection,
  SectionOrderPatch,
} from "../lib/contentApi";
import { useHomeSections, useReorderHomeSections } from "../lib/contentHooks";
import { useI18n } from "../lib/i18n";

/**
 * Layout / placement management: reorder homepage rows (up/down — persists
 * the CMS order consumed by GET /api/v1/home/sections), toggle visibility,
 * featured/pinned flags — all without redeploy (§9.5 Placement).
 */
export default function LayoutManager(): React.ReactElement {
  const { t, locale } = useI18n();
  const query = useHomeSections();
  const reorder = useReorderHomeSections();
  const [rows, setRows] = React.useState<HomeSection[] | null>(null);
  const [flags, setFlags] = React.useState<Record<string, { featured: boolean; pinned: boolean }>>({});

  React.useEffect(() => {
    if (query.data) {
      setRows([...query.data.sections].sort((a, b) => a.order - b.order));
    }
  }, [query.data]);

  const move = (key: string, delta: -1 | 1): void => {
    setRows((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleVisible = (key: string): void => {
    setRows((prev) =>
      prev ? prev.map((r) => (r.key === key ? { ...r, visible: !r.visible } : r)) : prev,
    );
  };

  const toggleFlag = (key: string, flag: "featured" | "pinned"): void => {
    setFlags((prev) => {
      const cur = prev[key] ?? { featured: false, pinned: false };
      return { ...prev, [key]: { ...cur, [flag]: !cur[flag] } };
    });
  };

  const dirty = React.useMemo(() => {
    if (!rows || !query.data) return false;
    const orig = [...query.data.sections].sort((a, b) => a.order - b.order);
    if (rows.length !== orig.length) return true;
    return rows.some(
      (r, i) => r.key !== orig[i].key || r.visible !== orig[i].visible,
    ) || Object.keys(flags).length > 0;
  }, [rows, query.data, flags]);

  const handlePersist = (): void => {
    if (!rows) return;
    const patch: SectionOrderPatch[] = rows.map((r, i) => ({
      key: r.key,
      order: i,
      visible: r.visible,
      featured: flags[r.key]?.featured ?? false,
      pinned: flags[r.key]?.pinned ?? false,
    }));
    reorder.mutate(patch);
  };

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: "0.75rem" }}>
        <span className="hint" style={{ margin: 0 }}>{t("studio.layoutHint")}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" disabled={!dirty || reorder.isPending} onClick={handlePersist}>
          {reorder.isPending ? t("common.loading") : t("studio.persistOrder")}
        </Button>
      </div>

      {query.isLoading && <div className="empty">{t("common.loading")}</div>}
      {query.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => query.refetch()}>{t("common.retry")}</Button>
        </div>
      )}
      {reorder.isError && (
        <div className="empty"><p>{t("studio.persistFailed")}</p></div>
      )}
      {reorder.isSuccess && (
        <div className="empty"><p style={{ color: "var(--x-ok)" }}>{t("studio.persisted")}</p></div>
      )}

      {rows && (
        <Card>
          <CardHeader><CardTitle>{t("studio.homepageRows")}</CardTitle></CardHeader>
          <CardContent>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {rows.map((r, i) => {
                const f = flags[r.key] ?? { featured: false, pinned: false };
                return (
                  <div
                    key={r.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      padding: "0.55rem 0.75rem",
                      borderRadius: "0.55rem",
                      border: "1px solid var(--x-line)",
                      background: r.visible ? "transparent" : "rgba(255,255,255,0.02)",
                      opacity: r.visible ? 1 : 0.55,
                    }}
                  >
                    <span className="muted" style={{ minWidth: "2rem", fontSize: "0.8rem" }} dir="ltr">
                      #{i + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                        {r.title?.[locale] || r.title?.fa || r.key}
                      </div>
                      <code style={{ fontSize: "0.72rem", opacity: 0.6 }}>{r.key}</code>
                    </div>
                    {f.featured && <Badge tone="info">{t("studio.featured")}</Badge>}
                    {f.pinned && <Badge tone="info">{t("studio.pinned")}</Badge>}
                    <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem", color: "var(--x-text2)", cursor: "pointer" }}>
                      <input type="checkbox" checked={f.featured} onChange={() => toggleFlag(r.key, "featured")} />
                      {t("studio.featured")}
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem", color: "var(--x-text2)", cursor: "pointer" }}>
                      <input type="checkbox" checked={f.pinned} onChange={() => toggleFlag(r.key, "pinned")} />
                      {t("studio.pinned")}
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => toggleVisible(r.key)}>
                      {r.visible ? t("studio.visible") : t("studio.hidden")}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(r.key, -1)} aria-label={t("studio.moveUp")}>
                      ▲
                    </Button>
                    <Button size="sm" variant="secondary" disabled={i === rows.length - 1} onClick={() => move(r.key, 1)} aria-label={t("studio.moveDown")}>
                      ▼
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="hint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              {t("studio.layoutPersistHint")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
