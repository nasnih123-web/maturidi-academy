"""پارس سبک‌وزن User-Agent برای نمایش در CRM — فاز C.

فقط برای «خلاصهٔ قابل‌خواندن» در داشبورد کاربران: نام مرورگر، سیستم‌عامل و
کلاس دستگاه (موبایل/تبلت/دسکتاپ/بات). هیچ وابستگی خارجی ندارد و هرگز
خطا نمی‌دهد — ورودی ناشناخته → فیلدهای None و دستگاه «unknown».

ترتیب تشخیص مهم است: Edge/Opera/Samsung قبل از Chrome چک می‌شوند چون
UA آن‌ها شامل «Chrome» هم هست؛ Safari واقعی با «Version/…Safari» شناخته
می‌شود چون Chrome هم «Safari» در UA دارد.
"""
from __future__ import annotations

import re

_BOT_MARKERS = (
    "bot", "spider", "crawler", "crawling", "slurp", "bingpreview",
    "facebookexternalhit", "telegrambot", "whatsapp", "python-requests",
    "curl/", "wget/", "go-http-client", "okhttp", "postmanruntime",
    "headlesschrome",
)

_BROWSER_RULES: tuple[tuple[str, str], ...] = (
    # (الگوی regex روی UA، نام نمایشی) — ترتیب = اولویت
    (r"Edg(?:A|iOS)?/", "Edge"),
    (r"OPR/|Opera", "Opera"),
    (r"SamsungBrowser/", "Samsung Internet"),
    (r"YaBrowser/", "Yandex Browser"),
    (r"Vivaldi/", "Vivaldi"),
    (r"FxiOS/|Firefox/", "Firefox"),
    (r"CriOS/|Chrome/", "Chrome"),
    (r"Version/[\d.]+.*Safari/", "Safari"),
    (r"MSIE |Trident/", "Internet Explorer"),
)

_OS_RULES: tuple[tuple[str, str], ...] = (
    (r"Windows NT", "Windows"),
    (r"Android", "Android"),
    (r"iPhone|iPad|iPod", "iOS"),
    (r"CrOS", "ChromeOS"),
    (r"Mac OS X|Macintosh", "macOS"),
    (r"Linux", "Linux"),
)

_VERSION_AFTER = {
    "Chrome": r"(?:CriOS|Chrome)/([\d.]+)",
    "Edge": r"Edg(?:A|iOS)?/([\d.]+)",
    "Firefox": r"(?:FxiOS|Firefox)/([\d.]+)",
    "Safari": r"Version/([\d.]+)",
    "Opera": r"(?:OPR|Opera)/([\d.]+)",
    "Samsung Internet": r"SamsungBrowser/([\d.]+)",
}


def _major(version: str | None) -> str | None:
    if not version:
        return None
    return version.split(".", 1)[0] or None


def parse_user_agent(ua: str | None) -> dict:
    """خلاصهٔ UA: {browser, browser_major, os, device, summary}.

    device یکی از: mobile | tablet | desktop | bot | unknown.
    summary رشتهٔ آمادهٔ نمایش مثل «Chrome 120 · Android · موبایل» نیست —
    قطعه‌ها با « · » به هم می‌چسبند و کلاینت (CRM) برچسب دستگاه را
    خودش محلی‌سازی می‌کند؛ این‌جا فقط نام‌های لاتین مرورگر/OS می‌آید.
    """
    empty = {
        "browser": None,
        "browser_major": None,
        "os": None,
        "device": "unknown",
        "summary": None,
    }
    if not ua or not ua.strip():
        return empty
    text = ua.strip()
    low = text.lower()

    is_bot = any(marker in low for marker in _BOT_MARKERS)

    browser = None
    browser_major = None
    for pattern, name in _BROWSER_RULES:
        if re.search(pattern, text):
            browser = name
            version_re = _VERSION_AFTER.get(name)
            if version_re:
                m = re.search(version_re, text)
                browser_major = _major(m.group(1)) if m else None
            break

    os_name = None
    for pattern, name in _OS_RULES:
        if re.search(pattern, text):
            os_name = name
            break

    if is_bot:
        device = "bot"
    elif "ipad" in low or "tablet" in low or (
        "android" in low and "mobile" not in low
    ):
        device = "tablet"
    elif "mobile" in low or "iphone" in low or "ipod" in low or "android" in low:
        device = "mobile"
    elif os_name is not None or browser is not None:
        device = "desktop"
    else:
        device = "unknown"

    parts: list[str] = []
    if browser:
        parts.append(browser + (f" {browser_major}" if browser_major else ""))
    if os_name:
        parts.append(os_name)
    summary = " · ".join(parts) if parts else None

    return {
        "browser": browser,
        "browser_major": browser_major,
        "os": os_name,
        "device": device,
        "summary": summary,
    }
