import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  WIDGET_KINDS,
  WIDGET_SIZE,
  buildEmbedSnippet,
  errText,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useToggleApiKey,
  type ApiKey,
  type CreatedApiKey,
  type WidgetKind,
  type WidgetScope,
} from "../lib/apikeys";
import { useI18n, formatDate } from "../lib/i18n";
import { useAuth } from "../lib/auth";

/**
 * Phase 11 — API keys for embeddable widgets + embed-code generator.
 *
 * Per-key scopes (prayer-times / ayah / fatwa / zakat), rate-limit/quota
 * inputs, active toggle, usage counters, revoke. On create, the full key
 * is shown exactly once (contract §3) — afterwards only a masked preview
 * remains. The embed generator builds a copyable <iframe>/<script> snippet
 * from the chosen widget + key and renders a live preview frame.
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

/* ------------------------------------------------------------------ */
/* create dialog                                                       */
/* ------------------------------------------------------------------ */

function CreateKeyDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const { t } = useI18n();
  const createMut = useCreateApiKey();

  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<WidgetScope[]>(["prayer-times"]);
  const [rateLimit, setRateLimit] = React.useState(60);
  const [quota, setQuota] = React.useState("");
  const [created, setCreated] = React.useState<CreatedApiKey | null>(null);
  const [error, setError] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  const toggleScope = (s: WidgetScope): void =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const create = async (): Promise<void> => {
    setError("");
    if (!name.trim() || scopes.length === 0) {
      setError(t("apikeys11.createInvalid"));
      return;
    }
    try {
      const res = await createMut.mutateAsync({
        name: name.trim(),
        scopes,
        rate_limit_per_min: Math.max(1, rateLimit || 60),
        quota_monthly: quota.trim() ? Math.max(0, Number(quota)) : null,
      });
      setCreated(res);
    } catch (e) {
      setError(errText(e));
    }
  };

  const copyKey = async (): Promise<void> => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the key stays visible for manual copy
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "flex-start", justifyContent: "center",
        padding: "2rem 1rem", overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div style={{ width: "min(40rem, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <Card>
          <CardHeader><CardTitle>{t("apikeys11.newTitle")}</CardTitle></CardHeader>
          <CardContent>
            {created ? (
              <div style={{ display: "grid", gap: "0.9rem" }}>
                <p className="hint" style={{ margin: 0, color: "var(--x-gold2)" }}>
                  {t("apikeys11.shownOnce")}
                </p>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <code dir="ltr" style={{ flex: 1, padding: "0.6rem", background: "rgba(0,0,0,0.35)", borderRadius: "0.5rem", wordBreak: "break-all" }}>
                    {created.key}
                  </code>
                  <Button size="sm" variant="secondary" onClick={() => void copyKey()}>
                    {copied ? t("apikeys11.copied") : t("apikeys11.copy")}
                  </Button>
                </div>
                <div>
                  <Button onClick={onClose}>{t("common.close")}</Button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "0.9rem" }}>
                <Field label={t("apikeys11.name")}>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
                </Field>
                <Field label={t("apikeys11.scopes")}>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    {WIDGET_KINDS.map((s) => (
                      <label key={s} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.9rem" }}>
                        <input
                          type="checkbox"
                          checked={scopes.includes(s)}
                          onChange={() => toggleScope(s)}
                        />
                        {t(`apikeys11.scope_${s}`)}
                      </label>
                    ))}
                  </div>
                </Field>
                <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "1fr 1fr" }}>
                  <Field label={t("apikeys11.rateLimit")} hint={t("apikeys11.rateLimitHint")}>
                    <input
                      className="input" dir="ltr" type="number" min={1}
                      value={rateLimit}
                      onChange={(e) => setRateLimit(Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label={t("apikeys11.quota")} hint={t("apikeys11.quotaHint")}>
                    <input
                      className="input" dir="ltr" type="number" min={0}
                      placeholder={t("apikeys11.unlimited")}
                      value={quota}
                      onChange={(e) => setQuota(e.target.value)}
                    />
                  </Field>
                </div>
                {error ? <p className="form-error">{error}</p> : null}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button onClick={() => void create()} disabled={createMut.isPending}>
                    {t("apikeys11.create")}
                  </Button>
                  <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* embed generator                                                     */
/* ------------------------------------------------------------------ */

export function EmbedGenerator({ keys }: { keys: ApiKey[] }): React.ReactElement {
  const { t, locale } = useI18n();
  const [widget, setWidget] = React.useState<WidgetKind>("prayer-times");
  const [keyId, setKeyId] = React.useState<string>("");
  const [secretInput, setSecretInput] = React.useState("");
  const [copied, setCopied] = React.useState<"iframe" | "script" | null>(null);

  const activeKeys = keys.filter((k) => k.is_active);
  const chosen = activeKeys.find((k) => k.id === keyId) ?? activeKeys[0] ?? null;
  // The list API only returns a masked preview; the real key value must be
  // pasted (it was shown once at creation). Never invent a key.
  const keyValue = secretInput.trim() || (chosen ? chosen.key_preview : "");

  const snippet = React.useMemo(
    () =>
      buildEmbedSnippet(widget, keyValue, {
        apiBase: "https://api.example.com",
        locale,
        theme: "dark",
      }),
    [widget, keyValue, locale],
  );

  const size = WIDGET_SIZE[widget];

  const copy = async (text: string, which: "iframe" | "script"): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // ignore — user can select manually
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{t("apikeys11.embedTitle")}</CardTitle></CardHeader>
      <CardContent>
        <div style={{ display: "grid", gap: "0.9rem" }}>
          <p className="hint" style={{ margin: 0 }}>{t("apikeys11.embedHint")}</p>
          <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
            <Field label={t("apikeys11.widget")}>
              <select className="input" value={widget} onChange={(e) => setWidget(e.target.value as WidgetKind)}>
                {WIDGET_KINDS.map((w) => (
                  <option key={w} value={w}>{t(`apikeys11.scope_${w}`)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("apikeys11.key")}>
              <select className="input" value={chosen?.id ?? ""} onChange={(e) => setKeyId(e.target.value)}>
                {activeKeys.map((k) => (
                  <option key={k.id} value={k.id}>{k.name} ({k.key_preview})</option>
                ))}
              </select>
            </Field>
            <Field label={t("apikeys11.secretValue")} hint={t("apikeys11.secretValueHint")}>
              <input
                className="input"
                dir="ltr"
                type="password"
                autoComplete="off"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder="mk_…"
              />
            </Field>
          </div>

          <Field label={t("apikeys11.iframeSnippet")}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <code dir="ltr" style={{ flex: 1, minWidth: "16rem", padding: "0.6rem", background: "rgba(0,0,0,0.35)", borderRadius: "0.5rem", wordBreak: "break-all", fontSize: "0.8rem" }}>
                {snippet.iframe}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copy(snippet.iframe, "iframe")}>
                {copied === "iframe" ? t("apikeys11.copied") : t("apikeys11.copy")}
              </Button>
            </div>
          </Field>
          <Field label={t("apikeys11.scriptSnippet")}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <code dir="ltr" style={{ flex: 1, minWidth: "16rem", padding: "0.6rem", background: "rgba(0,0,0,0.35)", borderRadius: "0.5rem", wordBreak: "break-all", fontSize: "0.8rem" }}>
                {snippet.script}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copy(snippet.script, "script")}>
                {copied === "script" ? t("apikeys11.copied") : t("apikeys11.copy")}
              </Button>
            </div>
          </Field>

          <div>
            <p className="hint" style={{ margin: "0 0 0.4rem" }}>{t("apikeys11.preview")}</p>
            <div
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "center",
                padding: "1rem",
                background: "rgba(0,0,0,0.35)",
                border: "1px dashed var(--x-line)",
                borderRadius: "0.6rem",
              }}
            >
              <iframe
                title={t("apikeys11.preview")}
                srcDoc={demoWidgetHtml(widget, locale)}
                style={{ width: `${size.w}px`, height: `${size.h}px`, border: "1px solid var(--x-line)", borderRadius: "0.6rem", background: "#0d0a06" }}
              />
            </div>
            <p className="hint" style={{ margin: "0.4rem 0 0" }}>{t("apikeys11.previewHint")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Static demo rendering of a widget surface (screenshot/mock only — presentation). */
function demoWidgetHtml(widget: WidgetKind, locale: string): string {
  const dir = locale === "en" ? "ltr" : "rtl";
  const body: Record<WidgetKind, string> = {
    "prayer-times": "<div style='font-size:28px'>🕌</div><div>۰۵:۱۲ — اذان صبح</div><div style='font-size:12px;opacity:.7'>Tehran · 19 Oct 2026</div>",
    ayah: "<div style='font-size:22px;line-height:2'>إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ</div><div style='font-size:12px;opacity:.7'>الأحزاب ٥٦</div>",
    fatwa: "<div style='font-size:14px;font-weight:bold'>آخرین فتوا</div><div style='font-size:13px;margin-top:8px'>حکم تیمم برای مریض…</div>",
    zakat: "<div style='font-size:14px;font-weight:bold'>ماشین‌حساب زکات</div><div style='font-size:12px;margin-top:8px'>نصاب: ۸۵ گرم طلا</div>",
  };
  return `<html><body dir="${dir}" style="background:#0d0a06;color:#e8c874;font-family:inherit;display:flex;align-items:center;justify-content:center;text-align:center;min-height:100%;margin:0;padding:16px"><div>${body[widget]}</div></body></html>`;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function ApiKeys(): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("api_keys.manage");

  const [createOpen, setCreateOpen] = React.useState(
    // Deep-link for the screenshot harness: ?create=1
    () => new URLSearchParams(window.location.search).get("create") === "1",
  );
  const [revokeTarget, setRevokeTarget] = React.useState<ApiKey | null>(null);
  const [error, setError] = React.useState("");

  const listQuery = useApiKeys();
  const toggleMut = useToggleApiKey();
  const revokeMut = useRevokeApiKey();
  const keys = listQuery.data ?? [];

  const revoke = async (): Promise<void> => {
    if (!revokeTarget) return;
    try {
      await revokeMut.mutateAsync(revokeTarget.id);
      setRevokeTarget(null);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <h1 style={{ color: "var(--x-gold2)", fontSize: "1.4rem", margin: 0 }}>
          {t("apikeys11.title")}
        </h1>
        {canManage ? <Button onClick={() => setCreateOpen(true)}>{t("apikeys11.new")}</Button> : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {listQuery.isLoading ? (
        <p className="hint">{t("common.loading")}</p>
      ) : listQuery.isError ? (
        <p className="form-error">{errText(listQuery.error)}</p>
      ) : keys.length === 0 ? (
        <p className="hint">{t("apikeys11.empty")}</p>
      ) : (
        <Card>
          <CardContent>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("apikeys11.name")}</th>
                  <th>{t("apikeys11.keyCol")}</th>
                  <th>{t("apikeys11.scopes")}</th>
                  <th>{t("apikeys11.limits")}</th>
                  <th>{t("apikeys11.usage")}</th>
                  <th>{t("apikeys11.statusCol")}</th>
                  <th>{t("apikeys11.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td dir="auto">{k.name}</td>
                    <td><code dir="ltr" style={{ fontSize: "0.8rem" }}>{k.key_preview}</code></td>
                    <td>
                      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                        {k.scopes.map((s) => (
                          <Badge key={s} tone="neutral">{t(`apikeys11.scope_${s}`)}</Badge>
                        ))}
                      </div>
                    </td>
                    <td dir="ltr" style={{ fontSize: "0.85rem" }}>
                      {k.rate_limit_per_min}/min · {k.quota_monthly ?? t("apikeys11.unlimited")}/mo
                    </td>
                    <td dir="ltr" style={{ fontSize: "0.85rem" }}>
                      <span title={t("apikeys11.usageMonthly")}>{k.usage_monthly}</span>
                      {" / "}
                      <span title={t("apikeys11.usageTotal")}>{k.usage_total}</span>
                      {k.last_used_at ? (
                        <div className="hint" style={{ margin: 0 }}>{formatDate(locale, k.last_used_at)}</div>
                      ) : null}
                    </td>
                    <td>
                      {canManage ? (
                        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.85rem" }}>
                          <input
                            type="checkbox"
                            checked={k.is_active}
                            disabled={toggleMut.isPending}
                            onChange={() => void toggleMut.mutate({ id: k.id, is_active: !k.is_active }, {
                              onError: (e) => setError(errText(e)),
                            })}
                          />
                          {k.is_active ? t("apikeys11.active") : t("apikeys11.inactive")}
                        </label>
                      ) : (
                        <Badge tone={k.is_active ? "success" : "neutral"}>
                          {k.is_active ? t("apikeys11.active") : t("apikeys11.inactive")}
                        </Badge>
                      )}
                    </td>
                    <td>
                      {canManage ? (
                        <Button size="sm" variant="secondary" onClick={() => setRevokeTarget(k)}>
                          {t("apikeys11.revoke")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div style={{ marginTop: "1rem" }}>
        <EmbedGenerator keys={keys} />
      </div>

      {createOpen ? <CreateKeyDialog onClose={() => setCreateOpen(false)} /> : null}

      {revokeTarget ? (
        <div
          role="alertdialog"
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(0,0,0,0.55)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
          onClick={() => setRevokeTarget(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(28rem, 100%)" }}>
            <Card>
              <CardHeader><CardTitle>{t("apikeys11.revokeTitle")}</CardTitle></CardHeader>
              <CardContent>
                <p className="hint" dir="auto">{t("apikeys11.revokeConfirm")}</p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button disabled={revokeMut.isPending} onClick={() => void revoke()}>
                    {t("apikeys11.revoke")}
                  </Button>
                  <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
