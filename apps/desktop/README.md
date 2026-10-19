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

`frontendDist` points at `../web/out`, i.e. a **static export** of the web
app. Before `tauri build`, produce it with the export profile
(`next.config.mjs`: `output: "export"` for this target — kept as a separate
build profile so the default SSR build is untouched).

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

- The updater `endpoints` URL is a placeholder — point it at the real
  release feed before enabling auto-update in production.
- `src-tauri/icons/icon.png` is required (plus `icon.icns`/`icon.ico` for
  macOS/Windows bundles); generate from `apps/web/public/icon-512.png`.
- `cargo check`/`cargo build` need a Rust toolchain — not run in this
  sandbox; CI compiles on the per-OS runners.

## پیش‌نیاز (فاز ۲)

- Rust toolchain (`rust-toolchain.toml` در ریشه — پین‌شده طبق فاز ۱)
- Node.js (`.nvmrc`)
