"""جستجوی صوتی قرآن (Voice Search) — فاز ۱۰ قرآن.

رابط مستقل از session grading: ضبط کوتاه → رونویسی → نامزدهای
سوره:آیه. match احتمالی هرگز قطعی جلوه داده نمی‌شود: هر نامزد برچسب
`probable` (تطابق قوی) یا `possible` (تطابق ضعیف) دارد و پاسخ صریحاً
می‌گوید «احتمالی است، قطعی نیست»؛ کاربر نتیجه را از میان نامزدها
انتخاب می‌کند.

دو مسیر رونویسی:
- word-level (Whisper و ماک‌ها): کلمه‌های شنیده‌شده با پنجرهٔ لغزان
  روی متن تنزیل مقایسه می‌شوند (هم‌پوشانی توکن + نسبت SequenceMatcher
  روی بهترین نامزدها).
- phoneme-level (Zipformer): رشتهٔ واجی با موتور locate فاز ۶
  (`locate_ayah`) در همهٔ سوره‌ها جست‌وجو می‌شود؛ نامزدهای با
  تطابقِ دست‌کم ۲۴ حرف واجی `probable`‌اند، کوتاه‌ترها `possible`.
  نبود نگاشت → ۵۰۳ صادقانه؛ رشتهٔ واجیِ خیلی کوتاه → ۴۲۲.
"""

from __future__ import annotations

import difflib
import re
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError

from . import hifz_mapping, hifz_service, hifz_stream

_TANZIL_PATH = Path(__file__).resolve().parent / "data" / "tanzil_uthmani.txt"

_ARABIC_LETTERS = re.compile(r"[^\u0621-\u064A\u0671-\u06D3\u06FA-\u06FC\u06FF]+")
_TASHKEEL = re.compile(r"[\u064B-\u0652\u0670\u06D6-\u06ED]")


def normalize_arabic(text: str) -> str:
    """نرمال‌سازی برای تطابق: حذف تشکیله و تطویل، یکسان‌سازی الف/ی/ک."""
    text = _TASHKEEL.sub("", text)
    text = text.replace("\u0640", "")  # تطویل (ـ) حرف نیست؛ در تنزیل هست.
    text = text.replace("\u0671", "\u0627").replace("\u0622", "\u0627")
    text = text.replace("\u0623", "\u0627").replace("\u0625", "\u0627")
    text = text.replace("\u0649", "\u064A").replace("\u06CC", "\u064A")
    text = text.replace("\u06A9", "\u0643").replace("\u0629", "\u0647")
    return text


def _load_tanzil() -> list[tuple[int, int, list[str]]]:
    """متن تنزیل: فهرست (سوره، آیه، کلمه‌های نرمال‌شده)."""
    ayahs: list[tuple[int, int, list[str]]] = []
    for line in _TANZIL_PATH.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 2)
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        words = [normalize_arabic(w) for w in parts[2].split() if w]
        words = [w for w in words if _ARABIC_LETTERS.sub("", w)]
        if words:
            ayahs.append((int(parts[0]), int(parts[1]), words))
    return ayahs


_TANZIL_CACHE: list[tuple[int, int, list[str]]] | None = None


def tanzil_ayahs() -> list[tuple[int, int, list[str]]]:
    global _TANZIL_CACHE
    if _TANZIL_CACHE is None:
        _TANZIL_CACHE = _load_tanzil()
    return _TANZIL_CACHE


