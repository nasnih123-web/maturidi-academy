import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, statusTone } from "@maturidi/ui-web";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * Content Control Center skeleton (Phase 2 spec + §9.5 Content Control Contract).
 *
 * Orchestrates content through the owning module's API — it never copies
 * domain logic (fatwa/LMS/library/quran stay in their modules; §9 rule).
 * Each later module registers its own adapter; this UI stays generic.
 */

interface ContentItem {
  id: string;
  content_type: string;
  module: string;
  status: string; // §9 state machine: draft → in_review → approved → published …
  owner: string;
  created_at: string;
  updated_at: string;
}

interface ContentPage {
  items: ContentItem[];
  next_cursor: string | null;
}

interface Preview {
  title: string;
  body: string;
  locale: string;
  direction: "rtl" | "ltr";
}

interface DistributionChannel {
  channel: string; // web | mobile | desktop | telegram | ai_knowledge | search | embed …
  enabled: boolean;
  scheduled_at: string | null;
}

interface ContentPolicies {
  ai_policy: string[]; // e.g. ["fatwa", "assistant"] — default none unless explicit (§9.5)
  distribution: DistributionChannel[];
  schedule: { publish_at: string | null; unpublish_at: string | null } | null;
  placements: { surface: string; slot: string | null; active: boolean }[];
}

