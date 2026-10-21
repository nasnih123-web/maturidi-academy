# Calculators Integration — Phase 4 (Source Calculators)

- **Date:** 2026-10-21 · **Branch:** `release/v1.1.0-remediation` (worktree
  `~/workspace/maturidi-v110`) · **Module:** `apps/api/app/modules/calculators/`
- **Decision record:** ADR-0022 · **Notices:** `THIRD_PARTY_NOTICES.md`
- Integrates three standalone calculator pages into the existing Phase-7
  calculators system (versioned rule configs + scholar-review gate). Nothing
  was built in parallel: the new engines plug into the same rule-config
  tables, the same approval workflow and the same gate.

## 1. Provenance (all three sources)

| # | Page | Source URL (as provided) | Fetch record | SHA-256 of fetched HTML |
|---|------|--------------------------|--------------|-------------------------|
| 1 | «محاسبه‌گر شرعی (حنفی)» — zakat | dl.ghadimyol.ir zakat page | HTTPS failed on `dl.ghadimyol.ir`; fetched over **HTTP 200** on 2026-10-21 | `2a8e68cd4f3c3bada08511c8b93395e1b1ba01e87ececafe22e356d62addd4f8` |
| 2 | Hanafi fara'id "بر مبنای سراجیه" — miras | dl.ghadimyol.ir miras page | HTTPS failed; **HTTP 200**, 2026-10-21 | `8cb9d11c5eb41f73612dd6abc43957e324a1ce5460304296d6281ae24c3dc8e6` |
| 3 | «مُصَرِّفُ الأفعال العربية» — mosaref | dl.ghadimyol.ir mosaref page | HTTPS failed; **HTTP 200**, 2026-10-21 | `b9966089015b3df6f1ca17f80c01fb411fb2a94298790f790f7df70c3e721c91` |

- **Attribution:** the pages are attributed to **مهران ساعدی** (user
  attribution; the name also appears inside `zakat.html`). The attribution is
  recorded in the seeded rule configs (`provenance` block) and in
  `THIRD_PARTY_NOTICES.md`.
- **License status:** **no license text exists in any of the three sources.**
  License is therefore treated as *unclear / all rights reserved*.
- **Reimplementation decision (binding):** because the license is unclear, no
  source code and no source prose was copied into this repository — not the
  JavaScript, not the Persian explanatory texts. The *rules and algorithms*
  were extracted, understood, and re-implemented from scratch in original
  Python code and structure (`zakat_engine.py`, `miras_engine.py`,
  `mosaref_engine.py`). The fetched HTML files are kept **outside** the repo
  (`~/workspace/.calc-sources/`) and are never committed. Golden fixtures
  contain only *input/output data* produced by running the original pages
  (facts/results, not code), each labeled with its provenance header.
- **Fiqh-review status:** zakat and miras are fiqh. Their extracted rules are
  seeded as **version 2 DRAFT** rule configs (source:
  مهران ساعدی — source calculators (dl.ghadimyol.ir)), pending scholar
  review. The Phase-7 public gate **stays closed**: with only drafts seeded,
  both new endpoints answer `422 rules_not_approved` and the web UIs render
  the same honest pending state as Phase 7. No output is presented anywhere
  as an approved fatwa; the UIs carry an explicit educational/draft note.
  Mosaref is Arabic linguistics, not fiqh — it is fully public.

## 2. Method — golden tests from the original pages

The original inline scripts were executed in Node (`tools/golden/harness.js`:
`vm` + minimal DOM stubs) over a battery of representative inputs; the
captured outputs were normalized into JSON fixtures
(`apps/api/tests/fixtures/{zakat,miras,mosaref}_golden.json`, regenerable with
`tools/golden/generate_fixtures.py`). The Python engines must match the
fixtures **exactly** (Decimal/Fraction/string equality — no tolerances).
Mosaref fixtures capture the *final rendered page HTML*, i.e. exactly what a
user of the source page sees, including its post-render hamza-seat pass.

| Calculator | Battery | Match |
|---|---|---|
| Zakat | 131 cases | 131/131 (1 documented deviation, §3.4) |
| Miras | 53 cases | 53/53 |
| Mosaref | 41 cases | 41/41 (1 documented deviation, §5.3) |

Test file: `apps/api/tests/test_calculators_source_golden.py` (12 tests:
3 golden batteries + exactness, boundary, gate and statelessness tests).

## 3. Zakat — «محاسبه‌گر شرعی (حنفی)»

