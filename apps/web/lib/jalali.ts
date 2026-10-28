/**
 * Jalali <-> Gregorian conversion — TypeScript port of the Birashk algorithm
 * (same code as apps/api/app/modules/quran/jalali.py, verified against the
 * same anchors: 1405-01-01 = 2026-03-21, 1403-12-30 = 2025-03-20 (leap),
 * 1405-12-29 = 2027-03-20, 1408-12-30 = 2030-03-20).
 *
 * Used ONLY to map the Torbat table's Jalali MM-DD keys and to render the
 * week/month/year timetable tabs. Prayer times themselves always come from
 * the API — never computed here.
 */

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2322, 2394, 2456, 3178,
];

/** Floored division/modulo (Python // and % semantics). */
function div(a: number, b: number): number {
  return Math.floor(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

interface JalCal {
  leap: number;
  gy: number;
  march: number;
}

function jalCal(jy: number): JalCal {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div(div(gy, 100) + 1, 4) * 3 - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === 4) leap = 0;
  return { leap, gy, march };
}

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = div(14 - m, 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d + div(153 * mm + 2, 5) + 365 * yy + div(yy, 4) - div(yy, 100) + div(yy, 400) - 32045
  );
}

function jdnToGregorian(jdn: number): { y: number; m: number; d: number } {
  const a = jdn + 32044;
  const b = div(4 * a + 3, 146097);
  const c = a - div(146097 * b, 4);
  const d = div(4 * c + 3, 1461);
  const e = c - div(1461 * d, 4);
  const m = div(5 * e + 2, 153);
  const day = e - div(153 * m + 2, 5) + 1;
  const month = m + 3 - 12 * div(m, 10);
  const year = 100 * b + d - 4800 + div(m, 10);
  return { y: year, m: month, d: day };
}

export interface JalaliDate {
  y: number;
  m: number;
  d: number;
}

export function toJalali(g: Date): JalaliDate {
  const gy = g.getFullYear();
  const gm = g.getMonth() + 1;
  const gd = g.getDate();
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn = gregorianToJdn(gy, gm, gd);
  const jdn1f = gregorianToJdn(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      return { y: jy, m: 1 + div(k, 31), d: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { y: jy, m: 7 + div(k, 30), d: mod(k, 30) + 1 };
}

export function isJalaliLeap(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

export function fromJalali(jy: number, jm: number, jd: number): Date {
  const r = jalCal(jy);
  const jdn1f = gregorianToJdn(r.gy, 3, r.march);
  let k: number;
  if (jm <= 6) k = (jm - 1) * 31 + jd - 1;
  else k = 186 + (jm - 7) * 30 + jd - 1;
  const g = jdnToGregorian(jdn1f + k);
  return new Date(g.y, g.m - 1, g.d);
}

/** "YYYY-MM-DD" in local time (no UTC shift). */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function formatJalali(j: JalaliDate): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.y}/${p(j.m)}/${p(j.d)}`;
}
