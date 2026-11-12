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

## 3×3 voice-test reciter audio (test input only, NOT in the product)

- **Works:** 9 recitation MP3 files used only as test input for the
  Hifz 3×3 acceptance matrix (Section 7 of the completion mission):
  Abdul Basit Abdul Samad, Mishary Rashid Alafasy, and Mahmoud
  Khalil Al-Husary — surahs 1, 110, and 112 each
  (`abdul_basit-{1,110,112}.mp3`, `alafasy-{1,110,112}.mp3`,
  `husary-{1,110,112}.mp3`, from QuranicAudio).
- **License status (verified 2026-11-07):** AlQuran Cloud's terms
  (QuranicAudio's host) state the recitations were licensed by the
  reciters or their heirs for free non-commercial re-publication and
  may be streamed, embedded, and downloaded for personal and
  educational use; copyright stays with the reciters, who may ask
  for removal. No free (CC) licence is claimed for these files.
- **How they are used:** test input only, for internal educational
  evaluation. The files live OUTSIDE the repository
  (`~/workspace/hifz-voice-test/completion/wav3x3/`, converted to
  16 kHz mono WAV without content change); they are **never bundled,
  never redistributed, and never shipped in any app**. Full record:
  `~/workspace/hifz-voice-test/completion/SECTION7_REPORT.md` §4.1.

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

## Quran mushaf layout (QPC V2, QUL) + surah header SVGs — Phase 3 hifz redesign

- **Work:** the 15-line Madani mushaf layout of the King Fahd Glorious
  Quran Printing Complex (QPC) 1421H edition (QPC V2), as published in
  the Quranic Universal Library (QUL, TarteelAI/quranic-universal-library):
  604 pages, 15 lines each (pages 1–2 have 8), word order and line/page
  breaks per page, ayah-end markers, rub-el-hizb (۞) and sajda (۩)
  positions. Plus the 113 surah header SVGs (`surah-002.svg` …
  `surah-114.svg`; surah 1 has no header file).
- **License status:** the QUL maintainer states in issue #596 that the
  layout files are free to bundle and transform. The surah header SVGs
  carry a CC BY 4.0 notice inside each file (Naveed Ahmad, Muath Ahmed
  Ibn-Hassan, and the Quranic Universal Library). The QUL *glyph scripts*
  and the QPC V2 *per-page fonts* have an UNKNOWN license and are NOT
  bundled, NOT used, and NOT shipped in any form (see the phase-3 notes
  for the substitution this forces).
- **How it is used:** the layout is stored as derived data (not the QUL
  source files) in `apps/web/public/quran-mushaf-v2.json` (version 1,
  1,127,864 bytes), generated by
  `apps/web/scripts/generate-quran-mushaf-v2.py` from the validated QPC V2
  layout database plus the Tanzil text above. The renderer
  (`apps/web/components/QuranMushafV2Page.tsx`) positions licensed Tanzil
  words in the licensed KFGQPC Uthmanic font word-by-word per the V2
  layout; no QUL glyph code or QPC V2 per-page font is used. The header
  SVGs are served verbatim from `apps/web/public/quran/surah-headers/`.
  The layout data also carries the page→juz/hizb mapping.
- **Verification (2026-11-07):** all 83,668 QUL word ids occur exactly
  once, in order, across the 604 pages; per-ayah word counts match Tanzil
  for 6,234 of 6,236 ayahs one-to-one (see the phase-3 notes for the two
  documented exceptions: the 37:130 two-to-one merge and the 2:72 hamza
  spelling variant); the ayah→page mapping matches the independent V2
  ayah-by-ayah source with 0 mismatches out of 6,236 ayahs. Regression
  tests: `apps/web/lib/__tests__/quran-mushaf-v2.test.ts`.
- **Attribution in product:** the reader's existing Tanzil credit line
  covers the word text; the layout source (QPC V2 / QUL, issue #596) and
  the header SVGs (CC BY 4.0) are recorded here and in
  `apps/web/public/quran-mushaf-v2.json` (`source` field).
- **Update 2026-11-07 (Phase-1 hifz fix):** the per-page QCF V2 fonts
  ARE now wired in (see the "QPC V2 per-page fonts … — Phase-1 hifz
  fix" section below); the glyph script + layout data remain
  licence-unclear, as recorded there.

## Surah header frame (`sura-border.svg`) — hifz redesign (IN USE, 2026-11-08)

- **Work:** the decorative double-ruled surah-header frame (two
  arabesque side panels, two empty circles, ogival cartouche in the
  middle) used as the background of the hifz study page's surah
  header, with the surah-name calligraphy centred in the cartouche.
  File: `apps/web/public/quran/surah-headers/sura-border.svg`
  (17,279 bytes, SHA-256
  `2dc643e21c3e6d949a4b172b9007171a1db1db71cf3a4fb5a288088c27ef2672`).
- **Source:** "Sura border.svg" by Hadysylmy, Wikimedia /
  en.wikipedia.org/wiki/File:Sura_border.svg (own work, 2026-03-03),
  as shipped black-filled by the hadithdb project
  (github.com/iadnanmukhtar/hadithdb,
  `public/static/img/quran/surah-header/border.svg`): byte-for-byte
  identical to the Wikipedia file except the fill colour
  (`#005aff` → `#000000`). The blue original was NOT bundled.
- **License:** CC BY-SA 4.0 (attribution + ShareAlike: any adaptation
  of the frame must stay under the same licence). Attribution:
  "Sura border.svg" by Hadysylmy, CC BY-SA 4.0.
- **Status: PROVISIONALLY ACCEPTED ON THE USER'S EXPLICIT ORDER
  (2026-11-08, option 1) — licence research is DEFERRED, NOT
  finally approved.** The mission's acceptance bar was CC BY 4.0 or
  KFGQPC free digital use; BY-SA (ShareAlike) is outside that bar,
  and the user ordered the bundle anyway ("use this one, don't chase
  the licence much, we will research the licence later"). The
  licence must be researched separately before this is treated as
  finally approved; do not present the frame as licence-cleared.
  A short notice with the same status is kept next to the file
  (`apps/web/public/quran/surah-headers/sura-border-NOTICE.md`).
- **How it is used:** served unmodified as a CSS background
  (`background: url("/quran/surah-headers/sura-border.svg")`) on
  `.hifz-surah-frame` in the hifz study page only
  (`apps/web/components/QuranHifzStudy.tsx`,
  `apps/web/app/[locale]/globals.css`); the reader (umum) header
  (`QuranMushafV2Page.tsx`) is unchanged and still shows the bare
  name calligraphy. The frame is a hand redraw of the printed
  Madani header bar, not the KFGQPC original vector: its ratio is
  8.16:1 (viewBox `0 -500 16320 2000`) against Tarteel's measured
  8.6:1, and its line weights (outer ~3px / inner ~2px at 869px
  wide) and arabesque details differ slightly from the print.

## QPC V2 per-page fonts (QCF2001–QCF2604) + glyph script — Phase-1 hifz fix (IN USE, 2026-11-07)

- **Works:** the real per-page QPC V2 fonts — 604 WOFF2 files
  (`p1.woff2` … `p604.woff2`, 93.2 MB total; family rule verified for
  all 604: page N → `QCF2` + N zero-padded to 3 digits, e.g. p1 =
  QCF2001, p293 = QCF2293, p604 = QCF2604; each file holds ONLY its
  page's glyphs, codes running from U+FC41 in mushaf order) — plus the
  word-level QPC V2 glyph script (83,668 entries keyed
  "surah:ayah:word", 1–3 PUA chars per word) and the ayah-level
  glyph file (6,236 entries with page numbers). The TTF set (604
  files, 198.5 MB) is NOT used on the web.
- **License status / attribution (determination recorded 2026-11-07,
  on the user's explicit direction to use these exact Drive-procured
  resources):**
  > QPC V2 per-page fonts (QCF2001–QCF2604) and the 1421H Madinah Mushaf 15-line layout — Copyright © King Fahd Glorious Quran Printing Complex (KFGQPC), Al-Madinah Al-Munawarrah, Kingdom of Saudi Arabia. All Rights Reserved. Used unmodified under the KFGQPC terms: 'It is available for copying, distribution and usage free of charge in the personal, commercial and all individual fields, as well as, government bodies, entities and civil organizations works.' (KFGQPC, 'Usage Rights' clause, official font page, as quoted in Wikimedia Phabricator T301871.) Font EULA (as embedded in KFGQPC Unicode fonts): 'Permission is hereby granted, Free of Cost, to any person obtaining a copy of this Font accompanying this license, the rights to Use, Copy, Distribute, subject to the following conditions: 1. The Font Software cannot be Sold, Modified, Altered, Translated, Reverse Engineered, Decompiled, Disassembled, Reproduced or Attempted to discover the Source Code of this Font in no means.' / 'This Font is the property of King Fahd Glorious Quran Printing Complex, and may not be reproduced, modified without the express written approval of King Fahd Glorious Quran Printing Complex.' Sources: qurancomplex.gov.sa/quran-dev/ ; qul.tarteel.ai/resources/font/249 ; qul.tarteel.ai/resources/mushaf-layout/10 ; qul.tarteel.ai/resources/quran-script/61. Note: the per-page QCF files as procured carry no embedded licence string (name table: 'Test Font, KFGQPC' / 'QCF2001' only). The live KFGQPC copyright page (dm.qurancomplex.gov.sa/copyright-2/) could not be fetched on 2026-11-07; the Usage Rights wording above is verified only via the Phabricator quotation of the official page. The QPC V2 glyph script and 15-line layout data carry no stated licence on QUL or in the files; their use is recorded here as licence-unclear, not as licensed.
  >
  > فونت‌های صفحه‌ای QPC V2 (QCF2001 تا QCF2604) و چیدمان ۱۵خطهٔ مصحف مدینه چاپ ۱۴۲۱هـ متعلق به مجمع الملك فهد لطباعة المصحف الشريف است؛ بدون هیچ تغییری استفاده می‌شوند. فروش، تغییر، تبدیل فرمت، زیرمجموعه‌گیری و مهندسی معکوس فونت ممنوع است. انتساب در متن مجوز الزام نشده، ولی به‌عنوان اعتباردهی ثبت شده است. مجوز اسکریپت گلیف و دادهٔ چیدمان در هیچ منبعی بیان نشده و وضعیت آن‌ها «نامشخص» ثبت می‌شود، نه «مجاز».
- **How they are used:** the WOFF2 files are served unmodified from
  `apps/web/public/fonts/qcf-v2/p{NNN}.woff2` and loaded lazily
  per page through the `qcf-v2` provider in
  `apps/web/lib/quran-mushaf-font.ts` (FontFace API, 8-family cache,
  oldest-first eviction; no family is pinned). The glyph script is
  split per page by `apps/web/scripts/split-quran-mushaf-v2-glyphs.py`
  into `apps/web/public/quran-mushaf-v2-glyphs/p{NNN}.json` (QUL id →
  glyph string, only that page's ids) and rendered word-by-word by
  the V2 engine (`apps/web/lib/quran-mushaf-v2.ts`, glyph mode) in the
  page's own QCF2NNN family, solid black, with no tajweed colours on
  PUA text. When a page's glyph file is missing or incomplete, the
  page falls back to Tanzil text in the KFGQPC Uthmanic font for the
  whole page — never a per-word mix. The Basmalah line (the layout
  gives it no glyph ids) renders in the dedicated QCF_BSML font
  since the Tarteel-parity step 1a (2026-11-12 — see the QCF_BSML
  section below), and the ayah-end marker stays the painted rosette.
- **EULA placement (PLACED — verified 2026-11-08, round 2 §2):** the full
  EULA text is in the repo at `apps/web/public/fonts/qcf-v2/EULA.txt`
  (committed in `531e197`; 1,267 bytes, KFGQPC 2010 EULA).
- **Round-2 re-verification (2026-11-08, §2):** QUL issue #596 was
  re-read from GitHub in this mission and still states the layout is
  free for personal + commercial use, bundling and modification, with
  attribution optional — that covers the 15-line layout ONLY, not the
  glyph script and not the fonts. Tarteel's Terms of Service were read
  directly (`tarteel.ai/terms`, updated 2026-11-03): they prohibit
  copying parts of the service, bulk collection, and copying /
  republishing the service's output — the provenance conflict above
  therefore stays UNRESOLVED (the Drive files' origin — QUL download
  vs qurancomplex — is still unknown). Surah header SVGs are CC BY 4.0
  (notice inside each of the 113 files). Still SILENT (not expressly
  confirmed): web serving of the WOFF2 files and a mobile TTF bundle
  under the KFGQPC terms; the mobile app currently ships no QCF files.
- **Provenance conflict (surfaced, NOT resolved here):** if the Drive
  files came from QUL downloads, Tarteel's Terms of Service on paper
  prohibit copying/redistribution of QUL content. That conflict is
  recorded here as-is; the user's explicit direction to use these
  files governs the wiring, and no attempt was made to resolve the
  ToS question in this mission.

## QCF_BSML Basmala font — Tarteel-parity step 1a (IN USE, 2026-11-12)

- **Work:** `QCF_BSML.ttf` (internal font name `QCF_BSML`, version
  5.10, © King Fahad Complex — 574 glyphs, full Unicode cmap) —
  KFGQPC's dedicated Basmala calligraphy font, bundled at
  `apps/web/public/fonts/qcf-bsml/QCF_BSML.ttf` (303,644 bytes,
  SHA-256 `6a6f234ee351be146e46e897f4cd47610df0b078a82888e5ca15f313f813698c`).
- **Provenance:** downloaded 2026-11-12 from the Quran Foundation's
  official GitHub repository `quran/quran.com-images`
  (`res/fonts/QCF_BSML.TTF` — the file that project's image
  generator uses as its default Basmala font). A second independent
  copy (`0xzer0x/quran-companion`, `assets/fonts/QCFV1/QCF_BSML.ttf`)
  was byte-identical (same SHA-256) and served as a cross-check.
- **License status:** the KFGQPC font terms (see the QPC V2 entry
  above): copying, distribution and usage free of charge, provided
  the font is **not sold, modified, altered, translated, reverse
  engineered, decompiled or disassembled**. Accordingly the file is
  served **byte-identical in its original TTF format** — no WOFF2
  conversion, no subsetting, no modification of any kind.
- **How it is used:** the mushaf reader's Basmala line
  (`.mushaf-bismillah` in `apps/web/app/[locale]/globals.css`,
  `@font-face` family `QCF BSML`) renders in this font instead of
  plain text in a text font — the fix for parity defect 1 (the QPC
  V2 layout gives the Basmala line no glyph segments). The rendered
  string is the Tanzil-derived constant in
  `apps/web/lib/quran-basmala.ts`; its spelling omits exactly one
  mark (dagger alef, U+0670) that has no glyph in this font's cmap
  (HarfBuzz-verified: the full Tanzil string yields one missing
  glyph in this font; the shipped spelling yields none). In-folder
  record: `apps/web/public/fonts/qcf-bsml/README.md`.

## Digital Khatt fonts + QUL Digital Khatt data — Tarteel-parity step 1b (IN USE, 2026-11-12)

- **Fonts:** `DigitalKhattV2.otf` ("DigitalKhatt New Madina", © Amine
  Anane / Tarteel Inc. — variable font, parametric `SCLX` width axis)
  and its WOFF2 derivation, bundled at
  `apps/web/public/fonts/digital-khatt/` (OTF 5,747,480 bytes,
  SHA-256 `0a70b87756eb1a96f91858ab8041521291db94deaa1f97f021bbb4393ba0aa8d`;
  WOFF2 457,252 bytes — a lossless container conversion verified to
  preserve all glyphs, tables and the `SCLX` axis).
- **Font license:** SIL Open Font License 1.1 — stated in the font
  file itself (nameID 13) and shipped beside the font as
  `apps/web/public/fonts/digital-khatt/OFL.txt`. The OFL permits the
  WOFF2 conversion and this redistribution.
- **Data:** the Digital Khatt word script + the KFGQPC V2 1421H and
  IndoPak 15-line page layouts (Quranic Universal Library — QUL
  resources: "Digital Khatt Quran script", "Digital Khatt (KFGQPC
  V2 1421H print) layout", "Digital Khatt IndoPak layout"),
  converted by `apps/web/scripts/generate-quran-mushaf-dk.py` into
  `apps/web/public/quran-mushaf-dk*.json` (+ 604 and 610 per-page
  chunks). The generator cross-checks every page against this
  repo's independent QPC V2 pipeline (all line-kind and ayah-end
  sequences identical; 83,668 words placed per dataset).
- **Provenance — stated honestly:** QUL's own download endpoints
  require a logged-in account (HTTP 401 verified 2026-11-12), so
  the datasets and the fonts were taken from the copies distributed
  inside the Tarteel app (the QUL datasets' reference consumer),
  provided by the repository owner. Checksums of the font match
  QUL's published file size exactly; the font's embedded licence
  text is the authoritative licence copy shipped.
- **How it is used:** the mushaf reader's "Madina (1421) — Digital
  Khatt" option (`apps/web/components/QuranMushafDKPage.tsx`)
  renders real Unicode text justified per line through the font's
  `SCLX` axis. In-folder record:
  `apps/web/public/fonts/digital-khatt/README.md`.
- **Step 2 addition — QPC V4 (1441) layout data:** the reader's
  "Madina 1441 (QPC V4)" option renders the print's own layout,
  generated by `apps/web/scripts/generate-quran-mushaf-v4.py` from
  the QUL `qpc_v4_layout` dataset (same distributed-copy
  provenance as the Digital Khatt data above) into
  `apps/web/public/quran-mushaf-v4*.json`, with the study module's
  V4 glyph maps re-keyed by QUL id into
  `apps/web/public/quran-mushaf-v4qpc-glyphs/`. The layout/glyph
  data carries the same licence status as the QPC V2 layout entry
  below (QUL open-data distribution; no separate licence file) —
  defect 13 of the parity scope tracks clarifying it for public
  release. The QCF V4 per-page fonts themselves were already in
  the repo (see the V4 entries from the hifz redesign).
- **Step 2 addition — DigitalKhattIndoPak:** the IndoPak sibling
  font (same designer/project, QUL font resource 568), bundled in
  the same folder: OTF 4,833,016 bytes, SHA-256
  `6a048ce983ad95b5291a233873236b14d14cc51f490a859dade067e2a016a0b5`,
  WOFF2 449,216 bytes (same lossless conversion). Its licence is
  likewise SIL OFL 1.1 embedded in the file itself (nameID 13,
  verified 2026-11-12). Sourced from the same Tarteel-app
  distribution copy. It renders the reader's "IndoPak (610 pages)
  — Digital Khatt" option on the QUL IndoPak 15-line layout data
  generated alongside it (see the data bullet above).

## Quran Foundation QCF V2 fonts — Path A (NOT IN USE, verified 2026-11-07)

- **Work:** the real per-page QPC V2 fonts (QCF2001…QCF2604, 604 files)
  from the official Quran Foundation CDN
  (`verses.quran.foundation/fonts/quran/hafs/v2/{woff2,woff,ttf}/p{PAGE}.*`)
  plus the glyph codes (`code_v2`) for the V2 mushaf (mushaf 1).
- **License status:** usable ONLY under the Quran Foundation Developer
  Terms (last updated 2026-10-11): font files obtained through QF APIs
  or documented CDN URLs may be cached/bundled **if the Developer
  maintains an active account in the Developer Console and credits
  Quran Foundation in a reasonably accessible place**, distributed only
  as an integrated part of the Application. A prepackaged database or
  build-time bundle of QF Content is NOT authorized; offline QF content
  must come through Content Sync with a next sync at least every 7 days
  (Terms §3.1). **No Developer Console account exists for this project**
  (the `quran.qf_client_id` / `quran.qf_client_secret` settings are
  empty config slots; the provider registry marks QF `implemented:
  false, config_only: true`), so **no QCF font has been downloaded,
  bundled, cached, or wired in, and no account was created.**
- **Update 2026-11-07 (Phase-1 hifz fix):** the Drive-procured QCF V2
  fonts ARE now wired in (see the "QPC V2 per-page fonts … — Phase-1
  hifz fix" section above). The QF-CDN path in this section remains
  unused — no QF account was created and no font was obtained through
  QF APIs or the QF CDN.
- **Snapshot finding (2026-11-07):** the `mushafs:1` Content Sync
  snapshot has NO `code_v2` field in the official JS SDK's typed
  contract (`MushafWordSnapshotRecord`: `text`/page/line/position
  only). Whether its `text` field carries the glyph code is
  undocumented and can only be checked with an authenticated fetch
  once an account exists. Glyph codes are otherwise available only
  from the live Content API (`/verses/by_page/{n}?mushaf=1&words=true&
  word_fields=code_v2,...`), subject to the 1-week storage rule.
- **What is needed to open this path:** the user creates the Developer
  Console account, creates Content API credentials, fills them in the
  CRM Quran settings, and the app carries QF attribution; then a
  server-side Content Sync job (≤ 7 days) + per-page lazy font loading
  through the existing provider registry in
  `apps/web/lib/quran-mushaf-font.ts`. Full record:
  `docs/quran/hifz-completion-qpc-v2-font-path-a.md`.
- **Current state:** the mushaf engine stays on Path B — V2 layout +
  Tanzil words + the licensed KFGQPC Uthmanic font above. **No QPC V2
  font use is claimed anywhere.** Render evidence for the approved
  font (2026-11-07, 5/5 pages green): `~/workspace/
  quran-hifz-shots-completion/font/report.json`.

## Tarteel video reference frames — Phase 2 hifz redesign (reference only)

- **Works:** still frames extracted from the user's own screen recordings
  of the Tarteel app (`docs/quran/phase2-frames/`, 47 JPGs: 41 full
  frames + 6 enlarged pill crops), used only as a visual reference for
  the UI-matching work of phases 2 and 6
  (`docs/quran/hifz-tarteel-video-spec-fa.md`).
- **License status:** the recordings are the user's own; the frames show
  Tarteel's app UI. They are **reference material only — no frame, pixel,
  text, code, or data from them is shipped in the product** (the UI was
  re-implemented from scratch in original code from the observed
  behaviour, per the mission's clean-room rule).
- **How they are used:** kept in the repository under `docs/quran/` as
  evidence for the matching table; never bundled into any app, never
  served to users.
