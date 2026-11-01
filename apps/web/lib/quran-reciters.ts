/**
 * Trilingual reciter display names for the Quran reader.
 *
 * The providers payload carries reciter EDITION ids (e.g. "ar.alafasy")
 * and no human names, so the player used to print the raw id. This map
 * turns an id into a clean name in the page locale (fa/ar/en).
 *
 * Source (fetched 2026-10-31, re-verified 2026-11-01): AlQuran Cloud
 * audio editions catalog, GET /v1/edition/format/audio. Only
 * verse-by-verse and translation audio editions are listed here —
 * those are the editions the reader's per-ayah player can actually
 * play. Surah-by-surah-only editions are deliberately NOT listed: the
 * reader cannot play them per ayah, and inventing entries for them
 * would be worse than the raw-id fallback. Re-verification found
 * exactly ONE previously unmapped playable edition (uz.sodik-audio,
 * the last row of the live list); the other 37 were already mapped.
 *
 * Values are the catalog's own `name` (Arabic script, used for both fa
 * and ar — Persian readers read Arabic-script names as-is) and
 * `englishName` (used for en), copied verbatim per identifier.
 *
 * Fallback rule (never invent a name): any id not in this map renders
 * as the raw id, exactly as before.
 */

export interface ReciterNames {
  fa: string;
  ar: string;
  en: string;
}

