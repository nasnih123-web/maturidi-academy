"""متشابهات (عبارات مشترک) — فاز ۱۰ قرآن.

عبارات مشترک **از متن تنزیل خودمان محاسبه می‌شوند** (CC BY 3.0؛
نیازی به دانلود QUL با مجوز نامشخص نیست). هیچ فهرست phraseای
hard-code نشده است: همهٔ n-gramهای کلمه‌ای (۴ تا ۸ کلمه) با دست‌کم
۲ رخداد در کل قرآن استخراج و گروه‌بندی می‌شوند.

- نرمال‌سازی: حذف تشکیله + یکسان‌سازی الف/ی/ک (همان
  `hifz_voice_search.normalize_arabic`) تا «ٱلْحَمْدُ» و «الحمد»
  یک عبارت شمرده شوند؛ متن نمایشیِ هر رخداد، متن اصلیِ تنزیل است.
- هر گروه: {phrase (نرمال‌شده)، occurrences: [{surah, ayah, text}]}.
- محاسبه یک‌بار در هر فرایند و در حافظه کش می‌شود (داده ثابت است)؛
  کلید کش، mtime فایل تنزیل است تا تغییر فایل، کشِ کهنه ندهد.
- رنگ گروه‌ها سمت کلاینت است (هر گروه یک رنگ مجزا از پالت چرخشی
  می‌گیرد) و خاموش‌کردنِ نمایش، همان‌جا انجام می‌شود — سرور فقط
  داده می‌دهد.
"""

from __future__ import annotations

from pathlib import Path

from .hifz_voice_search import _ARABIC_LETTERS, normalize_arabic

_TANZIL_PATH = Path(__file__).resolve().parent / "data" / "tanzil_uthmani.txt"

MIN_PHRASE_WORDS = 4
MAX_PHRASE_WORDS = 8
MIN_OCCURRENCES = 2

_CACHE: dict | None = None


def _load_ayahs() -> list[tuple[int, int, list[str], str]]:
    ayahs = []
    for line in _TANZIL_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        raw_words = [w for w in parts[2].split() if w]
        words = [normalize_arabic(w) for w in raw_words]
        words = [w for w in words if _ARABIC_LETTERS.sub("", w)]
        if words:
            ayahs.append((int(parts[0]), int(parts[1]), words, parts[2]))
    return ayahs


def compute_mutashabihat(
    ayahs: list[tuple[int, int, list[str], str]] | None = None,
) -> dict:
    """محاسبهٔ کامل گروه‌های عبارت مشترک (خالص، تست‌پذیر).

    برمی‌گرداند: {phrase_count, groups: [{phrase, occurrences}]}
    که occurrences فهرست {surah, ayah, text} است. گروه‌ها بر اساس
    تعداد رخداد (نزولی) و بعد عبارت مرتب‌اند. عبارتِ بلندتر که
    زیرمجموعهٔ عبارتِ بلندتری با همان رخدادهاست حذف نمی‌شود —
    هر دو گزارش می‌شوند (کاربر هر دو را می‌بیند)؛ این تصمیم مستند
    است، نه فراموشی.
    """
    global _CACHE
    if ayahs is None:
        mtime = _TANZIL_PATH.stat().st_mtime
        if _CACHE is not None and _CACHE.get("mtime") == mtime:
            return _CACHE["result"]
        ayahs = _load_ayahs()
    else:
        mtime = None
    index: dict[str, list[dict]] = {}
    for surah, ayah, words, text in ayahs:
        seen_in_ayah: set[str] = set()
        for n in range(MIN_PHRASE_WORDS, MAX_PHRASE_WORDS + 1):
            for start in range(len(words) - n + 1):
                phrase = " ".join(words[start : start + n])
                if phrase in seen_in_ayah:
                    continue
                seen_in_ayah.add(phrase)
                index.setdefault(phrase, []).append(
                    {"surah": surah, "ayah": ayah, "text": text}
                )
    groups = [
        {"phrase": phrase, "occurrences": occ}
        for phrase, occ in index.items()
        if len(occ) >= MIN_OCCURRENCES
    ]
    groups.sort(key=lambda g: (-len(g["occurrences"]), g["phrase"]))
    result = {"phrase_count": len(groups), "groups": groups}
    if mtime is not None:
        _CACHE = {"mtime": mtime, "result": result}
    return result


def mutashabihat_for_ayah(surah: int, ayah: int) -> list[dict]:
    """گروه‌هایی که این آیه در آن‌ها رخداد دارد (برای نمایش روی آیه)."""
    computed = compute_mutashabihat()
    out = []
    for group in computed["groups"]:
        if any(
            occ["surah"] == surah and occ["ayah"] == ayah
            for occ in group["occurrences"]
        ):
            out.append(group)
    return out


def mutashabihat_for_phrase(phrase: str) -> dict | None:
    """یک گروه بر اساس عبارت نرمال‌شده (برای ناوبری به آیه‌های دیگر)."""
    computed = compute_mutashabihat()
    needle = normalize_arabic(phrase)
    needle = " ".join(needle.split())
    for group in computed["groups"]:
        if group["phrase"] == needle:
            return group
    return None
