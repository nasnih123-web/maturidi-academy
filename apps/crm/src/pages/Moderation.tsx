import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import { useEventFeed } from "../lib/events";
import {
  REPORT_KEY,
  ReportAction,
  REPORT_ACTIONS,
  REPORT_STATUSES,
  ReportStatus,
  SocialReport,
  errText,
  formatSlaCountdown,
  reportAuditTrail,
  slaRemainingMs,
  useActOnReport,
  useAddBannedWord,
  useBannedWords,
  useDeleteBannedWord,
  useReports,
} from "../lib/moderation";
import {
  FLAG_ACTIONS,
  type ContentFlag,
  type FlagAction,
} from "../lib/admin14";
import { useContentFlags, useFlagAction } from "../lib/admin14Hooks";

/**
 * Social moderation center — Phase 10 (CRM track).
 *
 * Tabs: moderation queue (community reports with SLA tracking + triage
 * actions) · banned-words manager (pre-publish filter list).
 *
 * Contract: GET/POST /api/v1/admin/social/reports,
 * POST /api/v1/admin/social/reports/{id}/action {triage|dismiss|remove_content|warn_user, note},
 * GET/POST/DELETE /api/v1/moderation/banned-words.
 * New reports arrive over the Phase-2 /ws/events feed (social.report_created)
 * and refresh the queue without a reload.
 */

type ModTab = "queue" | "banned" | "flags";
const TABS: ModTab[] = ["queue", "banned", "flags"];

function initialTab(): ModTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as string[]).includes(t)) return t as ModTab;
  } catch {
    // ignore
  }
  return "queue";
}

