import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import { ApiError } from "../lib/api";
import { Needs2FAError, useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";

export default function Login(): React.ReactElement {
  const { user, loading, login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totpCode, setTotpCode] = React.useState("");
  const [need2fa, setNeed2fa] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!loading && user) {
    return <Navigate to="/" replace />;
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <Card style={{ width: "min(420px, 100%)" }}>
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor="identifier">{t("login.identifier")}</label>
              <input
                id="identifier"
                className="input"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t("login.password")}</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            {need2fa && (
              <div className="field">
                <label htmlFor="totp">{t("login.totp")}</label>
                <input
                  id="totp"
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
            )}
            <Button type="submit" loading={submitting} style={{ width: "100%" }}>
              {submitting ? t("login.submitting") : t("login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
