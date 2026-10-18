"""انتزاع تبدیل تاریخ هجری — قرارداد §۱.

**قانون:** تاریخ هجری هرگز به‌صورت پراکنده در کد محاسبه نمی‌شود؛ همهٔ
تبدیل‌ها از همین لایه عبور می‌کنند. پیاده‌سازی فعلی روی بستهٔ نگهداری‌شدهٔ
`hijri-converter` (الگوریتم تقویم ام‌القری) سوار است؛ تعویض provider فقط
همین فایل را لمس می‌کند.

برای تست‌پذیری، «امروز» همیشه قابل تزریق است (پارامتر today).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from hijri_converter import Gregorian as _Gregorian

__all__ = [
    "gregorian_to_hijri",
    "hijri_month_day",
    "utc_today",
]


def gregorian_to_hijri(day: date) -> tuple[int, int, int]:
    """تبدیل یک تاریخ میلادی به (سال، ماه، روز) هجری قمری."""
    h = _Gregorian(day.year, day.month, day.day).to_hijri()
    return h.year, h.month, h.day


def hijri_month_day(day: date | None = None) -> tuple[int, int]:
    """(ماه، روز) هجری قمری برای یک تاریخ میلادی — پیش‌فرض: امروزِ UTC."""
    day = day or utc_today()
    _, month, hday = gregorian_to_hijri(day)
    return month, hday


def utc_today() -> date:
    """امروزِ UTC — نقطهٔ واحد «امروز» برای منطق سمت سرور."""
    return datetime.now(timezone.utc).date()
