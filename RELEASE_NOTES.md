# Release Notes — Maturidi Academy

## v1.1.0 — 2026-10-21

Post-release remediation release (Master Execution Prompt v2), built on
the v1.0.0 tree (`5bcdde87`) on branch `release/v1.1.0-remediation`.
Evidence pack: `docs/audit-v2/` — start with `FINAL_VERIFICATION.md` and
`DONE_CRITERIA.md`. Changelog: `CHANGELOG.md`.

### Highlights
- **Runtime upgrades:** Python 3.12 → **3.14.0** (3.15 is pre-release
  only — verified against official sources; see
  `docs/RUNTIME_SUPPORT_MATRIX.md`), Node 22 → **24 LTS**. FastAPI
  0.156.4 / pydantic 2.14.1: **all 8 deferred advisories cleared**,
  pip-audit clean, CI ignore flags removed.
- **MFA completed** (the v1.0.0 audit's Critical finding): full
  lifecycle API (status / disable / recovery-code regeneration with
  re-authentication) + a real CRM enrollment page
  (Settings → Security & 2FA: QR + manual secret, one-time recovery
  codes). A scope-enforcement hole was found and fixed in the same pass:
  restricted `2fa_setup` tokens could previously reach ordinary
  authenticated endpoints.
- **Type debt eliminated:** mypy 163 → **0 errors**, CI Typecheck now
  blocking; ruff baseline 160 → **133**. Tests: **630 passed**, 1
  skipped, 0 failed.
- **Three source calculators integrated** (zakat extended, Hanafi
  miras, Arabic mosaref) — rules re-implemented from scratch (source
  license unclear; no code copied), verified against golden batteries
  generated from the original pages (131/53/41, 100% match).
- **CRM Builds is real:** GitHub workflow dispatch + status sync
  replace the record-only queue; mobile gained real brand assets,
  `eas.json` APK profiles, and a fail-loud production API-URL config;
  desktop gained a working local shell (ADR-0023) and a real icon set.
- **Deployment prep:** non-root API container, graceful shutdown,
  Railway config-as-code for all services, backup/restore drill PASS
  (canonical SHA-256 identical after restore, 97 tables).

### Honest limitations (unchanged discipline from v1.0.0)
- **No signed APK exists yet.** EAS builds are BLOCKED on the owner's
  Expo account/token and Android keystore (MOBILE-EAS-01) — `easProjectId`
  is deliberately empty, not faked. Owner steps:
  `docs/ops/APK_BUILD_GUIDE.md`.
- **Railway is configured, not deployed.** All service configs shipped;
  deployment is BLOCKED on the owner's Railway account. The supported
  production path remains `docker-compose.prod.yml`.
- **Calculator fiqh rules are DRAFT.** The zakat/inheritance source
  rules await qualified scholar review; the public calculation gate
  stays closed (`422 rules_not_approved`). Mosaref (linguistics) is
  fully public.
- **Native desktop builds are NOT TESTED** in the dev sandbox (no Rust
  toolchain); they run on the per-OS CI runners.
- **Live infrastructure still unverified:** PostgreSQL, multi-process
  Redis, MinIO, ClamAV (migration/DR drills ran on scratch SQLite, as
  in v1.0.0). No production deployment has been performed.
- One classified minor finding remains open by decision: model↔migration
  index/nullable drift (`alembic check`), with a defined
  PostgreSQL-validated follow-up (`docs/SECURITY_REPORT.md` §5.1).
- npm audit could not run against the live registry from the
  verification sandbox (403 egress policy); the OSV lockfile fallback
  found no real vulnerabilities and CI runs the real audit.

## v1.0.0 — 2026-10-20

First consolidated release on `main`: all 18 development phases (0–17) plus three
hardening/remediation passes and the production-readiness mission, merged via
PR #1 from `hardening/remediation-pass-2`.

- PR #1 head: `b52ad245` (tree identical to `8e485f6c`, the CI-verified commit)
- Merge commit: `911259286e0cdc60ddbbc8984d86c592d7a41560`
- CI at merge: GitHub Actions Run 85 — **Success** (backend, web, crm, docker)

### Highlights
- Full platform: FastAPI API, Next.js web, CRM, Expo mobile shell, Tauri desktop shell.
- Security remediation passes 1–3: server-side 2FA enforcement, atomic token
  rotation with reuse detection, one-time WebSocket tickets, S3/MinIO storage
  provider, fail-closed rate limiting, PDF validation, secret-hygiene sweep
  (gitleaks full history: 0 live credentials).
- CI hardening: ruff pinned (0.17.1) with a no-increase baseline gate
  (160 frozen findings), blocking semgrep + pip-audit + npm audit gates,
  Alembic migration check, Docker builds gated on all app jobs.
- Dependency security: Next.js 15.5.28, next-intl 4.9.2, Vite 6.4.4,
  react-router-dom 7.18.4 (clears the audited Critical/High advisories).
- Bug found by CI and fixed: certificate/receipt PDF needs system fonts
  (fonts-noto-core + fonts-dejavu-core) — now in the production Dockerfile.
- Documentation: local-development and production-installation guides
  (English + Persian), rewritten root README, docs index.

### Test status at release
- Backend: 582 tests collected — 582 passed (dev env) / 581 passed + 1 skipped
  (clean CI-like env; the a11y test needs the Chromium pipeline), 0 failed.
- Known debt: mypy reports pre-existing type errors (non-blocking, visible in
  CI via continue-on-error); ruff baseline 160 frozen findings (gate rejects
  any increase).

### Known limitations (honest)
- The 45 binary assets (fonts/logo/icons) were uploaded to `main` via the
  GitHub web UI on 2026-10-20 and verified byte-identical (blob SHA) against
  the local repo — the tree on GitHub is now complete.
- Not yet verified on live infrastructure: PostgreSQL, multi-process Redis,
  MinIO, ClamAV, native mobile/desktop builds, EAS cloud builds (needs the
  owner's expo.dev connection).
- No production deployment has been performed by this release.
