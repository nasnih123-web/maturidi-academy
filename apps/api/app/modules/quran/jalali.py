"""تبدیل تقویم جلالی ↔ میلادی — الگوریتم استاندارد بیرشک (همان منطق jalaali-js).

فقط برای نگاشت تاریخ‌های جدول تربت جام (کلیدهای MM-DD جلالی) به تاریخ میلادی
و برعکس استفاده می‌شود؛ هیچ قاعدهٔ فقهی در آن نیست. نقطه‌های لنگر در تست‌ها
آزموده می‌شوند: ۱۴۰۵-۰۱-۰۱ = ۲۰۲۶-۰۳-۲۱، ۱۴۰۳-۱۲-۳۰ = ۲۰۲۵-۰۳-۲۰ (کبیسه)،
۱۴۰۵-۱۲-۲۹ = ۲۰۲۷-۰۳-۲۰.
"""
from __future__ import annotations

from datetime import date

_BREAKS = (
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181,
    1210, 1635, 2060, 2097, 2192, 2262, 2322, 2394, 2456, 3178,
)


def _jal_cal(jy: int) -> dict:
    """سال کبیسهٔ جلالی، سال میلادی متناظر، و روز مارسِ شروع فروردین."""
    gy = jy + 621
    leap_j = -14
    jp = _BREAKS[0]
    jump = 0
    for i in range(1, len(_BREAKS)):
        jm = _BREAKS[i]
        jump = jm - jp
        if jy < jm:
            break
        leap_j += (jump // 33) * 8 + ((jump % 33) // 4)
        jp = jm
    n = jy - jp
    leap_j += (n // 33) * 8 + ((n % 33 + 3) // 4)
    if jump % 33 == 4 and jump - n == 4:
        leap_j += 1
    leap_g = gy // 4 - ((gy // 100 + 1) * 3 // 4) - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + ((jump + 4) // 33) * 33
    leap = (((n + 1) % 33) - 1) % 4
    if leap == 4:
        leap = 0
    return {"leap": leap, "gy": gy, "march": march}


def _gregorian_to_jdn(y: int, m: int, d: int) -> int:
    """شمارهٔ روز ژولینی برای تاریخ میلادی (جفت فلیگل–وان‌فلاندرن)."""
    a = (14 - m) // 12
    yy = y + 4800 - a
    mm = m + 12 * a - 3
    return d + ((153 * mm + 2) // 5) + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045


def _jdn_to_gregorian(jdn: int) -> date:
    """معکوس _gregorian_to_jdn (همان جفت — با فرمول مستقیم سازگار است)."""
    a = jdn + 32044
    b = (4 * a + 3) // 146097
    c = a - (146097 * b) // 4
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = 100 * b + d - 4800 + (m // 10)
    return date(year, month, day)


def to_jalali(g: date) -> tuple[int, int, int]:
    """میلادی → (سال، ماه، روز) جلالی."""
    jy = g.year - 621
    r = _jal_cal(jy)
    jdn = _gregorian_to_jdn(g.year, g.month, g.day)
    jdn1f = _gregorian_to_jdn(r["gy"], 3, r["march"])
    k = jdn - jdn1f
    if k >= 0:
        if k <= 185:
            jm = 1 + k // 31
            jd = k % 31 + 1
            return jy, jm, jd
        k -= 186
    else:
        jy -= 1
        k += 179
        if r["leap"] == 1:
            k += 1
    jm = 7 + k // 30
    jd = k % 30 + 1
    return jy, jm, jd


def from_jalali(jy: int, jm: int, jd: int) -> date:
    """(سال، ماه، روز) جلالی → میلادی. برای ورودی نامعتبر ValueError می‌دهد."""
    if not 1 <= jm <= 12:
        raise ValueError(f"invalid Jalali month: {jm}")
    dim = jalali_month_length(jy, jm)
    if not 1 <= jd <= dim:
        raise ValueError(f"invalid Jalali day: {jd} for month {jm} of year {jy}")
    r = _jal_cal(jy)
    jdn1f = _gregorian_to_jdn(r["gy"], 3, r["march"])
    if jm <= 6:
        k = (jm - 1) * 31 + jd - 1
    else:
        k = 186 + (jm - 7) * 30 + jd - 1
    return _jdn_to_gregorian(jdn1f + k)


def is_jalali_leap(jy: int) -> bool:
    return _jal_cal(jy)["leap"] == 0


def jalali_month_length(jy: int, jm: int) -> int:
    if jm <= 6:
        return 31
    if jm <= 11:
        return 30
    return 30 if is_jalali_leap(jy) else 29
