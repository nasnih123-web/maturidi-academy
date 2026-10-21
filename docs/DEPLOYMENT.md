# Deployment — Maturidi Academy

Top-level deployment index for v1.1.0. This page consolidates the paths;
the detailed, step-by-step guides live under `docs/ops/` and
`docs/installation/` and remain the source of truth for commands.

**Runtime baselines (v1.1.0):** Python **3.14.0**, Node **24 LTS** — see
[`RUNTIME_SUPPORT_MATRIX.md`](RUNTIME_SUPPORT_MATRIX.md) (incl. the
recorded correction that Python 3.15 is pre-release only).

## 1. Local development

One-command bootstrap at the repo root:

```bash
./bootstrap.sh              # macOS / Linux
powershell -ExecutionPolicy Bypass -File bootstrap.ps1   # Windows
```

Full guide (prerequisites, per-app dev servers, mobile/desktop notes):
[`installation/LOCAL_DEVELOPMENT.md`](installation/LOCAL_DEVELOPMENT.md) ·
[فارسی](installation/LOCAL_DEVELOPMENT.fa.md).

## 2. Production — Docker Compose (supported path)

`docker-compose.prod.yml`: PostgreSQL, Redis, MinIO, a one-shot
`migrate` job (Alembic) that runs before the API, the API, **six ARQ
workers** (critical / ai / media / telegram / notifications / analytics),
web, CRM, Metabase, and the Prometheus/Grafana/Loki monitoring set.
The API container runs as a non-root user (`appuser`); graceful shutdown
is configured (uvicorn `--timeout-graceful-shutdown 30` + compose
`stop_grace_period: 40s`).

Full guide (secrets, smoke tests, upgrade/rollback):
[`ops/production-installation.md`](ops/production-installation.md) ·
[فارسی](ops/production-installation.fa.md). Day-2 operations:
[`ops/runbook.md`](ops/runbook.md); scaling path:
[`ops/scaling-to-100k.md`](ops/scaling-to-100k.md); storage notes:
[`ops/storage.md`](ops/storage.md); staging:
[`ops/staging.md`](ops/staging.md).

> **Honest status:** the compose stack is configuration-complete and the
> images build in CI (docker job gated on backend/web/crm). A live
> production deployment has **not** been performed by this project, and
> live PostgreSQL / multi-process Redis / MinIO / ClamAV remain
> unverified on real infrastructure (standing limitation since v1.0.0).

## 3. Railway — config shipped, deployment BLOCKED

Per-service Railway config-as-code is in the repo (`apps/api/railway*.toml`,
`apps/web/railway.toml`, `apps/crm/railway.toml`: api, six workers, web,
crm — all building from the existing Dockerfiles), with exact owner
steps, env-var name lists, managed PostgreSQL/Redis wiring, and one
known CRM `$PORT`/nginx adaptation called out in the guide.

**Status: BLOCKED** — no Railway account/project exists; nothing has run
on Railway. Follow [`ops/railway-deployment.md`](ops/railway-deployment.md)
once an account exists, and verify with its step-8 checks before calling
the deployment live.

## 4. Mobile & desktop artifacts

- **Android APK / iOS:** the CRM Builds page dispatches real GitHub
  Actions runs (mobile.yml / desktop.yml) and tracks them to completion;
  without `GITHUB_DISPATCH_TOKEN`/`GITHUB_REPO` configured it answers an
  honest `503 build_provider_not_configured`. EAS cloud builds
  additionally need the owner's Expo account — **BLOCKED
  (MOBILE-EAS-01)**; exact owner steps:
  [`ops/APK_BUILD_GUIDE.md`](ops/APK_BUILD_GUIDE.md).
- **Desktop:** Tauri shell with a local frontend that loads the deployed
  web app (URL set at packaging time — ADR-0023). Native builds run on
  the per-OS CI runners; **NOT TESTED** in the dev sandbox (no Rust
  toolchain).

## 5. Backup & restore

- **Policy:** daily `pg_dump` via `infra/backup.sh` with SHA-256
  manifests — **RPO 24 h / RTO 4 h**. Full policy and runbook:
  [`ops/disaster-recovery.md`](ops/disaster-recovery.md).
- **Latest drill evidence (2026-10-21, v1.1.0 tree):** migrations
  `upgrade head` from empty → 97 tables (head `c9d4e5f6a7b8`),
  downgrade −1 → upgrade head round-trip OK; backup → wipe → restore on
  a scratch database reproduced the **identical canonical content
  SHA-256** with equal per-table row counts on all 97 tables — **DRILL
  PASS** (`audit-v2/FINAL_VERIFICATION.md` §5; the automated variant is
  `tests/test_infra_track_b.py::test_backup_restore_drill`).
- **Caveat:** the drill ran against scratch SQLite; `infra/backup.sh`
  targets Docker/PostgreSQL, which cannot run in the verification
  sandbox — the same standing limitation as v1.0.0. One reviewed
  index/nullable reconciliation migration is queued as a follow-up
  (see [`SECURITY_REPORT.md`](SECURITY_REPORT.md) §5.1).
