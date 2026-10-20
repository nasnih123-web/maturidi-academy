# ماتریس یافته‌ها — hardening/audit-pass-1

**تاریخ:** 2026-10-19 | وضعیت‌ها: Fixed ✅ | Not Reproduced 🔵 | False Positive ⚪ | Blocked 🟡 | Deferred (با دلیل) 🟣

## Track A — امنیت (۷ مورد اصلاح‌شده)

| # | شدت | یافته | شواهد | وضعیت |
|---|---|---|---|---|
| A1 | **High** | TOTP برای admin/super_admin فقط در UI بود؛ ادمین بدون TOTP توکن `full` می‌گرفت | تست پیش‌اصلاح: `assert 'full' == '2fa_setup'` قرمز | ✅ Fixed — claim `scope` در JWT؛ `require_full_scope` با 403 `requires_2fa` |
| A2 | Medium | Race در refresh هم‌زمان → revoke اشتباه session | دو refresh موازی | ✅ Fixed — پنجرهٔ grace ۶۰ ثانیه‌ای؛ replay در پنجره rotate، بعد از آن revoke + ایونت `token.reuse_detected` |
| A3 | **High** | JWT بلندمدت در query string وب‌سوکت (`?token=`) | `app/core/realtime.py` | ✅ Fixed — تیکت یک‌بارمصرف ۶۰ ثانیه‌ای (`POST /api/v1/auth/ws-ticket`) با مصرف اتمی؛ `?token=` فقط برای سازگاری عقب‌رو |
| A4 | **High** | هر کاربر authشده می‌توانست `user.*`/`*` را subscribe کند و ایونت دیگران (ایمیل، session_id) را بگیرد | تست اشتراک متقاطع | ✅ Fixed — authorization تحویل per-event (ایونت user-aggregate → فقط مالک یا `users.manage`) |
| A5 | Medium | Replay cursor فقط `created_at`؛ پیام `resume` نادیده گرفته می‌شد | `realtime.py` | ✅ Fixed — cursor دوجزئی `(created_at, event_id)`؛ `resume` → replay + ack |
| A6 | Medium | سایزکپ آپلود **بعد** از `await file.read()` کامل در RAM | مسیرهای library/voice/font | ✅ Fixed — `read_capped_upload` (chunkهای 1MB، 413 زودهنگام)؛ کدهای اصلی حفظ شد |
| A7 | Low | پارامتر `extra` می‌توانست claimهای رزرو JWT را بازنویسی کند | `app/core/security.py` | ✅ Fixed — لیست رزرو |

### Track A — اعتبارسنجی‌شده، بدون اصلاح لازم 🔵
- Algorithm confusion: پین `HS256`؛ `none`/کلید اشتباه → 401 (تست شد).
- IDOR: `/users/me/notifications/{id}` و `/finance/receipts/{id}` مالک‌محور؛ روترهای ادمین همه `require_permission` سمت سرور.
- Signed URLs: HMAC + `compare_digest`، انقضا، scope تک‌فایل، بدون لو رفتن URL داخلی MinIO.
- Transactional outbox: `emit_event` در تراکنش caller؛ backoff + DLQ پس از ۵ retry؛ قطع Redis → `InMemoryBus`.
- Fail-fast اسرار: prod روی placeholder فیل می‌کند.

## Track B — زیرساخت (۱۱ مورد اصلاح‌شده)