function initialReportId(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get("report");
    return id || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* live strip                                                          */
/* ------------------------------------------------------------------ */

function LiveModerationStrip(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events } = useEventFeed(60);
  const qc = useQueryClient();
  const reportEvents = events.filter(
    (e) => e.event_type === "social.report_created" || e.event_type.startsWith("social."),
  );
  const latest = reportEvents[0];

  // Any social domain event refreshes the queue — no reload needed.
  React.useEffect(() => {
    if (latest) qc.invalidateQueries({ queryKey: REPORT_KEY });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.event_id]);

  return (
    <div
      className="panel"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.55rem 1rem",
        marginBottom: "1rem",
        flexWrap: "wrap",
      }}
      aria-live="polite"
    >
      <Badge tone={status === "connected" ? "success" : "neutral"}>{t(`studio.feed_${status}`)}</Badge>
      <span className="hint" style={{ margin: 0 }}>
        {t("social10.liveSub")}
      </span>
      {latest ? (
        <span style={{ fontSize: "0.82rem", color: "var(--x-text2)" }} dir="ltr">
          <code style={{ fontSize: "0.78rem" }}>{latest.event_type}</code>
          {" · "}
          {formatDate(latest.created_at)}
          {reportEvents.length > 1 ? ` · +${reportEvents.length - 1}` : ""}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {t("social10.noLiveYet")}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* queue                                                               */
/* ------------------------------------------------------------------ */

function reportTone(s: ReportStatus): "danger" | "warning" | "neutral" | "success" {
  switch (s) {
    case "open":
      return "danger";
    case "triaged":
      return "warning";
    case "actioned":
      return "success";
    default:
      return "neutral"; // dismissed
  }
}

function SlaCell({ report }: { report: SocialReport }): React.ReactElement {
  const { t } = useI18n();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const remaining = slaRemainingMs(report, now);
  const overdue = report.overdue || (remaining !== null && remaining < 0);
  if (remaining === null) return <span className="muted">—</span>;
  return (
    <span
      style={
        overdue
          ? {
              color: "#fff",
              background: "var(--x-danger, #b91c1c)",
              borderRadius: "0.35rem",
              padding: "0.15rem 0.5rem",
              fontWeight: 700,
              fontSize: "0.78rem",
              whiteSpace: "nowrap",
            }
          : { fontSize: "0.82rem", whiteSpace: "nowrap" }
      }
      title={report.sla_due_at ?? undefined}
    >
      {formatSlaCountdown(t, remaining)}
    </span>
  );
}

function ReportRow({
  report,
  onAct,
}: {
  report: SocialReport;
  onAct: () => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>
        {report.reported_at ? formatDate(report.reported_at) : "—"}
      </td>
      <td>
        <code dir="ltr" style={{ fontSize: "0.75rem" }}>
          {report.target_type}
        </code>
        <br />
        <code dir="ltr" style={{ fontSize: "0.72rem", color: "var(--x-text2)" }}>
          {report.target_id ? report.target_id.slice(0, 12) + (report.target_id.length > 12 ? "…" : "") : "—"}
        </code>
      </td>
      <td dir="auto" style={{ maxWidth: "260px" }}>
        {report.reason || "—"}
      </td>
      <td dir="auto" style={{ maxWidth: "140px" }}>
        {report.reporter || <span className="muted">{t("social10.anonReporter")}</span>}
      </td>
      <td>
        <Badge tone={reportTone(report.status)}>{t(`social10.rep_${report.status}`)}</Badge>
      </td>
      <td>
        <SlaCell report={report} />
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Button size="sm" variant="secondary" onClick={onAct}>
          {t("social10.takeAction")}
        </Button>
      </td>
    </tr>
  );
}

function ActionDialog({
  report,
  onClose,
}: {
  report: SocialReport;
  onClose: () => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [action, setAction] = React.useState<ReportAction>("triage");
  const [note, setNote] = React.useState("");
  const act = useActOnReport();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps = reportAuditTrail(report);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer slide-in" role="dialog" aria-modal="true" aria-label={t("social10.actionDialog")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--x-gold2)" }}>
            {t("social10.actionDialog")}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
            {t("common.close")}
          </Button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
          <Badge tone={reportTone(report.status)}>{t(`social10.rep_${report.status}`)}</Badge>
          <code dir="ltr" style={{ fontSize: "0.75rem" }}>
            {report.target_type} · {report.target_id ? report.target_id.slice(0, 12) : "—"}
          </code>
        </div>

        <p dir="auto" style={{ fontSize: "0.92rem", color: "var(--x-text2)" }}>
          {t("social10.tableReason")}: {report.reason || "—"}
        </p>

        {/* §14 audit-style trail, derived from the contract's timestamps */}
        <h3 style={{ fontSize: "0.95rem", color: "var(--x-gold2)" }}>{t("social10.auditTitle")}</h3>
        {steps.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("social10.noAudit")}
          </p>
        ) : (
          <ol style={{ paddingInlineStart: "1.25rem", margin: "0 0 1rem", fontSize: "0.88rem" }}>
            {steps.map((s) => (
              <li key={s.key} style={{ marginBottom: "0.3rem" }}>
                <strong>{t(`social10.audit_${s.key}`)}</strong>{" "}
                <span className="muted">{formatDate(s.at)}</span>
              </li>
            ))}
          </ol>
        )}
        {report.note && (
          <p dir="auto" className="hint">
            {t("social10.lastNote")}: {report.note}
          </p>
        )}

        <h3 style={{ fontSize: "0.95rem", color: "var(--x-gold2)" }}>{t("social10.chooseAction")}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
          {REPORT_ACTIONS.map((a) => (
            <label className="check-row" key={a}>
              <input
                type="radio"
                name="report-action"
                checked={action === a}
                onChange={() => setAction(a)}
              />
              {t(`social10.act_${a}`)}
            </label>
          ))}
        </div>

        <div className="field">
          <label htmlFor="action-note">{t("social10.actionNote")}</label>
          <textarea
            id="action-note"
            className="input"
            rows={3}
            dir="auto"
            placeholder={t("social10.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn-gold"
            disabled={act.isPending}
            onClick={() =>
              act.mutate(
                { id: report.id, body: { action, note: note.trim() } },
                { onSuccess: onClose },
              )
            }
          >
            {act.isPending ? t("common.loading") : t("social10.confirmAction")}
          </button>
          {act.isError && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(act.error)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function QueueTab(): React.ReactElement {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = React.useState<string>(() => {
    try {
      const s = new URLSearchParams(window.location.search).get("status");
      return s && (REPORT_STATUSES as readonly string[]).includes(s) ? s : "open";
    } catch {
      return "open";
    }
  });
  const [acting, setActing] = React.useState<SocialReport | null>(null);
  const reports = useReports(statusFilter || undefined);

  // Deep-link for the screenshot harness: ?report=<id>
  React.useEffect(() => {
    if (acting) return;
    const id = initialReportId();
    if (id && reports.data) {
      const found = reports.data.items.find((r) => r.id === id);
      if (found) setActing(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports.data]);

  return (
    <div>
      <div className="panel" style={{ marginBottom: "0.75rem" }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: "180px" }}>
            <label htmlFor="report-status">{t("social10.filterStatus")}</label>
            <select
              id="report-status"
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t("social10.allStatuses")}</option>
              {REPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`social10.rep_${s}`)}
                </option>
              ))}
            </select>
          </div>
          <span style={{ flex: 1 }} />
          <span className="hint" style={{ margin: 0 }}>
            {t("social10.queueHint")}
          </span>
        </div>
      </div>

      {reports.isLoading && <div className="empty">{t("common.loading")}</div>}
      {reports.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => reports.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {reports.data && reports.data.items.length === 0 && (
        <div className="empty">
          <p>{t("social10.emptyQueue")}</p>
        </div>
      )}
      {reports.data && reports.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("social10.tableReportedAt")}</th>
                <th>{t("social10.tableTarget")}</th>
                <th>{t("social10.tableReason")}</th>
                <th>{t("social10.tableReporter")}</th>
                <th>{t("social10.tableStatus")}</th>
                <th>{t("social10.tableSla")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.data.items.map((r) => (
                <ReportRow key={r.id} report={r} onAct={() => setActing(r)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {acting && <ActionDialog report={acting} onClose={() => setActing(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* banned words                                                        */
/* ------------------------------------------------------------------ */

function BannedTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const words = useBannedWords();
  const [input, setInput] = React.useState("");
  const add = useAddBannedWord();
  const del = useDeleteBannedWord();

  const submit = (): void => {
    const w = input.trim();
    if (!w || add.isPending) return;
    add.mutate(w, { onSuccess: () => setInput("") });
  };

  return (
    <div>
      <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("social10.bannedTitle")}>
        <div className="panel-head">
          <h2>{t("social10.bannedTitle")}</h2>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("social10.bannedHint")}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0, minWidth: "220px", flex: 1 }}>
            <label htmlFor="banned-new">{t("social10.newWord")}</label>
            <input
              id="banned-new"
              className="input"
              dir="auto"
              placeholder={t("social10.wordPlaceholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <button type="button" className="btn-gold" disabled={add.isPending || !input.trim()} onClick={submit}>
            {add.isPending ? t("common.loading") : t("social10.addWord")}
          </button>
          {add.isError && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(add.error)}
            </span>
          )}
        </div>
      </section>

      {words.isLoading && <div className="empty">{t("common.loading")}</div>}
      {words.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => words.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {words.data && words.data.length === 0 && (
        <div className="empty">
          <p>{t("social10.emptyBanned")}</p>
        </div>
      )}
      {words.data && words.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("social10.tableWord")}</th>
                <th>{t("social10.tableScope")}</th>
                <th>{t("social10.tableAdded")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {words.data.map((w) => (
                <tr key={w.id}>
                  <td dir="auto" style={{ fontWeight: 700 }}>
                    {w.word}
                  </td>
                  <td>
                    <Badge tone="neutral">{w.scope}</Badge>
                  </td>
                  <td>{w.created_at ? formatDate(w.created_at) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={del.isPending}
                      onClick={() => {
                        if (window.confirm(t("social10.confirmDelete"))) del.mutate(w.id);
                      }}
                    >
                      {t("social10.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {del.isError && (
        <span className="form-error" style={{ marginTop: "0.5rem" }}>
          {errText(del.error)}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page shell                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* content flags — Phase 14 unified inbox (social reports stay above)  */
/* ------------------------------------------------------------------ */

function FlagRow({ flag }: { flag: ContentFlag }): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [action, setAction] = React.useState<FlagAction>("dismiss");
  const [note, setNote] = React.useState("");
  const act = useFlagAction();

  return (
    <tr>
      <td>
        {flag.content_title}
        <div className="hint mono">
          {flag.domain}/{flag.content_type}/{flag.id.slice(0, 8)}…
        </div>
      </td>
      <td className="hint">{flag.reason || "—"}</td>
      <td className="hint">{flag.reporter || t("social10.anonReporter")}</td>
      <td>
        <Badge tone={flag.status === "open" ? "danger" : flag.status === "triaged" ? "warning" : "neutral"}>
          {t(`social10.rep_${flag.status}`) === `social10.rep_${flag.status}` ? flag.status : t(`social10.rep_${flag.status}`)}
        </Badge>
      </td>
      <td className="hint">{flag.reported_at ? formatDate(flag.reported_at) : "—"}</td>
      <td>
        {!open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("admin14.flagAction")}
          </Button>
        ) : (
          <div className="row">
            <select value={action} onChange={(e) => setAction(e.target.value as FlagAction)} aria-label={t("admin14.flagAction")}>
              {FLAG_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`admin14.act${a[0].toUpperCase()}${a.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`)}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("admin14.flagNotePh")}
              aria-label={t("admin14.flagNote")}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(
                  { id: flag.id, action, note: note || undefined },
                  { onSuccess: () => { setOpen(false); setNote(""); } },
                )
              }
            >
              {t("admin14.flagConfirm")}
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        )}
        {act.isError && <p className="error-text">{errText(act.error)}</p>}
      </td>
    </tr>
  );
}

function FlagsTab(): React.ReactElement {
  const { t } = useI18n();
  const [status, setStatus] = React.useState("");
  const flags = useContentFlags(status || undefined);

  return (
    <div>
      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>
        {t("admin14.flagHint")}
      </p>
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        <label>
          {t("admin14.fStatus")}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("admin14.all")}</option>
            {["open", "triaged", "dismissed", "actioned"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => void flags.refetch()}>
          {t("common.refresh")}
        </button>
      </div>
      {flags.isLoading && <p className="hint">{t("common.loading")}</p>}
      {flags.isError && (
        <div className="panel" role="alert">
          <p>{t("admin14.backendMissing")}</p>
          <p className="hint">{errText(flags.error)}</p>
        </div>
      )}
      {flags.isSuccess && (flags.data ?? []).length === 0 && <p className="hint">{t("social10.emptyQueue")}</p>}
      {(flags.data ?? []).length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("admin14.flagContent")}</th>
                <th>{t("admin14.flagReason")}</th>
                <th>{t("admin14.flagReporter")}</th>
                <th>{t("admin14.colStatus")}</th>
                <th>{t("social10.tableReportedAt")}</th>
                <th>{t("admin14.flagAction")}</th>
              </tr>
            </thead>
            <tbody>
              {(flags.data ?? []).map((f) => (
                <FlagRow key={f.id} flag={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Moderation(): React.ReactElement {
  const { t, setLocale } = useI18n();
  const [tab, setTab] = React.useState<ModTab>(initialTab);

  // Deep-link support: ?tab=…&locale=fa|ar|en
  React.useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("locale");
      if (l === "fa" || l === "ar" || l === "en") setLocale(l);
    } catch {
      // ignore
    }
  }, [setLocale]);

  return (
    <div className="page" style={{ maxWidth: "1280px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>{t("social10.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("social10.liveHint")}
      </p>

      <LiveModerationStrip />

      <div className="locale-tabs" role="tablist" aria-label={t("social10.title")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`locale-tab${tab === tb ? " on" : ""}`}
            onClick={() => setTab(tb)}
          >
            {tb === "flags" ? t("admin14.tabFlags") : t(`social10.tab_${tb}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "queue" ? <QueueTab /> : tab === "flags" ? <FlagsTab /> : <BannedTab />}
      </div>
    </div>
  );
}
