"""رمزنگاری مقادیر حساس platform_settings — فاز ۰ §۳ + rotation (M-05).

- کلید از env/secrets manager می‌آید، هرگز از دیتابیس یا ریپو.
- خروجی یک envelope نسخه‌دار است: {"v": key_version, "data": "<fernet token>"}
- **چرخش کلید (rotation):** `ENCRYPTION_KEYS` یک JSON map نسخه→کلید
  است (مثلاً `{"1": "...", "2": "..."}`). خواندن: هر نسخه‌ای که در
  map هست (یا نسخهٔ جاری از `ENCRYPTION_KEY` قدیمی) خوانده می‌شود.
  نوشتن: همیشه با `ENCRYPTION_KEY_VERSION` جاری. پس چرخش امن است:
  کلید تازه را به map اضافه و نسخهٔ جاری را بالا ببرید؛ مقادیر قدیمی
  خوانا می‌مانند و با `reencrypt_all` (تدریجی) به نسخهٔ جاری مهاجرت
  می‌کنند؛ وقتی شماری نماند، کلید قدیمی را از map حذف کنید.
"""
from __future__ import annotations

import base64
import hashlib
import json

from cryptography.fernet import Fernet

from app.core.config import get_settings

_keys_cache: dict[int, str] | None = None


def _keys_map() -> dict[int, str]:
    """map نسخه→کلید از ENCRYPTION_KEYS (JSON) — parse تنبل + cache."""
    global _keys_cache
    if _keys_cache is not None:
        return _keys_cache
    raw = get_settings().encryption_keys.strip()
    parsed: dict[int, str] = {}
    if raw:
        try:
            data = json.loads(raw)
            parsed = {int(v): str(k) for v, k in data.items()}
        except (ValueError, AttributeError) as exc:
            raise ValueError(
                "ENCRYPTION_KEYS must be a JSON object mapping version -> key"
            ) from exc
    _keys_cache = parsed
    return parsed


def reset_keys_cache() -> None:
    """برای تست‌ها و reload کانفیگ."""
    global _keys_cache
    _keys_cache = None


def _key_material(version: int) -> str:
    """مادهٔ کلید یک نسخه: اول map چرخش، بعد کلید تکیِ قدیمی (نسخهٔ جاری)."""
    keys = _keys_map()
    if version in keys:
        return keys[version]
    settings = get_settings()
    if version == settings.encryption_key_version:
        return settings.encryption_key
    raise ValueError(f"unsupported encryption key version: {version}")


def _fernet_for_version(version: int) -> Fernet:
    raw = hashlib.sha256(_key_material(version).encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_value(plaintext: str) -> dict:
    """رمزنگاری با نسخهٔ جاری — تنها مسیر نوشتن."""
    settings = get_settings()
    token = _fernet_for_version(settings.encryption_key_version).encrypt(
        plaintext.encode("utf-8")
    )
    return {"v": settings.encryption_key_version, "data": token.decode("utf-8")}


def decrypt_value(envelope: dict) -> str:
    """رمزگشایی هر نسخه‌ای که کلیدش در دسترس است (قدیمی یا جاری)."""
    plaintext = _fernet_for_version(int(envelope["v"])).decrypt(
        envelope["data"].encode("utf-8")
    )
    return plaintext.decode("utf-8")


def envelope_version(envelope: dict) -> int:
    return int(envelope["v"])


def reencrypt_envelope(envelope: dict) -> dict | None:
    """اگر envelope با نسخهٔ قدیمی است، همان plaintext با نسخهٔ جاری.

    اگر از قبل جاری است None برمی‌گردد (بدون کار). رمزگشاییِ نسخهٔ
    ناشناخته ValueError می‌دهد — caller باید آن را به‌عنوان «کلید
    گمشده» گزارش کند، نه اینکه بی‌سروصدا رد شود.
    """
    settings = get_settings()
    if envelope_version(envelope) == settings.encryption_key_version:
        return None
    return encrypt_value(decrypt_value(envelope))
