# Local Development Setup — Maturidi Academy

Step-by-step guide for running the whole monorepo on a developer machine.

> **Status as of 2026-10-20.** Commands and paths below were checked against the
> repository structure. Steps marked **«Requires verification on a clean
> machine»** were not re-executed end-to-end on a fresh computer by the
> documentation author — run them once and report any mismatch.

---

## 1. What you will run

| Part | Tech | Local address |
|---|---|---|
| API | FastAPI (Python 3.12), `apps/api` | http://localhost:8000 |
| Web | Next.js 15.5.28, `apps/web` | http://localhost:3000 |
| CRM | React + Vite 6.4.4, `apps/crm` | http://localhost:5173 |
| Infrastructure (dev compose) | PostgreSQL, Redis, MinIO, Prometheus, Grafana, Loki | various ports |

There is **no root `package.json`** — each app installs its own dependencies.
Helper scripts at the repo root (`bootstrap.sh` / `bootstrap.ps1`) automate the
common dev setup.

## 2. Prerequisites (all platforms)

| Tool | Version | Why / notes |
|---|---|---|
| Git | any recent | clone + version control |
| Node.js | **22.11.0** (see `.nvmrc`) | web + CRM + mobile + desktop shells |
| npm | bundled with Node | the package manager actually used by every app here |
| Python | **3.12.x — required** | only needed for the *direct* (non-Docker) API run. The pinned `pydantic` in `apps/api/requirements.txt` has **no Python 3.14 wheels** — do not use 3.14. |
| Docker Desktop / Docker Engine + Compose | current | recommended way to run the infrastructure services |

> **Python 3.12 is a hard requirement for the direct API path.** If your
> machine only has Python 3.14, either install 3.12 side-by-side or use the
> Docker path (the API image is `python:3.12-slim`).

---

## 3. Windows 10/11

### 3.1 Install the tools

1. **Git for Windows** — https://git-scm.com/download/win
2. **Docker Desktop** with the **WSL 2** backend enabled
   (Settings → General → "Use the WSL 2 based engine"). Start it and wait
   until it reports "Engine running".
3. **Node.js 22.11.0** — either:
   - the LTS installer from https://nodejs.org (pick the version in `.nvmrc`), or
   - nvm-windows: `nvm install 22.11.0` then `nvm use 22.11.0`.
4. **Python 3.12** (only for the direct API path) — https://www.python.org
   (a 3.12.x installer; check "Add python.exe to PATH").

Verify in a new PowerShell window:

```powershell
git --version
node --version      # expect v22.11.0
npm --version
python --version    # expect Python 3.12.x (direct API path only)
docker --version
docker compose version
```

### 3.2 Clone

```powershell
cd $HOME\dev
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
```

### 3.3 Environment file

```powershell
Copy-Item .env.example .env
```

