# Desktop — Tauri 2 shell

Phase 13. The desktop app is a thin native shell around the **web frontend**:
all product logic lives in `apps/web` (ADR-001 — the UI is replaceable, the
shell only hosts it). The shell adds three native capabilities:

- **Window** hosting the web app — dev: `http://localhost:3000` (`tauri dev`),
  prod: the bundled local shell in `shell/` (`frontendDist: ../shell`) that
  navigates to the configured production web URL (ADR-0023).
- **OS notifications** via `tauri-plugin-notification` (capability:
  `notification:default` in `src-tauri/capabilities/default.json`).
- **System-tray icon** with menu **Open / Sync now / Quit**
  (`src-tauri/src/main.rs`). "Sync now" emits a `sync-now` event that the web
  frontend's `TauriBridge` component turns into a Phase-13 sync-runner round.

## Layout

```
apps/desktop/
  package.json                 # @tauri-apps/cli; `npm run dev|build`
  shell/                       # ADR-0023 local shell frontend (frontendDist)
    index.html / shell.js      # state pages (loading / offline / unconfigured)
    config.js                  # MATURIDI_WEB_URL — set at packaging time
    icon.png                   # emblem shown on the state pages
  src-tauri/
    tauri.conf.json            # window, tray, CSP, bundle (moved here
                               # from apps/desktop/ in Phase 13 — the Tauri 2
                               # conventional location; NO updater block —
                               # see Notes)
    Cargo.toml / build.rs / src/main.rs
    capabilities/default.json
    icons/                     # generated set: icon.png 512, 32/128/256,
                               # icon.ico, icon.icns (from the emblem)
  tauri.conf.json              # ⚠ STALE divergent root copy — see Notes (F-12)
```

## Dev

```bash
cd apps/desktop
npm install
# terminal 1: web frontend (devUrl the shell points at)
(cd ../web && npm run dev)      # http://localhost:3000
# terminal 2:
npm run dev
```

## Production bundle — the local shell (ADR-0023)

The web app cannot be static-exported (middleware + route handlers + SSR
pages), so the production desktop bundle ships a small **local shell**
(`shell/`) instead of `apps/web/out`:

1. At packaging time, set the real production web origin in
   `shell/config.js`: `window.MATURIDI_WEB_URL = "https://<web-origin>"`.
2. On launch the shell navigates the webview to that origin with
   `location.replace` — the desktop app then runs the real web app and its
   real API contracts; the shell holds no product logic (ADR-001).
3. With no URL configured, the shell shows an honest built-in
   "not configured" page (it never guesses or hardcodes a URL); while
   offline it shows an offline page with a retry button.

> **وضعیت واقعی (2026-11-07، فاز ۹):** بیلد debug و release لینوکس در
> sandbox اجرا و موفق شدند (بخش «فاز ۹» پایین)؛ smoke test لینوکس ۱۴/۱۴
> سبز است. macOS/Windows هنوز اجرا نشده‌اند — NOT TESTED. تا وقتی وب
> production مستقر نشود و نشانی واقعی در `config.js` قرار نگیرد، باینری
> فقط صفحهٔ وضعیت داخلی را نشان می‌دهد.

## Signed builds — CI path (`.github/workflows/desktop.yml`)

- Trigger: manual dispatch or a `desktop-v*` tag.
- Matrix: `windows-latest`, `macos-latest`, `ubuntu-latest` — Tauri **must**
  build on the runner of the target OS (no cross-compile).
- Steps: checkout → Rust stable → Node (`.nvmrc`) → `npm ci` →
  `npm run tauri build` → upload `src-tauri/target/release/bundle/`
  (90-day retention).
- **Signing (no secrets in this repo — ever):**
  - macOS: Developer-ID certificate + notarization via GitHub secrets
    (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
    `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) — set as env before
    `tauri build`.
  - Windows: code-signing cert thumbprint in `bundle.windows.certificateThumbprint`
    (or `TAURI_SIGNING_PRIVATE_KEY` for the updater signature).
  - Updater: there is **no updater block at all** in `tauri.conf.json`
    (see Notes). When the real release feed exists, CI adds a Tauri 2
    `plugins.updater` block carrying the real `pubkey`; the private key
    signs artifacts via the `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`
    secrets.
- Phase-13 acceptance: signed installers for all three platforms are stored
  in MinIO (Phase 14 wires the upload step; the workflow comment tracks it).

## Notes

- Updater: **disabled by absence** (Track 2 / §۱۶; decision re-affirmed
  in ADR-0031 / C-05). There is no `updater` key anywhere in
  `tauri.conf.json`: a top-level `updater` block is Tauri v1 style and
  the v2 config schema rejects the whole file (owner's Desktop builds
  run #5 failed on all three OSes with exactly that error — FIX3-01).
  No placeholder endpoint/pubkey ships in the config. Enable
  auto-update only by adding a Tauri 2 `plugins.updater` block with
  `endpoints` pointing at the real release feed AND the real `pubkey`
  (CI injects the key; the private key signs via
  `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets).
