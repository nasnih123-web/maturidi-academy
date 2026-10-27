import React from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { useI18n, type Locale } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useEventFeed, type DomainEvent } from "../lib/events";
import { useMetabaseUrl } from "../lib/ops14";
import { EMPTY_L10N, type LocalizedText } from "../lib/contentApi";
import {
  downloadReceipt,
  errText,
  l10nText,
  money,
  raisedPct,
  useCampaigns,
  useCreateCampaign,
  useDeleteCampaign,
  useDonations,
  useGatewayStatus,
  useLedger,
  useReconcile,
  useResolveMismatch,
  useUpdateCampaign,
  parseDonationEvent,
  type Campaign,
  type CampaignInput,
  type Donation,
  type LedgerEntry,
  type MismatchResolution,
  type ReconcileMismatch,
} from "../lib/finance15";

/**
 * Phase 15 — Track 3 (CRM): Finance & donations section.
 *
 * Tabs: campaigns / donations / ledger / reconcile / gateways.
 * A live donation strip (donation.completed domain events over the Phase-2
 * /ws/events feed) sits at the top — no refresh needed, same pattern as the
 * live fatwa strip in pages/Fatwa.tsx.
 *
 * RBAC: gated on the `finance.manage` permission (contract §2). All API
 * access, parsing, money formatting and reconciliation math live in
 * lib/finance15.ts (ADR-001) — this file only renders.
 *
 * Secrets: gateway key VALUES are never fetched nor rendered (§3) —
 * only configured/not status from /admin/finance/gateways.
 */

const TABS = ["campaigns", "donations", "ledger", "reconcile", "gateways"] as const;
type FinanceTab = (typeof TABS)[number];

function initialTab(): FinanceTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as readonly string[]).includes(t)) return t as FinanceTab;
  } catch {
    // ignore
  }
  return "campaigns";
}

/* ------------------------------------------------------------------ */
/* live donation strip (donation.completed, no refresh)                 */
/* ------------------------------------------------------------------ */

