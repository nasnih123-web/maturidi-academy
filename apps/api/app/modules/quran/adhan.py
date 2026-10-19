"""محاسبهٔ اوقات نماز — پیاده‌سازی pure-Python الگوریتم PrayTimes.

روش‌ها: isna (۱۵/۱۵)، mwl (۱۸/۱۷)، egypt (۱۹.۵/۱۷.۵)، karachi (۱۸/۱۸)،
makkah/umm-al-qura (فجر ۱۸.۵، عشا = غروب + ۹۰ دقیقه)، jafari (۱۶/۴/۱۴).
عصر: shafi (factor=1) / hanafi (factor=2).

این محاسبات نجومی است، نه قاعدهٔ فقهی — §۱۵.۵ (ممنوعیت هاردکد قواعد فقهی)
شامل آن نمی‌شود. زمان‌ها به‌صورت رشتهٔ «HH:MM» در افست زمانیِ درخواستی
(`tz`، ساعت اعشاری مثل ‎+3.5) برمی‌گردند؛ اگر `tz` داده نشود، UTC است.
DST دستی با `tz` کنترل می‌شود (مستندات endpoint).
"""
from __future__ import annotations

import math
from datetime import date

_D2R = math.pi / 180.0
_R2D = 180.0 / math.pi


# --- پارامترهای روش‌ها (زاویه‌ها برحسب درجه) ---
METHODS: dict[str, dict] = {
    "isna": {"label": "ISNA (North America)", "fajr": 15.0, "isha": 15.0},
    "mwl": {"label": "Muslim World League", "fajr": 18.0, "isha": 17.0},
    "egypt": {"label": "Egyptian General Authority of Survey", "fajr": 19.5, "isha": 17.5},
    "karachi": {
        "label": "University of Islamic Sciences, Karachi",
        "fajr": 18.0,
        "isha": 18.0,
    },
    "makkah": {
        "label": "Umm al-Qura, Makkah",
        "fajr": 18.5,
        "isha_minutes": 90,  # عشا = مغرب + ۹۰ دقیقه
    },
    "jafari": {
        "label": "Shia Ithna-Ansari (Jafari)",
        "fajr": 16.0,
        "maghrib": 4.0,
        "isha": 14.0,
    },
}

MADRABS: dict[str, int] = {"shafi": 1, "hanafi": 2}
_IMSAK_OFFSET_MIN = 10  # امساک = فجر − ۱۰ دقیقه (پیش‌فرض PrayTimes)


def _fix_angle(a: float) -> float:
    return a - 360.0 * math.floor(a / 360.0)


def _fix_hour(a: float) -> float:
    return a - 24.0 * math.floor(a / 24.0)


def _julian(year: int, month: int, day: int) -> float:
    if month <= 2:
        year -= 1
        month += 12
    a = math.floor(year / 100)
    b = 2 - a + math.floor(a / 4)
    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day
        + b
        - 1524.5
    )


def _sun_position(jd: float) -> tuple[float, float]:
    """→ (انحراف خورشید به درجه، معادلهٔ زمان به ساعت)."""
    d = jd - 2451545.0
    g = _fix_angle(357.529 + 0.98560028 * d)
    q = _fix_angle(280.459 + 0.98564736 * d)
    lng = _fix_angle(
        q + 1.915 * math.sin(g * _D2R) + 0.020 * math.sin(2 * g * _D2R)
    )
    e = 23.439 - 0.00000036 * d
    ra = _fix_hour(
        math.atan2(
            math.cos(e * _D2R) * math.sin(lng * _D2R), math.cos(lng * _D2R)
        )
        * _R2D
        / 15.0
    )
    decl = math.asin(math.sin(e * _D2R) * math.sin(lng * _D2R)) * _R2D
    eqt = q / 15.0 - ra
    return decl, eqt


