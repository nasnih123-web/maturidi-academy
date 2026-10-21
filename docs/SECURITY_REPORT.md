# Security Report — Maturidi Academy v1.1.0

- **Scope:** `release/v1.1.0-remediation` @ `1963394` (final verified tree),
  2026-10-21.
- **Primary evidence:** `audit-v2/FINAL_VERIFICATION.md` (verbatim command
  outputs), `audit-v2/AUDIT_REPORT.md` (Phase-0 findings F-01…F-19),
  `docs/calculators/CALCULATORS_INTEGRATION.md`. This report consolidates;
  it does not re-run or soften any result.

## 1. Scan results (final tree)

| Scan | Command | Result |
|---|---|---|
| pip-audit | `pip-audit -r apps/api/requirements.txt` | ✅ **No known vulnerabilities found.** All 8 v1.0.0 advisories (7× starlette via fastapi 0.115.6, 1× pytest) were cleared by the Phase-1 upgrade (fastapi 0.156.4 / starlette 1.9.0, pytest 9.1.1); the CI `--ignore-vuln` flags were **removed**, not extended. |
| semgrep | `semgrep --config auto apps/api` (exact CI command, `--error`) | ✅ **0 findings** — 299 rules over 203 files. |
| bandit | `bandit -r apps/api/app` | ⚠️ 20 findings, all classified: **7 HIGH = B613 ×7** — identical to the Phase-17 documented false positives; **0 MEDIUM**; 13 LOW (B101×1, B110×7, B112×2, B404×1, B603×1, B607×1). No new HIGH introduced by v1.1.0 work. |
| gitleaks | `gitleaks git .` (v8.28.0, 74 commits, 15.42 MB) | ⚠️ 1 hit — **false positive**: rule `generic-api-key` at `apps/api/tests/test_security_phase17.py:882`; the literal is `mk_invalid_key_123`, a deliberately invalid fixture asserted to be rejected with 401 (present since v1.0.0). No real credential anywhere in history. |
| npm audit (web, crm) | `npm audit` | ⚠️ **BLOCKED in the verification sandbox** (registry audit endpoint returns `403 policy_denied` under the sandbox egress policy — for both apps). Fallback used: OSV batch query over the lockfiles — **web: 150 packages → 0 vulnerabilities; crm: 170 packages → 1 hit**, GHSA-589f-c66p-hxr4 (grapesjs), a **documented false positive**: installed grapesjs is 0.23.8, outside the advisory's affected range (OSV range matching over-reports it; proven during PR #1). CI runs the real audit on GitHub runners, where the endpoint is reachable. |
| SBOM | `cyclonedx-bom` over `apps/api/requirements.txt` | ✅ CycloneDX 1.6, 34 components — `audit-v2/SBOM.cdx.json`. |

**Summary:** no Critical/High *actionable* findings. Every non-clean result
above is either a previously documented false positive or an
environment-blocked check with a fallback result recorded.

## 2. MFA security properties (Phase 2 — closes audit F-01 Critical + F-02 High)

Implemented in `apps/api/app/modules/auth/` and covered by
`tests/test_phase2_mfa.py` (13 tests):

- **Complete lifecycle:** `POST /auth/2fa/setup`, `POST /auth/2fa/enable`,
  `GET /auth/2fa/status`, `POST /auth/2fa/disable`,
  `POST /auth/2fa/recovery/regenerate`, `POST /auth/2fa/recover`.
- **Enrollment UI exists** (the F-01 dead end is closed): CRM
  `settings/security` page — QR code from the provisioning URI + manual
  secret, one-time recovery-code display with copy/download and a
  mandatory saved-confirmation. A restricted session is force-routed to
  this page and can reach nothing else (CRM `App.tsx` guard).
- **TOTP replay protection:** each time step can be claimed exactly once
  (`_claim_totp_step`, atomic); verification window ±1 step
  (`verify_totp_step`).
- **Recovery codes:** 10 codes, generated with a CSPRNG, **stored only as
  hashes** (`hash_token`), single-use; regeneration replaces the whole
  set atomically in one transaction (old codes invalid from commit).
- **Re-authentication for sensitive changes:** disable and regenerate
  require the current password **and** a second factor (current TOTP code
  or an unused recovery code).
- **Session consequences:** disable revokes the user's other sessions;
  the unauthenticated recovery path clears TOTP and revokes **all** of the
  user's tokens.