function LiveDonationStrip(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { status, events } = useEventFeed(60);
  const donationEvents = events.filter((e: DomainEvent) => e.event_type === "donation.completed");
  const latest = donationEvents[0];
  const parsed = latest ? parseDonationEvent(latest.payload) : null;

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
      <Badge tone={status === "connected" ? "success" : "neutral"}>
        {t(`events.status${status[0].toUpperCase()}${status.slice(1)}`)}
      </Badge>
      <strong style={{ fontSize: "0.9rem" }}>{t("finance15.liveTitle")}</strong>
      <span className="hint" style={{ margin: 0 }}>
        {t("finance15.liveSub")}
      </span>
      {parsed ? (
        <span style={{ fontSize: "0.82rem", color: "var(--x-text2)" }}>
          {parsed.donor_name || t("finance15.d_anonymous")}
          {" · "}
          <strong dir="ltr">{money(parsed.amount, parsed.currency)}</strong>
          {" · "}
          <code dir="ltr" style={{ fontSize: "0.78rem" }}>
            {parsed.gateway}
            {parsed.gateway_reference ? `/${parsed.gateway_reference}` : ""}
          </code>
          {" · "}
          {parsed.created_at ? formatDate(parsed.created_at) : ""}
          {donationEvents.length > 1 ? ` · +${donationEvents.length - 1}` : ""}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {t("finance15.liveEmpty")}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* campaign form (localized title/description)                         */
/* ------------------------------------------------------------------ */

function CampaignForm({
  initial,
  onDone,
}: {
  initial?: Campaign;
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [title, setTitle] = React.useState<LocalizedText>(initial?.title ?? EMPTY_L10N);
  const [description, setDescription] = React.useState<LocalizedText>(
    initial?.description ?? EMPTY_L10N,
  );
  const [goal, setGoal] = React.useState<string>(String(initial?.goal_amount ?? ""));
  const [currency, setCurrency] = React.useState<string>(initial?.currency ?? "IRR");
  const [active, setActive] = React.useState<boolean>(initial?.active ?? true);
  const [error, setError] = React.useState("");
  const createMut = useCreateCampaign();
  const updateMut = useUpdateCampaign();

  const busy = createMut.isPending || updateMut.isPending;
  const valid =
    (title.fa.trim() || title.ar.trim() || title.en.trim()) !== "" &&
    Number.isFinite(Number(goal)) &&
    Number(goal) > 0 &&
    currency.trim() !== "";

  const submit = async (): Promise<void> => {
    setError("");
    const input: CampaignInput = {
      title,
      description,
      goal_amount: Number(goal),
      currency: currency.trim().toUpperCase(),
      active,
    };
    try {
      if (initial) {
        await updateMut.mutateAsync({ ...input, id: initial.id });
      } else {
        await createMut.mutateAsync(input);
      }
      onDone();
    } catch (e) {
      setError(errText(e));
    }
  };

  const l10nField = (
    id: string,
    prefix: "c_title" | "c_desc",
    value: LocalizedText,
    set: (v: LocalizedText) => void,
    multiline?: boolean,
  ): React.ReactElement => (
    <div className="field-row">
      {(["fa", "ar", "en"] as const).map((loc) => (
        <div className="field" key={`${id}-${loc}`}>
          <label htmlFor={`${id}-${loc}`}>{t(`finance15.${prefix}_${loc}`)}</label>
          {multiline ? (
            <textarea
              id={`${id}-${loc}`}
              dir={loc === "en" ? "ltr" : "rtl"}
              rows={2}
              value={value[loc]}
              onChange={(e) => set({ ...value, [loc]: e.target.value })}
            />
          ) : (
            <input
              id={`${id}-${loc}`}
              dir={loc === "en" ? "ltr" : "rtl"}
              value={value[loc]}
              onChange={(e) => set({ ...value, [loc]: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Card style={{ marginBottom: "1rem" }}>
      <CardHeader>
        <CardTitle>{initial ? t("finance15.c_edit") : t("finance15.c_create")}</CardTitle>
      </CardHeader>
      <CardContent>
        {l10nField("camp-title", "c_title", title, setTitle)}
        {l10nField("camp-desc", "c_desc", description, setDescription, true)}
        <div className="field-row">
          <div className="field">
            <label htmlFor="camp-goal">{t("finance15.c_goalAmount")}</label>
            <input
              id="camp-goal"
              dir="ltr"
              inputMode="numeric"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="camp-cur">{t("finance15.c_currency")}</label>
            <input
              id="camp-cur"
              dir="ltr"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={8}
            />
          </div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <label>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{" "}
              {t("finance15.c_activeToggle")}
            </label>
          </div>
        </div>
        {error && (
          <p className="conn-result fail" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button variant="primary" loading={busy} disabled={!valid || busy} onClick={() => void submit()}>
            {t("finance15.c_save")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onDone}>
            {t("finance15.c_cancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* tab: campaigns                                                      */
/* ------------------------------------------------------------------ */

function CampaignsTab({ locale }: { locale: Locale }): React.ReactElement {
  const { t } = useI18n();
  const query = useCampaigns();
  const del = useDeleteCampaign();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Campaign | null>(null);

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          {t("finance15.campaigns_new")}
        </Button>
      </div>

      {formOpen && (
        <CampaignForm
          initial={editing ?? undefined}
          onDone={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      {query.isLoading && <p className="empty">{t("common.loading")}</p>}
      {query.isError && (
        <div className="empty-state">
          <h3>{t("finance15.backendMissingTitle")}</h3>
          <p>{t("finance15.backendMissing")}</p>
          <p className="hint">
            <code dir="ltr">GET /api/v1/admin/finance/campaigns</code> — {errText(query.error)}
          </p>
        </div>
      )}
      {query.isSuccess && query.data.length === 0 && (
        <p className="empty">{t("finance15.campaigns_empty")}</p>
      )}
      {del.isError && <p className="error">{errText(del.error)}</p>}
      {query.isSuccess && query.data.length > 0 && (
        <div className="conn-grid">
          {query.data.map((c) => {
            const pct = raisedPct(c);
            return (
              <Card key={c.id}>
                <CardHeader>
                  <CardTitle>
                    {l10nText(c.title, locale) || <span className="muted">—</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p>
                    <Badge tone={c.active ? "success" : "neutral"}>
                      {c.active ? t("finance15.c_active") : t("finance15.c_inactive")}
                    </Badge>
                  </p>
                  {l10nText(c.description, locale) && (
                    <p className="hint" dir="auto">
                      {l10nText(c.description, locale)}
                    </p>
                  )}
                  <p style={{ fontSize: "0.85rem" }} dir="ltr">
                    {t("finance15.c_raised")}: {money(c.raised_amount, c.currency)}
                    {" / "}
                    {t("finance15.c_goal")}: {money(c.goal_amount, c.currency)}
                  </p>
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="progress-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div style={{ marginTop: "0.5rem" }}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      {t("finance15.c_edit")}
                    </Button>{" "}
                    <Button
                      variant="ghost"
                      disabled={del.isPending}
                      onClick={() => {
                        if (window.confirm(t("finance15.campaigns_confirmDelete"))) del.mutate(c.id);
                      }}
                    >
                      {t("finance15.campaigns_delete")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab: donations                                                      */
/* ------------------------------------------------------------------ */

function DonationsTab({ locale }: { locale: Locale }): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<string[]>([]);
  const query = useDonations(cursor);

  const goNext = (next: string | null): void => {
    if (!next) return;
    setHistory((h) => [...h, cursor ?? ""]);
    setCursor(next);
  };
  const goPrev = (): void => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      setCursor(prev === "" ? null : (prev ?? null));
      return h.slice(0, -1);
    });
  };

  const statusTone = (s: Donation["status"]): "success" | "warning" | "danger" | "neutral" =>
    s === "succeeded" ? "success" : s === "pending" ? "warning" : s === "failed" ? "danger" : "neutral";

  return (
    <div>
      {query.isLoading && <p className="empty">{t("common.loading")}</p>}
      {query.isError && (
        <div className="empty-state">
          <h3>{t("finance15.backendMissingTitle")}</h3>
          <p>{t("finance15.backendMissing")}</p>
          <p className="hint">
            <code dir="ltr">GET /api/v1/admin/finance/donations</code> — {errText(query.error)}
          </p>
        </div>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <p className="empty">{t("finance15.d_empty")}</p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("finance15.d_donor")}</th>
                  <th>{t("finance15.d_campaign")}</th>
                  <th>{t("finance15.d_amount")}</th>
                  <th>{t("finance15.d_gateway")}</th>
                  <th>{t("finance15.d_reference")}</th>
                  <th>{t("finance15.d_status")}</th>
                  <th>{t("finance15.d_date")}</th>
                  <th>{t("finance15.d_receipt")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((d) => (
                  <tr key={d.id}>
                    <td>{d.donor_name ?? <span className="muted">{t("finance15.d_anonymous")}</span>}</td>
                    <td dir="auto">
                      {d.campaign_title ? l10nText(d.campaign_title, locale) : "—"}
                    </td>
                    <td dir="ltr">{money(d.amount, d.currency)}</td>
                    <td dir="ltr">{d.gateway}</td>
                    <td dir="ltr">
                      {d.gateway_reference ? (
                        <code style={{ fontSize: "0.78rem" }}>{d.gateway_reference}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Badge tone={statusTone(d.status)}>{t(`finance15.st_${d.status}`)}</Badge>
                    </td>
                    <td>{d.created_at ? formatDate(d.created_at) : "—"}</td>
                    <td>
                      {d.status === "succeeded" ? (
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => {
                            void downloadReceipt(d.id).catch((e: unknown) =>
                              alert(errText(e)),
                            );
                          }}
                        >
                          {t("finance15.d_receipt")}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <Button variant="secondary" disabled={history.length === 0} onClick={goPrev}>
              {t("finance15.d_prev")}
            </Button>
            <Button
              variant="secondary"
              disabled={!query.data.nextCursor}
              onClick={() => goNext(query.data.nextCursor)}
            >
              {t("finance15.d_more")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab: ledger                                                         */
/* ------------------------------------------------------------------ */

function LedgerTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const [cursor, setCursor] = React.useState<string | null>(null);
  const query = useLedger(cursor);

  const kindTone = (k: LedgerEntry["kind"]): "success" | "danger" | "info" =>
    k === "donation_in" ? "success" : k === "refund_out" ? "danger" : "info";

  return (
    <div>
      {query.isLoading && <p className="empty">{t("common.loading")}</p>}
      {query.isError && (
        <div className="empty-state">
          <h3>{t("finance15.backendMissingTitle")}</h3>
          <p>{t("finance15.backendMissing")}</p>
          <p className="hint">
            <code dir="ltr">GET /api/v1/admin/finance/ledger</code> — {errText(query.error)}
          </p>
        </div>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <p className="empty">{t("finance15.l_empty")}</p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("finance15.l_kind")}</th>
                  <th>{t("finance15.l_amount")}</th>
                  <th>{t("finance15.l_desc")}</th>
                  <th>{t("finance15.l_donation")}</th>
                  <th>{t("finance15.l_date")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Badge tone={kindTone(e.kind)}>{t(`finance15.k_${e.kind}`)}</Badge>
                    </td>
                    <td dir="ltr">
                      {e.kind === "refund_out" ? "−" : "+"}
                      {money(e.amount, e.currency)}
                    </td>
                    <td dir="auto">{e.description || "—"}</td>
                    <td dir="ltr">
                      {e.donation_id ? (
                        <code style={{ fontSize: "0.78rem" }}>{e.donation_id}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{e.created_at ? formatDate(e.created_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.nextCursor && (
            <div style={{ marginTop: "0.75rem" }}>
              <Button variant="secondary" onClick={() => setCursor(query.data.nextCursor)}>
                {t("finance15.d_more")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab: reconciliation                                                 */
/* ------------------------------------------------------------------ */

function ReconcileTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const query = useReconcile();
  const resolveMut = useResolveMismatch();
  const [target, setTarget] = React.useState<ReconcileMismatch | null>(null);
  const [resolution, setResolution] = React.useState<MismatchResolution>("acknowledged");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");

  const openItems = (query.data ?? []).filter((m) => m.status === "open");
  const resolvedItems = (query.data ?? []).filter((m) => m.status === "resolved");

  const confirm = async (): Promise<void> => {
    if (!target) return;
    setError("");
    try {
      await resolveMut.mutateAsync({ id: target.id, resolution, note });
      setTarget(null);
      setNote("");
      setResolution("acknowledged");
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div>
      {query.isLoading && <p className="empty">{t("common.loading")}</p>}
      {query.isError && (
        <div className="empty-state">
          <h3>{t("finance15.backendMissingTitle")}</h3>
          <p>{t("finance15.backendMissing")}</p>
          <p className="hint">
            <code dir="ltr">GET /api/v1/admin/finance/reconcile</code> — {errText(query.error)}
          </p>
        </div>
      )}
      {query.isSuccess && openItems.length === 0 && (
        <p className="empty">{t("finance15.r_empty")}</p>
      )}
      {query.isSuccess && openItems.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem" }}>
            {t("finance15.r_open")} ({openItems.length})
          </h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("finance15.d_reference")}</th>
                  <th>{t("finance15.r_internal")}</th>
                  <th>{t("finance15.r_gateway")}</th>
                  <th>{t("finance15.r_reason")}</th>
                  <th>{t("finance15.d_date")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openItems.map((m) => (
                  <tr key={m.id}>
                    <td dir="ltr">
                      <code style={{ fontSize: "0.78rem" }}>
                        {m.gateway_reference ?? m.donation_id}
                      </code>
                    </td>
                    <td dir="ltr">{money(m.internal_amount, m.currency)}</td>
                    <td dir="ltr">
                      {m.gateway_amount != null ? money(m.gateway_amount, m.currency) : "—"}
                    </td>
                    <td dir="auto">{m.reason || "—"}</td>
                    <td>{m.created_at ? formatDate(m.created_at) : "—"}</td>
                    <td>
                      <Button variant="secondary" onClick={() => setTarget(m)}>
                        {t("finance15.r_resolve")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {target && (
        <Card style={{ marginTop: "1rem" }}>
          <CardHeader>
            <CardTitle>{t("finance15.r_resolve")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="hint" style={{ marginTop: 0 }} dir="ltr">
              <code style={{ fontSize: "0.78rem" }}>{target.gateway_reference ?? target.donation_id}</code>
              {" · "}
              {money(target.internal_amount, target.currency)}
              {" → "}
              {target.gateway_amount != null ? money(target.gateway_amount, target.currency) : "—"}
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="rec-resolution">{t("finance15.r_resolution")}</label>
                <select
                  id="rec-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as MismatchResolution)}
                >
                  <option value="acknowledged">{t("finance15.r_ack")}</option>
                  <option value="adjusted">{t("finance15.r_adjust")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="rec-note">{t("finance15.r_note")}</label>
                <input
                  id="rec-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  dir="auto"
                />
              </div>
            </div>
            {error && (
              <p className="conn-result fail" role="alert">
                {error}
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button
                variant="primary"
                loading={resolveMut.isPending}
                disabled={resolveMut.isPending}
                onClick={() => void confirm()}
              >
                {t("finance15.r_confirm")}
              </Button>
              <Button
                variant="secondary"
                disabled={resolveMut.isPending}
                onClick={() => setTarget(null)}
              >
                {t("finance15.c_cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {query.isSuccess && resolvedItems.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>
            {t("finance15.r_resolved")} ({resolvedItems.length})
          </h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("finance15.d_reference")}</th>
                  <th>{t("finance15.r_internal")}</th>
                  <th>{t("finance15.r_gateway")}</th>
                  <th>{t("finance15.d_date")}</th>
                </tr>
              </thead>
              <tbody>
                {resolvedItems.map((m) => (
                  <tr key={m.id}>
                    <td dir="ltr">
                      <code style={{ fontSize: "0.78rem" }}>
                        {m.gateway_reference ?? m.donation_id}
                      </code>
                    </td>
                    <td dir="ltr">{money(m.internal_amount, m.currency)}</td>
                    <td dir="ltr">
                      {m.gateway_amount != null ? money(m.gateway_amount, m.currency) : "—"}
                    </td>
                    <td>{m.created_at ? formatDate(m.created_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab: gateways                                                       */
/* ------------------------------------------------------------------ */

function GatewaysTab(): React.ReactElement {
  const { t } = useI18n();
  const query = useGatewayStatus();
  const metabaseUrl = useMetabaseUrl();

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>{t("finance15.g_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("finance15.g_hint")}
          </p>
          {query.isLoading && <p className="empty">{t("common.loading")}</p>}
          {query.isError && (
            <p className="hint">
              <code dir="ltr">GET /api/v1/admin/finance/gateways</code> — {errText(query.error)}
            </p>
          )}
          {query.isSuccess && (
            <div className="conn-grid">
              <div className="panel">
                <strong>{t("finance15.g_zarinpal")}</strong>
                <p>
                  <Badge tone={query.data.zarinpal.configured ? "success" : "neutral"}>
                    {query.data.zarinpal.configured
                      ? t("finance15.g_configured")
                      : t("finance15.g_notConfigured")}
                  </Badge>
                </p>
                <p className="hint" dir="ltr">
                  <code>payment.zarinpal_key</code>
                </p>
              </div>
              <div className="panel">
                <strong>{t("finance15.g_idpay")}</strong>
                <p>
                  <Badge tone={query.data.idpay.configured ? "success" : "neutral"}>
                    {query.data.idpay.configured
                      ? t("finance15.g_configured")
                      : t("finance15.g_notConfigured")}
                  </Badge>
                </p>
                <p className="hint" dir="ltr">
                  <code>payment.idpay_key</code>
                </p>
              </div>
            </div>
          )}
          <p className="hint">{t("finance15.g_testHint")}</p>
          <Link to="/connections" style={{ display: "inline-block", marginTop: "0.5rem" }}>
            <Button variant="secondary">{t("finance15.g_manageInConnections")}</Button>
          </Link>
        </CardContent>
      </Card>

      <Card style={{ marginTop: "1rem" }}>
        <CardHeader>
          <CardTitle>{t("finance15.g_reports")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("finance15.g_reportsHint")}
          </p>
          {metabaseUrl && (
            <Link to="/analytics" style={{ display: "inline-block" }}>
              <Button variant="primary">{t("finance15.g_openBI")}</Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Finance(): React.ReactElement {
  const { t, locale } = useI18n();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("finance.manage");
  const [tab, setTab] = React.useState<FinanceTab>(initialTab);

  if (!canManage) {
    return (
      <div className="page">
        <h1>{t("finance15.title")}</h1>
        <div className="empty-state">
          <p>{t("finance15.denied")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t("finance15.title")}</h1>
      <p className="hint">{t("finance15.hint")}</p>

      <LiveDonationStrip />

      <div className="tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {t(`finance15.tabs_${id}`)}
          </button>
        ))}
      </div>

      {tab === "campaigns" && <CampaignsTab locale={locale} />}
      {tab === "donations" && <DonationsTab locale={locale} />}
      {tab === "ledger" && <LedgerTab />}
      {tab === "reconcile" && <ReconcileTab />}
      {tab === "gateways" && <GatewaysTab />}
    </div>
  );
}
