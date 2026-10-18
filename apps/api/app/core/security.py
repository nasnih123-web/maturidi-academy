"""امنیت — فاز ۰ §۲.

- هش رمز عبور: Argon2id
- Access token کوتاه‌مدت (۱۵ دقیقه، HS256) + رفرش‌توکن opaque با rotation
- 2FA = TOTP (+ کدهای بازیابی یک‌بارمصرف با هش)
- Rate limiter حافظه‌ای برای dev — در production با Redis جایگزین شود.
"""
from __future__ import annotations

import hashlib
import secrets as pysecrets
import time
from collections import defaultdict, deque

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import get_settings
from app.core.errors import APIError

_ph = PasswordHasher()  # Argon2id پیش‌فرض argon2-cffi


# ---------- رمز عبور ----------

def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False


# ---------- JWT (access, کوتاه‌مدت) ----------

def create_access_token(user_id: str, extra: dict | None = None) -> str:
    settings = get_settings()
    now = int(time.time())
    payload: dict = {
        "sub": user_id,
        "type": "access",
        "iat": now,
        "exp": now + settings.access_token_expire_minutes * 60,
        "jti": pysecrets.token_hex(8),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise APIError(401, "token_expired", "توکن منقضی شده است")
    except jwt.InvalidTokenError:
        raise APIError(401, "invalid_token", "توکن نامعتبر است")
    if payload.get("type") != "access":
        raise APIError(401, "invalid_token", "توکن نامعتبر است")
    return payload


# ---------- رفرش‌توکن opaque (فقط هش در DB) ----------

def generate_refresh_token() -> str:
    return pysecrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------- TOTP (فاز ۰ §۲ — پیامکی نه، TOTP) ----------

def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account: str, issuer: str = "Maturidi Academy") -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=account, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    try:
        return bool(pyotp.TOTP(secret).verify(code, valid_window=1))
    except Exception:
        return False


def generate_recovery_codes(n: int = 10) -> list[str]:
    return [f"{pysecrets.token_hex(2)}-{pysecrets.token_hex(2)}".upper() for _ in range(n)]


# ---------- Rate limiter حافظه‌ای (dev) ----------

class RateLimiter:
    """پنجرهٔ لغزان ساده + قفل موقت بعد از عبور از سقف.

    در production باید با Redis (ثابت بین instanceها) جایگزین شود.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._locked_until: dict[str, float] = {}

    def is_allowed(self, key: str, limit: int, window_s: int, lock_s: int = 900) -> bool:
        now = time.time()
        if self._locked_until.get(key, 0) > now:
            return False
        dq = self._hits[key]
        while dq and dq[0] <= now - window_s:
            dq.popleft()
        if len(dq) >= limit:
            self._locked_until[key] = now + lock_s
            return False
        dq.append(now)
        return True

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)
        self._locked_until.pop(key, None)


rate_limiter = RateLimiter()
