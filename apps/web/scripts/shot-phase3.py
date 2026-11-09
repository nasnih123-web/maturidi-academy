"""Phase 3 (hifz redesign) render verification: screenshots + DOM checks.

- Study page (V2 primary): surah 1 (page 1), surah 2 ayah 1
  (page 2, basmala + surah change), surah 18 ayah 1 (page 293,
  mid-Quran), surah 114 (page 604).
- Reader page view with the printed SVG blocked: the V2 text page
  is the fallback (words visible, so line breaks can be eyeballed).
- For every shot: horizontal-overflow check + console errors.
- Study pages are blank pre-record by design (unwritten words are
  hidden), so the script also dumps the hidden-word DOM structure
  (lines + words per line) for comparison with the V2 data.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/quran-hifz-shots-redesign/phase3"

SHOTS = [
    # (name, url, block_svg, viewport)
    ("study-p1-phone", "/fa/quran/1?tab=hifz", False, (393, 852)),
    ("study-p1-desktop", "/fa/quran/1?tab=hifz", False, (1280, 900)),
    ("study-p2-phone", "/fa/quran/2?tab=hifz&ayah=1", False, (393, 852)),
    ("study-p2-desktop", "/fa/quran/2?tab=hifz&ayah=1", False, (1280, 900)),
    ("study-p293-phone", "/fa/quran/18?tab=hifz&ayah=1", False, (393, 852)),
    ("study-p293-desktop", "/fa/quran/18?tab=hifz&ayah=1", False, (1280, 900)),
    ("study-p604-phone", "/fa/quran/114?tab=hifz", False, (393, 852)),
    ("reader-v2-p1-phone", "/fa/quran/1?view=page&target=1", True, (393, 852)),
    ("reader-v2-p1-desktop", "/fa/quran/1?view=page&target=1", True, (1280, 900)),
    ("reader-v2-p2-desktop", "/fa/quran/2?view=page&target=2", True, (1280, 900)),
    ("reader-v2-p293-desktop", "/fa/quran/18?view=page&target=293", True, (1280, 900)),
    ("reader-v2-p604-desktop", "/fa/quran/114?view=page&target=604", True, (1280, 900)),
]

STUDY_DOM_JS = """() => {
  const page = document.querySelector('.hifz-line-page');
  if (!page) return { error: 'no .hifz-line-page' };
  const lines = [...page.querySelectorAll('.hifz-line, .hifz-line-basmala')].map((el) => {
    const words = [...el.querySelectorAll('[data-word-key]')].map((w) => w.getAttribute('data-word-key'));
    const hidden = [...el.querySelectorAll('.hifz-line-word-hidden')].map((w) => w.textContent);
    return { cls: el.className, words, hidden };
  });
  const caption = page.querySelector('.hifz-line-caption')?.textContent ?? '';
  return { caption, lineCount: lines.length, lines };
}"""

READER_DOM_JS = """() => {
  const page = document.querySelector('.mushaf-v2');
  if (!page) return { error: 'no .mushaf-v2 (SVG may have loaded instead)' };
  const lines = [...page.querySelectorAll('.mushaf-v2-line')].map((el) => ({
    cls: el.className,
    words: [...el.querySelectorAll('[data-word-key]')].map((w) => w.getAttribute('data-word-key')),
    text: el.textContent,
  }));
  const meta = page.querySelector('.mushaf-meta')?.textContent ?? '';
  return { meta, lineCount: lines.length, lines };
}"""

OVERFLOW_JS = """() => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
})"""


def main() -> int:
    import os
    os.makedirs(OUT, exist_ok=True)
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, url, block_svg, (w, h) in SHOTS:
            page = browser.new_page(viewport={"width": w, "height": h})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            if block_svg:
                page.route(
                    "**/svg/*.svg",
                    lambda route: route.abort(),
                )
            page.goto(BASE + url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2500)
            dom = page.evaluate(STUDY_DOM_JS if "study-" in name else READER_DOM_JS)
            ovf = page.evaluate(OVERFLOW_JS)
            shot = f"{OUT}/{name}.png"
            page.screenshot(path=shot, full_page=True)
            report[name] = {"url": url, "overflow": ovf, "errors": errors, "dom": dom}
            print(f"{name}: overflow={ovf['overflow']} errors={len(errors)} dom={json.dumps(dom)[:200]}")
            page.close()
        browser.close()
    with open(f"{OUT}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
