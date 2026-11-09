"""Phase 7 (hifz redesign) — ARCHITECTURE / PERFORMANCE / A11Y verification.

Run against the production build (:3000) + local API (:8000).
No login needed (guest study page); no audio playback.

Measures (3 cold loads each, phone 393px + desktop 1280px):
- navigation timing: domContentLoaded, load, first contentful paint
  (performance.getEntriesByName('first-contentful-paint')) and time
  until the V2 mushaf text is actually visible (.hifz-line-page)
- which JS chunks the first load fetches, and whether the 1.1 MB
  V2 layout chunk is in the initial bundle or lazy (it must be lazy)
- page-navigation latency: ayah 1 -> ayah 2 via the picker (client
  navigation, same surah) and surah 1 -> surah 2
- contrast of the live pills (WCAG ratio from computed colors)
- tap targets: bottom-bar buttons + mic rects
- Escape closes the settings sheet and the errors sheet (Phase 7 fix)
- axe-core scan of the study page (axe-core is a web devDependency;
  injected from node_modules)
- horizontal overflow

Output: ~/workspace/quran-hifz-shots-redesign/phase7/report.json
(+ study-phone.png / study-desktop.png only as visual anchors —
no visual change was made in this phase).
"""
import json
import os
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = os.path.expanduser("~/workspace/quran-hifz-shots-redesign/phase7")
AXE = os.path.expanduser(
    "~/workspace/quran-hifz-redesign/apps/web/node_modules/axe-core/axe.min.js"
)


def contrast_ratio(fg: str, bg: str) -> float:
    def parse(c: str):
        parts = c.replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",")
        vals = [float(x) for x in parts[:3]]
        if len(parts) == 4 and float(parts[3]) == 0:
            return None
        return vals

    def lum(rgb):
        def f(v):
            v /= 255
            return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

        r, g, b = (f(v) for v in rgb)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    a, b = parse(fg), parse(bg)
    if a is None or b is None:
        return -1.0
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


AUDIT_JS = """() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const cs = (el) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, color: c.color };
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y),
             w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    headerText: q('.hifz-header') ? q('.hifz-header').textContent.replace(/\\s+/g,' ').trim() : null,
    mushafLines: qa('.hifz-line-page').length,
    mushafWords: qa('.hifz-line-page [data-word-key]').length,
    pills: qa('.hifz-pills .hifz-pill').map((p) => ({
      text: (p.textContent || '').trim(), style: cs(p),
    })),
    mic: rect(q('.hifz-mic-3d')),
    bottomBar: qa('.hifz-bottom-bar button').map((b) => ({
      text: (b.textContent || '').trim(), rect: rect(b),
    })),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    v2ChunkLoaded: !!document.querySelector('.hifz-line-page'),
  };
}"""


def pill_contrast_from_css() -> list[dict]:
    """Pill contrast from the stylesheet values (Phase 6 measured the
    same numbers live; the pills only render during a live session —
    showPills requires liveState listening/paused/ended — so a guest
    Playwright run cannot probe their computed style. The CSS values
    are unchanged by Phase 7, and this re-computes the ratios from
    them with the same WCAG math)."""
    import re

    css_path = os.path.expanduser(
        "~/workspace/quran-hifz-redesign/apps/web/app/[locale]/globals.css"
    )
    css = open(css_path, encoding="utf-8").read()
    out = []
    for name in ("red", "green", "lime", "amber", "gray"):
        m = re.search(
            rf"\.hifz-pill-{name}\s*\{{\s*background:\s*(#[0-9a-f]+);\s*color:\s*(#[0-9a-f]+);",
            css,
        )
        if not m:
            out.append({"pill": name, "contrast": None, "error": "rule-not-found"})
            continue
        bg, fg = m.group(1), m.group(2)
        out.append({"pill": name, "bg": bg, "color": fg,
                    "contrast": contrast_ratio(_css_rgb(fg), _css_rgb(bg))})
    return out


def _css_rgb(hexs: str) -> str:
    r, g, b = (int(hexs[i:i + 2], 16) for i in (1, 3, 5))
    return f"rgb({r},{g},{b})"


def home_page_chunks(page) -> dict:
    """Cold load of the home page: the V2 layout chunk (and the other
    mushaf/search data chunks) must NOT be in its chunk list — they
    are lazy chunks for quran/hifz views only."""
    chunks: list[str] = []

    def on_response(resp):
        u = resp.url
        if "/_next/static/chunks/" in u and u.endswith(".js"):
            chunks.append(u.split("/_next/static/chunks/")[-1])

    page.on("response", on_response)
    page.goto(f"{BASE}/fa", wait_until="load", timeout=60000)
    page.wait_for_timeout(1500)
    page.remove_listener("response", on_response)
    return {
        "chunkCount": len(chunks),
        "v2ChunkPresent": any("1dy0nni8mmio9" in c for c in chunks),
        "mushafLinesChunkPresent": any("14i6ulhibifh8" in c for c in chunks),
        "searchIndexChunkPresent": any("05jygv_bwkfjf" in c for c in chunks),
    }


