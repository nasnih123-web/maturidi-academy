# آمادگی استقرار — hardening/audit-pass-1

**تاریخ:** 2026-10-19 | ⚠️ این چک‌لیست **مشروط** است — موارد Blocked باید روی زیرساخت واقعی تأیید شوند.

## ✅ تأییدشده در این پاس

- [x] سوئیت کامل pytest سبز (۴۳۶/۴۳۶ در آخرین اجرای کامل ترک‌ها)
- [x] Semgrep صفر یافته؛ Bandit تمیز؛ pip-audit تمیز (پس از ارتقاها)
- [x] TOTP سمت‌سرور برای ادمین‌ها + negative testها
- [x] Refresh چرخشی با reuse detection واقعی + grace window برای race
- [x] تیکت یک‌بارمصرف وب‌سوکت + channel authorization + replay پایدار
- [x] سایزکپ استریمینگ آپلود (قبل از RAM)
- [x] Dockerfile: کاربر non-root + alembic در ایمیج
- [x] ایمیج MinIO پین‌شده به quay.io (قابل pull واقعی)
- [x] `.env.prod.example` کامل؛ fail-fast روی اسرار placeholder
- [x] CI: semgrep blocking + pip-audit + job CRM
- [x] Drill واقعی backup→restore (دو بار: فاز ۱۷ و این پاس)
- [x] Migrationها خطی و بدون op مخرب در `upgrade()`
- [x] هیچ secret واقعی در git/لاگ/گزارش

## 🟡 مشروط — باید روی زیرساخت واقعی تأیید شود

- [ ] `docker compose -f docker-compose.prod.yml config` روی هاست داکر
- [ ] `docker pull quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` از شبکهٔ استقرار (توجه: تحریم‌ها/مسیریابی ایران)
- [ ] `alembic upgrade head` روی PostgreSQL واقعی (در sandbox فقط SQLite)
- [ ] بیلد موبایل (Expo) و دسکتاپ (Tauri) روی runnerهای واقعی
- [ ] `npm audit` برای web/crm
- [ ] اسکن ClamAV واقعی در مسیر آپلود (در صورت الزام)
- [ ] تست چندreplica (انتشار تنظیمات، invalidation کش)

## 🔴 بازمانده (غیرمسدودکنندهٔ استقرار، ولی باید برنامه‌ریزی شود)

1. ارتقای major فستAPI/starlette (۱۴ advisory) — ترک جدا.
2. ۱۴۱ خطای mypy → سپس blocking کردن job.
3. سیاست per-aggregate برای ایونت‌های غیر user-aggregate وب‌سوکت.
4. آپلود ۴۵ فایل باینری (فونت/لوگو/آیکون) توسط کاربر از طریق وب گیت‌هاب (تصمیم قبلی کاربر).
5. کلیدهای واقعی درگاه پرداخت (ZarinPal/IDPay)، TOTP ادمین‌ها، و bot token تلگرام باید توسط کاربر در CRM وارد شود.

## حکم نهایی

کد روی برنچ `hardening/audit-pass-1` از نظر **سورس، تست و امنیت** برای بازبینی و سپس مرج آماده است، اما **«آمادهٔ production» فقط پس از تیک خوردن موارد 🟡 روی زیرساخت واقعی** اعلام می‌شود. هیچ ادعای فراتر از شواهد این سند نشده است.