interface Filters {
  q: string;
  type: string;
  module: string;
  status: string;
  owner: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { q: "", type: "", module: "", status: "", owner: "", from: "", to: "" };

const WORKFLOW_STATUSES = ["draft", "in_review", "approved", "published", "rejected", "archived"];

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.type) params.set("type", f.type);
  if (f.module) params.set("module", f.module);
  if (f.status) params.set("status", f.status);
  if (f.owner) params.set("owner", f.owner);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  const s = params.toString();
  return s ? `/api/v1/content/items?${s}` : "/api/v1/content/items";
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}): React.ReactElement {
  return (
    <div className="field" style={{ marginBottom: 0, minWidth: "130px" }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function Content(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [draft, setDraft] = React.useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = React.useState<ContentItem | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["content-items", applied],
    queryFn: () => apiFetch<ContentPage>(buildQuery(applied)),
  });

  const previewQuery = useQuery({
    queryKey: ["content-preview", selected?.content_type, selected?.id],
    queryFn: () =>
      apiFetch<Preview>(
        `/api/v1/content/items/${selected!.content_type}/${selected!.id}/preview`,
      ),
    enabled: selected !== null,
  });

  const policiesQuery = useQuery({
    queryKey: ["content-policies", selected?.content_type, selected?.id],
    queryFn: () =>
      apiFetch<ContentPolicies>(
        `/api/v1/content/policies/${selected!.content_type}/${selected!.id}`,
      ),
    enabled: selected !== null,
  });

  const allOption = [{ value: "", label: t("content.all") }];

  return (
    <div className="page">
      <h1>{t("content.title")}</h1>

      <Card style={{ marginBottom: "1rem" }}>
        <CardContent>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="field" style={{ marginBottom: 0, minWidth: "180px", flex: 1 }}>
              <label htmlFor="q">{t("content.search")}</label>
              <input
                id="q"
                className="input"
                placeholder={t("content.searchPlaceholder")}
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </div>
            <FilterSelect
              id="f-type"
              label={t("content.type")}
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
              options={allOption}
            />
            <FilterSelect
              id="f-module"
              label={t("content.module")}
              value={draft.module}
              onChange={(v) => setDraft({ ...draft, module: v })}
              options={allOption}
            />
            <FilterSelect
              id="f-status"
              label={t("content.status")}
              value={draft.status}
              onChange={(v) => setDraft({ ...draft, status: v })}
              options={[
                ...allOption,
                ...WORKFLOW_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
              ]}
            />
            <div className="field" style={{ marginBottom: 0, minWidth: "130px" }}>
              <label htmlFor="f-owner">{t("content.owner")}</label>
              <input
                id="f-owner"
                className="input"
                value={draft.owner}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="f-from">{t("content.from")}</label>
              <input
                id="f-from"
                type="date"
                className="input"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="f-to">{t("content.to")}</label>
              <input
                id="f-to"
                type="date"
                className="input"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </div>
            <Button size="sm" onClick={() => setApplied(draft)}>
              {t("content.apply")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
              }}
            >
              {t("content.reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {itemsQuery.isLoading && <div className="empty">{t("common.loading")}</div>}
      {itemsQuery.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => itemsQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {itemsQuery.data && itemsQuery.data.items.length === 0 && (
        <div className="empty">
          <p>{t("content.empty")}</p>
          <p style={{ fontSize: "0.85rem" }}>{t("content.emptyHint")}</p>
        </div>
      )}
      {itemsQuery.data && itemsQuery.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("content.tableType")}</th>
                <th>{t("content.tableModule")}</th>
                <th>{t("content.tableStatus")}</th>
                <th>{t("content.tableOwner")}</th>
                <th>{t("content.tableDate")}</th>
              </tr>
            </thead>
            <tbody>
              {itemsQuery.data.items.map((item) => (
                <tr key={`${item.content_type}:${item.id}`} onClick={() => setSelected(item)}>
                  <td><code>{item.content_type}</code></td>
                  <td>{item.module}</td>
                  <td>
                    <Badge tone={statusTone(item.status)}>
                      {t(`status.${item.status}`) !== `status.${item.status}`
                        ? t(`status.${item.status}`)
                        : item.status}
                    </Badge>
                  </td>
                  <td>{item.owner}</td>
                  <td>{formatDate(item.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelected(null)} />
          <div className="drawer" role="dialog" aria-label={t("content.preview")}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{t("content.preview")}</h2>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                {t("content.close")}
              </Button>
            </div>

            {previewQuery.isLoading && <p>{t("common.loading")}</p>}
            {previewQuery.data ? (
              <Card style={{ marginBottom: "1rem" }}>
                <CardHeader>
                  <CardTitle>{previewQuery.data.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div dir={previewQuery.data.direction} style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>
                    {previewQuery.data.body}
                  </div>
                </CardContent>
              </Card>
            ) : (
              !previewQuery.isLoading && <p style={{ color: "#64748b" }}>{t("content.noPreview")}</p>
            )}

            <h3 style={{ fontSize: "0.95rem" }}>{t("content.policies")}</h3>
            {policiesQuery.isLoading && <p>{t("common.loading")}</p>}
            {policiesQuery.data ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: "0.25rem" }}>
                    {t("content.aiPolicy")}
                  </div>
                  {policiesQuery.data.ai_policy.length === 0 ? (
                    <Badge tone="neutral">none</Badge>
                  ) : (
                    policiesQuery.data.ai_policy.map((p) => (
                      <Badge key={p} tone="info" style={{ marginInlineEnd: "0.3rem" }}>
                        {p}
                      </Badge>
                    ))
                  )}
                </div>
                <div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: "0.25rem" }}>
                    {t("content.distribution")}
                  </div>
                  {policiesQuery.data.distribution.map((d) => (
                    <Badge
                      key={d.channel}
                      tone={d.enabled ? "success" : "neutral"}
                      style={{ marginInlineEnd: "0.3rem", marginBottom: "0.3rem" }}
                    >
                      {d.channel}
                      {d.scheduled_at ? ` · ${formatDate(d.scheduled_at)}` : ""}
                    </Badge>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: "0.25rem" }}>
                    {t("content.placements")}
                  </div>
                  {policiesQuery.data.placements.map((p, i) => (
                    <Badge
                      key={`${p.surface}-${i}`}
                      tone={p.active ? "info" : "neutral"}
                      style={{ marginInlineEnd: "0.3rem", marginBottom: "0.3rem" }}
                    >
                      {p.surface}
                      {p.slot ? `/${p.slot}` : ""}
                    </Badge>
                  ))}
                </div>
                {policiesQuery.data.schedule && (
                  <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                    {t("content.schedule")}:{" "}
                    {policiesQuery.data.schedule.publish_at
                      ? formatDate(policiesQuery.data.schedule.publish_at)
                      : "—"}
                    {" → "}
                    {policiesQuery.data.schedule.unpublish_at
                      ? formatDate(policiesQuery.data.schedule.unpublish_at)
                      : "—"}
                  </div>
                )}
              </div>
            ) : (
              !policiesQuery.isLoading && <p style={{ color: "#64748b" }}>{t("content.noPolicies")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
