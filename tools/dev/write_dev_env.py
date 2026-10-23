#!/usr/bin/env python3
"""ساخت فایل‌های env توسعهٔ محلی (FIX2-06 — ADR-0048).

bootstrap.sh / bootstrap.ps1 این اسکریپت را صدا می‌زنند تا به‌جای
کپی کورکورانهٔ .env.example (که برای production/staging نوشته شده)
یک env صریحِ «فقط توسعهٔ محلی» ساخته شود:

- APP_ENV=dev و دیتابیس SQLite محلی (مسیر بدون Docker بوت‌استرپ).
- CAPTCHA_ENABLED=false با توضیح روشن: در dev محلی کلید Turnstile
  نیست و حالت پیش‌فرض (fail-closed) ثبت‌نام را ۵۰۳ می‌کند؛ خاموشی
  فقط همین‌جا و صریح است — production باید کلید واقعی بگذارد.
- CLAMAV_ALLOW_INSECURE_DEV_BYPASS=true با هشدار بلند: پرچم ناامنِ
  فقط-dev خود پروژه (C-01) که در APP_ENV=dev اثر دارد و هر استفاده‌اش
  CRITICAL لاگ می‌شود؛ جایگزین درست، اجرای clamd محلی یا سرویس
  clamav در compose و false کردن این پرچم است.
- secretهای تصادفی تازه برای همین نصب (هرگز مقدار نمونهٔ
  CHANGE_ME یا secret ثابتِ داخل ریپو).

فایل موجود هرگز بازنویسی نمی‌شود؛ اگر هر دو فایل باشند، هیچ‌کاری
نمی‌کند و ۰ برمی‌گردد.
"""
from __future__ import annotations

import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

_HEADER = """# ===== محیط توسعهٔ محلی (LOCAL DEV ONLY) — ساخته‌شده توسط bootstrap =====
# این فایل را tools/dev/write_dev_env.py ساخته است. مقادیرش فقط برای
# اجرای محلیِ بدون Docker امن‌اند؛ برای staging/production از
# .env.example + گارد secrets خود اپ استفاده کنید و هرگز این فایل را
# به سرور کپی نکنید.
"""

_BODY = """APP_ENV=dev
APP_NAME=Maturidi Academy API
APP_BASE_URL=http://localhost:8000

# دیتابیس محلی سبک (بدون Docker) — فایل dev.db کنار API ساخته می‌شود.
DATABASE_URL=sqlite+aiosqlite:///./dev.db
REDIS_URL=redis://localhost:6379/0

# --- کپچای ثبت‌نام (C-02) ---
# در توسعهٔ محلی کلید Turnstile نداریم و رفتار پیش‌فرض پروژه
# fail-closed است (ثبت‌نام با 503 captcha_not_configured رد می‌شود)،
# پس صریحاً و فقط برای همین محیط محلی خاموش است. در production
# هرگز خاموش نکنید؛ TURNSTILE_SECRET_KEY واقعی بگذارید.
CAPTCHA_ENABLED=false
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# --- اسکن ویروس آپلودها (C-01) ---
# !!! هشدار: بای‌پس ناامنِ فقط-dev روشن است !!!
# روی این ماشین clamd اجرا نمی‌شود، پس برای این‌که آپلود در dev
# محلی کار کند، پرچم CLAMAV_ALLOW_INSECURE_DEV_BYPASS روشن شده
# است: آپلودها در این محیط اسکن ویروس نمی‌شوند و هر بار CRITICAL
# لاگ می‌شود. این پرچم در APP_ENV غیر dev هیچ اثری ندارد و سیاست
# production همچنان fail-closed است. راه درستِ dev: clamd محلی
# (یا `docker compose up -d clamav`) + CLAMAV_HOST=localhost و
# برگرداندن این پرچم به false.
CLAMAV_HOST=localhost
CLAMAV_PORT=3310
CLAMAV_ALLOW_INSECURE_DEV_BYPASS=true

# --- ذخیرهٔ فایل: محلی (بدون MinIO) ---
STORAGE_PROVIDER=local
STORAGE_LOCAL_DIR=./storage

# --- CORS وب و CRM محلی ---
CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:5173

# --- secretهای همین نصب (تصادفی ساخته شده‌اند؛ به‌اشتراک نگذارید) ---
JWT_SECRET={jwt_value}
ENCRYPTION_KEY={enc_value}
ENCRYPTION_KEY_VERSION=1
"""


def render_env() -> str:
    jwt_value = secrets.token_urlsafe(43)
    enc_value = secrets.token_urlsafe(32)
    return _HEADER + _BODY.format(jwt_value=jwt_value, enc_value=enc_value)


def write_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        print(f"  {path} از قبل هست — دست نخورد ✓")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  ساخت {path} (env توسعهٔ محلی) ✓")
    return True


def main() -> int:
    content = render_env()
    created_root = write_if_missing(ROOT / ".env", content)
    created_api = write_if_missing(ROOT / "apps" / "api" / ".env", content)
    if created_root or created_api:
        print("  !!! توجه: CAPTCHA در dev محلی خاموش و بای‌پس ClamAV روشن است"
              " — فقط برای همین ماشین توسعه؛ جزئیات داخل فایل env.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
