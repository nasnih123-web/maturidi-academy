"""موتور صرف افعال عربی (مُصَرِّف) — بازپیاده‌سازی مستقل از منطق منبع.

منبع: mosaref.html از dl.ghadimyol.ir (منسوب به مهران ساعدی) —
SHA-256 b9966089015b3df6f1ca17f80c01fb411fb2a94298790f790f7df70c3e721c91
این ماژول «زبان‌شناسی» است، نه فقه؛ خروجی آن عمومی است و مشمول گیت
بازبینی عالم نمی‌شود. هیچ متن توضیحی و هیچ کدی از منبع کپی نشده؛
قواعد صرفی کلاسیک (که خودِ منبع هم بر همان‌ها بنا شده) با کد اصیل
بازپیاده‌سازی شده‌اند و تطابق خروجی با تست‌های طلاییِ گرفته‌شده از
اجرای خود منبع اثبات می‌شود (tests/fixtures/mosaref_golden.json).

خروجی ساخت‌یافته است: فهرستی از جدول‌ها؛ هر جدول کلید ماشینی و
ستون‌هایی از ۱۴ صیغه (یا ۳/۶ صیغه برای اسم‌های مشتق تک‌ستونی) دارد.
ترتیب جدول‌ها و ستون‌ها دقیقاً همان ترتیب صفحهٔ مرجع است.
مصدر در منبع وجود ندارد؛ اینجا هم ساخته نمی‌شود (مستند در
docs/calculators/CALCULATORS_INTEGRATION.md).
"""
from __future__ import annotations

import re

from .engine import CalculatorError

FATHA = "\u064e"
DAMMA = "\u064f"
KASRA = "\u0650"
SUKOON = "\u0652"
SHADDA = "\u0651"
HARAKAT = {FATHA, DAMMA, KASRA, SUKOON, SHADDA}

WEAK = ["ا", "و", "ي", "ى", "ی"]
HAMZA_SEATS = ["ء", "أ", "إ", "ؤ", "ئ", "آ"]

MUJARRAD_BABS = ["faala", "faala2", "faala3", "faala4", "faala5", "faala6"]
MUJARRAD_AIN = {
    "faala": (FATHA, DAMMA), "faala2": (FATHA, KASRA),
    "faala3": (FATHA, FATHA), "faala4": (KASRA, FATHA),
    "faala5": (DAMMA, DAMMA), "faala6": (KASRA, KASRA),
}
KNOWN_BABS = MUJARRAD_BABS + [
    "afala", "faala_m", "faaala", "tafa''ala", "tafaaala", "infaala",
    "iftaala", "istafala", "rubaai_mujarrad", "rubaai_tafa'lala",
]
RARE_BABS = ["if'alla", "if'aalla", "if'aw'ala", "if'awwala",
             "rubaai_if'anlala", "rubaai_if'allalla"]
INHERENTLY_LAZIM_BABS = {"faala5", "infaala", "rubaai_tafa'lala"}

AMR_NAHI_ORDER = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 12, 13]


class MosarefError(CalculatorError):
    """خطای صرف با کد ماشینی (همان دسته‌بندی خطاهای منبع)."""

    def __init__(self, code: str) -> None:
        super().__init__(code, f"خطای صرف فعل ({code})")
        self.code = code


def _is_pure_weak(ch: str) -> bool:
    return ch in WEAK


def _is_hamza_seat(ch: str) -> bool:
    return ch in HAMZA_SEATS


# ---------------------------------------------------------------- همزه ---
def _hamza_seat_for(own_mark: str, prev_char: str, prev_mark: str) -> str:
    if prev_char in ("ا", "و", "ي") and prev_mark == "":
        if own_mark == KASRA:
            return "ئ"
        if own_mark == DAMMA:
            return "ؤ"
        return "ء"
    strength = {KASRA: 3, DAMMA: 2, FATHA: 1, "": 0}
    winner = own_mark if strength.get(own_mark, 0) >= strength.get(
        prev_mark, 0) else prev_mark
    if winner == KASRA:
        return "ئ"
    if winner == DAMMA:
        return "ؤ"
    if winner == FATHA:
        return "أ"
    return "ء"


def _fix_hamza(text: str, hamza_is_final: bool) -> str:
    chars = list(text)
    for i, ch in enumerate(chars):
        if ch != "ء":
            continue
        if i == 0:
            own = chars[1] if len(chars) > 1 and chars[1] in HARAKAT \
                and chars[1] != SHADDA else ""
            chars[i] = "إ" if own == KASRA else "أ"
            continue
        prev_char, prev_mark = "", ""
        if chars[i - 1] in HARAKAT:
            prev_mark = "" if chars[i - 1] == SHADDA else chars[i - 1]
            prev_char = chars[i - 2] if i >= 2 else ""
        else:
            prev_char = chars[i - 1]
        if hamza_is_final:
            own = ""
        else:
            own = chars[i + 1] if i + 1 < len(chars) \
                and chars[i + 1] in HARAKAT and chars[i + 1] != SHADDA else ""
        chars[i] = _hamza_seat_for(own, prev_char, prev_mark)
    return "".join(chars)


# ------------------------------------------------------- موتورهای عمومی ---
def _conjugate_past(stem: str) -> list[str]:
    bare = stem[:-1]
    return [
        stem, stem + "ا", bare + "ُوا", stem + "تْ", stem + "تَا",
        bare + "ْنَ", bare + "ْتَ", bare + "ْتُمَا", bare + "ْتُمْ",
        bare + "ْتِ", bare + "ْتُمَا", bare + "ْتُنَّ", bare + "ْتُ",
        bare + "ْنَا",
    ]


def _conjugate_present_marfoo(prefix_vowel: str, rest: str) -> list[str]:
    bare = rest[:-1]
    p = prefix_vowel
    return [
        "ي" + p + rest, "ي" + p + bare + "َانِ", "ي" + p + bare + "ُونَ",
        "ت" + p + rest, "ت" + p + bare + "َانِ", "ي" + p + bare + "ْنَ",
        "ت" + p + rest, "ت" + p + bare + "َانِ", "ت" + p + bare + "ُونَ",
        "ت" + p + bare + "ِينَ", "ت" + p + bare + "َانِ",
        "ت" + p + bare + "ْنَ", "أ" + p + rest, "ن" + p + rest,
    ]


def _conjugate_jussive(prefix_vowel: str, rest: str) -> list[str]:
    bare = rest[:-1]
    p = prefix_vowel
    return [
        "ي" + p + bare + "ْ", "ي" + p + bare + "َا", "ي" + p + bare + "ُوا",
        "ت" + p + bare + "ْ", "ت" + p + bare + "َا", "ي" + p + bare + "ْنَ",
        "ت" + p + bare + "ْ", "ت" + p + bare + "َا", "ت" + p + bare + "ُوا",
        "ت" + p + bare + "ِي", "ت" + p + bare + "َا",
        "ت" + p + bare + "ْنَ", "أ" + p + bare + "ْ", "ن" + p + bare + "ْ",
    ]


def _noun_forms(base: str) -> list[str]:
    ext = base[:-1] + "ي" if base[-1:] == "ى" else base
    return [base, ext + "َانِ", ext + "ُونَ", ext + "َة", ext + "َتَانِ",
            ext + "َات", "", "", "", "", "", "", "", ""]


def _naqis_noun_forms(full_base: str) -> list[str]:
    consonant_base = full_base[:-2]
    return [
        consonant_base + "ٍ", full_base + "َانِ", consonant_base + "ُونَ",
        full_base + "َة", full_base + "َتَانِ", full_base + "َات",
        "", "", "", "", "", "", "", "",
    ]


# ------------------------------------------------------------- مضاعف ---
def _mudgham_past(f1: str, f2: str, f1_vowel: str,
                  ain_vowel: str) -> list[str]:
    sh = SHADDA
    m0 = f1 + f1_vowel + f2 + sh + "َ"
    split = f1 + f1_vowel + f2 + ain_vowel + f2
    return [
        m0, m0 + "ا", f1 + f1_vowel + f2 + sh + "ُ" + "وا", m0 + "تْ",
        m0 + "تَا", split + "ْنَ", split + "ْتَ", split + "ْتُمَا",
        split + "ْتُمْ", split + "ْتِ", split + "ْتُمَا",
        split + "ْتُنَّ", split + "ْتُ", split + "ْنَا",
    ]


def _mudgham_marfoo(prefix_vowel: str, f1: str, ain: str,
                    f2: str) -> list[str]:
    sh = SHADDA
    mm = f1 + ain + f2 + sh
    p = prefix_vowel
    sep = f1 + "ْ" + f2 + ain + f2 + "ْنَ"
    return [
        "ي" + p + mm + "ُ", "ي" + p + mm + "َانِ", "ي" + p + mm + "ُونَ",
        "ت" + p + mm + "ُ", "ت" + p + mm + "َانِ", "ي" + p + sep,
        "ت" + p + mm + "ُ", "ت" + p + mm + "َانِ", "ت" + p + mm + "ُونَ",
        "ت" + p + mm + "ِينَ", "ت" + p + mm + "َانِ", "ت" + p + sep,
        "أ" + p + mm + "ُ", "ن" + p + mm + "ُ",
    ]


