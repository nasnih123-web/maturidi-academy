import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  TELEGRAM_POLICIES,
  errText,
  useRetryTelegramPublish,
  useSaveTelegramDistribution,
  useTelegramDistribution,
  useTelegramPublishHistory,
  type TelegramDistributionConfig,
  type TelegramPolicy,
} from "../lib/telegram";
import { useI18n, formatDate } from "../lib/i18n";
import { useAuth } from "../lib/auth";

/**
 * Telegram Distribution panel — reusable per-content control (§9.5).
 *
 * ADR-001: presentation only. Policy/template/channel values live in
 * lib/telegram.ts; this component only renders and forwards edits.
 *
 * Contract §9.5 Telegram policy: never / manual / auto / scheduled,
 * duplicate-publish prevention, configurable template/caption, explicit
 * target channel, full audit, cancel/delete of a published message when the
 * provider allows it.
 */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <p className="hint" style={{ margin: "0.25rem 0 0" }}>{hint}</p> : null}
    </div>
  );
}

const EMPTY_CFG = (contentType: string, contentId: string): TelegramDistributionConfig => ({
  content_type: contentType,
  content_id: contentId,
  policy: "never",
  message_template: "",
  caption_template: "",
  channels: [],
  schedule_at: null,
  spacing_seconds: 60,
  require_approval: false,
  updated_at: null,
});

