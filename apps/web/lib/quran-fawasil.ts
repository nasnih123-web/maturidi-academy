/**
 * Fawasil — per-surah ayah counts per classical counting school.
 *
 * *** DRAFT pending scholar review — do not treat as a final fiqh
 * reference. *** No number in this file is invented: a cell that could
 * not be sourced from a published table is `null` and is flagged by the
 * `fallback` field of `fawasilFor` (the UI then shows the Kufi count
 * and says so explicitly, never passing it off as another school's).
 *
 * Sources for the Kufi column (complete, 114 surahs, total 6236):
 * - AlQuran Cloud `GET /v1/surah` (the Academy's own text provider,
 *   standard mushaf numbering): `numberOfAyahs` per surah, fetched
 *   2026-10-31. This is the Kufi count of the standard mushaf.
 * - Cross-checked against the classical prose counts in Ibn al-Jawzi,
 *   `Funūn al-Afnān fī ʿUyūn ʿUlūm al-Qurʾān`, bāb ʿadad āyāt al-suwar
 *   (and al-Sakhāwī, `Jamāl al-Qurrāʾ`), which agree with the Kufi
 *   column for every surah they enumerate (e.g. al-Fātiḥa 7, al-Nisāʾ
 *   176, al-Aʿrāf 206, al-Anfāl 75, al-Tawba 129, Yūnus 109, Hūd 123,
 *   al-Muʾminūn 118, al-Nūr 64, al-Shuʿarāʾ 227, al-Naml 93,
 *   al-Qaṣaṣ 88, al-ʿAnkabūt 69, al-Rūm 60, Luqmān 34, al-Sajda 30,
 *   al-Aḥzāb 73, Sabaʾ 54, Fāṭir 45, al-Fuṣṣilat 54, al-Aḥqāf 35,
 *   Muḥammad 38, al-Fatḥ 29, al-Ḥujurāt 18, al-Ṭūr 49, al-Najm 62,
 *   al-Qamar 55, al-Raḥmān 78, al-Wāqiʿa 96, al-Qāriʿa 11,
 *   al-Māʿūn 7, al-Fīl 5, Quraysh 4, al-ʿĀdiyāt 11, al-Takāthur 8,
 *   al-ʿAṣr 3, al-Humaza 9, al-Kawthar 3, al-Kāfirūn 6).
 *
 * Other schools (basri, madani1, madani2, makki, shami, himsi): the
 * classical sources state these counts only in prose per surah, and no
 * machine-readable published table was verified during Phase 1, so all
 * their cells are `null` here. Transcribing them from prose is a
 * follow-up task for scholar review — it must not be guessed.
 *
 * Madhhab → school mapping (also DRAFT, flagged for review):
 * - Hanafi → kufi: CERTAIN (the standard mushaf's Kufi count is the
 *   Hanafi teaching tradition's count).
 * - Shafi'i → kufi: PROPOSED (Ḥafṣ/Kufi predominance in Shafi'i
 *   regions); flagged, not certain.
 * - Hanbali → kufi: PROPOSED (same reason); flagged, not certain.
 * - Maliki → madani2: PROPOSED (Warsh/Nāfiʿ Madani tradition);
 *   flagged, and its column is currently null, so the UI falls back
 *   to the Kufi count with an explicit fallback note.
 */
import type { MadhhabId } from './quran-madhhab';

export const FAWASIL_SCHOOLS = [
  'kufi',
  'basri',
  'madani1',
  'madani2',
  'makki',
  'shami',
  'himsi',
] as const;
export type FawasilSchool = (typeof FAWASIL_SCHOOLS)[number];

/**
 * Per-surah counts, index 0 = surah 1. `null` = not sourced (never guessed).
 * The Kufi column totals 6236 (standard mushaf).
 */
export const FAWASIL_COUNTS: Record<FawasilSchool, (number | null)[]> = {
  kufi: [
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128,
    111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73,
    54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60,
    49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52,
    44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19,
    26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3,
    6, 3, 5, 4, 5, 6,
  ],
  basri: Array<number | null>(114).fill(null),
  madani1: Array<number | null>(114).fill(null),
  madani2: Array<number | null>(114).fill(null),
  makki: Array<number | null>(114).fill(null),
  shami: Array<number | null>(114).fill(null),
  himsi: Array<number | null>(114).fill(null),
};

export interface MadhhabFawasilSchool {
  school: FawasilSchool;
  /** True when the mapping itself is a proposal awaiting scholar review. */
  proposed: boolean;
}

export const MADHHAB_FAWASIL_SCHOOL: Record<MadhhabId, MadhhabFawasilSchool> = {
  hanafi: { school: 'kufi', proposed: false },
  shafii: { school: 'kufi', proposed: true },
  maliki: { school: 'madani2', proposed: true },
  hanbali: { school: 'kufi', proposed: true },
};

export interface FawasilDisplay {
  /** Count to show, or null when even the Kufi column lacks the surah. */
  count: number | null;
  /** School the shown count actually comes from (always 'kufi' on fallback). */
  school: FawasilSchool;
  /** True when the mapped school had no data and Kufi was substituted. */
  fallback: boolean;
  /** The madhhab's mapped school (may differ from `school` on fallback). */
  mappedSchool: FawasilSchool;
}

/**
 * Resolve the count to display for a surah under a madhhab: the mapped
 * school's count when sourced, otherwise the Kufi count with `fallback`
 * set so the UI can disclose the substitution.
 */
export function fawasilFor(surahNumber: number, madhhab: MadhhabId): FawasilDisplay {
  const mappedSchool = MADHHAB_FAWASIL_SCHOOL[madhhab].school;
  const direct =
    surahNumber >= 1 && surahNumber <= 114
      ? FAWASIL_COUNTS[mappedSchool][surahNumber - 1]
      : null;
  if (direct !== null && direct !== undefined) {
    return { count: direct, school: mappedSchool, fallback: false, mappedSchool };
  }
  const kufi =
    surahNumber >= 1 && surahNumber <= 114
      ? FAWASIL_COUNTS.kufi[surahNumber - 1]
      : null;
  return {
    count: kufi ?? null,
    school: 'kufi',
    fallback: true,
    mappedSchool,
  };
}