def _mudgham_jussive(prefix_vowel: str, f1: str, ain: str,
                     f2: str) -> list[str]:
    sh = SHADDA
    mm = f1 + ain + f2 + sh
    p = prefix_vowel
    sep = f1 + "ْ" + f2 + ain + f2 + "ْنَ"
    return [
        "ي" + p + mm + "َ", "ي" + p + mm + "َا", "ي" + p + mm + "ُوا",
        "ت" + p + mm + "َ", "ت" + p + mm + "َا", "ي" + p + sep,
        "ت" + p + mm + "َ", "ت" + p + mm + "َا", "ت" + p + mm + "ُوا",
        "ت" + p + mm + "ِي", "ت" + p + mm + "َا", "ت" + p + sep,
        "أ" + p + mm + "َ", "ن" + p + mm + "َ",
    ]


# -------------------------------------------------------------- اجوف ---
def _build_ajwaf(f1: str, f3: str, past_ain: str, pres_ain: str) -> dict:
    long_active = "و" if pres_ain == "ُ" else ("ي" if pres_ain == "ِ" else "ا")
    past_short = "ُ" if pres_ain == "ُ" else "ِ"
    long_stem = f1 + "َا" + f3 + "َ"
    short_stem = f1 + past_short + f3 + "َ"
    past_active = (_conjugate_past(long_stem)[:5]
                   + _conjugate_past(short_stem)[5:])
    long_stem_p = f1 + "ِ" + "ي" + f3 + "َ"
    short_stem_p = f1 + "ِ" + f3 + "َ"
    past_passive = (_conjugate_past(long_stem_p)[:5]
                    + _conjugate_past(short_stem_p)[5:])

    def pres_pair(prefix_vowel: str, long_letter: str,
                  ain_vowel: str) -> tuple[list, list]:
        def longf(p: str) -> str:
            return p + prefix_vowel + f1 + ain_vowel + long_letter + f3

        def shortf(p: str) -> str:
            return p + prefix_vowel + f1 + ain_vowel + f3

        marfoo = [
            longf("ي") + "ُ", longf("ي") + "َانِ", longf("ي") + "ُونَ",
            longf("ت") + "ُ", longf("ت") + "َانِ", shortf("ي") + "ْنَ",
            longf("ت") + "ُ", longf("ت") + "َانِ", longf("ت") + "ُونَ",
            longf("ت") + "ِينَ", longf("ت") + "َانِ", shortf("ت") + "ْنَ",
            longf("أ") + "ُ", longf("ن") + "ُ",
        ]
        jussive = [
            shortf("ي") + "ْ", longf("ي") + "َا", longf("ي") + "ُوا",
            shortf("ت") + "ْ", longf("ت") + "َا", shortf("ي") + "ْنَ",
            shortf("ت") + "ْ", longf("ت") + "َا", longf("ت") + "ُوا",
            longf("ت") + "ِي", longf("ت") + "َا", shortf("ت") + "ْنَ",
            shortf("أ") + "ْ", shortf("ن") + "ْ",
        ]
        return marfoo, jussive

    pres_a = pres_pair("َ", long_active, pres_ain)
    pres_p = pres_pair("ُ", "ا", "َ")
    return {
        "past_active": past_active, "past_passive": past_passive,
        "pres_active_marfoo": pres_a[0], "pres_active_jussive": pres_a[1],
        "pres_passive_marfoo": pres_p[0], "pres_passive_jussive": pres_p[1],
        "ism_fail": f1 + "َا" + "ئِ" + f3,
        "ism_maful": "مَ" + f1 + ("و" if pres_ain == "ُ" else "ي") + f3,
        "ism_zaman_makan": "مَ" + f1 + "َا" + f3,
    }


def _ajwaf_pres_arrays(long_fn, short_fn) -> tuple[list, list]:
    marfoo = [
        long_fn("ي") + "ُ", long_fn("ي") + "َانِ", long_fn("ي") + "ُونَ",
        long_fn("ت") + "ُ", long_fn("ت") + "َانِ", short_fn("ي") + "ْنَ",
        long_fn("ت") + "ُ", long_fn("ت") + "َانِ", long_fn("ت") + "ُونَ",
        long_fn("ت") + "ِينَ", long_fn("ت") + "َانِ", short_fn("ت") + "ْنَ",
        long_fn("أ") + "ُ", long_fn("ن") + "ُ",
    ]
    jussive = [
        short_fn("ي") + "ْ", long_fn("ي") + "َا", long_fn("ي") + "ُوا",
        short_fn("ت") + "ْ", long_fn("ت") + "َا", short_fn("ي") + "ْنَ",
        short_fn("ت") + "ْ", long_fn("ت") + "َا", long_fn("ت") + "ُوا",
        long_fn("ت") + "ِي", long_fn("ت") + "َا", short_fn("ت") + "ْنَ",
        short_fn("أ") + "ْ", short_fn("ن") + "ْ",
    ]
    return marfoo, jussive


def _build_ajwaf_iv(f1: str, f3: str) -> dict:
    past_active = (_conjugate_past("أَ" + f1 + "َا" + f3 + "َ")[:5]
                   + _conjugate_past("أَ" + f1 + "َ" + f3 + "َ")[5:])
    past_passive = (_conjugate_past("أُ" + f1 + "ِي" + f3 + "َ")[:5]
                    + _conjugate_past("أُ" + f1 + "ِ" + f3 + "َ")[5:])

    def pres(prefix_vowel: str, merge_vowel: str, merge_letter: str):
        return _ajwaf_pres_arrays(
            lambda p: p + prefix_vowel + f1 + merge_vowel + merge_letter + f3,
            lambda p: p + prefix_vowel + f1 + merge_vowel + f3,
        )

    pres_a = pres("ُ", "ِ", "ي")
    pres_p = pres("ُ", "َ", "ا")
    return {
        "past_active": past_active, "past_passive": past_passive,
        "pres_active_marfoo": pres_a[0], "pres_active_jussive": pres_a[1],
        "pres_passive_marfoo": pres_p[0], "pres_passive_jussive": pres_p[1],
        "ism_fail": "مُ" + f1 + "ِي" + f3, "ism_maful": "مُ" + f1 + "َا" + f3,
        "hamza": "أَ", "force_hamza_always": True,
    }


def _build_ajwaf_viii(f1: str, f3: str) -> dict:
    past_active = (_conjugate_past("اِ" + f1 + "ْتَا" + f3 + "َ")[:5]
                   + _conjugate_past("اِ" + f1 + "ْتَ" + f3 + "َ")[5:])
    past_passive = (_conjugate_past("اُ" + f1 + "ْتِي" + f3 + "َ")[:5]
                    + _conjugate_past("اُ" + f1 + "ْتِ" + f3 + "َ")[5:])

    def pres(prefix_vowel: str):
        return _ajwaf_pres_arrays(
            lambda p: p + prefix_vowel + f1 + "ْتَا" + f3,
            lambda p: p + prefix_vowel + f1 + "ْتَ" + f3,
        )

    pres_a = pres("َ")
    pres_p = pres("ُ")
    return {
        "past_active": past_active, "past_passive": past_passive,
        "pres_active_marfoo": pres_a[0], "pres_active_jussive": pres_a[1],
        "pres_passive_marfoo": pres_p[0], "pres_passive_jussive": pres_p[1],
        "ism_fail": "مُ" + f1 + "ْتَا" + f3,
        "ism_maful": "مُ" + f1 + "ْتَا" + f3,
        "hamza": "اِ", "force_hamza_always": False,
    }


def _build_ajwaf_x(f1: str, f3: str) -> dict:
    past_active = (_conjugate_past("اِسْتَ" + f1 + "َا" + f3 + "َ")[:5]
                   + _conjugate_past("اِسْتَ" + f1 + "َ" + f3 + "َ")[5:])
    past_passive = (_conjugate_past("اُسْتُ" + f1 + "ِي" + f3 + "َ")[:5]
                    + _conjugate_past("اُسْتُ" + f1 + "ِ" + f3 + "َ")[5:])

    def pres(prefix_vowel: str, merge_vowel: str, merge_letter: str):
        return _ajwaf_pres_arrays(
            lambda p: p + prefix_vowel + "سْتَ" + f1 + merge_vowel
            + merge_letter + f3,
            lambda p: p + prefix_vowel + "سْتَ" + f1 + merge_vowel + f3,
        )

    pres_a = pres("َ", "ِ", "ي")
    pres_p = pres("ُ", "َ", "ا")
    return {
        "past_active": past_active, "past_passive": past_passive,
        "pres_active_marfoo": pres_a[0], "pres_active_jussive": pres_a[1],
        "pres_passive_marfoo": pres_p[0], "pres_passive_jussive": pres_p[1],
        "ism_fail": "مُسْتَ" + f1 + "ِي" + f3,
        "ism_maful": "مُسْتَ" + f1 + "َا" + f3,
        "custom_hamza": "اِسْتَ",
    }


