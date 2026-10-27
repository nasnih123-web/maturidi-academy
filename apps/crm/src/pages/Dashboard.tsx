import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { useEventFeed } from "../lib/events";
import { useSoundToggle, useEventChime } from "../lib/sound";
import { apiFetch, apiUrl } from "../lib/api";
import { LOCALES, Locale, useI18n } from "../lib/i18n";
import { useBrandLogo, useParticlesConfig } from "../lib/appearance";
import { CommandBar, CommandAction } from "../components/CommandBar";
import { DateWidget } from "../components/DateWidget";
import { KpiTile } from "../components/KpiTile";
import { ParticleField } from "../components/ParticleField";

/**
 * Dashboard shell + home, restyled in the turbo "Obsidian Imperial" visual
 * language. Architecture is ours: react-router-dom routes, real auth from
 * lib/auth (2FA/TOTP preserved), realtime from lib/events.
 *
 * Nav is DATA-DRIVEN (NAV_GROUPS): adding a future section (e.g. the /builds
 * build center from the product vision) is one NAV_GROUPS entry + one Route
 * in App.tsx — nothing here hardcodes the route list.
 */

interface NavItemDef {
  to: string;
  labelKey: string;
  icon: string; // svg path data
  superAdmin: boolean;
}

interface NavGroupDef {
  groupKey: string;
  items: NavItemDef[];
}

