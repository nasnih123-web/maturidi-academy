# نتایج تست — hardening/audit-pass-1

**تاریخ:** 2026-10-19 | محیط: sandbox لینوکس (بدون PostgreSQL، بدون rustc، بدون docker daemon)

## نسخهٔ ابزارها

| ابزار | نسخه |
|---|---|
| Python | 3.12.3 |
| pytest | 8.3.4 |
| alembic | 1.14.0 |
| semgrep | 1.181.0 |
| pip-audit | 2.10.1 |
| ruff | 0.17.1 |
| mypy | 2.4.0 (۱۴۱ خطای pre-existing — non-blocking) |
| Node | v24.20.0 |

## سوئیت کامل API

```bash
cd ~/workspace/maturidi-academy/apps/api
MATURIDI_TEST_DB=/tmp/maturidi_test_integration.db .venv/bin/python -m pytest tests/ -q -p no:cacheprovider
```

| اجرا | نتیجه |
|---|---|
| Track A (پس از اصلاحات امنیتی) | **435 passed, 3 xfailed, 0 failed** (۲۲۷s) |
| Track B (پس از اصلاحات زیرساختی) | **436 passed, 3 xfailed, 0 failed** (۷۵۷s) |
| Track C | 427 passed, 3 xfailed, **4 failed** — هر ۴ مربوط به کارِ در جریان Track A یا فلاک زیرساختی بودند، نه کد Track C |
| **تجمیع نهایی (همهٔ ترک‌ها)** | **436 passed, 3 xfailed, 0 failed** (۷۴۰s) — `MATURIDI_TEST_DB=/tmp/maturidi_test_integration.db` |

## تست‌های جدید این پاس

| فایل | تعداد | پوشش |
|---|---|---|
| `tests/test_hardening_track_a.py` | ۹ | negative: TOTP اجباری ادمین، توکن مرحلهٔ اول، reuse واقعی refresh، race هم‌زمان، claim رزرو |
| `tests/test_hardening_track_a_ws.py` | ۷ | negative: تیکت WS (انقضا/reuse)، اشتراک غیرمجاز کانال، replay با cursor معتبر/نامعتبر (با uvicorn واقعی) |
| `tests/test_infra_track_b.py` | ۵ | fail-fast اسرار، setup از cwd متفاوت، health، قطع Redis، **drill واقعی backup→restore** |
| `tests/test_module_boundaries.py` | ۳ | نگهبان: بدون چرخه بودن گراف import، انضباط `models.py`، برگ ماندن `content/legal.py` |

## اسکن‌ها

```bash
semgrep --config auto apps/api          # → 0 findings (پس از رفع B2)
.venv/bin/python -m bandit -r apps/api/app   # → تمیز (۷ B613 مستند فاز ۱۷)
pip-audit                                   # → pyjwt/cryptography/multipart تمیز پس از ارتقا
ruff check <فایل‌های تغییریافته>            # → تمیز
```

## بلاکرها (تست‌نشده، سبزwashing نشده)

1. **PostgreSQL واقعی** — migration روی SQLite راستی‌آزمایی شد (۱۸ revision خطی، head `f17a0b1c2d3e`)؛ رفتار PG-specific (مثل `FOR UPDATE SKIP LOCKED`) تست نشد.
2. **docker build / compose config** — بدون docker daemon؛ باید روی هاست داکر اجرا شود.
3. **npm audit** — پروکسی sandbox به registry با 403 جواب داد.
4. **بیلد موبایل/دسکتاپ native** — بدون toolchain (Expo/Rust) در sandbox.
5. **ClamAV** — نصب نیست و هیچ مسیر اسکن ویروسی در کد وجود ندارد (grep روی
   کل `apps/api/app` هیچ ارجاعی به clamav/malware-scan ندارد)؛ ادعای «مسیر
   اسکن فایل» در نسخهٔ قبلی این سند نادقیق بود و با این اصلاحیه تصحیح می‌شود
   (Track 3 — remediation pass 2). هیچ ادعای «اسکن شد» در کد یا UI نیست
   (راستی‌آزمایی شد)؛ ClamAV طبق ADR-0007 به فاز استقرار موکول شده است.
   کنترل‌های فعلی آپلود: سقف حجم جریانی، triple-check پسوند+MIME+magic-byte،
   نام فایل سیستمی (uuid)، رد PDF با جاوااسکریپت جاسازی‌شده (Track 3).
6. **تست a11y فاز ۱۷** در اجرای Track A به دلیل کرش harness نود در sandbox فیل شد (سرور dev روی :13102 جواب نداد) — رگرسیون نیست؛ در اجرای Track B سبز بود.
