"""دارایی‌های نسخه‌دار تشخیص حفاظ (مدل Zipformer + نقشه‌های واج).

پیش از گام ۳ برابری با ترتیل، فایل‌ها فقط از URLهای متغیر محیطی
دانلود می‌شدند و هیچ چک‌سامی در کار نبود: نصبِ تمیز (بدون آن
متغیرها) هیچ‌چیز نمی‌گرفت و کل نمره‌دهی کلمه‌ای ۵۰۳ می‌داد، و
فایلِ ناقص/خرابِ موجود هم «موجود» حساب می‌شد. حالا مبدأ، یک
مانیفستِ نسخه‌دارِ داخل ریپوست (`hifz_assets_manifest.json`، کنار
همین فایل): هر دارایی شناسهٔ درایو، حجم دقیق و SHA-256 دارد و
نشانیِ دانلود پیش‌فرض از همان شناسه ساخته می‌شود. پس:

- نصبِ تمیز بدون هیچ متغیر محیطی هم دارایی‌ها را می‌گیرد و
  راستی‌آزمایی می‌کند (مسیرهای پیش‌فرض زیر).
- فایل موجود فقط وقتی «سالم» است که حجم و چک‌سامش با مانیفست
  بخواند؛ وگرنه دوباره دانلود می‌شود (خودترمیمی).
- متغیرهای محیطیِ URL (`HIFZ_MODEL_URL` و ...) همچنان override
  اند؛ محتوای override مسئولیت اپراتور است و چک‌سامِ مانیفست
  رویش اعمال نمی‌شود (فقط ناخالی بودن لازم است — رفتار پیشین).
- ناموفق بودن هر دانلود هرگز استارت را نمی‌شکند — در آن صورت
  موتور همان خطای صادقانهٔ ۵۰۳ را می‌دهد.

مسیرهای پیش‌فرض (وقتی متغیر مقصد ست نشده):
- مدل: `app/modules/quran/data/hifz_model/` (همان‌جا که
  `hifz_engines` در نبودِ `HIFZ_ZIPFORMER_MODEL_DIR` می‌خواند)
- نقشه: `app/modules/quran/data/phoneme/` (پیش‌فرضِ خودِ
  `hifz_mapping` در نبودِ `QURAN_PHONEME_MAP_DIR`)

خودِ باینری‌ها در گیت کامیت نمی‌شوند (gitignore)؛ مانیفست و این
اسکریپت، قرارداد نسخه‌دارِ آن‌هاست. اجرا از start.sh با
`python -m app.core.hifz_assets`؛ خروجی همیشه ۰ است.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_MODEL_DIR_ENV = "HIFZ_ZIPFORMER_MODEL_DIR"
_MAP_DIR_ENV = "QURAN_PHONEME_MAP_DIR"

_APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = _APP_DIR / "modules" / "quran" / "data" / "hifz_model"
DEFAULT_MAP_DIR = _APP_DIR / "modules" / "quran" / "data" / "phoneme"

_MANIFEST_PATH = Path(__file__).resolve().parent / "hifz_assets_manifest.json"
_URL_TEMPLATE = "https://drive.usercontent.google.com/download?id={drive_id}&export=download&confirm=t"

_TIMEOUT_SECONDS = 300
_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class AssetSpec:
    """یک دارایی از مانیفست نسخه‌دار."""

    key: str  # مثل "model/model.int8.onnx" (کلیدِ گزارشِ دانلود)
    dir_role: str  # "model" | "phoneme"
    filename: str
    size: int
    sha256: str
    drive_id: str
    url_env: str

    @property
    def default_url(self) -> str:
        return _URL_TEMPLATE.format(drive_id=self.drive_id)


def load_manifest() -> list[AssetSpec]:
    """مانیفست نسخه‌دار را بخوان؛ خرابی‌اش خطای برنامه‌نویسی است."""
    raw = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    specs = []
    for item in raw["assets"]:
        specs.append(
            AssetSpec(
                key=item["key"],
                dir_role=item["dir"],
                filename=item["filename"],
                size=int(item["size"]),
                sha256=item["sha256"],
                drive_id=item["drive_id"],
                url_env=item["url_env"],
            )
        )
    return specs


def _dest_dir(dir_role: str) -> Path:
    env = _MODEL_DIR_ENV if dir_role == "model" else _MAP_DIR_ENV
    raw = os.environ.get(env, "").strip()
    if raw:
        return Path(raw)
    return DEFAULT_MODEL_DIR if dir_role == "model" else DEFAULT_MAP_DIR


def _sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(_CHUNK_SIZE)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _verified(path: Path, spec: AssetSpec) -> bool:
    """فایل موجود فقط با حجم + چک‌سامِ مانیفست «سالم» است."""
    try:
        if path.stat().st_size != spec.size:
            return False
    except OSError:
        return False
    return _sha256_of(path) == spec.sha256


def _download(url: str, dest: Path, spec: AssetSpec | None) -> int:
    """دانلود اتمی؛ با spec، حجم و چک‌سام هم حین نوشتن وارسی می‌شود."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    request = urllib.request.Request(url, headers={"User-Agent": "maturidi-academy-hifz-assets/1"})
    total = 0
    h = hashlib.sha256()
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response, open(tmp, "wb") as out:
            while True:
                chunk = response.read(_CHUNK_SIZE)
                if not chunk:
                    break
                out.write(chunk)
                h.update(chunk)
                total += len(chunk)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    if total == 0:
        tmp.unlink(missing_ok=True)
        raise ValueError(f"empty download for {dest.name}")
    if spec is not None and (total != spec.size or h.hexdigest() != spec.sha256):
        tmp.unlink(missing_ok=True)
        raise ValueError(
            f"checksum mismatch for {dest.name} "
            f"(size {total}, sha256 {h.hexdigest()[:12]}…)"
        )
    os.replace(tmp, dest)
    logger.info("hifz asset downloaded: %s (%d bytes)", dest.name, total)
    return total


def download_all() -> dict[str, str]:
    """همهٔ دارایی‌ها را بگیر/راستی‌آزمایی کن؛ هرگز exception نمی‌دهد."""
    results: dict[str, str] = {}
    for spec in load_manifest():
        dest = _dest_dir(spec.dir_role) / spec.filename
        override = os.environ.get(spec.url_env, "").strip()
        url = override or spec.default_url
        # چک‌سامِ مانیفست فقط روی محتوای خودِ مانیفست اعمال می‌شود؛
        # override اپراتور با همان قانون پیشین (ناخالی = موجود) است.
        check: AssetSpec | None = None if override else spec
        try:
            if dest.exists() and dest.stat().st_size > 0:
                if check is None:
                    results[spec.key] = f"ok ({dest.stat().st_size} bytes)"
                    continue
                if _verified(dest, spec):
                    results[spec.key] = f"ok (verified, {spec.size} bytes)"
                    continue
                logger.warning(
                    "hifz asset failed verification, re-downloading: %s", spec.key
                )
            size = _download(url, dest, check)
            results[spec.key] = f"ok ({size} bytes)"
        except Exception as exc:  # noqa: BLE001 — دانلود نباید بوت را بشکند
            results[spec.key] = f"failed: {exc}"
            logger.warning("hifz asset download failed: %s: %s", spec.key, exc)
    return results


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    for key, status in download_all().items():
        logger.info("hifz asset %s: %s", key, status)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
