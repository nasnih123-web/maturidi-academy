/**
 * Country table for the CRM users dashboard (Phase C).
 *
 * Same 38-country set as the API (app/core/countries.py) and the web
 * registration form (apps/web/lib/countries.ts) — keep in sync.
 * Names are Persian (CRM's primary UI language); the flag is derived
 * from the ISO code with regional-indicator symbols, no assets needed.
 */

export interface CountryDef {
  iso: string;
  nameFa: string;
}

export const COUNTRIES: CountryDef[] = [
  { iso: "IR", nameFa: "ایران" },
  { iso: "AF", nameFa: "افغانستان" },
  { iso: "IQ", nameFa: "عراق" },
  { iso: "TR", nameFa: "ترکیه" },
  { iso: "AE", nameFa: "امارات" },
  { iso: "SA", nameFa: "عربستان سعودی" },
  { iso: "QA", nameFa: "قطر" },
  { iso: "KW", nameFa: "کویت" },
  { iso: "OM", nameFa: "عمان" },
  { iso: "BH", nameFa: "بحرین" },
  { iso: "PK", nameFa: "پاکستان" },
  { iso: "IN", nameFa: "هند" },
  { iso: "BD", nameFa: "بنگلادش" },
  { iso: "TJ", nameFa: "تاجیکستان" },
  { iso: "UZ", nameFa: "ازبکستان" },
  { iso: "TM", nameFa: "ترکمنستان" },
  { iso: "AZ", nameFa: "آذربایجان" },
  { iso: "ID", nameFa: "اندونزی" },
  { iso: "MY", nameFa: "مالزی" },
  { iso: "EG", nameFa: "مصر" },
  { iso: "SY", nameFa: "سوریه" },
  { iso: "LB", nameFa: "لبنان" },
  { iso: "JO", nameFa: "اردن" },
  { iso: "YE", nameFa: "یمن" },
  { iso: "MA", nameFa: "مراکش" },
  { iso: "DZ", nameFa: "الجزایر" },
  { iso: "TN", nameFa: "تونس" },
  { iso: "NG", nameFa: "نیجریه" },
  { iso: "GB", nameFa: "بریتانیا" },
  { iso: "DE", nameFa: "آلمان" },
  { iso: "FR", nameFa: "فرانسه" },
  { iso: "NL", nameFa: "هلند" },
  { iso: "SE", nameFa: "سوئد" },
  { iso: "RU", nameFa: "روسیه" },
  { iso: "CN", nameFa: "چین" },
  { iso: "AU", nameFa: "استرالیا" },
  { iso: "CA", nameFa: "کانادا" },
  { iso: "US", nameFa: "آمریکا" },
];

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

export function countryNameFa(iso: string | null | undefined): string {
  if (!iso) return "—";
  return BY_ISO.get(iso.toUpperCase())?.nameFa ?? iso.toUpperCase();
}

export function countryFlag(iso: string | null | undefined): string {
  if (!iso || iso.length !== 2) return "";
  const base = 0x1f1e6 - 65; // regional indicator 'A'
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((ch) => base + ch.charCodeAt(0)),
  );
}
