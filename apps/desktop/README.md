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
    tauri.conf.json            # window, tray, CSP, bundle, updater (moved here
                               # from apps/desktop/ in Phase 13 — the Tauri 2
                               # conventional location)
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

> **وضعیت واقعی (2026-10-21):** پوسته پیاده و `frontendDist: ../shell`
> تنظیم شد (ADR-0023). تا وقتی وب production مستقر نشود و نشانی واقعی در
> `config.js` قرار نگیرد، باینری فقط صفحهٔ وضعیت داخلی را نشان می‌دهد.
> بیلد native در این sandbox اجرا نشده (نبود Rust toolchain) — مسیر CI
> روی runnerهای هر OS آماده است: **NOT TESTED**.

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
  - Updater: `tauri.conf.json → updater.pubkey` stays **empty** here; CI
    injects the real public key and the private key signs artifacts via the
    `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets.
- Phase-13 acceptance: signed installers for all three platforms are stored
  in MinIO (Phase 14 wires the upload step; the workflow comment tracks it).

## Notes

- Updater: **disabled** (`updater.active: false` — Track 2 / §۱۶; decision
  re-affirmed in ADR-0031 / C-05). The `endpoints` list is intentionally
  **empty** — no placeholder URL ships in the config; enable
  auto-update only after pointing it at the real release feed AND injecting
  the real `updater.pubkey` (CI injects the key; the private key signs via
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
- `cargo check`/`cargo build` need a Rust toolchain — not run in this
  sandbox; CI compiles on the per-OS runners.

## پیش‌نیاز (فاز ۲)

- Rust toolchain (`rust-toolchain.toml` در ریشه — پین‌شده طبق فاز ۱)
- Node.js (`.nvmrc`)
