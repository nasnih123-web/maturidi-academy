"""رمزنگاری مقادیر حساس platform_settings — فاز ۰ §۳.

- کلید از env/secrets manager می‌آید، هرگز از دیتابیس یا ریپو.
- خروجی یک envelope نسخه‌دار است: {"v": key_version, "data": "<fernet token>"}
  تا rotation کلید در آینده ممکن باشد (مقادیر قدیمی با کلید نسخهٔ قدیم خوانده می‌شوند).
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import get_settings


def _fernet_for_version(version: int) -> Fernet:
    settings = get_settings()
    if version != settings.encryption_key_version:
        # در آینده: نسخه‌های قدیم کلید از secrets manager خوانده می‌شوند.
        raise ValueError(f"unsupported encryption key version: {version}")
    raw = hashlib.sha256(settings.encryption_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt_value(plaintext: str) -> dict:
    settings = get_settings()
    token = _fernet_for_version(settings.encryption_key_version).encrypt(plaintext.encode("utf-8"))
    return {"v": settings.encryption_key_version, "data": token.decode("utf-8")}


def decrypt_value(envelope: dict) -> str:
    plaintext = _fernet_for_version(int(envelope["v"])).decrypt(envelope["data"].encode("utf-8"))
    return plaintext.decode("utf-8")
