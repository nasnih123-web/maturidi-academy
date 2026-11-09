"""نگاشت واج‌به‌کلمهٔ حفاظ — دادهٔ واقعی Quran-Lab (نه حدس، نه کپی).

منبع داده (تحویل کاربر، ۲۰۲۶-۱۱-۰۴):
- `ordered_quran_phonemes.json` — منبع اصلی: ۶٬۲۳۶ مدخل با کلید
  `surah:ayah` و مقدار `{aya_text, aya_phoneme, aya_phonemes_list}`؛
  فهرست واجی، کلمه‌های «واجی» (واحدهای تلفظ پیوسته) است، نه لزوماً
  کلمه‌های املایی.
- `quran_text2phoneme.json` — فقط وارسی متقاطع: کلیدش متن کامل آیه
  است (۹٬۱۱۲ کلید)، پس برای نگاشت کلمه‌به‌کلمه مناسب نیست.
- `tokens.txt` — جدول Kaldi با ۲۵۱ نماد؛ `<blank>` شناسهٔ ۲۵۰.

یافتهٔ کلیدیِ اعتبارسنجی (با عدد، نه فرض): کلمه‌های واجی با
کلمه‌های املایی یک‌به‌یک نمی‌خوانند. در تلفظ پیوسته، کلمه‌ها گاه
ادغام می‌شوند (مثلاً «بَرَآءَةٌ + مِّنَ» → یک واحد واجی) و حروف
مقطعه گاه می‌شکنند (مثلاً «الٓمٓ» → دو واحد واجی). پس نگاشتِ
«یک کلمه → یک رشتهٔ واجی» برای بیشتر آیه‌ها تعریف‌نشده است؛ واسط
درست، «قطعه» (segment) است: هر قطعه، یک واحد واجی است که یک یا چند
کلمهٔ املایی را می‌پوشاند (ادغام) یا بخشی از یک کلمه است (شکست).

ساخت قطعه‌ها (قطعی، نه حدسی):
- مرز قطعه‌ها با برنامه‌نویسی پویا (DP) روی رشته‌های نرمال‌شده
  به‌دست می‌آید: نرمال‌سازی (حذف حرکات، تا کردن الف/همزه، تبدیل
  ۥ→و و ۦ→ي، فشرده‌سازی تکرارها) تفاوت‌های املایی/تلفظیِ نظام‌مند
  (وصله، مد، غنه، تشدید) را خنثی می‌کند؛ DP کم‌هزینه‌ترین پوشش کامل
  را می‌یابد و آیه‌ای که هزینه‌اش از آستانه بگذرد، «پذیرفته‌نشده»
  می‌ماند (خطای صادقانه، هرگز تراز بی‌صدا).
- کلمهٔ تک‌واژه‌ای (حروف مقطعه): همهٔ واحدهای واجی‌اش همان یک کلمه‌اند.
- بسملهٔ ابتدای سوره‌ها (جز ۱ و ۹) در متن Tanzil جزو آیهٔ ۱ است ولی
  در نگاشت نیست؛ قطعه‌های بسمله از مدخل ۱:۱ پیش می‌آیند.
- نشانه‌های وقفِ تنها (ۚ ۗ ۖ …) کلمه نیستند و خوانده نمی‌شوند؛
  قطعهٔ «رد خودکار» می‌گیرند (خاکستری، بدون مصرف واج).
- شاخص‌های قطعه، شاخص‌های «متن ارائه‌شده» (Tanzil لفظ‌به‌لفظ، با
  بسمله و وقف) هستند تا با نشست زنده، نمره‌دهی ضبطی، Peek و رابط
  وب یکسان بمانند.

توزیع (بدون تعهد به مجوز بازنشر):
- فایل‌های JSON در ریپو «کامیت» نمی‌شوند: متن LICENSE خوانده نشده
  (فقط خلاصهٔ README که به LICENSE ارجاع می‌دهد) و جدول‌ها بخشی از
  برچسب‌های quran-transcript هستند؛ پس بارگذار از مسیری پیکربندی‌شده
  می‌خواند (متغیر `QURAN_PHONEME_MAP_DIR`). نبودِ فایل‌ها یعنی همان
  خطای صادقانهٔ ۵۰۳ قبلی. گام استقرار در گزارش نهایی آمده است.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.core.errors import APIError

from .alignment import strip_diacritics

logger = logging.getLogger(__name__)

__all__ = [
    "MappingPendingError",
    "PhonemeMapping",
    "Segment",
    "ValidationReport",
    "load_phoneme_mapping",
]

_MAP_DIR_ENV = "QURAN_PHONEME_MAP_DIR"
_DEFAULT_DIR = Path(__file__).resolve().parent / "data" / "phoneme"
_ORDERED_FILE = "ordered_quran_phonemes.json"
_TOKENS_FILE = "tokens.txt"
_TEXT2PHONEME_FILE = "quran_text2phoneme.json"
_TANZIL_FILE = Path(__file__).resolve().parent / "data" / "tanzil_uthmani.txt"
_TANZIL_LINE_RE = re.compile(r"^(\d+)\|(\d+)\|(.*)$")

#: نشانه‌های وقفِ تنها — کلمه نیستند، خوانده نمی‌شوند.
_PAUSE_MARKS = set("ۖۗۘۙۚۛۜ")

#: تا کردن حروف برای نرمال‌سازی تطابق (فقط برای هزینهٔ DP).
_FOLD = {
    "ٱ": "ا",
    "أ": "ا",
    "إ": "ا",
    "آ": "ا",
    "ء": "ا",
    "ى": "ي",
    "ئ": "ي",
    "ة": "ت",
    "ؤ": "و",
}

#: آستانهٔ پذیرش DP: هزینهٔ کل حداکثر کف ۱۰ یا ۱٫۵ برابر شمار قطعه‌ها
#: (هزینه با طول آیه رشد می‌کند؛ آیه‌های بالای آن رد می‌شوند).
_MAX_DP_COST_FLOOR = 10
_MAX_DP_COST_PER_SEGMENT = 1.5


class MappingPendingError(APIError):
    """نگاشت واج‌به‌کلمه در دسترس نیست — خروجی کلمه‌ای ممنوع است."""

    def __init__(self, reason: str = "") -> None:
        detail = (
            "نگاشت واج‌به‌کلمه (quran_text2phoneme.json) در مسیر "
            f"پیکربندی‌شده در دسترس نیست{': ' + reason if reason else ''}؛ "
            "تا آن زمان، مسیر Zipformer نمرهٔ کلمه‌ای نمی‌دهد و هیچ "
            "واجی به‌عنوان کلمه معرفی نمی‌شود."
        )
        super().__init__(503, "hifz_word_alignment_pending", detail)


@dataclass(frozen=True)
class Segment:
    """یک واحد واجی روی متن ارائه‌شده.

    `word_indices` شاخص‌های کلمه در متن ارائه‌شده (Tanzil، با بسمله
    و وقف) است. `phoneme` رشتهٔ واجیِ واحد است؛ None یعنی «رد
    خودکار» (نشانهٔ وقف): بی‌مصرف واج، خاکستری. `leading_waslah`
    یعنی نخستین کلمهٔ واحد با الفِ وصله (ٱ) شروع می‌شود و همزهٔ
    اولِ رشتهٔ واجی‌اش در خواندنِ پیوسته خوانده نمی‌شود.
    """

    word_indices: tuple[int, ...]
    phoneme: str | None
    leading_waslah: bool = False


# نشانه‌های کششِ مد در الفبای واجی: الف (U+0627)، الف خنجری
# (U+06E6)، واو کوچک (U+06E5). تکرارشان «مدت» است، نه واجِ تازه:
# نگاشت یک شمارِ ثابت می‌نویسد، بازشناس شمارِ شنیده‌شده را برمی‌گرداند
# و خوانندهٔ درست هم مد را ۲ یا ۴ یا ۶ می‌خواند. فروپاشیِ یک رشتهٔ
# پیاپی به یک نمونه، تطابق را از طولِ مد بی‌نیاز می‌کند (طولِ تجوید
# را بازشناس هرگز نمره نمی‌دهد) و همخوان‌ها — از جمله تشدید که با
# تکرارِ همخوان نوشته می‌شود (ررَ، ببِ، للَ) — دست‌نخورده می‌مانند.
PHONEME_LENGTH_MARKERS = frozenset({"ا", "ۦ", "ۥ"})


def collapse_phoneme_runs(s: str) -> str:
    """رشته‌های پیاپیِ نشانه‌های کشش مد را به یک نمونه فروبپاش.

    فقط برای نشانه‌های کشش (الف، الف خنجری، واو کوچک)؛ تکرارِ
    همخوان (تشدید) و بقیهٔ رشته دست نمی‌خورد. تابع خودمعکوس نیست،
    ولی روی رشتهٔ فروپاشیده بی‌اثر است، پس هر دو سویِ تطابق
    (رشتهٔ موردانتظار و بافرِ شنیده‌شده) را می‌توان با آن یکی کرد.
    """
    if not s:
        return s
    out: list[str] = []
    prev: str | None = None
    for ch in s:
        if ch == prev and ch in PHONEME_LENGTH_MARKERS:
            continue
        out.append(ch)
        prev = ch
    return "".join(out)


@dataclass
class ValidationReport:
    """گزارش اعتبارسنجیِ بارگذاری — برای گزارش نهایی، نه برای نمایش."""

    total_ayahs: int = 0
    accepted_ayahs: int = 0
    rejected: list[tuple[int, int, str]] = field(default_factory=list)
    token_failures: list[tuple[int, int, str]] = field(default_factory=list)
    cross_check_agree: int = 0
    cross_check_disagree: int = 0
    cross_check_missing: int = 0


def _load_tokens(path: Path) -> set[str]:
    """جدول Kaldi: هر خط «نماد شناسه»؛ `<blank>` هم جزو نمادهاست."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        # مسیر فایل و جزئیات OSError فقط در لاگ سرور؛ پیام عمومی،
        # عمومی می‌ماند (فاز ۱۱).
        logger.warning("hifz tokens.txt unreadable: %s", exc)
        raise MappingPendingError("خواندن جدول نمادهای واجی ناموفق بود") from exc
    symbols: set[str] = set()
    for line in lines:
        if not line.strip():
            continue
        symbol = line.rsplit(" ", 1)[0]
        if symbol:
            symbols.add(symbol)
    # دروازهٔ واقعیِ اعتبار، تجزیهٔ هر واج به نمادهای شناخته‌شده است
    # (در بارگذاری، پایین)؛ شمار نمادها (۲۵۱ در فایل واقعی) معیار
    # نیست — فایل کوچکِ کامل هم معتبر است (آزمون‌های مصنوعی).
    if "<blank>" not in symbols or not symbols:
        raise MappingPendingError(
            f"tokens.txt معتبر نیست ({len(symbols)} نماد)"
        )
    return symbols


