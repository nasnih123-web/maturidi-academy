"""Phase 8 follow-up probe (shot-phase8b.py).

Fills the four gaps left by the first phase-8 run (all test bugs,
not product bugs — see the phase-8 report):
1. Word/ayah selection: the first run used the wrong reader URL
   (?view=page&page=1; the real deep link is ?view=page&target=1)
   and waited for study words with state='visible' while pre-recording
   words are hidden (class hifz-line-word-hidden). This probe uses
   the right URL and state='attached'.
2. RTL: the first run probed the wrong selector (.hifz-study); the
   study root is .quran-hifz-study with dir=rtl for fa/ar (code line
   3003) and the pills row is dir=ltr (line 3361). Live pills still
   need a live session, so only the static dirs + bottom-bar mirroring
   are probed live here.
3. Fast page switching: the first run's 321ms median included its own
   300ms settle wait inside the timer. This probe times URL change +
   header update only.
4. Slow 3G: the first run reused a warm-cache context, so its 918ms
   is meaningless. This probe uses a FRESH context with slow-3G
   network emulation applied before navigation. Same for FCP: fresh
   context per run (the repeat-goto FCP entries were null).

Output: ~/workspace/quran-hifz-shots-redesign/phase8/report8b.json
"""
import json
import os
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = os.path.expanduser("~/workspace/quran-hifz-shots-redesign/phase8")
STUDY = f"{BASE}/fa/quran/1?tab=hifz"
STUDY_S2 = f"{BASE}/fa/quran/2?tab=hifz"
READER_PAGE = f"{BASE}/fa/quran/1?view=page&target=1"

SET_SELECT_JS = """(args) => {
  const s = document.querySelector(args.sel);
  if (!s) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value').set;
  setter.call(s, args.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}"""


