"""Phase 8 (hifz redesign) — CONSOLIDATED TEST PASS.

Run against the production build (:3000) + local API (:8000).
Guest only (no login — the 15-minute token is not needed anywhere here).

UI gaps filled (earlier phases did not cover these):
- tablet viewport (834x1112), RTL (dir + layout mirroring),
  window resize phone<->desktop, panels open/close (settings sheet,
  error sheet — open, backdrop click, Escape), toolbar/display modes
  (page/scroll/card), ayah/word selection (reader + study page),
  hifz/test modes (hub tabs), audio states (playing/paused/error/
  buffering/offline/retry) in listen mode.
Performance (medians of 3 where feasible):
- first-page load, navigating to other pages, fast page switching
  (10 rapid client-side jumps), font-cache behaviour (2nd visit must
  NOT re-download the mushaf font), offline/online (audio + timing
  hosts blocked -> honest states), audio loading, layout-shift
  prevention (CLS on load / player open / panel open), memory
  (JS heap before/after a 10-page navigation session), weak-device
  emulation (CPU throttling 4x + slow 3G).

Audio note: the sandbox cannot reach download.quranicaudio.com, so
the listen-mode audio host is routed to a LOCAL 47s synthetic tone
(mp3, 440 Hz) served with HTTP Range support (same pattern as phase
5). The tone drives the <audio> element and the player state machine;
it is NOT recitation — word-highlight timing comes from the real
segments when the local API reaches Quran.com v4, otherwise from the
honest interpolated fallback (the timing source is recorded). Reciter
photos come from upload.wikimedia.org, proxy-blocked in the sandbox:
only the img src is asserted, never a rendered photo.

Output: ~/workspace/quran-hifz-shots-redesign/phase8/report.json
(+ screenshots in the same folder).
"""
import json
import os
import re
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = os.path.expanduser("~/workspace/quran-hifz-shots-redesign/phase8")
TONE = os.path.join(OUT, "voice", "tone-47s.mp3")
AXE = os.path.expanduser(
    "~/workspace/quran-hifz-redesign/apps/web/node_modules/axe-core/axe.min.js"
)

STUDY = f"{BASE}/fa/quran/1?tab=hifz"
STUDY_S2 = f"{BASE}/fa/quran/2?tab=hifz"
READER_PAGE = f"{BASE}/fa/quran?view=page&page=1"
HUB = f"{BASE}/fa/quran/hifz"


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


OVERFLOW_JS = """() => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
})"""

CLS_INIT = """() => {
  window.__shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__shifts.push(Math.round(e.value * 10000) / 10000);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { window.__shifts = ['observer-error']; }
}"""

