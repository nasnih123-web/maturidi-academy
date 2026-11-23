/**
 * Maturidi Academy service worker (Phase 13 — offline).
 *
 * Strategy:
 * - App shell + `_next/static`, `/fonts`, `/icons`, `/brand` → cache-first.
 * - API GETs under `/api/v1/` → network-first with cache fallback
 *   (stale data beats no data; POST/PUT/DELETE always go to network —
 *   mutations queue in IndexedDB via the sync runner instead).
 * - Quran audio (children offline packs) → cache-first in
 *   `ma-audio-v1` for the two public audio CDNs (see AUDIO_HOSTS).
 *   The client downloads the same URL the player streams; the
 *   worker serves the cached file when offline.
 * - Navigations → network-first; on failure serve the locale's cached
 *   `/[locale]/offline` page, else a tiny built-in localized fallback.
 *
 * No business logic lives here — only caching. Version the cache name
 * when the shell changes.
 */

const SHELL_CACHE = "ma-shell-v1";
const API_CACHE = "ma-api-v1";
const AUDIO_CACHE = "ma-audio-v1";

const PRECACHE = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

const LOCALES = ["fa", "ar", "en"];

const OFFLINE_FALLBACK_HTML = {
  fa: {
    dir: "rtl",
    lang: "fa",
    title: "آفلاین — آکادمی ماتریدی",
    heading: "اتصال اینترنت قطع است",
    body: "محتوای ذخیره‌شدهٔ آفلاین همچنان در دسترس است. تغییرات شما پس از اتصال همگام می‌شود.",
    retry: "تلاش مجدد",
  },
  ar: {
    dir: "rtl",
    lang: "ar",
    title: "غير متصل — أكاديمية الماتريدي",
    heading: "انقطع الاتصال بالإنترنت",
    body: "المحتوى المحفوظ للعمل دون اتصال ما زال متاحًا. ستُزامَن تغييراتك بعد الاتصال.",
    retry: "إعادة المحاولة",
  },
  en: {
    dir: "ltr",
    lang: "en",
    title: "Offline — Maturidi Academy",
    heading: "You're offline",
    body: "Your saved offline content is still available. Your changes will sync once you're back online.",
    retry: "Retry",
  },
};

function localeFromPath(pathname) {
  const seg = pathname.split("/").filter(Boolean)[0];
  return LOCALES.includes(seg) ? seg : "fa";
}

function offlineFallbackResponse(pathname) {
  const t = OFFLINE_FALLBACK_HTML[localeFromPath(pathname)];
  const html = `<!doctype html><html lang="${t.lang}" dir="${t.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title><style>body{background:#0a0f0d;color:#e8e2d0;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}h1{color:#d4af37}button{background:#d4af37;color:#0a0f0d;border:0;border-radius:8px;padding:10px 24px;font-size:1rem;cursor:pointer}</style></head><body><main><h1>${t.heading}</h1><p>${t.body}</p><button onclick="location.reload()">${t.retry}</button></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== SHELL_CACHE && k !== API_CACHE && k !== AUDIO_CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/")
  );
}

function isApiGet(url, request) {
  return url.pathname.startsWith("/api/v1/") && request.method === "GET";
}

// Quran audio lives on two public CDNs: AlQuran Cloud per-ayah files
// (cdn.islamic.network — no CORS headers) and QuranicAudio surah
// files for the timing endpoint (download.quranicaudio.com). The
// children offline packs download these URLs and the worker caches
// them so a downloaded surah plays offline. Responses may be opaque,
// so cache on ok-or-opaque — and only for full (non-range)
// responses: a partial 206 must never overwrite the full file.
// A range request hits the cached full file (the element then
// buffers sequentially from the start); online seeks pass through
// to the network untouched.
const AUDIO_HOSTS = new Set([
  "cdn.islamic.network",
  "download.quranicaudio.com",
]);

async function cacheFirstAudio(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  const isRange = request.headers.has("Range");
  if ((res.ok || res.type === "opaque") && !isRange) {
    cache.put(request, res.clone());
  }
  return res;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallback) return fallback();
    throw new Error("offline and not cached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // mutations → network (sync runner queues them)
  const url = new URL(request.url);

  if (AUDIO_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirstAudio(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isApiGet(url, request)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL_CACHE, () =>
        // Prefer the real localized offline page if it was cached earlier.
        caches
          .match(`/${localeFromPath(url.pathname)}/offline`)
          .then((hit) => hit || offlineFallbackResponse(url.pathname)),
      ).catch(() => offlineFallbackResponse(url.pathname)),
    );
    return;
  }

  // Everything else: network-first, cache fallback (pages, images).
  event.respondWith(networkFirst(request, SHELL_CACHE));
});
