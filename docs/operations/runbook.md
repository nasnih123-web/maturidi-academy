# Runbook عملیاتی — آکادمی ماتریدی

**آخرین به‌روزرسانی:** 2026-10-19 (فاز ۱۷) | **نسخه:** 1.0

این سند برای کسی است که سرور را می‌بیند و باید آن را زنده نگه دارد.

---

## ۱. معماری استقرار

| سرویس | تصویر/مسیر | پورت |
|---|---|---|
| API (FastAPI) | `apps/api` → docker | 8000 |
| Web (Next.js) | `apps/web` → docker | 3000 |
| CRM (Vite SPA) | `apps/crm` → استاتیک/NGINX | 5173 |
| PostgreSQL | `postgres:16-alpine` | 5432 |
| Redis (queue/cache) | `redis:7-alpine` | 6379 |
| MinIO (آبجکت‌استور) | `minio/minio` | 9000/9001 |
| Metabase (BI) | `infra/metabase/docker-compose.metabase.yml` | 3001 |

شروع: `docker compose up -d` در ریشهٔ مخزن.

---

## ۲. RPO / RTO

- **RPO (حداکثر دادهٔ ازدست‌رفته): ۲۴ ساعت** — بکاپ روزانهٔ PostgreSQL (`infra/backup.sh`، ساعت ۰۲:۰۰) + mirror MinIO.
- **RTO (حداکثر زمان بازیابی): ۴ ساعت** — مراحل بخش ۵ را دنبال کنید.

برای RPO کمتر (مثلاً ۱ ساعت)، اسنپ‌شات‌های WAL آرشیو را فعال کنید (راهنمای بخش ۶).

---

## ۳. بکاپ

- اسکریپت: `infra/backup.sh` — در cron هاست: `0 2 * * * /path/to/infra/backup.sh`
- خروجی: `/var/backups/maturidi/pg-YYYY-MM-DD.sql.gz` + `/var/backups/maturidi/minio-YYYY-MM-DD/`
- نگهداری: ۱۴ روز (قابل تنظیم با `RETENTION_DAYS`)
- **بکاپ را خارج از سرور هم نگه دارید** (off-site): حداقل هفتگی یک کپی به S3/ابزار دیگر منتقل کنید — بکاپ روی همان دیسکِ سرور، در برابر خرابی دیسک محافظت نمی‌کند.

---

## ۴. تمرین بازیابی (DR Drill) — فاز ۱۷ ✅

در 2026-10-19 یک **تمرین واقعی** انجام شد (نه فقط بررسی فایل بکاپ):
۱. دیتابیس آزمایشی با ۱۰۰ رکورد واقعی (کاربران + اهداها) ساخته شد.
۲. از آن بکاپ گرفته شد (dump → gzip، همان منطق `infra/backup.sh`).
۳. روی یک دیتابیس خالیِ جدید restore شد.
۴. یکپارچگی راستی‌آزمایی شد: تعداد رکوردها (۵۰+۵۰) و SHA-256 کل محتوای جدول‌ها با مبدأ **دقیقاً برابر** بود.

**نتیجه: موفق ✅** — runbook زیر همان مسیری است که در تمرین طی شد.

---

## ۵. رویهٔ بازیابی (قدم‌به‌قدم)

```bash
# ۱. سرویس‌ها را متوقف کنید
docker compose stop api web crm worker

# ۲. آخرین بکاپ سالم را پیدا کنید
ls -la /var/backups/maturidi/pg-*.sql.gz | tail -3

# ۳. دیتابیس را restore کنید (به یک دیتابیس تازه یا همان)
gunzip -c /var/backups/maturidi/pg-YYYY-MM-DD.sql.gz \
  | docker compose exec -T postgres psql -U maturidi maturidi

# ۴. فایل‌ها را از mirror برگردانید
docker compose exec -T minio mc mirror --overwrite \
  /var/backups/maturidi/minio-YYYY-MM-DD /data

# ۵. مایگریشن‌ها را اعمال کنید (در صورت نیاز)
docker compose exec api alembic upgrade head

# ۶. سرویس‌ها را بالا بیاورید و سلامت را چک کنید
docker compose up -d
curl -f http://localhost:8000/api/v1/health
```

چک‌لیست پس از بازیابی: ورود ادمین، صفحهٔ اصلی وب، یک جست‌وجوی فتوا، یک پرداخت آزمایشی (sandbox).

---

## ۶. محیط staging

- یک کپی کامل از `docker-compose.yml` روی یک هاست جدا (یا namespace جدا).
- **هرگز دادهٔ واقعی کاربران را به staging نبرید** — از دیتای fake/seed استفاده کنید.
- مسیر استقرار: `main` → staging (تست دود: health + لاگین + یک سناریوی E2E از `apps/api/tests/test_phase17_e2e.py`) → تولید.
- متغیرهای محیطی staging جدا: کلیدهای sandbox درگاه پرداخت، دامنهٔ جدا.

---

## ۷. پاسخ به رخداد (خلاصه)

| رخداد | اقدام اول |
|---|---|
| API بالا نمی‌آید | `docker compose logs api` → بررسی `.env` (SECRET_KEY واقعی؟) |
| مصرف ۱۰۰٪ دیسک | `docker system prune` + بررسی لاگ‌های Loki |
| مشکوک به نفوذ | API را از شبکه جدا کنید، لاگ‌ها را نگه دارید، توکن‌ها را بچرخانید |
| درگاه پرداخت خطا می‌دهد | وضعیت درگاه در CRM ← اتصالات؛ webhookها در لاگ `finance` |

## ۸. چرخش دوره‌ای

- ماهانه: بررسی فضای دیسک بکاپ‌ها، تست restore روی staging.
- فصلی: چرخش کلیدهای درگاه پرداخت و JWT secret، بازبینی دسترسی‌های ادمین.
- سالانه: مرور کامل این runbook.
