# Final Verification — release/v1.1.0-remediation (Phases 8+9)

- **Branch / HEAD verified:** `release/v1.1.0-remediation` @ `19633944673ebc1a501f77fe69acf8657f7e3e24`
- **Date:** 2026-10-21 · **Python:** 3.14.0 (venv `~/.venvs/py314-fresh`) · **Node:** v24.20.0
- Method: every number below is the verbatim output of the command named. Nothing was weakened, skipped, or re-run selectively to change an outcome. One finding (item 6) is reported, not papered over.

## 1. Test suite — PASS
`cd apps/api && python -m pytest -q`
→ **630 passed, 1 skipped, 0 failed**, 550 warnings, 371.38 s.
(Progression: v1.0.0 baseline 581 → +13 Phase-2 MFA → 594 → +12 Phase-4 calculators → 606 → +24 Phase-5/6/7 builds/desktop/deploy → 630. The 1 skip is the pre-existing Chromium-pipeline a11y test.)

## 2. Type & lint gates — PASS
- `mypy app` → **“Success: no issues found in 164 source files”** (0 errors; was 163 at mission start).
- `tools/check_ruff_baseline.py` → **PASS** — exactly at baseline **133**, no increase (baseline was 160 at mission start).

## 3. SECURITY REPORT (scans on the final tree)
| Scan | Command | Result |
|---|---|---|
| pip-audit | `pip-audit -r apps/api/requirements.txt` | **No known vulnerabilities found** (all 8 v1.0.0 advisories cleared by the Phase-1 upgrade; CI ignore flags removed) |
| semgrep | `semgrep --config auto apps/api` (exact CI command, `--error`) | **299 rules on 203 files: 0 findings** |
| bandit | `bandit -r apps/api/app` | 20 findings: **7 HIGH = B613 ×7** — identical to the Phase-17 documented false positives (no new HIGH); **0 MEDIUM**; 13 LOW (B101×1, B110×7, B112×2, B404×1, B603×1, B607×1) |
| gitleaks | `gitleaks git .` (v8.28.0), 74 commits, 15.42 MB | **1 hit — FALSE POSITIVE**: rule `generic-api-key` at `apps/api/tests/test_security_phase17.py:882` (commit `9558473e12`, also on main): the literal is `mk_invalid_key_123`, a deliberately-invalid fixture asserted to be rejected with 401. No real credential anywhere in history. |
| npm audit (web, crm) | `npm audit` | **BLOCKED in this sandbox**: registry audit endpoint returns `403 policy_denied` (egress policy), for both apps. Fallback = OSV batch query over the lockfiles: **web 150 packages → 0 vulns**; **crm 170 packages → 1 hit: GHSA-589f-c66p-hxr4 (grapesjs)** — documented false positive: installed **0.23.8**, outside the advisory's affected range (proven during PR #1; OSV range matching over-reports it). CI runs the real npm/OSV audit on GitHub runners, where the endpoint is reachable. |
| SBOM | `cyclonedx-bom` over `apps/api/requirements.txt` | ✅ [SBOM.cdx.json](SBOM.cdx.json) — CycloneDX 1.6, **34 components** |

**Residual security notes:** no Critical/High actionable findings. The MFA scope-bypass class fixed in Phase 2 is covered by `tests/test_phase2_mfa.py` (13 tests, incl. restricted-token surface + replay + rate-limit).

## 4. JS dependency audits
Covered in §3 (npm audit BLOCKED-by-network with OSV fallback evidence above). No critical/high real findings.

## 5. Migrations + backup/restore drill — PASS
Scratch SQLite (`DATABASE_URL=sqlite+aiosqlite:////tmp/drill.db`):
1. `alembic upgrade head` from empty → head **`c9d4e5f6a7b8`**, **97 tables** created.
2. `alembic downgrade -1` → `a2fa20261021` ✅ → `alembic upgrade head` → `c9d4e5f6a7b8` ✅.
3. Drill (pattern of `docs/ops/disaster-recovery.md`; prod tool is `infra/backup.sh` = pg_dump+SHA-256 manifest, Docker/PostgreSQL — not runnable in this sandbox, same standing limitation as v1.0.0):
   - Seeded 1 user + 1 role. Canonical content SHA-256 (all 97 tables): `4368b7dfcc236d8fb523b91ab7cf6c0e5177fb028a7acbc71042276cf7e70f5c`
   - Backup artifact (SQLite backup API): 1,814,528 bytes, SHA-256 `007cdb7fc9b503e2897e346158ba0764c06673c424e713cec82c8e39f721e9df`
   - Wiped source rows (users → 0), restored to a fresh DB → canonical SHA-256 **identical**, per-table row counts **equal on all 97 tables**. **DRILL PASS.**
   - The suite also carries the automated variant: `tests/test_infra_track_b.py::test_backup_restore_drill` (green in item 1).

