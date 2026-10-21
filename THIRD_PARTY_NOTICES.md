# Third-Party Notices

This file records third-party works whose *content or rules* informed parts
of Maturidi Academy, and how each was used. Code dependencies are covered by
their own package licenses (see each package); this file covers non-package
sources.

## Source calculators by مهران ساعدی (dl.ghadimyol.ir)

- **Works:** «محاسبه‌گر شرعی (حنفی)» (zakat calculator), the Hanafi fara'id
  calculator "بر مبنای سراجیه" (inheritance), and «مُصَرِّفُ الأفعال العربية»
  (Arabic verb conjugator), published at dl.ghadimyol.ir and attributed to
  **مهران ساعدی**.
- **License status:** no license text was present in the fetched pages
  (fetched 2026-10-21; HTTPS unavailable on the host, fetched over HTTP).
  The works are treated as **all rights reserved**.
- **How they were used:** the *rules and algorithms* (nisab tables, staircase
  zakat model, Sirajiyyah inheritance pipeline, Arabic conjugation patterns)
  were studied and **re-implemented from scratch in original code** inside
  `apps/api/app/modules/calculators/` (`zakat_engine.py`, `miras_engine.py`,
  `mosaref_engine.py`, `source_rules.py`). **No source code and no prose text
  was copied** into this repository. Test fixtures under
  `apps/api/tests/fixtures/` contain only input/output data captured by
  running the original pages, labeled with their provenance.
- **Attribution in product:** the seeded rule configurations carry the
  provenance string "مهران ساعدی — source calculators (dl.ghadimyol.ir)"
  in their `source`/provenance fields.
- **Full record:** `docs/calculators/CALCULATORS_INTEGRATION.md`
  (fetch record, SHA-256 hashes, deviations, fiqh-review status).
