# Maturidi Academy — آکادمی ماتریدی

A multi-platform Islamic education platform — public website, admin CRM,
mobile app and desktop shell — built on one shared FastAPI backend, with
CMS, Quran, fatwa (RAG), inheritance/zakat calculators, library, LMS,
donations/payments, an internal project system and Telegram integration.

> **Status as of 2026-10-21 (v1.1.0 remediation).** All 18 build phases
> (0–17) are implemented; v1.0.0 shipped via PR #1 (real GitHub CI green),
> and the v2 remediation added: Python 3.14 / Node 24 baselines, complete
> MFA enrollment, mypy at 0 with a blocking CI typecheck, the three
> source calculators, and real CRM build dispatch. This does **not**
> mean every capability is production-verified — see
> [Honest capability status](#honest-capability-status) below before
> planning a launch, and `docs/audit-v2/DONE_CRITERIA.md` for the
> item-by-item matrix.

Repository: https://github.com/nasnih123-web/maturidi-academy

---

## Quick start (developer machine)

One-command bootstrap — full guide:
**[Local development guide](docs/installation/LOCAL_DEVELOPMENT.md)**
([فارسی](docs/installation/LOCAL_DEVELOPMENT.fa.md))

```bash
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
cp .env.example .env        # fill in real local secrets — never commit .env
./bootstrap.sh              # macOS / Linux
```

Windows (PowerShell **opened inside the folder** — do not double-click):

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
```

Result: API http://localhost:8000 · Web http://localhost:3000 ·
CRM http://localhost:5173. There is no demo account — the super_admin is
seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Production

Full guide: **[Production installation](docs/ops/production-installation.md)**
([فارسی](docs/ops/production-installation.fa.md)) — real-Linux-server
deployment with `docker-compose.prod.yml`, one-shot migration job, secrets
checklist, smoke tests, upgrade/rollback. Steps not yet executed on a real
server are explicitly labelled there.

---

## Monorepo structure

```
apps/
  api/        FastAPI (async) modular monolith + ARQ workers + WebSocket gateway
  web/        Next.js 15 (App Router) + TypeScript + next-intl (fa/ar/en)
  crm/        React + Vite admin console (incl. CMS and build center)
  mobile/     React Native + Expo (managed workflow)
  desktop/    Tauri 2 shell
packages/
  design-tokens/  raw colours / typography / spacing (framework-free)
  ui-web/         React (DOM) components
  ui-native/      React Native components
infra/        backup script, Prometheus config, Metabase compose + seeds
docs/         guides, engineering contract, ADRs, audits (index: docs/README.md)
tools/        ruff baseline gate
```

Architecture rule (ADR-001): the entire UI/UX can be demolished and rebuilt
without touching business logic or data — presentation stays out of the
domain layer; logic lives in hooks/services and stable API contracts.

Note: `packages/` currently contains only the three packages listed above;
icons live inside `design-tokens` (see `packages/README.md`).

## Prerequisites / versions

| Tool | Version | Source of truth |
|---|---|---|
| Node.js | 24 LTS | `.nvmrc` |
| Python | 3.14.x (**required** — the pinned stack targets 3.14; 3.15 is pre-release only) | `apps/api/Dockerfile`, `apps/api/requirements.txt` |
| FastAPI / uvicorn / pydantic | 0.156.4 / 0.54.0 / 2.14.1 | `apps/api/requirements.txt` |
| Next.js / React / next-intl (web) | 15.5.28 / 18.3.1 / 4.9.2 | `apps/web/package.json` |
| Vite / React / react-router-dom (CRM) | 6.4.4 / 18.3.1 / 7.18.4 | `apps/crm/package.json` |
| Expo SDK / React (mobile) | ~53.0.20 / 19.0.0 | `apps/mobile/package.json` |
| Tauri (desktop) | 2 (`@tauri-apps/cli ^2.2.0`), app 0.1.0 | `apps/desktop/package.json` |
| Ruff | 0.17.1 (pinned — counts are version-sensitive) | `apps/api/requirements.txt` |
| Docker + Compose plugin | current | both compose files |

There is no root `package.json`; each app installs separately.

## Tests, quality gates, builds

```bash
cd apps/api && pytest                          # backend — 630 tests
python tools/check_ruff_baseline.py            # ruff gate: 133 frozen findings, increases fail
cd apps/web && npm run build                   # Next.js production build
cd apps/crm && npm run build                   # tsc --noEmit && vite build
npm audit --audit-level=high                   # CI gate, in apps/web and apps/crm
docker compose config                          # validate dev compose
docker compose -f docker-compose.prod.yml config   # validate prod compose (with .env.prod)
```

CI (`.github/workflows/ci.yml`) runs: backend lint gate + tests + semgrep +
pip-audit + migration check, web build, CRM build, and a docker job that
needs all three. mypy is at **0 errors** and the Typecheck step is
blocking (v1.1.0; it was non-blocking type debt in v1.0.0). See
`docs/RUNTIME_SUPPORT_MATRIX.md` and `docs/SECURITY_REPORT.md`.

## Environment & secrets

- Templates: `.env.example` (dev) and `.env.prod.example` (prod) at the
  repo root. Copy, fill in strong random values, **never commit the real
  file**.
- Mandatory secrets: `JWT_SECRET`, `ENCRYPTION_KEY`
  (+ `ENCRYPTION_KEY_VERSION`), `POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
  `MINIO_ROOT_PASSWORD`. Variable reference:
  [Settings schema](docs/settings-schema.md).
- System fonts `fonts-noto-core` + `fonts-dejavu-core` are required for
  certificate/receipt PDFs (baked into the API Docker image; install via
  apt on a bare host).

## Honest capability status

**Ready (implemented and test-covered):** backend API with auth/RBAC/2FA,
CMS, Quran, LMS with certificates, library, donations/payments flow,
finance/PMS modules, web storefront (fa/ar/en), CRM console, CI pipeline
above, backup/restore drill in the dev sandbox.

**Partial:** AI fatwa/voice features degrade honestly to "unavailable"
until a real `ANTHROPIC_API_KEY` / speech models are configured;
inheritance/zakat calculators stay gated until scholars approve the
versioned rule configs (the v1.1.0 source-rule drafts included);
desktop Tauri shell works at config level (ADR-0023) but **no native
installers have been produced**; mobile has real assets and `eas.json`
APK profiles, but **no EAS project is connected yet** (owner action on
expo.dev — until then no signed APK exists).

**Blocked on real infrastructure (not yet verifiable in the dev
sandbox):** live PostgreSQL and multi-process Redis behaviour, live MinIO,
ClamAV scanning, end-to-end `docker-compose.prod.yml` on a real server,
native mobile/desktop builds and store signing. Each is labelled in the
guides rather than silently claimed.

## Documentation

- **[Documentation index](docs/README.md)** — every guide in one place
- [Engineering contract](docs/engineering-contract.md) — read before any code change
- [ADRs](docs/adr/) — architecture decision records
- [Local development](docs/installation/LOCAL_DEVELOPMENT.md) ·
  [Production installation](docs/ops/production-installation.md)
- [Deployment](docs/ops/deployment.md) · [Runbook](docs/ops/runbook.md) ·
  [Disaster recovery](docs/ops/disaster-recovery.md)
- [Security findings](docs/security/phase17-findings.md) ·
  [Remediation report](docs/audits/PHASE17_REMEDIATION_REPORT.md)
- [Performance budget](docs/performance-budget.md) ·
  [Page map](docs/page-map.md)
