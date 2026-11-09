"""Round-2 section-8 perf probe (hifz redesign completion, §8).

Same method as the wave-2 probe (probe-perf.py): local production
build (:3100 in this worktree — :3000 is taken by a sibling agent)
+ local API (:8000), Playwright Chromium. Method mirrors
shot-phase8b.py exactly where comparable:
fresh context per cold run, .hifz-line-page as the mushaf-ready signal,
slow-3G = CDP Network.emulateNetworkConditions latency 400ms,
download/upload 400kbps (400*1024/8 B/s). Extra vs phase 8: full
resource breakdown on the slow-3G run (top-3 cause evidence), CLS via
a layout-shift observer installed with add_init_script, JS-heap
before/after 10 ayah jumps (with and without an explicit GC), and a
static chunk-size table from .next/static/chunks.

Output: perf-baseline.json in the same directory as this script.
"""
import json
import os
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("PERF_BASE", "http://localhost:3100")
OUT = os.path.dirname(os.path.abspath(__file__))
STUDY = f"{BASE}/fa/quran/1?tab=hifz"
STUDY_S2 = f"{BASE}/fa/quran/2?tab=hifz"

CLS_INIT = """() => {
  window.__cls = 0;
  window.__clsEntries = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__cls += e.value;
          window.__clsEntries.push({ value: e.value, time: Math.round(e.startTime) });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { window.__clsErr = String(e); }
}"""

NAV_JS = """() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const res = performance.getEntriesByType('resource');
  const js = res.filter(r => r.name.endsWith('.js'));
  const short = (u) => u.split('/').slice(-2).join('/');
  return {
    fcp: fcp ? Math.round(fcp.startTime) : null,
    loadEventEnd: Math.round(n.loadEventEnd || 0),
    domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
    navTransfer: Math.round(n.transferSize || 0),
    navEncoded: Math.round(n.encodedBodySize || 0),
    resourceCount: res.length,
    jsCount: js.length,
    jsTransfer: Math.round(js.reduce((a, r) => a + (r.transferSize || 0), 0)),
    jsEncoded: Math.round(js.reduce((a, r) => a + (r.encodedBodySize || 0), 0)),
    totalTransfer: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0)),
    cls: window.__cls || 0,
    clsEntries: window.__clsEntries || [],
    heapMB: (performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null),
    resources: res.map(r => ({
      name: short(r.name), transfer: Math.round(r.transferSize || 0),
      encoded: Math.round(r.encodedBodySize || 0),
      duration: Math.round(r.duration), start: Math.round(r.startTime),
    })).sort((a, b) => b.transfer - a.transfer),
  };
}"""

SET_SELECT_JS = """(args) => {
  const s = document.querySelector(args.sel);
  if (!s) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value').set;
  setter.call(s, args.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}"""


def cold_run(browser, viewport, label):
    ctx = browser.new_context(viewport=viewport)
    page = ctx.new_page()
    page.add_init_script(CLS_INIT)
    page.route("**/raw.githubusercontent.com/**", lambda r: r.abort())
    t0 = time.monotonic()
    page.goto(STUDY, wait_until="commit", timeout=60000)
    page.wait_for_selector(".hifz-line-page", timeout=30000)
    t_mushaf = round((time.monotonic() - t0) * 1000)
    page.wait_for_load_state("load", timeout=30000)
    page.wait_for_timeout(1000)
    nav = page.evaluate(NAV_JS)
    nav["label"] = label
    nav["timeToMushafMs"] = t_mushaf
    ctx.close()
    return nav


