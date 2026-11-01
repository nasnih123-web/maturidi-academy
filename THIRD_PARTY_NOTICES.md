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
  `5c47602425fb4190327ae1a2e8ed2f53dceaf595d8ccc29ac32b8b209ad398`),
  zip `UthmanicHafs-v-3.0.zip` (SHA-256
  `cdec7341b7c684e7b8dd469c4b68988914d2784e924c7e6cbb9cb4b57c24f013`),
  WOFF2 conversion (no subsetting, 1,572 glyphs; 107,772 bytes,
  SHA-256
  `eb3e02e66a7f9a0fe561d9a341c1317a7fe564f8fe6deb59710f7fe3c5523846`).
  Warsh: `KFGQPC Warsh Uthmanic Script`,
  `UthmanicWarsh-v-3.0.ttf` (251,428 bytes, SHA-256
  `b644f1c6665baa95c9c0ab40b01a7f3e89edc42a0f50d3b244318a843bec81a9`),
  zip (1,105,919 bytes, SHA-256
  `68e2f1c7a504a8dde797346fd63054c744e073917380f9c56360306b28907e37`),
  WOFF2 (88,880 bytes, SHA-256
  `6c4f517fd4986329256bc95ef65aa8baf247eb06e4d12eed8188c01b71bccb7a`,
  1,351 glyphs). Qalun: `KFGQPC Qaloun Uthmanic Script`,
  `UthmanicQaloun-v-3.0.ttf` (261,520 bytes, SHA-256
  `3bf3432429f3bbde673982af2aab9b7a1a7329e295dce250bd96842c2a368ba9`),
  zip (1,046,495 bytes, SHA-256
  `d55082f903ec3975469da187c20f21f09bc9921530c17041a2638ab2ee23850a`),
  WOFF2 (91,684 bytes, SHA-256
  `687c252bed54e6b63a92e29177a2287fb729624f588871ea068602c746f5ce7a`,
  1,351 glyphs). Duri: `KFGQPC Douri Uthmanic Script`,
  `UthmanicDouri-V20.ttf` (262,344 bytes, SHA-256
  `3a862f8e4ba9b7fd024e2b74981026eb5a901cb292e2b43766795112a35a6b45`),
  zip `UthmanicDouri_V20.zip` (850,666 bytes, SHA-256
  `89fe6773ada1a8c153d24005453fa8c183bc33919887664c102e5a9c9c2c5e67`),
  WOFF2 (99,564 bytes, SHA-256
  `2d3c309dba040850b93b1ff172b9138e828b6d4b4affce210a515fa14c2ef900`,
  1,448 glyphs). Shubah: `KFGQPC Shuba Uthmanic Script`,
  `UthmanicShubah-v-3.0.ttf` (247,280 bytes, SHA-256
  `634a7252b619b934f2e507480d517b8f339503bbf08dded35315a9c1f2be495d`),
  zip (826,593 bytes, SHA-256
  `28be7e6ac5b3af9b5064c1cb6fc733e7c0d120d453a8894db0ddb01a7f110396`),
  WOFF2 (94,552 bytes, SHA-256
  `3c051ed2a2b79dd5ba48e3075d54290af348dfb4b0ed4660c6eb393098361d2a`,
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
- **Attribution in product:** a credit line under every rendered SVG
  page ("Printed page: Mushaf al-Madinah — King Fahd Glorious Quran
  Printing Complex; ayah layer: Quran.ws", localized in fa/ar/en).
