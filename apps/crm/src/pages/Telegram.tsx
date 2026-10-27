import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { ApiError } from "../lib/api";
import {
  errText,
  useConfirmConnectCode,
  useDisconnectTelegram,
  useImportJob,
  useRequestConnectCode,
  useStartChannelImport,
  useTelegramStatus,
} from "../lib/telegram";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import TelegramDistributionPanel from "../components/TelegramDistributionPanel";

/**
 * Phase 11 — Telegram management page.
 *
 * Three tabs:
 *  1. «اتصال حساب تلگرام» (platform settings area): 2-step phone→code flow
 *     (+ optional 2FA password). The status card shows only «متصل / قطع»
 *     with the masked phone — the session string / bot token are NEVER
 *     displayed anywhere (contract §14 / §3).
 *  2. Channel import launcher: channel + limit → job → live progress
 *     (processed count, current item, errors); imported items land in
 *     `in_review` with a link to the Phase-9 media editor for human review.
 *  3. Per-content «Telegram Distribution» panel (reusable component demo).
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

function TabBar({ tab, setTab }: { tab: string; setTab: (t: string) => void }): React.ReactElement {
  const { t } = useI18n();
  const tabs = [
    ["connect", t("telegram11.tabConnect")],
    ["import", t("telegram11.tabImport")],
    ["distribution", t("telegram11.tabDistribution")],
  ] as const;
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          className="input"
          style={{
            width: "auto",
            padding: "0.45rem 1.1rem",
            cursor: "pointer",
            background: tab === key ? "var(--x-gold)" : "transparent",
            color: tab === key ? "#1a1408" : "var(--x-text2)",
            border: tab === key ? "1px solid var(--x-gold)" : "1px solid var(--x-line)",
            borderRadius: "999px",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 1 — account connect                                             */
/* ------------------------------------------------------------------ */

