import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

// Track 2 / §۱۳ — بیلد production وب هرگز نباید بی‌صدا به localhost:8000
// fallback کند: این متغیر در باندل عمومی (مرورگر) bake می‌شود و fallback
// خاموش یعنی فرانت production به لوکال‌هاست کاربر حمله می‌کند.
// در CI مقدار صریح (حتی localhost) از env job تزریق می‌شود — .github/workflows/ci.yml
if (
  process.env.NEXT_PHASE === 'phase-production-build' &&
  !process.env.NEXT_PUBLIC_API_URL
) {
  throw new Error(
    '[web] NEXT_PUBLIC_API_URL is required for production builds — ' +
      'refusing to silently fall back to http://localhost:8000. ' +
      'Set it explicitly (e.g. WEB_API_URL build arg in docker-compose.prod.yml).'
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