## 6. Model ↔ migration consistency — ⚠️ FINDING (reported, not auto-fixed)
`alembic check` against the scratch DB **fails**: ~94 detected operations. Classification after inspecting the diff and the migration sources:
- **Reflection artifacts (bulk, not real drift):** 13× `modify_type NUMERIC()→Uuid()` — migrations declare `sa.Uuid()`; SQLite reflects the type by affinity (on PostgreSQL these are native `uuid`, no drift). Same class: VARCHAR↔String spellings, and 3× unique-**constraint** vs unique-**index** representation differences (functionally equivalent uniqueness).
- **Index-name pairs:** 52 add / 26 remove ops, mostly the same index under a migration-era hand-written name (e.g. `ix_dhikr_sessions_user`) vs the model's generated name (`ix_dhikr_sessions_user_id`) — the indexes exist and function.
- **Real, minor subset:** a few model indexes with no migration (e.g. `ix_zakat_rule_configs_madhab`, `ix_notifications_notif_type`, several `created_at` indexes) and 3× `created_at` nullable mismatches (`projects`, `staff_members`, `tasks`: DB nullable, model non-nullable with a Python-side default). Impact: performance/cosmetic only — no data-integrity or upgrade-path impact; the gated path (upgrade/downgrade, item 5) is clean.
- **Recommendation (follow-up, deliberately NOT done in a verification phase):** one reviewed “index/nullable reconciliation” migration generated and validated against PostgreSQL, plus optionally an `alembic check` CI job on PostgreSQL. Auto-generating a 94-op migration against SQLite reflection and shipping it unverified would be riskier than the drift.

## 7. Builds — PASS
- **web:** `npm run build` with the CI env (`NEXT_PUBLIC_API_URL`/`API_URL=http://localhost:8000`) → exit 0, **98/98 pages**. (A first attempt without those env vars failed at `/api/search` page-data collection — a harness env omission, not a code failure; recorded here for completeness.)
- **crm:** `VITE_API_URL=https://api.example.invalid npm run build` → exit 0 (tsc + vite).
- **mobile:** `npm ci` → exit 0; `npm run typecheck` (`tsc --noEmit`) → exit 0. Dynamic `app.config.js` resolution verified by direct evaluation:
  - `production-apk` + `EXPO_PUBLIC_API_URL=https://api.maturidi.example` → `extra.apiUrl = https://api.maturidi.example` (not localhost) ✅
  - `production-apk` without the env → **throws** (fails loudly) ✅; with a localhost URL → **throws** ✅; development default → localhost (allowed) ✅
  - `extra.easProjectId = ""` — honest empty; real EAS builds remain **BLOCKED** on the owner's Expo account (MOBILE-EAS-01, see APK_BUILD_GUIDE).

## 8. Desktop — PASS (config-level)
- `src-tauri/tauri.conf.json` `frontendDist = ../shell` → the shell dir exists; `shell/config.js` + `shell/shell.js` pass `node --check`.
- Every referenced icon exists on disk: `icons/32x32.png` (2,996 B), `icons/128x128.png` (37,508 B), `icons/128x128@2x.png` (131,687 B), `icons/icon.png` (442,079 B), `icons/icon.ico` (191,830 B), `icons/icon.icns` (2,521,696 B). Tray icon `icons/icon.png` ✅.
- Native Tauri builds remain **NOT TESTED** in this sandbox (no Rust toolchain) — they run on the per-OS CI runners (desktop.yml), per ADR-0023.

## Summary matrix
| Area | Status |
|---|---|
| pytest (3.14) | ✅ PASS — 630 / 1 skipped / 0 failed |
| mypy / ruff gate | ✅ PASS — 0 errors / baseline 133 exact |
| pip-audit / semgrep | ✅ PASS — 0 vulns / 0 findings |
| bandit / gitleaks | ✅ PASS with documented false positives only |
| npm audit | ⚠️ BLOCKED in sandbox (403); OSV fallback: 0 real vulns |
| SBOM | ✅ CycloneDX 1.6, 34 components |
| Migrations up/down | ✅ PASS — 97 tables, head `c9d4e5f6a7b8` |
| Backup/restore drill | ✅ PASS — canonical SHA-256 match |
| alembic check (drift) | ⚠️ FINDING — mostly reflection artifacts; small real index/nullable subset, follow-up defined |
| web / crm / mobile builds | ✅ PASS |
| Desktop config/icons | ✅ PASS (native build NOT TESTED — CI runners) |
