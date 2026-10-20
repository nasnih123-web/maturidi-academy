"""طبقه‌بندی قصد صوتی + استخراج ارجاع آیه — فاز ۱۲.

قطعی و داده‌محور است (بدون LLM): الگوها در dictهای ماژول نگه‌داری می‌شوند
تا بدون تغییر کد قابل گسترش باشند. ترتیب اولویت: quran، سپس fatwa،
در غیر این صورت general.
"""
from __future__ import annotations

import re
import unicodedata

QURAN = "quran"
FATWA = "fatwa"
GENERAL = "general"
INTENTS = (QURAN, FATWA, GENERAL)

SUPPORTED_LANGS = ("fa", "ar")

# ---------------------------------------------------------------------------
# تشخیص زبان — هیوریستیک دامنهٔ اسکریپت + واژه‌های نشانگر
# ---------------------------------------------------------------------------

_FA_CHARS = "گچپژ"  # فقط فارسی
_AR_CHARS = "ةك"  # ك = U+0643 (عربی) در برابر ک = U+06A9 (فارسی)
_FA_YEH = "ی"  # U+06CC
_AR_YEH = "ي"  # U+064A
_FA_KAF = "ک"  # U+06A9

_FA_MARKERS = (
    "است", "این", "آن", "چیست", "چگونه", "چطور", "چرا", "بخوان", "بگو",
    "درباره", "دربارهٔ", "برای", "آیا", "جایز", "حکم", "نماز", "روزه",
    "می‌شود", "میشود", "نمی", "ها", "های", "تر", "ترین",
)
_AR_MARKERS = (
    "هل", "يجوز", "حكم", "الحكم", "اقرأ", "اقرا", "آية", "آيه", "سورة",
    "سوره", "عن", "من", "في", "الذي", "التي", "كيف", "لماذا", "ما هو",
)


def detect_language(text: str) -> str:
    """«fa» | «ar» | «unknown» — فقط همین دو زبان پشتیبانی می‌شوند."""
    if not text or not text.strip():
        return "unknown"
    fa_score = 0
    ar_score = 0
    for ch in text:
        if ch in _FA_CHARS:
            fa_score += 3
        elif ch in _AR_CHARS:
            ar_score += 2
        elif ch == _FA_YEH:
            fa_score += 1
        elif ch == _AR_YEH:
            ar_score += 1
        elif ch == _FA_KAF:
            fa_score += 1
    lowered = f" {text} "
    for w in _FA_MARKERS:
        if w in lowered:
            fa_score += 2
    for w in _AR_MARKERS:
        if w in lowered:
            ar_score += 2
    if fa_score == 0 and ar_score == 0:
        return "unknown"
    return "fa" if fa_score >= ar_score else "ar"


# ---------------------------------------------------------------------------
# الگوهای قصد — داده‌محور
# ---------------------------------------------------------------------------

INTENT_PATTERNS: dict[str, list[str]] = {
    QURAN: [
        r"آی[هة]\s*(الکرسی|الكرسي)",
        r"(بخوان|بگو|بیاور|نشان\s*بده|پخش\s*کن).{0,20}آی[هة]",
        r"آی[هة].{0,30}(بخوان|بگو|بیاور|بخوانید|بگویید)",
        r"تلاوت",
        r"(بخوان|پخش\s*کن).{0,20}سور[هة]",
        r"سور[هة].{0,30}(بخوان|بخوانید)",
        r"قرآن.{0,20}(بخوان|اقرأ)",
        r"(اقرأ|اِقرأ).{0,20}(آي[ةه]|سور[ةه])",
        r"(آي[ةه]|سور[ةه]).{0,30}(اقرأ|اِقرأ)",
        r"آي[ةه]\s*الكرسي",
        r"تلاو[ةه]",
        r"\d+\s*[:/]\s*\d+",  # ارجاع صریح مثل 2:153
    ],
    FATWA: [
        r"آیا.{0,40}(جایز|حرام|حلال|واجب|مستحب|مکروه|صحیح|باطل)",
        r"حکم.{0,40}چیست",
        r"(جایز|حرام|حلال|واجب)\s*(است|هست|می‌شود|میشود)",
        r"هل.{0,40}(يجوز|حرام|حلال|واجب|مستحب|مكروه|صحيح|باطل)",
        r"ما\s+حكم",
        r"فتوا",
        r"فقه",
    ],
}

_COMPILED: dict[str, list[re.Pattern]] = {
    intent: [re.compile(p) for p in patterns]
    for intent, patterns in INTENT_PATTERNS.items()
}


# کلاس حروف عربی/فارسی برای مرز واژه (شامل گچپژ، ی/ک فارسی)
_ARABIC_LETTER = r"[\u0621-\u064a\u066e-\u06d3]"


