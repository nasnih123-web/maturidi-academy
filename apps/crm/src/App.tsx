import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useI18n } from "./lib/i18n";
import { useCrmFonts } from "./lib/fonts";
import { useUploadedFonts } from "./lib/appearance";
import Appearance from "./pages/Appearance";
import Branding from "./pages/Branding";
import Calculators from "./pages/Calculators";
import ContentControl from "./pages/ContentControl";
import User360 from "./pages/User360";
import Notifications from "./pages/Notifications";
import Roles from "./pages/Roles";
import { DashboardHome, DashboardLayout } from "./pages/Dashboard";
import Events from "./pages/Events";
import Fatwa from "./pages/Fatwa";
import Finance from "./pages/Finance";
import LMS from "./pages/LMS";
import Login from "./pages/Login";
import MediaManager from "./pages/MediaManager";
import Moderation from "./pages/Moderation";
import FatwaSubmissions from "./pages/FatwaSubmissions";
import Clusters from "./pages/Clusters";
import Quran from "./pages/Quran";
import Telegram from "./pages/Telegram";
import Places from "./pages/Places";
import Voice from "./pages/Voice";
import Sync from "./pages/Sync";
import ApiKeys from "./pages/ApiKeys";
import Connections from "./pages/Connections";
import Builds from "./pages/Builds";
import Analytics from "./pages/Analytics";
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
            <Route path="content" element={<ContentControl />} />
            <Route path="fatwa" element={<Fatwa />} />
            <Route path="finance" element={<Finance />} />
            <Route path="moderation" element={<Moderation />} />
            <Route path="users" element={<User360 />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="roles" element={<Roles />} />
            <Route path="fatwa-submissions" element={<FatwaSubmissions />} />
            <Route path="clusters" element={<Clusters />} />
            <Route path="calculators" element={<Calculators />} />
            <Route path="lms" element={<LMS />} />
            <Route path="media" element={<MediaManager />} />
            <Route path="quran" element={<Quran />} />
            <Route path="telegram" element={<Telegram />} />
            <Route path="places" element={<Places />} />
            <Route path="voice" element={<Voice />} />
            <Route path="sync" element={<Sync />} />
            <Route path="api-keys" element={<ApiKeys />} />
            <Route path="connections" element={<Connections />} />
            <Route path="builds" element={<Builds />} />
            <Route path="analytics" element={<Analytics />} />
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
