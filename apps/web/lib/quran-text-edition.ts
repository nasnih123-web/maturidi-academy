/**
 * Edition's OWN ayah text (round 6, non-Hafs tap panel).
 *
 * Source: quran-ws/quran-text, data/mushaf/{edition}.json — the same
 * publisher family as the SVG pages (KFGQPC printed editions), with
 * shared word identity. Used ONLY for the tap panel of a non-Hafs
 * mushaf: translation, tafsir and audio in this app are indexed by
 * Hafs numbering, and attaching them to a Warsh/Qalun/Duri/Shubah
 * reference without a verified ayah-number mapping would silently
 * show Hafs-numbered content under another riwayah's reference. So
 * the panel shows the tapped ayah's own words in its own edition,
 * labeled as such, and nothing Hafs-numbered is attached to it.
 * Wiring the quran.ws Qiraat Ayah Map (dist/mushaf/surah-NNN.json)
 * for mapped translation/audio is explicit follow-up work, not
 * silently approximated here: splits and merges between countings
 * mean a non-Hafs ayah can map to zero, one, or two Hafs ayahs.
 *
 * Naming trap: the SVG folder is `qalon/kfqc` but the quran-text
 * file is `qalun.json` — the map below is the single place that
 * translates between the two. Never guess the filename.
 *
 * Words exclude waqf marks (they live in the data's separate marks
 * layer); the returned string is the edition's words joined with
 * spaces. The SVG page itself shows the marks as printed outlines.
 * Numbering cross-check (spot-verified 2026-11-01): Warsh page 42's
 * first ayah is 2:251 in BOTH the SVG per-page JSON and this data's
 * page_starts/ayah_starts — the two sources agree on the pages
 * checked, but the panel never assumes agreement beyond the tapped
 * reference it was asked for.
 */

import type { SvgMushafKey } from './quran-svg-page';

const RAW_TEXT =
  'https://raw.githubusercontent.com/quran-ws/quran-text/main/data/mushaf';

const EDITION_FILE: Record<SvgMushafKey, string> = {
  'hafs/kfqc': 'hafs',
  'warsh/kfqc': 'warsh',
  'qalon/kfqc': 'qalun',
  'douri/kfqc': 'duri',
  'shubah/kfqc': 'shubah',
};

interface EditionSurah {
  number: number;
  first_ayah: number;
  ayah_count: number;
}

interface EditionData {
  words: string[];
  ayah_starts: number[];
  surahs: EditionSurah[];
}

const editionCache = new Map<SvgMushafKey, Promise<EditionData | null>>();

function loadEdition(mushaf: SvgMushafKey): Promise<EditionData | null> {
  const cached = editionCache.get(mushaf);
  if (cached) return cached;
  const p = fetch(`${RAW_TEXT}/${EDITION_FILE[mushaf]}.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`edition ${mushaf}: HTTP ${res.status}`);
      const data: unknown = await res.json();
      const d = data as Partial<EditionData>;
      if (!Array.isArray(d.words) || !Array.isArray(d.ayah_starts) || !Array.isArray(d.surahs)) {
        throw new Error(`edition ${mushaf}: unexpected shape`);
      }
      return d as EditionData;
    })
    .catch(() => null);
  editionCache.set(mushaf, p);
  return p;
}

/**
 * The tapped ayah's own words in its own edition, or null when the
 * edition data or the reference is unavailable. Null is a signal to
 * show the reference + honesty note WITHOUT text — never a fallback
 * to Hafs words.
 */
export async function editionAyahText(
  mushaf: SvgMushafKey,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const data = await loadEdition(mushaf);
  if (!data) return null;
  const s = data.surahs[surah - 1];
  if (!s || s.number !== surah || ayah < 1 || ayah > s.ayah_count) return null;
  const globalIdx = s.first_ayah + (ayah - 1);
  const start = data.ayah_starts[globalIdx];
  if (typeof start !== 'number') return null;
  const end = data.ayah_starts[globalIdx + 1] ?? data.words.length;
  const words = data.words.slice(start, end);
  if (words.length === 0) return null;
  return words.join(' ');
}