def _word_boundary_name(name: str) -> re.Pattern[str]:
    return re.compile(
        rf"(?<!{_ARABIC_LETTER}){re.escape(name)}(?!{_ARABIC_LETTER})"
    )


def _mentions_surah(text: str) -> bool:
    """نام سوره (عربی/فارسی، نرمال‌شده) در متن آمده باشد."""
    norm = _normalize_ar(text)
    for name in _get_surah_map():
        if len(name) < 2:
            continue
        if _word_boundary_name(name).search(norm):
            return True
    return False


def classify_intent(text: str) -> str:
    """قصد متن رونویسی‌شده: quran | fatwa | general.

    ترتیب: عمل قرآنی صریح → الگوی فقهی → نام سوره → general.
    """
    for rx in _COMPILED[QURAN]:
        if rx.search(text):
            return QURAN
    for rx in _COMPILED[FATWA]:
        if rx.search(text):
            return FATWA
    if _mentions_surah(text):
        return QURAN
    return GENERAL


# ---------------------------------------------------------------------------
# نرمال‌سازی متن عربی/فارسی برای تطبیق نام سوره و ارجاع
# ---------------------------------------------------------------------------

_FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_ASCII_DIGITS = "0123456789"
_DIGIT_MAP = {ord(f): _ASCII_DIGITS[i] for i, f in enumerate(_FA_DIGITS)}
_DIGIT_MAP.update({ord(a): _ASCII_DIGITS[i] for i, a in enumerate(_AR_DIGITS)})

_TASHKEEL = re.compile(r"[\u064b-\u0652\u0670\u0640]")