**Endpoint:** `POST /api/v1/calculators/zakat/extended` (stateless, gated).
**Engine:** `compute_zakat_extended(sections, rule_data)` — Decimal only.
**Rule data:** `rule_data.extended`, format marker `source_extended_v1`.

### 3.1 Coverage
- **Money / trade goods:** converted to full coins via a caller-supplied coin
  price. Nisab 10.454545… coins (≈ 115 g gold equivalent in the source model).
- **Gold:** nisab 92 g. **Silver:** nisab 644 g (as the source states).
- **Sheep/goats:** <40 none; 40–120 → 1; 121–200 → 2; 201–399 → 3;
  ≥400 → ⌊n/100⌋.
- **Cows/buffalo:** <30 none; 30–39 → 1 tabiʿ (yearling); 40–59 → 1 musinna
  plus (n−40) fortieths of a musinna's value as money; 60–69 → 2 tabiʿ;
  ≥70 → round down to a multiple of 10 and split into 30-blocks (tabiʿ) and
  40-blocks (musinna) minimizing |a−b|.
- **Camels:** classic bent-labbun/hiqqa/jadhaʿa ladder 5–150; above 150 →
  ⌊n/50⌋ hiqqa plus the sub-50 remainder re-enters the small table.
- **Horses:** rule only (no table in the source): 1 dinar per head *or*
  1/40 of total value — both figures returned, the choice is the payer's.
- **Oshr:** rain-fed 1/10, irrigated 1/20 of the crop. **Khoms:** flat 1/5.

### 3.2 The staircase model (source behavior, reproduced deliberately)
All of money/gold/silver use a **staircase**, not a flat 1/40: full zakat at
nisab, then a fixed increment for each *complete* fifth-of-nisab step above
nisab; the remainder is ignored. This is the Hanafi *waqṣ* treatment the
source implements, so it is reproduced exactly rather than "simplified" to
2.5 %.

### 3.3 Source deviations / gaps identified (documented, mostly reproduced)
1. **Coin-step inconsistency (reproduced + flagged):** the money staircase
   step is 2.090909… coins but the step zakat is 0.07272727… coins — which is
   **not** 1/40 of the step (that would be 0.052272…). The gold/silver steps
   *are* exactly 1/40 of their steps, and the money *base* zakat is exactly
   nisab/40. The money step figure therefore looks like a source arithmetic
   slip; it is reproduced faithfully (golden-locked) and flagged here for the
   scholar reviewer, not silently corrected.
2. **Silver pre-rounding (reproduced):** the source rounds silver weight to
   0.1 g (ROUND_HALF_UP) before the nisab check, so 643.95 g counts as nisab
   met. Reproduced.
3. **Cow price is an input, not a rule:** the source hard-codes an example
   musinna price of 40,000,000 Toman inside its fortieths computation. A
   market price is not a fiqh rule; the reimplementation takes
   `musinna_price` as a caller input and never bakes the example price into
   the rule config.
4. **Oshr has no nisab check in the source** (no 5-wasq minimum): any amount
   entered is charged at 1/10 or 1/20. Reproduced as-is; flagged for review.
5. **Khoms output** in the source is an unrounded plain decimal; ours returns
   the exact Decimal (× 0.2).

### 3.4 Deliberately NOT reproduced — gold float artifact
Source case `gold = 147.2 g`: the source's float arithmetic computes
(147.2 − 92) / 18.4 = 2.999… and floors to 2 steps → 3.22 g. The exact value
is 3 steps → **3.68 g** (= 147.2/40 exactly). Float error is a bug, not a
rule; the engine uses exact Decimal division and the fixture records the
deviation (`deviation.correct_zakat_grams = "3.68"`), asserted by the test.

## 4. Miras — Hanafi fara'id "بر مبنای سراجیه"

**Endpoint:** `POST /api/v1/calculators/inheritance/miras` (stateless,
gated; Hanafi only). **Engine:** `compute_miras(family, estate, rule_data)` —
all shares are exact `fractions.Fraction`; amounts are `_money(net × share)`.
**Rule data:** `rule_data.miras`, format marker `miras_v1`.