const NAMES: Record<string, ReciterNames> = {
  'ar.abdulbasitmurattal': {
    fa: 'عبد الباسط عبد الصمد المرتل',
    ar: 'عبد الباسط عبد الصمد المرتل',
    en: 'Abdul Basit',
  },
  'ar.abdullahbasfar': { fa: 'عبد الله بصفر', ar: 'عبد الله بصفر', en: 'Abdullah Basfar' },
  'ar.abdurrahmaansudais': {
    fa: 'عبدالرحمن السديس',
    ar: 'عبدالرحمن السديس',
    en: 'Abdurrahmaan As-Sudais',
  },
  'ar.abdulsamad': { fa: 'عبدالباسط عبدالصمد', ar: 'عبدالباسط عبدالصمد', en: 'Abdul Samad' },
  'ar.shaatree': { fa: 'أبو بكر الشاطري', ar: 'أبو بكر الشاطري', en: 'Abu Bakr Ash-Shaatree' },
  'ar.ahmedajamy': {
    fa: 'أحمد بن علي العجمي',
    ar: 'أحمد بن علي العجمي',
    en: 'Ahmed ibn Ali al-Ajamy',
  },
  'ar.alafasy': { fa: 'مشاري العفاسي', ar: 'مشاري العفاسي', en: 'Alafasy' },
  'ar.hanirifai': { fa: 'هاني الرفاعي', ar: 'هاني الرفاعي', en: 'Hani Rifai' },
  'ar.husary': { fa: 'محمود خليل الحصري', ar: 'محمود خليل الحصري', en: 'Husary' },
  'ar.husarymujawwad': {
    fa: 'محمود خليل الحصري (المجود)',
    ar: 'محمود خليل الحصري (المجود)',
    en: 'Husary (Mujawwad)',
  },
  'ar.hudhaify': {
    fa: 'علي بن عبدالرحمن الحذيفي',
    ar: 'علي بن عبدالرحمن الحذيفي',
    en: 'Hudhaify',
  },
  'ar.ibrahimakhbar': { fa: 'إبراهيم الأخضر', ar: 'إبراهيم الأخضر', en: 'Ibrahim Akhdar' },
  'ar.mahermuaiqly': { fa: 'ماهر المعيقلي', ar: 'ماهر المعيقلي', en: 'Maher Al Muaiqly' },
  'ar.minshawi': { fa: 'محمد صديق المنشاوي', ar: 'محمد صديق المنشاوي', en: 'Minshawi' },
  'ar.minshawimujawwad': {
    fa: 'محمد صديق المنشاوي (المجود)',
    ar: 'محمد صديق المنشاوي (المجود)',
    en: 'Minshawy (Mujawwad)',
  },
  'ar.muhammadayyoub': { fa: 'محمد أيوب', ar: 'محمد أيوب', en: 'Muhammad Ayyoub' },
  'ar.muhammadjibreel': { fa: 'محمد جبريل', ar: 'محمد جبريل', en: 'Muhammad Jibreel' },
  'ar.saoodshuraym': {
    fa: 'سعود الشريم',
    ar: 'سعود الشريم',
    en: 'Saood bin Ibraaheem Ash-Shuraym',
  },
  'en.walk': { fa: 'Ibrahim Walk', ar: 'Ibrahim Walk', en: 'Ibrahim Walk' },
  'fa.hedayatfarfooladvand': {
    fa: 'فولادوند (با صدای هدایت‌فر)',
    ar: 'فولادوند (با صدای هدایت‌فر)',
    en: 'Fooladvand (read by Hedayatfar)',
  },
  'ar.parhizgar': { fa: 'شهريار پرهيزگار', ar: 'شهريار پرهيزگار', en: 'Parhizgar' },
  'ur.khan': { fa: 'شمشاد علی خان', ar: 'شمشاد علی خان', en: 'Shamshad Ali Khan' },
  'zh.chinese': { fa: '中文', ar: '中文', en: 'Chinese' },
  'fr.leclerc': { fa: 'Youssouf Leclerc', ar: 'Youssouf Leclerc', en: 'Youssouf Leclerc' },
  'ar.aymanswoaid': { fa: 'أيمن سويد', ar: 'أيمن سويد', en: 'Ayman Sowaid' },
  'ru.kuliev-audio': {
    fa: 'Эльмир Кулиев (1MuslimApp)',
    ar: 'Эльмир Кулиев (1MuslimApp)',
    en: 'Elmir Kuliev by 1MuslimApp',
  },
  'ru.kuliev-audio-2': {
    fa: 'Эльмир Кулиев 2 (1MuslimApp)',
    ar: 'Эльмир Кулиев 2 (1MuslimApp)',
    en: 'Elmir Kuliev 2 by 1MuslimApp',
  },
  'kk.khalifahaltai-audio': {
    fa: 'Қазақ - Халифа Алтайдың',
    ar: 'Қазақ - Халифа Алтайдың',
    en: 'Kazakh Translation Audio by Khalifah Altai',
  },
  'ar.alafasy-2': { fa: 'مشاري العفاسي', ar: 'مشاري العفاسي', en: 'Alafasy' },
  'ar.husary-2': { fa: 'محمود خليل الحصري', ar: 'محمود خليل الحصري', en: 'Husary' },
  'ar.mahermuaiqly-2': { fa: 'ماهر المعيقلي', ar: 'ماهر المعيقلي', en: 'Maher Al Muaiqly' },
  'ar.hudhaify-2': {
    fa: 'علي بن عبدالرحمن الحذيفي',
    ar: 'علي بن عبدالرحمن الحذيفي',
    en: 'Hudhaify',
  },
  'ar.husarymujawwad-2': {
    fa: 'محمود خليل الحصري (المجود)',
    ar: 'محمود خليل الحصري (المجود)',
    en: 'Husary (Mujawwad)',
  },
  'ar.minshawi-2': { fa: 'محمد صديق المنشاوي', ar: 'محمد صديق المنشاوي', en: 'Minshawi' },
  'ar.muhammadayyoub-2': { fa: 'محمد أيوب', ar: 'محمد أيوب', en: 'Muhammad Ayyoub' },
  'ar.muhammadjibreel-2': { fa: 'محمد جبريل', ar: 'محمد جبريل', en: 'Muhammad Jibreel' },
  'tr.vakfi-audio': { fa: 'Diyanet Vakfı', ar: 'Diyanet Vakfı', en: 'Diyanet Vakfı' },
  // Round 4 addition (live catalog 2026-11-01): the only playable
  // per-ayah edition the old map missed. Name/englishName verbatim
  // from the catalog (englishName trailing space trimmed).
  'uz.sodik-audio': { fa: 'Мухаммад Содик', ar: 'Мухаммад Содик', en: 'Muhammad Sodik Muhammad Yusuf' },
};

/**
 * Display name for a reciter edition id in the given page locale.
 * Returns null when the id is unmapped — the caller falls back to the
 * raw id (never an invented name).
 */
export function reciterDisplayName(id: string, locale: string): string | null {
  const entry = NAMES[id];
  if (!entry) return null;
  if (locale === 'fa') return entry.fa;
  if (locale === 'ar') return entry.ar;
  return entry.en;
}