- CSP (`app.security.csp`): the shell page itself only loads local files
  (`script-src 'self'`); after navigation, the remote web origin's own
  policies apply. `connect-src` still lists `localhost:*` for the dev flow.
- `src-tauri/icons/` holds the real generated icon set (2026-10-21, from
  the school emblem `apps/web/public/logo.jpg`, via Pillow):
  `icon.png` (512), `32x32.png`, `128x128.png`, `128x128@2x.png`,
  `icon.ico`, `icon.icns`. `bundle.icon` and the tray icon reference exactly
  these files. Regenerate with Pillow from the emblem (or `tauri icon` on a
  machine with the Tauri CLI) whenever the emblem changes.
- Root `apps/desktop/tauri.conf.json` **was** a stale divergent copy
  (F-12: active updater with a placeholder endpoint, wrong ports/paths).
  Per the post-197efa0 audit (C-05, ADR-0031) it is **deleted**; the only
  Tauri config is `src-tauri/tauri.conf.json`. Nothing may reference the
  root path.
- `cargo check`/`cargo build` need a Rust toolchain — run in this
  sandbox in Phase 9 (2026-11-07): `cargo test` 11/11, debug + release
  builds green on Linux (see the Phase 9 section). CI still compiles on
  the per-OS runners; macOS/Windows remain NOT TESTED here.

## فاز ۹ — دسکتاپ برای حفاظ (2026-11-07)

جزئیات کامل در `docs/quran/hifz-phase9-notes.md`. خلاصه:

- **ممیزی:** دسکتاپ فقط پوستهٔ وب است (R-15) — هیچ asset وب/فونت/متن قرآنی
  در باندل نیست؛ production فقط `shell/` محلی را باز می‌کند که به
  `MATURIDI_WEB_URL` می‌رود.
- **یافتهٔ بحرانی F-01:** وبِ remote هیچ دسترسی IPC ندارد
  (`capabilities/default.json` فقط `windows: ["main"]` دارد و هیچ
  `remote`ای ندارد) — حتی ایونت قدیمی `sync-now` در production بی‌صدا
  کار نمی‌کند. رفع آن packaging-time است: قالب
  `src-tauri/capabilities/remote-web.json.template` را در packaging به
  `remote-web.json` کپی کنید و `https://WEB-ORIGIN-HERE` را با origin
  واقعی جایگزین کنید (هرگز `*` نه). برای dev فایل
  `src-tauri/capabilities/local-dev.json` فقط `http://localhost:*` را
  مجاز می‌کند.
- **میکروفون:** handler ‏`on_permission_request` اضافه شد؛ میکروفون فقط
  برای origin پیکربندی‌شده Allow می‌شود و بقیهٔ permissionها همیشه Deny.
  **محدودیت صادقانه (لینوکس/WebKitGTK 2.52):** WebKitGTK برای
  `getUserMedia` اصلاً سیگنال permission نمی‌فرستد، پس این handler در
  لینوکس میکروفون را گیت نمی‌کند (با پچ تشخیصی روی wry تأیید شد: handler
  وصل و برای geolocation فعال است، ولی برای media هیچ سیگنالی نمی‌آید).
  گیتِ واقعیِ میکروفون در لینوکس ناوبری است — پوسته فقط origin
  پیکربندی‌شده را باز می‌کند.
- **محافظ بستن حین ضبط:** وب‌اپ باید دور جلسهٔ زنده کامند
  `hifz_set_recording_active(true/false)` را صدا بزند؛ حین ضبط بستن
  پنجره و خروج از tray رد می‌شود (+ ایونت `hifz-close-blocked` + اعلان).
  پرچم تست `--hifz-smoke-recording`.
- **Hifz Studio (تصمیم طراحی آکادمی، نه قابلیت Tarteel):** مصحف در مرکز،
  dock تمرین راست، dock تاریخچه/متشابهات چپ؛ کامندهای
  `hifz_studio_open/close/is_open/layout` + آیتم‌های tray. وب‌اپ هنوز
  پارامتر `?studio=practice|history` را نمی‌خواند، پس dock فعلاً همان
  صفحهٔ کامل مطالعه را نشان می‌دهد.
- **بیلد/تست لینوکس (sandbox، ‏۲۰۲۶-۱۱-۰۷):** تست واحد Rust ‏**۱۱/۱۱**؛
  بیلد debug ‏exit 0؛ بیلد release ‏`npm run tauri build` ‏exit 0
  (AppImage ‏~۸۱٫۷MB، ‏.deb ‏~۶٫۹MB، ‏.rpm ‏~۶٫۹MB، بدون امضا)؛
  smoke test زیر Xvfb ‏**PASS=14 FAIL=0**
  (`tests/smoke/smoke-test-linux.sh`). ‏macOS/Windows: ‏BLOCKED.
- **تغییر جانبی:** کلید `plugins: { "notification": {} }` از
  `tauri.conf.json` حذف شد — با `tauri-plugin-notification 2.8.0` در
  startup panic می‌داد (باگِ پیشینی).

## پیش‌نیاز (فاز ۲)

- Rust toolchain (`rust-toolchain.toml` در ریشه — پین‌شده طبق فاز ۱)
- Node.js (`.nvmrc`)
