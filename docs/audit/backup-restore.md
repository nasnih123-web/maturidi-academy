# بکاپ و بازیابی — hardening/audit-pass-1

## سیاست

- **RPO:** ۲۴ ساعت (بکاپ روزانهٔ `infra/backup.sh`، ساعت ۰۲:۰۰) | **RTO:** ۴ ساعت (رویه در `docs/operations/runbook.md`)
- خروجی: `pg-YYYY-MM-DD.sql.gz` + mirror فایل‌ها + **SHA-256 manifest** (اضافه‌شده در این پاس)
- نگهداری ۱۴ روزه؛ **کپی off-site هفتگی الزامی** (بکاپ روی همان سرور در برابر خرابی دیسک محافظت نمی‌کند)
- `infra/backup.sh` در این پاس اصلاح شد: `POSTGRES_USER/DB` و `COMPOSE_FILE` از env (به‌جای هاردکد)، manifest یکپارچگی، prune شدن manifestها با retention

## آزمایش‌های واقعی انجام‌شده

### ۱. فاز ۱۷ (پیش از این پاس)
dump → gzip → restore روی دیتابیس خالی → SHA-256 کل محتوا **برابر** مبدأ (۵۰ کاربر + ۵۰ اهدا). ✅ موفق

### ۲. این پاس (Track B — `tests/test_infra_track_b.py::test_backup_restore_drill`)
۱. `alembic upgrade head` از دیتابیس صفر → ۹۶ جدول
۲. seed واقعی: کاربر argon2، تنظیم Fernet-encrypted، یک domain event
۳. بکاپ (کپی + sha256 manifest)
۴. restore روی scratch DB
۵. **تعداد رکوردها + SHA-256 کانونیکال برابر** + read-back با ORM ✅ موفق

## موارد باز

- تمرین روی **PostgreSQL واقعی** (نه SQLite) هنوز انجام نشده — باید در staging با `pg_dump` واقعی تکرار شود.
- رمزنگاری بکاپ (at-rest) پیاده نشده — اگر بکاپ off-site می‌رود، رمزنگاری GPG پیشنهاد می‌شود.
- restore فایل‌های MinIO (mirror) در drill این پاس پوشش داده نشد — در runbook مستند است ولی تست خودکار ندارد.
