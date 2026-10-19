import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  errText,
  pickTitle,
  useConflicts,
  useDevices,
  useOfflinePack,
  useResolveConflict,
  type ConflictResolution,
  type SyncConflict,
} from "../lib/sync";
import { useI18n, formatDate } from "../lib/i18n";

/**
 * Phase 13 — Sync Status Dashboard.
 *
 * Three tabs:
 * - Devices: per-device cursor table (user, device_id, last cursor, last seen).
 * - Conflicts: pending conflict queue with side-by-side local/remote view and
 *   manual merge/pick (POST /api/v1/sync/conflicts/{id}/resolve). Both
 *   versions are always shown — nothing is silently dropped (spec §13).
 * - Offline pack: the live prioritized download list (started > followed >
 *   popular) with per-reason visibility toggles (view filter, local only).
 */

type Tab = "devices" | "conflicts" | "pack";

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "null";
  } catch {
    return String(v);
  }
}

function resLabel(t: (p: string) => string, resolution: string): string {
  const k = t(`sync13.res_${resolution}`);
  return k === `sync13.res_${resolution}` ? resolution : k;
}

function JsonPane({ title, value, tone }: { title: string; value: unknown; tone: "local" | "remote" }) {
  return (
    <div className="sync-pane" data-tone={tone}>
      <h4>{title}</h4>
      <pre dir="ltr">{pretty(value)}</pre>
    </div>
  );
}