def _segment_phonemes(text: str, symbols: set[str]) -> list[str] | None:
    """تجزیهٔ حریصانهٔ بلندترین‌تطابق به نمادها؛ None یعنی نماد ناشناخته.

    فقط برای اعتبارسنجی است (که رشتهٔ واجی فقط از نمادهای شناخته‌شده
    ساخته شده باشد)؛ تطابق زنده روی رشته انجام می‌شود، نه روی تجزیه،
    پس ابهام تجزیه روی نمره اثر نمی‌گذارد.
    """
    return _segment_with_index(text, _symbols_by_first(symbols))


def _symbols_by_first(symbols: set[str]) -> dict[str, list[str]]:
    """نمادها بر اساس حرف اول، بلندترین اول (برای تجزیهٔ سریع).

    `<blank>` هرگز نماد واجی نیست و از شاخص کنار گذاشته می‌شود.
    """
    by_first: dict[str, list[str]] = {}
    for s in symbols:
        if s and s != "<blank>":
            by_first.setdefault(s[0], []).append(s)
    for v in by_first.values():
        v.sort(key=len, reverse=True)
    return by_first


def _segment_with_index(
    text: str, by_first: dict[str, list[str]]
) -> list[str] | None:
    """تجزیهٔ حریصانهٔ بلندترین‌تطابق؛ None یعنی نماد ناشناخته.

    محدودکردن نامزدها به نمادهای هم‌حرف‌اول، نتیجه را عوض نمی‌کند
    (نمادی که با حرف جاری شروع نشود، در این موضع هرگز نمی‌خواند).
    """
    out: list[str] = []
    i = 0
    while i < len(text):
        for sym in by_first.get(text[i], []):
            if text.startswith(sym, i):
                out.append(sym)
                i += len(sym)
                break
        else:
            return None
    return out


