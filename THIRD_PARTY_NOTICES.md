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

## Quran printed pages (quran.ws / KFGQPC) — round 6

- **Works:** vectorised Mushaf al-Madinah pages in FIVE riwayas —
  Hafs 'an 'Asim (6236 ayahs), Warsh 'an Nafi' (6214), Qalun 'an Nafi'
  (6214), Duri (6218), Shubah (6236) — each the `kfqc` edition with
  604 pages, a transparent ayah-polygon hit-layer, per-page JSON and
  `surah.json`, from `quran-ws/quran-svg` (fetched live from
  `raw.githubusercontent.com`, inlined as SVG, never bundled); and
  one official KFGQPC font per edition for text (see
  `apps/web/app/[locale]/globals.css`). Each mushaf is parameterised
  by a single key (`hafs/kfqc`, `warsh/kfqc`, `qalon/kfqc`,
  `douri/kfqc`, `shubah/kfqc`; default Hafs) and resolves pages from
  its OWN `surah.json` + per-page JSON — page numbers are
  per-mushaf and are never carried across riwayas (e.g. Warsh p42
  starts at 2:251, Hafs p42 at 2:253). The key travels beside every
  page number in deep links, bookmarks and resume.
- **License status:** the quran.ws contribution (polygon layer, JSON
  metadata) is **CC BY 4.0, attribution waived when used inside a
  product**; `tools/` is MIT. The page artwork belongs to the King
  Fahd Glorious Qur'an Printing Complex (KFGQPC), whose usage-rights
  statement (as reproduced in full in the quran.ws `NOTICE.md`) is:
  > Based on the approval of His Excellency the Minister of Islamic
  > Affairs, Da'wah and Guidance, General Supervisor of the King Fahd
  > Qur'an Printing Complex — the Complex is honored to present to
  > the Muslim public a complete free digital copy of Mushaf
  > al-Madinah. These formats **can be used for free** in all personal
  > and individual businesses, in works of governmental departments &
  > agencies, in the publications of both private and national
  > institutions; it also allows **Qur'an printing\***, **digital
  > publishing**, **media use**, and use in **websites, software, and
  > other similar intermediates**.
  >
  > \* The printing of the Qur'an inside the Kingdom and importing it
  > from abroad **for the purpose of commercial sale** is subject to
  > Royal Decree No. 136/8 (1/2/1406 AH) and Royal Decree No. 9/B/46356
  > (28/9/1424 AH), which prohibit printing the Qur'an inside the
  > Kingdom anywhere other than the King Fahd Glorious Qur'an
  > Printing Complex, and prohibit importing it from abroad for the
  > purpose of commercial sale.
  In practice: free for essentially every personal, commercial,
  governmental, digital, media, web and software use — worldwide. The
  **only** restriction is the physical print-for-commercial-sale trade
  of mushafs, reserved to the Complex. Source: qurancomplex.gov.sa.
  The Quranic text itself is the revealed Word and is not subject to
  copyright; it must never be altered, truncated or misrepresented.
- **How they are used:** single-page views (page view, ayah view's
  page, reading view) render the live SVG page with tappable ayah
  polygons (reference read from `surah`/`ayah` attributes, never the
  global id); the juz view stays text-lines (20 scrolling SVG pages
  is the documented mobile performance trap). If the SVG fetch fails,
  the Hafs exact-line text page renders for the same page number;
  for a non-Hafs mushaf NO text page is shown, because showing Hafs
  text under another key would mix numberings. Tapping a non-Hafs
  polygon shows that ayah's OWN edition text (from quran-text, never
  Hafs words) with an honest label, and no Hafs translation, tafsir
  or audio is attached to it. The ayah view under a non-Hafs key
  shows a note instead of a page: resolving that ayah's page in the
  other mushaf needs the quran.ws Qiraat Ayah Map, which is NOT
  integrated yet (follow-up work, never silently approximated).
  Surah-variant SVGs (118 per mushaf, e.g. `106-surah4.svg`) exist
  in the source; this round uses base pages for the page-scoped
  views, and no separate surah-page variant view is built.
