# Phase-0 Audit Report — Maturidi Academy (Master Execution Prompt v2)

- **Tree audited:** `~/workspace/maturidi-v110`, branch `release/v1.1.0-remediation`, HEAD `5bcdde87` (= GitHub `main` + tag `v1.0.0`).
- **Date:** 2026-10-21. **Mode:** read-only audit; every "known item" from mission §4 was re-verified against the files on disk, not copied from history. Live spot-runs performed: `pytest --collect-only` (582 collected), `mypy apps/api/app` (159 errors), `pip show starlette` (0.41.3) — in a scratch venv built from the pinned `requirements.txt`.
- **Binding rules applied:** `docs/engineering-contract.md` (esp. §2 auth/2FA, §9.5 content control, §13 testing, §15 hard rules — #9 "no mock in production path") and ADR-001 (no business logic in UI components; logic in hooks/services/pure modules).
- **Companion file:** `FEATURE_STATUS_MATRIX.md` (per-feature REAL status with evidence).

## Severity summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 5 |
| Medium | 6 |
| Low | 7 |
| **Total** | **19** |

---

## 1. Repository inventory

### 1.1 Structure, languages, entry points

| Area | Files | Notes |
|---|---|---|
| `apps/api` | 236 | FastAPI backend — entry `apps/api/app/main.py` (`FastAPI(...)` line 154; health `GET /health` + `GET /api/v1/health` lines 246/251); worker entry `apps/api/app/worker.py` (`python -m app.worker <queue>`) |
| `apps/web` | 268 | Next.js 15.5.28 public site — entry `app/[locale]/…` (39 page routes), `middleware.ts` (next-intl), 2 route handlers (`app/api/search/route.ts`, `app/api/voice/ask/route.ts`) |
| `apps/crm` | 107 | React+Vite admin — entry `src/main.tsx` → `src/App.tsx` (31 routes), served by nginx in prod image |
| `apps/mobile` | 51 | Expo SDK 53 — entry `index.js` → `src/App.tsx`, React Navigation (`src/navigation/RootNavigator.tsx`), 12 screens |
| `apps/desktop` | 10 | Tauri 2 shell — `apps/desktop/src-tauri/src/main.rs`; only 10 files total (shell only) |
| `packages/` | 43 | `design-tokens` (tokens.css/ts, motifs), `ui-web` (Badge/Button/Card + tokens.css), `ui-native` (src/) — **only 3 packages exist** (icons/shared-types/config do not) |
| `infra/` | 4 | `backup.sh`, `monitoring/prometheus.yml`, `metabase/docker-compose.metabase.yml`, `metabase/seed-dashboards.md` |
| `tests/` (root) | 1 | `tests/load/k6-smoke.js` |
| `tools/` | 2 | `check_ruff_baseline.py`, `ruff_baseline.json` |

Languages: 228 `.py`, 234 `.tsx`, 130 `.ts` files (excl. node_modules).

### 1.2 Manifests & lockfiles

| App | Manifest | Lockfile | Key pins (verified in file) |
|---|---|---|---|
| api | `apps/api/requirements.txt` | — (pins are exact `==`) | fastapi 0.115.6, uvicorn 0.34.0, pydantic 2.10.4, sqlalchemy 2.0.36, alembic 1.14.0, arq 0.26.3, pyjwt 2.15.1, pyotp 2.9.0, pytest 8.3.4, ruff 0.17.1 |
| web | `apps/web/package.json` | `package-lock.json` | next 15.5.28, next-intl 4.9.2, react 18.3.1 |
| crm | `apps/crm/package.json` | `package-lock.json` | vite 6.4.4, react-router-dom 7.18.4, react 18.3.1, grapesjs ^0.23.8 |
| mobile | `apps/mobile/package.json` | `package-lock.json` | expo ~53.0.20, react 19.0.0, react-native 0.79.5 |
| desktop | `apps/desktop/package.json` | `package-lock.json` | @tauri-apps/cli ^2.2.0 only |
| desktop (Rust) | `apps/desktop/src-tauri/Cargo.toml` | **no Cargo.lock** | tauri 2, tauri-plugin-notification 2 |
| packages | `package.json` ×3 | — | workspace libs |

### 1.3 Dockerfiles & compose

- Dockerfiles: `apps/api/Dockerfile` (`python:3.12-slim`, fonts-noto-core + fonts-dejavu-core for PDF), `apps/web/Dockerfile` (3-stage, **`node:20-alpine`**, `npm start`, port 3000), `apps/crm/Dockerfile` (builder `node:20-alpine` → `nginx:1.27-alpine`, port 80).
- `docker-compose.yml` (dev): postgres, redis, minio, api, prometheus, grafana, loki.
- `docker-compose.prod.yml`: postgres, redis, minio, **migrate** (one-shot Alembic init-job), api, **worker-critical / worker-ai / worker-media / worker-telegram / worker-notifications / worker-analytics**, web, crm, metabase-db, metabase, prometheus, grafana, loki.
- `infra/metabase/docker-compose.metabase.yml`: standalone Metabase stack.

### 1.4 Workflows

- `.github/workflows/ci.yml` — 4 jobs (backend/web/crm/docker gated on all three). Suppression inventory (grep over all 3 workflows): the **only** `continue-on-error` is the mypy Typecheck step (`ci.yml:31`); **no `|| true` anywhere** (remaining matches are comments). pip-audit runs with 8 documented `--ignore-vuln` entries (see F-08).
- `.github/workflows/mobile.yml` — workflow_dispatch + tag `mobile-v*`; EAS cloud build (see F-03/F-14).
- `.github/workflows/desktop.yml` — workflow_dispatch + tag `desktop-v*`; Tauri matrix (windows/macos/ubuntu), uploads bundle artifacts.

### 1.5 Env examples

`.env.example` (36 keys), `.env.prod.example` (31), `apps/web/.env.example` (4), `apps/crm/.env.example` (1: VITE_API_URL), `apps/mobile/.env.example` (2: EXPO_PUBLIC_API_URL, EXPO_PUBLIC_EAS_PROJECT_ID). No real secrets in repo (gitleaks-clean history per v1.0.0 evidence).

### 1.6 API surface

- **43 routers** mounted in `app/main.py` (lines 190–232); **309 route handlers** (decorator count) across 21 modules under `/api/v1/*` prefixes: auth 14, users 14, admin 45, content 16, home 2, quran 13, fatwa 35, calculators 13, lms 37, library 16, social 24, places 8, telegram 15, api_keys 7, widgets 4, voice 5, finance 14, projects 17, sync 7, meta 3.
- Authorization is centralized: `app/modules/auth/dependencies.py` — `get_current_user` (l.44), `require_full_scope` (l.88), `require_permission(key)` (l.116); 62 `require_permission` call sites. Routers delegate to services (ADR-001 pattern holds in the backend: router → service → models).
- **DB:** one models module `apps/api/app/models/models.py` with **96 SQLAlchemy models**; **19 Alembic migrations** (`bd898906…` initial → `f17a0b1c2d3e` phase-17 indexes), forward-only per contract §12.
- **RBAC seed** (`apps/api/app/seed.py`): 5 roles — `super_admin`, `admin`, `scholar`, `scholar_author`, `user`; **30 base permissions** (`BASE_PERMISSIONS`); super_admin receives all permissions; admin created from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- **Workers:** ARQ, 6 queues exactly per contract §5 (`app/core/queues.py` `QUEUES` + `register_task`/`register_cron`); entry `app/worker.py` builds a per-queue `WorkerSettings`. Outbox dispatcher in `app/core/dispatcher.py`; domain events per contract §4.

### 1.7 Tests

- `apps/api/tests/`: 48 files; **live collect-only this audit: 582 tests collected** (517 `def test_` + parametrized/async expansion). Plus `tests/load/k6-smoke.js`. Web/CRM/mobile/desktop: **no test files** (no jest/vitest config in any app manifest) — all automated coverage is backend-only; frontend "tests" are typecheck + build in CI.

---

## 2. Mission §4 items — live re-verification

| # | Claim | Verdict (evidence) |
|---|---|---|
| 1 | `.nvmrc` = 22.11.0 | ✅ `cat .nvmrc` → `22.11.0`. CI web/crm/mobile/desktop use `node-version-file: .nvmrc`. **But** web/crm Dockerfiles use `node:20-alpine` → F-07 |
| 2 | CI Python 3.12 | ✅ `ci.yml` setup-python `python-version: "3.12"` |
| 3 | API Dockerfile `python:3.12-slim` | ✅ `apps/api/Dockerfile:8` |
| 4 | 8 documented Python advisories (starlette 0.41.3 ×7 + pytest PYSEC-2026-1845) | ✅ `ci.yml` Dependency-scan step lists exactly 8 `--ignore-vuln`: PYSEC-2026-1845, PYSEC-2026-161/-1941/-1942/-2280/-2281/-248/-249. Resolved starlette verified live: `pip show starlette` → **0.41.3** (transitive via fastapi 0.115.6) → F-08 |
| 5 | Ruff baseline = 160 | ✅ `tools/ruff_baseline.json`: `total: 160`, `sum(counts) = 160` over 86 (file, rule) pairs, `ruff_version: 0.17.1` = pinned ruff in requirements.txt. Gate `tools/check_ruff_baseline.py` fails on any increase/new pair |
| 6 | mypy `continue-on-error` | ✅ Present exactly once: `ci.yml:31`, Typecheck step only. **Comment above it claims "۱۴۱ خطا" — live mypy run this audit: 159 errors in 35 files** → F-06 |
| 7 | Backend MFA endpoints | ✅ `POST /api/v1/auth/2fa/setup`, `/2fa/enable`, `/2fa/recover` (`apps/api/app/modules/auth/router.py:135/143/155`); login returns `requires_2fa`; unenrolled privileged users get a restricted `2fa_setup`-scope token (`service.py:366,444`); `/login` response carries `must_enroll_2fa` (`schemas.py:36`). **No** status/disable/regenerate endpoints → F-02 |
| 8 | CRM MFA | ⚠️ Login TOTP step exists (`src/pages/Login.tsx`, `src/lib/auth.tsx` `Needs2FAError`). **No setup/enable UI anywhere in CRM** → F-01 (Critical) |
| 9 | Mobile assets | ❌ All 4 app.json-referenced assets missing; **no `assets/` directory exists** → F-03 |
| 10 | `eas.json` / `extra.easProjectId` / `extra.apiUrl` | ❌ `eas.json` absent; `extra.easProjectId: ""`; `extra.apiUrl: "http://localhost:8000"` → F-04, F-09 |
| 11 | Builds flow | ❌ Record-only (see §3, F-05) |
| 12 | Desktop `frontendDist ../web/out` | ⚠️ Claim is real in `src-tauri/tauri.conf.json` + README, but web cannot produce `out/`, and `src-tauri/icons/icon.png` is missing → F-06 |

---

## 3. Findings

### F-01 — CRITICAL — CRM has no MFA enrollment UI: mandatory 2FA (contract §2) is a dead end for admins

- **Reproduction:** Create/login as a fresh `admin`/`super_admin` who has not enabled TOTP. Backend login succeeds but issues a **restricted-scope token** (`SCOPE_2FA_SETUP`, `apps/api/app/modules/auth/service.py:366`) plus `must_enroll_2fa: true` in the `TokenPair`. Every privileged dependency then rejects the session (`apps/api/app/modules/auth/dependencies.py:28` `_reject_privileged_without_2fa`, error code `requires_2fa`). The only endpoints usable to escape this state are `POST /2fa/setup` and `POST /2fa/enable`. **No CRM page, route, or component calls them.**
- **Evidence (absence):** full-text search of `apps/crm/src` for `2fa|totp|mfa|authenticator` matches only: login second-step (`src/pages/Login.tsx`, `src/lib/auth.tsx` — `totp_code` payload + `Needs2FAError`), i18n labels, and Telegram-account 2FA (`src/lib/telegram.ts:88`, unrelated). `src/App.tsx` routes (31) contain **no security/2FA route**; `src/pages/Settings.tsx` sections are only AI / Telegram / Payments / Comms platform settings. `src/lib/auth.tsx` never reads `must_enroll_2fa` or the token scope (grep: no matches), so the CRM doesn't even detect the restricted state — the admin lands on pages whose API calls all fail with `requires_2fa`.
- **Impact:** The Phase-0 acceptance criterion in the engineering contract ("an admin who has not enabled 2FA cannot enter the CRM; recovery works via one-time codes") cannot be satisfied through the shipped product: the *first* super_admin created by seed can never complete enrollment without hand-crafted API calls (curl). §6 acceptance items all missing in CRM: **(a)** security/MFA page, **(b)** QR code rendering of `provisioning_uri` (+ manual secret display), **(c)** enable flow (enter TOTP → `POST /2fa/enable`), **(d)** recovery-codes display + save/download after enable, **(e)** current 2FA status display, **(f)** disable flow, **(g)** forced-enrollment redirect when `must_enroll_2fa` is true.
- **Server enforcement points that DO exist (backend is complete):** login challenge `requires_2fa` (`service.py:317`), restricted setup-scope token for unenrolled privileged users (`service.py:366,444`), `_reject_privileged_without_2fa` in dependencies, WS tickets restricted to full-scope sessions (`router.py` `/ws-ticket` docstring + `require_full_scope`), recovery via one-time codes (`POST /2fa/recover`, `service.py:808`), TOTP replay protection (`_claim_totp_step`, `service.py:101`). Backend tests exist (`tests/test_remediation2_track1_2fa.py`).
- **Regression-test plan:** CRM component/E2E test: login as unenrolled admin → forced redirect to enrollment page → mock `/2fa/setup` returns provisioning URI → QR rendered → submit code → `/2fa/enable` → recovery codes shown once → subsequent login reaches dashboard. Backend contract test already covers enforcement; add one asserting `must_enroll_2fa` is surfaced by the CRM auth store.

### F-02 — HIGH — Backend 2FA lifecycle is incomplete: no status, no authenticated disable, no recovery-code regeneration

- **Location:** `apps/api/app/modules/auth/router.py` — only three 2FA routes exist (`/2fa/setup`, `/2fa/enable`, `/2fa/recover`).
- **Reproduction/impact:** An enrolled user cannot (a) query their own 2FA status (no `GET /2fa/status`; status leaks only as `must_enroll_2fa` on the login response), (b) disable 2FA while authenticated (disable is only possible via the unauthenticated `/2fa/recover` path with email + recovery code), or (c) regenerate recovery codes after enable (codes are issued once by `/2fa/enable`; losing them means full recovery flow). Each is required by a complete §6 MFA acceptance (status display + disable flow in F-01 depend on these endpoints).
- **Regression-test plan:** API tests for `GET /2fa/status` (enabled/disabled + recovery-codes-remaining count), authenticated `POST /2fa/disable` (requires current TOTP; audit-logged), `POST /2fa/recovery-codes/regenerate` (old codes invalidated; replay of an old code fails).

### F-03 — HIGH — Mobile: all app.json-referenced image assets are missing; no `assets/` directory exists

- **Reproduction:** `apps/mobile/app.json` references `./assets/icon.png` (`expo.icon`), `./assets/adaptive-icon.png` (`android.adaptiveIcon.foregroundImage`), `./assets/splash.png` (`expo.splash.image`), `./assets/notification-icon.png` (expo-notifications plugin config). `find apps/mobile -name '*.png'` (outside node_modules) returns **nothing**; `ls apps/mobile/assets` → *No such file or directory*.
- **Impact:** Native/EAS builds fail or ship without icon/splash; Expo asset bundling errors on missing files. The app cannot be built into an installable artifact as-is.
- **Regression-test plan:** CI/script check: parse app.json, assert every referenced asset path exists on disk (add to audit tooling or mobile CI job).

### F-04 — HIGH — Mobile: EAS is not wired — `eas.json` missing and `extra.easProjectId` is empty

- **Reproduction:** `ls apps/mobile/eas.json` → missing. `app.json` → `expo.extra.easProjectId: ""`. `.github/workflows/mobile.yml` runs `eas build --platform all --non-interactive --no-wait` (line 23) — with no `eas.json` build profiles and no project ID, the cloud build cannot be associated with a project or produce artifacts; the workflow also never downloads/registers results (`--no-wait` + no follow-up step; the trailing comment claims outputs are kept in MinIO "phase 14 connection" — no such step exists).
- **Impact:** The mobile build pipeline advertised by the workflow + CRM Builds page cannot produce an APK/AAB/IPA. Store signing is additionally on the owner (Apple/Google accounts) — documented in the workflow comments.
- **Regression-test plan:** After owner connects expo.dev: `eas build --platform android --profile preview --non-interactive` must reach EAS and return a build URL; assert `eas.json` profiles exist for development/preview/production.

### F-05 — HIGH — CRM "Rebuild apps" is record-only: no CI dispatch, requests never leave `queued`

- **End-to-end trace:** CRM `src/pages/Builds.tsx` (413 lines) → `POST /api/v1/admin/builds/rebuild` → `apps/api/app/modules/admin/builds_router.py:49` → `builds_service.request_rebuild` (`builds_service.py:93`). The service validates the platform, reads signing prereqs honestly (`get_prereqs`, settings-backed), then **only inserts a `BuildRequest` row with `status="queued"`** + audit log, and returns a note saying (fa) "the real build and signing are done by CI; enter signing secrets in GitHub Secrets."
- **What does NOT exist (grep-verified):** no `httpx`/GitHub API/`workflow_dispatch` call anywhere in `builds_service.py`/`builds_router.py`; no worker task, cron, or webhook consumes `BuildRequest`; the string `status=` is assigned exactly once (`status="queued"`, `builds_service.py:112`) — **no code path ever transitions a request out of `queued`**. Releases (`POST /admin/builds/releases`) are manual records created by an admin after the fact; `download_url` is honestly null unless `signed` is set on the record.
- **Impact:** An admin clicking "بازسازی" (rebuild) gets a permanently-queued record; no build is ever triggered, no result ever comes back. The page is honest in its note text, but the flow is a queue to nowhere — mission §9's warning ("«queued» is not success") applies in full.
- **What DOES work:** `GET /admin/builds/releases`, `GET /admin/builds/prereqs` (real settings-backed signing readiness), `GET /admin/builds/requests`, permission-gated router, audit logging.
- **Regression-test plan:** Integration test: POST rebuild → assert a dispatch is attempted (mock GitHub `workflow_dispatch` endpoint receives repo/workflow/ref inputs) → simulate workflow-run webhook/callback → request status transitions `queued → running → succeeded/failed` and a `BuildRelease` appears without manual entry.

### F-06 — HIGH — Desktop production build is blocked twice: web cannot static-export, and the Tauri icon is missing

- **(a) No static export:** Desktop README (`apps/desktop/README.md`) and `src-tauri/tauri.conf.json` (`build.frontendDist: "../web/out"`) assume `apps/web` produces a static `out/`. But `apps/web/next.config.mjs` sets **no `output: 'export'`** (config is only `reactStrictMode` + next-intl plugin), and the web app uses server features incompatible with export: `middleware.ts` (locale routing), route handlers `app/api/search/route.ts` and `app/api/voice/ask/route.ts`, and SSR pages reading server-side `API_URL` (CI builds rely on this — see ci.yml web job comments). There is no build path that emits `apps/web/out`, so the Tauri "production bundle" the README describes cannot be produced.
- **(b) Missing icon:** `src-tauri/tauri.conf.json` references `icons/icon.png` for both `app.trayIcon.icon` and `bundle.icon[0]`; `apps/desktop/src-tauri/icons/` contains **only `.gitkeep`**. `tauri build` fails on the missing bundle icon. (The desktop README layout section also claims `icons/` holds "icon.png (+ .icns/.ico)" — not true on disk.)
- **Impact:** `desktop.yml` workflow (`npm run tauri build` on 3 OSes) cannot succeed; no desktop installer has ever been producible from this tree.
- **Regression-test plan:** Decide the architecture (separate static SPA build for the shell vs remote-URL shell), then CI: run the web export (or shell build) in the desktop workflow before `tauri build`; add an asset-existence check for every path referenced by `tauri.conf.json`.

### F-07 — MEDIUM — CRM permission gating is a permissive stub: `/users/me` exposes no roles/permissions

- **Location:** `apps/crm/src/lib/auth.tsx:27,45,118,125` — in-code `STUB` comments: "backend does not expose roles on /users/me yet… falls back to permissive until roles are exposed by the backend."
- **Verification:** Backend `UserOut` (`apps/api/app/modules/users/schemas.py:16-26`) indeed has **no `roles`/`permissions` fields**; `GET /users/me` returns profile fields only. Server-side enforcement is real (`require_permission` in dependencies, checked against DB `user_roles`), so this is not an authorization bypass — but the CRM renders every action for every admin and lets the server 403, and per-permission UI (contract §2 RBAC) cannot be built on the current contract.
- **Impact:** Defense-in-depth/UX gap + blocked RBAC UI; any future client-side-only check written against this stub would silently be permissive.
- **Regression-test plan:** Extend `UserOut` (or `/users/me/permissions`) with effective permission keys; CRM test: user without `finance.manage` does not see Finance actions; snapshot of `hasPermission` behavior per role.

### F-08 — MEDIUM — Python dependency debt: 7 starlette advisories + pytest advisory deferred behind CI ignores

- **Evidence:** `ci.yml` Dependency-scan step ignores PYSEC-2026-161/-1941/-1942/-2280/-2281/-248/-249 (starlette 0.41.3, resolved live this audit) and PYSEC-2026-1845 (pytest 8.3.4). The step's own comment states the fix requires a FastAPI major upgrade (starlette is pinned by `fastapi==0.115.6`).
- **Impact:** Known-vulnerable framework component in production path; the ignore list is documented and the scan is blocking for everything else, but the debt has no forcing function and grows with each new starlette advisory.
- **Regression-test plan:** Tracked upgrade spike: FastAPI ≥ the version unpinning starlette past all 7 PYSECs; full backend suite + contract tests green; then remove ignores one by one in CI.

### F-09 — MEDIUM — Mobile release builds silently target `http://localhost:8000`

- **Evidence:** `apps/mobile/app.json` → `extra.apiUrl: "http://localhost:8000"`. Resolution order in `apps/mobile/src/lib/config.ts`: `EXPO_PUBLIC_API_URL` env → `extra.apiUrl`; the "required" error (config.ts:34) only fires when *neither* is set — `extra` is always set, so a store/EAS build produced without the env var ships an app that talks to the phone's own localhost.
- **Impact:** A "successful" release build can be functionally dead against the real backend, with no build-time failure.
- **Regression-test plan:** Build-time guard: production profile must fail if resolved API URL is localhost; unit test config resolution for the three cases (env set / extra set / neither).

### F-10 — MEDIUM — mypy debt is non-blocking in CI, and the documented count is stale

- **Evidence:** `ci.yml:28-32` Typecheck step runs with `continue-on-error: true`; the comment claims "۱۴۱ خطای mypy". Live run this audit (`mypy apps/api/app`, scratch venv from pinned requirements): **159 errors in 35 files** (159 source files checked). The mission history's 159 figure reproduces exactly; 141 does not.
- **Impact:** CI stays green regardless of type-debt growth (no baseline/ratchet for mypy, unlike ruff); the stale comment understates the debt by 18 and misleads planning.
- **Regression-test plan:** Add a mypy baseline gate mirroring `tools/check_ruff_baseline.py` (fail on increase), or fix the 159 and make the step blocking; correct the comment.

### F-11 — MEDIUM — Node version drift: CI/dev use Node 22.11.0, production Dockerfiles build with Node 20

- **Evidence:** `.nvmrc` = 22.11.0; all workflows use `node-version-file: .nvmrc`. But `apps/web/Dockerfile:3,10,23` and `apps/crm/Dockerfile:3` use `node:20-alpine`.
- **Impact:** Production web/CRM images are built under a different Node major than CI verifies (Next 15.5 supports both, so it works today — but behavior/build drift is unmonitored, and the docs' "Node per .nvmrc" statement is false for the Docker path).
- **Regression-test plan:** Pin Dockerfiles to `node:22-alpine`; add a CI step or lint asserting Dockerfile Node major == `.nvmrc` major.

### F-12 — MEDIUM — Duplicate, divergent `tauri.conf.json` files in apps/desktop

- **Evidence:** `apps/desktop/tauri.conf.json` (stale pre-Phase-13 location; different CSP `default-src 'self'`, different window config) coexists with `apps/desktop/src-tauri/tauri.conf.json` (the Tauri 2 conventional location the README describes). The two disagree; only the src-tauri one is read by Tauri 2, but the root copy invites edits to the wrong file and ships in the repo tree (it is also the copy present on the GitHub branch snapshot).
- **Impact:** Configuration ambiguity for anyone building/signing the desktop app; risk of hardening the wrong CSP.
- **Regression-test plan:** Delete the stale root config (or replace with a pointer README); repo-lint check: exactly one `tauri.conf.json`, under `src-tauri/`.

### F-13 — LOW — `src-tauri/tauri.conf.json` is JSONC, not strict JSON

- **Evidence:** The updater block (`tauri.conf.json:52-58`) contains `//` comments; `python -m json.tool` fails ("Expecting property name…, line 53"). Tauri's own config loader tolerates comments, so builds are not blocked by this — but any strict-JSON tooling (schema validators, scripts, this audit's diff) breaks on the file. Note the updater itself is honestly `active: false` with a placeholder endpoint `releases.example.com` — correctly disabled, documented in-file.

### F-14 — LOW — mobile.yml: duplicated `npm ci` and a build nobody collects

- **Evidence:** `.github/workflows/mobile.yml` runs `npm ci` (line 18), then again inside the build step (`npm ci && eas build …`, line 23). With `--no-wait` the job ends when the EAS build is *queued*; nothing in the workflow (or the backend, F-05) records the result. The `token:` value is `${{ secrets.EXPO_TOKEN }}` (verified — secret reference, not a hardcoded token).

### F-15 — LOW — Web ships an opt-in social demo mode and dev-only demo routes

- **Evidence:** `apps/web/lib/social.ts:164-167` — `isSocialDemo()` is true only when `NEXT_PUBLIC_SOCIAL_DEMO === '1'`; then all social calls are served by in-fixture data (`lib/demo-social.ts`) including fake mutations (`demoCreatePost`, `demoAskQuestion`, …). Default is off and the header comment labels it a screenshot/test switch, so contract §15.9 (no mock in production path) is not violated by default — but the fixture code ships in the production bundle and a single env mistake turns the community section fake. Separately, routes `app/[locale]/demo/lms` and `app/[locale]/demo/sections` render fixture data (`lib/demo-fixtures.ts`) but hard-404 in production builds (`if (process.env.NODE_ENV === 'production') notFound()`), and nothing in production navigation links to them.
- **Regression-test plan:** Assert production build env never sets `NEXT_PUBLIC_SOCIAL_DEMO`; consider excluding demo modules from production bundles entirely.

### F-16 — LOW — CRM `src/pages/Content.tsx` (542 lines) is orphaned dead code

- **Evidence:** `grep "pages/Content"` across `apps/crm/src` matches only `ContentControl` (imported in `App.tsx:10`, routed at `/content`). `Content.tsx` — an earlier Content Control Center implementation with the same stated purpose — is imported nowhere. It still compiles into the repo (and confuses audits/edits) but never into the bundle.
- **Regression-test plan:** Remove the file; add a CI unused-file check (e.g., ts-prune) for `src/pages`.

### F-17 — LOW — Stale "backend not implemented" copy in CRM i18n

- **Evidence:** `apps/crm/src/lib/i18n.tsx` still carries `backendMissing` / `devicesPendingBackend` strings ("The Phase 14 backend is not implemented yet — no mock data is shown", ×3 locales) for the Connections/Builds/User360 surfaces — endpoints that **do exist** in this tree (`apps/api/app/modules/admin/connections_router.py`, `builds_router.py`, users-360 service). The strings now only serve as unreachable/API-error fallback copy, but their wording is false. Similarly the `mediaStub` string says the media picker "activates in a later phase" while `MediaManager` (2092 lines) is routed and API-backed. Cosmetic; risks misleading operators during real outages.

### F-18 — LOW — No `Cargo.lock` for the Tauri app

- **Evidence:** `apps/desktop/src-tauri/` has `Cargo.toml` (tauri 2, notification plugin 2) but no `Cargo.lock` in the tree → non-reproducible Rust dependency resolution for the (already blocked, F-06) desktop build.

### F-19 — LOW — Frontend test coverage is zero; all automated tests are backend

- **Evidence:** No test runner/config in `apps/web`, `apps/crm`, `apps/mobile`, `apps/desktop` manifests; CI frontend jobs run only audit + typecheck + build. CRM pages with complex client logic (ContentControl 2032 lines, MediaManager 2092, LMS 1584, Fatwa 1393) have no component tests. The a11y E2E that does exist lives in the backend suite (`tests/test_phase17_a11y.py`, skips without the Chromium pipeline).

---

## 4. Showcase-gap sweep (CRM + web) — method & results

**Method:** greps for `TODO|FIXME|stub|placeholder|mock|hardcoded|coming soon` over `apps/crm/src` and `apps/web/{app,components,lib}`; per-page API-wiring census (pages delegate to `src/lib/*` hooks/services per ADR-001 — direct `fetch` counts in page files are therefore ~0 by design and were **not** treated as gaps); dead-handler grep (`onClick={() => {}}`, `href="#"`) → **zero matches**; sample reads of suspect pages (Analytics, Builds, Settings, Login, guidelines, demo routes).

**Results:**
- **No page in CRM renders hardcoded business data.** Every routed page is backed by a `lib/*` API module (see matrix). Several pages degrade *honestly* when their dependency is absent (Analytics → "Metabase not configured" card; Donate → honest empty state; Quran/fatwa pages → error state, never fabricated content).
- **Showcase/partial surfaces (real list):**
  1. **CRM Builds** — UI complete, backend record-only (F-05). *UI-only flow.*
  2. **CRM Analytics** — iframe shell around an external Metabase + a static catalog of 7 dashboard names defined in `infra/metabase/seed-dashboards.md`; nothing renders until Metabase is deployed and `bi.metabase_url` is set. *Partial (external dependency).*
  3. **CRM Connections** — real endpoints exist; page carries stale "backend missing" fallback copy (F-17). *Works, copy debt.*
  4. **Web `/demo/lms`, `/demo/sections`** — fixture showcase pages, production-gated to 404 (F-15). *Dev-only by design.*
  5. **Web community (`/community`, `/feed`, post pages)** — real API client, with an env-gated full-fixture demo mode (F-15). *Works; demo mode ships in bundle.*
  6. **Web donate result/banner** — gateway-dependent: DonateBanner notes no gateway wired inline; finance module itself is API-backed (see matrix). *Partial (external gateway).*
- **ADR-001 conformance:** CRM pages call `lib/` hooks (e.g., ContentControl → `lib/contentApi`, Finance → `lib/events`/`lib/ops14`, Projects/Staff → `lib/projects16`); web pages call `lib/` service modules and `*Lazy` client wrappers around pure view components. No business logic was found inside page components in the samples; the violations found are *missing* logic (F-01, F-05), not misplaced logic.

## 5. What is genuinely solid (for the record)

- Backend auth/session stack: Argon2id, refresh rotation with reuse detection, session-bound tokens, WS one-time tickets bound to sessions, TOTP replay protection — implemented and covered by dedicated tests (`test_remediation2_track1_*`, `test_security_phase17.py`).
- Content/fatwa integrity rules hold in code: fatwa LLM degrades to `llm_unavailable` (never fabricates), Quran text is never TTS-synthesized, calculator rule configs are data-driven and gated.
- CI is honest: blocking semgrep/pip-audit/npm-audit/migration checks, ruff baseline ratchet (160), docker gated on all three app jobs; the single non-blocking step (mypy) is visible, not hidden.
- Builds prereqs + release records report signing state truthfully instead of faking success — the gap is the missing dispatch, not dishonest UI.