def _levenshtein_bounded(a: str, b: str, bound: int) -> int:
    """فاصلهٔ ویرایش، با خروج زودهنگام: اگر فاصله از bound بگذرد،
    bound+1 برمی‌گردد (وقتی ≤ bound باشد، مقدار دقیق است).

    فقط در DP به‌کار می‌رود: گذاری که از بهترینِ کنونیِ سلول بدتر
    باشد، بی‌فایده است؛ پس محاسبهٔ کاملش لازم نیست. درستیِ خروج
    زودهنگام: کمینهٔ هر سطر، کرانِ پایینِ فاصلهٔ نهایی است (هر
    سناریوی ویرایش کامل، زیرسناریویی برای پیشوندهای آن سطر دارد).
    """
    if a == b:
        return 0
    if bound < 0:
        return bound + 1
    if abs(len(a) - len(b)) > bound:
        return bound + 1
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        row_min = cur[0]
        ca = a[i - 1]
        for j in range(1, len(b) + 1):
            cost = 0 if ca == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            row_min = min(row_min, cur[j])
        if row_min > bound:
            return bound + 1
        prev = cur
    return prev[len(b)] if prev[len(b)] <= bound else bound + 1


def _norm(text: str) -> str:
    """نرمال‌سازی برای هزینهٔ DP: نشانه‌های طول → مصوت بلند، حذف
    حرکات، تا کردن، فشرده‌سازی تکرارها (مد/غنه/تشدید، هویت نیست)."""
    text = text.replace("ۥ", "و").replace("ۦ", "ي")
    text = strip_diacritics(text)
    out: list[str] = []
    for ch in text:
        ch = _FOLD.get(ch, ch)
        if ch in (" ", "ـ"):
            continue
        if out and out[-1] == ch:
            continue
        out.append(ch)
    return "".join(out)


