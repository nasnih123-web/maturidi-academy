/**
 * Phase 14 — Multi-channel notification center (Track 2: CRM frontend).
 *
 * Compose a broadcast with per-channel toggles (email/SMS/push/in-app),
 * audience targeting, optional scheduling; preview delivery per a user's
 * notification preferences (Phase 1); delivery log with per-channel stats.
 * Presentational only — all logic in lib/admin14.ts + lib/admin14Hooks.ts.
 */

import React from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { NOTIFY_CHANNELS, errText, type BroadcastPayload, type NotifyChannel } from "../lib/admin14";
import { useBroadcast, useBroadcastPreview, useNotificationLog } from "../lib/admin14Hooks";

function ChannelToggles({
  channels,
  onChange,
}: {
  channels: NotifyChannel[];
  onChange: (c: NotifyChannel[]) => void;
}): React.ReactElement {
  const toggle = (ch: NotifyChannel): void => {
    onChange(channels.includes(ch) ? channels.filter((x) => x !== ch) : [...channels, ch]);
  };
  return (
    <div className="channel-grid">
      {NOTIFY_CHANNELS.map((ch) => (
        <label key={ch} className="switch-row">
          <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggle(ch)} />
          <code>{ch}</code>
        </label>
      ))}
    </div>
  );
}

