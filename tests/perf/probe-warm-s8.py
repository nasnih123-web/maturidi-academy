"""Warm-load check (round-2 §8): same context, load the hifz page twice.

Second load should reuse the cached mushaf data (transfer ~0) and the
preloaded fetch must not double-download. Local simulation only.

Tracks the V2 payloads generically (full JSON, index, per-page chunks,
glyphs) so the same probe works before and after the per-page split.
BASE from PERF_BASE (default http://localhost:3100); output path from
PERF_OUT (default perf-warm-s8.json next to this script).
"""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("PERF_BASE", "http://localhost:3100")
STUDY = f"{BASE}/fa/quran/1?tab=hifz"
OUT = os.environ.get(
    "PERF_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "perf-warm-s8.json")
)
NAV_JS = """() => {
  const res = performance.getEntriesByType('resource');
  const pick = (pred) => res.filter(pred).map(r => ({
    name: r.name.split('/').slice(-2).join('/'),
    transfer: Math.round(r.transferSize || 0),
    encoded: Math.round(r.encodedBodySize || 0),
    duration: Math.round(r.duration), start: Math.round(r.startTime),
  }));
  const v2 = pick(r => r.name.includes('quran-mushaf-v2'));
  const js = res.filter(r => r.name.endsWith('.js'));
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const n = performance.getEntriesByType('navigation')[0] || {};
  return {
    fcp: fcp ? Math.round(fcp.startTime) : null,
    loadEventEnd: Math.round(n.loadEventEnd || 0),
    totalTransfer: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0)),
    jsTransfer: Math.round(js.reduce((a, r) => a + (r.transferSize || 0), 0)),
    v2Entries: v2,
    v2Transfer: Math.round(v2.reduce((a, r) => a + r.transfer, 0)),
    v2Count: v2.length,
  };
}"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 393, "height": 852})
    page = ctx.new_page()
    page.route("**/raw.githubusercontent.com/**", lambda r: r.abort())
    out = {"method": {
        "branch": os.environ.get("PERF_BRANCH", "round2/section8-perf"),
        "base": BASE,
        "studyUrl": STUDY,
        "note": "LOCAL SIMULATION only — not real-device performance.",
    }}
    for label in ("load1-cold", "load2-warm"):
        t0 = time.monotonic()
        page.goto(STUDY, wait_until="commit", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        t_mushaf = round((time.monotonic() - t0) * 1000)
        page.wait_for_load_state("load", timeout=30000)
        page.wait_for_timeout(500)
        nav = page.evaluate(NAV_JS)
        nav["timeToMushafMs"] = t_mushaf
        out[label] = nav
    ctx.close()
    browser.close()
print(json.dumps(out, ensure_ascii=False, indent=2))
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
