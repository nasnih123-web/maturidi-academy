import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // hifz-completion performance (§8): the V2 mushaf layout
  // (public/quran-mushaf-v2.json, ~1.1MB raw / ~193KB gzip) is a
  // static, effectively immutable dataset fetched on every mushaf /
  // hifz visit. The default public-file header (max-age=0) forced a
  // revalidation round-trip per visit; a 1-day fresh window +
  // stale-while-revalidate keeps repeat visits off the network while
  // still propagating a data change within a day. If the data ever
  // changes incompatibly, bump QURAN_MUSHAF_V2_URL in
  // lib/quran-mushaf-v2.ts instead of relying on this header.
  async headers() {
    return [
      {
        source: '/quran-mushaf-v2.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      // Round 2 §8 — per-page V2 chunks: the same 1-day + SWR window
      // for the index and the per-page files, so repeat visits skip
      // the network for them too. Same versioning rule as the full
      // file: bump QURAN_MUSHAF_V2_INDEX_URL / v2PageUrl on a data
      // change instead of relying on this header.
      {
        source: '/quran-mushaf-v2-index.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/quran-mushaf-v2-pages/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      // Step 1b (Digital Khatt): same caching contract as the V2
      // page data — per-page chunks are small JSON derived from a
      // fixed dataset; the full files are the fallback path.
      {
        source: '/quran-mushaf-dk.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/quran-mushaf-dk-pages/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/quran-mushaf-dk-indopak.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/quran-mushaf-dk-indopak-pages/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      // Step 2 (QPC V4 / 1441): same contract as the V2 page data;
      // the re-keyed glyph maps are immutable by name like the V2
      // glyph files.
      {
        source: '/quran-mushaf-v4.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/quran-mushaf-v4-pages/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/quran-mushaf-v4qpc-glyphs/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Round 2 §8 — fonts + glyph data are immutable by name, so
      // repeat visits must not spend a round-trip revalidating them:
      // the font files carry their version in the name
      // (UthmanicHafs-v-3.0, QCF p-numbers, Vazirmatn) and the glyph
      // JSONs are per-page data (p1..p604) derived from the fixed
      // QPC V2 dataset. A same-name replacement must be renamed
      // (bump the version / page key) instead of relying on this
      // header. Measured note: short-window probes already show 0
      // bytes on repeat loads (Chrome serves these from cache within
      // its heuristic window); the header makes that contractual for
      // users returning hours/days later, when the heuristic window
      // has expired and max-age=0 would force a conditional request
      // per file (~400ms of 3G round-trips, in parallel).
      {
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/quran-mushaf-v2-glyphs/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  // M-06 (Next 16/Turbopack): پکیج لینک‌شدهٔ monorepo باید resolve شود؛
  // بدون این، بیلد Turbopack ساب‌پث‌های CSS پکیج را پیدا نمی‌کند.
  transpilePackages: ['@maturidi/design-tokens'],
  turbopack: {
    // ریشهٔ Turbopack = ریشهٔ monorepo تا پکیج سیم‌لینک‌شدهٔ
    // packages/design-tokens داخل محدودهٔ مجاز فایل سیستم باشد.
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  },
};

export default withNextIntl(nextConfig);