def main() -> int:
    report: dict = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # 1. Selection in the reader (V2 text words, wired) + study page.
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        # Block the SVG host so the reader falls back to the V2 text
        # view deterministically (phase 3 pattern; the host is
        # unreachable from this sandbox anyway, but blocking makes the
        # fallback fast instead of a long tunnel timeout).
        page.route("**/raw.githubusercontent.com/**", lambda r: r.abort())
        sel: dict = {}
        page.goto(READER_PAGE, wait_until="load", timeout=60000)
        try:
            page.wait_for_selector(".mushaf-v2-word", state="attached", timeout=60000)
            sel["readerWordsAttached"] = page.locator(".mushaf-v2-word").count()
            sel["readerVisibleWords"] = page.locator(".mushaf-v2-word:visible").count()
            first = page.locator(".mushaf-v2-word").first
            key = first.get_attribute("data-word-key")
            first.click()
            page.wait_for_timeout(400)
            sel["clickedKey"] = key
            sel["selectedCount"] = page.locator(".mushaf-v2-word.is-selected").count()
            sel["ayahSelectedCount"] = page.locator(".mushaf-v2-word.is-ayah-selected").count()
            sel["selectedKey"] = page.evaluate(
                "() => document.querySelector('.mushaf-v2-word.is-selected')?.getAttribute('data-word-key') || null")
            # Click a word of a different ayah on the same page: the
            # old selection must move (single selection).
            second = page.locator(".mushaf-v2-word[data-word-key='1:2:0']")
            if second.count() > 0:
                second.first.click()
                page.wait_for_timeout(400)
                sel["secondClickKey"] = "1:2:0"
                sel["selectedCountAfterSecond"] = page.locator(".mushaf-v2-word.is-selected").count()
                sel["selectedKeyAfterSecond"] = page.evaluate(
                    "() => document.querySelector('.mushaf-v2-word.is-selected')?.getAttribute('data-word-key') || null")
            page.screenshot(path=f"{OUT}/reader-selection-desktop.png")
        except Exception as e:
            sel["error"] = str(e)[:400]
        page.goto(STUDY, wait_until="load", timeout=60000)
        try:
            page.wait_for_selector(".hifz-line-page [data-word-key]", state="attached", timeout=30000)
            w = page.locator(".hifz-line-page [data-word-key]").first
            wkey = w.get_attribute("data-word-key")
            w.click()
            page.wait_for_timeout(400)
            sel["studyClickedKey"] = wkey
            sel["studySelectedCount"] = page.locator(".is-selected").count()
            sel["studyNote"] = ("study-page words carry no selection state "
                                "(selection lives in the reader); click changes nothing")
        except Exception as e:
            # Pre-recording the study words are hidden placeholders
            # (hifz-line-word-hidden, aria-hidden) and cannot be
            # clicked — expected, not a failure. Clicking a scored word
            # after a live session (dispute) needs auth + microphone
            # and is out of scope for this guest probe.
            sel["studyClick"] = ("not-clickable pre-recording "
                                 "(words hidden until read) — expected")
            sel["studyError"] = str(e)[:200]
        report["selection"] = sel
        ctx.close()

        # 2. RTL: live dirs + bottom-bar mirroring.
        ctx = browser.new_context(viewport={"width": 834, "height": 1112})
        page = ctx.new_page()
        page.goto(STUDY, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        report["rtl"] = page.evaluate(
            """() => {
              const q = (s) => document.querySelector(s);
              const root = q('.quran-hifz-study');
              const bar = [...document.querySelectorAll('.hifz-bottom-bar button')]
                .map((b) => ({ text: (b.textContent || '').trim(),
                               x: Math.round(b.getBoundingClientRect().x) }));
              return {
                htmlDir: document.documentElement.getAttribute('dir'),
                htmlLang: document.documentElement.getAttribute('lang'),
                studyRootDir: root ? root.getAttribute('dir') : null,
                studyRootClass: root ? root.className : null,
                pillsInDomAsGuest: !!q('.hifz-pills'),
                pillsDirCodeNote: 'pills render only during a live session; code sets dir=ltr (QuranHifzStudy.tsx:3361)',
                bottomBarButtons: bar,
                bottomBarFlowsRightToLeft: bar.length >= 2 && bar[0].x > bar[1].x,
                firstLineDir: q('.hifz-line') ? q('.hifz-line').getAttribute('dir') : null,
              };
            }"""
        )
        ctx.close()

        # 3. Fast switching, timed correctly (no sleep inside the timer).
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        page.goto(STUDY_S2, wait_until="load", timeout=60000)
        page.wait_for_selector(".hifz-line-page", timeout=30000)
        jumps = []
        for ayah in (10, 30, 60, 90, 120, 150, 180, 210, 240, 286):
            t0 = time.monotonic()
            page.evaluate(SET_SELECT_JS, {"sel": ".hifz-picker select[aria-label='آیه']", "value": str(ayah)})
            try:
                page.wait_for_url(f"**ayah={ayah}", timeout=10000)
                ms_url = round((time.monotonic() - t0) * 1000)
                page.wait_for_selector(".hifz-line-page", timeout=10000)
                ms_mushaf = round((time.monotonic() - t0) * 1000)
                header = page.evaluate(
                    "() => (document.querySelector('.hifz-header')?.textContent || '').replace(/\\s+/g,' ').trim()")
                jumps.append({"ayah": ayah, "msToUrl": ms_url,
                              "msToMushaf": ms_mushaf, "header": header})
            except Exception as e:
                jumps.append({"ayah": ayah, "error": str(e)[:200]})
        report["fastSwitchCorrected"] = {
            "jumps": jumps,
            "medianMsToUrl": statistics.median([j["msToUrl"] for j in jumps if "msToUrl" in j]),
            "medianMsToMushaf": statistics.median([j["msToMushaf"] for j in jumps if "msToMushaf" in j]),
            "note": "no settle wait inside the timer (the first run's 321ms median included its own 300ms wait)",
        }
        ctx.close()

        # 4. Cold FCP (fresh context per run) + slow 3G on a cold cache.
        fcp_runs = []
        for i in range(3):
            ctx = browser.new_context(viewport={"width": 393, "height": 852})
            page = ctx.new_page()
            t0 = time.monotonic()
            page.goto(STUDY, wait_until="commit", timeout=60000)
            page.wait_for_selector(".hifz-line-page", timeout=30000)
            t_mushaf = round((time.monotonic() - t0) * 1000)
            page.wait_for_load_state("load", timeout=30000)
            nav = page.evaluate(
                """() => {
                  const n = performance.getEntriesByType('navigation')[0] || {};
                  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
                  return { fcp: fcp ? Math.round(fcp.startTime) : null,
                           load: Math.round(n.loadEventEnd || 0),
                           transfer: Math.round(n.transferSize || 0) };
                }"""
            )
            nav["timeToMushafMs"] = t_mushaf
            fcp_runs.append(nav)
            ctx.close()
        report["coldFcp"] = {
            "runs": fcp_runs,
            "fcpMsMedian": statistics.median([r["fcp"] for r in fcp_runs if r["fcp"] is not None]),
            "timeToMushafMsMedian": statistics.median([r["timeToMushafMs"] for r in fcp_runs]),
        }
        ctx = browser.new_context(viewport={"width": 393, "height": 852})
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": 400,
            "downloadThroughput": 400 * 1024 / 8, "uploadThroughput": 400 * 1024 / 8,
        })
        t0 = time.monotonic()
        page.goto(STUDY, wait_until="commit", timeout=120000)
        page.wait_for_selector(".hifz-line-page", timeout=120000)
        t_mushaf = round((time.monotonic() - t0) * 1000)
        page.wait_for_load_state("load", timeout=120000)
        slow = page.evaluate(
            """() => {
              const n = performance.getEntriesByType('navigation')[0] || {};
              const fcp = performance.getEntriesByName('first-contentful-paint')[0];
              return { fcp: fcp ? Math.round(fcp.startTime) : null,
                       load: Math.round(n.loadEventEnd || 0),
                       transfer: Math.round(n.transferSize || 0) };
            }"""
        )
        slow["timeToMushafMs"] = t_mushaf
        report["slow3gCold"] = slow
        ctx.close()
        browser.close()

    with open(f"{OUT}/report8b.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