# ------------------------------------------------------------- ناقص ---
def _build_naqis(f1: str, f2: str, f3: str, pres_ain: str) -> dict:
    def pres_pair(prefix_vowel: str, ain: str) -> tuple[list, list]:
        e_letter = "و" if ain == "ُ" else ("ي" if ain == "ِ" else "ى")
        g_letter = "و" if ain == "ُ" else "ي"

        def bare(p: str) -> str:
            return p + prefix_vowel + f1 + "ْ" + f2

        def m0(p: str) -> str:
            return bare(p) + ain + e_letter

        def m_dual(p: str) -> str:
            return bare(p) + ain + g_letter + "َانِ"

        def m_plural(p: str) -> str:
            return bare(p) + "َ" + "وْنَ" if ain == "َ" \
                else bare(p) + "ُ" + "ونَ"

        def m_fem_pl(p: str) -> str:
            return bare(p) + ain + g_letter + "ْنَ"

        marfoo = [
            m0("ي"), m_dual("ي"), m_plural("ي"), m0("ت"), m_dual("ت"),
            m_fem_pl("ي"),
            m0("ت"), m_dual("ت"), m_plural("ت"),
            "ت" + prefix_vowel + f1 + "ْ" + f2 + "ِينَ",
            m_dual("ت"), m_fem_pl("ت"), m0("أ"), m0("ن"),
        ]

        def j0(p: str) -> str:
            return bare(p) + ain

        def j_dual(p: str) -> str:
            return bare(p) + ain + g_letter + "َا"

        def j_plural(p: str) -> str:
            return bare(p) + "َ" + "وْا" if ain == "َ" \
                else bare(p) + "ُ" + "وا"

        jussive = [
            j0("ي"), j_dual("ي"), j_plural("ي"), j0("ت"), j_dual("ت"),
            m_fem_pl("ي"),
            j0("ت"), j_dual("ت"), j_plural("ت"),
            "ت" + prefix_vowel + f1 + "ْ" + f2 + "ِي",
            j_dual("ت"), m_fem_pl("ت"), j0("أ"), j0("ن"),
        ]
        return marfoo, jussive

    pres_a = pres_pair("َ", pres_ain)
    pres_p = pres_pair("ُ", "َ")
    return {
        "pres_active_marfoo": pres_a[0], "pres_active_jussive": pres_a[1],
        "pres_passive_marfoo": pres_p[0], "pres_passive_jussive": pres_p[1],
        "ism_fail": f1 + "َا" + f2 + "ِي",
        "ism_maful": "مَ" + f1 + "ْ" + f2 + (("ُو" if f3 == "و" else "ِي")
                                            + "ّ"),
        "hamza": "اُ" if pres_ain == "ُ" else "اِ",
    }


def _build_naqis_past(f1: str, f2: str, f3: str) -> tuple[list, list]:
    long_ending = "ا" if f3 == "و" else "ى"
    a = f1 + "َ" + f2 + "َ"
    past_active = [
        a + long_ending, a + f3 + "َا", a + "وْا", a + "تْ", a + "تَا",
        a + f3 + "ْنَ",
        a + f3 + "ْتَ", a + f3 + "ْتُمَا", a + f3 + "ْتُمْ",
        a + f3 + "ْتِ", a + f3 + "ْتُمَا", a + f3 + "ْتُنَّ",
        a + f3 + "ْتُ", a + f3 + "ْنَا",
    ]
    p = f1 + "ُ" + f2 + "ِي"
    past_passive = [
        p + "َ", p + "َا", f1 + "ُ" + f2 + "ُوا", p + "َتْ", p + "َتَا",
        p + "نَ",
        f1 + "ُ" + f2 + "ِيتَ", f1 + "ُ" + f2 + "ِيتُمَا",
        f1 + "ُ" + f2 + "ِيتُمْ", f1 + "ُ" + f2 + "ِيتِ",
        f1 + "ُ" + f2 + "ِيتُمَا", f1 + "ُ" + f2 + "ِيتُنَّ",
        f1 + "ُ" + f2 + "ِيتُ", f1 + "ُ" + f2 + "ِينَا",
    ]
    return past_active, past_passive


def _build_naqis_from_measure(m: dict, f3: str) -> dict:
    def swap_last_vowel(text: str, new_vowel: str) -> str:
        if text[-1:] == SHADDA:
            return text[:-2] + new_vowel + SHADDA
        return text[:-1] + new_vowel

    def extract_ain(text: str) -> tuple[str, str]:
        if text[-1:] == SHADDA:
            return text[-2:-1], text[:-2] + SHADDA
        return text[-1:], text[:-1]

    past_base = m["past_active"][:-2]
    long_ending = "ا" if f3 == "و" else "ى"
    past_active = [
        past_base + long_ending, past_base + f3 + "َا", past_base + "وْا",
        past_base + "تْ", past_base + "تَا", past_base + f3 + "ْنَ",
        past_base + f3 + "ْتَ", past_base + f3 + "ْتُمَا",
        past_base + f3 + "ْتُمْ", past_base + f3 + "ْتِ",
        past_base + f3 + "ْتُمَا", past_base + f3 + "ْتُنَّ",
        past_base + f3 + "ْتُ", past_base + f3 + "ْنَا",
    ]
    base_p = m["past_passive"][:-2]
    base_p_damma = swap_last_vowel(base_p, "ُ")
    past_passive = [
        base_p + "يَ", base_p + "يَا", base_p_damma + "وا",
        base_p + "يَتْ", base_p + "يَتَا", base_p + "ينَ",
        base_p + "يتَ", base_p + "يتُمَا", base_p + "يتُمْ",
        base_p + "يتِ", base_p + "يتُمَا", base_p + "يتُنَّ",
        base_p + "يتُ", base_p + "ينَا",
    ]

    def pres_pair_from_rest(rest: str, prefix_vowel: str) -> dict:
        stripped = rest[:-2]
        ain, bare_no_ain = extract_ain(stripped)
        e_letter = "و" if ain == "ُ" else ("ي" if ain == "ِ" else "ى")
        g_letter = "و" if ain == "ُ" else "ي"

        def bare(p: str) -> str:
            return p + prefix_vowel + bare_no_ain

        def m0(p: str) -> str:
            return bare(p) + ain + e_letter

        def m_dual(p: str) -> str:
            return bare(p) + ain + g_letter + "َانِ"

        def m_plural(p: str) -> str:
            return bare(p) + "َ" + "وْنَ" if ain == "َ" \
                else bare(p) + "ُ" + "ونَ"

        def m_fem_pl(p: str) -> str:
            return bare(p) + ain + g_letter + "ْنَ"

        marfoo = [
            m0("ي"), m_dual("ي"), m_plural("ي"), m0("ت"), m_dual("ت"),
            m_fem_pl("ي"),
            m0("ت"), m_dual("ت"), m_plural("ت"),
            "ت" + prefix_vowel + bare_no_ain + "ِينَ",
            m_dual("ت"), m_fem_pl("ت"), m0("أ"), m0("ن"),
        ]

        def j0(p: str) -> str:
            return bare(p) + ain

        def j_dual(p: str) -> str:
            return bare(p) + ain + g_letter + "َا"

        def j_plural(p: str) -> str:
            return bare(p) + "َ" + "وْا" if ain == "َ" \
                else bare(p) + "ُ" + "وا"

        jussive = [
            j0("ي"), j_dual("ي"), j_plural("ي"), j0("ت"), j_dual("ت"),
            m_fem_pl("ي"),
            j0("ت"), j_dual("ت"), j_plural("ت"),
            "ت" + prefix_vowel + bare_no_ain + "ِي",
            j_dual("ت"), m_fem_pl("ت"), j0("أ"), j0("ن"),
        ]
        return {"marfoo": marfoo, "jussive": jussive,
                "bare_no_ain": bare_no_ain}

    pres_a = pres_pair_from_rest(m["pres_active"], m["pres_prefix"])
    pres_p = pres_pair_from_rest(m["pres_passive"], m["pres_passive_prefix"])
    return {
        "past_active": past_active, "past_passive": past_passive,
        "pres_active_marfoo": pres_a["marfoo"],
        "pres_active_jussive": pres_a["jussive"],
        "pres_passive_marfoo": pres_p["marfoo"],
        "pres_passive_jussive": pres_p["jussive"],
        "ism_fail": "مُ" + pres_a["bare_no_ain"] + "ِي",
        "ism_maful": "مُ" + pres_p["bare_no_ain"] + "َى",
    }