function ResolveDialog({
  conflict,
  onClose,
}: {
  conflict: SyncConflict;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const resolveMut = useResolveConflict();
  const [choice, setChoice] = React.useState<ConflictResolution>("keep_local");
  const [mergedText, setMergedText] = React.useState(() => pretty(conflict.local_payload));
  const [note, setNote] = React.useState("");
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const submit = () => {
    setJsonError(null);
    let merged: Record<string, unknown> | undefined;
    if (choice === "merged") {
      try {
        const parsed: unknown = JSON.parse(mergedText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setJsonError(t("sync13.mergedMustBeObject"));
          return;
        }
        merged = parsed as Record<string, unknown>;
      } catch {
        setJsonError(t("sync13.mergedInvalidJson"));
        return;
      }
    }
    resolveMut.mutate(
      { id: conflict.id, resolution: choice, merged_payload: merged, note: note || undefined },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("sync13.resolveTitle")}>
      <div className="modal-card sync-resolve-card">
        <h3>{t("sync13.resolveTitle")}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("sync13.resolveFor")} <Badge tone="neutral">{conflict.entity_type}</Badge>{" "}
          <code dir="ltr" style={{ fontSize: "0.85rem" }}>{conflict.entity_id}</code>
        </p>

        <div className="sync-sbs">
          <JsonPane
            title={`${t("sync13.localPane")} (v${conflict.local_version ?? "—"})`}
            value={conflict.local_payload}
            tone="local"
          />
          <JsonPane
            title={`${t("sync13.remotePane")} (v${conflict.remote_version ?? "—"})`}
            value={conflict.remote_payload}
            tone="remote"
          />
        </div>

        <div className="field" style={{ marginTop: "1rem" }}>
          <label>{t("sync13.resolutionLabel")}</label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {(["keep_local", "keep_remote", "merged"] as ConflictResolution[]).map((r) => (
              <label key={r} className="sync-choice">
                <input
                  type="radio"
                  name="sync-resolution"
                  checked={choice === r}
                  onChange={() => setChoice(r)}
                />
                {t(`sync13.res_${r}`)}
              </label>
            ))}
          </div>
        </div>

        {choice === "merged" && (
          <div className="field">
            <label htmlFor="sync-merged">{t("sync13.mergedLabel")}</label>
            <textarea
              id="sync-merged"
              dir="ltr"
              rows={10}
              className="sync-merged-editor"
              value={mergedText}
              onChange={(e) => setMergedText(e.target.value)}
            />
            {jsonError ? <p className="form-error">{jsonError}</p> : null}
          </div>
        )}

        <div className="field">
          <label htmlFor="sync-note">{t("sync13.noteLabel")}</label>
          <input
            id="sync-note"
            type="text"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("sync13.notePlaceholder")}
          />
        </div>

        {resolveMut.isError ? <p className="form-error">{errText(resolveMut.error)}</p> : null}

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
          <Button onClick={onClose} disabled={resolveMut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={resolveMut.isPending}>
            {resolveMut.isPending ? t("common.saving") : t("sync13.resolveApply")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DevicesTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const q = useDevices();
  if (q.isLoading) return <p className="hint">{t("common.loading")}</p>;
  if (q.isError)
    return (
      <Card>
        <CardContent>
          <p className="form-error">{errText(q.error)}</p>
          <p className="hint" style={{ margin: "0.5rem 0 0" }}>
            {t("sync13.devicesPendingBackend")}
          </p>
        </CardContent>
      </Card>
    );
  const devices = q.data?.devices ?? [];
  if (devices.length === 0) return <p className="hint">{t("sync13.devicesEmpty")}</p>;
  return (
    <Card>
      <CardContent>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("sync13.colUser")}</th>
                <th>{t("sync13.colDevice")}</th>
                <th>{t("sync13.colCursor")}</th>
                <th>{t("sync13.colLastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={`${d.user_id}:${d.device_id}`}>
                  <td dir="ltr" style={{ fontSize: "0.8rem" }}>
                    <code>{d.user_id.slice(0, 8)}…</code>
                  </td>
                  <td dir="ltr">
                    <code>{d.device_id}</code>
                  </td>
                  <td dir="ltr">{d.cursor_seq}</td>
                  <td>{formatDate(locale, d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ConflictsTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const [showResolved, setShowResolved] = React.useState(false);
  const [selected, setSelected] = React.useState<SyncConflict | null>(null);
  const q = useConflicts(!showResolved);

  return (
    <>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label className="sync-choice">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          {t("sync13.showResolved")}
        </label>
        <Button onClick={() => q.refetch()} disabled={q.isFetching}>
          {t("common.refresh")}
        </Button>
      </div>

      {q.isLoading ? (
        <p className="hint">{t("common.loading")}</p>
      ) : q.isError ? (
        <p className="form-error">{errText(q.error)}</p>
      ) : (q.data?.items ?? []).length === 0 ? (
        <p className="hint">{t("sync13.conflictsEmpty")}</p>
      ) : (
        <Card>
          <CardContent>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("sync13.colEntity")}</th>
                    <th>{t("sync13.colEntityId")}</th>
                    <th>{t("sync13.colVersions")}</th>
                    <th>{t("sync13.colCreated")}</th>
                    <th>{t("sync13.colResolution")}</th>
                    <th>{t("sync13.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(q.data?.items ?? []).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Badge tone="neutral">{c.entity_type}</Badge>
                      </td>
                      <td dir="ltr" style={{ fontSize: "0.85rem" }}>
                        <code>{c.entity_id}</code>
                      </td>
                      <td dir="ltr" style={{ fontSize: "0.85rem" }}>
                        L{c.local_version ?? "—"} / R{c.remote_version ?? "—"}
                      </td>
                      <td>{formatDate(locale, c.created_at)}</td>
                      <td>
                        <Badge tone={c.resolution === "pending" ? "warning" : "success"}>
                          {c.resolution === "pending" ? t("sync13.resPending") : resLabel(t, c.resolution)}
                        </Badge>
                      </td>
                      <td>
                        {c.resolution === "pending" ? (
                          <Button onClick={() => setSelected(c)}>{t("sync13.review")}</Button>
                        ) : (
                          <span className="hint">{c.resolution_note ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {selected ? <ResolveDialog conflict={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function PackTab(): React.ReactElement {
  const { t, locale } = useI18n();
  const q = useOfflinePack();
  const [hidden, setHidden] = React.useState<Record<string, boolean>>({});

  const grouped = React.useMemo(() => {
    const g: Record<string, (typeof items)[number][]> = { started: [], followed: [], popular: [] };
    const items = q.data?.items ?? [];
    for (const it of items) {
      if (g[it.reason]) g[it.reason].push(it);
    }
    for (const r of Object.keys(g)) g[r].sort((a, b) => b.score - a.score);
    return g;
  }, [q.data]);

  if (q.isLoading) return <p className="hint">{t("common.loading")}</p>;
  if (q.isError) return <p className="form-error">{errText(q.error)}</p>;
  const total = (q.data?.items ?? []).length;
  if (total === 0) return <p className="hint">{t("sync13.packEmpty")}</p>;

  return (
    <>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <span className="hint" style={{ margin: 0 }}>
          {t("sync13.packHint")}
        </span>
        {(["started", "followed", "popular"] as const).map((r) => (
          <label key={r} className="sync-choice">
            <input
              type="checkbox"
              checked={!hidden[r]}
              onChange={() => setHidden((h) => ({ ...h, [r]: !h[r] }))}
            />
            {t(`sync13.reason_${r}`)}
          </label>
        ))}
        <Button onClick={() => q.refetch()} disabled={q.isFetching}>
          {t("common.refresh")}
        </Button>
      </div>
      {(["started", "followed", "popular"] as const).map((r) =>
        hidden[r] ? null : (
          <Card key={r} style={{ marginBottom: "1rem" }}>
            <CardHeader>
              <CardTitle>
                {t(`sync13.reason_${r}`)} <Badge tone="neutral">{grouped[r].length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="sync-pack-list">
                {grouped[r].slice(0, 20).map((it) => (
                  <li key={`${it.kind}:${it.ref_id}`}>
                    <Badge tone="neutral">{it.kind}</Badge>{" "}
                    <span dir="auto">{pickTitle(it.title, locale, it.ref_id)}</span>{" "}
                    <span className="hint" dir="ltr">
                      score {it.score}
                    </span>
                  </li>
                ))}
              </ul>
              {grouped[r].length > 20 ? (
                <p className="hint">… +{grouped[r].length - 20}</p>
              ) : null}
            </CardContent>
          </Card>
        ),
      )}
    </>
  );
}

export default function Sync(): React.ReactElement {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<Tab>("conflicts");
  const pending = useConflicts(true);

  const tabs: [Tab, string][] = [
    ["devices", t("sync13.tabDevices")],
    ["conflicts", t("sync13.tabConflicts")],
    ["pack", t("sync13.tabPack")],
  ];

  return (
    <div className="page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <h1 style={{ color: "var(--x-gold2)", fontSize: "1.4rem", margin: 0 }}>
          {t("sync13.title")}
          {(pending.data?.total ?? 0) > 0 && (
            <Badge tone="warning" style={{ marginInlineStart: "0.6rem" }}>
              {t("sync13.pendingCount")}: <span dir="ltr">{pending.data?.total ?? 0}</span>
            </Badge>
          )}
        </h1>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("sync13.subtitle")}
      </p>

      <div className="tabs" role="tablist" style={{ marginBottom: "1rem" }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "tab active" : "tab"}
            onClick={() => setTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "devices" ? <DevicesTab /> : tab === "conflicts" ? <ConflictsTab /> : <PackTab />}
    </div>
  );
}
