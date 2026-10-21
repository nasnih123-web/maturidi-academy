# Type Debt Burndown — Maturidi Academy v1.1.0 Remediation

- **Tree:** `~/workspace/maturidi-v110`, branch `release/v1.1.0-remediation` (on top of Phase-1 commits `b2165f3`, `7ff77cd`).
- **Date:** 2026-10-21. **Scope:** `apps/api/app` (159 source files), CI Typecheck step, ruff baseline.
- **Toolchain:** Python 3.14 venv, **mypy 2.4.0** (now pinned in `apps/api/requirements.txt`), ruff 0.17.1 (pinned earlier).

## Result

| Metric | Before | After |
|---|---|---|
| `mypy app` errors (from `apps/api`) | **163 in 34 files** | **0 — Success, exit 0** |
| `pytest tests/ -q` (Python 3.14) | 581 passed / 1 skipped | 581 passed / 1 skipped (unchanged) |
| ruff baseline total (`tools/ruff_baseline.json`) | 160 | **133** (gate PASS) |
| CI Typecheck | `continue-on-error: true`, stale "141 errors" comment | **blocking**, `mypy app` from `apps/api` |

**Counting note:** the starting number depends on the mypy version — the Phase-0 audit measured 159 with its scratch-venv mypy, the old CI comment said 141, and mypy 2.4.0 measures **163 in 34 files** on the identical tree. 163 is the baseline for this burndown because 2.4.0 is the version now pinned everywhere (requirements + CI). After only the config + stubs step (below), the count was 147 in 30 files; the remaining 147 were fixed in code.

## How it was fixed, by error class

1. **Configuration & missing stubs (163 → 147).** New `apps/api/mypy.ini` (`python_version = 3.14`; *no* error codes disabled). `ignore_missing_imports` per-module overrides exist **only** for third-party libraries that publish no stubs and are imported lazily/optionally: `telethon`, `arabic_reshaper`, `bidi`, `faster_whisper`, `sentence_transformers`, `pgvector`. reportlab was **not** silenced — the real stub package `types-reportlab` was installed and pinned in requirements instead. Config-discovery caveat: mypy only finds `apps/api/mypy.ini` when run from inside `apps/api`, so the CI step uses `working-directory: apps/api` + `mypy app`.

2. **`Result` vs `CursorResult` (`rowcount`).** SQLAlchemy stubs type DML `execute()` as `Result`, which has no `rowcount`; the runtime object is a `CursorResult`. Fixed with `cast(CursorResult[Any], await db.execute(update(...)))` at 5 sites (`auth/service.py` ×4, `admin/users_admin_router.py` ×1), each the standard SQLAlchemy 2.x pattern.

3. **`scalars().all()` returns `Sequence`, not `list`.** Where a `list[T]` was declared/returned, wrapped in `list(...)` (social/fatwa pagination, lms, `trusted_source_list`).

4. **String-keyed model registries (generic dispatch).** `cms_service.py` (33 errors) and `calculators/service.py` (17) dispatched through `dict[str, type[Model]]` and touched per-model columns. Fixed with union aliases over exactly the models that share the accessed columns (`WorkflowModel`/`CmsModel`, `RuleConfig`), `isinstance(obj, _WORKFLOW_CLASSES)` guards replacing `hasattr` checks (proven equivalent: only the workflow models carry those columns), and a small number of casts at invariant points (documented at each site in Persian comments — e.g. `AsyncSession.get` falls back to `Base` for union entity types, verified with `reveal_type`).

5. **Optional returns not narrowed.** `telegram/distribute_service.get_policy` got `Literal[True]/Literal[False]` overloads (create=True always returns a policy; create=False callers already handled `None`). `import_service` now narrows via `if client is None:` directly instead of a boolean alias mypy cannot track. Genuine `None` guards added where the contract allows `None` (lms certificate issuance, library transcript search).

6. **JSON dict columns → pydantic models.** Dict-typed ORM columns passed to `LocalizedText`-typed schema fields now go through explicit `Model.model_validate(...)` — exactly pydantic's own coercion, made visible (projects, social router, users router `UserOut`, admin content-center `ContentItemOut`, library `SearchHitOut`). No validation behavior changed; the test suite confirms byte-identical responses.

7. **Heterogeneous literal data inferred as `dict[str, object]` / `Collection`.** Demo/seed data structures got real `TypedDict`s: `_DemoSpec` (library seed), `_TopicSpec` (fatwa seed), `LegalBlock` (content/legal — all 24 blocks share one exact shape). `_paragraph(*spec["paragraph"], lang)` in `seed_fatwa.py` was a *typing* false alarm, not a spread bug: the tuple is a 2-tuple and the call is correct.