# ------------------------------------------------------- لفيف مفروق ---
def _build_lafif_mafruq_active_present(f2: str, f3: str,
                                       pres_ain: str) -> tuple[list, list]:
    e_letter = "و" if pres_ain == "ُ" else ("ي" if pres_ain == "ِ" else "ى")
    g_letter = "و" if pres_ain == "ُ" else "ي"

    def bare(p: str) -> str:
        return p + "َ" + f2

    def m0(p: str) -> str:
        return bare(p) + pres_ain + e_letter

    def m_dual(p: str) -> str:
        return bare(p) + pres_ain + g_letter + "َانِ"

    def m_plural(p: str) -> str:
        return bare(p) + "َ" + "وْنَ" if pres_ain == "َ" \
            else bare(p) + "ُ" + "ونَ"

    def m_fem_pl(p: str) -> str:
        return bare(p) + pres_ain + g_letter + "ْنَ"

    marfoo = [
        m0("ي"), m_dual("ي"), m_plural("ي"), m0("ت"), m_dual("ت"),
        m_fem_pl("ي"),
        m0("ت"), m_dual("ت"), m_plural("ت"), "ت" + "َ" + f2 + "ِينَ",
        m_dual("ت"), m_fem_pl("ت"), m0("أ"), m0("ن"),
    ]

    def j0(p: str) -> str:
        return bare(p) + pres_ain

    def j_dual(p: str) -> str:
        return bare(p) + pres_ain + g_letter + "َا"

    def j_plural(p: str) -> str:
        return bare(p) + "َ" + "وْا" if pres_ain == "َ" \
            else bare(p) + "ُ" + "وا"

    jussive = [
        j0("ي"), j_dual("ي"), j_plural("ي"), j0("ت"), j_dual("ت"),
        m_fem_pl("ي"),
        j0("ت"), j_dual("ت"), j_plural("ت"), "ت" + "َ" + f2 + "ِي",
        j_dual("ت"), m_fem_pl("ت"), j0("أ"), j0("ن"),
    ]
    return marfoo, jussive


def _build_lafif_mafruq_iftaala(f2: str, f3: str) -> dict:
    past_base = "اِتَّ" + f2 + "َ"
    long_ending = "ا" if f3 == "و" else "ى"
    past_active = [
        past_base + long_ending, past_base + f3 + "َا", past_base + "وْا",
        past_base + "تْ", past_base + "تَا", past_base + f3 + "ْنَ",
        past_base + f3 + "ْتَ", past_base + f3 + "ْتُمَا",
        past_base + f3 + "ْتُمْ", past_base + f3 + "ْتِ",
        past_base + f3 + "ْتُمَا", past_base + f3 + "ْتُنَّ",
        past_base + f3 + "ْتُ", past_base + f3 + "ْنَا",
    ]
    past_base_p = "اُتُّ" + f2 + "ِ"
    base_p_damma = past_base_p[:-1] + "ُ"
    past_passive = [
        past_base_p + "يَ", past_base_p + "يَا", base_p_damma + "وا",
        past_base_p + "يَتْ", past_base_p + "يَتَا", past_base_p + "ينَ",
        past_base_p + "يتَ", past_base_p + "يتُمَا", past_base_p + "يتُمْ",
        past_base_p + "يتِ", past_base_p + "يتُمَا",
        past_base_p + "يتُنَّ", past_base_p + "يتُ", past_base_p + "ينَا",
    ]

    def pres_pair(prefix_vowel: str, bare_no_ain: str,
                  ain: str) -> tuple[list, list]:
        e_letter = "و" if ain == "ُ" else ("ي" if ain == "ِ" else "ى")
        g_letter = "و" if ain == "ُ" else "ي"

        def bare(p: str) -> str:
            return p + prefix_vowel + bare_no_ain

        def m0(p: str) -> str:
            return bare(p) + ain + e_letter

        def m_dual(p: str) -> str:
            return bare(p) + ain + g_letter + "َانِ"

        def m_plural(p: str) -> str:
            return bare(p) + "َ" + "وْنَ" if ain == "َ" \
                else bare(p) + "ُ" + "ونَ"

        def m_fem_pl(p: str) -> str:
            return bare(p) + ain + g_letter + "ْنَ"

        marfoo = [
            m0("ي"), m_dual("ي"), m_plural("ي"), m0("ت"), m_dual("ت"),
            m_fem_pl("ي"),
            m0("ت"), m_dual("ت"), m_plural("ت"),
            "ت" + prefix_vowel + bare_no_ain + "ِينَ",
            m_dual("ت"), m_fem_pl("ت"), m0("أ"), m0("ن"),
        ]

        def j0(p: str) -> str:
            return bare(p) + ain

        def j_dual(p: str) -> str:
            return bare(p) + ain + g_letter + "َا"

        def j_plural(p: str) -> str:
            return bare(p) + "َ" + "وْا" if ain == "َ" \
                else bare(p) + "ُ" + "وا"

        jussive = [
            j0("ي"), j_dual("ي"), j_plural("ي"), j0("ت"), j_dual("ت"),
            m_fem_pl("ي"),
            j0("ت"), j_dual("ت"), j_plural("ت"),
            "ت" + prefix_vowel + bare_no_ain + "ِي",
            j_dual("ت"), m_fem_pl("ت"), j0("أ"), j0("ن"),
        ]
        return marfoo, jussive

    pres_a = pres_pair("َ", "تَّ" + f2, "ِ")
    pres_p = pres_pair("ُ", "تَّ" + f2, "َ")
    return {
        "past_active": past_active, "past_passive": past_passive,
        "pres_active_marfoo": pres_a[0], "pres_active_jussive": pres_a[1],
        "pres_passive_marfoo": pres_p[0], "pres_passive_jussive": pres_p[1],
        "ism_fail": "مُتَّ" + f2 + "ِي", "ism_maful": "مُتَّ" + f2 + "َى",
        "hamza": "اِ", "force_hamza_always": True,
    }


# ------------------------------------------------------------ اوزان ---
def _get_measure(bab: str, f1: str, f2: str, f3: str, r4: str) -> dict:
    m: dict = {"irregular": False, "has_passive": True,
               "has_ism_zaman": False, "custom_hamza": None}
    if bab in MUJARRAD_AIN:
        past_ain, pres_ain = MUJARRAD_AIN[bab]
        m["past_active"] = f1 + "َ" + f2 + past_ain + f3 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = f1 + "ْ" + f2 + pres_ain + f3 + "ُ"
        m["past_passive"] = f1 + "ُ" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = f1 + "ْ" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = "اُ" if pres_ain == "ُ" else "اِ"
        m["ism_fail"] = f1 + "َا" + f2 + "ِ" + f3
        m["ism_maful"] = "مَ" + f1 + "ْ" + f2 + "ُو" + f3
        m["has_ism_zaman"] = True
        m["ism_zaman_makan"] = "مَ" + f1 + "ْ" + f2 + (
            "ِ" if pres_ain == "ِ" else "َ") + f3
        m["ism_alat"] = "مِ" + f1 + "ْ" + f2 + "َا" + f3
        m["ism_tafdil"] = "أَ" + f1 + "ْ" + f2 + "َ" + f3
        if bab == "faala5":
            m["has_passive"] = False
    elif bab == "afala":
        m["past_active"] = "أَ" + f1 + "ْ" + f2 + "َ" + f3 + "َ"
        m["pres_prefix"] = "ُ"
        m["pres_active"] = f1 + "ْ" + f2 + "ِ" + f3 + "ُ"
        m["past_passive"] = "أُ" + f1 + "ْ" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = f1 + "ْ" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = "أَ"
        m["ism_fail"] = "مُ" + f1 + "ْ" + f2 + "ِ" + f3
        m["ism_maful"] = "مُ" + f1 + "ْ" + f2 + "َ" + f3
    elif bab == "faala_m":
        m["past_active"] = f1 + "َ" + f2 + "َّ" + f3 + "َ"
        m["pres_prefix"] = "ُ"
        m["pres_active"] = f1 + "َ" + f2 + "ِّ" + f3 + "ُ"
        m["past_passive"] = f1 + "ُ" + f2 + "ِّ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = f1 + "َ" + f2 + "َّ" + f3 + "ُ"
        m["hamza"] = ""
        m["ism_fail"] = "مُ" + f1 + "َ" + f2 + "ِّ" + f3
        m["ism_maful"] = "مُ" + f1 + "َ" + f2 + "َّ" + f3
    elif bab == "faaala":
        m["past_active"] = f1 + "َا" + f2 + "َ" + f3 + "َ"
        m["pres_prefix"] = "ُ"
        m["pres_active"] = f1 + "َا" + f2 + "ِ" + f3 + "ُ"
        m["past_passive"] = f1 + "ُو" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = f1 + "َا" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = ""
        m["ism_fail"] = "مُ" + f1 + "َا" + f2 + "ِ" + f3
        m["ism_maful"] = "مُ" + f1 + "َا" + f2 + "َ" + f3
    elif bab == "iftaala":
        m["past_active"] = "اِ" + f1 + "ْتَ" + f2 + "َ" + f3 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = f1 + "ْتَ" + f2 + "ِ" + f3 + "ُ"
        m["past_passive"] = "اُ" + f1 + "ْتُ" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = f1 + "ْتَ" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = "اِ"
        m["ism_fail"] = "مُ" + f1 + "ْتَ" + f2 + "ِ" + f3
        m["ism_maful"] = "مُ" + f1 + "ْتَ" + f2 + "َ" + f3
    elif bab == "istafala":
        m["past_active"] = "اِسْتَ" + f1 + "ْ" + f2 + "َ" + f3 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = "سْتَ" + f1 + "ْ" + f2 + "ِ" + f3 + "ُ"
        m["past_passive"] = "اُسْتُ" + f1 + "ْ" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = "سْتَ" + f1 + "ْ" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = "اِس"
        m["ism_fail"] = "مُسْتَ" + f1 + "ْ" + f2 + "ِ" + f3
        m["ism_maful"] = "مُسْتَ" + f1 + "ْ" + f2 + "َ" + f3
        m["custom_hamza"] = "اِسْتَ"
    elif bab == "infaala":
        m["past_active"] = "اِنْ" + f1 + "َ" + f2 + "َ" + f3 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = "نْ" + f1 + "َ" + f2 + "ِ" + f3 + "ُ"
        m["has_passive"] = False
        m["past_passive"] = "اُنْ" + f1 + "ُ" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = "نْ" + f1 + "َ" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = "اِ"
        m["ism_fail"] = "مُنْ" + f1 + "َ" + f2 + "ِ" + f3
        m["ism_maful"] = "مُنْ" + f1 + "َ" + f2 + "َ" + f3
    elif bab == "tafaaala":
        m["past_active"] = "تَ" + f1 + "َا" + f2 + "َ" + f3 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = "تَ" + f1 + "َا" + f2 + "َ" + f3 + "ُ"
        m["past_passive"] = "تُ" + f1 + "ُو" + f2 + "ِ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = "تَ" + f1 + "َا" + f2 + "َ" + f3 + "ُ"
        m["hamza"] = ""
        m["ism_fail"] = "مُتَ" + f1 + "َا" + f2 + "ِ" + f3
        m["ism_maful"] = "مُتَ" + f1 + "َا" + f2 + "َ" + f3
    elif bab == "tafa''ala":
        m["past_active"] = "تَ" + f1 + "َ" + f2 + "َّ" + f3 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = "تَ" + f1 + "َ" + f2 + "َّ" + f3 + "ُ"
        m["past_passive"] = "تُ" + f1 + "ُ" + f2 + "ِّ" + f3 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = "تَ" + f1 + "َ" + f2 + "َّ" + f3 + "ُ"
        m["hamza"] = ""
        m["ism_fail"] = "مُتَ" + f1 + "َ" + f2 + "ِّ" + f3
        m["ism_maful"] = "مُتَ" + f1 + "َ" + f2 + "َّ" + f3
    elif bab == "rubaai_mujarrad":
        m["past_active"] = f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4 + "َ"
        m["pres_prefix"] = "ُ"
        m["pres_active"] = f1 + "َ" + f2 + "ْ" + f3 + "ِ" + r4 + "ُ"
        m["past_passive"] = f1 + "ُ" + f2 + "ْ" + f3 + "ِ" + r4 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4 + "ُ"
        m["hamza"] = ""
        m["ism_fail"] = "مُ" + f1 + "َ" + f2 + "ْ" + f3 + "ِ" + r4
        m["ism_maful"] = "مُ" + f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4
    elif bab == "rubaai_tafa'lala":
        m["past_active"] = "تَ" + f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4 + "َ"
        m["pres_prefix"] = "َ"
        m["pres_active"] = "تَ" + f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4 + "ُ"
        m["past_passive"] = "تُ" + f1 + "ُ" + f2 + "ْ" + f3 + "ِ" + r4 + "َ"
        m["pres_passive_prefix"] = "ُ"
        m["pres_passive"] = "تَ" + f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4 + "ُ"
        m["hamza"] = ""
        m["ism_fail"] = "مُتَ" + f1 + "َ" + f2 + "ْ" + f3 + "ِ" + r4
        m["ism_maful"] = "مُتَ" + f1 + "َ" + f2 + "ْ" + f3 + "َ" + r4
        m["has_passive"] = False
    else:
        m["irregular"] = True
    return m


