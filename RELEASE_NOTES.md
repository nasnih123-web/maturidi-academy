# Release Notes — Maturidi Academy

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
