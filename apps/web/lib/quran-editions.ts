/**
 * Verified AlQuran Cloud text-edition catalogs for the reader's
 * translation / tafsir selectors (round 4).
 *
 * Source (fetched live 2026-11-01): GET /v1/edition/language/fa
 * (13 Persian text translations) and GET /v1/edition/language/ar
 * (6 Arabic text tafsirs). `name` and `englishName` are copied
 * verbatim from the catalog; fa/ar locales show `name`, en shows
 * `englishName`.
 *
 * This module carries IDS + NAMES ONLY — never edition texts. The
 * reader fetches the selected edition's text live through the
 * existing provider mechanism (?translation= / ?tafsir= → the API's
 * surah endpoint → AlQuran Cloud), exactly as the CRM-enabled
 * editions already work. The selectors offer the union of the
 * CRM-enabled lists and this catalog, so a reader can pick a
 * verified edition even before the CRM admin enables it; unknown
 * ids still fall back to the raw id (never an invented name).
 */

export interface EditionNames {
  /** Catalog `name` (Arabic/Persian script) — shown for fa and ar. */
  fa: string;
  ar: string;
  /** Catalog `englishName` — shown for en. */
  en: string;
}

export interface EditionEntry {
  id: string;
  names: EditionNames;
}

/** All Persian text translations on AlQuran Cloud (13, live 2026-11-01). */
export const PERSIAN_TRANSLATIONS: EditionEntry[] = [
  { id: 'fa.ayati', names: { fa: 'آیتی', ar: 'آیتی', en: 'AbdolMohammad Ayati' } },
  { id: 'fa.fooladvand', names: { fa: 'فولادوند', ar: 'فولادوند', en: 'Mohammad Mahdi Fooladvand' } },
  { id: 'fa.ghomshei', names: { fa: 'الهی قمشه‌ای', ar: 'الهی قمشه‌ای', en: 'Mahdi Elahi Ghomshei' } },
  { id: 'fa.makarem', names: { fa: 'مکارم شیرازی', ar: 'مکارم شیرازی', en: 'Naser Makarem Shirazi' } },
  { id: 'fa.ansarian', names: { fa: 'انصاریان', ar: 'انصاریان', en: 'Hussain Ansarian' } },
  { id: 'fa.bahrampour', names: { fa: 'بهرام پور', ar: 'بهرام پور', en: 'Abolfazl Bahrampour' } },
  { id: 'fa.khorramshahi', names: { fa: 'خرمشاهی', ar: 'خرمشاهی', en: "Baha'oddin Khorramshahi" } },
  { id: 'fa.mojtabavi', names: { fa: 'مجتبوی', ar: 'مجتبوی', en: 'Sayyed Jalaloddin Mojtabavi' } },
  { id: 'fa.khorramdel', names: { fa: 'خرمدل', ar: 'خرمدل', en: 'Mostafa Khorramdel' } },
  { id: 'fa.moezzi', names: { fa: 'معزی', ar: 'معزی', en: 'Mohammad Kazem Moezzi' } },
  { id: 'fa.gharaati', names: { fa: 'قرائتی', ar: 'قرائتی', en: 'Mohsen Gharaati' } },
  { id: 'fa.sadeqi', names: { fa: 'صادقی تهرانی', ar: 'صادقی تهرانی', en: 'Mohammad Sadeqi Tehrani' } },
  { id: 'fa.safavi', names: { fa: 'صفوی', ar: 'صفوی', en: 'Mohammad Reza Safavi' } },
];

/** All Arabic text tafsirs on AlQuran Cloud (6, live 2026-11-01). */
export const ARABIC_TAFSIRS: EditionEntry[] = [
  { id: 'ar.muyassar', names: { fa: 'تفسير المیسر', ar: 'تفسير المیسر', en: 'King Fahad Quran Complex' } },
  { id: 'ar.jalalayn', names: { fa: 'تفسير الجلالين', ar: 'تفسير الجلالين', en: 'Jalal ad-Din al-Mahalli and Jalal ad-Din as-Suyuti' } },
  { id: 'ar.qurtubi', names: { fa: 'تفسير القرطبي', ar: 'تفسير القرطبي', en: 'Tafseer Al Qurtubi' } },
  { id: 'ar.miqbas', names: { fa: 'تنوير المقباس من تفسير بن عباس', ar: 'تنوير المقباس من تفسير بن عباس', en: 'Tafseer Tanwir al-Miqbas' } },
  { id: 'ar.waseet', names: { fa: 'الـتـفـسـيـر الـوسـيـط', ar: 'الـتـفـسـيـر الـوسـيـط', en: 'Tafseer Al-Waseet' } },
  { id: 'ar.baghawi', names: { fa: 'تفسير البغوي', ar: 'تفسير البغوي', en: 'Tafseer Al-Baghawi' } },
];

/**
 * Display name for a translation/tafsir edition id in the page locale.
 * Returns null when the id is not in either catalog — the caller falls
 * back to the raw id (never an invented name).
 */
export function editionDisplayName(id: string, locale: string): string | null {
  const entry =
    PERSIAN_TRANSLATIONS.find((e) => e.id === id) ?? ARABIC_TAFSIRS.find((e) => e.id === id);
  if (!entry) return null;
  if (locale === 'fa') return entry.names.fa;
  if (locale === 'ar') return entry.names.ar;
  return entry.names.en;
}

/**
 * Selector options: the CRM-enabled ids first (in CRM order), then any
 * catalog entries not already enabled. Unknown CRM ids are kept with
 * their raw id as the label (never dropped, never renamed).
 */
export function editionOptions(
  catalog: EditionEntry[],
  enabled: string[],
  locale: string,
): { id: string; label: string }[] {
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const id of enabled) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: editionDisplayName(id, locale) ?? id });
  }
  for (const e of catalog) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, label: locale === 'en' ? e.names.en : e.names.fa });
  }
  return out;
}