# ------------------------------------------- اسم زمان/مکان، آلت، تفضیل ---
def _zaman_makan_triple(kind: str, p: dict) -> list[str]:
    if kind == "sound":
        kasra = p.get("force_kasra") or p["pres_ain"] == "ِ"
        sg = "مَ" + p["f1"] + "ْ" + p["f2"] + ("ِ" if kasra else "َ") \
            + p["f3"]
        return [sg, sg + "َانِ",
                "مَ" + p["f1"] + "َا" + p["f2"] + "ِ" + p["f3"]]
    if kind == "naqis":
        long_ending = "ا" if p["f3"] == "و" else "ى"
        sg = "مَ" + p["f1"] + "ْ" + p["f2"] + "َ" + long_ending
        dual = "مَ" + p["f1"] + "ْ" + p["f2"] + "َ" + p["f3"] + "َانِ"
        plural = "مَ" + p["f1"] + "َا" + p["f2"] + "ٍ"
        return [sg, dual, plural]
    if kind == "ajwaf":
        sg = "مَ" + p["f1"] + "َا" + p["f3"]
        return [sg, sg + "َانِ", sg + "َات"]
    if kind == "mudgham":
        sg = "مَ" + p["f1"] + ("ِ" if p["pres_ain"] == "ِ" else "َ") \
            + p["f2"] + SHADDA
        return [sg, sg + "َانِ", "مَ" + p["f1"] + "َا" + p["f2"] + SHADDA]
    return ["", "", ""]


def _alat_triple(kind: str, p: dict) -> list[str]:
    if kind == "sound":
        sg = "مِ" + p["f1"] + "ْ" + p["f2"] + "َا" + p["f3"]
        return [sg, sg + "َانِ",
                "مَ" + p["f1"] + "َا" + p["f2"] + "ِي" + p["f3"]]
    if kind == "mudgham":
        sg = "مِ" + p["f1"] + "ْ" + p["f2"] + "َا" + p["f2"]
        return [sg, sg + "َانِ",
                "مَ" + p["f1"] + "َا" + p["f2"] + "ِي" + p["f2"]]
    if kind == "naqis":
        prefix = "مِي" if _is_pure_weak(p["f1"]) else "مِ" + p["f1"] + "ْ"
        sg = prefix + p["f2"] + "َاءٌ"
        dual = prefix + p["f2"] + "َاوَانِ"
        plural = "مَ" + p["f1"] + "َا" + p["f2"] + "ِيّ" + "ُ"
        return [sg, dual, plural]
    return ["", "", ""]


def _tafdil_six(kind: str, p: dict) -> list[str]:
    if kind == "sound":
        m_sg = "أَ" + p["f1"] + "ْ" + p["f2"] + "َ" + p["f3"]
        f_base = p["f1"] + "ُ" + p["f2"] + "ْ" + p["f3"]
        return [m_sg, m_sg + "َانِ", m_sg + "ُونَ",
                f_base + "َى", f_base + "َيَانِ", f_base + "َيَات"]
    if kind == "mudgham":
        m_sg = "أَ" + p["f1"] + "َ" + p["f2"] + SHADDA
        f_base = p["f1"] + "ُ" + p["f2"] + SHADDA
        return [m_sg, m_sg + "َانِ", m_sg + "ُونَ",
                f_base + "َى", f_base + "َيَانِ", f_base + "َيَات"]
    if kind == "naqis":
        long_ending = "ا" if p["f3"] == "و" else "ى"
        m_sg = "أَ" + p["f1"] + "ْ" + p["f2"] + "َ" + long_ending
        m_dual = "أَ" + p["f1"] + "ْ" + p["f2"] + "َ" + p["f3"] + "َانِ"
        m_plural = "أَ" + p["f1"] + "ْ" + p["f2"] + "َ" + "وْنَ"
        f_base = p["f1"] + "ُ" + p["f2"] + "ْ" + p["f3"] + "َ"
        return [m_sg, m_dual, m_plural,
                f_base + "ا", f_base + "يَانِ", f_base + "يَات"]
    return ["", "", "", "", "", ""]


# ------------------------------------------------- مجهول با حرف جر ---
HARF_JAR_FORMS: dict[str, dict] = {
    "bi": {"label": "بِ", "forms": [
        "بِهِ", "بِهِمَا", "بِهِمْ", "بِهَا", "بِهِمَا", "بِهِنَّ",
        "بِكَ", "بِكُمَا", "بِكُمْ", "بِكِ", "بِكُمَا", "بِكُنَّ",
        "بِي", "بِنَا"]},
    "li": {"label": "لِ", "forms": [
        "لَهُ", "لَهُمَا", "لَهُمْ", "لَهَا", "لَهُمَا", "لَهُنَّ",
        "لَكَ", "لَكُمَا", "لَكُمْ", "لَكِ", "لَكُمَا", "لَكُنَّ",
        "لِي", "لَنَا"]},
    "an": {"label": "عَنْ", "forms": [
        "عَنْهُ", "عَنْهُمَا", "عَنْهُمْ", "عَنْهَا", "عَنْهُمَا",
        "عَنْهُنَّ", "عَنْكَ", "عَنْكُمَا", "عَنْكُمْ", "عَنْكِ",
        "عَنْكُمَا", "عَنْكُنَّ", "عَنِّي", "عَنَّا"]},
    "min": {"label": "مِنْ", "forms": [
        "مِنْهُ", "مِنْهُمَا", "مِنْهُمْ", "مِنْهَا", "مِنْهُمَا",
        "مِنْهُنَّ", "مِنْكَ", "مِنْكُمَا", "مِنْكُمْ", "مِنْكِ",
        "مِنْكُمَا", "مِنْكُنَّ", "مِنِّي", "مِنَّا"]},
    "ila": {"label": "إِلَى", "forms": [
        "إِلَيْهِ", "إِلَيْهِمَا", "إِلَيْهِمْ", "إِلَيْهَا",
        "إِلَيْهِمَا", "إِلَيْهِنَّ", "إِلَيْكَ", "إِلَيْكُمَا",
        "إِلَيْكُمْ", "إِلَيْكِ", "إِلَيْكُمَا", "إِلَيْكُنَّ",
        "إِلَيَّ", "إِلَيْنَا"]},
    "ala": {"label": "عَلَى", "forms": [
        "عَلَيْهِ", "عَلَيْهِمَا", "عَلَيْهِمْ", "عَلَيْهَا",
        "عَلَيْهِمَا", "عَلَيْهِنَّ", "عَلَيْكَ", "عَلَيْكُمَا",
        "عَلَيْكُمْ", "عَلَيْكِ", "عَلَيْكُمَا", "عَلَيْكُنَّ",
        "عَلَيَّ", "عَلَيْنَا"]},
    "fi": {"label": "فِي", "forms": [
        "فِيهِ", "فِيهِمَا", "فِيهِمْ", "فِيهَا", "فِيهِمَا",
        "فِيهِنَّ", "فِيكَ", "فِيكُمَا", "فِيكُمْ", "فِيكِ",
        "فِيكُمَا", "فِيكُنَّ", "فِيَّ", "فِينَا"]},
}


