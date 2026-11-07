"""Phase 6 (hifz redesign) — EXACT UI MATCHING verification.

Before/after comparison script (same views, same viewports).
Run against the production build (:3000) + local API (:8000, live
Zipformer engine + phoneme map for the pills-live shot).

Captures (phone 393px + desktop 1280px unless noted):
- study-default: surah 8 (Anfal, V2 page 182 — the reference frames)
- study-settings / study-errors: the two bottom sheets open
- listen-playing: real Alafasy audio routed locally (Range-aware)
- pills-live (phone only, authed test user + fake mic device):
  the live pills row (error / accuracy / timer) while listening
- reader-overlap: the reader's fixed glass mini player vs page
  content — measures the rect intersection at the bottom of the page
- hub: the hifz hub page

For every shot: horizontal-overflow check + console errors +
a DOM audit (header text, pill text/computed colors, mic rect,
bottom-bar tap targets, digit script used).
"""
import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
AUDIO_PATH = "/tmp/phase5-alafasy-1.mp3"

OVERFLOW_JS = """() => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
})"""

AUDIT_JS = """() => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const cs = (el) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, color: c.color, fontSize: c.fontSize,
             minHeight: c.minHeight, height: c.height, borderRadius: c.borderRadius };
  };
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const root = q('.quran-hifz-study');
  const pills = qa('.hifz-pills .hifz-pill').map((p) => ({
    text: (p.textContent || '').trim(), cls: p.className, style: cs(p),
  }));
  const header = q('.hifz-header');
  return {
    headerText: header ? header.textContent.replace(/\\s+/g, ' ').trim() : null,
    pills,
    mic: rect(q('.hifz-mic-3d')),
    micStyle: cs(q('.hifz-mic-3d')),
    bottomBar: qa('.hifz-bottom-bar button').map((b) => ({
      text: (b.textContent || '').trim(), rect: rect(b), disabled: b.disabled,
    })),
    settingsOpen: !!q('.hifz-setting-row'),
    errorSheetOpen: !!q('.hifz-error-sheet'),
    errorCards: qa('.hifz-error-card').length,
    listenMini: (() => {
      const m = q('.hifz-listen-mini');
      if (!m) return null;
      const t = m.querySelector('.quran-player-mini-title');
      const s = m.querySelector('.quran-player-mini-status');
      return { status: m.getAttribute('data-status'),
               title: t ? t.textContent.trim() : null,
               statusText: s ? s.textContent.trim() : null,
               badges: qa('.hifz-listen-mini .hifz-mini-badge').map(b => b.textContent.trim()),
               rect: rect(m), spacer: !!q('.hifz-listen-spacer') };
    })(),
    overflow: { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
                overflow: document.documentElement.scrollWidth > window.innerWidth },
  };
}"""

READER_AUDIT_JS = """() => {
  const mini = document.querySelector('.quran-player-mini:not(.quran-player-mini-hidden)');
  if (!mini) return { error: 'no visible reader mini player' };
  const mr = mini.getBoundingClientRect();
  const hit = [];
  for (const el of document.querySelectorAll('body *')) {
    if (mini.contains(el) || el === mini) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) continue;
    const oy = Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top);
    const ox = Math.min(r.right, mr.right) - Math.max(r.left, mr.left);
    if (oy > 6 && ox > 20) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      hit.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 50),
                 text: (el.textContent || '').trim().slice(0, 50), oy: Math.round(oy) });
    }
  }
  return {
    miniRect: { y: Math.round(mr.y), h: Math.round(mr.height), bottom: Math.round(mr.bottom) },
    viewportH: window.innerHeight,
    docScrollH: document.documentElement.scrollHeight,
    coveredCount: hit.length,
    covered: hit.slice(-6),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
}"""

# Pill-style probe: the live pills only render during a real session
# (which this sandbox's CPU cannot drive — see phase 6 notes), so
# the stylesheet itself is probed with temporary elements carrying
# the exact pill classes; they are removed right after measuring.
# This verifies colors/contrast, not the live session.
PILL_STYLE_JS = """() => {
  const host = document.createElement('div');
  host.className = 'quran-hifz-study';
  host.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(host);
  const out = {};
  for (const cls of ['hifz-pill-red', 'hifz-pill-green', 'hifz-pill-lime', 'hifz-pill-amber', 'hifz-pill-gray']) {
    const el = document.createElement('span');
    el.className = `hifz-pill ${cls}`;
    el.textContent = '٩٦٫٥٪';
    host.appendChild(el);
    const c = getComputedStyle(el);
    out[cls] = { bg: c.backgroundColor, color: c.color };
  }
  host.remove();
  return out;
}"""


