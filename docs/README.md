# Documentation Index — Maturidi Academy

Every guide in this repository, in one place. Status as of 2026-10-21.
Only files that actually exist in the repo are listed here.

## Start here

| Document | What it is |
|---|---|
| [../README.md](../README.md) | Project entry page: quick start, structure, versions, honest capability status |
| [../CHANGELOG.md](../CHANGELOG.md) | Version-by-version changelog (v1.1.0, v1.0.0) |
| [../RELEASE_NOTES.md](../RELEASE_NOTES.md) | Release notes with honest limitations per version |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment index: local, Docker Compose production, Railway (config shipped, deploy BLOCKED), backup/restore |
| [RUNTIME_SUPPORT_MATRIX.md](RUNTIME_SUPPORT_MATRIX.md) | Supported runtimes: Python 3.14.0 / Node 24 LTS baselines, what is untested, SBOM link |
| [installation/LOCAL_DEVELOPMENT.md](installation/LOCAL_DEVELOPMENT.md) | Step-by-step local setup — Windows, macOS, Linux, plus mobile/desktop prerequisites |
| [installation/LOCAL_DEVELOPMENT.fa.md](installation/LOCAL_DEVELOPMENT.fa.md) | راهنمای نصب و اجرای محلی (فارسی) |
| [ops/production-installation.md](ops/production-installation.md) | Production installation on a real Linux server (compose, secrets, smoke tests, upgrade/rollback) |
| [ops/production-installation.fa.md](ops/production-installation.fa.md) | راهنمای نصب Production روی سرور (فارسی) |
| [ops/railway-deployment.md](ops/railway-deployment.md) | Railway deployment — configs shipped, deployment BLOCKED on owner account |
| [ops/APK_BUILD_GUIDE.md](ops/APK_BUILD_GUIDE.md) | راهنمای بیلد APK — CRM Builds dispatch flow, EAS profiles, owner steps (MOBILE-EAS-01) |

## Engineering rules & architecture

| Document | What it is |
|---|---|
| [engineering-contract.md](engineering-contract.md) | Binding engineering contract — read before any code change |
| [adr/](adr/) | Architecture decision records (index: [adr/README.md](adr/README.md)); start with ADR-001 (UI/UX replaceability) |
| [page-map.md](page-map.md) | Route/page map of the web app |
| [settings-schema.md](settings-schema.md) | Settings and environment-variable schema |
| [performance-budget.md](performance-budget.md) | Performance budgets (First Load JS, API timings) |
| [phase5-web-api-contract.md](phase5-web-api-contract.md) | Phase-5 web↔API contract (Quran) |

## Operations

| Document | What it is |
|---|---|
| [ops/deployment.md](ops/deployment.md) | Deployment notes |
| [ops/runbook.md](ops/runbook.md) | Operations runbook |
| [ops/disaster-recovery.md](ops/disaster-recovery.md) | Backup/restore policy, RPO 24h / RTO 4h, DR drill |
| [ops/staging.md](ops/staging.md) | Staging environment notes |
| [ops/storage.md](ops/storage.md) | Storage (S3/MinIO) notes |
| [ops/scaling-to-100k.md](ops/scaling-to-100k.md) | Scaling path to 100k users |
| [operations/runbook.md](operations/runbook.md) | Operations runbook (operations series) |
| [operations/scaling.md](operations/scaling.md) | Scaling notes (operations series) |

## Audits, security, testing

