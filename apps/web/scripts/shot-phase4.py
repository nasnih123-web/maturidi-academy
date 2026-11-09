"""Phase 4 (hifz redesign) render verification: screenshots + DOM checks.

Guest (unauthenticated) study page states — the Phase 4 controls are
usable without sign-in (settings fall back to localStorage):
- default study page (phone + desktop)
- range picker filled + repeat counts
- settings sheet open (freeze OFF by default)
- hide-the-script ON (dotted placeholders)
- error sheet open (empty state as guest; the grouped server sheet
  needs an authed session with graded words)
- hub page (guest: the auth gate / sign-in notice)

For every shot: horizontal-overflow check + console errors.
The resume banner and the grouped mistake sheet need an authed
session and are verified by API tests, not by these shots.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/quran-hifz-shots-redesign/phase4"

OVERFLOW_JS = """() => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
})"""

STATE_JS = """() => {
  const root = document.querySelector('.quran-hifz-study');
  if (!root) return { error: 'no .quran-hifz-study' };
  return {
    hasRange: !!root.querySelector('.hifz-range'),
    hasSettingsSheet: !!root.querySelector('[aria-label] .hifz-setting-row, .hifz-setting-row'),
    concealed: root.querySelectorAll('.hifz-line-word-concealed').length,
    settingsOpen: !!document.querySelector('.hifz-setting-row'),
    errorSheetOpen: !!document.querySelector('.hifz-error-sheet'),
    resumeBanner: !!root.querySelector('.hifz-resume-banner'),
    freezeHold: !!root.querySelector('.hifz-error[role="alert"]'),
    bottomBarButtons: [...root.querySelectorAll('.hifz-bottom-bar button')].map(b => b.textContent.trim()),
  };
}"""


def main() -> int:
    import os

    os.makedirs(OUT, exist_ok=True)
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h, suffix in [(393, 852, "phone"), (1280, 900, "desktop")]:
            # 1. Default study page.
            page = browser.new_page(viewport={"width": w, "height": h})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{BASE}/fa/quran/1?tab=hifz", wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2500)
            ovf = page.evaluate(OVERFLOW_JS)
            page.screenshot(path=f"{OUT}/study-default-{suffix}.png", full_page=True)
            report[f"study-default-{suffix}"] = {
                "overflow": ovf,
                "errors": errors,
                "state": page.evaluate(STATE_JS),
            }
            print(f"study-default-{suffix}: overflow={ovf['overflow']} errors={len(errors)}")
            # 2. Range picker filled + repeat counts.
            page.locator(".hifz-range input").nth(0).fill("2")
            page.locator(".hifz-range input").nth(1).fill("5")
            page.locator(".hifz-range input").nth(2).fill("3")
            page.wait_for_timeout(500)
            page.screenshot(path=f"{OUT}/study-range-{suffix}.png", full_page=True)
            report[f"study-range-{suffix}"] = {"overflow": page.evaluate(OVERFLOW_JS), "errors": errors}
            print(f"study-range-{suffix}: done")
            # 3. Settings sheet open.
            page.get_by_role("button", name="تنظیمات").click()
            page.wait_for_timeout(800)
            page.screenshot(path=f"{OUT}/study-settings-{suffix}.png", full_page=True)
            report[f"study-settings-{suffix}"] = {
                "overflow": page.evaluate(OVERFLOW_JS),
                "errors": errors,
                "state": page.evaluate(STATE_JS),
            }
            print(f"study-settings-{suffix}: settingsOpen={page.evaluate(STATE_JS).get('settingsOpen')}")
            page.keyboard.press("Escape")
            page.locator(".hifz-error-sheet button").first.click()
            page.wait_for_timeout(300)
            # 4. Hide the script ON (crossed-eye toggle in the bottom bar).
            page.get_by_role("button", name="پنهان‌کردن متن").click()
            page.wait_for_timeout(800)
            page.screenshot(path=f"{OUT}/study-hidden-{suffix}.png", full_page=True)
            report[f"study-hidden-{suffix}"] = {
                "overflow": page.evaluate(OVERFLOW_JS),
                "errors": errors,
                "state": page.evaluate(STATE_JS),
            }
            print(f"study-hidden-{suffix}: concealed={page.evaluate(STATE_JS).get('concealed')}")
            # 5. Error sheet open (guest: empty state).
            page.get_by_role("button", name="خطاها").click()
            page.wait_for_timeout(800)
            page.screenshot(path=f"{OUT}/study-errors-{suffix}.png", full_page=True)
            report[f"study-errors-{suffix}"] = {
                "overflow": page.evaluate(OVERFLOW_JS),
                "errors": errors,
                "state": page.evaluate(STATE_JS),
            }
            print(f"study-errors-{suffix}: errorSheetOpen={page.evaluate(STATE_JS).get('errorSheetOpen')}")
            page.close()
        # 6. Hub page (guest).
        page = browser.new_page(viewport={"width": 393, "height": 852})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{BASE}/fa/quran/hifz", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/hub-guest-phone.png", full_page=True)
        report["hub-guest-phone"] = {"overflow": page.evaluate(OVERFLOW_JS), "errors": errors}
        print(f"hub-guest-phone: overflow={page.evaluate(OVERFLOW_JS)['overflow']} errors={len(errors)}")
        page.close()
        browser.close()
    with open(f"{OUT}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