class _Calculator:
    """هستهٔ محاسبه برای یک مختصات/تاریخ — فرمول‌های استاندارد PrayTimes."""

    def __init__(self, lat: float, lng: float, tz: float, method: str, madhab: str):
        self.lat = lat
        self.lng = lng
        self.tz = tz
        self.params = METHODS[method]
        self.asr_factor = MADRABS[madhab]
        self.method = method

    def _mid_day(self, time: float, jdn: float) -> float:
        _, eqt = _sun_position(jdn + time)
        return _fix_hour(12.0 - eqt)

    def _sun_angle_time(self, angle: float, time: float, jdn: float, direction: str) -> float:
        decl, _ = _sun_position(jdn + time)
        noon = self._mid_day(time, jdn)
        lat_r = self.lat * _D2R
        decl_r = decl * _D2R
        cos_t = (
            -math.sin(angle * _D2R) - math.sin(lat_r) * math.sin(decl_r)
        ) / (math.cos(lat_r) * math.cos(decl_r))
        cos_t = max(-1.0, min(1.0, cos_t))
        t = (1.0 / 15.0) * math.acos(cos_t) * _R2D
        return noon + (-t if direction == "ccw" else t)

    def _asr_time(self, time: float, jdn: float) -> float:
        decl, _ = _sun_position(jdn + time)
        angle = -math.atan(1.0 / (self.asr_factor + math.tan(abs(self.lat - decl) * _D2R))) * _R2D
        # عصر همیشه بعدازظهر است: noon + t
        return self._sun_angle_time(angle, time, jdn, "cw")

    def _times_frac(self, day: date) -> dict[str, float]:
        """زمان‌ها به‌صورت کسری از روز — تکرار دوم با تبدیل درست واحد انجام می‌شود."""
        jdn = _julian(day.year, day.month, day.day) - self.lng / 360.0
        p = self.params
        # حدس‌های اولیه (کسری از روز)
        t = {
            "fajr": 5 / 24,
            "sunrise": 6 / 24,
            "dhuhr": 12 / 24,
            "asr": 13 / 24,
            "sunset": 18 / 24,
            "maghrib": 18 / 24,
            "isha": 18 / 24,
        }
        for _ in range(2):  # دو تکرار برای همگرایی — ورودی/خروجی همیشه کسر روز
            n = {}
            # قرارداد PrayTimes: زاویهٔ خام؛ صبح‌ها ccw (noon − t)، عصرها cw (noon + t)
            n["fajr"] = self._sun_angle_time(p["fajr"], t["fajr"], jdn, "ccw") / 24.0
            n["sunrise"] = self._sun_angle_time(0.833, t["sunrise"], jdn, "ccw") / 24.0
            n["dhuhr"] = self._mid_day(t["dhuhr"], jdn) / 24.0
            n["asr"] = self._asr_time(t["asr"], jdn) / 24.0
            n["sunset"] = self._sun_angle_time(0.833, t["sunset"], jdn, "cw") / 24.0
            if "maghrib" in p:  # فقط jafari
                n["maghrib"] = self._sun_angle_time(
                    p["maghrib"], t["maghrib"], jdn, "cw"
                ) / 24.0
            else:
                n["maghrib"] = n["sunset"]
            if "isha_minutes" in p:  # umm al-qura
                n["isha"] = n["maghrib"] + (p["isha_minutes"] / 60.0) / 24.0
            else:
                n["isha"] = self._sun_angle_time(p["isha"], t["isha"], jdn, "cw") / 24.0
            t = n
        return t

    def compute(self, day: date) -> dict[str, float]:
        t = {k: v * 24.0 for k, v in self._times_frac(day).items()}
        # تطبیق با منطقهٔ زمانی: tz − lng/15
        offset = self.tz - self.lng / 15.0
        for k in t:
            t[k] = _fix_hour(t[k] + offset)
        # midnight استاندارد: میانگین غروب و فجرِ فردا
        fajr_next = _fix_hour(self._times_frac(_next_day(day))["fajr"] * 24.0 + offset)
        end = fajr_next + 24.0 if fajr_next < t["sunset"] else fajr_next
        t["midnight"] = _fix_hour((t["sunset"] + end) / 2.0)
        # امساک: فجر منهای ۱۰ دقیقه (جایگزین زاویه‌ایِ PrayTimes)
        t["imsak"] = _fix_hour(t["fajr"] - _IMSAK_OFFSET_MIN / 60.0)
        return t


def _next_day(d: date) -> date:
    from datetime import timedelta

    return d + timedelta(days=1)


def _fmt(hours: float) -> str:
    """گرد به دقیقهٔ نزدیک — قالب HH:MM (ساعت ۲۴)."""
    total = int(round(_fix_hour(hours) * 60.0)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def prayer_times(
    day: date,
    lat: float,
    lng: float,
    *,
    tz: float = 0.0,
    method: str = "mwl",
    madhab: str = "shafi",
) -> dict[str, str]:
    """اوقات نماز برای یک روز/مختصات — خروجی رشته‌های HH:MM.

    ValueError برای method/madhab نامعتبر (روتر به ۴۲۲ تبدیل می‌کند).
    """
    if method not in METHODS:
        raise ValueError(f"unknown adhan method: {method}")
    if madhab not in MADRABS:
        raise ValueError(f"unknown madhab: {madhab}")
    raw = _Calculator(lat, lng, tz, method, madhab).compute(day)
    order = ["imsak", "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha", "midnight"]
    return {k: _fmt(raw[k]) for k in order}
