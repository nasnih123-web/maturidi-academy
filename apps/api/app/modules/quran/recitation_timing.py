"""زمان‌بندی کلمه‌به‌کلمهٔ تلاوت — حالت گوش‌دادن/دنبال‌کردن (listen mode).

منبع: Quran.com API v4 — عمومی، بدون کلید و بدون ورود
(`GET /api/v4/chapter_recitations/{reciter_id}/{surah}?segments=true`).
برای هر سوره یک فایل صوتی کامل + برای هر آیه `timestamp_from/to` و
سگمنت‌های کلمه `[word, start_ms, end_ms]` (زمان‌ها نسبت به ابتدای
فایل سوره‌اند؛ این‌جا به زمانِ نسبت به ابتدای آیه تبدیل می‌شوند تا
هایلایت با ساعتِ صوتِ همان آیه هم‌گام شود).

قاری‌های پشتیبانی‌شده (شناسهٔ Quran.com v4):
- alafasy (مشاری راشد العفاسی) = 7
- abdul_basit (عبدالباسط عبدالصمد، مرتل) = 2
- husary (محمود خلیل الحصری، مرتل) = 6

صوت باندل نمی‌شود — `audio_url` همان فایل سوره از QuranicAudio است و
هنگام اجرا استریم می‌شود. دادهٔ زمان‌بندی در حافظه کش می‌شود (داده
ثابت است؛ تلاوت‌ها عوض نمی‌شوند).

منبعِ نهاییِ موردنظر، منابع QUL است (عفاسی 118، عبدالباسط 115،
حصری 110 — نسخهٔ آیه‌به‌آیه با سگمنت) که دانلودشان نیازمند حساب
کاربری است؛ تا وقتی آن فایل‌ها دانلود و باندل نشده‌اند، همین منبع
کار می‌کند. شکل خروجیِ این ماژول عمداً همان شکلِ دادهٔ QUL است
(آیه + سگمنت‌های کلمه با start/end میلی‌ثانیه) تا جایگزینیِ منبع،
بدون تغییرِ قراردادِ فرانت‌اند انجام شود.

سگمنت‌های ناقص (تک‌عضوی، مثل `[1]`) نادیده گرفته می‌شوند؛ `duration`
منفی در بعضی پاسخ‌ها دیده شده و به آن اعتماد نمی‌شود
(`to - from` حساب می‌شود).

منبع دوم (گام ۱۰ برابری): زمان‌بندی **تولیدشده با تراز واجی** برای
editionهای عربیِ محصول، از صوت آیه‌به‌آیهٔ EveryAyah — دادهٔ
باندل‌شده در `data/timings/` با مانیفست پیشرفت؛ قرارداد و مسیرش
جداست (`get_generated_timing`) چون صوتش فایلِ خودِ آیه است، نه
فایل سوره. جزئیات و پوشش در مانیفست همان پوشه است.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

import httpx

from .providers import _proxy_from_env

logger = logging.getLogger(__name__)

_QURAN_COM_BASE = "https://api.quran.com/api/v4"
_TIMEOUT = 15.0
_RETRY_ATTEMPTS = 2
_RETRY_BACKOFF = 0.5

# شناسهٔ قاری در Quran.com API v4 — مرتل (Murattal) برای هر سهٔ
# پیشین؛ بقیه در فاز ۱۰ از فهرست زندهٔ همان API اضافه شدند
# (GET /api/v4/resources/recitations، خوانده‌شده ۲۰۲۶-۱۱-۰۷):
# 1 عبدالباسط (مجود)، 3 سدیس، 4 شاطری، 5 هانی رفاعی، 8 منشاوی
# (مجود)، 9 منشاوی (مرتل)، 10 شریم، 11 طبلاوی، 12 حصری (معلم).
# منبع صوت: همان API، فایل کامل سوره (MP3، استریم از audio_url؛
# باندل/میرور نمی‌شود). Attribution: Quran.com / QuranicAudio.
# کیفیت: فایل سوره‌ای با سگمنت‌های کلمه (segments=true)؛ برای قاریِ
# مجود/معلم هم همان قرارداد سگمنت برقرار است ولی زمان‌بندیِ کلمه‌ای
# ممکن است در بعضی سوره‌ها ناقص باشد — نبودِ سگمنت یعنی ۵۰۳
# صادقانه، نه fallback بی‌صدا.
RECITERS: dict[str, int] = {
    "alafasy": 7,
    "abdul_basit": 2,
    "husary": 6,
    "abdul_basit_mujawwad": 1,
    "sudais": 3,
    "shatri": 4,
    "hani_rifai": 5,
    "minshawi_mujawwad": 8,
    "minshawi": 9,
    "shuraym": 10,
    "tablawi": 11,
    "husary_muallim": 12,
}

RECITER_LABELS: dict[str, str] = {
    "alafasy": "مشاری راشد العفاسی",
    "abdul_basit": "عبدالباسط عبدالصمد",
    "husary": "محمود خلیل الحصری",
    "abdul_basit_mujawwad": "عبدالباسط عبدالصمد (مجود)",
    "sudais": "عبدالرحمن السدیس",
    "shatri": "ابوبکر الشاطری",
    "hani_rifai": "هانی الرفاعی",
    "minshawi_mujawwad": "محمد صدیق المنشاوی (مجود)",
    "minshawi": "محمد صدیق المنشاوی",
    "shuraym": "سعود الشریم",
    "tablawi": "محمد الطبلاوی",
    "husary_muallim": "محمود خلیل الحصری (معلم)",
}

# کشِ حافظه‌ای: (reciter, surah) → خروجیِ نرمال‌شده. داده ثابت است.
_CACHE: dict[tuple[str, int], dict] = {}


class RecitationTimingError(Exception):
    """زمان‌بندی تلاوت در دسترس نیست — روتر به ۵۰۳ صادقانه تبدیلش می‌کند."""

    code = "recitation_timing_unavailable"


def _normalize(reciter: str, surah: int, audio_url: str, timestamps: list) -> dict:
    """سگمنت‌های سوره‌محورِ Quran.com را به آیه‌محور تبدیل می‌کند.

    خروجی: {"reciter", "surah", "audio_url", "source", "ayahs": [
    {"ayah", "from_ms", "to_ms", "duration_ms", "words": [
    {"word", "start_ms", "end_ms"}]}]} — زمانِ کلمات نسبت به ابتدای
    همان آیه است (شروعِ آیه = ۰) و با ساعتِ صوتِ همان آیه هم‌گام است.
    """
    ayahs: list[dict] = []
    for entry in timestamps:
        if not isinstance(entry, dict):
            continue
        verse_key = entry.get("verse_key", "")
        try:
            ayah_no = int(str(verse_key).split(":")[1])
        except (IndexError, ValueError):
            continue
        from_ms = entry.get("timestamp_from")
        to_ms = entry.get("timestamp_to")
        if not isinstance(from_ms, int) or not isinstance(to_ms, int):
            continue
        if to_ms <= from_ms:
            continue
        words: list[dict] = []
        seen: set[int] = set()
        for seg in entry.get("segments") or []:
            # فقط سگمنت کامل [word, start, end]؛ تک‌عضوی‌ها ناقص‌اند.
            # زمان‌ها گاهی float می‌آیند (مثلاً 1040.0) — به int تبدیل
            # می‌شوند؛ bool هرگز زمان نیست.
            if not isinstance(seg, list) or len(seg) != 3:
                continue
            word_no, start, end = seg
            if isinstance(word_no, bool) or not isinstance(word_no, (int, float)):
                continue
            if isinstance(start, bool) or not isinstance(start, (int, float)):
                continue
            if isinstance(end, bool) or not isinstance(end, (int, float)):
                continue
            word_no = int(word_no)
            start = int(start)
            end = int(end)
            if word_no in seen or word_no < 1:
                continue
            if end <= start:
                continue
            rel_start = max(0, start - from_ms)
            rel_end = max(0, end - from_ms)
            if rel_end <= rel_start:
                continue
            seen.add(word_no)
            words.append(
                {"word": word_no, "start_ms": rel_start, "end_ms": rel_end}
            )
        words.sort(key=lambda w: w["start_ms"])
        ayahs.append(
            {
                "ayah": ayah_no,
                "from_ms": from_ms,
                "to_ms": to_ms,
                "duration_ms": to_ms - from_ms,
                "words": words,
            }
        )
    ayahs.sort(key=lambda a: a["ayah"])
    return {
        "reciter": reciter,
        "surah": surah,
        "audio_url": audio_url,
        "source": "quran_com_v4",
        "ayahs": ayahs,
    }


async def get_recitation_timing(reciter: str, surah: int) -> dict:
    """زمان‌بندی کلمه‌ایِ یک سوره برای یک قاری (کش‌شده).

    خطا → RecitationTimingError (کد recitation_timing_unavailable)؛
    روتر آن را به ۵۰۳ صادقانه تبدیل می‌کند، نه fallback بی‌صدا.
    """
    if reciter not in RECITERS:
        raise RecitationTimingError(f"unknown reciter: {reciter}")
    if not 1 <= surah <= 114:
        raise RecitationTimingError(f"invalid surah: {surah}")
    cached = _CACHE.get((reciter, surah))
    if cached is not None:
        return cached
    url = (
        f"{_QURAN_COM_BASE}/chapter_recitations"
        f"/{RECITERS[reciter]}/{surah}?segments=true"
    )
    last_exc: Exception | None = None
    for attempt in range(_RETRY_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(
                timeout=_TIMEOUT, proxy=_proxy_from_env()
            ) as client:
                resp = await client.get(url)
            if resp.status_code == 429 or resp.status_code >= 500:
                last_exc = httpx.HTTPStatusError(
                    f"upstream {resp.status_code}",
                    request=resp.request, response=resp,
                )
                await asyncio.sleep(_RETRY_BACKOFF * (attempt + 1))
                continue
            if resp.status_code != 200:
                raise RecitationTimingError(
                    f"quran.com returned HTTP {resp.status_code}"
                )
            try:
                body = resp.json()
            except ValueError as exc:
                raise RecitationTimingError(f"invalid JSON: {exc}") from exc
            audio_file = body.get("audio_file") if isinstance(body, dict) else None
            if not isinstance(audio_file, dict):
                raise RecitationTimingError("missing audio_file")
            audio_url = audio_file.get("audio_url")
            timestamps = audio_file.get("timestamps")
            if not isinstance(audio_url, str) or not audio_url:
                raise RecitationTimingError("missing audio_url")
            if not isinstance(timestamps, list) or not timestamps:
                raise RecitationTimingError("missing timestamps")
            result = _normalize(reciter, surah, audio_url, timestamps)
            if not result["ayahs"]:
                raise RecitationTimingError("no ayahs in response")
            _CACHE[(reciter, surah)] = result
            return result
        except RecitationTimingError:
            raise
        except httpx.HTTPError as exc:
            last_exc = exc
            logger.warning(
                "recitation timing attempt %d failed: %s", attempt + 1, exc
            )
            await asyncio.sleep(_RETRY_BACKOFF * (attempt + 1))
    raise RecitationTimingError(
        f"quran.com unreachable after {_RETRY_ATTEMPTS + 1} attempts: {last_exc}"
    )


# ---------------------------------------------------------------------------
# زمان‌بندی تولیدشده با تراز واجی اجباری (گام ۱۰ برابری، ایراد ۱۰) —
# دادهٔ باندل‌شده‌ای که scripts/generate_reciter_timings.py از صوت
# آیه‌به‌آیهٔ EveryAyah با همان خط لولهٔ واجی گام ۹ تولید می‌کند.
# قراردادش با منبع Quran.com فرق دارد و قاطی نمی‌شود: صوت این‌جا
# فایلِ خودِ آیه است و زمانِ کلمه‌ها نسبت به ابتدای همان فایل است؛
# پس خروجی به‌ازای هر آیه audio_url خودش را دارد و from/to سوره‌ای
# ندارد. کلمه‌ای که تراز برایش بازه نداده (جاافتاده) سگمنت ندارد —
# زمان ساختگی هرگز ساخته نمی‌شود.
# ---------------------------------------------------------------------------

_GENERATED_DIR = Path(__file__).resolve().parent / "data" / "timings"


def _generated_manifest() -> dict:
    try:
        body = json.loads(
            (_GENERATED_DIR / "manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return {}
    return body if isinstance(body, dict) else {}


def generated_available() -> dict[str, int]:
    """edition → شمار سوره‌های کاملِ تولیدشده (از مانیفست پیشرفت).

    ویرایش‌های ‎-2‎ در مانیفست به‌عنوان شریکِ قاری پایه ثبت شده‌اند
    و پوشش پایه را گزارش می‌کنند.
    """
    manifest = _generated_manifest()
    out: dict[str, int] = {}
    for edition, entry in (manifest.get("editions") or {}).items():
        if isinstance(entry, dict):
            done = len(entry.get("surahs_done") or [])
            if done:
                out[edition] = done
    for alias, base in (manifest.get("shared") or {}).items():
        if base in out:
            out[alias] = out[base]
    return out


def get_generated_timing(edition: str, surah: int) -> dict:
    """زمان‌بندی تولیدشدهٔ یک سوره برای یک edition (دادهٔ محلی).

    نبود داده → RecitationTimingError (روتر ۵۰۳ صادقانه می‌دهد)؛
    این مسیر هرگز به درون‌یابی یا منبع زنده نمی‌افتد.
    """
    if not 1 <= surah <= 114:
        raise RecitationTimingError(f"invalid surah: {surah}")
    manifest = _generated_manifest()
    base = (manifest.get("shared") or {}).get(edition, edition)
    entry = (manifest.get("editions") or {}).get(base) or {}
    if surah not in (entry.get("surahs_done") or []):
        # فایل نیمه‌تمامِ در حال تولید سرو نمی‌شود؛ فقط سورهٔ کامل.
        raise RecitationTimingError(
            f"no generated timing for {edition} surah {surah}"
        )
    path = _GENERATED_DIR / base / f"{surah:03d}.json"
    if not path.is_file():
        raise RecitationTimingError(
            f"no generated timing for {edition} surah {surah}"
        )
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RecitationTimingError(
            f"generated timing unreadable for {edition} surah {surah}: {exc}"
        ) from exc
    ayahs = []
    try:
        for entry in body.get("ayahs") or []:
            words = [
                {
                    "word": int(w["word"]),
                    "start_ms": int(w["start_ms"]),
                    "end_ms": int(w["end_ms"]),
                }
                for w in entry.get("words") or []
                if int(w["end_ms"]) > int(w["start_ms"])
            ]
            words.sort(key=lambda w: w["start_ms"])
            ayahs.append(
                {
                    "ayah": int(entry["ayah"]),
                    "audio_url": entry.get("audio_url"),
                    "duration_ms": int(entry.get("duration_ms") or 0),
                    "words": words,
                }
            )
    except (ValueError, KeyError, TypeError) as exc:
        raise RecitationTimingError(
            f"generated timing malformed for {edition} surah {surah}: {exc}"
        ) from exc
    if not ayahs:
        raise RecitationTimingError(
            f"generated timing empty for {edition} surah {surah}"
        )
    ayahs.sort(key=lambda a: a["ayah"])
    return {
        "reciter": edition,
        "surah": surah,
        "source": "phoneme_alignment",
        "ayahs": ayahs,
    }
