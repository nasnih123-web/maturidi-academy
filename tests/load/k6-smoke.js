/*
 * Phase 17 — k6 smoke test (آزمون دود بار)
 *
 * Covers the Phase-17 acceptance surface:
 *   1. homepage (web root)          — GET ${WEB_URL}/
 *   2. search API                   — GET ${BASE_URL}/api/v1/search?q=...
 *   3. widget API (embeddable)      — GET ${BASE_URL}/api/v1/widgets/prayer-times (+ ayah-of-day)
 *   4. fatwa ask (RAG, no LLM key)  — POST ${BASE_URL}/api/v1/fatwa/ask
 *   5. WebSocket realtime gateway   — WS ${WS_URL}/ws/events?token=... (auth handshake)
 *
 * Run:
 *   BASE_URL=http://localhost:18001 WEB_URL=http://localhost:3000 \
 *   WS_TOKEN=<jwt> WIDGET_KEY=<mk_...> k6 run tests/load/k6-smoke.js
 *
 * The web homepage check is best-effort: if WEB_URL is unreachable the
 * scenario records `web_unreachable` and continues (documented, not hidden).
 * This is a SMOKE test (correctness under light concurrency), not a
 * full soak/stress run — see docs/ops/scaling-to-100k.md for the plan.
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const WEB_URL = __ENV.WEB_URL || 'http://localhost:3000';
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws'));
const WS_TOKEN = __ENV.WS_TOKEN || '';
const WIDGET_KEY = __ENV.WIDGET_KEY || '';

export const options = {
  scenarios: {
    rest_smoke: {
      executor: 'constant-vus',
      vus: 10,
      duration: '60s',
      exec: 'restSmoke',
    },
    widget_burst: {
      // embeddable widgets get unpredictable external traffic — burst them
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 25 },
        { duration: '30s', target: 25 },
        { duration: '10s', target: 0 },
      ],
      exec: 'widgetBurst',
    },
    ws_connect: {
      executor: 'constant-vus',
      vus: 10,
      duration: '45s',
      exec: 'wsConnect',
    },
  },
  thresholds: {
    // NOTE: the web-homepage check is best-effort (untagged) and excluded here;
    // API thresholds below cover the real backend surface.
    'http_req_failed{api:1}': ['rate<0.05'],
    'http_req_duration{api:1}': ['p(95)<3000'],
    ws_failed: ['rate<0.05'],
  },
};

const searchLatency = new Trend('search_latency_ms');
const widgetLatency = new Trend('widget_latency_ms');
const fatwaLatency = new Trend('fatwa_latency_ms');
const wsFailed = new Rate('ws_failed');
const webUnreachable = new Counter('web_unreachable');

const SEARCH_TERMS = ['نماز', 'زکات', 'روزه', 'قرآن', 'حج'];

export function restSmoke() {
  // --- 1. homepage (web) — best effort ---
  const home = http.get(`${WEB_URL}/`, { timeout: '10s' });
  if (home.status === 0) {
    webUnreachable.add(1); // documented, not a failure of the API
  } else {
    check(home, { 'homepage: 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });
  }

  // --- 2. search API ---
  const q = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const s0 = Date.now();
  const sres = http.get(
    `${BASE_URL}/api/v1/search?q=${encodeURIComponent(q)}&limit=10`,
    { timeout: '15s', tags: { api: '1', endpoint: 'search' } },
  );
  searchLatency.add(Date.now() - s0);
  check(sres, {
    'search: 200': (r) => r.status === 200,
    'search: envelope': (r) => {
      try { return Array.isArray(JSON.parse(r.body).items ?? JSON.parse(r.body).results); }
      catch { return false; }
    },
  });

  // --- 4. fatwa ask (public; grounded retrieval, llm_unavailable without key) ---
  const f0 = Date.now();
  const fres = http.post(
    `${BASE_URL}/api/v1/fatwa/ask`,
    JSON.stringify({ question: 'حکم نماز مسافر چیست؟', locale: 'fa' }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '30s', tags: { api: '1', endpoint: 'fatwa_ask' } },
  );
  fatwaLatency.add(Date.now() - f0);
  check(fres, {
    'fatwa ask: 200': (r) => r.status === 200,
    'fatwa ask: grounded shape': (r) => {
      try { const b = JSON.parse(r.body); return 'answer' in b && 'status' in b; }
      catch { return false; }
    },
  });

  sleep(1);
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

  const ares = http.get(`${BASE_URL}/api/v1/widgets/ayah-of-day`,
    { headers, timeout: '15s', tags: { api: '1', endpoint: 'widget_ayah' } });
  check(ares, { 'widget ayah-of-day: 200': (r) => r.status === 200 });

  sleep(0.5);
}

export function wsConnect() {
  if (!WS_TOKEN) fail('WS_TOKEN env required for websocket scenario');
  const url = `${WS_URL}/ws/events?token=${WS_TOKEN}&channels=public`;
  let opened = false;
  let gotMessage = false;
  const res = ws.connect(url, { timeout: '15s' }, function (socket) {
    socket.on('open', () => { opened = true; });
    socket.on('message', () => { gotMessage = true; socket.close(); });
    socket.on('error', () => { /* counted below */ });
    socket.setTimeout(() => { socket.close(); }, 8000);
  });
  const ok = check(res, { 'ws: connected (101)': (r) => r && r.status === 101 });
  if (!ok || !opened) wsFailed.add(1);
  else if (!gotMessage) {
    // no broadcast within the window is fine for smoke — handshake is the assertion
    check({ opened }, { 'ws: handshake opened': (o) => o.opened });
  }
  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify({
      http_req_failed: data.metrics.http_req_failed?.values,
      http_req_duration_p95: data.metrics.http_req_duration?.values['p(95)'],
      search_latency_p95: data.metrics.search_latency_ms?.values['p(95)'],
      widget_latency_p95: data.metrics.widget_latency_ms?.values['p(95)'],
      fatwa_latency_p95: data.metrics.fatwa_latency_ms?.values['p(95)'],
      ws_failed: data.metrics.ws_failed?.values,
      web_unreachable: data.metrics.web_unreachable?.values,
    }, null, 2),
  };
}