- **Rate limits (fail-closed limiter):** enable 20/600 s per user;
  disable 10/600 s per user; regenerate 10/600 s per user; recover
  10/3600 s per IP.
- **Audit events** are written for enable/disable/regenerate/recover
  transitions (method recorded, never secrets).
- User guide: [`MFA_GUIDE.md`](MFA_GUIDE.md).

## 3. Scope-enforcement fix (Phase 2 — the second half of F-01)

Before Phase 2, only permission-gated dependencies checked token scope:
a restricted **`2fa_setup`-scope token** (issued to privileged users who
have not yet enrolled) could call every plain `get_current_user` endpoint
(profile, data export, account deletion, session management, …).

Fix (`app/modules/auth/dependencies.py`): `get_current_user` now enforces
a whitelist for the `2fa_setup` scope — only
`/api/v1/auth/2fa/setup`, `/api/v1/auth/2fa/enable`,
`/api/v1/auth/2fa/status`, and `/api/v1/auth/logout` are reachable; every
other route returns **403**. Additionally, `_reject_privileged_without_2fa`
re-reads the user's *current* DB state on permission-gated requests
(defense in depth): a stale full-scope token does not keep working after a
role promotion or a 2FA disable. WebSocket tickets were already restricted
to full-scope sessions. The restricted-token surface is pinned by tests
(setup/status/enable reachable; `/users/me`, notifications, ws-ticket →
403).

## 4. Type & lint gates as security controls

- **mypy: 0 errors** (was 163 at mission start, mypy 2.4.0) and the CI
  Typecheck step is now **blocking** — `continue-on-error` was removed,
  not worked around (`audit-v2/TYPE_DEBT_BURNDOWN.md`). The one test that
  pinned the old arrangement now pins the stronger invariant (zero
  `continue-on-error` in `ci.yml`).
- **ruff baseline: 133**, down from 160, enforced by
  `tools/check_ruff_baseline.py` (fails on any increase or new
  (file, rule) pair). The residual 133 are dominated by deliberate,
  reviewed patterns (broad-catch `BLE001`/`S110` at integration edges,
  bidi characters in fa/ar literals `PLE2502`, test idioms); the burndown
  order for a future pass is recorded in
  `audit-v2/TYPE_DEBT_BURNDOWN.md` (F841/RUF059 per-file first, TRY004
  only with an API-contract review).

## 5. Residuals & known limitations (not fixed in v1.1.0, stated plainly)

1. **Alembic model↔migration drift (minor).** `alembic check` reports
   ~94 operations, classified in `FINAL_VERIFICATION.md` §6: the bulk are
   SQLite reflection artifacts (type spellings, constraint-vs-index
   representation) and 78 index-name pairs (same index, migration-era vs
   model-generated name — indexes exist and function). The **real subset**
   is small: a few model indexes with no migration (e.g.
   `ix_zakat_rule_configs_madhab`, `ix_notifications_notif_type`, several
   `created_at` indexes) and 3 `created_at` nullable mismatches
   (`projects`, `staff_members`, `tasks`: DB nullable, model non-nullable
   with a Python-side default). Impact is performance/cosmetic only; the
   gated path (upgrade/downgrade/drill) is clean. **Follow-up defined,
   deliberately not auto-fixed:** one reviewed index/nullable
   reconciliation migration validated against PostgreSQL, optionally plus
   an `alembic check` CI job on PostgreSQL. Auto-generating a 94-op
   migration from SQLite reflection and shipping it unverified was judged
   riskier than the drift.
2. **npm audit** could not run against the live registry from the
   verification sandbox (403); the OSV fallback found no real
   vulnerabilities, and CI runs the real audit — but a same-day live
   `npm audit` result for this exact tree does not exist. Status:
   **BLOCKED (environment)**, not "clean".
3. **Calculator fiqh content** (zakat/inheritance source rules) is seeded
   as v2 **DRAFT** pending qualified scholar review; the public gate stays
   closed (endpoints answer `422 rules_not_approved`). This is a content
   status, not a code vulnerability — see
   `docs/calculators/CALCULATORS_INTEGRATION.md`, incl. the flagged
   source deviations reproduced faithfully for the reviewer.
4. **Standing infra limitations (unchanged from v1.0.0):** live
   PostgreSQL, multi-process Redis, MinIO, and ClamAV have not been
   verified on real infrastructure; no production deployment has been
   performed. Bandit's 7 B613 HIGH false positives and the gitleaks
   fixture hit remain accepted-and-documented, as in Phase 17.