def _harf_jar_arrays(harf_jar: str, past3: str, pres3: str,
                     juss3: str) -> tuple[list, list, list]:
    forms = HARF_JAR_FORMS[harf_jar]["forms"]
    return (
        [past3 + " " + f for f in forms],
        [pres3 + " " + f for f in forms],
        [juss3 + " " + f for f in forms],
    )


# ------------------------------------------------------- ساخت جدول‌ها ---
def _reorder(arr: list[str]) -> list[str]:
    return [arr[i] for i in AMR_NAHI_ORDER]


def _combine_amr(amr_no_lam: list[str], lam_amr_active: list[str]) -> list:
    combined = list(lam_amr_active)
    for i in range(6, 12):
        combined[i] = amr_no_lam[i]
    return combined


def _verb_tables(past_a: list, past_p: list, pres_a: list, pres_p: list,
                 juss_a: list, juss_p: list,
                 amr_combined: list) -> list[dict]:
    lam_a = ["لِ" + v for v in juss_a]
    lam_p = ["لِ" + v for v in juss_p]
    return [
        {"key": "past", "columns": {"active": past_a, "passive": past_p}},
        {"key": "present",
         "columns": {"active": pres_a, "passive": pres_p}},
        {"key": "nafi", "columns": {
            "active": ["لَا " + v for v in pres_a],
            "passive": ["لَا " + v for v in pres_p]}},
        {"key": "jahd", "columns": {
            "active": ["لَمْ " + v for v in juss_a],
            "passive": ["لَمْ " + v for v in juss_p]}},
        {"key": "lam_amr", "columns": {"active": lam_a, "passive": lam_p}},
        {"key": "amr_nahi", "columns": {
            "amr_active": _reorder(amr_combined),
            "amr_passive": _reorder(lam_p),
            "nahi_active": _reorder(["لَا " + v for v in juss_a]),
            "nahi_passive": _reorder(["لَا " + v for v in juss_p])}},
    ]


def _fail_maful_table(ism_fail: list, ism_maful: list,
                      show_passive: bool) -> dict:
    columns = {"ism_fail": ism_fail}
    if show_passive:
        columns["ism_maful"] = ism_maful
    return {"key": "ism_fail_maful", "columns": columns}


def _harf_jar_maful_table(ism_maful_base: str, harf_jar: str) -> dict:
    forms = HARF_JAR_FORMS[harf_jar]["forms"]
    return {"key": "ism_maful_harf_jar",
            "columns": {"ism_maful": [ism_maful_base + " " + f
                                       for f in forms]}}


def _derived_block(zaman3: list, alat3: list, tafdil6: list,
                   show_alat: bool) -> list[dict]:
    tables = [{"key": "zaman_makan", "columns": {"form": zaman3}}]
    if show_alat:
        tables.append({"key": "alat", "columns": {"form": alat3}})
    tables.append({"key": "tafdil", "columns": {"form": tafdil6}})
    return tables


def _zaman_same_table(ism_maful: str) -> dict:
    return {"key": "zaman_same_as_maful", "columns": {"form": [ism_maful]}}


def _passive_or_harf_jar(show_passive: bool, harf_jar: str,
                         raw_past_p: list, raw_pres_p: list,
                         raw_juss_p: list) -> tuple[list, list, list]:
    if show_passive:
        return raw_past_p, raw_pres_p, raw_juss_p
    return _harf_jar_arrays(harf_jar, raw_past_p[0], raw_pres_p[0],
                            raw_juss_p[0])


def _amr_from_jussive(juss_active: list, decide) -> list:
    amr = [""] * 14
    for i in range(6, 12):
        amr[i] = decide(juss_active[i][2:], i)
    return amr


def _starts_with_sukoon(core: str) -> bool:
    return len(core) > 1 and core[1] == SUKOON


# ------------------------------------------------------------ رندرها ---
def _render_mudgham(bab: str, f1: str, f2: str, trans: str,
                    harf_jar: str) -> list[dict]:
    past_ain, pres_ain = MUJARRAD_AIN[bab]
    is_laazim = trans == "laazim" or bab in INHERENTLY_LAZIM_BABS
    hamza_vowel = "اُ" if pres_ain == "ُ" else "اِ"
    past_a = _mudgham_past(f1, f2, "َ", past_ain)
    raw_past_p = _mudgham_past(f1, f2, "ُ", "ِ")
    pres_a = _mudgham_marfoo("َ", f1, pres_ain, f2)
    raw_pres_p = _mudgham_marfoo("ُ", f1, "َ", f2)
    juss_a = _mudgham_jussive("َ", f1, pres_ain, f2)
    raw_juss_p = _mudgham_jussive("ُ", f1, "َ", f2)
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        not is_laazim, harf_jar, raw_past_p, raw_pres_p, raw_juss_p)
    lam_a = ["لِ" + v for v in juss_a]
    amr = _amr_from_jussive(
        juss_a, lambda core, i: (hamza_vowel + core) if i == 11 else core)
    tables = _verb_tables(past_a, past_p, pres_a, pres_p, juss_a, juss_p,
                          _combine_amr(amr, lam_a))
    ism_maful_base = "مَ" + f1 + "ْ" + f2 + "ُو" + f2
    tables.append(_fail_maful_table(
        _noun_forms(f1 + "َا" + f2 + "ّ"), _noun_forms(ism_maful_base),
        not is_laazim))
    if is_laazim:
        tables.append(_harf_jar_maful_table(ism_maful_base, harf_jar))
    tables += _derived_block(
        _zaman_makan_triple("mudgham",
                            {"f1": f1, "f2": f2, "pres_ain": pres_ain}),
        _alat_triple("mudgham", {"f1": f1, "f2": f2}),
        _tafdil_six("mudgham", {"f1": f1, "f2": f2, "f3": f2}),
        not is_laazim)
    return tables


def _render_ajwaf(bab: str, f1: str, f2: str, f3: str, trans: str,
                  harf_jar: str) -> list[dict]:
    past_ain, pres_ain = MUJARRAD_AIN[bab]
    is_laazim = trans == "laazim" or bab in INHERENTLY_LAZIM_BABS
    aw = _build_ajwaf(f1, f3, past_ain, pres_ain)
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        not is_laazim, harf_jar, aw["past_passive"],
        aw["pres_passive_marfoo"], aw["pres_passive_jussive"])
    lam_a = ["لِ" + v for v in aw["pres_active_jussive"]]
    amr = _amr_from_jussive(aw["pres_active_jussive"],
                            lambda core, i: core)
    tables = _verb_tables(
        aw["past_active"], past_p, aw["pres_active_marfoo"], pres_p,
        aw["pres_active_jussive"], juss_p, _combine_amr(amr, lam_a))
    tables.append(_fail_maful_table(
        _noun_forms(aw["ism_fail"]), _noun_forms(aw["ism_maful"]),
        not is_laazim))
    if is_laazim:
        tables.append(_harf_jar_maful_table(aw["ism_maful"], harf_jar))
    tables.append({"key": "zaman_makan", "columns": {
        "form": _zaman_makan_triple("ajwaf", {"f1": f1, "f3": f3})}})
    if not is_laazim:
        alat3 = [
            "مِ" + f1 + "ْ" + f2 + "َا" + f3,
            "مِ" + f1 + "ْ" + f2 + "َا" + f3 + "َانِ",
            "مَ" + f1 + "َا" + f2 + "ِي" + f3,
        ]
        tables.append({"key": "alat", "columns": {"form": alat3}})
        tables.append({"key": "tafdil", "columns": {
            "form": _tafdil_six("sound", {"f1": f1, "f2": f2, "f3": f3})}})
    return tables


