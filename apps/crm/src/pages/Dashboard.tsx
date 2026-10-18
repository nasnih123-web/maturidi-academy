import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "@maturidi/ui-web";
import { useAuth } from "../lib/auth";
import { LOCALES, Locale, useI18n } from "../lib/i18n";

/**
 * Dashboard shell: side nav + outlet.
 * Nav gating is a stub — reads /users/me; full RBAC UI lands in a later phase.
 */

const NAV_ITEMS = [
  { to: "/", key: "nav.dashboard", end: true, superAdmin: false },
  { to: "/events", key: "nav.events", end: false, superAdmin: false },
  { to: "/content", key: "nav.content", end: false, superAdmin: false },
  { to: "/settings", key: "nav.settings", end: false, superAdmin: true },
  { to: "/branding", key: "nav.branding", end: false, superAdmin: true },
] as const;

export function DashboardLayout(): React.ReactElement {
  const { t, locale, setLocale } = useI18n();
  const { user, logout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate("/login", { replace: true });
  }

  const items = NAV_ITEMS.filter((item) => !item.superAdmin || isSuperAdmin);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: "240px",
          flexShrink: 0,
          background: "#0f172a",
          color: "#e2e8f0",
          display: "flex",
          flexDirection: "column",
          padding: "1.25rem 1rem",
        }}
      >
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{t("app.name")}</div>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{t("app.subtitle")}</div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: 1 }}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                padding: "0.6rem 0.9rem",
                borderRadius: "10px",
                textDecoration: "none",
                color: isActive ? "#fff" : "#cbd5e1",
                background: isActive ? "#1d4ed8" : "transparent",
                fontWeight: isActive ? 700 : 400,
              })}
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <select
            className="input"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            aria-label="locale"
            style={{ background: "#1e293b", color: "#e2e8f0", borderColor: "#334155" }}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis" }}>
            {user?.full_name}
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            {t("nav.logout")}
          </Button>
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}

export function DashboardHome(): React.ReactElement {
  const { t } = useI18n();
  const { user } = useAuth();
  return (
    <div className="page">
      <h1>
        {t("dashboard.welcome")}، {user?.full_name}
      </h1>
      <p style={{ color: "#475569" }}>{t("dashboard.overview")}</p>
      <p style={{ color: "#64748b" }}>{t("dashboard.hint")}</p>
    </div>
  );
}
