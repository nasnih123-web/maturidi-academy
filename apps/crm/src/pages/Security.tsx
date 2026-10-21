import React from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button } from "@maturidi/ui-web";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { errText } from "../lib/library";
import {
  ReauthPayload,
  downloadRecoveryCodes,
  recoveryCodesText,
  useDisable2FA,
  useEnable2FA,
  useQrDataUrl,
  useRegenerateRecoveryCodes,
  useSetup2FA,
  useTwoFAStatus,
} from "../lib/security";

/**
 * Security & 2FA (Phase 2 — F-01/F-02).
 *
 * Presentational page: all API/state logic lives in lib/security.ts and
 * lib/auth.tsx (ADR-001). Covers the full lifecycle:
 * status → enroll (QR + manual secret → verify) → recovery codes shown
 * ONCE → regenerate / disable behind a re-auth modal (password + TOTP
 * or recovery code). With a restricted `2fa_setup` session this is the
 * only reachable page until enrollment completes.
 */

type ModalKind = "disable" | "regenerate" | null;

function RecoveryCodesPanel({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [saved, setSaved] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryCodesText(codes));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable — the download button still works.
    }
  }

  return (
    <section className="panel" aria-label={t("security.codesTitle")}>
      <div className="panel-head">
        <h2>{t("security.codesTitle")}</h2>
        <Badge tone="danger">{t("security.codesOnce")}</Badge>
      </div>
      <p className="hint" style={{ marginBottom: "1rem" }}>
        {t("security.codesWarn")}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
        dir="ltr"
      >
        {codes.map((code) => (
          <code
            key={code}
            style={{
              padding: "0.5rem",
              textAlign: "center",
              border: "1px solid rgba(212,175,55,0.35)",
              borderRadius: "0.5rem",
              fontSize: "1rem",
              letterSpacing: "0.08em",
            }}
          >
            {code}
          </code>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <Button size="sm" variant="secondary" onClick={() => void copyAll()}>
          {copied ? t("security.copied") : t("security.copyCodes")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => downloadRecoveryCodes(codes)}>
          {t("security.downloadCodes")}
        </Button>
      </div>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t("security.savedConfirm")}</span>
      </label>
      <button type="button" className="btn-gold" disabled={!saved} onClick={onDone}>
        {t("security.finish")}
      </button>
    </section>
  );
}

function ReauthModal({
  kind,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  kind: Exclude<ModalKind, null>;
  onClose: () => void;
  onSubmit: (payload: ReauthPayload) => void;
  pending: boolean;
  error: string | null;
}): React.ReactElement {
  const { t } = useI18n();
  const [password, setPassword] = React.useState("");
  const [factor, setFactor] = React.useState<"totp" | "recovery">("totp");
  const [value, setValue] = React.useState("");

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const payload: ReauthPayload = { password };
    if (factor === "totp") payload.code = value.trim();
    else payload.recovery_code = value.trim();
    onSubmit(payload);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={kind === "disable" ? t("security.disable") : t("security.regenerate")}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{kind === "disable" ? t("security.disable") : t("security.regenerate")}</h3>
        <p className="hint" style={{ marginBottom: "1rem" }}>
          {kind === "disable" ? t("security.disableHint") : t("security.regenerateHint")}
        </p>
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="reauth-password">{t("security.reauthPassword")}</label>
            <input
              id="reauth-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div className="field">
            <label htmlFor="reauth-factor">{t("security.reauthFactor")}</label>
            <select
              id="reauth-factor"
              className="input"
              value={factor}
              onChange={(e) => setFactor(e.target.value as "totp" | "recovery")}
              disabled={pending}
            >
              <option value="totp">{t("security.reauthTotp")}</option>
              <option value="recovery">{t("security.reauthRecovery")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="reauth-code">{t("security.reauthCode")}</label>
            <input
              id="reauth-code"
              className="input"
              dir="ltr"
              autoComplete="one-time-code"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="btn-gold" disabled={pending}>
              {pending ? t("security.working") : t("security.confirm")}
            </button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Security(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { mustEnroll2fa, completeEnrollment, recheckSession } = useAuth();
  const navigate = useNavigate();

  const statusQuery = useTwoFAStatus();
  const setupMutation = useSetup2FA();
  const enableMutation = useEnable2FA();
  const disableMutation = useDisable2FA();
  const regenerateMutation = useRegenerateRecoveryCodes();

  const [code, setCode] = React.useState("");
  const [freshCodes, setFreshCodes] = React.useState<string[] | null>(null);
  const [modal, setModal] = React.useState<ModalKind>(null);
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [disabledNotice, setDisabledNotice] = React.useState(false);
  const [secretCopied, setSecretCopied] = React.useState(false);

  const setup = setupMutation.data;
  const qrUrl = useQrDataUrl(setup?.provisioning_uri ?? null);
  const status = statusQuery.data;
  const enabled = status?.enabled ?? false;

  async function copySecret(): Promise<void> {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 2500);
    } catch {
      // ignore — secret stays visible for manual entry
    }
  }

  function handleEnable(e: React.FormEvent): void {
    e.preventDefault();
    if (!setup) return;
    enableMutation.mutate(
      { secret: setup.secret, code: code.trim() },
      {
        onSuccess: (data) => {
          setFreshCodes(data.recovery_codes);
          setCode("");
        },
      },
    );
  }

  async function handleCodesDone(): Promise<void> {
    setFreshCodes(null);
    setupMutation.reset();
    if (mustEnroll2fa) {
      // Rotate the restricted pair into a full-scope session, then enter.
      await completeEnrollment();
      navigate("/", { replace: true });
    } else {
      await statusQuery.refetch();
    }
  }

  function handleModalSubmit(payload: ReauthPayload): void {
    setModalError(null);
    if (modal === "disable") {
      disableMutation.mutate(payload, {
        onSuccess: async () => {
          setModal(null);
          setDisabledNotice(true);
          // A privileged operator who disables falls back into mandatory
          // enrollment — re-sync so the app routes accordingly.
          await recheckSession();
          await statusQuery.refetch();
        },
        onError: (err) => setModalError(errText(err)),
      });
    } else if (modal === "regenerate") {
      regenerateMutation.mutate(payload, {
        onSuccess: (data) => {
          setModal(null);
          setFreshCodes(data.recovery_codes);
        },
        onError: (err) => setModalError(errText(err)),
      });
    }
  }

  return (
    <div className="page" style={{ maxWidth: "900px" }}>
      <h1 style={{ marginTop: 0 }}>{t("security.title")}</h1>
      <p className="hint" style={{ marginBottom: "1.25rem" }}>
        {t("security.subtitle")}
      </p>

      {mustEnroll2fa && (
        <div className="form-error" role="alert" style={{ marginBottom: "1rem" }}>
          {t("security.enrollRequired")}
        </div>
      )}
      {disabledNotice && !mustEnroll2fa && (
        <div style={{ marginBottom: "1rem" }}>
          <Badge tone="success">{t("security.disabledOk")}</Badge>
        </div>
      )}

      {statusQuery.isLoading && <div className="empty">{t("common.loading")}</div>}
      {statusQuery.isError && (
        <div className="empty">
          <p>{t("common.error")}</p>
          <Button size="sm" variant="secondary" onClick={() => statusQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {status && freshCodes === null && (
        <section className="panel" aria-label={t("security.title")}>
          <div className="panel-head">
            <h2>{t("security.title")}</h2>
            <Badge tone={enabled ? "success" : "danger"}>
              {enabled ? t("security.statusEnabled") : t("security.statusDisabled")}
            </Badge>
          </div>
          {enabled && status.enrolled_at && (
            <p className="hint">
              {t("security.enrolledAt")}: {formatDate(status.enrolled_at)}
            </p>
          )}
          {enabled && (
            <p className="hint">
              {t("security.recoveryRemaining")}: {status.recovery_codes_remaining}
            </p>
          )}
        </section>
      )}

      {status && !enabled && freshCodes === null && (
        <section className="panel" aria-label={t("security.enableTitle")}>
          <div className="panel-head">
            <h2>{t("security.enableTitle")}</h2>
          </div>
          <p className="hint" style={{ marginBottom: "1rem" }}>
            {t("security.enableHint")}
          </p>
          {!setup && (
            <button
              type="button"
              className="btn-gold"
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
            >
              {setupMutation.isPending ? t("security.working") : t("security.startEnable")}
            </button>
          )}
          {setupMutation.isError && (
            <div className="form-error" role="alert" style={{ marginTop: "0.75rem" }}>
              {errText(setupMutation.error)}
            </div>
          )}
          {setup && (
            <form onSubmit={handleEnable}>
              <p className="hint">{t("security.scanHint")}</p>
              {qrUrl && (
                <img
                  src={qrUrl}
                  alt={t("security.scanHint")}
                  width={220}
                  height={220}
                  style={{ background: "#fff", borderRadius: "0.5rem", margin: "0.5rem 0" }}
                />
              )}
              <p className="hint">{t("security.manualSecret")}</p>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
                <code dir="ltr" style={{ fontSize: "1rem", letterSpacing: "0.06em" }}>
                  {setup.secret}
                </code>
                <Button type="button" size="sm" variant="secondary" onClick={() => void copySecret()}>
                  {secretCopied ? t("security.copied") : t("security.copy")}
                </Button>
              </div>
              <div className="field">
                <label htmlFor="enable-code">{t("security.codeLabel")}</label>
                <input
                  id="enable-code"
                  className="input"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  disabled={enableMutation.isPending}
                />
              </div>
              {enableMutation.isError && (
                <div className="form-error" role="alert">
                  {errText(enableMutation.error)}
                </div>
              )}
              <button type="submit" className="btn-gold" disabled={enableMutation.isPending}>
                {enableMutation.isPending ? t("security.working") : t("security.verifyEnable")}
              </button>
            </form>
          )}
        </section>
      )}

      {freshCodes !== null && (
        <RecoveryCodesPanel codes={freshCodes} onDone={() => void handleCodesDone()} />
      )}

      {status && enabled && freshCodes === null && (
        <section className="panel" aria-label={t("security.manageTitle")}>
          <div className="panel-head">
            <h2>{t("security.manageTitle")}</h2>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              onClick={() => {
                setModalError(null);
                setModal("regenerate");
              }}
            >
              {t("security.regenerate")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setModalError(null);
                setModal("disable");
              }}
            >
              {t("security.disable")}
            </Button>
          </div>
        </section>
      )}

      {modal !== null && (
        <ReauthModal
          kind={modal}
          onClose={() => setModal(null)}
          onSubmit={handleModalSubmit}
          pending={disableMutation.isPending || regenerateMutation.isPending}
          error={modalError}
        />
      )}
    </div>
  );
}
