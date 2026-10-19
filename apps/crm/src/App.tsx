import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useI18n } from "./lib/i18n";
import { useCrmFonts } from "./lib/fonts";
import { useUploadedFonts } from "./lib/appearance";
import Appearance from "./pages/Appearance";
import Branding from "./pages/Branding";
import Calculators from "./pages/Calculators";
import Content from "./pages/Content";
import { DashboardHome, DashboardLayout } from "./pages/Dashboard";
import Events from "./pages/Events";
import Fatwa from "./pages/Fatwa";
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
import ApiKeys from "./pages/ApiKeys";
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
            <Route path="fatwa" element={<Fatwa />} />
            <Route path="moderation" element={<Moderation />} />
            <Route path="fatwa-submissions" element={<FatwaSubmissions />} />
            <Route path="clusters" element={<Clusters />} />
            <Route path="calculators" element={<Calculators />} />
            <Route path="lms" element={<LMS />} />
            <Route path="media" element={<MediaManager />} />
            <Route path="quran" element={<Quran />} />
            <Route path="telegram" element={<Telegram />} />
            <Route path="places" element={<Places />} />
            <Route path="voice" element={<Voice />} />
            <Route path="api-keys" element={<ApiKeys />} />
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
