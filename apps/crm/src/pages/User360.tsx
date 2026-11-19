/**
 * Phase C + 360° v2 — CRM users dashboard, trash and 360° detail.
 *
 * Dashboard: stats header, search + status/country/profile filters,
 * sortable table (registered / last activity) with each user's country,
 * registration IP + device/browser and last-activity IP + device/browser.
 * Trash tab: soft-deleted users with their history intact — restore or
 * permanently delete from there. Clicking a row opens the 360° detail:
 * hero card (avatar, identity chips, profile completeness), activity
 * stat cards, 84-day activity heatmap, the whole-system activity
 * timeline, sessions, donations, hifz, audit trail, role management
 * and user management (suspend / trash / restore / permanent delete).
 * Presentational only — data lives in lib/admin14.ts + lib/admin14Hooks.ts.
 */

import React from "react";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { errText } from "../lib/admin14";
import type { DashboardDevice, DashboardUserRow, UserActivityEvent } from "../lib/admin14";
import {
  useUser360,
  useUserAdminMutation,
  useUserAuditTrail,
  useUsersDashboard,
  useUsersStats,
  useUsersTrash,
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
      {!row.is_active && <span className="badge tone-danger">{t("admin14.badgeSuspended")}</span>}
      {row.deleted_at && <span className="badge tone-danger">{t("admin14.uTrashedBadge")}</span>}
    </div>
  );
}

/* ------------------------- 360° v2 pieces ------------------------- */

const MODULE_MONO: Record<string, { letter: string; cls: string }> = {
  account: { letter: "و", cls: "u360-m-account" },
  hifz: { letter: "ح", cls: "u360-m-hifz" },
  lms: { letter: "د", cls: "u360-m-lms" },
  library: { letter: "ک", cls: "u360-m-lib" },
  media: { letter: "ص", cls: "u360-m-media" },
  fatwa: { letter: "ف", cls: "u360-m-fatwa" },
  finance: { letter: "م", cls: "u360-m-finance" },
  social: { letter: "ا", cls: "u360-m-social" },
};

function evText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}

function eventDetail(ev: UserActivityEvent): string {
  const d = ev.data;
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = evText(v).trim();
    if (s) parts.push(s);
  };
  switch (ev.kind) {
    case "login":
      push(d.summary);
      push(d.ip);
      break;
    case "hifz_attempt":
      if (d.surah) parts.push(`سوره ${evText(d.surah)}`);
      push(d.status);
      push(d.engine);
      break;
    case "hifz_test":
      if (d.surah_start) parts.push(`سوره ${evText(d.surah_start)} تا ${evText(d.surah_end)}`);
      push(d.status);
      break;
    case "hifz_tasmi":
      if (d.start_surah) {
        parts.push(
          `${evText(d.start_surah)}:${evText(d.start_ayah)} ← ${evText(d.end_surah)}:${evText(d.end_ayah)}`,
        );
      }
      push(d.status);
      break;
    case "hifz_listen":
      if (d.surah) parts.push(`سوره ${evText(d.surah)}، آیه ${evText(d.ayah)}`);
      push(d.reciter);
      break;
    case "lms_certificate":
      push(d.code);
      break;
    case "donation":
      if (d.amount) parts.push(`${evText(d.amount)} ${evText(d.currency)}`);
      push(d.status);
      push(d.gateway);
      break;
    default:
      push(d.title);
      push(d.excerpt);
      push(d.status);
      push(d.kind);
      break;
  }
  return parts.join(" • ");
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "؟";
  if (words.length === 1) return words[0].slice(0, 1);
  return words[0].slice(0, 1) + words[1].slice(0, 1);
}