/** Vector menu icons — stay legible when the sidebar collapses. */
function NavIcon({ d }: { d: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      width="17"
      height="17"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    groupKey: "nav.groupMain",
    items: [
      { to: "/", labelKey: "nav.dashboard", icon: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10", superAdmin: false },
      { to: "/my-notifications", labelKey: "nav.myNotifications", icon: "M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 004 0", superAdmin: false },
      { to: "/events", labelKey: "nav.events", icon: "M3 12h4l2.5-7 4 14 2.5-7H21", superAdmin: false },
      { to: "/content", labelKey: "nav.content", icon: "M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 16h4", superAdmin: false },
      { to: "/fatwa", labelKey: "nav.fatwa", icon: "M12 3v18M5 8l7-5 7 5M7 21h10", superAdmin: true },
      { to: "/articles", labelKey: "nav.articles", icon: "M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 16h4", superAdmin: true },
      { to: "/moderation", labelKey: "nav.moderation", icon: "M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z", superAdmin: true },
      { to: "/fatwa-submissions", labelKey: "nav.fatwaSubmissions", icon: "M6 3h9l4 4v14H6zM14 3v5h4M9 13h6M9 16h4", superAdmin: true },
      { to: "/clusters", labelKey: "nav.clusters", icon: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 21c0-3.5 3-6 7-6s7 2.5 7 6M16 11a3 3 0 100-6", superAdmin: true },
      { to: "/calculators", labelKey: "nav.calculators", icon: "M9 3h6M10 3v5.5L4.8 17a2.4 2.4 0 002.1 3.5h10.2a2.4 2.4 0 002.1-3.5L14 8.5V3M7.5 14h9", superAdmin: true },
      { to: "/lms", labelKey: "nav.lms", icon: "M22 10L12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5M12 22v-6", superAdmin: true },
      { to: "/media", labelKey: "nav.media", icon: "M4 7h16v10H4zM4 7l2-2h4l2 2M10 11l4 2.5-4 2.5z", superAdmin: true },
      { to: "/telegram", labelKey: "nav.telegram", icon: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z", superAdmin: true },
      { to: "/places", labelKey: "nav.places", icon: "M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", superAdmin: true },
      { to: "/voice", labelKey: "nav.voice", icon: "M12 1a3 3 0 013 3v8a3 3 0 01-6 0V4a3 3 0 013-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8", superAdmin: true },
      { to: "/api-keys", labelKey: "nav.apiKeys", icon: "M4 7h16M4 12h16M4 17h10M17 17l2 2 4-4", superAdmin: true },
      { to: "/finance", labelKey: "nav.finance", icon: "M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7v5a2 2 0 002 2h14M16 15h2", superAdmin: true },
    ],
  },
  {
    groupKey: "nav.groupTeam",
    items: [
      { to: "/projects", labelKey: "nav.projects", icon: "M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z", superAdmin: true },
      { to: "/staff", labelKey: "nav.staff", icon: "M6 4h12a1 1 0 011 1v14a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1zM9 9h6M9 13h6M9 17h4", superAdmin: true },
    ],
  },
  {
    groupKey: "nav.groupSystem",
    items: [
      { to: "/quran", labelKey: "nav.quran", icon: "M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2A2.5 2.5 0 014 4.5v15A2.5 2.5 0 006.5 22H20V2H6.5zM9 7h7M9 11h5", superAdmin: true },
      { to: "/sync", labelKey: "nav.sync", icon: "M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14.9-3M4 15a8 8 0 0014.9 3", superAdmin: true },
      { to: "/settings", labelKey: "nav.settings", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h3M18 12h3M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1", superAdmin: true },
      { to: "/settings/security", labelKey: "nav.security", icon: "M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6zM9.5 12l2 2 3.5-4", superAdmin: false },
      { to: "/appearance", labelKey: "nav.appearance", icon: "M4 8h10M18 8h2M4 16h2M10 16h10M14 4v4M6 12v4", superAdmin: true },
      { to: "/branding", labelKey: "nav.branding", icon: "M12 3a9 9 0 100 18c1.4 0 2-.8 2-1.8 0-1.4-1.2-1.8-1.2-3 0-1.2 1-2.2 2.4-2.2H17a4.5 4.5 0 004.5-4.5C21.5 5.6 17.2 3 12 3zM7.5 12.5a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6z", superAdmin: true },
      { to: "/users", labelKey: "nav.users", icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", superAdmin: true },
      { to: "/notifications", labelKey: "nav.notifications", icon: "M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0", superAdmin: true },
      { to: "/roles", labelKey: "nav.roles", icon: "M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6zM9 12l2 2 4-4", superAdmin: true },
      { to: "/connections", labelKey: "nav.connections", icon: "M9 15l6-6M7.5 10.5l-3 3a4.24 4.24 0 006 6l3-3M16.5 13.5l3-3a4.24 4.24 0 00-6-6l-3 3", superAdmin: true },
      { to: "/builds", labelKey: "nav.builds", icon: "M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8", superAdmin: true },
      { to: "/analytics", labelKey: "nav.analytics", icon: "M3 21h18M6 17v-6M11 17V7M16 17v-9M21 17V4", superAdmin: true },
    ],
  },
];

/** Collapsed-mode locale cycler — compact button with a tooltip. */
function LocaleCycleButton(): React.ReactElement {
  const { t, locale, setLocale } = useI18n();
  const cycle = (): void => {
    const i = LOCALES.indexOf(locale);
    setLocale(LOCALES[(i + 1) % LOCALES.length]);
  };
  return (
    <button
      type="button"
      className="icon-mini locale-cycle"
      onClick={cycle}
      aria-label={t("appearance.localeCycle")}
      title={`${t("appearance.localeCycle")} — ${locale}`}
    >
      <span aria-hidden="true" dir="ltr" style={{ fontSize: "0.72rem", fontWeight: 700 }}>
        {locale}
      </span>
    </button>
  );
}

const STATUS_TONE_CLASS: Record<string, "down" | "warn" | ""> = {
  connecting: "warn",
  connected: "",
  reconnecting: "warn",
  disconnected: "down",
};

export function DashboardLayout(): React.ReactElement {
  const { t, locale, setLocale } = useI18n();
  const { user, logout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  /* The mobile drawer always renders expanded, even when the desktop
   * sidebar is collapsed — otherwise it would show icons only. */
  const expanded = !collapsed || mobileNavOpen;
  const [logoOk, setLogoOk] = React.useState(true);
  const { sound, toggle: toggleSound } = useSoundToggle();
  const brandLogo = useBrandLogo();
  const particles = useParticlesConfig();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate("/login", { replace: true });
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleItems = React.useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((item) => !item.superAdmin || isSuperAdmin),
      })).filter((g) => g.items.length > 0),
    [isSuperAdmin],
  );

  const cmdActions: CommandAction[] = React.useMemo(
    () => [
      ...visibleItems.flatMap((g) =>
        g.items.map((item) => ({
          id: `nav-${item.to}`,
          label: t(item.labelKey),
          onSelect: () => navigate(item.to),
        })),
      ),
      { id: "logout", label: t("nav.logout"), onSelect: () => void handleLogout() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleItems, t, navigate],
  );

  return (
    <div className={`crm-shell${mobileNavOpen ? " nav-open" : ""}`}>
      {/* Subtle parallax particle layer behind the whole shell (config-driven). */}
      <ParticleField config={particles} density={0.45} className="crm-shell-particles" />

      <aside className={`crm-sidebar${collapsed ? " mini" : ""}${mobileNavOpen ? " mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="sidebar-mark" aria-hidden="true">
            {logoOk ? (
              <img
                src={brandLogo}
                alt=""
                className="sidebar-logo-img"
                onError={() => setLogoOk(false)}
              />
            ) : (
              t("app.mark")
            )}
          </span>
          {expanded && (
            <span>
              <strong>{t("app.name")}</strong>
              <span>{t("app.subtitle")}</span>
            </span>
          )}
        </div>

        {visibleItems.map((group) => (
          <nav key={group.groupKey} className="nav-group" aria-label={t(group.groupKey)}>
            {expanded && <p className="nav-title">{t(group.groupKey)}</p>}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `nav-item${isActive ? " on" : ""}`}
                title={t(item.labelKey)}
                onClick={() => setMobileNavOpen(false)}
              >
                <span className="nav-ico">
                  <NavIcon d={item.icon} />
                </span>
                {expanded && <span className="nav-label">{t(item.labelKey)}</span>}
              </NavLink>
            ))}
          </nav>
        ))}

        <div className="sidebar-foot">
          <div className="locale-wrap">
            {expanded ? (
              <select
                className="input"
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                aria-label={t("nav.groupSystem")}
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <LocaleCycleButton />
            )}
          </div>
          {expanded && <div className="user-chip">{user?.full_name}</div>}
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          type="button"
          className="crm-nav-backdrop"
          aria-label={t("nav.collapse")}
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Utility icons detached from the nav flow: a floating action stack. */}
      <div className="util-stack" role="toolbar" aria-label={t("nav.commandBar")}>
        <button
          type="button"
          className="icon-mini crm-menu-btn"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label={mobileNavOpen ? t("nav.collapse") : t("nav.expand")}
          aria-expanded={mobileNavOpen}
          title={mobileNavOpen ? t("nav.collapse") : t("nav.expand")}
        >
          ☰
        </button>
        <button
          type="button"
          className={`icon-mini${sound ? " on" : ""}`}
          onClick={toggleSound}
          aria-label={sound ? t("nav.soundOff") : t("nav.soundOn")}
          aria-pressed={sound}
          title={sound ? t("nav.soundOff") : t("nav.soundOn")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5z" />
            {sound && <path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" />}
          </svg>
        </button>
        <button
          type="button"
          className="icon-mini"
          onClick={() => setCmdOpen(true)}
          aria-label={t("nav.commandBar")}
          title={t("nav.commandBar")}
        >
          <span className="cmdk-hint" aria-hidden="true">
            ⌘K
          </span>
        </button>
        <button
          type="button"
          className="icon-mini"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-expanded={!collapsed}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
            style={collapsed ? { transform: "scaleX(-1)" } : undefined}
          >
            <path d="M13 5l-7 7 7 7M19 5l-7 7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-mini danger"
          onClick={() => void handleLogout()}
          aria-label={t("nav.logout")}
          title={t("nav.logout")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3" />
          </svg>
        </button>
      </div>

      <main className="crm-main">
        <Outlet />
      </main>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} actions={cmdActions} />
    </div>
  );
}

/** Backend shape: GET /api/v1/content/items → {items, total} (real counts). */
interface ContentStatsItem {
  status: string;
}

interface ContentStatsOut {
  items: ContentStatsItem[];
  total: number;
}

interface DeadLetterOut {
  total: number;
}

interface HealthOut {
  status: string;
  env?: string;
}

function countByStatus(items: ContentStatsItem[], status: string): number {
  return items.reduce((n, it) => (it.status === status ? n + 1 : n), 0);
}

const KPI_DEFS = [
  { key: "kpiTotal", accent: "#17a077", count: (items: ContentStatsItem[]) => items.length },
  { key: "kpiPublished", accent: "#e5c07b", count: (items: ContentStatsItem[]) => countByStatus(items, "published") },
  { key: "kpiInReview", accent: "#d4af37", count: (items: ContentStatsItem[]) => countByStatus(items, "in_review") },
  { key: "kpiDraft", accent: "#7d8f87", count: (items: ContentStatsItem[]) => countByStatus(items, "draft") },
] as const;

export function DashboardHome(): React.ReactElement {
  const { t, formatDate } = useI18n();
  const { user, isSuperAdmin } = useAuth();
  const { status, events } = useEventFeed(60);
  useEventChime(events);

  const statsQuery = useQuery({
    queryKey: ["dashboard-content-stats"],
    queryFn: () => apiFetch<ContentStatsOut>("/api/v1/content/items"),
  });

  const healthQuery = useQuery({
    queryKey: ["dashboard-api-health"],
    queryFn: async () => {
      const res = await fetch(`${apiUrl()}/api/v1/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as HealthOut;
    },
    retry: 1,
  });

  const deadLetterQuery = useQuery({
    queryKey: ["dashboard-dead-letter"],
    queryFn: () => apiFetch<DeadLetterOut>("/api/v1/admin/events/dead-letter?limit=1"),
    enabled: isSuperAdmin,
    retry: 1,
  });

  const apiOk = healthQuery.data?.status === "ok";

  return (
    <div>
      <header className="topbar">
        <span className="topbar-title">
          {t("dashboard.title")} — {user?.full_name}
        </span>
        <span className="grow" />
        <DateWidget />
        <span className={`ws-pill${events.length > 0 ? " ok" : ""}`} role="status">
          {events.length} {t("dashboard.liveEvents")}
        </span>
      </header>
      <p className="hint" style={{ marginBottom: "1rem" }}>
        {t("dashboard.sub")}
      </p>

      {statsQuery.data && (
        <div className="kpi-grid">
          {KPI_DEFS.map((def) => (
            <KpiTile
              key={def.key}
              label={t(`dashboard.${def.key}`)}
              value={String(def.count(statsQuery.data.items))}
              accent={def.accent}
            />
          ))}
        </div>
      )}

      <div className="two-col">
        <section className="panel" aria-label={t("dashboard.feedTitle")}>
          <div className="panel-head">
            <h2>{t("dashboard.feedTitle")}</h2>
            <span className="panel-hint">{t("dashboard.feedHint")}</span>
          </div>
          {events.length === 0 ? (
            <div className="empty-state">
              <h3>{t("dashboard.feedEmpty")}</h3>
              <p>{t("dashboard.feedEmptyHint")}</p>
            </div>
          ) : (
            <ol className="timeline">
              {events.slice(0, 8).map((e, i) => (
                <li key={e.event_id} className={`tl-row${i === 0 ? " fresh" : ""}`}>
                  <span className="tl-dot" aria-hidden="true" />
                  <div className="tl-body">
                    <div className="tl-head">
                      <strong>
                        <code>{e.event_type}</code>
                      </strong>
                      <time className="tl-time" dateTime={e.created_at}>
                        {formatDate(e.created_at)}
                      </time>
                    </div>
                    <div className="tl-summary">
                      {e.aggregate_type} · <code>{String(e.aggregate_id).slice(0, 8)}…</code>
                    </div>
                    <code className="tl-id">id: {e.event_id.slice(0, 8)}…</code>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel" aria-label={t("dashboard.healthTitle")}>
          <div className="panel-head">
            <h2>{t("dashboard.healthTitle")}</h2>
            <span className="panel-hint">{t("dashboard.healthHint")}</span>
          </div>
          <div className="health-row">
            <span className={`dot-live ${STATUS_TONE_CLASS[status]}`} aria-hidden="true" />
            <span className="health-name">{t("dashboard.healthWs")}</span>
            <span className="health-val">{t(`events.status${status[0].toUpperCase()}${status.slice(1)}`)}</span>
          </div>
          <div className="health-row">
            <span
              className={`dot-live ${healthQuery.isError ? "down" : apiOk ? "" : "warn"}`}
              aria-hidden="true"
            />
            <span className="health-name">{t("dashboard.healthApi")}</span>
            <span className="health-val">
              {healthQuery.isPending ? "…" : apiOk ? t("dashboard.healthOk") : "—"}
            </span>
          </div>
          {isSuperAdmin && (
            <div className="health-row">
              <span
                className={`dot-live ${(deadLetterQuery.data?.total ?? 0) > 0 ? "warn" : ""}`}
                aria-hidden="true"
              />
              <span className="health-name">{t("dashboard.healthDeadLetter")}</span>
              <span className="health-val">
                {deadLetterQuery.isPending ? "…" : String(deadLetterQuery.data?.total ?? "—")}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
