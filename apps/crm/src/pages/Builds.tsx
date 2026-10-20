import React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@maturidi/ui-web";
import {
  BUILD_TARGETS,
  certExpiryInfo,
  errText,
  isRequestActive,
  useBuildRequests,
  usePrereqs,
  useRebuild,
  useReleases,
  type BuildTarget,
  type RebuildResult,
} from "../lib/ops14";
import { useI18n } from "../lib/i18n";

/**
 * Phase 14 — Track 3 (CRM): Build download center.
 *
 * - «نسخه‌ها»: releases per platform (Android/iOS/Desktop) with version,
 *   build number, signed status, build date and a signed-URL download button
 *   (§6; no download button when the backend reports no download_url).
 * - «بازسازی اپ‌ها»: confirmation modal (one platform per request — the
 *   backend contract) → POST /api/v1/admin/builds/rebuild → the returned
 *   signing readiness (signing_ready / missing_signing) is shown honestly,
 *   and the request is tracked in the requests table below (live-polling
 *   while any request is in flight).
 * - Prereqs panel: live per-platform signing readiness from
 *   GET /api/v1/admin/builds/prereqs (signing certs with expiry, red when
 *   < 30 days). Until the backend implements it, the four spec requirements
 *   render statically with an honest "unknown" state — a signed artifact is
 *   never claimed when `signed` is false.
 *
 * Renders only; all API access, parsing and polling live in lib/ops14.ts
 * (ADR-001).
 */