def _naqis_family_tables(nq: dict, past_a: list, raw_past_p: list,
                         show_passive: bool, harf_jar: str,
                         amr_decide, ism_fail_forms: list,
                         extra_tables: list) -> list[dict]:
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        show_passive, harf_jar, raw_past_p, nq["pres_passive_marfoo"],
        nq["pres_passive_jussive"])
    lam_a = ["لِ" + v for v in nq["pres_active_jussive"]]
    amr = _amr_from_jussive(nq["pres_active_jussive"], amr_decide)
    tables = _verb_tables(
        past_a, past_p, nq["pres_active_marfoo"], pres_p,
        nq["pres_active_jussive"], juss_p, _combine_amr(amr, lam_a))
    tables.append(_fail_maful_table(
        ism_fail_forms, _noun_forms(nq["ism_maful"]), show_passive))
    if not show_passive:
        tables.append(_harf_jar_maful_table(nq["ism_maful"], harf_jar))
    tables += extra_tables
    return tables


def _render_naqis(bab: str, f1: str, f2: str, f3: str, trans: str,
                  harf_jar: str) -> list[dict]:
    _, pres_ain = MUJARRAD_AIN[bab]
    show_passive = trans != "laazim" and bab not in INHERENTLY_LAZIM_BABS
    nq = _build_naqis(f1, f2, f3, pres_ain)
    if bab in ("faala", "faala2", "faala3"):
        past_a, raw_past_p = _build_naqis_past(f1, f2, f3)
    else:
        sm = _get_measure(bab, f1, f2, f3, "")
        past_a = _conjugate_past(sm["past_active"])
        raw_past_p = _conjugate_past(sm["past_passive"])

    def decide(core: str, i: int) -> str:
        return (nq["hamza"] + core) if _starts_with_sukoon(core) else core

    extra = _derived_block(
        _zaman_makan_triple("naqis", {"f1": f1, "f2": f2, "f3": f3}),
        _alat_triple("naqis", {"f1": f1, "f2": f2}),
        _tafdil_six("naqis", {"f1": f1, "f2": f2, "f3": f3}), True)
    return _naqis_family_tables(
        nq, past_a, raw_past_p, show_passive, harf_jar, decide,
        _naqis_noun_forms(nq["ism_fail"]), extra)


def _render_lafif_mafruq(bab: str, f1: str, f2: str, f3: str, trans: str,
                         harf_jar: str) -> list[dict]:
    _, pres_ain = MUJARRAD_AIN[bab]
    show_passive = trans != "laazim" and bab not in INHERENTLY_LAZIM_BABS
    nq = _build_naqis(f1, f2, f3, pres_ain)
    drop_f1 = f1 == "و" and bab in ("faala", "faala2", "faala3")
    pres_a, juss_a = nq["pres_active_marfoo"], nq["pres_active_jussive"]
    if drop_f1:
        pres_a, juss_a = _build_lafif_mafruq_active_present(
            f2, f3, pres_ain)
    nq = dict(nq, pres_active_marfoo=pres_a, pres_active_jussive=juss_a)
    if bab in ("faala", "faala2", "faala3"):
        past_a, raw_past_p = _build_naqis_past(f1, f2, f3)
    else:
        sm = _get_measure(bab, f1, f2, f3, "")
        past_a = _conjugate_past(sm["past_active"])
        raw_past_p = _conjugate_past(sm["past_passive"])

    def decide(core: str, i: int) -> str:
        return (nq["hamza"] + core) if _starts_with_sukoon(core) else core

    extra = _derived_block(
        _zaman_makan_triple("naqis", {"f1": f1, "f2": f2, "f3": f3}),
        _alat_triple("naqis", {"f1": f1, "f2": f2}),
        _tafdil_six("naqis", {"f1": f1, "f2": f2, "f3": f3}), True)
    return _naqis_family_tables(
        nq, past_a, raw_past_p, show_passive, harf_jar, decide,
        _naqis_noun_forms(nq["ism_fail"]), extra)


def _render_ajwaf_augmented(bab: str, f1: str, f3: str, trans: str,
                            harf_jar: str) -> list[dict]:
    show_passive = trans != "laazim"
    builder = {"afala": _build_ajwaf_iv, "iftaala": _build_ajwaf_viii,
               "istafala": _build_ajwaf_x}[bab]
    aw = builder(f1, f3)
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        show_passive, harf_jar, aw["past_passive"],
        aw["pres_passive_marfoo"], aw["pres_passive_jussive"])
    lam_a = ["لِ" + v for v in aw["pres_active_jussive"]]

    def decide(core: str, i: int) -> str:
        if aw.get("custom_hamza") is not None:
            return "اِسْتَ" + re.sub("^سْتَ", "", core)
        if aw.get("force_hamza_always") and aw.get("hamza"):
            return aw["hamza"] + core
        if _starts_with_sukoon(core) and aw.get("hamza"):
            return aw["hamza"] + core
        return core

    amr = _amr_from_jussive(aw["pres_active_jussive"], decide)
    tables = _verb_tables(
        aw["past_active"], past_p, aw["pres_active_marfoo"], pres_p,
        aw["pres_active_jussive"], juss_p, _combine_amr(amr, lam_a))
    tables.append(_fail_maful_table(
        _noun_forms(aw["ism_fail"]), _noun_forms(aw["ism_maful"]),
        show_passive))
    if not show_passive:
        tables.append(_harf_jar_maful_table(aw["ism_maful"], harf_jar))
    tables.append(_zaman_same_table(aw["ism_maful"]))
    return tables


def _render_naqis_augmented(bab: str, f1: str, f2: str, f3: str,
                            trans: str, harf_jar: str) -> list[dict]:
    m = _get_measure(bab, f1, f2, f3, "")
    is_laazim = trans == "laazim"
    show_passive = bool(m["has_passive"]) and not is_laazim
    nq = _build_naqis_from_measure(m, f3)
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        show_passive, harf_jar, nq["past_passive"],
        nq["pres_passive_marfoo"], nq["pres_passive_jussive"])
    lam_a = ["لِ" + v for v in nq["pres_active_jussive"]]
    force_hamza_always = bab == "afala"

    def decide(core: str, i: int) -> str:
        if m.get("custom_hamza") is not None:
            return "اِسْتَ" + re.sub("^سْتَ", "", core)
        if force_hamza_always and m.get("hamza"):
            return m["hamza"] + core
        if _starts_with_sukoon(core) and m.get("hamza"):
            return m["hamza"] + core
        return core

    amr = _amr_from_jussive(nq["pres_active_jussive"], decide)
    tables = _verb_tables(
        nq["past_active"], past_p, nq["pres_active_marfoo"], pres_p,
        nq["pres_active_jussive"], juss_p, _combine_amr(amr, lam_a))
    tables.append(_fail_maful_table(
        _noun_forms(nq["ism_fail"]), _noun_forms(nq["ism_maful"]),
        show_passive))
    if not show_passive:
        tables.append(_harf_jar_maful_table(nq["ism_maful"], harf_jar))
    return tables


def _render_lafif_mafruq_iftaala(f2: str, f3: str, trans: str,
                                 harf_jar: str) -> list[dict]:
    show_passive = trans != "laazim"
    lm = _build_lafif_mafruq_iftaala(f2, f3)
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        show_passive, harf_jar, lm["past_passive"],
        lm["pres_passive_marfoo"], lm["pres_passive_jussive"])
    lam_a = ["لِ" + v for v in lm["pres_active_jussive"]]

    def decide(core: str, i: int) -> str:
        return (lm["hamza"] + core) if lm.get("force_hamza_always") else core

    amr = _amr_from_jussive(lm["pres_active_jussive"], decide)
    tables = _verb_tables(
        lm["past_active"], past_p, lm["pres_active_marfoo"], pres_p,
        lm["pres_active_jussive"], juss_p, _combine_amr(amr, lam_a))
    tables.append(_fail_maful_table(
        _noun_forms(lm["ism_fail"]), _noun_forms(lm["ism_maful"]),
        show_passive))
    if not show_passive:
        tables.append(_harf_jar_maful_table(lm["ism_maful"], harf_jar))
    return tables