def rank_word_candidates(
    heard_words: list[str],
    *,
    top_n: int = 5,
    ayahs: list[tuple[int, int, list[str]]] | None = None,
) -> list[dict]:
    """رتبه‌بندی نامزدها از کلمه‌های شنیده‌شده (خالص، تست‌پذیر).

    امتیاز هر پنجره = هم‌پوشانیِ توکن‌های شنیده‌شده با پنجره (Jaccard
    روی چندمجموعه)؛ برای ۲۰ نامزد برتر، نسبت SequenceMatcher روی
    رشتهٔ به‌هم‌پیوسته هم حساب می‌شود و امتیاز نهایی میانگینِ
    وزنیِ آن‌هاست. `probable` وقتی نسبتِ نهایی ≥ ۰٫۸ است، وگرنه
    `possible`. هرگز `certain` برنمی‌گردد.
    """
    heard = [normalize_arabic(w) for w in heard_words if w]
    heard = [w for w in heard if _ARABIC_LETTERS.sub("", w)]
    if len(heard) < 2:
        return []
    heard_set = set(heard)
    ayah_list = ayahs if ayahs is not None else tanzil_ayahs()
    scored: list[tuple[float, int, int, str]] = []
    m = len(heard)
    for surah, ayah, words in ayah_list:
        if len(words) < m:
            continue
        best = 0.0
        best_text = ""
        for start in range(len(words) - m + 1):
            window = words[start : start + m]
            overlap = len(heard_set & set(window)) / max(1, len(heard_set | set(window)))
            if overlap > best:
                best = overlap
                best_text = " ".join(window)
        if best > 0:
            scored.append((best, surah, ayah, best_text))
    scored.sort(key=lambda t: t[0], reverse=True)
    results: list[dict] = []
    for overlap, surah, ayah, text in scored[:20]:
        ratio = difflib.SequenceMatcher(
            None, " ".join(heard), text
        ).ratio()
        score = round(0.6 * overlap + 0.4 * ratio, 4)
        results.append(
            {
                "surah": surah,
                "ayah": ayah,
                "match_text": text,
                "score": score,
                "confidence": "probable" if score >= 0.8 else "possible",
            }
        )
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_n]


def rank_phoneme_candidates(
    phoneme_text: str,
    *,
    top_n: int = 5,
    locate_fn=None,
) -> list[dict]:
    """رتبه‌بندی نامزدها از رشتهٔ واجی با locate فاز ۶ (خالصِ تزریقی).

    locate_fn(surah, buf) -> (ayah, found_len) | None. نامزد با
    found_len ≥ ۲۴ «probable» است (کف اثبات locate)، کوتاه‌تر
    «possible». ترتیب بر اساس found_len.
    """
    if locate_fn is None:
        raise ValueError("locate_fn is required")
    buf = hifz_stream.collapse_phoneme_runs(phoneme_text)
    if len(buf) < 8:
        return []
    found: list[tuple[int, int, int]] = []
    for surah in range(1, 115):
        hit = locate_fn(surah, buf)
        if hit is not None:
            ayah, found_len = hit
            found.append((found_len, surah, ayah))
    found.sort(reverse=True)
    results = []
    for found_len, surah, ayah in found[:top_n]:
        results.append(
            {
                "surah": surah,
                "ayah": ayah,
                "match_text": None,
                "score": round(min(1.0, found_len / 40.0), 4),
                "confidence": "probable" if found_len >= 24 else "possible",
                "matched_phoneme_chars": found_len,
            }
        )
    return results


async def voice_search(
    db: AsyncSession,
    wav_bytes: bytes,
    transcriber: object | None = None,
) -> dict:
    """جستجوی صوتی: WAV کوتاه → رونویسی → نامزدهای احتمالی."""
    hifz_service.validate_wav_16k_mono(wav_bytes)
    engine_id, transcription, level = await hifz_service._transcribe(
        db, wav_bytes, transcriber
    )
    if level == "phoneme":
        mapping = hifz_mapping.load_phoneme_mapping()
        phoneme_text = "".join(
            w.text for w in transcription.words if w.text != "<blank>"
        )
        if len(hifz_stream.collapse_phoneme_runs(phoneme_text)) < 8:
            raise APIError(
                422,
                "hifz_voice_search_too_short",
                "صدای شنیده‌شده برای جست‌وجو خیلی کوتاه است؛ آیه را کامل‌تر بخوانید.",
            )
        def _locate(surah: int, buf: str):
            hit = hifz_stream.locate_ayah(
                mapping, surah, buf, return_length=True
            )
            if hit is None:
                return None
            ayah, _pos, found_len = hit
            return (ayah, found_len)

        candidates = rank_phoneme_candidates(phoneme_text, locate_fn=_locate)
    else:
        heard = [w.text for w in transcription.words if w.text]
        if len(heard) < 2:
            raise APIError(
                422,
                "hifz_voice_search_too_short",
                "صدای شنیده‌شده برای جست‌وجو خیلی کوتاه است؛ آیه را کامل‌تر بخوانید.",
            )
        candidates = rank_word_candidates(heard)
    return {
        "engine_used": engine_id,
        "level": level,
        "candidates": candidates,
        "note": "نتیجه‌ها احتمالی‌اند، نه قطعی؛ از میان نامزدها انتخاب کنید.",
    }
