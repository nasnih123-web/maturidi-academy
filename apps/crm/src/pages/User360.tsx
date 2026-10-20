/**
 * Phase 14 — User 360° view (Track 2: CRM frontend).
 *
 * One user's profile, roles, LMS progress, library/social/fatwa activity,
 * notification preferences, recent notifications and audit trail.
 * Presentational only — all logic in lib/admin14.ts + lib/admin14Hooks.ts.
 */

import React from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { errText } from "../lib/admin14";
import {
  useUser360,
  useUserAdminMutation,
  useUserAuditTrail,
  useUserSearch,
} from "../lib/admin14Hooks";

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

export default function User360({ initialUserId = null }: { initialUserId?: string | null } = {}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { hasPermission, isSuperAdmin } = useAuth();
  const [query, setQuery] = React.useState("");
  const [activeQuery, setActiveQuery] = React.useState("");
  const [userId, setUserId] = React.useState<string | null>(initialUserId);

  const search = useUserSearch(activeQuery || undefined);
  const profile = useUser360(userId);
  const audit = useUserAuditTrail(userId);
  const mut = useUserAdminMutation();
  const [rolesDraft, setRolesDraft] = React.useState("");
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);

  React.useEffect(() => {
    if (profile.data) setRolesDraft(profile.data.roles.join(", "));
  }, [profile.data]);

  const canManage = hasPermission("users.view360");

  return (
    <div className="page" style={{ maxWidth: "1100px" }}>
      <h1>{t("admin14.userTitle")}</h1>
      <p className="hint">{t("admin14.userHint")}</p>

      <section className="panel" aria-label={t("admin14.userSearch")}>
        <div className="row">
          <input
            type="search"
            value={query}
            placeholder={t("admin14.userSearchPh")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setActiveQuery(query);
            }}
            style={{ flex: 1 }}
            aria-label={t("admin14.userSearch")}
          />
          <button type="button" className="btn primary" onClick={() => setActiveQuery(query)}>
            {t("admin14.search")}
          </button>
        </div>
        {search.data && (
          <ul className="compact-list" style={{ marginTop: "0.5rem" }}>
            {search.data.items.map((u) => (
              <li key={u.id}>
                <button type="button" className="link" onClick={() => setUserId(u.id)}>
                  {u.display_name}
                </button>{" "}
                <span className="hint mono">{u.email}</span>{" "}
                <span className="hint">{u.roles.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
        {search.isError && <p className="error-text">{errText(search.error)}</p>}
      </section>

      {!userId && <p className="hint">{t("admin14.userSelect")}</p>}

      {userId && profile.isLoading && <p className="hint">{t("common.loading")}</p>}
      {userId && profile.isError && (
        <div className="panel" role="alert">
          <p>{t("admin14.backendMissing")}</p>
          <p className="hint">{errText(profile.error)}</p>
          <button type="button" className="btn" onClick={() => void profile.refetch()}>
            {t("common.retry")}
          </button>
        </div>
      )}

      {userId && profile.data && (
        <>
          <section className="panel" aria-label={t("admin14.uProfile")}>
            <div className="row">
              <h2 style={{ margin: 0 }}>{profile.data.display_name}</h2>
              <span className="badge tone-info">{profile.data.status}</span>
            </div>
            <dl className="def-list">
              <div>
                <dt>email</dt>
                <dd className="mono">{profile.data.email}</dd>
              </div>
              <div>
                <dt>{t("admin14.uCreated")}</dt>
                <dd>{profile.data.created_at ? formatDate(profile.data.created_at) : "—"}</dd>
              </div>
              <div>
                <dt>{t("admin14.uLastActive")}</dt>
                <dd>{profile.data.last_active_at ? formatDate(profile.data.last_active_at) : "—"}</dd>
              </div>
              <div>
                <dt>{t("admin14.uLocale")}</dt>
                <dd className="mono">{profile.data.locale}</dd>
              </div>
            </dl>
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <strong>{t("admin14.uPrefs")}:</strong>
              <Pref label="email" on={profile.data.notification_preferences.email} />
              <Pref label="sms" on={profile.data.notification_preferences.sms} />
              <Pref label="push" on={profile.data.notification_preferences.push} />
              <Pref label="in_app" on={profile.data.notification_preferences.in_app} />
            </div>
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