8. **Stub quirks worked around without ignores.**
   - `seed.py main()`: SQLAlchemy stub inference solves `session.get` against `Row[RolePermission]` when one session also runs `select(RolePermission)` executes. The one affected existence check now uses the equivalent `select(PlatformSetting).where(key == ...)` PK lookup.
   - `Model.__table__.delete()` is untyped in the stubs → replaced with the `delete(Model)` construct (identical SQL) in `roles_service.py`, `users_admin_router.py`.
   - `stmt.where(False)` (plain `bool` rejected) → `stmt.where(false())` in `control_registry.py` (identical generated SQL).
   - pyotp 2.10's stub requires `for_time: datetime`; `security.py` now passes `datetime.fromtimestamp(step * STEP, tz=UTC)` — `pyotp.at()` computes the identical counter (verified against the installed pyotp source).

9. **Small honest typings.** `MtprotoMessage._raw` declared on the wrapper class; `platform_settings` cache sentinel replaced by a `dict.get` None-check (values are tuples, never `None` — and this let a pre-existing `type: ignore[return-value]` be **deleted**); voice `_voice_setting` annotated `-> Any` (platform settings are genuinely untyped); `connections_service` status dict annotated `dict[str, Any]`; sync note payload annotated + hoisted to typed locals; `cms_router` factory params typed `type[BaseModel]` with `model_dump` invoked via `BaseModel` (the endpoint annotations themselves must stay dynamic — FastAPI resolves them at runtime).

## `type: ignore` inventory

**Added by this burndown: none.** Removed: 1 (platform_settings, made unnecessary by the sentinel fix). Remaining in `apps/api/app` — all pre-existing, all with specific codes and justification comments:

| Site | Code | Justification |
|---|---|---|
| `app/modules/auth/dependencies.py:51,96,122` | `assignment` | FastAPI injects `Request`; the `= None` default is the documented injection pattern. |
| `app/modules/content/cms_router.py:67,90` | `valid-type` | Endpoint body annotations are runtime schema classes passed into the router factory; they must remain dynamic for FastAPI. |

Casts used (each commented at the site with its invariant): `cms_service` ×8, `auth/service` ×4 (CursorResult), `projects/service` ×2, `lms/service` ×1, `users_admin_router` ×1 (CursorResult).

## Ruff reduction (160 → 133)

15 rules fully eliminated — 23 `(file, rule)` pairs zeroed, gate `tools/check_ruff_baseline.py` PASS at the regenerated baseline, **no pair increased**:
`SIM102` ×7 (collapsible ifs), `PYI063` ×4 (pydantic `model_post_init` → PEP 570 positional-only), `SIM103` ×2 (direct negated returns), `PLW1510` ×2 (explicit `check=False` where returncode is asserted manually), `RUF007` ×2 (`itertools.pairwise`), and one each of `RUF012` (ClassVar), `SIM117` (combined `async with`), `PLC0206` (`.items()`), `RUF046` (redundant `int()`), `SIM115`, `RUF015`, `C408`, `PERF102`, `UP031`, `PIE810`, plus the I001 import-sort fixes.

## Residual plan

- **mypy:** zero debt; the blocking CI step is the guard. Keep mypy pinned — counts drift across mypy versions (163 vs 159 vs 141 above), so version bumps should be deliberate, single-commit events. `app/core/rate_limit.py` has one untyped function whose body mypy does not check (annotation-unchecked note); typing it is a small future cleanup, not debt.
- **ruff (133 left):** dominated by deliberate patterns — `BLE001` 41 + `S110` 10 (broad-catch resilience at integration edges, each site reviewed in earlier hardening passes), `RUF059` 29 + `F841` 8 (mostly test unpackings; safe but high-churn — clear per-file in a dedicated pass), `TRY004` 19 (would change exception types = API contract review first), `PLE2502` 13 (bidi-control characters inside Persian/Arabic string literals — content, not code defects), `ASYNC230`/`S112`/`B015`/`TRY002`/`S102`/`N999` 12 (test-infra idioms and one intentional `exec` test). Recommended order for a future pass: F841/RUF059 per-file, then TRY004 with API review; leave BLE001/S110/PLE2502 as documented patterns.
- **Test pin updated in step:** `tests/test_remediation2_track2_infra.py::test_ci_semgrep_is_blocking` previously pinned "exactly one `continue-on-error`, inside Typecheck". It now pins the strictly stronger invariant — **zero** `continue-on-error` keys in `ci.yml` and Typecheck blocking (same scoped-update pattern the test's docstring records for the previous change).
