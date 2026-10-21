import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { Needs2FAError, useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { LoginParticles } from "../components/LoginParticles";

/**
 * Login — turbo "vault" visual (LoginParticles atmosphere, glass cartouche,
 * rotating light) on OUR auth flow: identifier + password, TOTP second step
 * when the backend demands it (contract §2), recovery handled by the API.
 */

export default function Login(): React.ReactElement {
  const { user, loading, login, mustEnroll2fa } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState("");
  const [need2fa, setNeed2fa] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }
  if (!loading && mustEnroll2fa) {
    // Restricted-scope session: enrollment on the Security page is the
    // only way forward (contract §2).
    return <Navigate to="/settings/security" replace />;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier.trim(), password, need2fa ? totpCode.trim() : undefined);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof Needs2FAError) {
        setNeed2fa(true);
        setError(t("login.need2fa"));
      } else if (err instanceof ApiError) {
        if (err.code === "invalid_credentials") setError(t("login.errorInvalid"));
        else if (err.code === "rate_limited") setError(t("login.errorRate"));
        else setError(t("login.errorUnknown"));
      } else {
        setError(t("login.errorUnknown"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="vault-page">
      <LoginParticles />
      <main className="login-wrap">
        <div className="login-cartouche">
          <span className="login-light" aria-hidden="true" />
          <span className="login-logo-wrap" aria-hidden="true">
            <span className="login-mark" aria-hidden="true">
              {t("app.mark")}
            </span>
            <img
              src="/brand/logo.jpg"
              alt=""
              className="login-logo"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </span>
          <h1 className="login-title">{t("login.title")}</h1>
          <p className="login-sub">{t("login.subtitle")}</p>

          <form onSubmit={handleSubmit}>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <div className="field">
              <label htmlFor="identifier">{t("login.identifier")}</label>
              <input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t("login.password")}</label>
              <div className="pw-field">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="pw-eye"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? t("login.hidePassword") : t("login.showPassword")}
                  title={showPw ? t("login.hidePassword") : t("login.showPassword")}
                >
                  {showPw ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M3 3l18 18M10.6 10.6a2.5 2.5 0 003.5 3.5M6.7 6.9C4.9 8.2 3.4 10 2.5 12c1.7 3.7 5.3 6 9.5 6 1.8 0 3.4-.4 4.9-1.1M12 6c4.2 0 7.8 2.3 9.5 6-.5 1.1-1.2 2.1-2 3" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M2.5 12C4.2 8.3 7.8 6 12 6s7.8 2.3 9.5 6c-1.7 3.7-5.3 6-9.5 6s-7.8-2.3-9.5-6z" />
                      <circle cx="12" cy="12" r="2.6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {need2fa && (
              <div className="field totp-box slide-in">
                <label htmlFor="totp">{t("login.totp")}</label>
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            )}
            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? t("login.submitting") : t("login.submit")}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