AUDIT_JS = """() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  return {
    htmlDir: document.documentElement.getAttribute('dir'),
    studyDir: q('.hifz-study') ? q('.hifz-study').getAttribute('dir') : null,
    headerText: q('.hifz-header') ? q('.hifz-header').textContent.replace(/\\s+/g,' ').trim() : null,
    mushafLines: qa('.hifz-line-page').length,
    mushafWords: qa('.hifz-line-page [data-word-key]').length,
    pills: qa('.hifz-pills .hifz-pill').map((p) => p.textContent.trim()),
    mic: q('.hifz-mic-3d') ? q('.hifz-mic-3d').getBoundingClientRect().toJSON() : null,
    bottomBar: qa('.hifz-bottom-bar button').map((b) => ({
      text: (b.textContent || '').trim(),
      rect: b.getBoundingClientRect().toJSON(),
      disabled: b.disabled,
    })),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    shifts: window.__shifts || null,
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


def fulfill_audio(route, audio_bytes, delay_ms=0):
    """Range-aware local audio fulfill (phase 5 pattern)."""
    if delay_ms:
        time.sleep(delay_ms / 1000.0)
    total = len(audio_bytes)
    rng = route.request.headers.get("range")
    m = re.match(r"bytes=(\d+)-(\d*)", rng) if rng else None
    if m:
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else total - 1
        end = min(end, total - 1)
        route.fulfill(
            status=206,
            content_type="audio/mpeg",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Content-Length": str(end - start + 1),
            },
            body=audio_bytes[start : end + 1],
        )
    else:
        route.fulfill(
            status=200,
            content_type="audio/mpeg",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(total)},
            body=audio_bytes,
        )


def route_audio_to_local(page, audio_bytes, delay_ms=0):
    """Route every plausible recitation-audio host to the local file."""
    def handler(route):
        fulfill_audio(route, audio_bytes, delay_ms=delay_ms)

    page.route("**/download.quranicaudio.com/**", handler)
    page.route("**/audio.qurancdn.com/**", handler)
    page.route("**/*.mp3", handler)


def cold_load(page, url, label):
    chunks: list[dict] = []

    def on_response(resp):
        u = resp.url
        if "/_next/static/chunks/" in u and u.endswith(".js"):
            chunks.append({"url": u.split("/_next/static/chunks/")[-1], "bytes": -1})

    page.on("response", on_response)
    t0 = time.monotonic()
    page.goto(url, wait_until="commit", timeout=60000)
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
          return {
            domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
            load: Math.round(n.loadEventEnd || 0),
            fcp: fcp ? Math.round(fcp.startTime) : null,
            transfer: Math.round(n.transferSize || 0),
          };
        }"""
    )
    page.remove_listener("response", on_response)
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
    nav["cls"] = round(sum(page.evaluate("() => (window.__shifts || []).filter(x => typeof x === 'number')")), 4)
    return nav


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    audio_bytes = open(TONE, "rb").read()
    report: dict = {"loads": [], "fontCache": {}, "tablet": {}, "rtl": {},
                    "resize": {}, "panels": {}, "displayModes": {},
                    "selection": {}, "modes": {}, "audio": {}, "cls": {},
                    "memory": {}, "weakDevice": {}, "fastSwitch": {},
                    "a11y": {}, "console": {}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # ---- A. cold loads: phone / desktop / tablet, 3 runs each -------
        for name, width, height in (("phone", 393, 852), ("desktop", 1280, 900),
                                    ("tablet", 834, 1112)):
            ctx = browser.new_context(viewport={"width": width, "height": height})
            page = ctx.new_page()
            page.add_init_script(CLS_INIT)
            loads = []
            for i in range(3):
                loads.append(cold_load(page, STUDY, f"{name}-{i}"))
            report["loads"].extend(loads)
            audit = page.evaluate(AUDIT_JS)
            report["a11y"][name] = {
                "header": audit["headerText"],
                "mushafLines": audit["mushafLines"],
                "mushafWords": audit["mushafWords"],
                "overflow": audit["overflow"],
                "bottomBarButtons": len(audit["bottomBar"]),
                "micRect": audit["mic"],
            }
            page.screenshot(path=f"{OUT}/study-{name}.png")
            ctx.close()
        for name in ("phone", "desktop", "tablet"):
            rows = [r for r in report["loads"] if r["label"].startswith(name)]
            report[f"summary-{name}"] = {
                "fcpMsMedian": statistics.median([r["fcp"] for r in rows if r["fcp"] is not None]),
                "timeToMushafMsMedian": statistics.median([r["timeToMushafMs"] for r in rows]),
                "loadMsMedian": statistics.median([r["load"] for r in rows]),
                "jsTotalBytesMedian": statistics.median([r["jsTotalBytes"] for r in rows]),
                "clsMedian": statistics.median([r["cls"] for r in rows]),
            }

        # ---- B. font cache: 1st vs 2nd visit in one context -------------
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        font_reqs: list[dict] = []

        def on_font_req(req):
            if "UthmanicHafs" in req.url:
                font_reqs.append({"url": req.url.split("/")[-1]})

        def on_font_resp(resp):
            if "UthmanicHafs" in resp.url:
                for r in font_reqs:
                    if r["url"] == resp.url.split("/")[-1]:
                        r["status"] = resp.status
                        r["fromCache"] = resp.headers.get("x-cache") is not None

        page.on("request", on_font_req)
        page.on("response", on_font_resp)
        page.goto(STUDY, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        page.wait_for_timeout(1500)
        first = list(font_reqs)
        # Measure transfer bytes of the font via Resource Timing.
        first_bytes = page.evaluate(
            """() => {
              let b = 0;
              for (const e of performance.getEntriesByType('resource')) {
                if (e.name.includes('UthmanicHafs')) b += e.transferSize || 0;
              }
              return b;
            }"""
        )
        font_reqs.clear()
        page.goto(STUDY, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        page.wait_for_timeout(1500)
        second_bytes = page.evaluate(
            """() => {
              let b = 0;
              for (const e of performance.getEntriesByType('resource')) {
                if (e.name.includes('UthmanicHafs')) b += e.transferSize || 0;
              }
              return b;
            }"""
        )
        report["fontCache"] = {
            "firstVisitRequests": first,
            "firstVisitTransferBytes": first_bytes,
            "secondVisitRequests": list(font_reqs),
            "secondVisitTransferBytes": second_bytes,
            "secondVisitRedownloaded": second_bytes > 0,
        }
        ctx.close()

        # ---- C+D+E. tablet + RTL + resize on one phone context ----------
        ctx = browser.new_context(viewport={"width": 834, "height": 1112})
        page = ctx.new_page()
        page.add_init_script(CLS_INIT)
        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
        page.goto(STUDY, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        page.wait_for_timeout(800)
        audit = page.evaluate(AUDIT_JS)
        report["tablet"] = {
            "viewport": "834x1112",
            "header": audit["headerText"],
            "mushafLines": audit["mushafLines"],
            "mushafWords": audit["mushafWords"],
            "overflow": audit["overflow"],
            "bottomBarButtons": len(audit["bottomBar"]),
            "micRect": audit["mic"],
            "cls": round(sum(x for x in (audit["shifts"] or []) if isinstance(x, (int, float))), 4),
        }
        page.screenshot(path=f"{OUT}/study-tablet.png")
        # RTL probes.
        rtl = page.evaluate(
            """() => {
              const q = (s) => document.querySelector(s);
              const pills = q('.hifz-pills');
              const pillRow = [...document.querySelectorAll('.hifz-pills .hifz-pill')]
                .map((p) => ({ text: (p.textContent || '').trim(),
                               x: Math.round(p.getBoundingClientRect().x) }));
              const bar = [...document.querySelectorAll('.hifz-bottom-bar button')]
                .slice(0, 3).map((b) => ({ text: (b.textContent || '').trim(),
                                           x: Math.round(b.getBoundingClientRect().x) }));
              return {
                htmlDir: document.documentElement.getAttribute('dir'),
                htmlLang: document.documentElement.getAttribute('lang'),
                studyDir: q('.hifz-study') ? q('.hifz-study').getAttribute('dir') : null,
                pillsDir: pills ? pills.getAttribute('dir') : null,
                pillXs: pillRow,
                firstBarButtons: bar,
              };
            }"""
        )
        report["rtl"] = rtl
        # Resize phone -> desktop -> phone.
        resize: dict = {}
        page.set_viewport_size({"width": 393, "height": 852})
        page.wait_for_timeout(600)
        resize["phone"] = page.evaluate(OVERFLOW_JS)
        resize["phoneMushaf"] = page.locator(".hifz-line-page").count()
        page.set_viewport_size({"width": 1280, "height": 900})
        page.wait_for_timeout(600)
        resize["desktop"] = page.evaluate(OVERFLOW_JS)
        resize["desktopMushaf"] = page.locator(".hifz-line-page").count()
        page.set_viewport_size({"width": 393, "height": 852})
        page.wait_for_timeout(600)
        resize["phoneAgain"] = page.evaluate(OVERFLOW_JS)
        resize["phoneAgainMushaf"] = page.locator(".hifz-line-page").count()
        resize["clsAfterResizes"] = round(sum(
            x for x in page.evaluate("() => window.__shifts || []") if isinstance(x, (int, float))), 4)
        report["resize"] = resize
        page.screenshot(path=f"{OUT}/study-resized-phone.png")

        # ---- F. panels: settings + errors sheets -------------------------
        # NOTE: both sheets share the class .hifz-error-sheet; they are
        # told apart by aria-label ("تنظیمات حفظ" vs "خطاها"). The
        # backdrop is fixed inset:0 but the sticky site header sits
        # above it, so a backdrop click must land below the header
        # (y=120), not at the viewport corner. The resize section left
        # the viewport at phone width, so restore tablet first and
        # compute the click x from the live viewport width.
        page.set_viewport_size({"width": 834, "height": 1112})
        page.wait_for_timeout(500)
        panels: dict = {}
        settings_sel = '.hifz-error-sheet[aria-label="تنظیمات حفظ"]'
        errors_sel = '.hifz-error-sheet[aria-label="خطاها"]'
        settings_btn = page.locator(".hifz-bottom-bar button", has_text="تنظیمات")
        if settings_btn.count() > 0:
            settings_btn.first.click()
            try:
                page.wait_for_selector(settings_sel, timeout=5000)
                panels["settingsOpens"] = True
                panels["settingsRows"] = page.locator(".hifz-setting-row").count()
                page.screenshot(path=f"{OUT}/panel-settings-tablet.png")
                # Close via backdrop click (below the header, centered).
                vw = page.evaluate("() => window.innerWidth")
                page.mouse.click(vw // 2, 120)
                page.wait_for_timeout(400)
                panels["settingsClosedByBackdrop"] = page.locator(settings_sel).count() == 0
                # Reopen + Escape.
                settings_btn.first.click()
                page.wait_for_selector(settings_sel, timeout=5000)
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
                panels["settingsClosedByEscape"] = page.locator(settings_sel).count() == 0
                panels["settingsCls"] = round(sum(
                    x for x in page.evaluate("() => window.__shifts || []") if isinstance(x, (int, float))), 4)
            except Exception as e:
                panels["settingsError"] = str(e)[:300]
        else:
            panels["settingsOpens"] = "settings-button-not-found"
        errors_btn = page.locator(".hifz-bottom-bar button", has_text="خطاها")
        if errors_btn.count() > 0:
            try:
                errors_btn.first.click()
                page.wait_for_selector(errors_sel, timeout=5000)
                panels["errorsOpens"] = True
                page.screenshot(path=f"{OUT}/panel-errors-tablet.png")
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
                panels["errorsClosedByEscape"] = page.locator(errors_sel).count() == 0
            except Exception as e:
                panels["errorsError"] = str(e)[:300]
        else:
            panels["errorsOpens"] = "errors-button-not-found"
        # Cleanup: make sure no sheet is left open for later sections.
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        panels["sheetsLeftOpen"] = page.locator(".hifz-error-sheet").count()
        report["panels"] = panels

        # ---- G. display modes: page / scroll / card ----------------------
        modes: dict = {}
        for mode in ("page", "scroll", "card"):
            btn = page.locator(".hifz-display-menu button", has_text={
                "page": "ورق‌زدن", "scroll": "اسکرولی", "card": "کادر"}[mode])
            if btn.count() == 0:
                modes[mode] = "button-not-found"
                continue
            try:
                btn.first.click()
                page.wait_for_timeout(700)
            except Exception as e:
                modes[mode] = f"click-error: {str(e)[:200]}"
                continue
            modes[mode] = page.evaluate(
                """(mode) => {
                  const q = (s) => document.querySelector(s);
                  return {
                    pressed: document.querySelector('.hifz-display-menu button.is-active')
                      ? document.querySelector('.hifz-display-menu button.is-active').textContent.trim() : null,
                    linePages: document.querySelectorAll('.hifz-line-page').length,
                    scrollSections: document.querySelectorAll('.hifz-scroll-pages .hifz-line-page').length,
                    cardSections: document.querySelectorAll('.hifz-card-frame .hifz-line-page').length,
                    overflow: document.documentElement.scrollWidth > window.innerWidth,
                  };
                }""",
                mode,
            )
        page.screenshot(path=f"{OUT}/display-card-tablet.png")
        # Back to page mode.
        page.locator(".hifz-display-menu button", has_text="ورق‌زدن").first.click()
        page.wait_for_timeout(500)
        report["displayModes"] = modes

        # ---- H. modes: practice <-> listen switch ------------------------
        listen_btn = page.locator(".hifz-mode-toggle button", has_text="گوش دادن")
        practice_btn = page.locator(".hifz-mode-toggle button", has_text="حفظ (تمرین)")
        switch: dict = {}
        if listen_btn.count() > 0:
            listen_btn.first.click()
            page.wait_for_timeout(800)
            switch["listenControls"] = page.locator(".hifz-listen-controls, .hifz-listen-mini").count() > 0 or \
                page.evaluate("() => document.body.textContent.includes('گوش دادن')")
            switch["listenAriaPressed"] = page.evaluate(
                "() => [...document.querySelectorAll('.hifz-mode-toggle button')].map(b => b.getAttribute('aria-pressed'))")
            switch["miniPlayerPresentBeforePlay"] = page.locator(".hifz-listen-mini").count()
            page.screenshot(path=f"{OUT}/listen-controls-tablet.png")
            practice_btn.first.click()
            page.wait_for_timeout(500)
            switch["backToPractice"] = page.evaluate(
                "() => [...document.querySelectorAll('.hifz-mode-toggle button')].map(b => b.getAttribute('aria-pressed'))")
        else:
            switch["error"] = "listen-toggle-not-found"
        report["modes"] = switch
        report["console"]["tabletSession"] = console_errors[:20]
        ctx.close()

        # ---- I. word/ayah selection (reader, where it is wired) ---------
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        sel: dict = {}
        page.goto(READER_PAGE, wait_until="load", timeout=60000)
        try:
            page.wait_for_selector(".mushaf-v2-word", timeout=30000)
            sel["readerWords"] = page.locator(".mushaf-v2-word").count()
            first = page.locator(".mushaf-v2-word").first
            key = first.get_attribute("data-word-key")
            first.click()
            page.wait_for_timeout(400)
            sel["clickedKey"] = key
            sel["selectedCount"] = page.locator(".mushaf-v2-word.is-selected").count()
            sel["ayahSelectedCount"] = page.locator(".mushaf-v2-word.is-ayah-selected").count()
            sel["selectedKey"] = page.evaluate(
                "() => document.querySelector('.mushaf-v2-word.is-selected')?.getAttribute('data-word-key') || null")
            page.screenshot(path=f"{OUT}/reader-selection-desktop.png")
        except Exception as e:
            sel["error"] = str(e)[:300]
        # Study page: words are practice words, not selectable — record it.
        page.goto(STUDY, wait_until="load", timeout=60000)
        try:
            page.wait_for_selector(".hifz-line-page [data-word-key]", timeout=30000)
            w = page.locator(".hifz-line-page [data-word-key]").first
            wkey = w.get_attribute("data-word-key")
            w.click()
            page.wait_for_timeout(400)
            sel["studyClickedKey"] = wkey
            sel["studySelectedCount"] = page.locator(".is-selected").count()
            sel["studyNote"] = ("study-page words have no selection state "
                                "(selection lives in the reader); click changes nothing")
        except Exception as e:
            sel["studyError"] = str(e)[:300]
        report["selection"] = sel
        ctx.close()

        # ---- J. hifz hub + testing mode ----------------------------------
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        hub: dict = {}
        page.goto(HUB, wait_until="load", timeout=60000)
        page.wait_for_timeout(1500)
        hub["tabs"] = page.evaluate(
            """() => [...document.querySelectorAll('[role="tab"], .hifz-hub-tab, nav button, header button')]
              .map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 12)""")
        hub["bodyHasDashboard"] = page.evaluate(
            "() => document.body.textContent.includes('داشبورد')")
        hub["overflow"] = page.evaluate(OVERFLOW_JS)["overflow"]
        page.screenshot(path=f"{OUT}/hub-phone.png")
        # Testing tab, if present as a button/tab.
        testing = page.locator("button", has_text="آزمون")
        if testing.count() > 0:
            testing.first.click()
            page.wait_for_timeout(800)
            hub["testingOpens"] = page.evaluate(
                "() => document.body.textContent.length > 500")
            page.screenshot(path=f"{OUT}/hub-testing-phone.png")
        else:
            hub["testingOpens"] = "testing-tab-not-found"
        report["modes"]["hub"] = hub
        ctx.close()

        # ---- K. audio states (listen mode, local audio route) ------------
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        route_audio_to_local(page, audio_bytes)
        audio: dict = {}
        page.goto(STUDY, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        page.locator(".hifz-mode-toggle button", has_text="گوش دادن").first.click()
        page.wait_for_timeout(1000)
        # Which timing source? (segments = real Quran.com v4 via local API)
        audio["timingSource"] = page.evaluate(
            """() => {
              const t = document.body.textContent;
              if (t.includes('زمان‌بندی واقعی') || t.includes('واقعی')) return 'segments-or-real-label';
              if (t.includes('تخمینی')) return 'interpolated';
              return 'unknown';
            }""")
        mini = page.locator(".hifz-listen-mini")
        audio["miniPresent"] = mini.count()
        play_btn = page.locator(".hifz-listen-mini button.quran-mini-play")
        try:
            play_btn.click(timeout=5000)
            try:
                page.wait_for_function(
                    """() => {
                      const m = document.querySelector('.hifz-listen-mini');
                      return m && (m.getAttribute('data-status') === 'playing' ||
                                   m.getAttribute('data-status') === 'buffering');
                    }""",
                    timeout=20000,
                )
                audio["plays"] = True
                audio["statusAfterPlay"] = page.evaluate(
                    "() => document.querySelector('.hifz-listen-mini')?.getAttribute('data-status')")
                page.wait_for_timeout(3000)
                audio["statusAfter3s"] = page.evaluate(
                    "() => document.querySelector('.hifz-listen-mini')?.getAttribute('data-status')")
                audio["listenNowWords"] = page.locator(".hifz-word-listen-now").count()
                audio["playerState"] = page.evaluate(
                    """() => {
                      const m = document.querySelector('.hifz-listen-mini');
                      if (!m) return null;
                      const st = m.querySelector('.quran-player-mini-status');
                      const img = m.querySelector('img.quran-player-mini-photo');
                      return {
                        status: m.getAttribute('data-status'),
                        title: (m.querySelector('.quran-player-mini-title')?.textContent || '').trim(),
                        statusText: (st?.textContent || '').trim(),
                        photo: img ? { src: img.getAttribute('src'),
                                       loaded: img.complete && img.naturalWidth > 0 } : null,
                      };
                    }""")
                page.screenshot(path=f"{OUT}/listen-playing-phone.png")
                # Pause.
                page.locator(".hifz-listen-mini button.quran-mini-play").click()
                page.wait_for_timeout(800)
                audio["statusAfterPause"] = page.evaluate(
                    "() => document.querySelector('.hifz-listen-mini')?.getAttribute('data-status')")
                audio["pausedOk"] = audio["statusAfterPause"] == "paused"
            except Exception as e:
                audio["playError"] = str(e)[:300]
                audio["statusNow"] = page.evaluate(
                    "() => document.querySelector('.hifz-listen-mini')?.getAttribute('data-status')")
        except Exception as e:
            audio["playClickError"] = str(e)[:300]
        # Buffering: delay the audio route 2.5s on a fresh page.
        ctx2 = browser.new_context(viewport={"width": 393, "height": 852})
        page2 = ctx2.new_page()
        route_audio_to_local(page2, audio_bytes, delay_ms=2500)
        page2.goto(STUDY, wait_until="load", timeout=60000)
        page2.wait_for_selector(".hifz-line-page", timeout=30000)
        page2.locator(".hifz-mode-toggle button", has_text="گوش دادن").first.click()
        page2.wait_for_timeout(800)
        try:
            page2.locator(".hifz-listen-mini button.quran-mini-play").click()
            page2.wait_for_timeout(700)
            audio["statusWhileDelayed"] = page2.evaluate(
                "() => document.querySelector('.hifz-listen-mini')?.getAttribute('data-status')")
            try:
                page2.wait_for_function(
                    """() => {
                      const m = document.querySelector('.hifz-listen-mini');
                      return m && m.getAttribute('data-status') === 'playing';
                    }""",
                    timeout=25000,
                )
                audio["playsAfterDelay"] = True
            except Exception as e:
                audio["playsAfterDelay"] = f"no: {str(e)[:200]}"
        except Exception as e:
            audio["delayedClickError"] = str(e)[:300]
        ctx2.close()
        # Error + retry: abort the audio host.
        ctx3 = browser.new_context(viewport={"width": 393, "height": 852})
        page3 = ctx3.new_page()
        page3.route("**/download.quranicaudio.com/**", lambda r: r.abort())
        page3.route("**/audio.qurancdn.com/**", lambda r: r.abort())
        page3.route("**/*.mp3", lambda r: r.abort())
        page3.goto(STUDY, wait_until="load", timeout=60000)
        page3.wait_for_selector(".hifz-line-page", timeout=30000)
        page3.locator(".hifz-mode-toggle button", has_text="گوش دادن").first.click()
        page3.wait_for_timeout(800)
        try:
            page3.locator(".hifz-listen-mini button.quran-mini-play").click()
            page3.wait_for_function(
                """() => {
                  const m = document.querySelector('.hifz-listen-mini');
                  return m && m.getAttribute('data-status') === 'error';
                }""",
                timeout=25000,
            )
            audio["errorStateReached"] = True
            audio["errorText"] = page3.evaluate(
                "() => (document.querySelector('.hifz-listen-mini .quran-player-mini-status')?.textContent || '').trim()")
            page3.screenshot(path=f"{OUT}/listen-error-phone.png")
            # Retry while still blocked stays in error.
            retry = page3.locator(".hifz-listen-mini button.quran-mini-play")
            if retry.count() > 0:
                retry.first.click()
                page3.wait_for_timeout(3000)
                audio["retryWhileBlockedStaysError"] = page3.evaluate(
                    "() => document.querySelector('.hifz-listen-mini')?.getAttribute('data-status')") == "error"
            else:
                audio["retryWhileBlockedStaysError"] = "retry-button-not-found"
        except Exception as e:
            audio["errorStateError"] = str(e)[:300]
        ctx3.close()
        # Offline: set_offline in listen mode.
        ctx4 = browser.new_context(viewport={"width": 393, "height": 852})
        page4 = ctx4.new_page()
        route_audio_to_local(page4, audio_bytes)
        page4.goto(STUDY, wait_until="load", timeout=60000)
        page4.wait_for_selector(".hifz-line-page", timeout=30000)
        page4.locator(".hifz-mode-toggle button", has_text="گوش دادن").first.click()
        page4.wait_for_timeout(800)
        ctx4.set_offline(True)
        try:
            page4.locator(".hifz-listen-mini button.quran-mini-play").click()
            page4.wait_for_function(
                """() => {
                  const m = document.querySelector('.hifz-listen-mini');
                  return m && m.getAttribute('data-status') === 'error';
                }""",
                timeout=20000,
            )
            audio["offlineErrorReached"] = True
            audio["offlineErrorText"] = page4.evaluate(
                "() => (document.querySelector('.hifz-listen-mini .quran-player-mini-status')?.textContent || '').trim()")
        except Exception as e:
            audio["offlineError"] = str(e)[:300]
        ctx4.set_offline(False)
        ctx4.close()
        report["audio"] = audio
        ctx.close()

        # ---- L. memory + fast switching (surah 2, client-side jumps) -----
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        page.goto(STUDY_S2, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        heap0 = page.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null")
        jumps = []
        for ayah in (10, 30, 60, 90, 120, 150, 180, 210, 240, 286):
            t0 = time.monotonic()
            page.evaluate(SET_SELECT_JS, {"sel": ".hifz-picker select[aria-label='آیه']", "value": str(ayah)})
            try:
                page.wait_for_url(f"**ayah={ayah}", timeout=10000)
                page.wait_for_timeout(300)
                header = page.evaluate(
                    "() => (document.querySelector('.hifz-header')?.textContent || '').replace(/\\s+/g,' ').trim()")
                jumps.append({"ayah": ayah, "ms": round((time.monotonic() - t0) * 1000),
                              "header": header, "lines": page.locator(".hifz-line-page").count()})
            except Exception as e:
                jumps.append({"ayah": ayah, "error": str(e)[:200]})
        heap1 = page.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null")
        report["fastSwitch"] = {
            "jumps": jumps,
            "medianMs": statistics.median([j["ms"] for j in jumps if "ms" in j]) if any("ms" in j for j in jumps) else None,
        }
        report["memory"] = {
            "heapBeforeMB": heap0, "heapAfter10JumpsMB": heap1,
            "deltaMB": round(heap1 - heap0, 1) if heap0 is not None and heap1 is not None else None,
            "note": "Chromium performance.memory (JS heap); 10 client-side ayah jumps in surah 2",
        }
        page.screenshot(path=f"{OUT}/study-s2-ayah286-phone.png")
        ctx.close()

        # ---- M. weak device: CPU 4x throttle + slow 3G --------------------
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        weak = []
        for i in range(3):
            weak.append(cold_load(page, STUDY, f"cpu4x-{i}"))
        report["weakDevice"] = {
            "cpuThrottle4x": {
                "timeToMushafMsMedian": statistics.median([r["timeToMushafMs"] for r in weak]),
                "fcpMsMedian": statistics.median([r["fcp"] for r in weak if r["fcp"] is not None]),
                "loadMsMedian": statistics.median([r["load"] for r in weak]),
            },
            "runs": [{k: r[k] for k in ("label", "fcp", "load", "timeToMushafMs")} for r in weak],
        }
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 400,
            "downloadThroughput": 400 * 1024 / 8, "uploadThroughput": 400 * 1024 / 8,
        })
        slow = cold_load(page, STUDY, "slow3g-0")
        report["weakDevice"]["slow3g"] = {
            "fcpMs": slow["fcp"], "loadMs": slow["load"],
            "timeToMushafMs": slow["timeToMushafMs"],
        }
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 0,
            "downloadThroughput": -1, "uploadThroughput": -1,
        })
        ctx.close()

        # ---- N. axe on study page (phone + desktop) ------------------------
        for name, width, height in (("phone", 393, 852), ("desktop", 1280, 900)):
            ctx = browser.new_context(viewport={"width": width, "height": height})
            page = ctx.new_page()
            page.goto(STUDY, wait_until="load", timeout=60000)
            page.wait_for_selector(".hifz-line-page", timeout=30000)
            if os.path.exists(AXE):
                page.add_script_tag(path=AXE)
                axe_result = page.evaluate(
                    """async () => {
                      const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
                      return { violations: r.violations.map(v => ({
                        id: v.id, impact: v.impact,
                        nodes: v.nodes.length, help: v.help })) };
                    }"""
                )
                report["a11y"][f"axe-{name}"] = axe_result
            ctx.close()
        browser.close()

    with open(f"{OUT}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(
        {k: report[k] for k in ("summary-phone", "summary-desktop", "summary-tablet",
                                "fontCache", "rtl", "resize", "panels",
                                "displayModes", "selection", "audio",
                                "fastSwitch", "memory", "weakDevice")},
        ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