#: حروف شمسی/قمری برای تا کردن الِ وصله در نرمال‌ساز بهبودیافته.
_SOLAR_LETTERS = frozenset("تثدذرزسشصضطظلن")
_LUNAR_LETTERS = frozenset("ابجحخعغفقكمهوي")

#: پیشوندهای تک‌حرفی که الفِ وصله پس از آن‌ها هم ساکت است.
_WASLAH_PREFIXES = frozenset("وفبكل")


def _fold_waslah_al(text: str) -> str:
    """تا کردن الِ وصله در ابتدای کلمه (یا پس از پیشوند تک‌حرفی).

    فقط وقتی کلمه با «ٱل» (الف وصله + لام) آغاز شود — تشخیص بر
    مبنای ٱ (U+0671) در متن است، نه «ال» تاشده، تا «إِلَى» و
    «أُو۟لَـٰٓئِكَ» آسیب نبینند. حرفِ پس از «ال» شمسی باشد «ال»
    کامل حذف می‌شود، قمری باشد فقط «ا» حذف می‌شود (لام می‌ماند،
    چون در رشتهٔ واجی هست). متن ورودی باید بی‌حرکت باشد (پس از
    strip_diacritics) تا حرفِ پس از «ال» بی‌واسطه دیده شود.
    """
    start: int | None = None
    if text.startswith("ٱل"):
        start = 0
    elif len(text) >= 4 and text[0] in _WASLAH_PREFIXES and text[1:3] == "ٱل":
        start = 1
    if start is None:
        return text
    rest = text[start + 2 :]
    nxt = ""
    for ch in rest:
        if ch == "ـ":
            continue
        nxt = ch
        break
    if not nxt:
        return text
    letter = _FOLD.get(nxt, nxt)
    if letter in _SOLAR_LETTERS:
        return text[:start] + rest
    if letter in _LUNAR_LETTERS:
        return text[:start] + "ل" + rest
    return text


def _norm_relaxed(text: str) -> str:
    """نرمال‌ساز بهبودیافتهٔ گذر دوم — فقط برای آیه‌های ردشده در گذر اول.

    گونه‌های اعتبارسنجی‌شدهٔ Wave 1 (بخش ۳، §۵: V1 تا V5 + بسمله):
    - V1: الف خنجری ٰ → ا و ۧ → ي پیش از حذف حرکات (هر دو را
      strip_diacritics حذف می‌کند، در حالی که تلفظ می‌شوند).
    - V2: نمادهای تلفظی الفبای واجی — ں → ن، ۾ → م، حذف ڇ (قلقله).
    - V3: تا کردن الِ وصله (_fold_waslah_al).
    - V4: حذف پسوند «وا» در پایان کلمه (واو جماعتِ پایانی در واج نیست).
    - V5: همزهٔ روی کرسی ؤ/ئ → ا (سمت واجی همزهٔ برهنه می‌نویسد).
    فقط تابع هزینهٔ DP است؛ رشته‌های واجیِ خامِ قطعه‌ها و متن تنزیل
    دست نمی‌خورند. برای این ۵۱ آیه V4 و V5 خنثی بودند، ولی بخشی از
    بستهٔ اعتبارسنجی‌شده‌اند و با آن نگه داشته شده‌اند.
    """
    text = text.replace("ٰ", "ا").replace("ۧ", "ي")
    text = text.replace("ں", "ن").replace("۾", "م").replace("ڇ", "")
    text = text.replace("ؤ", "ء").replace("ئ", "ء")
    text = text.replace("ۥ", "و").replace("ۦ", "ي")
    text = strip_diacritics(text)
    text = _fold_waslah_al(text)
    out: list[str] = []
    for ch in text:
        ch = _FOLD.get(ch, ch)
        if ch in (" ", "ـ"):
            continue
        if out and out[-1] == ch:
            continue
        out.append(ch)
    norm = "".join(out)
    if len(norm) > 2 and norm.endswith("وا"):
        norm = norm[:-2]
    return norm


