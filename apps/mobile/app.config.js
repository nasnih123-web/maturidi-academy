// app.config.js — dynamic Expo config (SDK 53). Static defaults live in
// app.json; this layer adds build-time values (audit F-04/F-09):
//
// - API URL: EXPO_PUBLIC_API_URL env (EAS profile env / expo.dev env vars /
//   GitHub workflow_dispatch inputs / local .env). localhost is allowed ONLY
//   for the development environment — preview/production profiles FAIL
//   LOUDLY without a real URL instead of silently shipping an app that
//   talks to the phone's own localhost (F-09).
// - Branding overrides from the CRM build flow (mobile.yml forwards the
//   workflow_dispatch inputs as env): APP_NAME, APP_PACKAGE_ID,
//   APP_VERSION_NAME, APP_VERSION_CODE.
// - extra.easProjectId stays EMPTY until the owner links the real Expo
//   project (`eas init`) — never a fabricated ID (MOBILE-EAS-01, BLOCKED).

const DEV_API_URL = "http://localhost:8000";
const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])(:|\/|$)/;

function resolveEnvironment() {
  return (
    process.env.APP_ENVIRONMENT ||
    process.env.EAS_BUILD_PROFILE ||
    "development"
  );
}

function resolveApiUrl(environment) {
  const raw = (process.env.EXPO_PUBLIC_API_URL || "").trim();
  if (environment === "development") {
    return (raw || DEV_API_URL).replace(/\/+$/, "");
  }
  if (!raw || LOCAL_RE.test(raw)) {
    throw new Error(
      `[app.config] EXPO_PUBLIC_API_URL must be a real, non-localhost API URL ` +
        `for the "${environment}" build profile (got: ${raw || "<unset>"}). ` +
        `Set it via the EAS environment variables on expo.dev or the build ` +
        `workflow inputs — refusing to ship a build that talks to localhost.`
    );
  }
  return raw.replace(/\/+$/, "");
}

function resolveVersionCode(config) {
  const raw = (process.env.APP_VERSION_CODE || "").trim();
  if (!raw) return config.android?.versionCode;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== raw) {
    throw new Error(
      `[app.config] APP_VERSION_CODE must be a positive integer (got: "${raw}").`
    );
  }
  return n;
}

module.exports = ({ config }) => {
  const environment = resolveEnvironment();
  const apiUrl = resolveApiUrl(environment);
  const versionCode = resolveVersionCode(config);
  return {
    ...config,
    ...(process.env.APP_NAME ? { name: process.env.APP_NAME } : {}),
    ...(process.env.APP_VERSION_NAME
      ? { version: process.env.APP_VERSION_NAME }
      : {}),
    android: {
      ...config.android,
      ...(process.env.APP_PACKAGE_ID
        ? { package: process.env.APP_PACKAGE_ID }
        : {}),
      ...(versionCode !== undefined ? { versionCode } : {}),
    },
    ios: {
      ...config.ios,
      ...(process.env.APP_PACKAGE_ID
        ? { bundleIdentifier: process.env.APP_PACKAGE_ID }
        : {}),
    },
    extra: {
      ...config.extra,
      apiUrl,
      environment,
      easProjectId:
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
        config.extra?.easProjectId ||
        "",
    },
  };
};
