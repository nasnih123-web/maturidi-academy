"""داده‌های نسخه‌بندی‌شدهٔ اوقات شرعی: شهرها، جدول تربت جام، تشخیص رمضان.

- شهرها: مختصات مرکز شهر (دقت در حد شهر — قرارداد استاندارد جدول‌های اوقات).
  تربت جام و خواف از فایل iran-cities.js اپ عارفان جام (۳۵٫۲۴۳۰۶/۶۰٫۶۲۵ و
  ۳۴٫۵۷۲۳/۶۰٫۱۴۴)؛ بقیه مختصات رایج مرکز شهرهاست.
- جدول تربت جام: ۳۶۵ ردیف استخراج‌شده از جدول تعبیه‌شده در اپ عارفان جام
  (همان جدولی که طبق کامنت کد آن اپ «از جدول رسمی PDF کاربر» آمده است).
  ستون‌ها: [فجر، طلوع، ظهر شرعی، عصر حنفی، مغرب، عشاء]؛ کلیدها MM-DD جلالی؛
  اسفند ۳۰ ندارد (در سال کبیسه، آن روز به محاسبه برمی‌گردد) و جدول هر سال
  روی همان تاریخ‌های جلالی تکرار می‌شود. به‌روزرسانی فقط با تصمیم صریح
  مالک — هیچ همگام‌سازی خودکاری وجود ندارد.
- تشخیص رمضان: تقویم جدولی اسلامی (الگوریتم کویتی). در مرزهای ماه ممکن است
  تا یک روز با اعلام رسمی ماه اختلاف داشته باشد؛ برای ام‌القری، عشاء در
  رمضان ۱۲۰ دقیقه پس از مغرب است و در غیر آن ۹۰ دقیقه.
"""
from __future__ import annotations

import json
import math
import os
from datetime import date

CITIES: dict[str, dict] = {
    "torbat-e-jam": {"lat": 35.24306, "lng": 60.625},
    "khaf": {"lat": 34.5723, "lng": 60.144},
    "taybad": {"lat": 34.74, "lng": 60.78},
    "mashhad": {"lat": 36.297, "lng": 59.606},
    "zahedan": {"lat": 29.496, "lng": 60.862},
    "gonbad-e-kavus": {"lat": 37.255, "lng": 55.1714},
    "tehran": {"lat": 35.6892, "lng": 51.389},
}

TORBAT_CITY = "torbat-e-jam"
TORBAT_TABLE_METHOD = "council"

_TABLE_PATH = os.path.join(os.path.dirname(__file__), "torbat_jam_table.json")
_table_cache: dict | None = None


def load_torbat_table() -> dict:
    """جدول ۳۶۵روزهٔ تربت جام — اعتبارسنجی ساختار در بارگذاری اول."""
    global _table_cache
    if _table_cache is None:
        with open(_TABLE_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        if len(data) != 365 or "12-30" in data:
            raise ValueError("torbat_jam_table.json must have exactly 365 rows and no 12-30")
        for key, row in data.items():
            if len(key) != 5 or len(row) != 6:
                raise ValueError(f"torbat_jam_table.json: bad row {key}")
            for v in row:
                hh, mm = v.split(":")
                if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
                    raise ValueError(f"torbat_jam_table.json: bad time {v} in {key}")
        _table_cache = data
    return _table_cache


def torbat_row(jalali_mm_dd: str) -> list[str] | None:
    """یک ردیف جدول برای MM-DD جلالی؛ برای ۱۲-۳۰ (که جدول ندارد) None."""
    return load_torbat_table().get(jalali_mm_dd)


# --- تقویم جدولی اسلامی (کویتی) برای تشخیص ماه رمضان ---


def _islamic_to_jd(y: int, m: int, d: int) -> float:
    return (
        d
        + math.ceil(29.5 * (m - 1))
        + (y - 1) * 354
        + math.floor((3 + 11 * y) / 30)
        + 1948439.5
        - 1
    )


def _jd_to_islamic(jd: float) -> tuple[int, int, int]:
    jd = math.floor(jd) + 0.5
    y = math.floor((30 * (jd - 1948439.5) + 10646) / 10631)
    m = min(12, math.ceil((jd - (29 + _islamic_to_jd(y, 1, 1))) / 29.5) + 1)
    d = int(jd - _islamic_to_jd(y, m, 1)) + 1
    return y, m, d


def _gregorian_to_jd(g: date) -> float:
    a = (14 - g.month) // 12
    y = g.year + 4800 - a
    m = g.month + 12 * a - 3
    return (
        g.day
        + ((153 * m + 2) // 5)
        + 365 * y
        + y // 4
        - y // 100
        + y // 400
        - 32045
        - 0.5
    )


def is_ramadan(g: date) -> bool:
    """آیا این تاریخ میلادی در ماه رمضان (تقویم جدولی) است؟"""
    _, m, _ = _jd_to_islamic(_gregorian_to_jd(g))
    return m == 9


def method_options() -> list[dict]:
    """فهرست روش‌ها برای GET /adhan/options — مرجع واحد فرانت و CRM."""
    from . import adhan as adhan_calc

    out = []
    for method_id, p in adhan_calc.METHODS.items():
        out.append(
            {
                "id": method_id,
                "label": p["label"],
                "authority": p.get("authority", ""),
                "fajr": p.get("fajr"),
                "isha": p.get("isha"),
                "maghrib": p.get("maghrib"),
                "isha_minutes": p.get("isha_minutes"),
                "isha_minutes_ramadan": p.get("isha_minutes_ramadan"),
                "available": p.get("available", True),
                "note": p.get("note", ""),
            }
        )
    return out


def city_options() -> list[dict]:
    return [
        {"slug": slug, "lat": c["lat"], "lng": c["lng"]}
        for slug, c in CITIES.items()
    ]
