# Desktop — Tauri 2 shell

Phase 13. The desktop app is a thin native shell around the **web frontend**:
all product logic lives in `apps/web` (ADR-001 — the UI is replaceable, the
shell only hosts it). The shell adds three native capabilities:

- **Window** hosting the web app — dev: `http://localhost:3000` (`tauri dev`),
  prod: bundled static export (`frontendDist: ../web/out`).
- **OS notifications** via `tauri-plugin-notification` (capability:
  `notification:default` in `src-tauri/capabilities/default.json`).
- **System-tray icon** with menu **Open / Sync now / Quit**
  (`src-tauri/src/main.rs`). "Sync now" emits a `sync-now` event that the web
  frontend's `TauriBridge` component turns into a Phase-13 sync-runner round.

## Layout

```
apps/desktop/
  package.json                 # @tauri-apps/cli; `npm run dev|build`
  src-tauri/
    tauri.conf.json            # window, tray, CSP, bundle, updater (moved here
                               # from apps/desktop/ in Phase 13 — the Tauri 2
                               # conventional location)
    Cargo.toml / build.rs / src/main.rs
    capabilities/default.json
    icons/                     # icon.png (+ .icns/.ico for macOS/Windows)
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

## Production web bundle

> **وضعیت واقعی (2026-10-20):** `frontendDist` در `tauri.conf.json` به `../web/out`
> اشاره می‌کند، اما پروفایل static-export وب (`output: "export"` در
> `next.config.mjs`) **هنوز ساخته نشده** و وب فعلی (SSR + API routes + middleware)
> بدون بازطراحی export نمی‌شود. تا آن زمان: `tauri dev` به `http://localhost:3000`
> پروکسی می‌کند و بیلد production دسکتاپ **مسدود** است. مسیر پیشنهادی: پروفایل
> export جدا در `next.config.mjs` (بدون دست‌زدن به بیلد SSR پیش‌فرض) + اسکریپت
> `web:export` — پس از تصمیم کاربر.

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

- Updater: **disabled** (`updater.active: false` — Track 2 / §۱۶). The
  `endpoints` URL is still a placeholder (`releases.example.com`); enable
  auto-update only after pointing it at the real release feed AND injecting
  the real `updater.pubkey` (CI injects the key; the private key signs via
  `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets).
- CSP (`app.security.csp`): `connect-src` currently allows only
  `localhost:*` — correct for dev, but a production bundle that talks to the
  deployed API must list the real API origin here (e.g.
  `https://api.example.com`) at release time.
- `frontendDist` points at `../web/out` (static export of the web app) — that
  export profile (`output: "export"` in `next.config.mjs`) does not exist yet;
  producing it is a separate build-profile task (native builds are Blocked in
  this sandbox — no Rust toolchain; CI builds per-OS in `desktop.yml`).
- `src-tauri/icons/icon.png` is required (plus `icon.icns`/`icon.ico` for
  macOS/Windows bundles); generate from `apps/web/public/icons/icon-512.png`.
  Icons are part of the binary-asset tail uploaded manually via GitHub web UI.
- `cargo check`/`cargo build` need a Rust toolchain — not run in this
  sandbox; CI compiles on the per-OS runners.

## پیش‌نیاز (فاز ۲)

- Rust toolchain (`rust-toolchain.toml` در ریشه — پین‌شده طبق فاز ۱)
- Node.js (`.nvmrc`)