def fulfill_audio(route, audio_bytes):
    total = len(audio_bytes)
    rng = route.request.headers.get("range")
    m = re.match(r"bytes=(\d+)-(\d*)", rng) if rng else None
    if m:
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else total - 1
        end = min(end, total - 1)
        route.fulfill(
            status=206, content_type="audio/mpeg",
            headers={"Accept-Ranges": "bytes",
                     "Content-Range": f"bytes {start}-{end}/{total}",
                     "Content-Length": str(end - start + 1)},
            body=audio_bytes[start:end + 1],
        )
    else:
        route.fulfill(status=200, content_type="audio/mpeg",
                      headers={"Accept-Ranges": "bytes", "Content-Length": str(total)},
                      body=audio_bytes)


def wait_status(page, wanted, timeout=25000):
    page.wait_for_function(
        """(wanted) => {
          const m = document.querySelector('.hifz-listen-mini');
          return m && m.getAttribute('data-status') === wanted;
        }""",
        arg=wanted, timeout=timeout,
    )


def goto_study(page, surah=8):
    page.goto(f"{BASE}/fa/quran/{surah}?tab=hifz", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(2500)
    page.wait_for_selector(".quran-hifz-study", timeout=20000)
    page.wait_for_timeout(1500)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["before", "after"], required=True)
    args = ap.parse_args()
    out = f"/home/hatch/workspace/quran-hifz-shots-redesign/phase6/{args.stage}"
    os.makedirs(out, exist_ok=True)
    with open(AUDIO_PATH, "rb") as f:
        audio_bytes = f.read()
    tokens = json.load(open("/tmp/phase6-tokens.json"))
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        for w, h, suffix in [(393, 852, "phone"), (1280, 900, "desktop")]:
            # ---- Guest: default study page (surah 8). ----
            page = browser.new_page(viewport={"width": w, "height": h})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("**/download.quranicaudio.com/**",
                       lambda route: fulfill_audio(route, audio_bytes))
            goto_study(page, 8)
            page.screenshot(path=f"{out}/study-default-{suffix}.png")
            report[f"study-default-{suffix}"] = {
                "audit": page.evaluate(AUDIT_JS), "errors": errors}
            print(f"[{suffix}] default header: {report[f'study-default-{suffix}']['audit']['headerText']!r}")

            # ---- Settings sheet open. ----
            page.get_by_role("button", name="تنظیمات", exact=True).click()
            page.wait_for_timeout(600)
            page.screenshot(path=f"{out}/study-settings-{suffix}.png")
            report[f"study-settings-{suffix}"] = {
                "audit": page.evaluate(AUDIT_JS), "errors": errors}
            page.keyboard.press("Escape")
            page.get_by_role("button", name="بستن", exact=True).first.click()
            page.wait_for_timeout(400)

            # ---- Error sheet open (guest: empty state). ----
            page.get_by_role("button", name="نمایش خطاها", exact=True).click()
            page.wait_for_timeout(600)
            page.screenshot(path=f"{out}/study-errors-{suffix}.png")
            report[f"study-errors-{suffix}"] = {
                "audit": page.evaluate(AUDIT_JS), "errors": errors}
            page.get_by_role("button", name="بستن", exact=True).first.click()
            page.wait_for_timeout(400)

            # ---- Listen mode playing. ----
            page.get_by_role("button", name="گوش دادن", exact=True).click()
            page.wait_for_timeout(800)
            page.locator(".hifz-listen-mini .quran-mini-play").click()
            try:
                wait_status(page, "playing")
                page.wait_for_timeout(3000)
            except Exception as e:
                print(f"[{suffix}] listen did not reach playing: {e}")
            page.screenshot(path=f"{out}/listen-playing-{suffix}.png")
            report[f"listen-playing-{suffix}"] = {
                "audit": page.evaluate(AUDIT_JS), "errors": errors}
            print(f"[{suffix}] listen: {report[f'listen-playing-{suffix}']['audit']['listenMini']}")
            page.close()

            # ---- Reader: fixed mini-player overlap at page bottom. ----
            page = browser.new_page(viewport={"width": w, "height": h})
            errors2 = []
            page.on("console", lambda m: errors2.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors2.append(str(e)))
            page.route("**/download.quranicaudio.com/**",
                       lambda route: fulfill_audio(route, audio_bytes))
            page.goto(f"{BASE}/fa/quran/8", wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2500)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(800)
            page.screenshot(path=f"{out}/reader-bottom-{suffix}.png")
            report[f"reader-bottom-{suffix}"] = {
                "audit": page.evaluate(READER_AUDIT_JS), "errors": errors2}
            print(f"[{suffix}] reader overlap: {report[f'reader-bottom-{suffix}']['audit']}")
            page.close()

            # ---- Hub page. ----
            page = browser.new_page(viewport={"width": w, "height": h})
            errors3 = []
            page.on("console", lambda m: errors3.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors3.append(str(e)))
            page.goto(f"{BASE}/fa/quran/hifz", wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{out}/hub-{suffix}.png")
            report[f"hub-{suffix}"] = {
                "overflow": page.evaluate(OVERFLOW_JS), "errors": errors3}
            page.close()

        # ---- V2 header probe (phone): surah 5 ayah 77 must say
        # page 120 (V2), not 121 (QPC1). + pill stylesheet probe. ----
        page = browser.new_page(viewport={"width": 393, "height": 852})
        page.goto(f"{BASE}/fa/quran/5?tab=hifz&ayah=77", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(4000)
        header_text = page.locator(".hifz-header-sub").inner_text().replace("\n", " ")
        caption = page.locator(".hifz-line-caption").first.inner_text() if page.locator(".hifz-line-caption").count() else None
        print(f"V2 header 5:77: {header_text!r} | caption: {caption!r}")
        report["v2-header-5-77"] = {"header": header_text, "caption": caption}
        report["pill-styles"] = page.evaluate(PILL_STYLE_JS)
        print(f"pill styles: {report['pill-styles']}")
        page.close()

        # ---- Pills live (phone only): authed + fake mic device. ----
        browser2 = p.chromium.launch(args=[
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
        ])
        page = browser2.new_page(viewport={"width": 393, "height": 852})
        errors4 = []
        page.on("console", lambda m: errors4.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors4.append(str(e)))
        page.route("**/download.quranicaudio.com/**",
                   lambda route: fulfill_audio(route, audio_bytes))
        page.goto(f"{BASE}/fa/quran/8?tab=hifz", wait_until="networkidle", timeout=60000)
        page.evaluate(
            """([a, r]) => {
              localStorage.setItem('ma.access_token', a);
              localStorage.setItem('ma.refresh_token', r);
            }""",
            [tokens["access_token"], tokens["refresh_token"]],
        )
        page.reload(wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)
        page.wait_for_selector(".quran-hifz-study", timeout=20000)
        mic = page.locator(".hifz-mic-3d")
        try:
            mic.wait_for(state="visible", timeout=10000)
            disabled = mic.is_disabled()
            print(f"pills-live: mic disabled={disabled}")
            if not disabled:
                mic.click()
                page.wait_for_selector(".hifz-pills", timeout=20000)
                page.wait_for_timeout(6000)
                page.screenshot(path=f"{out}/study-pills-live-phone.png")
                report["study-pills-live-phone"] = {
                    "audit": page.evaluate(AUDIT_JS), "errors": errors4}
                print(f"pills-live: {report['study-pills-live-phone']['audit']['pills']}")
            else:
                report["study-pills-live-phone"] = {
                    "error": "mic disabled while authed", "errors": errors4}
        except Exception as e:
            page.screenshot(path=f"{out}/study-pills-live-phone.png")
            report["study-pills-live-phone"] = {
                "error": f"pills did not appear: {e}",
                "audit": page.evaluate(AUDIT_JS), "errors": errors4}
        page.close()
        browser2.close()
        browser.close()
    with open(f"{out}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
