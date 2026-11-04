"""دانلود استارتاپ فایل‌های حفاظ (مدل Zipformer + نقشهٔ واج).

فایل‌ها هرگز در ریپو کامیت نمی‌شوند؛ کانتینر موقع استارت آن‌ها را از
URLهایی که در متغیرهای محیطی آمده می‌گیرد (در استقرار فعلی: گوگل
درایو با لینک Anyone-with-link). ناموفق بودن هر دانلود هرگز استارت
را نمی‌شکند — در آن صورت موتور همان خطای صادقانهٔ ۵۰۳ را می‌دهد.

متغیرها (همه URL کامل‌اند؛ هیچ توکنی در آن‌ها نیست):
- HIFZ_MODEL_URL: فایل ‎.onnx مدل (ترجیحاً int8)
- HIFZ_TOKENS_URL: جدول tokens.txt (در هر دو پوشه کپی می‌شود)
- HIFZ_MAP_ORDERED_URL: ordered_quran_phonemes.json
- HIFZ_MAP_TEXT2PHONEME_URL: quran_text2phoneme.json
- HIFZ_ZIPFORMER_MODEL_DIR / QURAN_PHONEME_MAP_DIR: مقصدها

اجرا از start.sh با `python -m app.core.hifz_assets`؛ خروجی همیشه ۰ است.
"""

from __future__ import annotations

import logging
import os
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

_MODEL_DIR_ENV = "HIFZ_ZIPFORMER_MODEL_DIR"
_MAP_DIR_ENV = "QURAN_PHONEME_MAP_DIR"

# (متغیر URL، زیرپوشهٔ مقصد، نام فایل) — tokens.txt در هر دو پوشه لازم است.
_FILES: tuple[tuple[str, str, str], ...] = (
    ("HIFZ_MODEL_URL", "model", "model.int8.onnx"),
    ("HIFZ_TOKENS_URL", "model", "tokens.txt"),
    ("HIFZ_TOKENS_URL", "phoneme", "tokens.txt"),
    ("HIFZ_MAP_ORDERED_URL", "phoneme", "ordered_quran_phonemes.json"),
    ("HIFZ_MAP_TEXT2PHONEME_URL", "phoneme", "quran_text2phoneme.json"),
)

_TIMEOUT_SECONDS = 300
_CHUNK_SIZE = 1024 * 1024


def _download(url: str, dest: Path) -> int:
    """دانلود یک فایل با نوشتن اتمی؛ فایل موجود و ناخالی رد می‌شود."""
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("hifz asset exists, skipping: %s", dest.name)
        return dest.stat().st_size
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    request = urllib.request.Request(url, headers={"User-Agent": "maturidi-academy-hifz-assets/1"})
    total = 0
    with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response, open(tmp, "wb") as out:
        while True:
            chunk = response.read(_CHUNK_SIZE)
            if not chunk:
                break
            out.write(chunk)
            total += len(chunk)
    if total == 0:
        tmp.unlink(missing_ok=True)
        raise ValueError(f"empty download for {dest.name}")
    os.replace(tmp, dest)
    logger.info("hifz asset downloaded: %s (%d bytes)", dest.name, total)
    return total


def download_all() -> dict[str, str]:
    """همهٔ فایل‌های پیکربندی‌شده را می‌گیرد؛ هرگز exception نمی‌دهد."""
    bases = {
        "model": os.environ.get(_MODEL_DIR_ENV, "").strip(),
        "phoneme": os.environ.get(_MAP_DIR_ENV, "").strip(),
    }
    results: dict[str, str] = {}
    for url_env, subdir, filename in _FILES:
        url = os.environ.get(url_env, "").strip()
        base = bases[subdir]
        dest = Path(base) / filename if base else None
        key = f"{subdir}/{filename}"
        if not url or dest is None:
            results[key] = "skipped (not configured)"
            continue
        try:
            size = _download(url, dest)
            results[key] = f"ok ({size} bytes)"
        except Exception as exc:  # noqa: BLE001 — دانلود نباید بوت را بشکند
            results[key] = f"failed: {exc}"
            logger.warning("hifz asset download failed: %s: %s", key, exc)
    return results


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    for key, status in download_all().items():
        logger.info("hifz asset %s: %s", key, status)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
