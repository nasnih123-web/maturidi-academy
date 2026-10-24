/*
 * آزمون بار واقعی — آکادمی ماتریدی (C-06؛ جایگزین سناریوی صرفاً دودِ فاز ۱۷)
 *
 * سناریوها:
 *   1. rest_browse  — صفحهٔ خانهٔ API (home/sections) + جستجوی سراسری
 *   2. fatwa_ask    — پرسش فتوا (RAG؛ بدون کلید LLM پاسخ grounded برمی‌گردد)
 *   3. widget_burst — ویجت‌های embed (prayer-times + ayah-of-day با کلید API)
 *   4. ws_gateway   — اتصال وب‌سوکت با «بلیط یک‌بارمصرف» (جریان فعلی auth:
 *                     POST /api/v1/auth/ws-ticket ← هرگز JWT در query string)
 *
 * پروفایل‌ها (PROFILE):
 *   smoke (پیش‌فرض): چند VU برای چند دقیقه — صحت زیر هم‌زمانی سبک.
 *   load: هزاران نشست در طول اجرا (ramp تا ۵۰۰ VU REST + ‏۲۰۰ ویجت +
 *         ۱۰۰ وب‌سوکت، ‏۱۰ دقیقه) با آستانه‌های p95 سخت‌گیرانه‌تر.
 *
 * اجرا:
 *   BASE_URL=https://staging.example.com WIDGET_KEY=<mk_...> \
 *   LOAD_EMAIL=load@example.com LOAD_PASSWORD=<...> PROFILE=load \
 *   k6 run tests/load/k6-load.js
 *
 * وضعیت اجرا: در محیط توسعهٔ این مخزن k6 و staging در دسترس نیست —
 * این اسکریپت «تحویل» است و اجرایش روی staging مالک زیرساخت است
 * (NOT RUN — به docs/ops/dr-drill.md و production-readiness.md نگاه کنید).
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const WS_URL = __ENV.WS_URL || BASE_URL.replace(/^http/, 'ws');
const WIDGET_KEY = __ENV.WIDGET_KEY || '';
const LOAD_EMAIL = __ENV.LOAD_EMAIL || '';
const LOAD_PASSWORD = __ENV.LOAD_PASSWORD || '';
const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();

const isLoad = PROFILE === 'load';

export const options = {
  scenarios: {
    rest_browse: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: isLoad
        ? [
            { duration: '2m', target: 500 },
            { duration: '6m', target: 500 },
            { duration: '2m', target: 0 },
          ]
        : [
            { duration: '30s', target: 10 },
            { duration: '60s', target: 10 },
            { duration: '15s', target: 0 },
          ],
      exec: 'restBrowse',
    },
    fatwa_ask: {
      executor: 'constant-vus',
      vus: isLoad ? 50 : 5,
      duration: isLoad ? '10m' : '90s',
      exec: 'fatwaAsk',
    },
    widget_burst: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: isLoad
        ? [
            { duration: '2m', target: 200 },
            { duration: '6m', target: 200 },
            { duration: '2m', target: 0 },
          ]
        : [
            { duration: '20s', target: 25 },
            { duration: '40s', target: 25 },
            { duration: '10s', target: 0 },
          ],
      exec: 'widgetBurst',
    },
    ws_gateway: {
      executor: 'constant-vus',
      vus: isLoad ? 100 : 10,
      duration: isLoad ? '10m' : '60s',
      exec: 'wsGateway',
    },
  },
  thresholds: {
    'http_req_failed{api:1}': [isLoad ? 'rate<0.01' : 'rate<0.05'],
    'http_req_duration{endpoint:search}': ['p(95)<800'],
    'http_req_duration{endpoint:home}': ['p(95)<500'],
    'http_req_duration{endpoint:widget_prayer}': ['p(95)<600'],
    'http_req_duration{endpoint:widget_ayah}': ['p(95)<400'], // کش روزانه (C-06/F1)
    'http_req_duration{endpoint:fatwa_ask}': ['p(95)<5000'],
    ws_failed: ['rate<0.02'],
  },
};

const searchLatency = new Trend('search_latency_ms');
const widgetLatency = new Trend('widget_latency_ms');
const fatwaLatency = new Trend('fatwa_latency_ms');
const wsFailed = new Rate('ws_failed');
const wsSessions = new Counter('ws_sessions');

const SEARCH_TERMS = ['نماز', 'زکات', 'روزه', 'قرآن', 'حج', 'ارث', 'وضو'];

/** ورود کاربر بار و توکن دسترسی — یک‌بار برای کل اجرا. */
export function setup() {
  if (!LOAD_EMAIL || !LOAD_PASSWORD) {
    // سناریوی WS بدون کاربر بار قابل اجرا نیست؛ بقیه ادامه می‌یابند.
    return { accessToken: '' };
  }
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ identifier: LOAD_EMAIL, password: LOAD_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '15s' },
  );
  if (res.status !== 200) fail(`setup login failed: ${res.status}`);
  return { accessToken: JSON.parse(res.body).access_token };
}

