import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  certExpiryInfo,
  errText,
  useConnections,
  useTestConnection,
  type ConnectionKey,
  type SigningCert,
} from "../lib/ops14";
import { useI18n } from "../lib/i18n";

/**
 * Phase 14 — Track 3 (CRM): External connections dashboard.
 *
 * One glance per external dependency, from GET /api/v1/admin/connections/status:
 * AI (configured? providers), SMS (configured? provider/sender), Telegram
 * (connected? which account — from the Phase-11 session), payment gateway
 * (honestly «پیکربندی نشده — فاز ۱۵»), maps (OSM + Neshan), and the five
 * signing certificates (uploaded? expiry — red when < 30 days).
 *
 * Every test button calls POST /api/v1/admin/connections/test/{service}
 * (spinner → success/fail with the returned message); the backend writes the
 * audit record server-side (§14). No secret value is ever displayed (§3).
 *
 * This component only renders; all API access, parsing and date math live
 * in lib/ops14.ts (ADR-001).
 */

function TestResultLine({
  ok,
  message,
  t,
}: {
  ok: boolean;
  message: string;
  t: (p: string) => string;
}) {
  return (
    <p className={`conn-result ${ok ? "ok" : "fail"}`} role="status">
      <strong>{ok ? t("conn14.testOk") : t("conn14.testFailed")}: </strong>
      {message}
    </p>
  );
}