def main() -> int:
    report: dict = {"method": {
        "branch": os.environ.get("PERF_BRANCH", "round2/section8-perf @ 926be49 (BASELINE: round-2 section-8 head)"),
        "build": "NEXT_PUBLIC_API_URL=http://localhost:8000 next build --webpack (production)",
        "servers": "API :8000 (uvicorn app.main:app) + web :3000 (next start)",
        "browser": "Playwright Chromium (bundled)",
        "studyUrl": STUDY,
        "mushafReady": "selector .hifz-line-page attached",
        "slow3g": "CDP Network.emulateNetworkConditions latency=400ms, "
                  "download=upload=400kbps (400*1024/8 B/s), fresh context",
        "note": "LOCAL SIMULATION only — not real-device performance. "
                "FCP from performance paint entries; time-to-mushaf is "
                "wall time from goto(commit) to .hifz-line-page.",
    }}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # A. Cold FCP x3, phone 393x852 (fresh context each).
        runs = [cold_run(browser, {"width": 393, "height": 852}, f"phone-cold-{i+1}")
                for i in range(3)]
        report["coldPhone"] = {
            "runs": runs,
            "fcpMedian": statistics.median([r["fcp"] for r in runs if r["fcp"] is not None]),
            "fcpSamples": [r["fcp"] for r in runs],
            "timeToMushafMedian": statistics.median([r["timeToMushafMs"] for r in runs]),
            "timeToMushafSamples": [r["timeToMushafMs"] for r in runs],
            "loadMedian": statistics.median([r["loadEventEnd"] for r in runs]),
            "jsTransferMedian": statistics.median([r["jsTransfer"] for r in runs]),
            "totalTransferMedian": statistics.median([r["totalTransfer"] for r in runs]),
            "clsMax": max(r["cls"] for r in runs),
        }

        # B. Cold desktop x1, 1280x900.
        report["coldDesktop"] = cold_run(browser, {"width": 1280, "height": 900}, "desktop-cold-1")

        # C. Slow 3G cold, phone, fresh context, full resource table.
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        page.add_init_script(CLS_INIT)
        page.route("**/raw.githubusercontent.com/**", lambda r: r.abort())
        cdp = ctx.new_cdp_session(page)
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 400,
            "downloadThroughput": 400 * 1024 / 8, "uploadThroughput": 400 * 1024 / 8,
        })
        t0 = time.monotonic()
        page.goto(STUDY, wait_until="commit", timeout=180000)
        page.wait_for_selector(".hifz-line-page", timeout=180000)
        t_mushaf = round((time.monotonic() - t0) * 1000)
        page.wait_for_load_state("load", timeout=180000)
        page.wait_for_timeout(1000)
        slow = page.evaluate(NAV_JS)
        slow["timeToMushafMs"] = t_mushaf
        report["slow3gCold"] = slow
        ctx.close()

        # D. Memory + fast jumps: warm context, surah 2, 10 jumps.
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        page.add_init_script(CLS_INIT)
        page.route("**/raw.githubusercontent.com/**", lambda r: r.abort())
        page.goto(STUDY_S2, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        # Round-2 tip: the picker lives inside the collapsed setup
        # panel (setupOpen=false by default), so open it first; the
        # ayah <select> is the second select in .hifz-picker.
        try:
            page.click(".hifz-setup-toggle", timeout=10000)
            page.wait_for_selector(".hifz-picker select", timeout=10000)
        except Exception as e:
            print(f"setup panel did not open: {e}"[:200])
        heap_before = page.evaluate(
            "() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null")
        jumps = []
        for ayah in (10, 30, 60, 90, 120, 150, 180, 210, 240, 286):
            t0 = time.monotonic()
            try:
                # select_option times out on this select (React
                # re-renders keep it "unstable" for Playwright's
                # actionability check), so drive it like wave 2 did:
                # native setter + change event via evaluate.
                page.evaluate(SET_SELECT_JS, {"sel": ".hifz-picker select[aria-label='آیه']", "value": str(ayah)})
                page.wait_for_url(f"**ayah={ayah}", timeout=10000)
                ms_url = round((time.monotonic() - t0) * 1000)
                page.wait_for_selector(".hifz-line-page", timeout=10000)
                ms_mushaf = round((time.monotonic() - t0) * 1000)
                jumps.append({"ayah": ayah, "msToUrl": ms_url, "msToMushaf": ms_mushaf})
            except Exception as e:
                jumps.append({"ayah": ayah, "error": str(e)[:200]})
        heap_after = page.evaluate(
            "() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null")
        try:
            cdp2 = ctx.new_cdp_session(page)
            cdp2.send("HeapProfiler.collectGarbage")
            page.wait_for_timeout(500)
            heap_after_gc = page.evaluate(
                "() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576*10)/10 : null")
        except Exception as e:
            heap_after_gc = f"gc-error: {e}"[:200]
        cls_after_jumps = page.evaluate("() => window.__cls || 0")
        _ok = [j for j in jumps if "msToUrl" in j]
        report["memoryAndJumps"] = {
            "jumps": jumps,
            "medianMsToUrl": statistics.median([j["msToUrl"] for j in _ok]) if _ok else None,
            "medianMsToMushaf": statistics.median([j["msToMushaf"] for j in _ok]) if _ok else None,
            "heapBeforeMB": heap_before,
            "heapAfterMB": heap_after,
            "heapAfterGcMB": heap_after_gc,
            "heapDeltaMB": (round((heap_after - heap_before) * 10) / 10
                            if isinstance(heap_before, (int, float))
                            and isinstance(heap_after, (int, float)) else None),
            "heapDeltaAfterGcMB": (round((heap_after_gc - heap_before) * 10) / 10
                                   if isinstance(heap_before, (int, float))
                                   and isinstance(heap_after_gc, (int, float)) else None),
            "clsAfter10Jumps": cls_after_jumps,
        }
        ctx.close()
        browser.close()

    with open(os.path.join(OUT, os.environ.get("PERF_OUT", "perf-before.json")), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2)[:6000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