| Document | What it is |
|---|---|
| [SECURITY_REPORT.md](SECURITY_REPORT.md) | v1.1.0 consolidated security report: scan results, MFA properties, scope-enforcement fix, residuals |
| [MFA_GUIDE.md](MFA_GUIDE.md) | MFA user/admin guide (fa summary + EN): enrollment, recovery codes, disable/regenerate, admin recovery, rate limits |
| [audit-v2/AUDIT_REPORT.md](audit-v2/AUDIT_REPORT.md) | Phase-0 audit for the v2 remediation mission (19 findings, F-01…F-19) |
| [audit-v2/FEATURE_STATUS_MATRIX.md](audit-v2/FEATURE_STATUS_MATRIX.md) | Per-feature real status at audit time, with evidence |
| [audit-v2/FINAL_VERIFICATION.md](audit-v2/FINAL_VERIFICATION.md) | Final verification of the v1.1.0 tree: verbatim test/scan/drill outputs |
| [audit-v2/TYPE_DEBT_BURNDOWN.md](audit-v2/TYPE_DEBT_BURNDOWN.md) | mypy 163 → 0 and ruff 160 → 133 burndown record + residual plan |
| [audit-v2/DONE_CRITERIA.md](audit-v2/DONE_CRITERIA.md) | §16-style done matrix: PASS/FAIL/BLOCKED/NOT TESTED per area |
| [audit-v2/SBOM.cdx.json](audit-v2/SBOM.cdx.json) | SBOM (CycloneDX 1.6, API dependencies) |
| [calculators/CALCULATORS_INTEGRATION.md](calculators/CALCULATORS_INTEGRATION.md) | Source calculators integration: provenance, license decision, golden tests, fiqh-review status |
| [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | Third-party content notices (source calculators) |
| [audits/PHASE17_REMEDIATION_REPORT.md](audits/PHASE17_REMEDIATION_REPORT.md) | Consolidated remediation report for the hardening passes on PR #1 |
| [audit/production-readiness.md](audit/production-readiness.md) | Production-readiness audit notes |
| [audit/initial-audit.md](audit/initial-audit.md) | Initial audit |
| [audit/findings-matrix.md](audit/findings-matrix.md) | Findings matrix |
| [audit/fix-plan.md](audit/fix-plan.md) | Fix plan |
| [audit/security-hardening.md](audit/security-hardening.md) | Security hardening notes |
| [audit/architecture-drift.md](audit/architecture-drift.md) | Architecture drift review |
| [audit/backup-restore.md](audit/backup-restore.md) | Backup/restore audit |
| [audit/test-results.md](audit/test-results.md) | Audit test results |
| [audit/false-positives.md](audit/false-positives.md) | Proven false positives |
| [security/phase17-findings.md](security/phase17-findings.md) | Phase-17 security findings |
| [security/bandit-report.txt](security/bandit-report.txt) · [security/bandit-report-after.txt](security/bandit-report-after.txt) | Bandit reports (before/after) |
| [security/semgrep-report.json](security/semgrep-report.json) (+ `semgrep-report-after.json`, `semgrep-report-extended*.json`) | Semgrep reports |
| [testing/phase17-test-report.md](testing/phase17-test-report.md) | Phase-17 test report |
| [testing/a11y-phase17.md](testing/a11y-phase17.md) | Accessibility (axe) report |

## App-level READMEs

| Document | What it is |
|---|---|
| [../apps/api/README.md](../apps/api/README.md) | API app notes |
| [../apps/crm/README.md](../apps/crm/README.md) | CRM app notes |
| [../apps/mobile/README.md](../apps/mobile/README.md) | Mobile app notes |
| [../apps/desktop/README.md](../apps/desktop/README.md) | Desktop app notes |
| [../packages/README.md](../packages/README.md) | Shared packages notes (design-tokens, ui-web, ui-native) |

## Infrastructure assets (not docs, referenced by the guides)

- `../docker-compose.yml` — dev stack (postgres, redis, minio, api, prometheus, grafana, loki)
- `../docker-compose.prod.yml` — production stack (incl. one-shot `migrate` job and six workers)
- `../infra/backup.sh` — backup script with SHA-256 manifests
- `../infra/monitoring/prometheus.yml` — Prometheus scrape config
- `../infra/metabase/` — Metabase compose + dashboard seeds
- `../.github/workflows/` — `ci.yml`, `mobile.yml`, `desktop.yml`