- **Font provenance (verified 2026-11-01):** one font per edition,
  each family + file taken from that edition's OWN quran-text data
  file (`data/mushaf/{edition}.json`, `font` block); TTF hashes
  verified against the data file's `font.sha256`, zip hashes against
  its provenance SHA-256. Hafs: `KFGQPC HAFS Uthmanic Script`,
  `UthmanicHafs-v-3.0.ttf` (301,396 bytes, SHA-256
  `5c47602425fb4190327ab9e1a2e8ed2f53dceaf595d8ccc29ac32b8b209ad398`),
  zip `UthmanicHafs-v-3.0.zip` (SHA-256
  `cdec7341b7c684e7b8dd469c4b68988914d2784e924c7e6cbb9cb4b57c24f013`),
  WOFF2 conversion (no subsetting, 1,572 glyphs; 107,636 bytes,
  SHA-256
  `111b4332b5d54438bb4ea303fec56e254f8c71b5dc338fbf72d9fe6a3ccd2bbd`).
  Warsh: `KFGQPC Warsh Uthmanic Script`,
  `UthmanicWarsh-v-3.0.ttf` (251,428 bytes, SHA-256
  `b644f1c6665baa95c9c0ab40b01a7f3e89edc42a0f50d3b244318a843bec81a9`),
  zip (1,105,919 bytes, SHA-256
  `68e2f1c7a504a8dde797346fd63054c744e073917380f9c56360306b28907e37`),
  WOFF2 (88,688 bytes, SHA-256
  `6d7a702c7d534f885b43b213b5d8d54dd4bf0518832bb9f4cdb3275c8e861343`,
  1,351 glyphs). Qalun: `KFGQPC Qaloun Uthmanic Script`,
  `UthmanicQaloun-v-3.0.ttf` (261,520 bytes, SHA-256
  `3bf3432429f3bbde673982af2aab9b7a1a7329e295dce250bd96842c2a368ba9`),
  zip (1,046,495 bytes, SHA-256
  `d55082f903ec3975469da187c20f21f09bc9921530c17041a2638ab2ee23850a`),
  WOFF2 (91,524 bytes, SHA-256
  `ecd95520df20c7cf804505a6b50f9572448f07c415c6870212a59afc200ace6a`,
  1,351 glyphs). Duri: `KFGQPC Douri Uthmanic Script`,
  `UthmanicDouri-V20.ttf` (262,344 bytes, SHA-256
  `3a862f8e4ba9b7fd024e2b74981026eb5a901cb292e2b43766795112a35a6b45`),
  zip `UthmanicDouri_V20.zip` (850,666 bytes, SHA-256
  `89fe6773ada1a8c153d24005453fa8c183bc33919887664c102e5a9c9c2c5e67`),
  WOFF2 (99,256 bytes, SHA-256
  `460f31db680114ebc614d3e42c9742d0293143ced5db6d724b13d5a1b5e63c89`,
  1,448 glyphs). Shubah: `KFGQPC Shuba Uthmanic Script`,
  `UthmanicShubah-v-3.0.ttf` (247,280 bytes, SHA-256
  `634a7252b619b934f2e507480d517b8f339503bbf08dded35315a9c1f2be495d`),
  zip (826,593 bytes, SHA-256
  `28be7e6ac5b3af9b5064c1cb6fc733e7c0d120d453a8894db0ddb01a7f110396`),
  WOFF2 (94,752 bytes, SHA-256
  `7b907c41d1cd976008826984756ec7a0d13c4575024da436bcd64b39d1eaf13c`,
  1,409 glyphs). Alternate Hafs publisher provenance (not the CSS
  file): official package `kfgqpc_hafs_v30.zip` from
  `download.qurancomplex.gov.sa/resources_dev/kfgqpc_hafs_v30.zip`,
  SHA-256
  `227e6b1564d980f2bd09c2c35ebfb0330ac268c79a7c247cd1ab665bc635f245`
  (10,155,774 bytes); member `kfgqpc_hafs_v30-font/kfgqpc_hafs_v30.ttf`
  (301,204 bytes, SHA-256
  `9ccd82324319bfe9e57efd34c830770ce86655f01661ca06b50e3b0c20073c57`).
  The font binaries reach the repo ONLY via the user's GitHub web-UI
  upload (the app cannot push binaries); until an upload lands, that
  edition's font stack falls back and SVG pages still show the exact
  printed shapes (vector outlines need no font).
- **Correction (verified 2026-11-07, phase 11):** the WOFF2
  SHA-256 hashes and byte sizes recorded here before this date did
  NOT match the files in `apps/web/public/fonts/` (the TTF hashes
  above were all correct). The hashes and sizes now recorded are
  the real ones, recomputed from the files on disk on 2026-11-07
  (glyph counts re-verified with fontTools and unchanged: Hafs
  1,572; Warsh 1,351; Qalun 1,351; Duri 1,448; Shubah 1,409 — the
  files were evidently re-converted with different encoder settings
  after the first record, same glyph sets). Any future WOFF2
  re-conversion must update this record in the same commit.