function ageOf(dob: string | null): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export default function User360({ initialUserId = null }: { initialUserId?: string | null } = {}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { hasPermission, isSuperAdmin } = useAuth();
  const [userId, setUserId] = React.useState<string | null>(initialUserId);

  // ---- dashboard state ----
  const [view, setView] = React.useState<"users" | "trash">("users");
  const [query, setQuery] = React.useState("");
  const [appliedQuery, setAppliedQuery] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [profileFilter, setProfileFilter] = React.useState("");
  const [sort, setSort] = React.useState("created_at");
  const [order, setOrder] = React.useState("desc");
  const [page, setPage] = React.useState(0);
  const [trashPage, setTrashPage] = React.useState(0);
  const [confirmPermId, setConfirmPermId] = React.useState<string | null>(null);

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
  const trash = useUsersTrash({
    q: appliedQuery || undefined,
    limit: PAGE_SIZE,
    offset: trashPage * PAGE_SIZE,
  });

  // ---- detail state ----
  const profile = useUser360(userId);
  const audit = useUserAuditTrail(userId);
  const mut = useUserAdminMutation();
  const [rolesDraft, setRolesDraft] = React.useState("");
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmPermanent, setConfirmPermanent] = React.useState(false);

  React.useEffect(() => {
    if (profile.data) setRolesDraft(profile.data.roles.join(", "));
  }, [profile.data]);

  const canManage = hasPermission("users.view360");
  const canManageUsers = hasPermission("users.manage");
  const totalPages = Math.max(1, Math.ceil((dash.data?.total ?? 0) / PAGE_SIZE));
  const trashTotalPages = Math.max(1, Math.ceil((trash.data?.total ?? 0) / PAGE_SIZE));

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
    const p = profile.data;
    const completeness = p
      ? p.profile_complete
        ? 100
        : Math.max(0, Math.min(100, Math.round(((5 - p.missing_profile_fields.length) / 5) * 100)))
      : 0;
    const lastActive = p?.sessions[0]?.last_active_at ?? p?.last_active_at ?? null;
    const age = p ? ageOf(p.date_of_birth) : null;
    // timeline grouped by day (API returns newest first)
    const tlGroups: { day: string; events: UserActivityEvent[] }[] = [];
    for (const ev of p?.activity_timeline ?? []) {
      const day = (ev.at || "").slice(0, 10);
      const last = tlGroups[tlGroups.length - 1];
      if (last && last.day === day) last.events.push(ev);
      else tlGroups.push({ day, events: [ev] });
    }
    const heatLevel = (count: number): string =>
      count >= 4 ? "l4" : count === 3 ? "l3" : count === 2 ? "l2" : count === 1 ? "l1" : "";

    return (
      <div className="page" style={{ maxWidth: "1150px" }}>
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

        {p && (
          <>
            {/* ---------- hero ---------- */}
            <section
              className={`u360-hero u360-rise${p.is_trashed ? " u360-trashed" : ""}`}
              aria-label={t("admin14.uProfile")}
            >
              <div className="u360-avatar-wrap">
                <div className="u360-avatar-ring" />
                <div className="u360-avatar-ring2" />
                <div className="u360-avatar">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.display_name} />
                  ) : (
                    <span>{initialsOf(p.display_name)}</span>
                  )}
                </div>
                {p.is_verified && <div className="u360-avatar-badge">✓</div>}
              </div>
              <div className="u360-hero-main">
                <div className="u360-hero-name">
                  <h2>{p.display_name}</h2>
                  <span className="badge tone-info">{p.status}</span>
                  {p.registration_status === "pending" ? (
                    <span className="badge tone-warn">{t("admin14.badgePending")}</span>
                  ) : (
                    <span className="badge tone-ok">{t("admin14.badgeCompleted")}</span>
                  )}
                  {p.is_verified ? (
                    <span className="badge tone-info">{t("admin14.badgeVerified")}</span>
                  ) : (
                    <span className="badge tone-muted">{t("admin14.badgeUnverified")}</span>
                  )}
                  {!p.is_active && !p.is_trashed && (
                    <span className="badge tone-danger">{t("admin14.badgeSuspended")}</span>
                  )}
                  {p.is_trashed && (
                    <span className="badge tone-danger">{t("admin14.uTrashedBadge")}</span>
                  )}
                </div>
                <div className="u360-hero-sub">
                  <span className="mono">{p.email}</span>
                  {p.phone && (
                    <>
                      {"  •  "}
                      <span className="mono">{p.phone}</span>
                    </>
                  )}
                </div>
                <div className="u360-chips">
                  {p.country_code && (
                    <span className="u360-chip">
                      {t("admin14.uCountry")}:{" "}
                      <b>
                        {countryFlag(p.country_code)} {countryNameFa(p.country_code)}
                      </b>
                    </span>
                  )}
                  {p.gender && (
                    <span className="u360-chip">
                      {t("admin14.uGender")}:{" "}
                      <b>{p.gender === "male" ? t("admin14.genderMale") : t("admin14.genderFemale")}</b>
                    </span>
                  )}
                  {age !== null && (
                    <span className="u360-chip">
                      {t("admin14.uDob")}: <b>{age}</b>
                    </span>
                  )}
                  <span className="u360-chip">
                    {t("admin14.uCreated")}: <b>{p.created_at ? formatDate(p.created_at) : "—"}</b>
                  </span>
                  <span className="u360-chip">
                    {t("admin14.uLocale")}: <b className="mono">{p.locale}</b>
                  </span>
                  {p.roles.length > 0 && (
                    <span className="u360-chip">
                      {t("admin14.uRoles")}: <b>{p.roles.join("، ")}</b>
                    </span>
                  )}
                  {p.is_trashed && p.deleted_at && (
                    <span className="u360-chip">
                      {t("admin14.uDeletedAt")}: <b>{formatDate(p.deleted_at)}</b>
                    </span>
                  )}
                </div>
                {!p.profile_complete && p.missing_profile_fields.length > 0 && (
                  <p className="hint" style={{ marginTop: "0.5rem" }}>
                    {t("admin14.uMissing")}: {p.missing_profile_fields.join("، ")}
                  </p>
                )}
                <div className="row" style={{ marginTop: "0.55rem" }}>
                  <strong>{t("admin14.uPrefs")}:</strong>
                  <Pref label="email" on={p.notification_preferences.email} />
                  <Pref label="sms" on={p.notification_preferences.sms} />
                  <Pref label="push" on={p.notification_preferences.push} />
                  <Pref label="in_app" on={p.notification_preferences.in_app} />
                </div>
              </div>
              <div className="u360-hero-side">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="hint">{t("admin14.uCompleteness")}</span>
                  <strong>{completeness}٪</strong>
                </div>
                <div className="u360-bar">
                  <i style={{ width: `${completeness}%` }} />
                </div>
                <div>
                  <div className="hint">{t("admin14.uLastActive")}</div>
                  <div>{lastActive ? formatDate(lastActive) : "—"}</div>
                </div>
              </div>
            </section>

            {/* ---------- manage ---------- */}
            {canManageUsers && (
              <section className="panel u360-rise" style={{ animationDelay: ".05s" }}>
                <h3>{t("admin14.uManage")}</h3>
                {p.is_trashed ? (
                  <>
                    <p className="hint">
                      {t("admin14.uTrashedBadge")}
                      {p.deleted_at ? ` — ${formatDate(p.deleted_at)}` : ""}
                    </p>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={mut.restore.isPending}
                        onClick={() => mut.restore.mutate(userId)}
                      >
                        {t("admin14.uRestore")}
                      </button>
                      {!confirmPermanent ? (
                        <button type="button" className="btn danger" onClick={() => setConfirmPermanent(true)}>
                          {t("admin14.uPermanentDelete")}
                        </button>
                      ) : (
                        <>
                          <span>{t("admin14.uPermanentConfirm")}</span>
                          <button
                            type="button"
                            className="btn danger"
                            disabled={mut.permanentRemove.isPending}
                            onClick={() =>
                              mut.permanentRemove.mutate(userId, {
                                onSuccess: () => setUserId(null),
                              })
                            }
                          >
                            {t("admin14.uPermanentDelete")}
                          </button>
                          <button type="button" className="btn" onClick={() => setConfirmPermanent(false)}>
                            {t("common.cancel")}
                          </button>
                        </>
                      )}
                    </div>
                    {mut.restore.isSuccess && <p className="ok-text">{t("admin14.uRestoreDone")}</p>}
                    {mut.restore.isError && <p className="error-text">{errText(mut.restore.error)}</p>}
                    {mut.permanentRemove.isError && (
                      <p className="error-text">{errText(mut.permanentRemove.error)}</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      {p.is_active ? (
                        <button
                          type="button"
                          className="btn danger"
                          disabled={mut.suspend.isPending}
                          onClick={() => mut.suspend.mutate(userId)}
                        >
                          {t("admin14.uSuspend")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={mut.activate.isPending}
                          onClick={() => mut.activate.mutate(userId)}
                        >
                          {t("admin14.uActivate")}
                        </button>
                      )}
                      {!confirmDelete ? (
                        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
                          {t("admin14.uDelete")}
                        </button>
                      ) : (
                        <>
                          <span>{t("admin14.uDeleteConfirm")}</span>
                          <button
                            type="button"
                            className="btn danger"
                            disabled={mut.remove.isPending}
                            onClick={() =>
                              mut.remove.mutate(userId, { onSuccess: () => setUserId(null) })
                            }
                          >
                            {t("admin14.uDelete")}
                          </button>
                          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                            {t("common.cancel")}
                          </button>
                        </>
                      )}
                    </div>
                    {mut.suspend.isSuccess && <p className="ok-text">{t("admin14.uSuspendDone")}</p>}
                    {mut.suspend.isError && <p className="error-text">{errText(mut.suspend.error)}</p>}
                    {mut.activate.isSuccess && <p className="ok-text">{t("admin14.uActivateDone")}</p>}
                    {mut.activate.isError && <p className="error-text">{errText(mut.activate.error)}</p>}
                    {mut.remove.isError && <p className="error-text">{errText(mut.remove.error)}</p>}
                  </>
                )}
              </section>
            )}

            {/* ---------- stat cards ---------- */}
            <div className="u360-stats">
              <div className="u360-stat u360-rise" style={{ animationDelay: ".1s" }}>
                <div className="top">
                  <span className="u360-mono u360-m-hifz">ح</span>
                  <span className="name">{t("admin14.uHifz")}</span>
                </div>
                <div className="num">
                  {p.hifz.attempts + p.hifz.tests + p.hifz.tasmi_sessions} <small>{t("admin14.statAttempts")}</small>
                </div>
                <div className="sub">
                  {t("admin14.statAttempts")}: {p.hifz.attempts} • {t("admin14.statTests")}: {p.hifz.tests} •{" "}
                  {t("admin14.statTasmi")}: {p.hifz.tasmi_sessions}
                </div>
              </div>
              <div className="u360-stat u360-rise" style={{ animationDelay: ".16s" }}>
                <div className="top">
                  <span className="u360-mono u360-m-lms">د</span>
                  <span className="name">{t("admin14.uLms")}</span>
                </div>
                <div className="num">
                  {p.lms_progress.enrolled} <small>{t("admin14.statEnrolled")}</small>
                </div>
                <div className="sub">
                  {t("admin14.statCompleted")}: {p.lms_progress.completed} • {t("admin14.statCertificates")}:{" "}
                  {p.lms_progress.certificates} • XP: {p.lms_progress.xp}
                </div>
              </div>
              <div className="u360-stat u360-rise" style={{ animationDelay: ".22s" }}>
                <div className="top">
                  <span className="u360-mono u360-m-lib">ک</span>
                  <span className="name">{t("admin14.uLibrary")}</span>
                </div>
                <div className="num">
                  {p.media_activity.plays} <small>{t("admin14.uMediaPlays")}</small>
                </div>
                <div className="sub">
                  {t("admin14.uMediaTime")}: {Math.round(p.media_activity.seconds / 60)} {t("admin14.uMinutes")} •{" "}
                  {t("admin14.uMediaDownloads")}: {p.media_activity.downloads} • {t("admin14.statUploads")}:{" "}
                  {p.library_activity.uploads}
                </div>
              </div>
              <div className="u360-stat u360-rise" style={{ animationDelay: ".28s" }}>
                <div className="top">
                  <span className="u360-mono u360-m-fatwa">ف</span>
                  <span className="name">{t("admin14.uFatwa")}</span>
                </div>
                <div className="num">
                  {p.fatwa_activity.questions} <small>{t("admin14.statQuestions")}</small>
                </div>
                <div className="sub">
                  {t("admin14.statAnswers")}: {p.fatwa_activity.answers} • {t("admin14.uDonations")}:{" "}
                  {p.donations.total_succeeded_irr.toLocaleString()}
                </div>
              </div>
            </div>

            {/* ---------- heatmap ---------- */}
            <section className="panel u360-rise" style={{ animationDelay: ".34s" }} aria-label={t("admin14.uActivityHeatmap")}>
              <h3>
                {t("admin14.uActivityHeatmap")} <span className="hint">— {t("admin14.uHeatmapSub")}</span>
              </h3>
              <div className="u360-heat">
                {p.activity_heatmap.map((cell, i) => (
                  <i
                    key={cell.date}
                    className={heatLevel(cell.count)}
                    style={{ animationDelay: `${i * 0.008}s` }}
                    title={`${cell.date}: ${cell.count}`}
                  />
                ))}
              </div>
            </section>

            {/* ---------- timeline ---------- */}
            <section className="panel u360-rise" style={{ animationDelay: ".4s" }} aria-label={t("admin14.uActivityTimeline")}>
              <h3>{t("admin14.uActivityTimeline")}</h3>
              {tlGroups.length === 0 && <p className="hint">—</p>}
              <div className="u360-tl">
                {tlGroups.map((g) => (
                  <React.Fragment key={g.day}>
                    <div className="u360-day">{g.day ? formatDate(`${g.day}T12:00:00Z`) : ""}</div>
                    {g.events.map((ev, i) => {
                      const mono = MODULE_MONO[ev.module] ?? MODULE_MONO.account;
                      const detail = eventDetail(ev);
                      return (
                        <div className="u360-ev" key={`${ev.at}-${ev.kind}-${i}`}>
                          <span className={`ic ${mono.cls}`}>{mono.letter}</span>
                          <div className="body">
                            <div className="t">{t(`admin14.tl_${ev.kind}`)}</div>
                            {detail && <div className="d">{detail}</div>}
                          </div>
                          <span className="when">{ev.at ? formatDate(ev.at) : ""}</span>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </section>

            <section className="panel" aria-label={t("admin14.uRegDevice")}>
              <h3>{t("admin14.uRegDevice")}</h3>
              <DeviceInfo t={t} d={p.registration} showRaw />
              {p.registration?.at && <p className="hint">{formatDate(p.registration.at)}</p>}
            </section>

            <section className="panel" aria-label={t("admin14.uSessions")}>
              <h3>{t("admin14.uSessions")}</h3>
              {p.sessions.length === 0 && <p className="hint">—</p>}
              {p.sessions.length > 0 && (
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
                      {p.sessions.map((s) => (
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
                  <Stat label={t("admin14.statEnrolled")} value={p.lms_progress.enrolled} />
                  <Stat label={t("admin14.statCompleted")} value={p.lms_progress.completed} />
                  <Stat label={t("admin14.statCertificates")} value={p.lms_progress.certificates} />
                  <Stat label={t("admin14.statXp")} value={p.lms_progress.xp} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uLibrary")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statCheckouts")} value={p.library_activity.checkouts} />
                  <Stat label={t("admin14.statBookmarks")} value={p.library_activity.bookmarks} />
                  <Stat label={t("admin14.statUploads")} value={p.library_activity.uploads} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uSocial")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statPosts")} value={p.social_activity.posts} />
                  <Stat label={t("admin14.statComments")} value={p.social_activity.comments} />
                  <Stat label={t("admin14.statReportsFiled")} value={p.social_activity.reports_filed} />
                  <Stat label={t("admin14.statReportsReceived")} value={p.social_activity.reports_received} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uFatwa")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statQuestions")} value={p.fatwa_activity.questions} />
                  <Stat label={t("admin14.statAnswers")} value={p.fatwa_activity.answers} />
                  <Stat label={t("admin14.statSubmissions")} value={p.fatwa_activity.submissions} />
                </div>
              </section>
              <section className="panel">
                <h3>{t("admin14.uDonations")}</h3>
                <div className="stat-row">
                  <Stat label={t("admin14.statDonationCount")} value={p.donations.count} />
                  <Stat
                    label={t("admin14.statDonationTotal")}
                    value={p.donations.total_succeeded_irr.toLocaleString()}
                  />
                </div>
                {p.donations.recent.length > 0 && (
                  <ul className="compact-list">
                    {p.donations.recent.map((d) => (
                      <li key={d.id}>
                        <span className="mono">
                          {d.amount.toLocaleString()} {d.currency}
                        </span>{" "}
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
                  <Stat label={t("admin14.statAttempts")} value={p.hifz.attempts} />
                  <Stat label={t("admin14.statTests")} value={p.hifz.tests} />
                  <Stat label={t("admin14.statTasmi")} value={p.hifz.tasmi_sessions} />
                </div>
                {p.hifz.recent_attempts.length > 0 && (
                  <ul className="compact-list">
                    {p.hifz.recent_attempts.map((a) => (
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
              {p.recent_notifications.length === 0 && <p className="hint">—</p>}
              <ul className="compact-list">
                {p.recent_notifications.map((n) => (
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

      <div className="u360-tabs" role="tablist">
        <button
          type="button"
          className={`u360-tab${view === "users" ? " active" : ""}`}
          onClick={() => setView("users")}
        >
          {t("admin14.uUsersTab")}
          {stats.data && <span className="cnt">{stats.data.total_users}</span>}
        </button>
        <button
          type="button"
          className={`u360-tab${view === "trash" ? " active" : ""}`}
          onClick={() => setView("trash")}
        >
          {t("admin14.uTrashTab")}
          {stats.data && <span className="cnt">{stats.data.trashed}</span>}
        </button>
      </div>

      {view === "users" && (
        <>
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
                    setTrashPage(0);
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
                  setTrashPage(0);
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
        </>
      )}

      {view === "trash" && (
        <>
          <section className="panel">
            <p className="hint" style={{ margin: 0 }}>{t("admin14.uTrashHint")}</p>
          </section>

          {trash.isLoading && <p className="hint">{t("common.loading")}</p>}
          {trash.isError && (
            <div className="panel" role="alert">
              <p className="error-text">{errText(trash.error)}</p>
              <button type="button" className="btn" onClick={() => void trash.refetch()}>
                {t("common.retry")}
              </button>
            </div>
          )}
          {trash.data && trash.data.items.length === 0 && <p className="hint">{t("admin14.uTrashEmpty")}</p>}
          {trash.data && trash.data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("admin14.colUser")}</th>
                    <th>{t("admin14.uDeletedAt")}</th>
                    <th>{t("admin14.colCounts")}</th>
                    <th>{t("admin14.uManage")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trash.data.items.map((row) => (
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
                      <td>{row.deleted_at ? formatDate(row.deleted_at) : "—"}</td>
                      <td className="mono">
                        {row.counts.fatwa_questions} / {row.counts.hifz_sessions + row.counts.hifz_tests} /{" "}
                        {row.counts.donations}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={mut.restore.isPending}
                            onClick={() => mut.restore.mutate(row.id)}
                          >
                            {t("admin14.uRestore")}
                          </button>
                          {confirmPermId !== row.id ? (
                            <button
                              type="button"
                              className="btn danger"
                              onClick={() => setConfirmPermId(row.id)}
                            >
                              {t("admin14.uPermanentDelete")}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn danger"
                                disabled={mut.permanentRemove.isPending}
                                onClick={() =>
                                  mut.permanentRemove.mutate(row.id, {
                                    onSuccess: () => setConfirmPermId(null),
                                  })
                                }
                              >
                                {t("admin14.uPermanentDelete")} ✓
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setConfirmPermId(null)}
                              >
                                {t("common.cancel")}
                              </button>
                            </>
                          )}
                        </div>
                        {confirmPermId === row.id && (
                          <div className="hint" style={{ marginTop: "0.35rem" }}>
                            {t("admin14.uPermanentConfirm")}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {trash.data && trash.data.total > PAGE_SIZE && (
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="btn"
                disabled={trashPage <= 0}
                onClick={() => setTrashPage(trashPage - 1)}
              >
                {t("admin14.prevPage")}
              </button>
              <span className="hint">
                {trashPage + 1} / {trashTotalPages} — {trash.data.total}
              </span>
              <button
                type="button"
                className="btn"
                disabled={trashPage + 1 >= trashTotalPages}
                onClick={() => setTrashPage(trashPage + 1)}
              >
                {t("admin14.nextPage")}
              </button>
            </div>
          )}
          {mut.restore.isError && <p className="error-text">{errText(mut.restore.error)}</p>}
          {mut.permanentRemove.isError && (
            <p className="error-text">{errText(mut.permanentRemove.error)}</p>
          )}
        </>
      )}
    </div>
  );
}