def _normalize_ar(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _TASHKEEL.sub("", text)
    text = text.translate(_DIGIT_MAP)
    text = (
        text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
        .replace("ة", "ه").replace("ى", "ی").replace("ي", "ی")
        .replace("ك", "ک").replace("ؤ", "و").replace("ئ", "ی")
    )
    return text


# نام‌های رایج فارسی سوره‌ها → شماره (دادهٔ مرجع، نه محتوای فقهی)
SURAH_FA_NAMES: dict[str, int] = {
    "فاتحه": 1, "بقره": 2, "آل عمران": 3, "نساء": 4, "مائده": 5,
    "انعام": 6, "اعراف": 7, "انفال": 8, "توبه": 9, "یونس": 10,
    "هود": 11, "یوسف": 12, "رعد": 13, "ابراهیم": 14, "حجر": 15,
    "نحل": 16, "اسراء": 17, "کهف": 18, "مریم": 19, "طه": 20,
    "انبیاء": 21, "حج": 22, "مؤمنون": 23, "نور": 24, "فرقان": 25,
    "شعراء": 26, "نمل": 27, "قصص": 28, "عنکبوت": 29, "روم": 30,
    "لقمان": 31, "سجده": 32, "احزاب": 33, "سبا": 34, "فاطر": 35,
    "یس": 36, "صافات": 37, "ص": 38, "زمر": 39, "غافر": 40,
    "فصلت": 41, "شوری": 42, "زخرف": 43, "دخان": 44, "جاثیه": 45,
    "احقاف": 46, "محمد": 47, "فتح": 48, "حجرات": 49, "ق": 50,
    "ذاریات": 51, "طور": 52, "نجم": 53, "قمر": 54, "رحمن": 55,
    "واقعه": 56, "حدید": 57, "مجادله": 58, "حشر": 59, "ممتحنه": 60,
    "صف": 61, "جمعه": 62, "منافقون": 63, "تغابن": 64, "طلاق": 65,
    "تحریم": 66, "ملک": 67, "قلم": 68, "حاقه": 69, "معارج": 70,
    "نوح": 71, "جن": 72, "مزمل": 73, "مدثر": 74, "قیامت": 75,
    "انسان": 76, "مرسلات": 77, "نبا": 78, "نازعات": 79, "عبس": 80,
    "تکویر": 81, "انفطار": 82, "مطففین": 83, "انشقاق": 84, "بروج": 85,
    "طارق": 86, "اعلی": 87, "غاشیه": 88, "فجر": 89, "بلد": 90,
    "شمس": 91, "لیل": 92, "ضحی": 93, "شرح": 94, "تین": 95,
    "علق": 96, "قدر": 97, "بینه": 98, "زلزله": 99, "عادیات": 100,
    "قارعه": 101, "تکاثر": 102, "عصر": 103, "همزه": 104, "فیل": 105,
    "قریش": 106, "ماعون": 107, "کوثر": 108, "کافرون": 109, "نصر": 110,
    "مسد": 111, "اخلاص": 112, "فلق": 113, "ناس": 114,
}


def _surah_name_map() -> dict[str, int]:
    """نام عربی (از surahs.py فاز ۵) + نام فارسی → شماره."""
    from app.modules.quran.surahs import SURAHS

    mapping: dict[str, int] = {}
    for s in SURAHS:
        mapping[_normalize_ar(s.name_ar)] = s.number
        # بدون «ال» ابتدایی هم قابل تطبیق باشد
        no_al = re.sub(r"^ال", "", _normalize_ar(s.name_ar))
        mapping.setdefault(no_al, s.number)
    for fa_name, num in SURAH_FA_NAMES.items():
        mapping.setdefault(_normalize_ar(fa_name), num)
    return mapping


_SURAH_MAP: dict[str, int] | None = None


def _get_surah_map() -> dict[str, int]:
    global _SURAH_MAP
    if _SURAH_MAP is None:
        _SURAH_MAP = _surah_name_map()
    return _SURAH_MAP


# نگاشت موضوع → آیهٔ مشهور (شاخص ارجاع قطعی؛ متن آیه همیشه از provider فاز ۵)
TOPIC_AYAH: dict[str, tuple[int, int]] = {
    "صبر": (2, 153), "الصبر": (2, 153),
    "شکر": (14, 7), "الشکر": (14, 7),
    "توکل": (65, 3), "التوکل": (65, 3),
    "دعا": (40, 60), "الدعاء": (40, 60),
    "رحمت": (39, 53), "الرحمه": (39, 53), "الرحمة": (39, 53),
    "والدین": (17, 23), "الوالدین": (17, 23), "پدر و مادر": (17, 23),
    "علم": (20, 114), "العلم": (20, 114),
    "عدالت": (16, 90), "العدل": (16, 90),
    "یتیم": (93, 9), "الیتیم": (93, 9),
    "نماز": (29, 45), "الصلاه": (29, 45), "الصلاة": (29, 45),
    "روزه": (2, 183), "الصوم": (2, 183), "الصیام": (2, 183),
    "کرسی": (2, 255), "الکرسی": (2, 255),
    "نور": (24, 35), "النور": (24, 35),
}
_TOPIC_NORM: dict[str, tuple[int, int]] | None = None


def _get_topic_map() -> dict[str, tuple[int, int]]:
    global _TOPIC_NORM
    if _TOPIC_NORM is None:
        _TOPIC_NORM = {_normalize_ar(k): v for k, v in TOPIC_AYAH.items()}
    return _TOPIC_NORM


def extract_ayah_reference(text: str) -> tuple[int, int] | None:
    """ارجاع (سوره، آیه) از متن؛ None یعنی قابل‌حل نیست.

    ترتیب: ارجاع عددی صریح (2:153) → «سوره X آیه Y» → نام سوره به‌تنهایی
    (آیهٔ اول) → کلیدواژهٔ موضوعی.
    """
    norm = _normalize_ar(text)
    surah_map = _get_surah_map()

    m = re.search(r"(\d{1,3})\s*[:/]\s*(\d{1,3})", norm)
    if m:
        return int(m.group(1)), int(m.group(2))

    ayah_num: int | None = None
    # توجه: norm نرمال‌شده است (آ→ا، ة→ه) پس الگوها هم نرمال نوشته می‌شوند
    m = re.search(r"(?:ایه|الایه)\s*(\d{1,3})", norm)
    if m:
        ayah_num = int(m.group(1))

    surah_num: int | None = None
    surah_name_hit: str | None = None
    m = re.search(r"(?:سوره|السوره)\s*(\d{1,3})", norm)
    if m:
        surah_num = int(m.group(1))
    else:
        # بلندترین نامِ تطبیق‌خورده تا «نور» داخل «النور»... درست حل شود
        best: tuple[int, int, str] | None = None  # (طول نام، شماره، نام)
        for name, num in surah_map.items():
            if len(name) < 2:
                continue
            if _word_boundary_name(name).search(norm):
                if best is None or len(name) > best[0]:
                    best = (len(name), num, name)
        if best is not None:
            surah_num = best[1]
            surah_name_hit = best[2]

    if surah_num is not None:
        if ayah_num is None and surah_name_hit:
            # «بقره ۱۵۳»: عددِ بعد از نام سوره = شمارهٔ آیه
            m2 = re.search(
                rf"{re.escape(surah_name_hit)}\s*(\d{{1,3}})", norm
            )
            if m2:
                ayah_num = int(m2.group(1))
        return surah_num, ayah_num if ayah_num is not None else 1

    topic_map = _get_topic_map()
    best_topic: tuple[int, tuple[int, int]] | None = None
    for keyword, ref in topic_map.items():
        if keyword in norm:
            if best_topic is None or len(keyword) > best_topic[0]:
                best_topic = (len(keyword), ref)
    if best_topic is not None:
        return best_topic[1]
    return None
