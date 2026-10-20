# ادعاهای نادرست / اثبات‌نشده — hardening/audit-pass-1

این سند مواردی را ثبت می‌کند که در مسترپرامپت یا بررسی اولیه «مشکوک» به نظر می‌رسیدند اما با سورس واقعی **رد** شدند. هدف: جلوگیری از اصلاح‌های غیرضروری که خودشان باگ می‌سازند.

## False Positive (با کد واقعی تناقض دارد)

1. **«کد مردهٔ بدون importکننده»** — همهٔ موارد مشکوک در واقع با الگوی `from app.core import X` وارد می‌شدند. هیچ حذفی انجام نشد. (Track C)
2. **«چرخهٔ import بین auth و content»** — در سطح دایرکتوری یال مشکوک بود، اما در سطح فایل چرخه‌ای نیست: `auth/service.py:56` فقط ثابت `LEGAL_TEXT_VERSION` را از `content/legal.py` می‌گیرد و آن فایل برگِ بدون import از `app` است. (Track C)

## Not Reproduced (با بررسی انجام‌شده بازتولید نشد)

3. **Algorithm confusion در JWT** — `decode_access_token` روی `HS256` پین شده؛ توکن `none`، کلید اشتباه و claim دست‌کاری‌شده همگی → 401. با تست اثبات شد؛ اصلاحی لازم نبود. (Track A)
4. **IDOR در endpointهای حساس** — `/users/me/notifications/{id}` مالک‌محور (غیرمالک 404)، `/finance/receipts/{id}` مالک یا `finance.manage`، همهٔ روترهای ادمین `require_permission` سمت سرور دارند. (Track A)
5. **نشت دادهٔ نمایشی به production** — صفحات `/demo/*` در production با `notFound()` + `robots: noindex`؛ sitemap فقط ۴ مسیر واقعی؛ `NEXT_PUBLIC_SOCIAL_DEMO` پیش‌فرض خاموش و هیچ‌جا ست نشده. (Track C)
6. **نشت URL داخلی MinIO به مرورگر** — signed URLها HMAC + انقضا + scope تک‌فایل دارند؛ URL داخلی لو نمی‌رود. (Track A)
7. **گم‌شدن رویداد در outbox** — `emit_event` به تراکنش caller می‌پیوندد؛ dispatcher با backoff و DLQ پس از ۵ retry؛ قطع Redis → fallback `InMemoryBus`. (Track A)

## Likely ولی نیازمند محیط واقعی (به Blocked منتقل شد، نه اصلاح حدسی)

8. **انتشار تنظیمات بین replicaها** — با TTL ۶۰ ثانیه‌ای و `bump_settings_version()` در هر ۸ مسیر write سالم به نظر می‌رسد؛ تست چندپردازه‌ای/چندreplica در sandbox غیرممکن است → Blocked (مستند در security-hardening.md).
9. **رفتار `docker compose config` و pull ایمیج MinIO از quay.io** — YAML معتبر است اما بدون docker daemon اثبات نشد → Blocked.

## تصمیم‌های «عدم اقدام» آگاهانه (نه غفلت)

10. **عدم تفکیک `models.py`** — ADR-0019: چرخه‌ای برای شکستن نیست؛ جابه‌جایی کلاس‌ها ریسک بی‌صدا عوض‌شدن metadata/alembic دارد.
11. **عدم ساخت `shared-types`/`icons`/`config`** — تکرار مضری بین اپ‌ها اثبات نشد؛ ساخت بسته «فقط برای اسم» ممنوع (دستور صریح).
12. **عدم اجباری‌کردن mypy در CI** — ۱۴۱ خطای pre-existing؛ اجباری‌کردن CI را قرمز می‌کرد (§15.8 مسترپرامپت: خطا را پنهان نکن، ولی job را هم با دلیل مستند non-blocking نگه دار).
