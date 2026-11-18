/**
 * Phase C — CRM users dashboard + 360° detail.
 *
 * Dashboard: stats header, search + status/country/profile filters,
 * sortable table (registered / last activity) with each user's country,
 * registration IP + device/browser and last-activity IP + device/browser.
 * Clicking a row opens the 360° detail: identity & registration, sessions
 * (IP/device/browser/time), activity stats, donations, hifz, audit trail,
 * role management and session revocation.
 * Presentational only — data lives in lib/admin14.ts + lib/admin14Hooks.ts.
 */

import React from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { errText } from "../lib/admin14";
import type { DashboardDevice, DashboardUserRow } from "../lib/admin14";
import {
  useUser360,
  useUserAdminMutation,
  useUserAuditTrail,
  useUsersDashboard,
  useUsersStats,
} from "../lib/admin14Hooks";
import { COUNTRIES, countryFlag, countryNameFa } from "../lib/countries";
import { KpiTile } from "../components/KpiTile";

const PAGE_SIZE = 20;

function Stat({ label, value }: { label: string; value: number | string }): React.ReactElement {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Pref({ label, on }: { label: string; on: boolean }): React.ReactElement {
  return (
    <span className={`badge tone-${on ? "ok" : "muted"}`}>
      {label}: {on ? "✓" : "—"}
    </span>
  );
}

type TFn = (key: string) => string;

function deviceLabel(t: TFn, device: string): string {
  switch (device) {
    case "mobile":
      return t("admin14.deviceMobile");
    case "tablet":
      return t("admin14.deviceTablet");
    case "desktop":
      return t("admin14.deviceDesktop");
    case "bot":
      return t("admin14.deviceBot");
    default:
      return t("admin14.deviceUnknown");
  }
}

/** IP + browser/OS summary + device class, stacked (table cell / detail). */
function DeviceInfo({
  t,
  d,
  showRaw = false,
}: {
  t: TFn;
  d: DashboardDevice | null;
  showRaw?: boolean;
}): React.ReactElement {
  if (!d) return <span className="hint">—</span>;
  return (
    <div>
      <div>
        {d.summary ?? "—"}{" "}
        <span className="badge tone-muted">{deviceLabel(t, d.device)}</span>
      </div>
      {d.ip && <div className="hint mono">{d.ip}</div>}
      {showRaw && d.user_agent && (
        <div className="hint mono" style={{ wordBreak: "break-all" }}>
          {d.user_agent}
        </div>
      )}
    </div>
  );
}

function StatusBadges({ t, row }: { t: TFn; row: DashboardUserRow }): React.ReactElement {
  return (
    <div className="row" style={{ gap: "0.25rem", flexWrap: "wrap" }}>
      {row.registration_status === "pending" ? (
        <span className="badge tone-warn">{t("admin14.badgePending")}</span>
      ) : (
        <span className="badge tone-ok">{t("admin14.badgeCompleted")}</span>
      )}
      {row.is_verified ? (
        <span className="badge tone-info">{t("admin14.badgeVerified")}</span>
      ) : (
        <span className="badge tone-muted">{t("admin14.badgeUnverified")}</span>
      )}
      {row.profile_complete ? (
        <span className="badge tone-ok">{t("admin14.fProfileComplete")}</span>
      ) : (
        <span className="badge tone-muted">{t("admin14.fProfileIncomplete")}</span>
      )}
      {!row.is_active && <span className="badge tone-danger">inactive</span>}
    </div>
  );
}

export default function User360({ initialUserId = null }: { initialUserId?: string | null } = {}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { hasPermission, isSuperAdmin } = useAuth();
  const [userId, setUserId] = React.useState<string | null>(initialUserId);

  // ---- dashboard state ----
  const [query, setQuery] = React.useState("");
  const [appliedQuery, setAppliedQuery] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [profileFilter, setProfileFilter] = React.useState("");
  const [sort, setSort] = React.useState("created_at");
  const [order, setOrder] = React.useState("desc");
  const [page, setPage] = React.useState(0);

  const stats = useUsersStats();
  const dash = useUsersDashboard({
    q: appliedQuery || undefined,
    status: status || undefined,
    profile: profileFilter || undefined,
    country: country || undefined,
    sort,
    order,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // ---- detail state ----
  const profile = useUser360(userId);
  const audit = useUserAuditTrail(userId);
  const mut = useUserAdminMutation();
  const [rolesDraft, setRolesDraft] = React.useState("");
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);

  React.useEffect(() => {
    if (profile.data) setRolesDraft(profile.data.roles.join(", "));
  }, [profile.data]);

  const canManage = hasPermission("users.view360");
  const totalPages = Math.max(1, Math.ceil((dash.data?.total ?? 0) / PAGE_SIZE));

  const toggleSort = (key: string): void => {
    if (sort === key) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(key);
      setOrder("desc");
    }
    setPage(0);
  };
  const sortMark = (key: string): string => (sort === key ? (order === "desc" ? " ↓" : " ↑") : "");

  /* ------------------------------ detail ------------------------------ */
  if (userId) {
    return (
      <div className="page" style={{ maxWidth: "1100px" }}>
        <button type="button" className="btn" onClick={() => setUserId(null)}>
          ← {t("admin14.backToList")}
        </button>
        <h1>{t("admin14.userTitle")}</h1>

        {profile.isLoading && <p className="hint">{t("common.loading")}</p>}
        {profile.isError && (
          <div className="panel" role="alert">
            <p>{t("admin14.backendMissing")}</p>
            <p className="hint">{errText(profile.error)}</p>
            <button type="button" className="btn" onClick={() => void profile.refetch()}>
              {t("common.retry")}
            </button>
          </div>
        )}

        {profile.data && (
          <>
            <section className="panel" aria-label={t("admin14.uProfile")}>
              <div className="row">
                <h2 style={{ margin: 0 }}>{profile.data.display_name}</h2>
                <span className="badge tone-info">{profile.data.status}</span>
                {profile.data.registration_status === "pending" ? (
                  <span className="badge tone-warn">{t("admin14.badgePending")}</span>
                ) : (
                  <span className="badge tone-ok">{t("admin14.badgeCompleted")}</span>
                )}
                {profile.data.profile_complete ? (
                  <span className="badge tone-ok">{t("admin14.fProfileComplete")}</span>
                ) : (
                  <span className="badge tone-muted">{t("admin14.fProfileIncomplete")}</span>
                )}
              </div>
              <dl className="def-list">
                <div>
                  <dt>email</dt>
                  <dd className="mono">{profile.data.email}</dd>
                </div>
                <div>
                  <dt>{t("admin14.uPhone")}</dt>
                  <dd className="mono">{profile.data.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("admin14.uCreated")}</dt>
                  <dd>{profile.data.created_at ? formatDate(profile.data.created_at) : "—"}</dd>
                </div>
                <div>
                  <dt>{t("admin14.uLastActive")}</dt>
                  <dd>
                    {profile.data.sessions[0]?.last_active_at
                      ? formatDate(profile.data.sessions[0].last_active_at)
                      : profile.data.last_active_at
                        ? formatDate(profile.data.last_active_at)
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{t("admin14.uLocale")}</dt>
                  <dd className="mono">{profile.data.locale}</dd>
                </div>
                <div>
                  <dt>{t("admin14.uDob")}</dt>
                  <dd>{profile.data.date_of_birth ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("admin14.uGender")}</dt>
                  <dd>
                    {profile.data.gender === "male"
                      ? t("admin14.genderMale")
                      : profile.data.gender === "female"
                        ? t("admin14.genderFemale")
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{t("admin14.uCountry")}</dt>
                  <dd>
                    {profile.data.country_code
                      ? `${countryFlag(profile.data.country_code)} ${countryNameFa(profile.data.country_code)}`
                      : "—"}
                    {profile.data.country_source === "phone" && (
                      <span className="hint"> ({t("admin14.countryFromPhone")})</span>
                    )}
                  </dd>
                </div>
              </dl>
              {!profile.data.profile_complete && profile.data.missing_profile_fields.length > 0 && (
                <p className="hint">
                  {t("admin14.uMissing")}: {profile.data.missing_profile_fields.join("، ")}
                </p>
              )}
              <div className="row" style={{ marginTop: "0.5rem" }}>
                <strong>{t("admin14.uPrefs")}:</strong>
                <Pref label="email" on={profile.data.notification_preferences.email} />
                <Pref label="sms" on={profile.data.notification_preferences.sms} />
                <Pref label="push" on={profile.data.notification_preferences.push} />
                <Pref label="in_app" on={profile.data.notification_preferences.in_app} />
              </div>
            </section>

            <section className="panel" aria-label={t("admin14.uRegDevice")}>
              <h3>{t("admin14.uRegDevice")}</h3>
              <DeviceInfo t={t} d={profile.data.registration} showRaw />
              {profile.data.registration?.at && (
                <p className="hint">{formatDate(profile.data.registration.at)}</p>
              )}
            </section>

            <section className="panel" aria-label={t("admin14.uSessions")}>
              <h3>{t("admin14.uSessions")}</h3>
              {profile.data.sessions.length === 0 && <p className="hint">—</p>}
              {profile.data.sessions.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t("admin14.colDevice")}</th>
                        <th>{t("admin14.colIp")}</th>
                        <th>{t("admin14.uCreated")}</th>
                        <th>{t("admin14.uLastActive")}</th>
                        <th>{t("admin14.colState")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.data.sessions.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.summary ?? "—"}{" "}
                            <span className="badge tone-muted">{deviceLabel(t, s.device)}</span>
                            {s.user_agent && (
                              <div className="hint mono" style={{ wordBreak: "break-all" }}>
                                {s.user_agent}
                              </div>
                            )}
                          </td>
                          <td className="mono">{s.ip ?? "—"}</td>
                          <td>{s.created_at ? formatDate(s.created_at) : "—"}</td>
                          <td>{s.last_active_at ? formatDate(s.last_active_at) : "—"}</td>
                          <td>
                            {s.state === "revoked" ? (
                              <span className="badge tone-danger">{t("admin14.stateRevoked")}</span>
                            ) : (
                              <span className="badge tone-ok">{t("admin14.stateActive")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="card-grid">
              <section className="panel">
                <h3>{t("admin14.uLms")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statEnrolled")} value={profile.data.lms_progress.enrolled} />
                  <Stat label={t("admin14.statCompleted")} value={profile.data.lms_progress.completed} />
                  <Stat label={t("admin14.statCertificates")} value={profile.data.lms_progress.certificates} />
                  <Stat label={t("admin14.statXp")} value={profile.data.lms_progress.xp} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uLibrary")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statCheckouts")} value={profile.data.library_activity.checkouts} />
                  <Stat label={t("admin14.statBookmarks")} value={profile.data.library_activity.bookmarks} />
                  <Stat label={t("admin14.statUploads")} value={profile.data.library_activity.uploads} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uSocial")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statPosts")} value={profile.data.social_activity.posts} />
                  <Stat label={t("admin14.statComments")} value={profile.data.social_activity.comments} />
                  <Stat label={t("admin14.statReportsFiled")} value={profile.data.social_activity.reports_filed} />
                  <Stat label={t("admin14.statReportsReceived")} value={profile.data.social_activity.reports_received} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uFatwa")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statQuestions")} value={profile.data.fatwa_activity.questions} />
                  <Stat label={t("admin14.statAnswers")} value={profile.data.fatwa_activity.answers} />
                  <Stat label={t("admin14.statSubmissions")} value={profile.data.fatwa_activity.submissions} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uDonations")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statDonationCount")} value={profile.data.donations.count} />
                  <Stat
                    label={t("admin14.statDonationTotal")}
                    value={profile.data.donations.total_succeeded_irr.toLocaleString()}
                  />
                </div>
                {profile.data.donations.recent.length > 0 && (
                  <ul className="compact-list">
                    {profile.data.donations.recent.map((d) => (
                      <li key={d.id}>
                        <span className="mono">{d.amount.toLocaleString()} {d.currency}</span>{" "}
                        <span className="badge tone-muted">{d.status}</span>{" "}
                        <span className="hint">{d.created_at ? formatDate(d.created_at) : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="panel">
                <h3>{t("admin14.uHifz")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statAttempts")} value={profile.data.hifz.attempts} />
                  <Stat label={t("admin14.statTests")} value={profile.data.hifz.tests} />
                  <Stat label={t("admin14.statTasmi")} value={profile.data.hifz.tasmi_sessions} />
                </div>
                {profile.data.hifz.recent_attempts.length > 0 && (
                  <ul className="compact-list">
                    {profile.data.hifz.recent_attempts.map((a) => (
                      <li key={a.id}>
                        <span className="hint">سوره {a.surah}</span>{" "}
                        <span className="badge tone-muted">{a.status}</span>{" "}
                        <span className="hint">{a.created_at ? formatDate(a.created_at) : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="panel">
              <h3>{t("admin14.uRecentNotif")}</h3>
              {profile.data.recent_notifications.length === 0 && <p className="hint">—</p>}
              <ul className="compact-list">
                {profile.data.recent_notifications.map((n) => (
                  <li key={n.id}>
                    <span className={`badge tone-${n.read ? "muted" : "info"}`}>{n.channel}</span> {n.title}{" "}
                    <span className="hint">{formatDate(n.sent_at)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h3>{t("admin14.uAuditTrail")}</h3>
              {audit.isLoading && <p className="hint">{t("common.loading")}</p>}
              {(audit.data ?? []).length === 0 && !audit.isLoading && <p className="hint">—</p>}
              <ul className="compact-list">
                {(audit.data ?? []).map((a) => (
                  <li key={a.id}>
                    <code>{a.action}</code> <span className="hint">{a.entity_type}/{a.entity_id}</span>{" "}
                    {a.ip && <span className="hint mono">{a.ip}</span>}{" "}
                    <span className="hint">{a.created_at ? formatDate(a.created_at) : ""}</span>
                  </li>
                ))}
              </ul>
            </section>

            {canManage && (
              <section className="panel">
                <h3>{t("admin14.uSetRoles")}</h3>
                <div className="row">
                  <input
                    value={rolesDraft}
                    onChange={(e) => setRolesDraft(e.target.value)}
                    placeholder="admin, moderator"
                    aria-label={t("admin14.uRoles")}
                    style={{ flex: 1 }}
                    disabled={!isSuperAdmin}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!isSuperAdmin || mut.setRoles.isPending}
                    onClick={() =>
                      mut.setRoles.mutate({
                        id: userId,
                        roles: rolesDraft.split(",").map((r) => r.trim()).filter(Boolean),
                      })
                    }
                  >
                    {t("common.save")}
                  </button>
                </div>
                {mut.setRoles.isSuccess && <p className="ok-text">{t("admin14.uRolesSaved")}</p>}
                {mut.setRoles.isError && <p className="error-text">{errText(mut.setRoles.error)}</p>}

                <div className="row" style={{ marginTop: "0.75rem" }}>
                  {!confirmRevoke ? (
                    <button type="button" className="btn danger" onClick={() => setConfirmRevoke(true)}>
                      {t("admin14.uRevokeSessions")}
                    </button>
                  ) : (
                    <>
                      <span>{t("admin14.uRevokeConfirm")}</span>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={mut.revokeSessions.isPending}
                        onClick={() =>
                          mut.revokeSessions.mutate(userId, { onSuccess: () => setConfirmRevoke(false) })
                        }
                      >
                        {t("admin14.uRevokeSessions")}
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmRevoke(false)}>
                        {t("common.cancel")}
                      </button>
                    </>
                  )}
                </div>
                {mut.revokeSessions.isSuccess && <p className="ok-text">{t("admin14.uRevokeDone")}</p>}
                {mut.revokeSessions.isError && <p className="error-text">{errText(mut.revokeSessions.error)}</p>}
              </section>
            )}
          </>
        )}
      </div>
    );
  }

  /* ----------------------------- dashboard ----------------------------- */
  return (
    <div className="page" style={{ maxWidth: "1200px" }}>
      <h1>{t("admin14.dashTitle")}</h1>
      <p className="hint">{t("admin14.dashHint")}</p>

      {stats.data && (
        <div className="kpi-grid">
          <KpiTile label={t("admin14.statTotalUsers")} value={String(stats.data.total_users)} accent="#7dd3fc" />
          <KpiTile label={t("admin14.statVerified")} value={String(stats.data.verified)} accent="#4ade80" />
          <KpiTile label={t("admin14.statPending")} value={String(stats.data.pending)} accent="#fbbf24" />
          <KpiTile label={t("admin14.statProfileComplete")} value={String(stats.data.profile_complete)} accent="#c084fc" />
        </div>
      )}

      <section className="panel" aria-label={t("admin14.userSearch")}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            type="search"
            value={query}
            placeholder={t("admin14.fSearchPh")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setAppliedQuery(query);
                setPage(0);
              }
            }}
            style={{ flex: 2, minWidth: "180px" }}
            aria-label={t("admin14.userSearch")}
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            aria-label={t("admin14.colStatus")}
          >
            <option value="">{t("admin14.fStatusAll")}</option>
            <option value="pending">{t("admin14.fStatusPending")}</option>
            <option value="completed">{t("admin14.fStatusCompleted")}</option>
          </select>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setPage(0);
            }}
            aria-label={t("admin14.colCountry")}
          >
            <option value="">{t("admin14.fCountryAll")}</option>
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {countryFlag(c.iso)} {c.nameFa}
              </option>
            ))}
          </select>
          <select
            value={profileFilter}
            onChange={(e) => {
              setProfileFilter(e.target.value);
              setPage(0);
            }}
            aria-label={t("admin14.uProfile")}
          >
            <option value="">{t("admin14.fProfileAll")}</option>
            <option value="complete">{t("admin14.fProfileComplete")}</option>
            <option value="incomplete">{t("admin14.fProfileIncomplete")}</option>
          </select>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setAppliedQuery(query);
              setPage(0);
            }}
          >
            {t("admin14.search")}
          </button>
        </div>
      </section>

      {dash.isLoading && <p className="hint">{t("common.loading")}</p>}
      {dash.isError && (
        <div className="panel" role="alert">
          <p className="error-text">{errText(dash.error)}</p>
          <button type="button" className="btn" onClick={() => void dash.refetch()}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {dash.data && dash.data.items.length === 0 && <p className="hint">{t("admin14.dashEmpty")}</p>}
      {dash.data && dash.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("admin14.colUser")}</th>
                <th>{t("admin14.colStatus")}</th>
                <th>{t("admin14.colCountry")}</th>
                <th>
                  <button type="button" className="link" onClick={() => toggleSort("created_at")}>
                    {t("admin14.colRegistered")}{sortMark("created_at")}
                  </button>
                </th>
                <th>
                  <button type="button" className="link" onClick={() => toggleSort("last_activity")}>
                    {t("admin14.colLastActivity")}{sortMark("last_activity")}
                  </button>
                </th>
                <th>{t("admin14.colCounts")}</th>
              </tr>
            </thead>
            <tbody>
              {dash.data.items.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setUserId(row.id)}
                  style={{ cursor: "pointer" }}
                  title={row.full_name}
                >
                  <td>
                    <div>{row.full_name}</div>
                    <div className="hint mono">{row.email}</div>
                    {row.phone && <div className="hint mono">{row.phone}</div>}
                  </td>
                  <td>
                    <StatusBadges t={t} row={row} />
                  </td>
                  <td>
                    {row.country_code ? (
                      <span>
                        {countryFlag(row.country_code)} {countryNameFa(row.country_code)}
                        {row.country_source === "phone" && (
                          <span className="hint"> ({t("admin14.countryFromPhone")})</span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <div>{row.created_at ? formatDate(row.created_at) : "—"}</div>
                    <DeviceInfo t={t} d={row.registration} />
                  </td>
                  <td>
                    <div>
                      {row.last_activity?.at ? formatDate(row.last_activity.at) : "—"}
                    </div>
                    <DeviceInfo t={t} d={row.last_activity} />
                  </td>
                  <td className="mono">
                    {row.counts.fatwa_questions} / {row.counts.hifz_sessions + row.counts.hifz_tests} /{" "}
                    {row.counts.donations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dash.data && dash.data.total > PAGE_SIZE && (
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="btn"
            disabled={page <= 0}
            onClick={() => setPage(page - 1)}
          >
            {t("admin14.prevPage")}
          </button>
          <span className="hint">
            {page + 1} / {totalPages} — {dash.data.total}
          </span>
          <button
            type="button"
            className="btn"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t("admin14.nextPage")}
          </button>
        </div>
      )}
    </div>
  );
}
