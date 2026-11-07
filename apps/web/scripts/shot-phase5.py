"""Phase 5 (hifz redesign) playback verification: Playwright.

Drives the listen-mode player on the real study page with REAL
audio (Al-Alafasy, surah 1 — the same recording the Quran.com v4
timing segments describe; the file is served locally from
/tmp/phase5-alafasy-1.mp3 so the transfer is local, the content is
real) and REAL word timings (local API -> Quran.com API v4).

Checks (phone 393px full suite, desktop 1280px playing suite):
- mini player appears in listen mode; play -> playing status +
  real word highlight (.hifz-word-listen-now) in the V2 mushaf
- ayah repeat with count 2: ayah 1 is still current 8s after play
  started (it is 6.09s long, so without the repeat it would have
  advanced), then advances to ayah 2
- speed badge cycles 1 -> 1.25 -> 1.5 -> 1.75 -> 0.5 (Tarteel set)
- pause / resume, next / prev ayah
- position persistence: pause, reload, resume chip, resume plays
  the saved ayah
- range-repeat badge shows the remaining passes
- network-error path: audio host aborted -> honest error state
  (not a hang), retry stays in error while blocked, retry after
  unblocking plays again

For every shot: horizontal-overflow check + console errors.
"""
import json
import re
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/quran-hifz-shots-redesign/phase5"
AUDIO_PATH = "/tmp/phase5-alafasy-1.mp3"

OVERFLOW_JS = """() => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  overflow: document.documentElement.scrollWidth > window.innerWidth,
})"""

PLAYER_JS = """() => {
  const mini = document.querySelector('.hifz-listen-mini');
  if (!mini) return { error: 'no .hifz-listen-mini' };
  const title = mini.querySelector('.quran-player-mini-title');
  const status = mini.querySelector('.quran-player-mini-status');
  const img = mini.querySelector('img.quran-player-mini-photo');
  const badges = [...mini.querySelectorAll('.hifz-mini-badge')].map(b => b.textContent.trim());
  return {
    status: mini.getAttribute('data-status'),
    title: title ? title.textContent.trim() : null,
    statusText: status ? status.textContent.trim() : null,
    photo: img ? { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 } : null,
    badges,
    listenNow: document.querySelectorAll('.hifz-word-listen-now').length,
    spacer: !!document.querySelector('.hifz-listen-spacer'),
  };
}"""


def mini_title_ayah(page):
    state = page.evaluate(PLAYER_JS)
    title = state.get("title") or ""
    # Title ends with "N/M" (current/total ayah).
    tail = title.rsplit(" ", 1)[-1] if title else ""
    try:
        return int(tail.split("/")[0])
    except (ValueError, IndexError):
        return None


def wait_status(page, wanted, timeout=25000):
    page.wait_for_function(
        """(wanted) => {
          const m = document.querySelector('.hifz-listen-mini');
          return m && m.getAttribute('data-status') === wanted;
        }""",
        arg=wanted,
        timeout=timeout,
    )


def fulfill_audio(route, audio_bytes):
    """Fulfill the audio-host route with the real mp3, Range-aware.

    Chromium seeks in an mp3 by issuing a ranged request; when the
    response to a seek is a plain 200 with the whole file, the seek
    silently fails and currentTime snaps back to ~0 (observed: the
    player advanced to ayah 2 in code — logs proved it — yet the clock
    reset to 0.09 and the title stayed on 1/7). A naive 200-only route
    therefore makes every ayah advance look broken.
    """
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


def mini_click(page, selector):
    """Click a button inside the fixed mini player (real pointer
    click; runs against the production build, where no dev overlay
    sits over the fixed bottom bar)."""
    page.locator(selector).click()


