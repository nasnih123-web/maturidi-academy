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
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.core.errors import APIError

from .alignment import strip_diacritics

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
    خودکار» (نشانهٔ وقف): بی‌مصرف واج، خاکستری.
    """

    word_indices: tuple[int, ...]
    phoneme: str | None


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
        raise MappingPendingError(f"tokens.txt خوانده نشد: {exc}") from exc
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


def _align_segments(
    phonetic_words: list[str], orth_words: list[str]
) -> tuple[int, list[tuple[tuple[int, ...], tuple[int, ...]]]] | None:
    """DP مرز قطعه‌ها: (هزینه، [(شاخص‌های کلمه، شاخص‌های واج)]).

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
    pn = [_norm(p) for p in phonetic_words]
    wn = [_norm(w) for w in orth_words]
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
        raise MappingPendingError(f"متن Tanzil خوانده نشد: {exc}") from exc
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
    tanzil: dict[int, dict[int, str]], surah: int, ayah: int
) -> tuple[list[str], list[str], dict[int, int]]:
    """متن ارائه‌شده → (کامل، تعدیل‌شده، نگاشت شاخص تعدیل‌شده→کامل).

    تعدیل: حذف بسملهٔ ابتدای آیهٔ ۱ (جز سوره‌های ۱ و ۹) و حذف
    نشانه‌های وقفِ تنها. ترتیب حفظ می‌شود، پس نگاشت یک‌به‌یک است.
    """
    full = tanzil[surah][ayah].split()
    basmalah = tanzil[1][1].split()
    words = full
    offset = 0
    if ayah == 1 and surah not in (1, 9) and words[:4] == basmalah:
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


def load_phoneme_mapping(data_dir: str | Path | None = None) -> PhonemeMapping:
    """بارگذاری + اعتبارسنجی نگاشت؛ نبود/خرابی → MappingPendingError."""
    resolved = _resolve_dir(data_dir)
    key = str(resolved)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
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
        raise MappingPendingError(f"{_ORDERED_FILE} خوانده نشد: {exc}") from exc
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
    adjusted_segments: dict[tuple[int, int], list[Segment]] = {}
    basmalah_segments: list[Segment] | None = None
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
            continue
        segs: list[Segment] = []
        for word_idxs, phon_idxs in pairs:
            # Split groups (one word, several phonetic words): the
            # session matches the concatenated string (the stream has
            # no spaces between phonetic words).
            segs.append(
                Segment(
                    word_indices=tuple(_index_map[w] for w in word_idxs),
                    phoneme="".join(plist[p] for p in phon_idxs),
                )
            )
        adjusted_segments[(surah, ayah)] = segs
        if (surah, ayah) == (1, 1):
            basmalah_segments = segs

    # مرحلهٔ ۲: ترتیب ارائه‌شده (بسملهٔ اول + رد وقف در جای خود).
    # قطعه‌های مرحلهٔ ۱ از قبل شاخص ارائه‌شده دارند (ترجمه با
    # index_map)؛ اینجا فقط بسمله پیش می‌آید و رد وقف درهم می‌شود.
    final: dict[tuple[int, int], list[Segment]] = {}
    for (surah, ayah), segs in adjusted_segments.items():
        full, _adjusted, _index_map = _split_adjusted(tanzil, surah, ayah)
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
        _cache[key] = mapping
    return mapping