def _align_segments(
    phonetic_words: list[str],
    orth_words: list[str],
    norm: Callable[[str], str] | None = None,
) -> tuple[int, list[tuple[tuple[int, ...], tuple[int, ...]]]] | None:
    """DP مرز قطعه‌ها: (هزینه، [(شاخص‌های کلمه، شاخص‌های واج)]).

    `norm`: نرمال‌ساز هزینه (پیش‌فرض `_norm`؛ گذر دوم `_norm_relaxed`).
    گذارها: ۱ واج : ۱ کلمه، ۱ واج : ۲–۸ کلمه (ادغام در تلفظ پیوسته —
    زنجیره‌های ادغام تا ۷ کلمه در داده دیده شده است، پس سقف ۸ است تا
    سقف به مرز نچسبد)، ۲–۶ واج : ۱ کلمه (شکست حروف مقطعه). کلمهٔ
    تک‌واژه‌ای، میان‌بر است: همهٔ واحدهای واجی‌اش همان یک کلمه‌اند
    (حروف مقطعه همیشه کل آیه‌اند).
    """
    if not orth_words or not phonetic_words:
        return None
    if len(orth_words) == 1:
        return 0, [((0,), tuple(range(len(phonetic_words))))]
    m, n = len(phonetic_words), len(orth_words)
    _norm_fn = _norm if norm is None else norm
    pn = [_norm_fn(p) for p in phonetic_words]
    wn = [_norm_fn(w) for w in orth_words]
    inf = float("inf")
    dp = [[inf] * (n + 1) for _ in range(m + 1)]
    bt: list[list[tuple[int, int, tuple[int, ...], tuple[int, ...]] | None]] = [
        [None] * (n + 1) for _ in range(m + 1)
    ]
    dp[0][0] = 0
    for i in range(m + 1):
        for j in range(n + 1):
            if dp[i][j] == inf:
                continue
            c = dp[i][j]
            if i < m and j < n:
                tgt = dp[i + 1][j + 1]
                bound = len(pn[i]) + len(wn[j]) if tgt == inf else int(tgt - c - 1)
                nc = c + _levenshtein_bounded(pn[i], wn[j], bound)
                if nc < tgt:
                    dp[i + 1][j + 1] = nc
                    bt[i + 1][j + 1] = (i, j, (j,), (i,))
            for k in range(2, 9):
                if i < m and j + k - 1 < n:
                    tgt = dp[i + 1][j + k]
                    concat = "".join(wn[j : j + k])
                    bound = len(pn[i]) + len(concat) if tgt == inf else int(tgt - c - 1)
                    nc = c + _levenshtein_bounded(pn[i], concat, bound)
                    if nc < tgt:
                        dp[i + 1][j + k] = nc
                        bt[i + 1][j + k] = (i, j, tuple(range(j, j + k)), (i,))
            for k in range(2, 7):
                if i + k - 1 < m and j < n:
                    tgt = dp[i + k][j + 1]
                    concat = "".join(pn[i : i + k])
                    bound = len(concat) + len(wn[j]) if tgt == inf else int(tgt - c - 1)
                    nc = c + _levenshtein_bounded(concat, wn[j], bound)
                    if nc < tgt:
                        dp[i + k][j + 1] = nc
                        bt[i + k][j + 1] = (i, j, (j,), tuple(range(i, i + k)))
    if dp[m][n] == inf:
        return None
    cost = int(dp[m][n])
    segs: list[tuple[tuple[int, ...], tuple[int, ...]]] = []
    i, j = m, n
    while (i, j) != (0, 0):
        step = bt[i][j]
        if step is None:  # pragma: no cover - دفاعی
            return None
        pi, pj, ws, ps = step
        segs.append((ws, ps))
        i, j = pi, pj
    segs.reverse()
    return cost, segs