def main() -> int:
    with open(AUDIO_PATH, "rb") as f:
        audio_bytes = f.read()
    os.makedirs(OUT, exist_ok=True)
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--autoplay-policy=no-user-gesture-required"]
        )
        # ---- Phone: full suite. ----
        page = browser.new_page(viewport={"width": 393, "height": 852})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(
            "**/download.quranicaudio.com/**",
            lambda route: fulfill_audio(route, audio_bytes),
        )
        page.goto(f"{BASE}/fa/quran/1?tab=hifz", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)
        # Switch to listen mode.
        page.get_by_role("button", name="گوش دادن", exact=True).click()
        page.wait_for_timeout(800)
        state = page.evaluate(PLAYER_JS)
        assert "error" not in state, f"mini player missing: {state}"
        assert state["spacer"] is True, "listen spacer missing (player would cover text)"
        print(f"mini player present: photo={state['photo']} title={state['title']!r}")
        report["phone-mini-present"] = {"state": state, "errors": errors}

        # Repeat: ayah count 2 + mode ayah, BEFORE starting playback.
        page.locator(".hifz-range input").nth(2).fill("2")
        page.locator(".hifz-listen-controls select").nth(1).select_option("ayah")
        page.wait_for_timeout(400)
        state = page.evaluate(PLAYER_JS)
        print(f"repeat-ayah badge: {state['badges']}")
        assert any("×" in b for b in state["badges"]), f"repeat badge shows no count: {state['badges']}"
        report["phone-repeat-badge"] = {"state": state}

        # Play (mini-player play button).
        mini_click(page, ".hifz-listen-mini .quran-mini-play")
        wait_status(page, "playing")
        page.wait_for_timeout(3000)
        state = page.evaluate(PLAYER_JS)
        print(f"playing: {state}")
        assert state["listenNow"] >= 1, f"no real word highlight while playing: {state}"
        assert state["photo"] and state["photo"]["src"].startswith("https://upload.wikimedia.org/"), (
            f"reciter photo missing/wrong src: {state['photo']}"
        )
        # `loaded` is recorded, not asserted: this sandbox's browser
        # proxy blocks upload.wikimedia.org (ERR_TUNNEL_CONNECTION_FAILED)
        # while curl reaches the same URL with 200.
        page.screenshot(path=f"{OUT}/listen-playing-phone.png")
        report["phone-playing"] = {
            "overflow": page.evaluate(OVERFLOW_JS),
            "errors": errors,
            "state": state,
        }

        # Ayah repeat, real timing: ayah 1 lasts 6.09s at 1x. At ~8s
        # after play it must STILL be ayah 1 (replaying); by ~15s it
        # must have moved to ayah 2.
        page.wait_for_timeout(5000)
        assert mini_title_ayah(page) == 1, f"ayah 1 did not repeat: {page.evaluate(PLAYER_JS)}"
        page.wait_for_timeout(7000)
        assert mini_title_ayah(page) == 2, f"ayah did not advance after repeat: {page.evaluate(PLAYER_JS)}"
        print("ayah repeat x2 verified (still 1 at ~8s, on 2 at ~15s)")
        report["phone-repeat-timing"] = {"state": page.evaluate(PLAYER_JS)}

        # Speed badge cycles the Tarteel set.
        speed_badge = page.locator(".hifz-listen-mini .hifz-mini-badge").nth(0)
        seen = [speed_badge.get_attribute("aria-label")]
        for _ in range(4):
            speed_badge.click()
            page.wait_for_timeout(300)
            seen.append(speed_badge.get_attribute("aria-label"))
        print(f"speed cycle: {seen}")
        assert seen == ["سرعت: 1×", "سرعت: 1.25×", "سرعت: 1.5×", "سرعت: 1.75×", "سرعت: 0.5×"], seen
        report["phone-speed-cycle"] = {"seen": seen}
        # Back to 1x (0.5 -> 0.75 -> 1).
        speed_badge.click()
        speed_badge.click()
        assert speed_badge.get_attribute("aria-label") == "سرعت: 1×"

        # Pause / resume.
        mini_click(page, ".hifz-listen-mini .quran-mini-play")
        wait_status(page, "paused")
        page.screenshot(path=f"{OUT}/listen-paused-phone.png")
        mini_click(page, ".hifz-listen-mini .quran-mini-play")
        wait_status(page, "playing")

        # Next / prev ayah (scoped to the mini player: the picker and
        # the bottom bar have same-named buttons).
        before = mini_title_ayah(page)
        mini_click(page, ".hifz-listen-mini button[aria-label='آیهٔ بعد']")
        page.wait_for_timeout(1200)
        after_next = mini_title_ayah(page)
        assert after_next == (before or 0) + 1, f"next failed: {before} -> {after_next}"
        mini_click(page, ".hifz-listen-mini button[aria-label='آیهٔ قبل']")
        page.wait_for_timeout(1200)
        assert mini_title_ayah(page) == before, f"prev failed: {page.evaluate(PLAYER_JS)}"
        print(f"next/prev verified ({before} -> {after_next} -> {before})")
        report["phone-next-prev"] = {"before": before, "after_next": after_next}

        # Position persistence: pause (saves immediately), reload,
        # resume chip, resume plays the saved ayah.
        mini_click(page, ".hifz-listen-mini .quran-mini-play")
        wait_status(page, "paused")
        saved_ayah = mini_title_ayah(page)
        page.reload(wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_role("button", name="گوش دادن", exact=True).click()
        page.wait_for_timeout(1000)
        chip = page.get_by_role("button", name="ادامهٔ گوش‌دادن از آیهٔ")
        assert chip.count() == 1, "resume chip missing after reload"
        chip_text = chip.first.text_content()
        print(f"resume chip: {chip_text!r} (saved ayah {saved_ayah})")
        # The chip renders the ayah number with toArabicIndic
        # (Arabic-Indic digits ٠-٩, the study page's convention for
        # ayah numbers) while the mini player status uses fa-IR
        # digits (۰-۹); normalize both to Latin before comparing.
        norm = (chip_text or "").translate(
            str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
        )
        assert str(saved_ayah) in norm, chip_text
        page.screenshot(path=f"{OUT}/listen-resume-phone.png")
        chip.first.click()
        wait_status(page, "playing")
        page.wait_for_timeout(2000)
        assert mini_title_ayah(page) == saved_ayah, (
            f"resume played wrong ayah: {page.evaluate(PLAYER_JS)}"
        )
        print(f"resume verified: playing saved ayah {saved_ayah}")
        report["phone-resume"] = {"saved_ayah": saved_ayah, "chip": chip_text}

        # Range-repeat badge: range 2-3, count 2, mode range.
        page.locator(".hifz-range input").nth(0).fill("2")
        page.locator(".hifz-range input").nth(1).fill("3")
        page.locator(".hifz-range input").nth(3).fill("2")
        page.locator(".hifz-listen-controls select").nth(1).select_option("range")
        page.wait_for_timeout(400)
        state = page.evaluate(PLAYER_JS)
        print(f"range badge: {state['badges']}")
        assert any("تکرار بازه" in b and "×" in b for b in state["badges"]), state["badges"]
        report["phone-range-badge"] = {"state": state}
        page.close()

        # ---- Phone: network-error path (fresh page, audio host aborted). ----
        page = browser.new_page(viewport={"width": 393, "height": 852})
        errors2 = []
        page.on("console", lambda m: errors2.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors2.append(str(e)))
        page.route("**/download.quranicaudio.com/**", lambda route: route.abort())
        page.goto(f"{BASE}/fa/quran/1?tab=hifz", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_role("button", name="گوش دادن", exact=True).click()
        page.wait_for_timeout(800)
        mini_click(page, ".hifz-listen-mini .quran-mini-play")
        wait_status(page, "error", timeout=25000)
        page.wait_for_timeout(3000)
        state = page.evaluate(PLAYER_JS)
        assert state["status"] == "error", f"error did not stick (spinner?): {state}"
        assert "ناموفق" in (state["statusText"] or ""), state
        retry = page.get_by_role("button", name="تلاش دوباره")
        assert retry.count() >= 1, "retry button missing in error state"
        page.screenshot(path=f"{OUT}/listen-error-phone.png")
        print(f"error state honest: {state['statusText']!r}")
        report["phone-error"] = {
            "overflow": page.evaluate(OVERFLOW_JS),
            "errors": errors2,
            "state": state,
        }
        # Retry while still blocked stays in error; unblock + retry plays.
        retry.first.click()
        page.wait_for_timeout(4000)
        assert page.evaluate(PLAYER_JS)["status"] == "error", "retry cleared the error while still blocked"
        page.unroute("**/download.quranicaudio.com/**")
        page.route(
            "**/download.quranicaudio.com/**",
            lambda route: fulfill_audio(route, audio_bytes),
        )
        retry.first.click()
        wait_status(page, "playing", timeout=25000)
        page.wait_for_timeout(2000)
        assert page.evaluate(PLAYER_JS)["listenNow"] >= 1, "no highlight after retry"
        print("retry after unblock: playing again with word highlight")
        report["phone-retry"] = {"state": page.evaluate(PLAYER_JS)}
        page.close()

        # ---- Desktop: playing suite. ----
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        errors3 = []
        page.on("console", lambda m: errors3.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors3.append(str(e)))
        page.route(
            "**/download.quranicaudio.com/**",
            lambda route: fulfill_audio(route, audio_bytes),
        )
        page.goto(f"{BASE}/fa/quran/1?tab=hifz", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_role("button", name="گوش دادن", exact=True).click()
        page.wait_for_timeout(800)
        mini_click(page, ".hifz-listen-mini .quran-mini-play")
        wait_status(page, "playing")
        page.wait_for_timeout(3000)
        state = page.evaluate(PLAYER_JS)
        assert state["listenNow"] >= 1, f"desktop: no word highlight: {state}"
        assert state["photo"] and state["photo"]["src"].startswith("https://upload.wikimedia.org/"), (
            f"desktop: photo missing: {state['photo']}"
        )
        page.screenshot(path=f"{OUT}/listen-playing-desktop.png")
        print(f"desktop playing: {state}")
        report["desktop-playing"] = {
            "overflow": page.evaluate(OVERFLOW_JS),
            "errors": errors3,
            "state": state,
        }
        page.close()
        browser.close()
    with open(f"{OUT}/report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