export default function Notifications(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { hasPermission } = useAuth();
  const canBroadcast = hasPermission("notifications.broadcast");

  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [channels, setChannels] = React.useState<NotifyChannel[]>(["in_app", "push"]);
  const [audienceMode, setAudienceMode] = React.useState<"all" | "roles" | "users">("all");
  const [roles, setRoles] = React.useState("");
  const [userIds, setUserIds] = React.useState("");
  const [scheduleAt, setScheduleAt] = React.useState("");
  const [previewUser, setPreviewUser] = React.useState("");

  const broadcast = useBroadcast();
  const preview = useBroadcastPreview();
  const log = useNotificationLog();
  const [sent, setSent] = React.useState<{ broadcast_id: string; estimated_recipients: number } | null>(null);

  const payload = (): BroadcastPayload => ({
    title,
    body,
    channels,
    audience: {
      mode: audienceMode,
      roles: audienceMode === "roles" ? roles.split(",").map((r) => r.trim()).filter(Boolean) : undefined,
      user_ids: audienceMode === "users" ? userIds.split(",").map((r) => r.trim()).filter(Boolean) : undefined,
    },
    schedule_at: scheduleAt || null,
  });

  const doPreview = (): void => {
    if (!previewUser.trim()) return;
    preview.mutate({ title, body, channels, user_id: previewUser.trim() });
  };

  const doSend = (): void => {
    broadcast.mutate(payload(), { onSuccess: (r) => setSent(r) });
  };

  return (
    <div className="page" style={{ maxWidth: "1100px" }}>
      <h1>{t("admin14.notifTitle")}</h1>
      <p className="hint">{t("admin14.notifHint")}</p>

      <section className="panel" aria-label={t("admin14.cmpTitle")}>
        <div className="form-grid">
          <label>
            {t("admin14.cmpTitle")}
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            {t("admin14.cmpScheduleAt")}
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </label>
        </div>
        <label style={{ display: "block", marginTop: "0.75rem" }}>
          {t("admin14.cmpBody")}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} style={{ width: "100%" }} />
        </label>

        <h4 style={{ marginTop: "0.75rem" }}>{t("admin14.cmpChannels")}</h4>
        <ChannelToggles channels={channels} onChange={setChannels} />

        <h4 style={{ marginTop: "0.75rem" }}>{t("admin14.cmpAudience")}</h4>
        <div className="seg">
          {(["all", "roles", "users"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`tab${audienceMode === m ? " active" : ""}`}
              onClick={() => setAudienceMode(m)}
            >
              {t(`admin14.aud${m[0].toUpperCase()}${m.slice(1)}`)}
            </button>
          ))}
        </div>
        {audienceMode === "roles" && (
          <input
            value={roles}
            onChange={(e) => setRoles(e.target.value)}
            placeholder={t("admin14.audRoles")}
            aria-label={t("admin14.audRoles")}
            style={{ marginTop: "0.5rem", width: "100%" }}
          />
        )}
        {audienceMode === "users" && (
          <input
            value={userIds}
            onChange={(e) => setUserIds(e.target.value)}
            placeholder={t("admin14.audUsers")}
            aria-label={t("admin14.audUsers")}
            style={{ marginTop: "0.5rem", width: "100%" }}
          />
        )}

        <div className="row" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn primary"
            disabled={!canBroadcast || broadcast.isPending || !title.trim() || channels.length === 0}
            onClick={doSend}
          >
            {t("admin14.cmpSend")}
          </button>
        </div>
        {broadcast.isError && <p className="error-text">{errText(broadcast.error)}</p>}
        {sent && (
          <p className="ok-text">
            {t("admin14.cmpSent")} — {t("admin14.cmpEstimated")}: {sent.estimated_recipients} ·{" "}
            <code>{sent.broadcast_id}</code>
          </p>
        )}
      </section>

      <section className="panel" aria-label={t("admin14.cmpPreview")}>
        <h3>{t("admin14.cmpPreview")}</h3>
        <div className="row">
          <input
            value={previewUser}
            onChange={(e) => setPreviewUser(e.target.value)}
            placeholder={t("admin14.cmpPreviewFor")}
            aria-label={t("admin14.cmpPreviewFor")}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn" disabled={preview.isPending} onClick={doPreview}>
            {t("admin14.cmpPreview")}
          </button>
        </div>
        {preview.isError && <p className="error-text">{errText(preview.error)}</p>}
        {preview.data && (
          <ul className="compact-list" style={{ marginTop: "0.5rem" }}>
            {preview.data.map((p) => (
              <li key={p.channel}>
                <code>{p.channel}</code> —{" "}
                <span className={`badge tone-${p.will_receive ? "ok" : "muted"}`}>
                  {p.will_receive ? t("admin14.cmpWillReceive") : t("admin14.cmpWillNot")}
                </span>{" "}
                <span className="hint">{p.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-label={t("admin14.logTitle")}>
        <h3>{t("admin14.logTitle")}</h3>
        {log.isLoading && <p className="hint">{t("common.loading")}</p>}
        {log.isError && (
          <div>
            <p>{t("admin14.backendMissing")}</p>
            <p className="hint">{errText(log.error)}</p>
          </div>
        )}
        {log.isSuccess && (log.data?.items ?? []).length === 0 && <p className="hint">{t("admin14.logEmpty")}</p>}
        {(log.data?.items ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("admin14.cmpTitle")}</th>
                  <th>{t("admin14.cmpChannels")}</th>
                  <th>{t("admin14.logRecipients")}</th>
                  <th>{t("admin14.logDelivered")}</th>
                  <th>{t("admin14.logFailed")}</th>
                  <th>{t("admin14.logSkipped")}</th>
                  <th>{t("admin14.logStatus")}</th>
                  <th>{t("admin14.logActor")}</th>
                  <th>{t("admin14.auditAt")}</th>
                </tr>
              </thead>
              <tbody>
                {(log.data?.items ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td className="mono">{e.channels.join(", ")}</td>
                    <td className="mono">{e.recipients}</td>
                    <td className="mono">{e.delivered}</td>
                    <td className="mono">{e.failed}</td>
                    <td className="mono">{e.skipped}</td>
                    <td>
                      <span className="badge tone-info">
                        {t(`admin14.st${e.status[0].toUpperCase()}${e.status.slice(1)}`)}
                      </span>
                    </td>
                    <td className="hint">{e.actor}</td>
                    <td className="hint">{e.created_at ? formatDate(e.created_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