def _render_main(bab: str, f1: str, f2: str, f3: str, r4: str,
                 trans: str, harf_jar: str, is_mesal: bool,
                 is_mahmuz: bool) -> tuple[list[dict], dict]:
    m = _get_measure(bab, f1, f2, f3, r4)
    force_hamza_always = False
    flags: dict = {"mesal_dropped": False, "mesal_assimilated": False,
                   "ajwaf_as_sound": False}

    # مثال واوی در مجرد (ابواب ماضی مفتوح): واو در مضارع حذف می‌شود
    if is_mesal and f1 == "و" and bab in ("faala", "faala2", "faala3"):
        _, pres_ain = MUJARRAD_AIN[bab]
        m["pres_active"] = f2 + pres_ain + f3 + "ُ"
        flags["mesal_dropped"] = True
    # مثال واوی در افتعال: واو با تاء باب ادغام می‌شود
    if is_mesal and f1 == "و" and bab == "iftaala":
        m["past_active"] = "اِتَّ" + f2 + "َ" + f3 + "َ"
        m["pres_active"] = "تَّ" + f2 + "ِ" + f3 + "ُ"
        m["past_passive"] = "اُتُّ" + f2 + "ِ" + f3 + "َ"
        m["pres_passive"] = "تَّ" + f2 + "َ" + f3 + "ُ"
        m["ism_fail"] = "مُتَّ" + f2 + "ِ" + f3
        m["ism_maful"] = "مُتَّ" + f2 + "َ" + f3
        m["hamza"] = "اِ"
        force_hamza_always = True
        flags["mesal_assimilated"] = True

    show_passive = bool(m["has_passive"]) and trans != "laazim"
    past_a = _conjugate_past(m["past_active"])
    raw_past_p = _conjugate_past(m["past_passive"])
    pres_a = _conjugate_present_marfoo(m["pres_prefix"], m["pres_active"])
    raw_pres_p = _conjugate_present_marfoo(
        m["pres_passive_prefix"], m["pres_passive"])
    juss_a = _conjugate_jussive(m["pres_prefix"], m["pres_active"])
    raw_juss_p = _conjugate_jussive(
        m["pres_passive_prefix"], m["pres_passive"])
    past_p, pres_p, juss_p = _passive_or_harf_jar(
        show_passive, harf_jar, raw_past_p, raw_pres_p, raw_juss_p)
    lam_a = ["لِ" + v for v in juss_a]

    mahmuz_fa = is_mahmuz and f1 == "ء"
    drops_amr = mahmuz_fa and bab in MUJARRAD_AIN \
        and MUJARRAD_AIN[bab][1] == "ُ"

    def decide(core: str, i: int) -> str:
        if drops_amr:
            return re.sub("^ءْ", "", core)
        if m.get("custom_hamza") is not None:
            return "اِسْتَ" + re.sub("^سْتَ", "", core)
        if force_hamza_always and m.get("hamza"):
            return m["hamza"] + core
        if _starts_with_sukoon(core) and m.get("hamza"):
            return m["hamza"] + core
        return core

    amr = _amr_from_jussive(juss_a, decide)
    tables = _verb_tables(past_a, past_p, pres_a, pres_p, juss_a, juss_p,
                          _combine_amr(amr, lam_a))
    tables.append(_fail_maful_table(
        _noun_forms(m["ism_fail"]), _noun_forms(m["ism_maful"]),
        show_passive))
    if not show_passive:
        tables.append(_harf_jar_maful_table(m["ism_maful"], harf_jar))
    if m["has_ism_zaman"]:
        _, pres_ain = MUJARRAD_AIN[bab]
        tables += _derived_block(
            _zaman_makan_triple("sound", {
                "f1": f1, "f2": f2, "f3": f3, "pres_ain": pres_ain,
                "force_kasra": is_mesal}),
            _alat_triple("sound", {"f1": f1, "f2": f2, "f3": f3}),
            _tafdil_six("sound", {"f1": f1, "f2": f2, "f3": f3}),
            show_passive)
    else:
        tables.append(_zaman_same_table(m["ism_maful"]))

    if is_mahmuz:
        # اصلاح کرسی همزه روی همهٔ خروجی‌ها (فقط مسیر اصلی، مانند منبع)
        def fix(forms: list[str]) -> list[str]:
            out = []
            for form in forms:
                form = form.replace("أَءْ", "آ").replace(
                    "أُءْ", "أُو").replace("أِءْ", "إِي")
                out.append(_fix_hamza(form, f3 == "ء"))
            return out

        for table in tables:
            for key, forms in table["columns"].items():
                table["columns"][key] = fix(forms)
    return tables, flags


# ------------------------------------------------------------ ورودی ---
def conjugate_verb(root: str, bab: str, transitivity: str,
                   harf_jar: str = "bi") -> dict:
    """صرف کامل یک فعل. خطاها با MosarefError و کد ماشینی برمی‌گردند."""
    if transitivity not in ("mutaadi", "laazim"):
        raise MosarefError("invalid_transitivity")
    if harf_jar not in HARF_JAR_FORMS:
        raise MosarefError("invalid_harf_jar")
    root = (root or "").strip()
    is_rubaai = bab.startswith("rubaai")
    min_len = 4 if is_rubaai else 3
    if not root or len(root) < min_len:
        raise MosarefError("root_too_short")
    f1, f2, f3 = root[0], root[1], root[2]
    r4 = root[3] if is_rubaai else ""
    raw = [f1, f2, f3, r4] if is_rubaai else [f1, f2, f3]
    if "ا" in raw:
        raise MosarefError("alif_in_root")
    is_mahmuz = any(_is_hamza_seat(ch) for ch in raw)
    if is_mahmuz:
        if any(_is_pure_weak(ch) for ch in raw):
            raise MosarefError("mahmuz_weak_mix")
        if f2 == f3 and any(_is_hamza_seat(ch) for ch in raw):
            raise MosarefError("mahmuz_mudgham_mix")
        f1 = "ء" if _is_hamza_seat(f1) else f1
        f2 = "ء" if _is_hamza_seat(f2) else f2
        f3 = "ء" if _is_hamza_seat(f3) else f3
        if is_rubaai:
            r4 = "ء" if _is_hamza_seat(r4) else r4
    letters = [f1, f2, f3, r4] if is_rubaai else [f1, f2, f3]
    if is_rubaai and any(_is_pure_weak(ch) for ch in letters):
        raise MosarefError("rubaai_weak_unsupported")
    if not is_rubaai and _is_pure_weak(f1) and _is_pure_weak(f2) \
            and not _is_pure_weak(f3):
        raise MosarefError("weak_combo_unsupported")
    if bab in RARE_BABS or bab not in KNOWN_BABS:
        raise MosarefError("bab_unsupported")

    is_mudgham = not is_rubaai and f2 == f3
    is_ajwaf = (not is_rubaai and _is_pure_weak(f2)
                and not _is_pure_weak(f1) and not _is_pure_weak(f3))
    is_lafif_mafruq = (not is_rubaai and _is_pure_weak(f1)
                       and _is_pure_weak(f3) and not _is_pure_weak(f2))
    is_mesal = (not is_rubaai and _is_pure_weak(f1)
                and not _is_pure_weak(f2) and not _is_pure_weak(f3))
    is_naqis = (not is_rubaai and _is_pure_weak(f3)
                and not _is_pure_weak(f1))
    is_lafif_maqrun = is_naqis and _is_pure_weak(f2)

    if is_mudgham and bab not in MUJARRAD_BABS:
        raise MosarefError("mudgham_augmented_unsupported")

    flags: dict = {
        "inherently_lazim": bab in INHERENTLY_LAZIM_BABS,
        "approximate_past": False,
    }
    if is_mudgham:
        verb_class = "mudgham"
        tables = _render_mudgham(bab, f1, f2, transitivity, harf_jar)
    elif is_ajwaf and bab in ("afala", "iftaala", "istafala"):
        verb_class = "ajwaf"
        tables = _render_ajwaf_augmented(bab, f1, f3, transitivity,
                                         harf_jar)
    elif is_ajwaf and bab in MUJARRAD_BABS:
        verb_class = "ajwaf"
        tables = _render_ajwaf(bab, f1, f2, f3, transitivity, harf_jar)
    elif is_lafif_mafruq and bab in MUJARRAD_BABS:
        verb_class = "lafif_mafruq"
        tables = _render_lafif_mafruq(bab, f1, f2, f3, transitivity,
                                      harf_jar)
        flags["approximate_past"] = bab not in ("faala", "faala2", "faala3")
    elif is_lafif_mafruq and bab == "iftaala" and f1 == "و":
        verb_class = "lafif_mafruq"
        tables = _render_lafif_mafruq_iftaala(f2, f3, transitivity,
                                              harf_jar)
    elif is_lafif_mafruq:
        verb_class = "lafif_mafruq"
        tables = _render_naqis_augmented(bab, f1, f2, f3, transitivity,
                                          harf_jar)
    elif is_naqis and bab in MUJARRAD_BABS:
        verb_class = "lafif_maqrun" if is_lafif_maqrun else "naqis"
        tables = _render_naqis(bab, f1, f2, f3, transitivity, harf_jar)
        flags["approximate_past"] = bab not in ("faala", "faala2", "faala3")
    elif is_naqis:
        verb_class = "lafif_maqrun" if is_lafif_maqrun else "naqis"
        tables = _render_naqis_augmented(bab, f1, f2, f3, transitivity,
                                         harf_jar)
    else:
        verb_class = ("mesal" if is_mesal else
                      "mahmuz" if is_mahmuz else
                      "ajwaf" if is_ajwaf else "sound")
        tables, main_flags = _render_main(
            bab, f1, f2, f3, r4, transitivity, harf_jar, is_mesal,
            is_mahmuz)
        flags.update(main_flags)
        if is_ajwaf:
            flags["ajwaf_as_sound"] = True

    return {
        "root": "".join(letters),
        "bab": bab,
        "transitivity": transitivity,
        "harf_jar": harf_jar,
        "verb_class": verb_class,
        "tables": tables,
        "flags": flags,
    }
