import React from "react";
import { Badge, Button, statusTone } from "@maturidi/ui-web";
import { useI18n } from "../lib/i18n";
import {
  CreateRuleBody,
  MADHABS,
  RULE_STATUSES,
  ReviewDecision,
  RuleConfig,
  RuleType,
  UpdateRuleBody,
  errText,
  statusLabel,
  useCalculatorAudit,
  useCreateRule,
  useReviewRule,
  useRuleConfigs,
  useRuleHistory,
  useSubmitRule,
  useUpdateRule,
} from "../lib/calculators";

/**
 * Calculator rule-config management — Phase 7 (CRM track).
 *
 * Tabbed management over the Track 1 backend contract:
 *   inheritance rules · zakat rules · scholar review queue · audit log.
 *
 * §15.4 (hard rule): the client never invents or hardcodes fiqh tables —
 * rule_data is opaque JSON entered by an admin and can only reach public
 * calculations after a scholar_author approves it (approved_by/at are set
 * server-side). Every create/edit produces a NEW draft version; history
 * is append-only. §14: the audit view never renders secrets (the backend
 * never stores them there).
 */

type CalcTab = "inheritance" | "zakat" | "review" | "audit";
const TABS: CalcTab[] = ["inheritance", "zakat", "review", "audit"];

const TAB_KEY: Record<CalcTab, string> = {
  inheritance: "calc.tabInheritance",
  zakat: "calc.tabZakat",
  review: "calc.tabReview",
  audit: "calc.tabAudit",
};

function initialTab(): CalcTab {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TABS as string[]).includes(t)) return t as CalcTab;
  } catch {
    // ignore
  }
  return "inheritance";
}

function madhabLabel(t: (k: string) => string, madhab: string): string {
  const k = t(`fatwa.madhab_${madhab}`);
  return k === `fatwa.madhab_${madhab}` ? madhab : k;
}

/** pending_review gets the same warning tone as in_review. */
function ruleTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  return status === "pending_review" ? "warning" : statusTone(status);
}

function fmtEffective(rule: RuleConfig): string {
  const from = rule.effective_from ?? "—";
  const to = rule.effective_to ?? "∞";
  return `${from} → ${to}`;
}

/* ------------------------------------------------------------------ */
/* rule editor — guided metadata form + JSON editor for rule_data       */
/* ------------------------------------------------------------------ */