function ConnectTab(): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("telegram.manage");

  const statusQuery = useTelegramStatus();
  const requestMut = useRequestConnectCode();
  const confirmMut = useConfirmConnectCode();
  const disconnectMut = useDisconnectTelegram();

  const [phone, setPhone] = React.useState("");
  // Deep-link for the screenshot harness: ?step=2[&2fa=1]
  const [step, setStep] = React.useState<1 | 2>(() =>
    new URLSearchParams(window.location.search).get("step") === "2" ? 2 : 1,
  );
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [requires2fa, setRequires2fa] = React.useState(
    () => new URLSearchParams(window.location.search).get("2fa") === "1",
  );
  const [error, setError] = React.useState("");

  const connected = statusQuery.data?.connected === true;
  const masked = statusQuery.data?.masked_phone ?? null;

  const requestCode = async (): Promise<void> => {
    setError("");
    try {
      const res = await requestMut.mutateAsync(phone.trim());
      setRequires2fa(res.requires_2fa);
      setStep(2);
    } catch (e) {
      setError(errText(e));
    }
  };

  const confirm = async (): Promise<void> => {
    setError("");
    try {
      await confirmMut.mutateAsync({
        phone: phone.trim(),
        code: code.trim(),
        password: requires2fa && password ? password : undefined,
      });
      setStep(1);
      setCode("");
      setPassword("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "password_required") {
        setRequires2fa(true);
      }
      setError(errText(e));
    }
  };

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "720px" }}>
      <Card>
        <CardHeader>
          <CardTitle>{t("telegram11.statusTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <p className="hint">{t("common.loading")}</p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <Badge tone={connected ? "success" : "neutral"}>
                {connected ? t("telegram11.connected") : t("telegram11.disconnected")}
              </Badge>
              {masked ? (
                <span dir="ltr" style={{ color: "var(--x-text2)" }}>{masked}</span>
              ) : null}
              {connected && canManage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disconnectMut.isPending}
                  onClick={() => void disconnectMut.mutate(undefined, {
                    onError: (e) => setError(errText(e)),
                  })}
                >
                  {t("telegram11.disconnect")}
                </Button>
              ) : null}
            </div>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            {t("telegram11.neverShowsSecret")}
          </p>
        </CardContent>
      </Card>

      {(!connected || step === 2) && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {step === 1 ? t("telegram11.step1Title") : t("telegram11.step2Title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ display: "grid", gap: "0.9rem" }}>
              {step === 1 ? (
                <>
                  <Field label={t("telegram11.phone")} hint={t("telegram11.phoneHint")}>
                    <input
                      className="input"
                      dir="ltr"
                      placeholder="+98912…"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      style={{ maxWidth: "22rem" }}
                    />
                  </Field>
                  <div>
                    <Button onClick={() => void requestCode()} disabled={requestMut.isPending || !phone.trim()}>
                      {t("telegram11.sendCode")}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Field label={t("telegram11.code")} hint={t("telegram11.codeHint")}>
                    <input
                      className="input"
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      style={{ maxWidth: "22rem" }}
                    />
                  </Field>
                  {requires2fa ? (
                    <Field label={t("telegram11.password2fa")} hint={t("telegram11.password2faHint")}>
                      <input
                        className="input"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ maxWidth: "22rem" }}
                      />
                    </Field>
                  ) : null}
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <Button onClick={() => void confirm()} disabled={confirmMut.isPending || !code.trim()}>
                      {t("telegram11.confirm")}
                    </Button>
                    <Button variant="secondary" onClick={() => setStep(1)}>
                      {t("telegram11.back")}
                    </Button>
                  </div>
                </>
              )}
              {error ? <p className="form-error">{error}</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 2 — channel import                                              */
/* ------------------------------------------------------------------ */

const JOB_STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  completed: "success",
  failed: "danger",
  running: "warning",
  queued: "warning",
  cancelled: "neutral",
};

function ImportTab(): React.ReactElement {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("telegram.import");

  const [channel, setChannel] = React.useState("");
  const [limit, setLimit] = React.useState(200);
  // Deep-link for the screenshot harness: ?job=<channel> shows that channel's progress
  const [jobChannel, setJobChannel] = React.useState<string | null>(
    () => new URLSearchParams(window.location.search).get("job"),
  );
  const [jobLimit, setJobLimit] = React.useState(200);
  const [error, setError] = React.useState("");

  const startMut = useStartChannelImport();
  const jobQuery = useImportJob(jobChannel, jobLimit);

  const job = jobQuery.data ?? null;
  const pct =
    job && job.total ? Math.round((job.processed / Math.max(1, job.total)) * 100) : null;

  const start = async (): Promise<void> => {
    setError("");
    try {
      const res = await startMut.mutateAsync({
        channel: channel.trim().replace(/^@/, ""),
        limit,
      });
      setJobChannel(res.job_id);
      setJobLimit(res.limit);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "880px" }}>
      <Card>
        <CardHeader>
          <CardTitle>{t("telegram11.importTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "0.9rem" }}>
            <p className="hint" style={{ margin: 0 }}>{t("telegram11.importHint")}</p>
            <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
              <Field label={t("telegram11.channel")}>
                <input
                  className="input"
                  dir="ltr"
                  placeholder="madrasto_al_emamo_al_matoridi"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={!canManage}
                />
              </Field>
              <Field label={t("telegram11.limit")}>
                <input
                  className="input"
                  dir="ltr"
                  type="number"
                  min={1}
                  max={10000}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                  disabled={!canManage}
                />
              </Field>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            {canManage ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <Button onClick={() => void start()} disabled={startMut.isPending || !channel.trim()}>
                  {t("telegram11.startImport")}
                </Button>
                <span className="hint" style={{ margin: 0, alignSelf: "center" }}>
                  {t("telegram11.noCancelHint")}
                </span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {jobChannel ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("telegram11.jobTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {jobQuery.isLoading ? (
              <p className="hint">{t("common.loading")}</p>
            ) : job ? (
              <div style={{ display: "grid", gap: "0.7rem" }}>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone={JOB_STATUS_TONE[job.status] ?? "neutral"}>
                    {t(`telegram11.job_${job.status}`)}
                  </Badge>
                  <span className="hint" style={{ margin: 0 }} dir="ltr">@{job.channel}</span>
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                    <span className="hint" style={{ margin: 0 }}>
                      {t("telegram11.processed")}: <bdi dir="ltr">{job.processed}{job.total !== null ? ` / ${job.total}` : ""}</bdi>
                    </span>
                    {pct !== null ? <span className="hint" style={{ margin: 0 }} dir="ltr">{pct}%</span> : null}
                  </div>
                  <div style={{ height: "0.6rem", background: "var(--x-line)", borderRadius: "999px", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${pct ?? 0}%`,
                        background: "var(--x-gold)",
                        transition: "width 0.5s",
                      }}
                    />
                  </div>
                </div>
                {job.current_item ? (
                  <p className="hint" style={{ margin: 0 }}>
                    {t("telegram11.currentItem")}: <span dir="auto">{job.current_item}</span>
                  </p>
                ) : null}
                {job.errors.length > 0 ? (
                  <div>
                    <p className="hint">{t("telegram11.errors")}</p>
                    <ul style={{ margin: 0, paddingInlineStart: "1.2rem", color: "var(--x-text2)", fontSize: "0.85rem" }}>
                      {job.errors.slice(0, 10).map((e, i) => (
                        <li key={i} dir="auto">{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="hint" style={{ margin: 0 }}>
                  {t("telegram11.importProgressHint")}{" "}
                  <a href="/media" style={{ color: "var(--x-gold)" }}>
                    {t("telegram11.openMediaEditor")}
                  </a>
                </p>
              </div>
            ) : (
              <p className="form-error">{t("telegram11.jobNotFound")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 3 — per-content distribution (reusable panel)                   */
/* ------------------------------------------------------------------ */

const CONTENT_TYPES = ["library", "fatwa", "cms", "social"] as const;

function DistributionTab(): React.ReactElement {
  const { t } = useI18n();
  const [contentType, setContentType] = React.useState<string>("library");
  // Deep-link for the screenshot harness: ?contentId=<id>
  const [contentId, setContentId] = React.useState<string>(
    () => new URLSearchParams(window.location.search).get("contentId") ?? "",
  );

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <Card>
        <CardHeader>
          <CardTitle>{t("telegram11.pickContentTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
            <Field label={t("telegram11.contentType")}>
              <select
                className="input"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
              >
                {CONTENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{t(`telegram11.ctype_${ct}`)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("telegram11.contentId")}>
              <input
                className="input"
                dir="ltr"
                value={contentId}
                onChange={(e) => setContentId(e.target.value)}
                placeholder="uuid…"
              />
            </Field>
          </div>
        </CardContent>
      </Card>
      {contentId.trim() ? (
        <TelegramDistributionPanel contentType={contentType} contentId={contentId.trim()} />
      ) : (
        <p className="hint">{t("telegram11.pickContentHint")}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Telegram(): React.ReactElement {
  const { t } = useI18n();
  // Deep-link for the screenshot harness: ?tab=connect|import|distribution
  const [tab, setTab] = React.useState(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    return q === "import" || q === "distribution" ? q : "connect";
  });

  return (
    <div className="page">
      <h1 style={{ color: "var(--x-gold2)", fontSize: "1.4rem", margin: "0 0 1rem" }}>
        {t("telegram11.title")}
      </h1>
      <TabBar tab={tab} setTab={setTab} />
      <div style={{ marginTop: "1rem" }}>
        {tab === "connect" ? <ConnectTab /> : tab === "import" ? <ImportTab /> : <DistributionTab />}
      </div>
    </div>
  );
}