export function restBrowse() {
  const home = http.get(`${BASE_URL}/api/v1/home/sections`, {
    timeout: '15s',
    tags: { api: '1', endpoint: 'home' },
  });
  check(home, { 'home sections: 200': (r) => r.status === 200 });

  const q = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const s0 = Date.now();
  const sres = http.get(
    `${BASE_URL}/api/v1/search?q=${encodeURIComponent(q)}&limit=10`,
    { timeout: '15s', tags: { api: '1', endpoint: 'search' } },
  );
  searchLatency.add(Date.now() - s0);
  check(sres, { 'search: 200': (r) => r.status === 200 });
  sleep(1);
}

export function fatwaAsk() {
  const f0 = Date.now();
  const fres = http.post(
    `${BASE_URL}/api/v1/fatwa/ask`,
    JSON.stringify({ question: 'حکم نماز مسافر چیست؟', locale: 'fa' }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: '30s',
      tags: { api: '1', endpoint: 'fatwa_ask' },
    },
  );
  fatwaLatency.add(Date.now() - f0);
  check(fres, {
    'fatwa ask: 200': (r) => r.status === 200,
    'fatwa ask: grounded shape': (r) => {
      try {
        const b = JSON.parse(r.body);
        return 'answer' in b && 'status' in b;
      } catch {
        return false;
      }
    },
  });
  sleep(2);
}

export function widgetBurst() {
  if (!WIDGET_KEY) fail('WIDGET_KEY env required for widget scenario');
  const headers = { 'X-API-Key': WIDGET_KEY };
  const w0 = Date.now();
  const wres = http.get(
    `${BASE_URL}/api/v1/widgets/prayer-times?lat=35.70&lng=51.40&method=mwl`,
    { headers, timeout: '15s', tags: { api: '1', endpoint: 'widget_prayer' } },
  );
  widgetLatency.add(Date.now() - w0);
  check(wres, {
    'widget prayer-times: 200': (r) => r.status === 200,
    'widget: CORS wildcard (embed-safe)': (r) =>
      r.headers['Access-Control-Allow-Origin'] === '*',
  });

  const ares = http.get(`${BASE_URL}/api/v1/widgets/ayah-of-day`, {
    headers,
    timeout: '15s',
    tags: { api: '1', endpoint: 'widget_ayah' },
  });
  check(ares, {
    'widget ayah-of-day: 200': (r) => r.status === 200,
    'widget ayah-of-day: cacheable': (r) =>
      (r.headers['Cache-Control'] || '').includes('max-age'),
  });
  sleep(0.5);
}

export function wsGateway(data) {
  if (!data.accessToken) fail('LOAD_EMAIL/LOAD_PASSWORD required for ws scenario');
  // بلیط یک‌بارمصرف برای هر اتصال (جریان فعلی؛ JWT در query ممنوع است)
  const ticketRes = http.post(`${BASE_URL}/api/v1/auth/ws-ticket`, null, {
    headers: { Authorization: `Bearer ${data.accessToken}` },
    timeout: '10s',
    tags: { api: '1', endpoint: 'ws_ticket' },
  });
  if (ticketRes.status !== 200) {
    wsFailed.add(1);
    sleep(1);
    return;
  }
  const ticket = JSON.parse(ticketRes.body).ticket;
  let opened = false;
  const res = ws.connect(
    `${WS_URL}/ws/events?ticket=${encodeURIComponent(ticket)}&channels=public`,
    { timeout: '15s' },
    function (socket) {
      socket.on('open', () => {
        opened = true;
        wsSessions.add(1);
        socket.send(JSON.stringify({ type: 'ping' }));
      });
      socket.on('message', () => socket.close());
      socket.on('error', () => {});
      socket.setTimeout(() => socket.close(), 8000);
    },
  );
  const ok = check(res, { 'ws: connected (101)': (r) => r && r.status === 101 });
  if (!ok || !opened) wsFailed.add(1);
  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        profile: PROFILE,
        http_req_failed: data.metrics.http_req_failed?.values,
        http_req_duration_p95: data.metrics.http_req_duration?.values['p(95)'],
        search_latency_p95: data.metrics.search_latency_ms?.values['p(95)'],
        widget_latency_p95: data.metrics.widget_latency_ms?.values['p(95)'],
        fatwa_latency_p95: data.metrics.fatwa_latency_ms?.values['p(95)'],
        ws_failed: data.metrics.ws_failed?.values,
        ws_sessions: data.metrics.ws_sessions?.values,
      },
      null,
      2,
    ),
  };
}