def _load_tanzil(path: Path) -> dict[int, dict[int, str]]:
    """خواندن Tanzil لفظ‌به‌لفظ (همان regex ارائه‌دهندهٔ متن)."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("hifz tanzil text unreadable: %s", exc)
        raise MappingPendingError("خواندن متن تنزیل ناموفق بود") from exc
    data: dict[int, dict[int, str]] = {}
    for line in raw.splitlines():
        m = _TANZIL_LINE_RE.match(line)
        if not m:
            continue
        data.setdefault(int(m.group(1)), {})[int(m.group(2))] = m.group(3)
    total = sum(len(v) for v in data.values())
    if len(data) != 114 or total != 6236:
        raise MappingPendingError("متن Tanzil ناقص است")
    return data


def _split_adjusted(
    tanzil: dict[int, dict[int, str]],
    surah: int,
    ayah: int,
    relaxed_basmalah: bool = False,
) -> tuple[list[str], list[str], dict[int, int]]:
    """متن ارائه‌شده → (کامل، تعدیل‌شده، نگاشت شاخص تعدیل‌شده→کامل).

    تعدیل: حذف بسملهٔ ابتدای آیهٔ ۱ (جز سوره‌های ۱ و ۹) و حذف
    نشانه‌های وقفِ تنها. ترتیب حفظ می‌شود، پس نگاشت یک‌به‌یک است.
    `relaxed_basmalah` (فقط گذر دوم): بسمله با مقایسهٔ صورت
    نرمال‌شده شناخته می‌شود، نه رشتهٔ دقیق — تنزیل در ۹۵:۱ و ۹۷:۱
    «بِّسْمِ» با شده می‌نویسد، در حالی که بسملهٔ مرجع (۱:۱) «بِسْمِ»
    بدون شده است؛ مقایسهٔ دقیق آن دو را جدا نمی‌کند و بسمله به‌عنوان
    کلمات آیه تراز می‌شود (هزینهٔ ۲۲ در برابر آستانهٔ ۱۰).
    """
    full = tanzil[surah][ayah].split()
    basmalah = tanzil[1][1].split()
    words = full
    offset = 0
    if ayah == 1 and surah not in (1, 9):
        if relaxed_basmalah:
            match = [_norm_relaxed(w) for w in words[:4]] == [
                _norm_relaxed(w) for w in basmalah
            ]
        else:
            match = words[:4] == basmalah
        if match:
            words = words[4:]
            offset = 4
    adjusted: list[str] = []
    index_map: dict[int, int] = {}
    for pos, word in enumerate(words):
        if len(word) == 1 and word in _PAUSE_MARKS:
            continue
        index_map[len(adjusted)] = offset + pos
        adjusted.append(word)
    return full, adjusted, index_map


class PhonemeMapping:
    """نگاشت بارگذاری‌شده: قطعه‌ها بر اساس متن ارائه‌شده."""

    def __init__(
        self,
        segments: dict[tuple[int, int], list[Segment]],
        report: ValidationReport,
    ) -> None:
        self._segments = segments
        self.report = report

    def segments_for(self, surah: int, ayah: int) -> list[Segment] | None:
        """قطعه‌های یک آیه (با بسمله و رد وقف)، یا None اگر پذیرفته نشده."""
        return self._segments.get((surah, ayah))

    def __call__(self, surah: int, ayah: int) -> list[Segment] | None:
        return self.segments_for(surah, ayah)


_cache: dict[str, PhonemeMapping] = {}
_cache_lock = threading.Lock()


def _resolve_dir(data_dir: str | Path | None) -> Path:
    if data_dir is not None:
        return Path(data_dir)
    env = os.environ.get(_MAP_DIR_ENV, "").strip()
    if env:
        return Path(env)
    return _DEFAULT_DIR


def map_files_present(data_dir: str | Path | None = None) -> tuple[bool, str]:
    """بررسی ارزانِ حضور فایل‌های نقشه — بدون بارگذاری (برای /status).

    فقط وجود و ناخالی بودن دو فایل لازم را می‌سنجد؛ اعتبارسنجی کامل
    (DP روی ۶٬۲۳۶ آیه) همان بار ۲۲۷ ثانیه‌ای است و موقع نمره‌دهی
    انجام می‌شود، نه این‌جا.
    """
    resolved = _resolve_dir(data_dir)
    for filename in (_ORDERED_FILE, _TOKENS_FILE):
        path = resolved / filename
        if not path.is_file() or path.stat().st_size == 0:
            # مسیر مطلق در پیام عمومی نمی‌آید (فاز ۱۱: نشت مسیر از
            # /hifz/status)؛ جزئیات در لاگ سرور می‌ماند.
            logger.warning("hifz phoneme map file missing or empty: %s", path)
            return False, "map file missing or empty"
    return True, ""


def _build_adjusted_segments(
    plist: list[str],
    pairs: list[tuple[tuple[int, ...], tuple[int, ...]]],
    adjusted: list[str],
    index_map: dict[int, int],
) -> list[Segment]:
    """ساختن قطعه‌های تعدیل‌شده از جفت‌های DP (گذر اول و دوم، یکسان).

    رشتهٔ واجیِ هر قطعه، به‌هم‌پیوستنِ رشته‌های خامِ واحدهای واجی‌اش
    است (تطابق زنده با همان رشتهٔ خام کار می‌کند)؛ شاخص‌ها با
    index_map به مبنای ارائه‌شده ترجمه می‌شوند.
    """
    segs: list[Segment] = []
    for word_idxs, phon_idxs in pairs:
        # Split groups (one word, several phonetic words): the
        # session matches the concatenated string (the stream has
        # no spaces between phonetic words).
        phon = "".join(plist[p] for p in phon_idxs)
        segs.append(
            Segment(
                word_indices=tuple(index_map[w] for w in word_idxs),
                phoneme=phon,
                leading_waslah=(
                    adjusted[word_idxs[0]].startswith("ٱ")
                    and phon.startswith("ء")
                ),
            )
        )
    return segs


def load_phoneme_mapping(data_dir: str | Path | None = None) -> PhonemeMapping:
    """بارگذاری + اعتبارسنجی نگاشت؛ نبود/خرابی → MappingPendingError."""
    resolved = _resolve_dir(data_dir)
    cache_key = str(resolved)
    with _cache_lock:
        if cache_key in _cache:
            return _cache[cache_key]
    ordered_path = resolved / _ORDERED_FILE
    tokens_path = resolved / _TOKENS_FILE
    if not ordered_path.is_file() or not tokens_path.is_file():
        raise MappingPendingError(
            f"پوشهٔ نگاشت یافت نشد: {resolved} "
            f"(انتظار { _ORDERED_FILE} و {_TOKENS_FILE})"
        )
    symbols = _load_tokens(tokens_path)
    # شاخص نمادها یک‌بار ساخته می‌شود (نه برای هر واج): وارسیِ
    # ۶۷ هزار واج با ساختِ دوبارهٔ شاخص در هر بار، دقیقه‌ها طول می‌کشد.
    symbols_by_first = _symbols_by_first(symbols)
    try:
        ordered = json.loads(ordered_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("hifz ordered phoneme map unreadable: %s", exc)
        raise MappingPendingError(
            "خواندن نگاشت واجی ناموفق بود"
        ) from exc
    # شمار دقیق مدخل‌ها معیار نیست: فایل ناقص، آیه‌های غایب را با
    # خطای صادقانه (نه تراز اشتباه) نشان می‌دهد؛ آیه‌های دارای مدخل،
    # هر یک جداگانه اعتبارسنجی می‌شوند. پوشش کلی، در آزمون دادهٔ
    # واقعی (نه در بارگذار) وارسی می‌شود.
    if not isinstance(ordered, dict) or not ordered:
        raise MappingPendingError(
            f"{_ORDERED_FILE} ساختار موردانتظار را ندارد "
            f"({len(ordered) if isinstance(ordered, dict) else 'نامعتبر'} مدخل)"
        )
    tanzil = _load_tanzil(_TANZIL_FILE)
    report = ValidationReport(total_ayahs=len(ordered))

    def _sort_key(k: object) -> tuple[int, int]:
        try:
            s, a = (int(x) for x in str(k).split(":"))
            return (s, a)
        except (ValueError, AttributeError):
            return (999, 999)

    # مرحلهٔ ۱: قطعه‌های تعدیل‌شدهٔ هر آیه (با رد بر اساس هزینه).
    # گذر اول دقیقاً با قاعده‌های پیشین تراز می‌کند؛ آیه‌های
    # پذیرفته‌شده دقیقاً همان قطعه‌های امروز را می‌گیرند.
    adjusted_segments: dict[tuple[int, int], list[Segment]] = {}
    basmalah_segments: list[Segment] | None = None
    # آیه‌های ردشده بر اثر هزینه، برای گذر دوم نگه داشته می‌شوند؛
    # ردشده‌های دیگر (نماد ناشناخته، مدخل نامعتبر، تراز ناممکن)
    # با نرمال‌ساز بهبودیافته درست نمی‌شوند و دوباره تراز نمی‌شوند
    # (ناممکن‌بودنِ DP فقط به شمارها بستگی دارد، نه به نرمال‌ساز).
    retry: list[tuple[int, int, list[str]]] = []
    for key in sorted(ordered, key=_sort_key):
        try:
            surah, ayah = (int(x) for x in str(key).split(":"))
        except (ValueError, AttributeError):
            report.rejected.append((0, 0, f"کلید نامعتبر: {key!r}"))
            continue
        entry = ordered[key]
        if not isinstance(entry, dict):
            report.rejected.append((surah, ayah, "مدخل نامعتبر"))
            continue
        plist = entry.get("aya_phonemes_list")
        if (
            not isinstance(plist, list)
            or not plist
            or not all(isinstance(p, str) and p for p in plist)
        ):
            report.rejected.append((surah, ayah, "فهرست واجی نامعتبر"))
            continue
        token_bad = [
            p for p in plist if _segment_with_index(p, symbols_by_first) is None
        ]
        if token_bad:
            report.token_failures.append((surah, ayah, token_bad[0]))
            report.rejected.append((surah, ayah, "نماد ناشناخته در رشتهٔ واجی"))
            continue
        try:
            _full, adjusted, _index_map = _split_adjusted(tanzil, surah, ayah)
        except KeyError:
            report.rejected.append((surah, ayah, "آیه در متن Tanzil نیست"))
            continue
        aligned = _align_segments(plist, adjusted)
        if aligned is None:
            report.rejected.append((surah, ayah, "تراز DP ناممکن"))
            continue
        cost, pairs = aligned
        if cost > max(_MAX_DP_COST_FLOOR, _MAX_DP_COST_PER_SEGMENT * len(pairs)):
            report.rejected.append(
                (surah, ayah, f"هزینهٔ تراز {cost} از آستانه گذشت")
            )
            retry.append((surah, ayah, plist))
            continue
        segs = _build_adjusted_segments(plist, pairs, adjusted, _index_map)
        adjusted_segments[(surah, ayah)] = segs
        if (surah, ayah) == (1, 1):
            basmalah_segments = segs

    # مرحلهٔ ۱٫۵ (گذر دوم): فقط آیه‌های ردشدهٔ بر اثر هزینه، با
    # نرمال‌ساز بهبودیافته (_norm_relaxed) و مقایسهٔ بسملهٔ
    # نرمال‌شده دوباره تراز می‌شوند. آستانه دست نمی‌خورد؛ اگر آیه‌ای
    # اینجا هم رد شد، همان ردِ صادقانهٔ گذر اول می‌ماند (۵۰۳).
    # با دادهٔ فعلی، هر ۵۱ آیهٔ ردشده اینجا پذیرفته می‌شوند و
    # ۶٬۱۸۵ آیهٔ گذر اول بایت‌به‌بایت دست‌نخورده می‌مانند.
    relaxed_keys: set[tuple[int, int]] = set()
    for surah, ayah, plist in retry:
        try:
            _full, adjusted, _index_map = _split_adjusted(
                tanzil, surah, ayah, relaxed_basmalah=True
            )
        except KeyError:
            continue
        aligned = _align_segments(plist, adjusted, norm=_norm_relaxed)
        if aligned is None:
            continue
        cost, pairs = aligned
        if cost > max(_MAX_DP_COST_FLOOR, _MAX_DP_COST_PER_SEGMENT * len(pairs)):
            continue
        segs = _build_adjusted_segments(plist, pairs, adjusted, _index_map)
        adjusted_segments[(surah, ayah)] = segs
        relaxed_keys.add((surah, ayah))
        if (surah, ayah) == (1, 1):
            basmalah_segments = segs
        report.rejected = [
            r for r in report.rejected if (r[0], r[1]) != (surah, ayah)
        ]

    # مرحلهٔ ۲: ترتیب ارائه‌شده (بسملهٔ اول + رد وقف در جای خود).
    # قطعه‌های مرحلهٔ ۱ از قبل شاخص ارائه‌شده دارند (ترجمه با
    # index_map)؛ اینجا فقط بسمله پیش می‌آید و رد وقف درهم می‌شود.
    final: dict[tuple[int, int], list[Segment]] = {}
    for (surah, ayah), segs in adjusted_segments.items():
        # آیه‌های گذر دوم با همان جداسازیِ بسملهٔ نرمال‌شدهٔ گذر دوم
        # بازسازی می‌شوند تا شاخص‌ها با قطعه‌هایشان بخوانند؛ بقیه
        # دقیقاً با جداسازیِ پیشین (بایت‌به‌بایت دست‌نخورده).
        full, _adjusted, _index_map = _split_adjusted(
            tanzil, surah, ayah, relaxed_basmalah=(surah, ayah) in relaxed_keys
        )
        out: list[Segment] = []
        if ayah == 1 and surah not in (1, 9):
            if basmalah_segments is None:
                report.rejected.append(
                    (surah, ayah, "قطعه‌های بسمله (۱:۱) در دسترس نیست")
                )
                continue
            out.extend(basmalah_segments)
        covered: dict[int, Segment] = {}
        for s in segs:
            for w in s.word_indices:
                covered[w] = s
        emitted: set[int] = set()
        for pos, word in enumerate(full):
            if pos in covered and id(covered[pos]) not in emitted:
                out.append(covered[pos])
                emitted.add(id(covered[pos]))
            elif pos not in covered and len(word) == 1 and word in _PAUSE_MARKS:
                out.append(Segment(word_indices=(pos,), phoneme=None))
        final[(surah, ayah)] = out
    report.accepted_ayahs = len(final)

    # مرحلهٔ ۳: وارسی متقاطع با quran_text2phoneme (گزارشی، نه دروازه).
    t2p_path = resolved / _TEXT2PHONEME_FILE
    if t2p_path.is_file():
        try:
            t2p = json.loads(t2p_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            t2p = None
        if isinstance(t2p, dict):
            for key, entry in ordered.items():
                if not isinstance(entry, dict):
                    continue
                text = entry.get("aya_text")
                plist = entry.get("aya_phonemes_list")
                if not isinstance(text, str) or not isinstance(plist, list):
                    continue
                if text not in t2p:
                    report.cross_check_missing += 1
                    continue
                if t2p[text] == " ".join(plist):
                    report.cross_check_agree += 1
                else:
                    report.cross_check_disagree += 1

    mapping = PhonemeMapping(final, report)
    with _cache_lock:
        _cache[cache_key] = mapping
    return mapping
