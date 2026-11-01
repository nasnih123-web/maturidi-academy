/**
 * Generate Quran boundary + search data from the provider's full text.
 *
 * Source: AlQuran Cloud (https://api.alquran.cloud/v1), edition
 * `quran-uthmani` — the SAME Arabic text edition the reader displays
 * (see lib/quran.ts resolveAyah: quran-uthmani first).
 *
 * Outputs (checked in, so the site never depends on a live third-party
 * fetch for navigation or search):
 * - lib/quran-boundaries.json: first ayah of every juz (30), hizb (120
 *   half-hizb divisions — Bayan's حزب system, hizb n = hizbQuarter
 *   2n-1: odd quarters are hizb starts AND hizb middles, so the 120
 *   half-hizb boundaries are exactly the odd quarters) and Madani page
 *   (604), each with { n, surah, ayah, text } — the first-ayah text
 *   preview for the lists.
 * - lib/quran-search-index.json: one entry per ayah (6236) with
 *   { g (global number), s (surah), a (ayah), t (NORMALIZED text) }.
 *   Normalization matches lib/quran-search.ts normalizeQuranText
 *   (strip diacritics + tatweel, map Persian yeh/kaf to Arabic).
 *
 * Nothing here is hand-typed: every boundary is the first ayah carrying
 * that juz / hizbQuarter / page value in the provider data. The script
 * FAILS (non-zero exit) when any anchor check fails, so a regenerated
 * file can never silently drift.
 *
 * Usage: node scripts/generate-quran-data.mjs  (from apps/web)
 * Requires network access to api.alquran.cloud.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'lib');

const EDITION_URL = 'https://api.alquran.cloud/v1/edition';
const QURAN_URL = 'https://api.alquran.cloud/v1/quran/quran-uthmani';

// Normalization, built from code points (ASCII-only source, so no
// invisible character can ever be mangled again):
// Persian yeh U+06CC -> Arabic yeh U+064A, Persian kaf U+06A9 ->
// Arabic kaf U+0643, alif wasla U+0671 -> alef U+0627; strip Arabic
// diacritics U+064B-U+0652 + U+0670 and tatweel U+0640.
// This MUST stay identical to normalizeQuranText in lib/quran-search.ts.
const PERSIAN_YEH = String.fromCharCode(0x06cc);
const ARABIC_YEH = String.fromCharCode(0x064a);
const PERSIAN_KAF = String.fromCharCode(0x06a9);
const ARABIC_KAF = String.fromCharCode(0x0643);
const ALIF_WASLA = String.fromCharCode(0x0671);
const ALEF = String.fromCharCode(0x0627);
const DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x064b)}-${String.fromCharCode(0x0652)}${String.fromCharCode(0x0670)}${String.fromCharCode(0x0640)}]`,
  'g',
);
function normalize(text) {
  return text
    .split(PERSIAN_YEH)
    .join(ARABIC_YEH)
    .split(PERSIAN_KAF)
    .join(ARABIC_KAF)
    .split(ALIF_WASLA)
    .join(ALEF)
    .replace(DIACRITICS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fail(msg) {
  console.error(`FAILED: ${msg}`);
  process.exit(1);
}

const editionRes = await fetch(EDITION_URL);
if (!editionRes.ok) fail(`editions fetch → ${editionRes.status}`);
const editionBody = await editionRes.json();
const textEditions = (editionBody.data ?? []).filter((e) => e.format === 'text');
console.log('Text editions on AlQuran Cloud:');
for (const e of textEditions) {
  console.log(`  - ${e.identifier} (${e.language}, ${e.type})`);
}
const indopak = textEditions.filter((e) => /indopak|indo-pak|pak/i.test(e.identifier));
console.log(
  indopak.length > 0
    ? `INDO-PAK TEXT EDITIONS FOUND: ${indopak.map((e) => e.identifier).join(', ')}`
    : 'NO Indo-Pak character text edition on AlQuran Cloud (only uthmani/simple variants).',
);

const res = await fetch(QURAN_URL);
if (!res.ok) fail(`quran fetch → ${res.status}`);
const body = await res.json();
const surahs = body.data?.surahs;
if (!Array.isArray(surahs) || surahs.length !== 114) {
  fail(`expected 114 surahs, got ${Array.isArray(surahs) ? surahs.length : 'none'}`);
}

const all = [];
for (const s of surahs) {
  for (const a of s.ayahs) {
    all.push({
      g: a.number,
      s: s.number,
      a: a.numberInSurah,
      text: a.text,
      juz: a.juz,
      page: a.page,
      hizbQuarter: a.hizbQuarter,
    });
  }
}
console.log(`Total ayahs: ${all.length}`);
if (all.length !== 6236) fail(`expected 6236 ayahs, got ${all.length}`);

function firstBy(key, value) {
  return all.find((x) => x[key] === value) ?? null;
}

const juz = [];
for (let n = 1; n <= 30; n++) {
  const hit = firstBy('juz', n);
  if (!hit) fail(`no ayah with juz=${n}`);
  juz.push({ n, surah: hit.s, ayah: hit.a, text: hit.text });
}
const hizb = [];
for (let n = 1; n <= 120; n++) {
  const hit = firstBy('hizbQuarter', 2 * n - 1);
  if (!hit) fail(`no ayah with hizbQuarter=${2 * n - 1} (hizb ${n})`);
  hizb.push({ n, surah: hit.s, ayah: hit.a, text: hit.text });
}
const page = [];
for (let n = 1; n <= 604; n++) {
  const hit = firstBy('page', n);
  if (!hit) fail(`no ayah with page=${n}`);
  page.push({ n, surah: hit.s, ayah: hit.a, text: hit.text });
}
console.log(`Boundaries: juz=${juz.length} hizb=${hizb.length} page=${page.length}`);

// Anchor checks (provider-derived values must equal these known anchors).
const anchors = [
  ['juz 2', juz[1], 2, 142],
  ['juz 3', juz[2], 2, 253],
  ['juz 4', juz[3], 3, 93],
  ['juz 5', juz[4], 4, 24],
  ['juz 6', juz[5], 4, 148],
  ['page 2', page[1], 2, 1],
  ['page 3', page[2], 2, 6],
  ['page 4', page[3], 2, 17],
  ['page 5', page[4], 2, 25],
  ['page 6', page[5], 2, 30],
  // Bayan's حزب anchors (half-hizb divisions, user reference 2026-11-01).
  ['hizb 2', hizb[1], 2, 44],
  ['hizb 3', hizb[2], 2, 75],
  ['hizb 4', hizb[3], 2, 106],
  ['hizb 5', hizb[4], 2, 142],
  ['hizb 6', hizb[5], 2, 177],
];
for (const [name, hit, s, a] of anchors) {
  if (hit.surah !== s || hit.ayah !== a) {
    fail(`anchor ${name}: expected ${s}:${a}, provider says ${hit.surah}:${hit.ayah}`);
  }
  console.log(`  anchor ${name} OK (${s}:${a})`);
}
console.log('Bayan hizb (half-hizb) starts 1-6:');
for (let i = 0; i < 6; i++) {
  console.log(`  hizb ${hizb[i].n} → ${hizb[i].surah}:${hizb[i].ayah}`);
}
console.log(`  hizb 22 → ${hizb[21].surah}:${hizb[21].ayah}`);

const searchIndex = all.map((x) => ({ g: x.g, s: x.s, a: x.a, t: normalize(x.text) }));

writeFileSync(join(LIB, 'quran-boundaries.json'), `${JSON.stringify({ juz, hizb, page })}\n`);
writeFileSync(join(LIB, 'quran-search-index.json'), `${JSON.stringify(searchIndex)}\n`);
console.log('Wrote lib/quran-boundaries.json and lib/quran-search-index.json');
