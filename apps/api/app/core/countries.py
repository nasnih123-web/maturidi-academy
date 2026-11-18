"""جدول کشورهای شماره تلفن — آینهٔ سمت‌سرورِ apps/web/lib/countries.ts.

همان مجموعه و همان ترتیب وب (فاز A): کد ISO 3166-1 alpha-2 ← پیش‌شمارهٔ
تماس. مصرف‌کنندهٔ فعلی: اعتبارسنجی country_code پروفایل و استخراج کشور
از شمارهٔ تأییدشده (فاز B). اگر کشور تازه‌ای به وب اضافه شد، این‌جا هم
باید اضافه شود — دو جدول باید هم‌گام بمانند.
"""
from __future__ import annotations

# (iso, dial) — ترتیب دقیقاً مثل COUNTRIES در وب است؛ در تطبیق
# طولانی‌ترین پیش‌شماره، اولین برنده می‌ماند (مثل منطق وب).
COUNTRY_DIAL_CODES: tuple[tuple[str, str], ...] = (
    ("IR", "98"),
    ("AF", "93"),
    ("IQ", "964"),
    ("TR", "90"),
    ("AE", "971"),
    ("SA", "966"),
    ("QA", "974"),
    ("KW", "965"),
    ("OM", "968"),
    ("BH", "973"),
    ("PK", "92"),
    ("IN", "91"),
    ("BD", "880"),
    ("TJ", "992"),
    ("UZ", "998"),
    ("TM", "993"),
    ("AZ", "994"),
    ("ID", "62"),
    ("MY", "60"),
    ("EG", "20"),
    ("SY", "963"),
    ("LB", "961"),
    ("JO", "962"),
    ("YE", "967"),
    ("MA", "212"),
    ("DZ", "213"),
    ("TN", "216"),
    ("NG", "234"),
    ("GB", "44"),
    ("DE", "49"),
    ("FR", "33"),
    ("NL", "31"),
    ("SE", "46"),
    ("RU", "7"),
    ("CN", "86"),
    ("AU", "61"),
    ("CA", "1"),
    ("US", "1"),
)

COUNTRY_CODES: frozenset[str] = frozenset(iso for iso, _ in COUNTRY_DIAL_CODES)


def is_valid_country_code(code: str) -> bool:
    """عضویت در همان مجموعهٔ وب (حروف بزرگ ISO alpha-2)."""
    return code in COUNTRY_CODES


def country_iso_from_phone(phone: str | None) -> str | None:
    """کشور شمارهٔ E.164 با طولانی‌ترین تطبیق پیش‌شماره — آینهٔ منطق وب.

    در ابهام هم‌طول (CA و US هر دو «1») اولینِ جدول برنده است، دقیقاً
    مثل countryIsoFromPhone در lib/profile-client.ts.
    """
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    best_iso: str | None = None
    best_len = 0
    for iso, dial in COUNTRY_DIAL_CODES:
        if digits.startswith(dial) and len(dial) > best_len:
            best_iso = iso
            best_len = len(dial)
    return best_iso