function validateRuleData(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: "json" | "object" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "object" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

const DEFAULT_RULE_DATA: Record<RuleType, string> = {
  inheritance: JSON.stringify({ notes: "" }, null, 2),
  zakat: JSON.stringify({ notes: "" }, null, 2),
};

function RuleEditor({
  type,
  existing,
  onDone,
}: {
  type: RuleType;
  existing: RuleConfig | null;
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [madhab, setMadhab] = React.useState(existing?.madhab ?? "hanafi");
  const [source, setSource] = React.useState(existing?.source ?? "");
  const [effectiveFrom, setEffectiveFrom] = React.useState(existing?.effective_from ?? "");
  const [effectiveTo, setEffectiveTo] = React.useState(existing?.effective_to ?? "");
  const [changeReason, setChangeReason] = React.useState("");
  const [ruleDataText, setRuleDataText] = React.useState(
    existing ? JSON.stringify(existing.rule_data, null, 2) : DEFAULT_RULE_DATA[type],
  );
  const [touched, setTouched] = React.useState(false);
  const create = useCreateRule();
  const update = useUpdateRule();
  const pending = create.isPending || update.isPending;
  const err = create.isError ? create.error : update.isError ? update.error : null;

  const jsonCheck = validateRuleData(ruleDataText);
  const sourceOk = source.trim().length > 0;
  const valid = sourceOk && jsonCheck.ok;

  const handleSave = (): void => {
    setTouched(true);
    if (!valid || pending || jsonCheck.ok !== true) return;
    if (existing) {
      const body: UpdateRuleBody = {
        madhab,
        source: source.trim(),
        effective_from: effectiveFrom.trim() || null,
        effective_to: effectiveTo.trim() || null,
        change_reason: changeReason.trim() || undefined,
        rule_data: jsonCheck.value,
      };
      update.mutate({ id: existing.id, body }, { onSuccess: onDone });
    } else {
      const body: CreateRuleBody = {
        rule_type: type,
        madhab,
        source: source.trim(),
        effective_from: effectiveFrom.trim() || null,
        effective_to: effectiveTo.trim() || null,
        change_reason: changeReason.trim() || undefined,
        rule_data: jsonCheck.value,
      };
      create.mutate(body, { onSuccess: onDone });
    }
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div className="field">
          <label htmlFor="rule-madhab">{t("calc.fieldMadhab")}</label>
          <select
            id="rule-madhab"
            className="input"
            value={madhab}
            onChange={(e) => setMadhab(e.target.value)}
          >
            {MADHABS.map((m) => (
              <option key={m} value={m}>
                {madhabLabel(t, m)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">{t("calc.fieldVersion")}</span>
          <div className="input" aria-live="polite" style={{ cursor: "not-allowed", opacity: 0.75 }}>
            <span dir="ltr">{existing ? `v${existing.version} → v${existing.version + 1}` : t("calc.versionAuto")}</span>
          </div>
          <span className="hint">{t("calc.versionAutoNote")}</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rule-source">{t("calc.fieldSource")}</label>
        <input
          id="rule-source"
          className="input"
          dir="auto"
          placeholder={t("calc.sourcePlaceholder")}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        {touched && !sourceOk && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {t("calc.sourceRequired")}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div className="field">
          <label htmlFor="rule-from">{t("calc.fieldEffectiveFrom")}</label>
          <input
            id="rule-from"
            type="date"
            className="input"
            dir="ltr"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rule-to">{t("calc.fieldEffectiveTo")}</label>
          <input
            id="rule-to"
            type="date"
            className="input"
            dir="ltr"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="rule-reason">{t("calc.fieldChangeReason")}</label>
        <textarea
          id="rule-reason"
          className="input"
          rows={2}
          dir="auto"
          placeholder={t("calc.changeReasonPlaceholder")}
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="rule-data">{t("calc.fieldRuleData")}</label>
        <textarea
          id="rule-data"
          className="input"
          rows={10}
          dir="ltr"
          spellCheck={false}
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.82rem" }}
          placeholder={t("calc.ruleDataPlaceholder")}
          value={ruleDataText}
          onChange={(e) => setRuleDataText(e.target.value)}
        />
        <span className="hint">{t("calc.ruleDataHint")}</span>
        {touched && !jsonCheck.ok && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {jsonCheck.message === "json" ? t("calc.invalidJson") : t("calc.jsonMustBeObject")}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <Button size="sm" disabled={pending} onClick={handleSave}>
          {pending ? t("common.loading") : t("calc.saveDraft")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t("calc.cancel")}
        </Button>
        {err && (
          <span className="form-error" style={{ marginBottom: 0 }}>
            {errText(err)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* version history drawer                                               */
/* ------------------------------------------------------------------ */

function HistoryDrawer({
  rule,
  onClose,
}: {
  rule: RuleConfig;
  onClose: () => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const history = useRuleHistory(rule.id);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer slide-in" role="dialog" aria-modal="true" aria-label={t("calc.historyTitle")}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--x-gold2)" }}>
            {t("calc.historyTitle")}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
            {t("calc.close")}
          </Button>
        </div>

        <p className="hint" style={{ marginTop: 0 }}>
          {madhabLabel(t, rule.madhab)} · <span dir="auto">{rule.source}</span>
        </p>

        {history.isLoading && <div className="empty">{t("common.loading")}</div>}
        {history.isError && (
          <div className="empty">
            <p>{t("common.error")}</p>
            <Button size="sm" variant="secondary" onClick={() => history.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {history.data && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t("calc.tableVersion")}</th>
                  <th>{t("calc.tableStatus")}</th>
                  <th>{t("calc.fieldChangeReason")}</th>
                  <th>{t("calc.tableApprovedBy")}</th>
                  <th>{t("calc.tableUpdated")}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.id}>
                    <td dir="ltr">
                      <code>v{h.version}</code>
                      {h.version === rule.version && (
                        <Badge tone="info" style={{ marginInlineStart: "0.4rem" }}>
                          {t("calc.historyCurrent")}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={ruleTone(h.status)}>{statusLabel(t, h.status)}</Badge>
                    </td>
                    <td dir="auto" style={{ maxWidth: "220px" }}>
                      {h.change_reason || "—"}
                    </td>
                    <td>
                      {h.approved_by ? <code dir="ltr">{h.approved_by.slice(0, 8)}…</code> : "—"}
                    </td>
                    <td>{h.updated_at ? formatDate(h.updated_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* rules tab (inheritance / zakat)                                      */
/* ------------------------------------------------------------------ */

function RuleRow({
  rule,
  onHistory,
  onEdit,
}: {
  rule: RuleConfig;
  onHistory: () => void;
  onEdit: () => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const submit = useSubmitRule();
  const canSubmit = rule.status === "draft";
  return (
    <tr>
      <td>{madhabLabel(t, rule.madhab)}</td>
      <td dir="auto" style={{ maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }}>
        {rule.source || "—"}
      </td>
      <td dir="ltr">
        <code>v{rule.version}</code>
      </td>
      <td>
        <Badge tone={ruleTone(rule.status)}>{statusLabel(t, rule.status)}</Badge>
      </td>
      <td dir="ltr" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
        {fmtEffective(rule)}
      </td>
      <td>
        {rule.approved_by ? (
          <span>
            <code dir="ltr">{rule.approved_by.slice(0, 8)}…</code>
            <br />
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              {rule.approved_at ? formatDate(rule.approved_at) : ""}
            </span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>{rule.updated_at ? formatDate(rule.updated_at) : "—"}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <Button size="sm" variant="secondary" onClick={onHistory}>
          {t("calc.history")}
        </Button>{" "}
        <Button size="sm" variant="secondary" onClick={onEdit}>
          {t("calc.edit")}
        </Button>{" "}
        {canSubmit && (
          <Button
            size="sm"
            disabled={submit.isPending}
            onClick={() => {
              if (window.confirm(t("calc.confirmSubmit"))) submit.mutate(rule.id);
            }}
          >
            {submit.isPending ? t("common.loading") : t("calc.submit")}
          </Button>
        )}
      </td>
    </tr>
  );
}

function RulesTab({ type }: { type: RuleType }): React.ReactElement {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [editing, setEditing] = React.useState<RuleConfig | null | "new">(null);
  const [historyOf, setHistoryOf] = React.useState<RuleConfig | null>(null);
  const rules = useRuleConfigs(type);

  const items = React.useMemo(() => {
    const all = rules.data ?? [];
    return statusFilter ? all.filter((r) => r.status === statusFilter) : all;
  }, [rules.data, statusFilter]);

  return (
    <div>
      <section
        className="panel"
        style={{
          marginBottom: "0.75rem",
          borderColor: "var(--x-warning, #b45309)",
        }}
        aria-label={t("calc.approvalBanner")}
      >
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
          <Badge tone="warning">{t("calc.bannerTag")}</Badge>
          <p className="hint" style={{ margin: 0, fontWeight: 600 }}>
            {t("calc.approvalBanner")}
          </p>
        </div>
      </section>

      {editing ? (
        <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("calc.editorTitle")}>
          <div className="panel-head">
            <h2>{editing === "new" ? t("calc.editorNew") : t("calc.editorEdit")}</h2>
          </div>
          <RuleEditor
            type={type}
            existing={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        </section>
      ) : (
        <div className="panel" style={{ marginBottom: "0.75rem" }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="field" style={{ marginBottom: 0, minWidth: "180px" }}>
              <label htmlFor={`rule-status-${type}`}>{t("calc.filterStatus")}</label>
              <select
                id={`rule-status-${type}`}
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{t("calc.allStatuses")}</option>
                {RULE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(t, s)}
                  </option>
                ))}
              </select>
            </div>
            <span style={{ flex: 1 }} />
            <span className="hint" style={{ margin: 0 }}>
              {type === "inheritance" ? t("calc.rulesHintInheritance") : t("calc.rulesHintZakat")}
            </span>
            <Button size="sm" onClick={() => setEditing("new")}>
              {t("calc.newDraft")}
            </Button>
          </div>
        </div>
      )}

      {rules.isLoading && <div className="empty">{t("common.loading")}</div>}
      {rules.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => rules.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {rules.data && items.length === 0 && (
        <div className="empty">
          <p>{t("calc.emptyRules")}</p>
        </div>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("calc.tableMadhab")}</th>
                <th>{t("calc.tableSource")}</th>
                <th>{t("calc.tableVersion")}</th>
                <th>{t("calc.tableStatus")}</th>
                <th>{t("calc.tableEffective")}</th>
                <th>{t("calc.tableApprovedBy")}</th>
                <th>{t("calc.tableUpdated")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  onHistory={() => setHistoryOf(r)}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyOf && <HistoryDrawer rule={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* review queue — pending_review across both rule types                 */
/* ------------------------------------------------------------------ */

function ReviewDialog({
  rule,
  onClose,
}: {
  rule: RuleConfig;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [note, setNote] = React.useState("");
  const review = useReviewRule();

  const decide = (decision: ReviewDecision): void => {
    const confirmed =
      decision === "approve"
        ? window.confirm(t("calc.confirmApprove"))
        : window.confirm(t("calc.confirmReject"));
    if (!confirmed || review.isPending) return;
    review.mutate({ id: rule.id, decision, note: note.trim() }, { onSuccess: onClose });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer slide-in" role="dialog" aria-modal="true" aria-label={t("calc.reviewDialogTitle")}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--x-gold2)" }}>
            {t("calc.reviewDialogTitle")}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} autoFocus>
            {t("calc.close")}
          </Button>
        </div>

        <div className="table-wrap" style={{ marginBottom: "1rem" }}>
          <table className="data">
            <tbody>
              <tr>
                <td style={{ width: "40%" }}>{t("calc.tableMadhab")}</td>
                <td>{madhabLabel(t, rule.madhab)}</td>
              </tr>
              <tr>
                <td>{t("calc.tableSource")}</td>
                <td dir="auto">{rule.source || "—"}</td>
              </tr>
              <tr>
                <td>{t("calc.tableVersion")}</td>
                <td dir="ltr">
                  <code>v{rule.version}</code>
                </td>
              </tr>
              <tr>
                <td>{t("calc.tableEffective")}</td>
                <td dir="ltr">{fmtEffective(rule)}</td>
              </tr>
              {rule.change_reason && (
                <tr>
                  <td>{t("calc.fieldChangeReason")}</td>
                  <td dir="auto">{rule.change_reason}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer", color: "var(--x-gold2)" }}>
            {t("calc.fieldRuleData")}
          </summary>
          <pre
            dir="ltr"
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.78rem",
              color: "var(--x-text2)",
              background: "var(--x-panel, transparent)",
              padding: "0.6rem",
              borderRadius: "0.4rem",
              maxHeight: "240px",
              overflow: "auto",
              marginTop: "0.5rem",
            }}
          >
            {JSON.stringify(rule.rule_data, null, 2)}
          </pre>
        </details>

        <div className="field">
          <label htmlFor="review-note">{t("calc.reviewNoteLabel")}</label>
          <textarea
            id="review-note"
            className="input"
            rows={3}
            dir="auto"
            placeholder={t("calc.reviewNotePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" disabled={review.isPending} onClick={() => decide("approve")}>
            {review.isPending ? t("common.loading") : t("calc.approve")}
          </Button>
          <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide("reject")}>
            {t("calc.reject")}
          </Button>
          {review.isError && (
            <span className="form-error" style={{ marginBottom: 0 }}>
              {errText(review.error)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function ReviewTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const inheritance = useRuleConfigs("inheritance");
  const zakat = useRuleConfigs("zakat");
  const [selected, setSelected] = React.useState<RuleConfig | null>(null);

  const pending = React.useMemo(() => {
    const all: RuleConfig[] = [
      ...(inheritance.data ?? []),
      ...(zakat.data ?? []),
    ];
    return all
      .filter((r) => r.status === "pending_review")
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [inheritance.data, zakat.data]);

  const loading = inheritance.isLoading || zakat.isLoading;
  const error = inheritance.isError || zakat.isError;

  const typeLabel = (ty: RuleType): string =>
    ty === "inheritance" ? t("calc.tabInheritance") : t("calc.tabZakat");

  return (
    <div>
      <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("calc.reviewTitle")}>
        <div className="panel-head">
          <h2>{t("calc.reviewTitle")}</h2>
          <Badge tone="info">{t("calc.scholarTag")}</Badge>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {t("calc.reviewHint")}
        </p>
      </section>

      {loading && <div className="empty">{t("common.loading")}</div>}
      {error && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              inheritance.refetch();
              zakat.refetch();
            }}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {!loading && !error && pending.length === 0 && (
        <div className="empty">
          <p>{t("calc.emptyReview")}</p>
        </div>
      )}
      {pending.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("calc.tableType")}</th>
                <th>{t("calc.tableMadhab")}</th>
                <th>{t("calc.tableSource")}</th>
                <th>{t("calc.tableVersion")}</th>
                <th>{t("calc.tableUpdated")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{typeLabel(r.rule_type)}</td>
                  <td>{madhabLabel(t, r.madhab)}</td>
                  <td dir="auto" style={{ maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.source || "—"}
                  </td>
                  <td dir="ltr">
                    <code>v{r.version}</code>
                  </td>
                  <td>{r.updated_at ? formatDate(r.updated_at) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Button size="sm" onClick={() => setSelected(r)}>
                      {t("calc.review")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ReviewDialog rule={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* audit (§14)                                                         */
/* ------------------------------------------------------------------ */

function AuditTab(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const audit = useCalculatorAudit(100);

  return (
    <div>
      <section className="panel" style={{ marginBottom: "0.75rem" }} aria-label={t("calc.auditTitle")}>
        <div className="panel-head">
          <h2>{t("calc.auditTitle")}</h2>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {t("calc.auditHint")}
        </p>
      </section>

      {audit.isLoading && <div className="empty">{t("common.loading")}</div>}
      {audit.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => audit.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {audit.data && audit.data.length === 0 && (
        <div className="empty">{t("calc.emptyAudit")}</div>
      )}
      {audit.data && audit.data.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("calc.tableAction")}</th>
                <th>{t("calc.tableEntity")}</th>
                <th>{t("calc.tableActor")}</th>
                <th>{t("calc.tableTime")}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map((e) => (
                <tr key={e.id || `${e.action}-${e.created_at}`}>
                  <td>
                    <Badge tone="info">{e.action}</Badge>
                  </td>
                  <td>
                    {e.entity_type ? (
                      <span dir="ltr">
                        <code style={{ fontSize: "0.75rem" }}>{e.entity_type}</code>
                        {e.entity_id ? ` · ${e.entity_id.slice(0, 8)}…` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{e.actor_id ? <code dir="ltr">{e.actor_id.slice(0, 8)}…</code> : "—"}</td>
                  <td>{e.created_at ? formatDate(e.created_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page shell                                                          */
/* ------------------------------------------------------------------ */

export default function Calculators(): React.ReactElement {
  const { t, setLocale } = useI18n();
  const [tab, setTab] = React.useState<CalcTab>(initialTab);

  // Deep-link support: ?tab=…&locale=fa|ar|en
  React.useEffect(() => {
    try {
      const l = new URLSearchParams(window.location.search).get("locale");
      if (l === "fa" || l === "ar" || l === "en") setLocale(l);
    } catch {
      // ignore
    }
  }, [setLocale]);

  // Keep the query param in sync so the review queue is linkable.
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== tab) {
        url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      // ignore
    }
  }, [tab]);

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
        <h1 style={{ margin: 0 }}>{t("calc.title")}</h1>
        <Badge tone="danger">{t("settings.superOnly")}</Badge>
      </div>

      <p className="hint" style={{ fontSize: "0.9rem", marginBottom: "1.25rem" }}>
        {t("calc.sub")}
      </p>

      <div className="locale-tabs" role="tablist" aria-label={t("calc.title")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`locale-tab${tab === tb ? " on" : ""}`}
            onClick={() => setTab(tb)}
          >
            {t(TAB_KEY[tb])}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "inheritance" && <RulesTab type="inheritance" />}
        {tab === "zakat" && <RulesTab type="zakat" />}
        {tab === "review" && <ReviewTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}