- **Attribution in product:** a credit line under every rendered SVG
  page ("Printed page: Mushaf al-Madinah — King Fahd Glorious Quran
  Printing Complex; ayah layer: Quran.ws", localized in fa/ar/en).

## Hifz ASR models — Quran-Lab Zipformer (NPL-1.2) + Whisper-quran

- **Works:** the two speech models that power the Hifz module
  (`apps/api/app/modules/quran/hifz_engines.py`):
  - `Quran-Lab/zipformer_p-arabic-v3` (deployed build v3.1,
    `zipformer_p_arabic_v3.1.int8.onnx`), the DEFAULT live + grading
    engine — a streaming CTC phoneme model (65.5M params).
  - `tarteel-ai/whisper-base-ar-quran` (via the third-party
    CTranslate2 conversion
    `hkhan0327/faster-whisper-base-ar-quran`), the CRM-selectable
    second engine for record-then-grade only (never live).
- **License status (reviewed 2026-11-07, full record:
  `docs/quran/hifz-model-license-review.md` — this notice is not
  legal advice):**
  - Zipformer v3 is under the **Quran-Lab No-Profit License v1.2
    (NPL-1.2)**; the LICENSE file's SHA-256 is
    `77526bdbfac94132e5114c3a34492c33f915e4b7f310f00b9995500d3610cab5`
    (7,041 bytes, revision
    `5a115aa91cf7401213a62c22f3458445687d1701`). Its clause 3 binds
    the **Work and any feature it powers**: **the Hifz capability —
    and any other capability this model powers — must never be
    placed behind a payment, a subscription, a paywall, or
    advertising, and must never be charged for.** A hosted service
    may only recover its direct running costs (clause 5, no margin,
    no salaries/support). Derivatives stay under NPL-1.2 or a newer
    Quran-Lab version (clause 7, share-alike); the LICENSE file must
    be kept when distributing (clause 6). **There is no commercial
    licence for this Work and none will be granted (clause 9)** — if
    Hifz is ever to be charged for, this engine must be replaced
    first. This constraint is a product rule, not a setting: no
    paywall/subscription/ads may ever be attached to Hifz while
    this engine ships.
  - Whisper-quran's commercial status is **unconfirmed**: its card
    carries only an auto-generated `apache-2.0` frontmatter tag with
    no LICENSE file and no disclosed training data, so commercial use
    must NOT be assumed. It stays as the record-then-grade second
    engine under the same no-charge rule while Zipformer is the
    default; the conversion's own licence was not separately
    reviewed and must be checked before any commercial decision.
- **How they are used:** model files live outside the repository
  (local directories configured by `HIFZ_ZIPFORMER_MODEL_DIR` /
  `HIFZ_WHISPER_MODEL_DIR`); no model is downloaded at runtime and
  no model file is bundled in the repo. User audio is processed
  in memory (live) or via a transient temp file deleted in a
  `finally` (grading) and is never stored; it is never used to
  train any model.
- **Explicitly NOT in the product:** `Abdou/quran-asr-small` (MIT)
  was evaluated and rejected on benchmark (see
  `docs/quran/hifz-asr-benchmark.md`); **no Abdou artifact — model,
  weights, code, or data — has been introduced into this repository
  or into production** (verified 2026-11-07: no Abdou reference in
  the tracked tree, no `.onnx`/`.pt`/`tokens.txt` model file under
  `apps/`). If it is ever adopted, its MIT attribution (Copyright
  (c) 2026 Abdou) must be recorded here first.

## Quran Arabic text (Tanzil Project) — Phase 2 self-hosted text

- **Work:** Tanzil Quran Text, Uthmani, Version 1.1 (Hafs),
  downloaded from tanzil.net (download options: pause marks on,
  sajdah signs on, rub-el-hizb signs off, tatweel on; plain-text
  `txt-2` format, 6,236 verse records, 1,396,087 bytes).
- **License status:** Creative Commons Attribution 3.0, with the
  project's no-change condition: verbatim copies only, the source
  clearly indicated with a link to tanzil.net, and the copyright
  notice reproduced. The downloaded file's own copyright block
  ("Copyright (C) 2007-2026 Tanzil Project") is kept verbatim at the
  end of the stored file.
- **How it is used:** stored server-side, verbatim, at
  `apps/api/app/modules/quran/data/tanzil_uthmani.txt` and served by
  the academy API through the `self_hosted` provider (default for the
  text type in the Phase 2 provider registry). The stored copy is
  never modified: search normalization and the Fatiha 6/7 display
  split happen at index/display time only, never in the stored text.
  Translations, tafsirs and audio are NOT bundled here; they keep
  coming from the selected provider.
- **Verification (2026-11-04):** SHA-256 of the stored file is
  `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`
  (matches an independent project's recorded hash for the same
  download options). Word-level diff gate against the live AlQuran
  Cloud `quran-uthmani` text: 1,320 verses byte-identical; 4,911
  verses differ in marks only (identical words); 3 verses differ
  only in spacing ("بَعْدَ مَا" vs "بَعْدَمَا"); 2 verses differ in
  one letter form (dagger-alef vs alef-maksura in "صَاحِبَيِ",
  12:39 and 12:41); 0 word-content mismatches. Full catalogue:
  `tanzil-diff-report.json` (worktree report, not shipped).
- **Attribution in product:** a visible line at the bottom of the
  Quran reader ("Arabic text: Tanzil Project (tanzil.net), CC BY
  3.0", localized in fa/ar/en), shown when the self-hosted text
  provider serves the text.