def cold_load(page, url, label):
    """One cold load: returns navigation timings + chunk list."""
    chunks: list[dict] = []

    def on_response(resp):
        u = resp.url
        if "/_next/static/chunks/" in u and u.endswith(".js"):
            chunks.append({"url": u.split("/_next/static/chunks/")[-1],
                           "bytes": -1, "status": resp.status})

    page.on("response", on_response)
    t0 = time.monotonic()
    page.goto(url, wait_until="commit", timeout=60000)
    # First meaningful paint for this page = the mushaf text visible.
    try:
        page.wait_for_selector(".hifz-line-page", timeout=30000)
    except Exception:
        pass
    t_mushaf_ms = round((time.monotonic() - t0) * 1000)
    page.wait_for_load_state("load", timeout=30000)
    nav = page.evaluate(
        """() => {
          const n = performance.getEntriesByType('navigation')[0] || {};
          const fcp = performance.getEntriesByName('first-contentful-paint')[0];
          const paint = performance.getEntriesByName('first-paint')[0];
          return {
            domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
            load: Math.round(n.loadEventEnd || 0),
            fcp: fcp ? Math.round(fcp.startTime) : null,
            fp: paint ? Math.round(paint.startTime) : null,
            transfer: Math.round(n.transferSize || 0),
          };
        }"""
    )
    page.remove_listener("response", on_response)
    # Sizes come from the Resource Timing API (transferSize) — reading
    # response bodies races with navigations and is unnecessary.
    sizes = page.evaluate(
        """() => {
          const out = {};
          for (const e of performance.getEntriesByType('resource')) {
            if (e.name.includes('/_next/static/chunks/') && e.name.endsWith('.js')) {
              out[e.name.split('/_next/static/chunks/').pop()] = Math.round(
                e.decodedBodySize || e.encodedBodySize || e.transferSize || 0);
            }
          }
          return out;
        }"""
    )
    for c in chunks:
        c["bytes"] = sizes.get(c["url"], -1)
    nav["timeToMushafMs"] = t_mushaf_ms
    nav["jsChunks"] = chunks
    nav["jsTotalBytes"] = sum(c["bytes"] for c in chunks if c["bytes"] > 0)
    nav["label"] = label
    return nav


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    report: dict = {"loads": [], "navigation": {}, "a11y": {}, "escape": {}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for name, width, height in (("phone", 393, 852), ("desktop", 1280, 900)):
            ctx = browser.new_context(viewport={"width": width, "height": height})
            page = ctx.new_page()
            loads = []
            for i in range(3):
                loads.append(cold_load(page, f"{BASE}/fa/quran/1?tab=hifz", f"{name}-{i}"))
            report["loads"].extend(loads)
            # --- a11y + contrast + tap targets on the last load -------
            audit = page.evaluate(AUDIT_JS)
            pills = []
            for p in audit["pills"]:
                ratio = contrast_ratio(p["style"]["color"], p["style"]["bg"])
                pills.append({"text": p["text"], "bg": p["style"]["bg"],
                              "color": p["style"]["color"], "contrast": ratio})
            small_targets = [b for b in audit["bottomBar"]
                             if b["rect"]["w"] < 44 or b["rect"]["h"] < 44]
            axe_result = {"violations": "axe-not-run"}
            if os.path.exists(AXE):
                page.add_script_tag(path=AXE)
                axe_result = page.evaluate(
                    """async () => {
                      const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
                      return { violations: r.violations.map(v => ({
                        id: v.id, impact: v.impact,
                        nodes: v.nodes.length,
                        help: v.help })) };
                    }"""
                )
            report["a11y"][name] = {
                "header": audit["headerText"],
                "mushafLines": audit["mushafLines"],
                "mushafWords": audit["mushafWords"],
                "overflow": audit["overflow"],
                "pills": pills,
                "micRect": audit["mic"],
                "bottomBarButtons": len(audit["bottomBar"]),
                "bottomBarBelow44px": small_targets,
                "axe": axe_result,
            }
            # --- Escape closes sheets (Phase 7 fix) -------------------
            # Settings sheet: open via the bottom-bar settings button.
            settings_btn = page.locator(".hifz-bottom-bar button", has_text="تنظیمات")
            esc: dict = {}
            if settings_btn.count() > 0:
                settings_btn.first.click()
                page.wait_for_selector(".hifz-setting-row", timeout=5000)
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
                esc["settingsClosedByEscape"] = page.locator(".hifz-setting-row").count() == 0
            else:
                esc["settingsClosedByEscape"] = "settings-button-not-found"
            # Errors sheet: open via the errors button.
            errors_btn = page.locator(".hifz-bottom-bar button", has_text="خطاها")
            if errors_btn.count() > 0:
                errors_btn.first.click()
                page.wait_for_selector(".hifz-error-sheet", timeout=5000)
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
                esc["errorsClosedByEscape"] = page.locator(".hifz-error-sheet").count() == 0
            else:
                esc["errorsClosedByEscape"] = "errors-button-not-found"
            report["escape"][name] = esc
            # NOTE: Playwright's select_option cannot drive this
            # <select> in this sandbox (times out on "option not
            # enabled" although the DOM shows the select + option
            # visible and enabled, and a native change works — see
            # the phase 7 notes). Navigation is therefore measured
            # through the same onChange path the browser takes: set
            # the value via the React value setter + a change event.
            nav = {}
            set_select = """(args) => {
              const s = document.querySelector(args.sel);
              if (!s) return false;
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype, 'value').set;
              setter.call(s, args.value);
              s.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }"""
            try:
                page.goto(f"{BASE}/fa/quran/1?tab=hifz&ayah=1", wait_until="load", timeout=60000)
                page.wait_for_selector(".hifz-line-page", timeout=30000)
                t0 = time.monotonic()
                ok = page.evaluate(set_select, {"sel": ".hifz-picker select[aria-label='آیه']", "value": "2"})
                page.wait_for_url("**ayah=2", timeout=10000)
                page.wait_for_timeout(500)
                nav["ayahSwitchMs"] = round((time.monotonic() - t0) * 1000)
                nav["ayahSwitchOk"] = bool(ok)
                nav["urlAfterAyahSwitch"] = page.url
            except Exception as e:
                nav["ayahSwitchError"] = str(e)[:300]
            # Surah 1 -> 2: the study picker keeps the change in
            # local state (the route stays /fa/quran/1); the URL
            # only gains ?ayah=1 from the surah-change reset. So
            # wait on the picker's value + the header text, not the URL.
            try:
                t0 = time.monotonic()
                ok = page.evaluate(set_select, {"sel": ".hifz-picker select[aria-label='سوره']", "value": "2"})
                page.wait_for_function(
                    """() => document.querySelector(
                      ".hifz-picker select[aria-label='سوره']").value === '2'
                      && document.querySelector('.hifz-line-page') !== null""",
                    timeout=15000,
                )
                page.wait_for_timeout(500)
                nav["surahSwitchMs"] = round((time.monotonic() - t0) * 1000)
                nav["surahSwitchOk"] = bool(ok)
                nav["surahSelectValue"] = page.evaluate(
                    """() => document.querySelector(
                      ".hifz-picker select[aria-label='سوره']").value""")
                nav["urlAfterSurahSwitch"] = page.url
            except Exception as e:
                nav["surahSwitchError"] = str(e)[:300]
            report["navigation"][name] = nav
            page.screenshot(path=f"{OUT}/study-{name}.png")
            ctx.close()
        browser.close()

    # Home page must not download the mushaf data chunks at all.
    with sync_playwright() as pw2:
        b2 = pw2.chromium.launch()
        ctx2 = b2.new_context(viewport={"width": 393, "height": 852})
        report["homePageChunks"] = home_page_chunks(ctx2.new_page())
        ctx2.close()
        b2.close()

    # Summaries.
    for name in ("phone", "desktop"):
        rows = [r for r in report["loads"] if r["label"].startswith(name)]
        report[f"summary-{name}"] = {
            "fcpMsMedian": statistics.median([r["fcp"] for r in rows if r["fcp"] is not None]),
            "timeToMushafMsMedian": statistics.median([r["timeToMushafMs"] for r in rows]),
            "loadMsMedian": statistics.median([r["load"] for r in rows]),
            "jsTotalBytesMedian": statistics.median([r["jsTotalBytes"] for r in rows]),
            "chunkCounts": [len(r["jsChunks"]) for r in rows],
            "v2ChunkInEveryLoad": all(
                any("1dy0nni8mmio9" in c["url"] for c in r["jsChunks"]) for r in rows),
        }
    report["pillContrastCss"] = pill_contrast_from_css()
    report["pillsNote"] = ("Pills render only while a live session runs "
                           "(showPills = liveState listening/paused/ended); "
                           "a guest run has no pills in the DOM, so contrast "
                           "is re-verified from the stylesheet values above.")
    with open(f"{OUT}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: report[k] for k in ("summary-phone", "summary-desktop",
                                             "navigation", "escape")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