### 4.1 Coverage
Full source pipeline: estate → funeral costs → debts → **impediments**
(difference of religion, killer, simultaneous death with unknown precedence,
slavery — any one stops the division) → **will** (for an heir: void unless
the heirs approve, then capped at the post-debt remainder; for a non-heir:
capped at ⅓, or the full remainder if the excess is approved) → net ≤ 0 stops.
Distribution, in the source's own order: spouse → mother (deferred in the
ʿUmariyya) → grandmothers (blocked by the mother; paternal grandmother also
by the father) → father/true grandfather fixed ⅙ → **Hanafi grandfather
blocks *all* siblings, uterine siblings, nephews, uncles and cousins** →
uterine siblings (⅙ or ⅓ shared equally) → daughters → son's daughters
(completion ⅙ with one daughter) → full sisters fixed → paternal sisters
(completion ⅙ with one full sister) → ʿUmariyya mother top-up (⅓ of the
post-spouse remainder) → **ʿawl** (proportional scaling) → **ʿaṣaba chain**
(sons → son's sons → father → grandfather → full brothers → sisters with male
descendants → paternal brothers → paternal sisters with female descendants →
sisters with female descendants → brothers' sons → uncles → uncles' sons),
male:female = 2:1 inside mixed groups → **radd** (spouses excluded) /
**dhawu al-arḥām** → **Akdariyya** special case → final checks.