export default function TelegramDistributionPanel({
  contentType,
  contentId,
  compact = false,
}: {
  contentType: string;
  contentId: string;
  compact?: boolean;
}): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("telegram.distribute");

  const distQuery = useTelegramDistribution(contentType, contentId);
  const histQuery = useTelegramPublishHistory(contentType, contentId);
  const saveMut = useSaveTelegramDistribution();
  const retryMut = useRetryTelegramPublish();

  const loaded = distQuery.data ?? EMPTY_CFG(contentType, contentId);
  const [cfg, setCfg] = React.useState<TelegramDistributionConfig>(loaded);
  const [loadedKey, setLoadedKey] = React.useState(distQuery.dataUpdatedAt);
  const [channelInput, setChannelInput] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [error, setError] = React.useState("");

  if (distQuery.dataUpdatedAt !== loadedKey) {
    setLoadedKey(distQuery.dataUpdatedAt);
    setCfg(distQuery.data ?? EMPTY_CFG(contentType, contentId));
    setMsg("");
    setError("");
  }

  const set = <K extends keyof TelegramDistributionConfig>(
    k: K,
    v: TelegramDistributionConfig[K],
  ): void => setCfg((prev) => ({ ...prev, [k]: v }));

  const addChannel = (): void => {
    const ch = channelInput.trim().replace(/^@/, "");
    if (ch && !cfg.channels.includes(ch)) set("channels", [...cfg.channels, ch]);
    setChannelInput("");
  };

  const save = async (): Promise<void> => {
    setError("");
    setMsg("");
    try {
      await saveMut.mutateAsync(cfg);
      setMsg(t("telegram11.saved"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const policyLabel = (p: TelegramPolicy): string =>
    t(`telegram11.policy_${p}`) === `telegram11.policy_${p}`
      ? t(`media.tg_${p}`)
      : t(`telegram11.policy_${p}`);

  const logTone = (s: string): "success" | "danger" | "warning" | "neutral" =>
    s === "sent" ? "success" : s === "failed" ? "danger" : s === "pending" ? "warning" : "neutral";

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: compact ? undefined : "880px" }}>
      <Card>
        <CardHeader>
          <CardTitle>{t("telegram11.distTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {distQuery.isLoading ? (
            <p className="hint">{t("common.loading")}</p>
          ) : (
            <div style={{ display: "grid", gap: "0.9rem" }}>
              <Field label={t("telegram11.policy")}>
                <select
                  className="input"
                  value={cfg.policy}
                  onChange={(e) => set("policy", e.target.value as TelegramPolicy)}
                  disabled={!canManage}
                  style={{ maxWidth: "22rem" }}
                >
                  {TELEGRAM_POLICIES.map((p) => (
                    <option key={p} value={p}>{policyLabel(p)}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("telegram11.template")} hint={t("telegram11.templateHint")}>
                <textarea
                  className="input"
                  rows={3}
                  value={cfg.message_template}
                  onChange={(e) => set("message_template", e.target.value)}
                  disabled={!canManage}
                  dir="auto"
                />
              </Field>

              <Field label={t("telegram11.caption")}>
                <input
                  className="input"
                  value={cfg.caption_template}
                  onChange={(e) => set("caption_template", e.target.value)}
                  disabled={!canManage}
                  dir="auto"
                />
              </Field>

              <Field label={t("telegram11.channels")} hint={t("telegram11.channelsHint")}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  {cfg.channels.map((ch) => (
                    <span
                      key={ch}
                      className="input"
                      style={{
                        width: "auto",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.3rem 0.7rem",
                        borderRadius: "999px",
                      }}
                    >
                      @{ch}
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => set("channels", cfg.channels.filter((c) => c !== ch))}
                          aria-label={t("common.remove")}
                          style={{ background: "none", border: 0, color: "inherit", cursor: "pointer" }}
                        >
                          ✕
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
                {canManage ? (
                  <div style={{ display: "flex", gap: "0.5rem", maxWidth: "22rem" }}>
                    <input
                      className="input"
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      placeholder={t("telegram11.channelPlaceholder")}
                      dir="ltr"
                      onKeyDown={(e) => { if (e.key === "Enter") addChannel(); }}
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={addChannel}>
                      {t("common.add")}
                    </Button>
                  </div>
                ) : null}
              </Field>

              {cfg.policy === "scheduled" ? (
                <Field label={t("telegram11.scheduleAt")} hint={t("telegram11.scheduleHint")}>
                  <input
                    className="input"
                    type="datetime-local"
                    value={cfg.schedule_at ? cfg.schedule_at.slice(0, 16) : ""}
                    onChange={(e) =>
                      set("schedule_at", e.target.value ? new Date(e.target.value).toISOString() : null)
                    }
                    disabled={!canManage}
                    style={{ maxWidth: "22rem" }}
                  />
                </Field>
              ) : null}

              <Field label={t("telegram11.spacing")} hint={t("telegram11.spacingHint")}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={cfg.spacing_seconds}
                  onChange={(e) => set("spacing_seconds", Math.max(0, Number(e.target.value) || 0))}
                  disabled={!canManage}
                  style={{ maxWidth: "12rem" }}
                  dir="ltr"
                />
              </Field>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: canManage ? "pointer" : "default" }}>
                <input
                  type="checkbox"
                  checked={cfg.require_approval}
                  onChange={(e) => set("require_approval", e.target.checked)}
                  disabled={!canManage}
                />
                {t("telegram11.requireApproval")}
              </label>

              {msg ? <p className="hint">{msg}</p> : null}
              {error ? <p className="form-error">{error}</p> : null}
              {canManage ? (
                <div>
                  <Button onClick={() => void save()} disabled={saveMut.isPending}>
                    {t("telegram11.save")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("telegram11.historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {histQuery.isLoading ? (
            <p className="hint">{t("common.loading")}</p>
          ) : (histQuery.data ?? []).length === 0 ? (
            <p className="hint">{t("telegram11.historyEmpty")}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("telegram11.hTarget")}</th>
                  <th>{t("telegram11.hMessageId")}</th>
                  <th>{t("telegram11.hTime")}</th>
                  <th>{t("telegram11.hStatus")}</th>
                  <th>{t("telegram11.hAction")}</th>
                </tr>
              </thead>
              <tbody>
                {(histQuery.data ?? []).map((log) => (
                  <tr key={log.id}>
                    <td dir="ltr">@{log.target_channel}</td>
                    <td dir="ltr">{log.message_id ?? "—"}</td>
                    <td>{log.sent_at ? formatDate(locale, log.sent_at) : "—"}</td>
                    <td>
                      <Badge tone={logTone(log.status)}>
                        {t(`telegram11.log_${log.status}`)}
                      </Badge>
                      {log.error ? (
                        <div className="hint" style={{ margin: "0.25rem 0 0" }}>{log.error}</div>
                      ) : null}
                    </td>
                    <td>
                      {log.status === "failed" && canManage ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={retryMut.isPending}
                          onClick={() => void retryMut.mutate(log.id, {
                            onError: (e) => setError(errText(e)),
                          })}
                        >
                          {t("telegram11.retry")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