function RebuildModal({
  onClose,
  onConfirm,
  pending,
  t,
}: {
  onClose: () => void;
  onConfirm: (input: { platform: BuildTarget; version?: string; note?: string }) => void;
  pending: boolean;
  t: (p: string) => string;
}) {
  const [platform, setPlatform] = React.useState<BuildTarget>("android");
  const [version, setVersion] = React.useState("");
  const [note, setNote] = React.useState("");
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("builds14.rebuildTitle")}>
      <div className="modal-card">
        <h3>{t("builds14.rebuildTitle")}</h3>
        <p className="hint">{t("builds14.rebuildConfirm")}</p>
        <div className="field">
          <span className="field-label">{t("builds14.rebuildPlatform")}</span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {BUILD_TARGETS.map((p) => (
              <label key={p} className="sync-choice">
                <input
                  type="radio"
                  name="build-platform"
                  checked={platform === p}
                  onChange={() => setPlatform(p)}
                />
                {t(`builds14.platform_${p}`)}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="build-version">{t("builds14.rebuildVersion")}</label>
          <input
            id="build-version"
            dir="ltr"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.4.1"
          />
        </div>
        <div className="field">
          <label htmlFor="build-note">{t("builds14.rebuildNote")}</label>
          <input
            id="build-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("builds14.rebuildNotePlaceholder")}
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={pending}
            onClick={() =>
              onConfirm({
                platform,
                version: version.trim() || undefined,
                note: note.trim() || undefined,
              })
            }
          >
            {t("builds14.rebuildConfirmBtn")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RebuildResultPanel({ result }: { result: RebuildResult }) {
  const { t } = useI18n();
  return (
    <div className="conn-result ok" role="status" style={{ marginTop: "0.75rem" }}>
      <p style={{ margin: 0 }}>
        <Badge tone={result.signing_ready ? "success" : "warning"}>
          {result.signing_ready ? t("builds14.signingReady") : t("builds14.signingNotReady")}
        </Badge>
      </p>
      {result.missing_signing.length > 0 && (
        <p className="hint" style={{ margin: "0.4rem 0 0" }}>
          {t("builds14.missingSigning")}:{" "}
          <span dir="ltr">{result.missing_signing.join(", ")}</span>
        </p>
      )}
      <p className="hint" style={{ margin: "0.4rem 0 0" }}>
        {t("builds14.requestTracking")}
      </p>
    </div>
  );
}

function PrereqCertList() {
  const { t, formatDate } = useI18n();
  const prereqsQ = usePrereqs();

  if (prereqsQ.isLoading) return <p className="empty">{t("common.loading")}</p>;

  // Live data from the backend.
  if (prereqsQ.isSuccess) {
    const { signing, platforms } = prereqsQ.data;
    const certNames = Object.keys(signing);
    return (
      <>
        {Object.keys(platforms).length > 0 && (
          <ul className="build-prereqs" style={{ marginBottom: "1rem" }}>
            {Object.entries(platforms).map(([plat, p]) => (
              <li key={plat} className={p.ready ? "" : "missing"}>
                <span className="build-prereq-head">
                  <Badge tone={p.ready ? "success" : "danger"}>
                    {p.ready ? t("builds14.prereqPresent") : t("builds14.prereqMissing")}
                  </Badge>
                  <strong>{t(`builds14.platform_${plat}`)}</strong>
                </span>
                {p.missing.length > 0 && (
                  <span className="hint">
                    {t("builds14.missingSigning")}: <span dir="ltr">{p.missing.join(", ")}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <ul className="build-prereqs">
          {certNames.map((name) => {
            const c = signing[name];
            const expiry = certExpiryInfo(c.expires_at);
            return (
              <li key={name} className={c.present ? "" : "missing"}>
                <span className="build-prereq-head">
                  <Badge tone={c.present ? "success" : "danger"}>
                    {c.present ? t("builds14.prereqPresent") : t("builds14.prereqMissing")}
                  </Badge>
                  <strong>{t(`conn14.cert_${name}`)}</strong>
                  {c.expires_at && (
                    <Badge tone={expiry.urgent ? "danger" : "info"}>
                      {expiry.daysLeft != null && expiry.daysLeft >= 0
                        ? t("conn14.daysLeft").replace("{n}", String(expiry.daysLeft))
                        : t("conn14.expired")}
                    </Badge>
                  )}
                </span>
                {c.expires_at ? (
                  <span className="hint">
                    {t("conn14.expiresAt")}: {formatDate(c.expires_at)}
                  </span>
                ) : (
                  !c.present && <span className="hint">{t("builds14.prereqGithubSecret")}</span>
                )}
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  // Honest static fallback until the backend implements /prereqs.
  return (
    <>
      <p className="hint">{t("builds14.prereqsStaticNote")}</p>
      <ul className="build-prereqs">
        {(["apple_developer", "google_play", "cafebazaar", "desktop_certs"] as const).map((id) => (
          <li key={id}>
            <span className="build-prereq-head">
              <Badge tone="neutral">{t("builds14.prereqUnknown")}</Badge>
              <strong>{t(`builds14.prereq_${id}`)}</strong>
            </span>
            <span className="hint">{t(`builds14.prereq_${id}_guidance`)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Builds(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const releasesQ = useReleases();
  const requestsQ = useBuildRequests();
  const rebuildMut = useRebuild();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<RebuildResult | null>(null);

  const requests = requestsQ.data ?? [];
  const polling = requests.some((r) => isRequestActive(r.status));

  const confirmRebuild = (input: { platform: BuildTarget; version?: string; note?: string }) => {
    rebuildMut.mutate(input, {
      onSuccess: (res) => {
        setModalOpen(false);
        setLastResult(res);
      },
    });
  };

  return (
    <div className="page">
      <h1>{t("builds14.title")}</h1>
      <p className="hint">{t("builds14.hint")}</p>

      {/* rebuild action */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          {t("builds14.rebuild")}
        </Button>
        {rebuildMut.isError && (
          <p className="hint" role="alert" style={{ margin: 0 }}>
            {errText(rebuildMut.error)}
          </p>
        )}
      </div>
      {lastResult && <RebuildResultPanel result={lastResult} />}

      {/* releases table */}
      <Card style={{ marginTop: "1rem" }}>
        <CardHeader>
          <CardTitle>{t("builds14.releasesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {releasesQ.isLoading && <p className="empty">{t("common.loading")}</p>}
          {releasesQ.isError && (
            <div className="empty-state">
              <h3>{t("builds14.backendMissingTitle")}</h3>
              <p>{t("builds14.backendMissing")}</p>
              <p className="hint">
                <code dir="ltr">GET /api/v1/admin/builds/releases</code> — {errText(releasesQ.error)}
              </p>
              <Button variant="secondary" onClick={() => void releasesQ.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {releasesQ.isSuccess &&
            (releasesQ.data.length === 0 ? (
              <p className="empty">{t("builds14.noReleases")}</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("builds14.colPlatform")}</th>
                    <th>{t("builds14.colVersion")}</th>
                    <th>{t("builds14.colSigned")}</th>
                    <th>{t("builds14.colBuildDate")}</th>
                    <th>{t("builds14.colDownload")}</th>
                  </tr>
                </thead>
                <tbody>
                  {releasesQ.data.map((r) => (
                    <tr key={r.id}>
                      <td>{t(`builds14.platform_${r.platform}`)}</td>
                      <td>
                        <code dir="ltr">{r.version}</code>
                        {r.build_number && (
                          <span className="hint"> ({r.build_number})</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={r.signed ? "success" : "warning"}>
                          {r.signed ? t("builds14.signed") : t("builds14.unsigned")}
                        </Badge>
                      </td>
                      <td>{r.created_at ? formatDate(r.created_at) : "—"}</td>
                      <td>
                        {r.download_url ? (
                          <>
                            <a
                              href={r.download_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="build-download"
                            >
                              {t("builds14.download")}
                            </a>
                            {r.download_expires_at && (
                              <span className="hint">
                                {" "}
                                ({t("builds14.urlExpires")}: {formatDate(r.download_expires_at)})
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="hint">{t("builds14.noDownload")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          {releasesQ.isSuccess && releasesQ.data.some((r) => !r.signed) && (
            <p className="hint">{t("builds14.unsignedHint")}</p>
          )}
        </CardContent>
      </Card>

      {/* rebuild requests (live tracking) */}
      <Card style={{ marginTop: "1rem" }}>
        <CardHeader>
          <CardTitle>
            {t("builds14.requestsTitle")}
            {polling && <span className="hint"> — {t("builds14.jobPolling")}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requestsQ.isLoading && <p className="empty">{t("common.loading")}</p>}
          {requestsQ.isError && <p className="empty">{errText(requestsQ.error)}</p>}
          {requestsQ.isSuccess &&
            (requests.length === 0 ? (
              <p className="empty">{t("builds14.noRequests")}</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("builds14.colPlatform")}</th>
                    <th>{t("builds14.colVersion")}</th>
                    <th>{t("builds14.colReqStatus")}</th>
                    <th>{t("builds14.colCreated")}</th>
                    <th>{t("builds14.colFinished")}</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{t(`builds14.platform_${r.platform}`)}</td>
                      <td>
                        <code dir="ltr">{r.version ?? "—"}</code>
                      </td>
                      <td>
                        <Badge tone={isRequestActive(r.status) ? "info" : "neutral"}>
                          {t(`builds14.reqStatus_${r.status}`) !== `builds14.reqStatus_${r.status}`
                            ? t(`builds14.reqStatus_${r.status}`)
                            : r.status}
                        </Badge>
                        {r.note && <span className="hint"> — {r.note}</span>}
                      </td>
                      <td>{r.created_at ? formatDate(r.created_at) : "—"}</td>
                      <td>{r.finished_at ? formatDate(r.finished_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </CardContent>
      </Card>

      {/* signing prerequisites */}
      <Card style={{ marginTop: "1rem" }}>
        <CardHeader>
          <CardTitle>{t("builds14.prereqsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="hint" style={{ marginTop: 0 }}>{t("builds14.prereqsHint")}</p>
          <PrereqCertList />
        </CardContent>
      </Card>

      {modalOpen && (
        <RebuildModal
          onClose={() => setModalOpen(false)}
          onConfirm={confirmRebuild}
          pending={rebuildMut.isPending}
          t={t}
        />
      )}
    </div>
  );
}
