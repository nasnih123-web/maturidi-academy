# Done Criteria — Master Execution Prompt v2 (§16-style matrix)

- **Tree:** `release/v1.1.0-remediation` @ `1963394` · **Date:** 2026-10-21
- **Status key:** PASS / FAIL / BLOCKED / NOT TESTED — used exactly as the
  evidence supports; nothing here upgrades a status beyond its source.
- **Primary evidence:** `FINAL_VERIFICATION.md` (same folder),
  `AUDIT_REPORT.md` (Phase-0 findings), `TYPE_DEBT_BURNDOWN.md`,
  `../calculators/CALCULATORS_INTEGRATION.md`, `../ops/APK_BUILD_GUIDE.md`,
  `../ops/railway-deployment.md`, `../adr/0022*`, `../adr/0023*`.

| # | Area | Status | Evidence (one line) |
|---|---|---|---|
| 1 | Backend test/type/lint gates | ✅ PASS | pytest **630 passed / 1 skipped / 0 failed** on Python 3.14.0; `mypy app` **0 errors** (was 163); ruff gate PASS at baseline **133** (was 160). |
| 2 | Security scans | ✅ PASS (with documented exceptions) | pip-audit clean (CI ignore flags removed); semgrep 0 findings / 299 rules; bandit + gitleaks: documented false positives only. npm audit **BLOCKED in sandbox** (registry 403) with OSV fallback: 0 real vulns (web 150 pkgs; crm 170 pkgs, 1 proven grapesjs FP). |
| 3 | MFA (audit F-01 Critical, F-02 High) | ✅ PASS | Full lifecycle endpoints (setup/enable/status/disable/regenerate/recover) + CRM `settings/security` enrollment UI; 13 dedicated tests incl. replay, single-use codes, rate limits, restricted-token surface. |
| 4 | MFA scope enforcement | ✅ PASS | `2fa_setup` token whitelisted in `get_current_user` (all other routes 403) + per-request DB re-check; bypass class test-pinned. |
| 5 | CRM RBAC honesty (F-07) | ✅ PASS | `UserOut` now exposes real `roles`/`permissions`; CRM gating reads them — the permissive stub is gone. |
| 6 | Calculator — zakat (source rules) | ✅ PASS (integration) | Engine re-implemented (no source code copied); golden battery **131/131** vs the original page; seeded as v2 **DRAFT**. |
| 7 | Calculator — miras / fara'id | ✅ PASS (integration) | Sirajiyyah pipeline engine, exact `Fraction` shares; golden battery **53/53**; seeded as v2 **DRAFT**. |
| 8 | Calculator — mosaref (Arabic conjugation) | ✅ PASS | Pure engine, golden battery **41/41**; fully public (not fiqh, no gate). |
| 9 | Fiqh scholar review of source rules | ⛔ BLOCKED | External dependency: qualified Hanafi scholar review has not happened; public gate stays **closed** (`422 rules_not_approved`), UIs show the honest pending state. Flagged source deviations are documented for the reviewer in `CALCULATORS_INTEGRATION.md`. |
| 10 | Mobile assets & config (F-03/F-04/F-09) | ✅ PASS | Real icon/adaptive/splash/notification assets generated from the school emblem; `eas.json` with an explicit APK-producing `production-apk` profile; dynamic `app.config.js` — production profiles fail loudly without a real API URL (no silent localhost). |
| 11 | Real EAS APK build (MOBILE-EAS-01) | ⛔ BLOCKED | Needs the owner's Expo account/token + Android keystore; `extra.easProjectId` is honestly empty, never faked. Exact owner steps in `../ops/APK_BUILD_GUIDE.md` §5. |
| 12 | CRM Builds machinery (F-05) | ✅ PASS | Real GitHub `workflow_dispatch` + ARQ status sync; unconfigured provider answers honest `503 build_provider_not_configured`; legacy rows labeled "not dispatched", never fake-queued. End-to-end artifact still depends on #11. |
| 13 | Desktop (F-06/F-12) | ✅ PASS (config-level) | ADR-0023 local shell shipped (`frontendDist → ../shell`), real icon set generated, referenced paths verified on disk. Note: the divergent root `apps/desktop/tauri.conf.json` was **not** deleted — it differs meaningfully; ADR-0023 assigns its removal to the owner's review. |
| 14 | Desktop native builds | ⚪ NOT TESTED | No Rust toolchain in the verification sandbox; builds run on the per-OS CI runners (`desktop.yml`). |
| 15 | Local deployment | ✅ PASS | Bootstrap scripts + guides synced to Python 3.14 / Node 24 (bootstrap.ps1's hard 3.12 gate updated); compose definitions statically validated. A full clean-machine boot remains the install guide's manual smoke test, not an automated claim. |
| 16 | Production compose deployment | ⚪ NOT TESTED (live) | Compose is configuration-complete (non-root API, graceful shutdown, healthchecks) and images build in CI; no live production deployment has been performed (standing limitation). |
| 17 | Railway deployment | ⛔ BLOCKED | All service configs shipped and statically validated (`../ops/railway-deployment.md`); deployment itself blocked on the owner's Railway account. Known CRM `$PORT`/nginx adaptation documented in the guide. |
| 18 | CI strictness | ✅ PASS | Typecheck is **blocking** (`continue-on-error` removed); pip-audit runs with zero ignore flags; semgrep blocking; ruff ratchet rejects any increase. Verified locally with the exact CI commands; the branch's first GitHub Actions run happens with the phase-11 PR. |
| 19 | DB migrations up/down | ✅ PASS | Scratch-DB drill: `upgrade head` → 97 tables (head `c9d4e5f6a7b8`), downgrade −1 → upgrade head round-trip OK. |
| 20 | Backup / restore drill | ✅ PASS | Backup → wipe → restore reproduced the identical canonical content SHA-256; row counts equal on all 97 tables. (Scratch SQLite; `infra/backup.sh` targets Docker/PostgreSQL — standing sandbox limitation.) |
| 21 | Model ↔ migration consistency (`alembic check`) | ❌ FAIL (minor, classified) | ~94 ops reported: mostly SQLite reflection artifacts + index-name pairs; small real subset (a few un-migrated model indexes, 3 `created_at` nullable mismatches). Follow-up defined (one reviewed reconciliation migration validated on PostgreSQL); deliberately not auto-fixed — see `FINAL_VERIFICATION.md` §6 and `../SECURITY_REPORT.md` §5.1. |
| 22 | Documentation (Phase 10) | ✅ PASS | This matrix plus `../RUNTIME_SUPPORT_MATRIX.md`, `../SECURITY_REPORT.md`, `../MFA_GUIDE.md`, `../DEPLOYMENT.md`, `../../CHANGELOG.md`, updated `../../RELEASE_NOTES.md`, Dependabot config, and the docs index. |
| 23 | Release v1.1.0 (PR, merge, tag, assets) | ⏳ NOT YET | Phase 11 is pending: the branch has not been pushed, no PR opened, no tag created. Do not cite v1.1.0 as released until phase 11 completes. |

## How to read this matrix

- **BLOCKED** always names an external dependency (Expo account, Railway
  account, scholar review) — never a euphemism for unfinished code. The
  code-side preparation for every BLOCKED row is complete and evidenced.
- **NOT TESTED** means no execution happened in this environment (native
  desktop builds, live production); config-level verification, where it
  exists, is stated separately.
- Row 21 is the only **FAIL**, and it is intentionally left unfixed by the
  verification phase: the safe fix requires PostgreSQL validation, and an
  unverified auto-generated 94-op migration was judged the bigger risk.