Heir set: spouse(s), father, mother, true grandfather, both grandmothers,
sons, daughters, son's sons, son's daughters, full/paternal/uterine brothers
and sisters, brothers' sons, paternal uncles, uncles' sons, and the full
dhawu al-arḥām input set (daughter's children, son's daughter's children,
sister's children, siblings' daughters, uterine siblings' children, maternal
grandfather, remoter grandmothers, maternal uncles/aunts, paternal aunts,
maternal-side paternal uncles, paternal uncle's daughters).

### 4.2 Source quirks reproduced (golden-locked, flagged for the reviewer)
1. **Paternal-sister ⅔ quirk:** a paternal-sister group *alone* (no full
   sister) receives ⅔ even when it is a single sister (classically a lone
   paternal sister takes ½; ⅔ is the share of two or more). Reproduced
   (golden case `paternal_sister_awl_quirk`: husband 3/7 + sister 4/7 after
   ʿawl) and flagged.
2. **Dhawu al-arḥām per-person shares:** in most dhawu branches the source
   records each distant heir's share as *per-person* (group share ÷ count)
   rather than the group total, so those branches only complete
   (Σ shares = 1) for single-heir or coincidentally-exact compositions;
   otherwise the engine stops with `incomplete_total`. Only the class-3
   single-type branch records a true group share. Reproduced faithfully
   rather than "fixed" into a different madhhab position.
3. **Dhawu multi-branch safety lock:** whenever two or more distinct dhawu
   categories are present after a dhawu distribution, the source stops with
   what we expose as `dhawu_multibranch`. This makes *all* mixed dhawu
   estates stop — reproduced; the UI explains the stop honestly.
4. **Dead weighting branch:** the source contains an Imam-Muḥammad weighting
   branch for mixed dhawu that its own control flow never reaches. Not
   ported (dead code), noted here.
5. **Akdariyya condition:** the source's trigger omits a `!father` condition
   (father + grandfather cannot coexist as takers anyway); reproduced as
   written.
6. **Blocked-list semantics:** the source registers distant heirs as
   "blocked" whenever dhawu was not used — even when an ʿaṣaba took the
   residue. Reproduced.

### 4.3 Stop codes (honest states, HTTP 200 with `status: "stopped"`)
`impediment_religion`, `impediment_killer`, `impediment_simultaneous_death`,
`impediment_slavery`, `dhawu_multibranch`, `nothing_to_distribute`,
`no_distributable_heir`, `incomplete_total`. A stopped division is a fiqh
outcome, not a server error; the UI renders it as an explanatory state,
never as shares.

### 4.4 Where the source is silent
Anything the source does not implement was **not invented**: no rules were
added beyond the extracted pipeline. Cases the pipeline cannot complete end
in the stop states above instead of fabricated shares.

## 5. Mosaref — «مُصَرِّفُ الأفعال العربية»

**Endpoint:** `POST /api/v1/calculators/mosaref` (stateless, **public** — not
fiqh). **Engine:** `conjugate_verb(root, bab, transitivity, harf_jar)` — a
pure module producing fully-vocalized Arabic forms.

### 5.1 Coverage
- **Measures:** triliteral mujarrad I (all six ʿayn-vowel classes), II, III,
  IV, V, VI, VII, VIII, X, quadriliteral mujarrad and quadriliteral
  tafaʿlala. (Source-supported set; other measures are not offered.)
- **Verb classes:** sound (ṣaḥīḥ), mithāl, hamzated (mahmūz), geminate
  (muḍgham — mujarrad only), hollow (ajwaf), defective (nāqiṣ), lafīf-mafrūq,
  lafīf-maqrūn — with the source's exact detection/normalization rules
  (hamza seats normalized to ء; Form-VIII wāw assimilation; mithāl wāw
  dropping in the present for classes I-1/2/3; the mahmūz-fā imperative
  hamza drop, e.g. خُذْ).
- **Tables per verb (14 pronoun forms):** past, present, negation (mā/lā),
  jussive negation (lam), imperative-lām, imperative & prohibition
  (addressee-first order), active/passive participles, and derived nouns
  (time/place, instrument where the measure supports it, elative). For
  intransitive (lāzim) verbs the passive columns carry the source's
  prepositional (ḥarf-jarr) forms for bi/li/ʿan/min/ilā/ʿalā/fī.
- **Errors (stable codes):** `root_too_short`, `alif_in_root`,
  `mahmuz_weak_mix`, `mahmuz_mudgham_mix`, `rubaai_weak_unsupported`,
  `weak_combo_unsupported`, `bab_unsupported`,
  `mudgham_augmented_unsupported`.

### 5.2 Source gaps (documented, not invented)
- **No maṣdar** exists anywhere in the source — none is generated.
- **`buildMudgham` is dead code** in the source (defined, never called;
  geminate conjugation flows through the generic builders). Deliberately
  not ported.
- Roots longer than the measure's radical count: the source silently
  ignores extra letters; mirrored (presentation-level leniency).
- Hollow Form-I past is flagged approximate in the source itself for
  ʿayn = wāw with a ḍamma present stem; the flag is surfaced in the API
  (`flags.approximate_past`) and shown in the UI.

### 5.3 Deliberately NOT reproduced — HTML-context hamza seat
The source applies its hamza-seat correction pass to the *whole rendered
HTML string*, so a word-initial hamza at the start of a table cell inherits
the preceding `<td>` markup as "context" and is seated as if mid-word
(e.g. ؤُخِذَ in the past-passive of أخذ). The engine seats word-initial
hamza correctly (أ/إ) — which is what the source's own string-initial
branch intends. Fixtures record the affected cells; the golden test locks
the mechanical relation (initial ؤ→أ, ئ→إ) for exactly those cells.

## 6. API & web summary

| Endpoint | Gate | Persists input? |
|---|---|---|
| `POST /api/v1/calculators/zakat/extended` | Approved zakat config with `extended` data required, else 422 `rules_not_approved` | No — stateless |
| `POST /api/v1/calculators/inheritance/miras` | Approved inheritance config with `miras` data (Hanafi), else 422 | No — stateless |
| `POST /api/v1/calculators/mosaref` | Public | No — stateless |

Legacy Phase-7 endpoints keep their behavior; rule selection is now
payload-key based (`get_active_rule(..., require_key=…)`): each endpoint
takes the newest approved config that carries *its* key (`shares` /
`asset_categories` for Phase 7, `miras` / `extended` for Phase 4), so the
coexisting formats inside `rule_data` never shadow each other and each
format's gate stays independent (ADR-0022).

Web (fa/ar/en, RTL, localized digits): `/[locale]/mosaref` (fully usable),
`/[locale]/miras` (family + estate form; pending state while gated; stopped
states rendered honestly), and an extended-zakat section on
`/[locale]/zakat`. All fetch logic lives in `apps/web/lib/calculators.ts`
(ADR-0002); components hold presentation + form state only (ADR-001).

## 7. Test evidence

- Golden batteries: zakat **131/131**, miras **53/53**, mosaref **41/41**
  (two documented deviations above, both source bugs/artifacts, locked by
  explicit assertions — never by weakening the fixtures).
- `tests/test_calculators_source_golden.py`: **12 tests** — batteries,
  Fraction/Decimal exactness (Σ shares = 1 exactly; amounts =
  `_money(net × share)`; `"0.5522727272"`/`"5522727"` coin cases), silver
  0.1 g boundary, invalid-input codes, mosaref error codes, gate tests
  (drafts seeded → still 422; approved v90 source config opens the new
  endpoints only, legacy endpoints stay gated; calculation writes **zero**
  case rows), miras stopped-as-200.
- Phase-7 calculator tests still pass unchanged (28/28 at integration time);
  full suite total is reported in the Phase-4 completion report.
