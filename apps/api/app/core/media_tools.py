"""آمادگی ابزارهای رسانه — B-04 (ADR-0027).

زنجیرهٔ ابزار رسانه باید داخل ایمیج production واقعاً باشد:
ffmpeg/ffprobe (پردازش رسانه)، tesseract با زبان‌های fas/ara/eng و
pdftoppm از poppler-utils (OCR)، و faster-whisper (STT) با مدلِ نام‌دار
و پین‌شده. پیش از B-04 هیچ‌کدام در Dockerfile نبود و تسک‌ها در سکوتِ
نرم‌افزاری fail می‌شدند؛ حالا:

- `media_tools_status()` وضعیت هر ابزار را می‌دهد (برای /health و تست).
- `assert_media_tools_ready()` در startup ورکر media صدا زده می‌شود و
  با ابزارِ غایب، CRITICAL لاگ می‌زند و RuntimeError پرتاب می‌کند —
  ورکر بالا نمی‌آید (fail loud)، به‌جای این‌که هر تسک جداگانه بسوزد.
- تسک‌ها هم هنگام اجرا خطای صریحِ نام‌دار برمی‌گردانند (نه سکوت).
"""
from __future__ import annotations

import importlib.util
import logging
import shutil

logger = logging.getLogger(__name__)

#: باینری‌های سیستمی لازم (نام → توضیح برای پیام خطا)
REQUIRED_BINARIES: dict[str, str] = {
    "ffmpeg": "پردازش رسانه (ffmpeg)",
    "ffprobe": "فرادادهٔ رسانه (ffmpeg)",
    "tesseract": "OCR (tesseract-ocr)",
    "pdftoppm": "رندر PDF برای OCR (poppler-utils)",
}

#: زبان‌های OCR که ایمیج باید داشته باشد (پک‌های tesseract-ocr-fas/ara/eng)
REQUIRED_TESSERACT_LANGS = ("fas", "ara", "eng")

#: موتور STT و مدل آن — نام‌دار و پین‌شده (B-04). نسخهٔ خود پکیج در
#: requirements.txt پین است (faster-whisper==1.2.1)؛ مدل از مخزن رسمی
#: Systran روی HuggingFace با همین نام resolve می‌شود.
STT_ENGINE = "faster-whisper"
FASTER_WHISPER_MODEL = "small"


def faster_whisper_installed() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


_langs_cache: tuple[float, list[str] | None] | None = None
_LANGS_TTL_S = 60.0


def tesseract_langs() -> list[str] | None:
    """زبان‌های نصب‌شدهٔ tesseract — None یعنی خود باینری نیست.

    نتیجه ۶۰ ثانیه کش می‌شود تا pollهای /health زیرفرایند نسازند.
    """
    global _langs_cache
    import time

    now = time.monotonic()
    if _langs_cache is not None and now - _langs_cache[0] < _LANGS_TTL_S:
        return _langs_cache[1]
    result = _tesseract_langs_uncached()
    _langs_cache = (now, result)
    return result


def _tesseract_langs_uncached() -> list[str] | None:
    exe = shutil.which("tesseract")
    if exe is None:
        return None
    import subprocess

    try:
        out = subprocess.run(
            [exe, "--list-langs"],
            capture_output=True, text=True, timeout=15, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    langs: list[str] = []
    for line in (out.stdout + "\n" + out.stderr).splitlines():
        line = line.strip()
        if line and not line.startswith("List of available languages"):
            langs.append(line)
    return langs


def media_tools_status() -> dict:
    """وضعیت کامل زنجیرهٔ ابزار — بدون بارگذاری مدل یا اجرای سنگین."""
    binaries = {name: shutil.which(name) for name in REQUIRED_BINARIES}
    langs = tesseract_langs()
    missing: list[str] = [n for n, p in binaries.items() if p is None]
    langs_missing: list[str] = []
    if langs is not None:
        langs_missing = [l for l in REQUIRED_TESSERACT_LANGS if l not in langs]
        if langs_missing:
            missing.append("tesseract-langs:" + "+".join(langs_missing))
    fw = faster_whisper_installed()
    if not fw:
        missing.append(STT_ENGINE)
    return {
        "binaries": binaries,
        "tesseract_langs": langs,
        "faster_whisper": fw,
        "stt_engine": STT_ENGINE,
        "stt_model": FASTER_WHISPER_MODEL,
        "missing": missing,
        "ready": not missing,
    }


def assert_media_tools_ready() -> dict:
    """گیت startup ورکر media — ابزار غایب = CRITICAL + RuntimeError.

    ورکر media بدون این ابزارها هیچ کار مفیدی نمی‌تواند بکند؛ بالا
    آمدنِ ساکتِ آن یعنی صف پر از تسک‌های سوخته. پس fail loud.
    """
    status = media_tools_status()
    if not status["ready"]:
        logger.critical(
            "media worker startup BLOCKED — missing media tools: %s "
            "(image must ship ffmpeg, tesseract-ocr + fas/ara/eng, "
            "poppler-utils and faster-whisper==pinned; see ADR-0027)",
            ", ".join(status["missing"]),
        )
        raise RuntimeError(
            "media tools missing: " + ", ".join(status["missing"])
        )
    logger.info(
        "media tools ready: %s (STT %s model=%s)",
        {k: bool(v) for k, v in status["binaries"].items()},
        STT_ENGINE,
        FASTER_WHISPER_MODEL,
    )
    return status
