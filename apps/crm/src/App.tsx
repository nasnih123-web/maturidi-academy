import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useI18n } from "./lib/i18n";
import { useCrmFonts } from "./lib/fonts";
import { useUploadedFonts } from "./lib/appearance";
import Appearance from "./pages/Appearance";
import Branding from "./pages/Branding";
import Content from "./pages/Content";
import { DashboardHome, DashboardLayout } from "./pages/Dashboard";
import Events from "./pages/Events";
import Login from "./pages/Login";
import Settings from "./pages/Settings";

function ProtectedRoute(): React.ReactElement {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) {
    return <div className="page">{t("common.loading")}</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

/**
 * Wires the per-locale font system (lib/fonts.ts): built-in self-hosted
 * fonts (fa→Vazirmatn, ar→Cairo, en→Inter) plus any admin-uploaded fonts
 * from the `fonts.<locale>` platform settings. Pure wiring — no UI.
 */
function FontBoot(): React.ReactElement {
  const uploaded = useUploadedFonts();
  useCrmFonts(uploaded);
  return <></>;
}

export default function App(): React.ReactElement {
  return (
    <>
      <FontBoot />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<DashboardLayout />}>
            <Route index element={<DashboardHome />} />
            <Route path="events" element={<Events />} />
            <Route path="content" element={<Content />} />
            <Route path="settings" element={<Settings />} />
            <Route path="appearance" element={<Appearance />} />
            <Route path="branding" element={<Branding />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