Open `.env` and set at least strong local values for `JWT_SECRET` and
`ENCRYPTION_KEY` (plus `ENCRYPTION_KEY_VERSION`). See
[§6 Environment & secrets](#6-environment--secrets).

> ⚠️ **Never commit a real `.env`.** It is git-ignored on purpose. Never put
> real tokens, passwords or private keys in Git — in this repo or anywhere.

### 3.4 One-command bootstrap (recommended)

Open **PowerShell inside the project folder** (Shift + right-click →
"Open PowerShell window here", or `cd` into it), then run:

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
```

> Do **not** double-click `bootstrap.ps1` — a double-clicked window closes on
> the first error and you will not see what failed. Always run it from an
> already-open PowerShell window.

The bootstrap prepares the environment and brings up the dev stack
(API on :8000, web on :3000, CRM on :5173).

### 3.5 Manual path (equivalent, step by step)

Infrastructure only (PostgreSQL + Redis + MinIO + monitoring):

```powershell
docker compose up -d
docker compose ps
```

API, direct on the host (gives you a debugger and fast reloads):

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\setup.sh            # migrations + super_admin seed
                      # (on Windows, run it from Git Bash, or run the two
                      #  commands inside it manually: alembic upgrade head,
                      #  then the seed command it invokes)
```

> **System fonts are required for certificate/receipt PDF generation.**
> Inside Docker this is handled by `apps/api/Dockerfile`
> (`fonts-noto-core` + `fonts-dejavu-core`). On a bare host without those
> fonts, PDF generation fails at runtime with
> `RuntimeError: arabic/latin system fonts not found for certificate PDF`.

Web:

```powershell
cd apps\web
npm install
$env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
$env:API_URL = "http://localhost:8000"
npm run dev           # http://localhost:3000
```

CRM:

```powershell
cd apps\crm
npm install
$env:VITE_API_URL = "http://localhost:8000"
npm run dev           # http://localhost:5173
```

### 3.6 First login

There is **no demo account**. The super_admin is created by the seed step
(`./setup.sh`) from the environment variables **`ADMIN_EMAIL`** /
**`ADMIN_PASSWORD`** that you set for the API process. Log in with exactly
those credentials, then enable 2FA for the admin account.

**«Requires verification on a clean machine»** — the full Windows manual
path (3.5) end-to-end.

---

## 4. macOS and Linux

Differences from Windows; everything else in §3 applies unchanged.

### 4.1 Tools

- **Git**: `xcode-select --install` (macOS) or your distro package manager.
- **Node 22.11.0**: use `nvm`:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install   # reads .nvmrc in the repo root
  nvm use
  ```
- **Python 3.12**: macOS — `brew install python@3.12`; Debian/Ubuntu — the
  distro package may be older/newer; if it is not 3.12.x, install 3.12 via
  `pyenv` (`pyenv install 3.12`).
- **Docker**: Docker Desktop on macOS; Docker Engine + Compose plugin on
  Linux (see the production guide for the server install commands).

### 4.2 Bootstrap

```bash
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
cp .env.example .env   # then edit secrets, see §6
./bootstrap.sh
```

### 4.3 Manual path

```bash
docker compose up -d                       # infrastructure

cd apps/api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./setup.sh                                 # migrations + super_admin seed

cd ../web && npm install && npm run dev    # :3000
cd ../crm && npm install && npm run dev    # :5173
```

### 4.4 Linux-only note: system fonts for PDFs

On a bare Linux machine (no Docker for the API), install the fonts the PDF
generator needs, or certificate/receipt generation fails at runtime:

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-core fonts-dejavu-core
```

Shell differences to remember: environment variables are set with
`export NAME=value` (bash/zsh) instead of PowerShell's `$env:NAME = "value"`,
and the venv activator is `source .venv/bin/activate` instead of
`.venv\Scripts\Activate.ps1`.

---

## 5. Health checks, logs, tests, stopping

### Health checks

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/v1/health
```

Both must return a healthy JSON response before you debug the frontends.

### Logs

```bash
docker compose logs -f api          # infrastructure + containerised API
docker compose logs -f postgres redis minio
```

Direct-run processes print to their own terminals.

### Tests and quality gates

```bash
# Backend — 582 tests
cd apps/api && pytest

# Ruff (pinned 0.17.1) with the no-increase baseline gate —
# 160 legacy findings are frozen in tools/ruff_baseline.json; any
# increase or new file+rule pair fails:
python tools/check_ruff_baseline.py

# Web / CRM builds (these are the same commands CI runs)
cd apps/web && npm run build
cd apps/crm && npm run build        # = tsc --noEmit && vite build

# Dependency audit gate used by CI
npm audit --audit-level=high        # run inside apps/web and apps/crm
```

### Safe stop

```bash
docker compose down                 # keeps the named volumes (your dev data)
# Ctrl+C in each direct-run terminal (API/web/CRM)
deactivate                          # leave the Python venv
```

Use `docker compose down -v` **only** if you intentionally want to delete the
local dev databases and MinIO data.

---

## 6. Environment & secrets

- Template: **`.env.example`** at the repo root (development).
- Copy it to `.env` and fill in real local values. The API refuses unsafe
  placeholder secrets in production mode.
- Keys you will meet: `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`,
  `JWT_SECRET`, `ENCRYPTION_KEY`, `ENCRYPTION_KEY_VERSION`, `APP_BASE_URL`,
  `WEB_API_URL`, `CRM_API_URL`, `CORS_ALLOW_ORIGINS`, `STORAGE_PROVIDER`
  (`s3` against the dev MinIO, or local), `SMTP_*`, `SMS_*`,
  `ANTHROPIC_API_KEY` (optional — AI features degrade gracefully without it),
  `SENTRY_DSN`, `GRAFANA_PASSWORD`.
- Full variable semantics: [Settings schema](../settings-schema.md).

> ⚠️ **Never commit a real `.env`, a token, a signing key or a password to
> Git or upload one to a public file share.** Only the `*.example` templates
> belong in the repository.

---

## 7. Mobile and desktop development prerequisites

### 7.1 Mobile (`apps/mobile`, Expo)

- Stack: Expo SDK **~53.0.20**, React **19.0.0**, React Native 0.79.5.
- Local development:
  ```bash
  cd apps/mobile
  npm install
  npx expo start
  ```
  Then open the project in **Expo Go** on a phone on the same network, and
  point the app at your dev API (the machine's LAN IP, not `localhost`, from
  the phone's perspective).
- **Honest status — EAS cloud builds are not wired up yet:** there is **no
  `eas.json`** and **no EAS `projectId`** in `app.json`. Connecting the
  project to expo.dev (account login, `eas init`) is an action only the
  project owner can take. Until then there are no EAS cloud builds and no
  store binaries.
- **Local Android build**: requires the Android SDK + a JDK and
  `npx expo run:android` (or a Gradle build after `npx expo prebuild`).
- **Local iOS build**: requires **macOS + Xcode**. It is **impossible on
  Windows** — no workaround is documented because none exists.

### 7.2 Desktop (`apps/desktop`, Tauri 2)

- Stack: Tauri **2** (`@tauri-apps/cli ^2.2.0`), app version `0.1.0`.
- Prerequisites: Node 22.11.0, **Rust** (via `rustup`), and the platform
  native libraries:
  - **Linux**: WebKitGTK / GTK development packages and packaging tools for
    your distro (e.g. on Debian/Ubuntu: `libwebkit2gtk-4.1-dev`,
    `libgtk-3-dev`, `librsvg2-dev`, `libappindicator3-dev`, `patchelf`).
  - **Windows**: Microsoft C++ Build Tools + WebView2 runtime.
  - **macOS**: Xcode command-line tools.
- Dev / build:
  ```bash
  cd apps/desktop
  npm install
  npm run dev        # tauri dev
  npm run build      # tauri build
  ```
- **Honest status:** native installers (MSI/NSIS, .dmg, .deb/.AppImage) have
  **not been produced yet**. The Tauri shell exists and type-checks; treat
  installer production as unbuilt work, not as a finished artifact.
  **«Requires verification on a clean machine.»**

---

## 8. Troubleshooting quick table

| Symptom | Likely cause | Fix |
|---|---|---|
| API exits complaining about secrets | placeholder `JWT_SECRET` / `ENCRYPTION_KEY` in `.env` | set strong random values (see production guide §secrets for `openssl rand` examples) |
| PDF generation `RuntimeError: arabic/latin system fonts not found` | fonts missing on a bare host | install `fonts-noto-core` + `fonts-dejavu-core`, or run the API in Docker |
| `pip install` tries to build pydantic from source / fails | Python is 3.14, not 3.12 | install Python 3.12.x and recreate the venv |
| Web build fails on `/api/search` | `API_URL` not set for the build | set `API_URL=http://localhost:8000` (and `NEXT_PUBLIC_API_URL`) before `npm run build` |
| Phone can't reach the API from Expo Go | `localhost` points at the phone | use the dev machine's LAN IP for the API URL |
| `bootstrap.ps1` window vanishes | it was double-clicked | open PowerShell in the folder first, then run the command from §3.4 |

---

## See also

- [Documentation index](../README.md)
- [Production installation guide](../ops/production-installation.md)
- [Engineering contract](../engineering-contract.md)
- [Deployment notes](../ops/deployment.md) · [Runbook](../ops/runbook.md)
