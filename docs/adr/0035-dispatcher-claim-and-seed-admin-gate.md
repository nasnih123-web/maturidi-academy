# ADR-0035 — Dispatcher claim و دروازهٔ مدیر در seed (M-03/M-04)

- وضعیت: پذیرفته‌شده — ۲۰۲۶-۱۰-۲۲ (رفع اشکال‌های audit روی 197efa0)

## M-04 — claim برای dispatcher رویداد

### زمینه
`dispatch_once` همهٔ رویدادهای پردازش‌نشده را بدون سقف و بدون claim
می‌خواند و منتشر می‌کرد؛ دو dispatcher هم‌زمان (چند replica) یک
رویداد را چند بار منتشر می‌کردند و بار خواندن نامحدود بود.

### تصمیم
1. **Batch محدود:** هر دور حداکثر `CLAIM_BATCH = 200` رویداد.
2. **Claim اتمیک دوشاخه‌ای:** روی PostgreSQL با
   `SELECT … FOR UPDATE SKIP LOCKED` (قفل ردیف + ردکردن قفل‌شده‌ها)؛
   روی بقیهٔ دیتابیس‌ها با `UPDATE … WHERE claimed_at IS NULL OR
   claimed_at < stale RETURNING` (قابل‌حمل؛ روی SQLite قفل نویسنده
   سریالایز می‌کند و بازندهٔ race در دور بعد دوباره تلاش می‌کند —
   `OperationalError` گرفته و لاگ می‌شود).
3. **ستون‌های claim** (`claimed_by`, `claimed_at` — migration
   `f3c4d5e6a7b8`) با TTL ‏۱۲۰ ثانیه: dispatcher مرده رویداد را برای
   همیشه قفل نمی‌کند؛ رویدادِ در backoff ‏claimاش آزاد می‌شود تا
   قفل نماند. انتشار همچنان بیرون تراکنش claim است و
   `processed_at` به‌ازای هر رویداد commit می‌شود.
4. **Realtime:** آداپتر Redis pub/sub از فاز ۲ موجود بود
   (`RedisBus` + `create_event_bus` با fallback حافظه‌ای و لاگ)؛
   در این موج با تست‌های fakeredis پوشش داده شد (انتخاب adapter،
   fallback، fan-out واقعی pub/sub) — پیاده‌سازی تازه لازم نبود.

## M-03 — دروازهٔ مدیر در seed

### تصمیم
`app.seed` دیگر وقتی `ADMIN_*` ست نشده بی‌قیدوشرط `exit(1)`
نمی‌کند: اگر `super_admin`ای در دیتابیس هست، seed بدون ساخت مدیر
ادامه می‌یابد و exit 0 می‌دهد (bootstrap دوم به‌بعد به env مدیر
وابسته نیست)؛ اگر نیست، با پیام دقیق exit 1 می‌کند. bootstrapها
هم ریشهٔ `.env` را از `.env.example` می‌سازند (اگر نباشد)، نسخهٔ
sh مثل ps1 ‏`apps/api/.env` ‏(CORS) را می‌سازد، و `curl` در هر دو
اسکریپت پیش‌نیاز اعلام‌شده با پیام دقیق است. بیت اجرایی
`bootstrap.sh` و `apps/api/setup.sh` در git ‏(`100755`) ثبت شد تا
`./bootstrap.sh` روی کلون تازه واقعاً کار کند.

## پیامدها
- چند replica از API می‌توانند هم‌زمان dispatcher داشته باشند؛
  consumerها همچنان idempotent می‌مانند (قرارداد §۴) ولی انتشار
  تکراری از مبدأ حذف شد.
- تست دوبار اجرا روی کلون تازه در لاگ‌های bootstrap نگه داشته شد
  (runهای متوالی bootstrap.sh روی کپی پاک: هر دو سبز).