function ServiceCard({
  connKey,
  children,
}: {
  connKey: ConnectionKey;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Card className="conn-card">
      <CardHeader>
        <CardTitle>{t(`conn14.svc_${connKey}`)}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Test button + result line shared by the service cards that support testing. */
function TestButton({
  connKey,
  phone,
  disabled,
}: {
  connKey: ConnectionKey;
  phone?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const testMut = useTestConnection();
  const label =
    connKey === "sms"
      ? t("conn14.testSms")
      : connKey === "payment"
        ? t("conn14.testTransaction")
        : connKey === "telegram"
          ? t("conn14.testConnection")
          : t("conn14.testCall");

  return (
    <div>
      <Button
        variant="secondary"
        loading={testMut.isPending}
        disabled={disabled || testMut.isPending}
        onClick={() => testMut.mutate({ service: connKey, phone })}
      >
        {label}
      </Button>
      {testMut.isSuccess && (
        <TestResultLine ok={testMut.data.ok} message={testMut.data.message} t={t} />
      )}
      {testMut.isError && (
        <TestResultLine ok={false} message={errText(testMut.error)} t={t} />
      )}
    </div>
  );
}

function SigningCertRow({ cert }: { cert: SigningCert }) {
  const { t, formatDate } = useI18n();
  const expiry = certExpiryInfo(cert.expires_at);
  const label = t(`conn14.cert_${cert.name}`);
  return (
    <li className={cert.uploaded ? "" : "missing"}>
      <span className="build-prereq-head">
        <Badge tone={cert.uploaded ? "success" : "neutral"}>
          {cert.uploaded ? t("conn14.uploaded") : t("conn14.notUploaded")}
        </Badge>
        <strong>{label === `conn14.cert_${cert.name}` ? cert.name : label}</strong>
        {cert.expires_at && (
          <Badge tone={expiry.urgent ? "danger" : "info"}>
            {expiry.daysLeft != null && expiry.daysLeft >= 0
              ? t("conn14.daysLeft").replace("{n}", String(expiry.daysLeft))
              : t("conn14.expired")}
          </Badge>
        )}
      </span>
      {cert.expires_at ? (
        <span className="hint">
          {t("conn14.expiresAt")}: {formatDate(cert.expires_at)}
          {expiry.urgent && expiry.daysLeft != null && expiry.daysLeft >= 0 && (
            <> — {t("conn14.expiringSoon")}</>
          )}
        </span>
      ) : (
        cert.uploaded && <span className="hint">{t("conn14.noExpiry")}</span>
      )}
    </li>
  );
}

export default function Connections(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const query = useConnections();
  const [smsPhone, setSmsPhone] = React.useState("");

  const st = query.data;
  const readyCount = st
    ? [st.ai.configured, st.sms.configured, st.telegram.connected, st.maps.neshanConfigured]
        .filter(Boolean).length
    : 0;

  const aiDetail = st?.ai.providers.length
    ? st.ai.providers.map((p) => `${p.provider}/${p.model}${p.is_fallback ? " (fallback)" : ""}`).join(", ")
    : st?.ai.model;

  return (
    <div className="page">
      <h1>{t("conn14.title")}</h1>
      <p className="hint">{t("conn14.hint")}</p>

      {query.isLoading && <p className="empty">{t("common.loading")}</p>}

      {query.isError && (
        <div className="empty-state">
          <h3>{t("conn14.backendMissingTitle")}</h3>
          <p>{t("conn14.backendMissing")}</p>
          <p className="hint">
            <code dir="ltr">GET /api/v1/admin/connections/status</code> — {errText(query.error)}
          </p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {query.isSuccess && st && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("conn14.summary").replace("{ready}", String(readyCount)).replace("{total}", "4")}
            {st.checked_at && (
              <> — {t("conn14.lastChecked")}: {formatDate(st.checked_at)}</>
            )}
          </p>
          <div className="conn-grid">
            {/* AI */}
            <ServiceCard connKey="ai">
              <p>
                <Badge tone={st.ai.configured ? "success" : "neutral"}>
                  {st.ai.configured ? t("conn14.configured") : t("conn14.notConfigured")}
                </Badge>
              </p>
              {aiDetail && <p className="hint" dir="ltr">{aiDetail}</p>}
              <TestButton connKey="ai" />
            </ServiceCard>

            {/* SMS */}
            <ServiceCard connKey="sms">
              <p>
                <Badge tone={st.sms.configured ? "success" : "neutral"}>
                  {st.sms.configured ? t("conn14.configured") : t("conn14.notConfigured")}
                </Badge>
              </p>
              {(st.sms.provider || st.sms.sender) && (
                <p className="hint" dir="ltr">
                  {[st.sms.provider, st.sms.sender].filter(Boolean).join(" · ")}
                </p>
              )}
              {!st.sms.configured && <p className="hint">{t("conn14.smsNotConfigured")}</p>}
              <div className="field">
                <label htmlFor="conn-sms-phone">{t("conn14.phoneLabel")}</label>
                <input
                  id="conn-sms-phone"
                  dir="ltr"
                  type="tel"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                  placeholder={t("conn14.phonePlaceholder")}
                  disabled={!st.sms.configured}
                />
              </div>
              <TestButton
                connKey="sms"
                phone={smsPhone.trim() || undefined}
                disabled={!st.sms.configured || smsPhone.trim() === ""}
              />
            </ServiceCard>

            {/* Telegram */}
            <ServiceCard connKey="telegram">
              <p>
                <Badge tone={st.telegram.connected ? "success" : "neutral"}>
                  {st.telegram.connected ? t("conn14.connected") : t("conn14.notConnected")}
                </Badge>
              </p>
              {st.telegram.account && (
                <p className="hint">
                  {t("conn14.account")}: <strong dir="ltr">{st.telegram.account}</strong>
                </p>
              )}
              {st.telegram.channel && (
                <p className="hint">
                  {t("conn14.tgChannel")}: <strong dir="ltr">{st.telegram.channel}</strong>
                </p>
              )}
              <TestButton connKey="telegram" disabled={!st.telegram.connected} />
            </ServiceCard>

            {/* Payment gateway — honest about Phase 15 */}
            <ServiceCard connKey="payment">
              <p>
                <Badge tone="warning">{t("conn14.paymentPhase15")}</Badge>
              </p>
              {st.payment.note && <p className="hint">{st.payment.note}</p>}
              <p className="hint">{t("conn14.paymentHint")}</p>
              <TestButton connKey="payment" disabled />
            </ServiceCard>

            {/* Maps */}
            <ServiceCard connKey="maps">
              <p>
                <Badge tone={st.maps.neshanConfigured ? "success" : "neutral"}>
                  {st.maps.neshanConfigured
                    ? `${t("conn14.configured")} (Neshan)`
                    : t("conn14.mapsOsmOnly")}
                </Badge>
              </p>
              {st.maps.osmNote && <p className="hint">{st.maps.osmNote}</p>}
              <TestButton connKey="maps" />
            </ServiceCard>
          </div>

          {/* Signing certificates */}
          <Card style={{ marginTop: "1rem" }}>
            <CardHeader>
              <CardTitle>{t("conn14.svc_signing")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="hint" style={{ marginTop: 0 }}>{t("conn14.signingHint")}</p>
              <ul className="build-prereqs">
                {st.signing.map((c) => (
                  <SigningCertRow key={c.name} cert={c} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