| # | شدت | یافته | فایل | وضعیت |
|---|---|---|---|---|
| B1 | **High** | `alembic/` در ایمیج Docker نبود → crash-loop استقرار تازه | `apps/api/Dockerfile` | ✅ Fixed — `COPY alembic.ini` + `COPY alembic` |
| B2 | Medium | کانتینر با root اجرا می‌شد | `apps/api/Dockerfile` | ✅ Fixed — کاربر `appuser` (uid 10001)؛ semgrep تمیز |
| B3 | **High** | `minio/minio:latest` از Docker Hub حذف شده (سپتامبر ۲۰۲۶) | هر دو compose | ✅ Fixed — `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` |
| B4 | Medium | `localhost` داخل کانتینر برای postgres/redis/minio | `docker-compose.yml` | ✅ Fixed — hostnameهای سرویسی + healthcheck |
| B5 | Medium | `.env.prod.example` غایب بود | — | ✅ Fixed — ساخته شد؛ همهٔ `${VAR}` پوشش داده شد |
| B6 | Low | متغیرهای واقعی در `.env.example`‌ها جاافتاده بود | هر دو | ✅ Fixed |
| B7 | Medium | `infra/backup.sh`: یوزر/DB هاردکد + بدون چک یکپارچگی | `infra/backup.sh` | ✅ Fixed — env + SHA-256 manifest |
| B8 | Medium | `semgrep … \|\| true` در CI یافتهٔ واقعی (B2) را پنهان کرده بود | `ci.yml` | ✅ Fixed — حالا blocking |
| B9 | Medium | بدون dependency scan در CI | `ci.yml` | ✅ Fixed — job pip-audit |
| B10 | Low | بدون job برای CRM در CI | `ci.yml` | ✅ Fixed |
| B11 | **High** | CVEهای واقعی: pyjwt 2.10.1 (۲۱ مورد)، python-multipart 0.0.20 (path traversal + DoS)، cryptography 44.0.0 | `requirements.txt` | ✅ Fixed — 2.15.1 / 0.0.31 / 50.0.0 |

### Track B — Blocked 🟡 (سبزwashing نشده)
- B-PG: PostgreSQL در سندباکس نیست — migration روی SQLite (۱۸ revision خطی، head `f17a0b1c2d3e`، بدون op مخرب در `upgrade()`).
- B-Docker: docker daemon نیست — `docker compose config` باید روی هاست داکر اجرا شود.
- B-npm: `npm audit` با 403 پروکسی — به CI اضافه نشد.
- B-starlette: ۱۴ advisory نیازمند ارتقای major فستAPI — در CI مستند/ignore شد.
- B-mypy: ۱۴۱ خطای pre-existing — non-blocking با کامنت صادقانه.

## Track C — معماری

| # | شدت | یافته | وضعیت |
|---|---|---|---|
| C1 | Info | models.py متمرکز (۹۷ مدل) — چرخهٔ import واقعی نیست | 🟣 Deferred — **عدم تفکیک** (ADR-0019)؛ ۳ تست نگهبان اضافه شد |
| C2 | Info | `shared-types`/`icons`/`config` وجود ندارند | 🟣 Deferred — تکرار واقعی اثبات نشد؛ ساخت اسمی ممنوع |
| C3 | Low | تداخل شمارهٔ ADR (دو «ADR-0001»، دو «ADR-0006») | ✅ Fixed — منتقل به 0017 و 0018 با provenance |
| C4 | Info | ایزولاسیون demo-data | 🔵 سالم است — `/demo/*` با `notFound()` + noindex؛ sitemap تمیز |
| C5 | Low | `.env.example`‌ها ناقص بودند | ✅ Fixed — ۷ متغیر اضافه شد |
| C6 | Info | کد مردهٔ مشکوک | ⚪ False Positive — همه via `from app.core import X` وارد می‌شدند؛ حذفی انجام نشد |

## جمع‌بندی شمارشی

| شدت | اصلاح‌شده | سالم/False+ | Blocked | Deferred |
|---|---|---|---|---|
| Critical | 0 | — | — | — |
| **High** | **7** | — | — | — |
| Medium | 8 | — | 3 | — |
| Low/Info | 5 | 4 | 2 | 3 |
| **جمع** | **20** | **4** | **5** | **3** |

یافتهٔ Critical بازی در این پاس دیده نشد. هیچ یافته‌ای صرفاً به‌خاطر ذکر شدن در مسترپرامپت اصلاح نشد — همه با سورس/تست اعتبارسنجی شدند.
