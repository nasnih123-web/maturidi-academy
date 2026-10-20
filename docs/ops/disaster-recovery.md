# بازیابی فاجعه (Disaster Recovery) — آکادمی ماتریدی

> **فاز ۱۷ — 2026-10-19** | Track 3 (Docs + Ops + Scale)
> همراه: [`docs/operations/runbook.md`](../operations/runbook.md) (runbook فشردهٔ ترک دیگر)
> این سند، مرجع کامل DR است: تعهدات RPO/RTO، بکاپ off-site، متن کامل تمرین واقعی، و runbook قدم‌به‌قدم.

---

## ۱. تعهدات RPO / RTO (صادقانه، متناسب با این استک)

| معیار | مقدار تعهدشده | مبنا |
|---|---|---|
| **RPO** (حداکثر دادهٔ قابل‌قبول برای ازدست‌رفتن) | **۲۴ ساعت** | بکاپ روزانهٔ `pg_dump` در ساعت ۰۲:۰۰ (`infra/backup.sh`) — بدترین حالت: از دست رفتن تغییراتِ بعد از آخرین بکاپ شبانه |
| **RTO** (حداکثر زمان بازگشت سرویس) | **۴ ساعت** | restore dump (‎~۱۵ دقیقه در حجم فعلی) + بازگردانی MinIO + `alembic upgrade head` + بالا آوردن استک + راستی‌آزمایی دستی (بخش ۵) |

**چرا نه کمتر؟** RPO کمتر از ۲۴ ساعت به WAL archiving / replica نیاز دارد که هنوز فعال نشده
(مسیر ارتقا در بخش ۶). اعلام عددی که زیرساختش را نداریم، دروغ عملیاتی است — RPO/RTO بالا
اعلام و مسیر کاهش، مستند شده است.

---

## ۲. معماری بکاپ فعلی

- **دیتابیس:** `infra/backup.sh` — `pg_dump` از کانتینر `postgres` (رمز با
  `-e PGPASSWORD` به فرایند داخل کانتینر داده می‌شود) → `gzip` در
  `/var/backups/maturidi/pg-YYYY-MM-DD.sql.gz` + مانیفست SHA-256 + تست
  یکپارچگی `gzip -t`.
- **فایل‌ها:** `infra/backup.sh` — کانتینر یک‌بارمصرف `mc`
  (`quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z`، قابل override با
  `MC_IMAGE`) روی همان شبکهٔ compose، `mc mirror --overwrite` از
  `src/$S3_BUCKET` → `/var/backups/maturidi/minio-YYYY-MM-DD/` + مانیفست
  SHA-256 تک‌تک فایل‌ها. (ایمیج minio سرور دستور `mc` ندارد؛ نسخه‌های قبلی
  که `exec` روی سرویس minio می‌زدند همیشه ساکت فیل می‌شدند.)
- **قرارداد اسکریپت:** همهٔ اعتبارات از env می‌آیند (`POSTGRES_USER`،
  `POSTGRES_PASSWORD`، `POSTGRES_DB`، `MINIO_ROOT_USER`،
  `MINIO_ROOT_PASSWORD`، `S3_BUCKET` — نبود هرکدام فیلِ بلند است)؛ کد خروج
  هر ۴ مرحله (دامپ، mirror، مانیفست، هرس) صریح چک می‌شود و «done» فقط وقتی
  چاپ می‌شود که همه واقعاً موفق بوده‌اند؛ mirror ناقص پاک می‌شود تا
  دایرکتوری نیمه‌کاره «کامل» به نظر نرسد.
- **زمان‌بندی:** cron هاست: `0 2 * * * cd /opt/maturidi && COMPOSE_FILE=docker-compose.prod.yml ./infra/backup.sh`
- **نگهداری:** ۱۴ روز (`RETENTION_DAYS`) — فقط روی همان سرور ⚠️ (بخش ۳ را ببینید)

### ۳. بکاپ off-site (فراتر از همان سرور)

بکاپ روی همان دیسکِ سرور، در برابر خرابی دیسک/دیتاسنتر محافظت نمی‌کند. رویهٔ مصوب:

**ابزار:** `rclone` به یک مقصد S3-سازگار دوم (مثلاً Backblaze B2، یا یک VPS دوم).

**راه‌اندازی (یک‌بار):**

```bash
# ۱. نصب
curl https://rclone.org/install.sh | sudo bash

# ۲. پیکربندی (کلیدها را از secrets manager/env بخوانید — هرگز در فایل commit نکنید)
rclone config   # new remote "offsite" از نوع s3/b2 با endpoint و کلیدها

# ۳. تست دستی
rclone copy /var/backups/maturidi/pg-$(date +%F).sql.gz offsite:maturidi-backups/db/
rclone ls offsite:maturidi-backups/db/ | tail -3
```

**خودکارسازی (cron هاست — بعد از backup.sh):**

```cron
0 3 * * * rclone copy /var/backups/maturidi/ offsite:maturidi-backups/ --include 'pg-*.sql.gz' --max-age 48h --log-file /var/log/rclone-offsite.log
0 4 * * 0 rclone copy /var/backups/maturidi/ offsite:maturidi-backups/ --include 'minio-*' --log-file /var/log/rclone-offsite.log
```

- dump دیتابیس: **روزانه** به off-site (بعد از بکاپ ۰۲:۰۰).
- mirror فایل‌ها: **هفتگی** (حجم بالا؛ تغییرات روزانهٔ مدیا کم است).
- رمزنگاری سمت مقصد: bucket با SSE فعال، یا `rclone crypt` روی remote (توصیه می‌شود).

> **محدودیت صادقانهٔ محیط تست:** در سندباکس فاز ۱۷ هیچ مقصد off-site واقعی وجود نداشت؛
> انتقال واقعی انجام **نشد** و دستورات بالا «اجرا و راستی‌آزمایی‌شده» نیستند — در اولین
> استقرار production باید قدم‌های ۱ تا ۳ واقعاً اجرا و در همین سند تیک بخورند.

---

## ۴. تمرین بازیابی واقعی (DR Drill) — 2026-10-19 ✅

این تمرین **واقعاً اجرا شد** (نه فقط بررسی فایل بکاپ). متن کامل دستورات و خروجی:

```
=== [1] SOURCE DB STATE (production-shaped: apps/api/dev.db) ===
tables|92
alembic|3f09e72ee6c1
users: 5
fatwa_sessions: 5
fatwa_messages: 10
domain_events: 28
sync_changelog: 6

=== [2] BACKUP (sqlite backup API; prod analog: pg_dump) ===
-rw-r----- 1 root nogroup 1830912 Oct 19 11:31 dr-backup-20261019.db

=== [3] RESTORE to scratch + integrity check ===
ok

=== [4] MIGRATE scratch to head ===
INFO [alembic.runtime.migration] Running upgrade 3f09e72ee6c1 -> e6f1a2b3c4d5,
  Phase 16 — مدیریت پروژه و نیروی انسانی داخلی (PMS): projects/tasks/staff_members.
INFO [alembic.runtime.migration] Running upgrade e6f1a2b3c4d5 -> f17a0b1c2d3e,
  Phase 17 — ایندکس‌های ترکیبی مسیرهای داغ (slow-query indexing).

=== [5] POST-RESTORE VERIFICATION ===
alembic|f17a0b1c2d3e
tables|92 → 95
--- row counts (must match pre-migration) ---
users: 5
fatwa_sessions: 5
fatwa_messages: 10
domain_events: 28
sync_changelog: 6
--- new phase-16/17 objects present ---
projects, tasks, staff_members
ix_social_posts_feed, ix_library_items_pub_list
--- spot checks: content integrity ---
3651329124d149b0acb5a4b19819c718|admin@example.com|1
4d8ac378079f4f04a0611116932e9dc1|demo@example.com|1
{"session_id": "ee44c6bb-df95-4f12-bd14-519222a2617a"}
{"email": "demo@example.com", "phone_set": false, "locale": "fa"}
PRAGMA integrity_check → ok

=== DRILL RESULT: PASS — restore + migrate + verify, zero data loss ===
```

**آنچه تمرین ثابت کرد:**
۱. بکاپ قابل restore است (بازیابی به دیتابیس scratch جدا، بدون دست‌زدن به مبدأ).
۲. دیتابیسِ restoreشده که **دو فاز از head عقب بود**، با `alembic upgrade head` تمیز به head رسید (forward-only §۱۲).
۳. **هیچ رکوردی کم/زیاد نشد** — شمارش ۵ جدول کلیدی قبل و بعد دقیقاً برابر.
۴. محتوای نمونه (کاربران، payload رویدادهای دامنه) سالم و خواناست.

**محدودیت‌های صادقانهٔ تمرین:**
- روی SQLite dev انجام شد، نه PostgreSQL production (در سندباکس PostgreSQL نبود). منطق
  تمرین روی Postgres یکسان است (`pg_dump` → `psql` → `alembic upgrade head`) ولی **اولین
  تمرین واقعی روی Postgres باید در staging و پیش از go-live انجام شود** (چک‌لیست بخش ۷).
- حجم دیتابیس تمرین ۱٫۸MB بود؛ زمان restore در حجم واقعی باید جداگانه اندازه‌گیری شود.

---

## ۵. Runbook بازیابی — قدم‌به‌قدم (برای هرکسی غیر از سازندهٔ اصلی)

> پیش‌نیازها: دسترسی SSH به هاست production، فایل `.env.prod`، دانستن مسیر بکاپ‌ها
> (`/var/backups/maturidi`). اگر هاست کاملاً از دست رفته، اول بخش ۷ (بازیابی روی هاست جدید).

### سناریو A: خرابی منطقی دیتابیس (داده خراب/حذف اشتباه — سرور سالم است)

```bash
# ۱. سرویس‌ها را نگه دارید تا خرابی بیشتر نشود (دیتابیس را بالا نگه دارید)
cd /opt/maturidi && docker compose -f docker-compose.prod.yml stop api web crm \
  worker-critical worker-ai worker-media worker-telegram worker-notifications worker-analytics

# ۲. از وضعیت فعلی هم یک بکاپ بگیرید (شاید لازم شد برگردید!)
docker compose -f docker-compose.prod.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > /var/backups/maturidi/pg-BEFORE-RESTORE-$(date +%F-%H%M).sql.gz

# ۳. آخرین بکاپ سالم را انتخاب کنید
ls -la /var/backups/maturidi/pg-*.sql.gz | tail -5

# ۴. restore به یک دیتابیس scratch اول (تست)، بعد به اصلی
docker compose -f docker-compose.prod.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" -c "CREATE DATABASE maturidi_restore_test;"
gunzip -c /var/backups/maturidi/pg-YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" maturidi_restore_test

# ۵. راستی‌آزمایی روی scratch (الگوی تمرین بخش ۴)
docker compose -f docker-compose.prod.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" maturidi_restore_test -c "
  SELECT 'users', COUNT(*) FROM users UNION ALL
  SELECT 'donations', COUNT(*) FROM donations UNION ALL
  SELECT 'domain_events', COUNT(*) FROM domain_events;"
# با برآورد انتظاری مقایسه کنید (داشبورد متابیس / آخرین گزارش)

# ۶. اگر سالم بود → restore به دیتابیس اصلی
docker compose -f docker-compose.prod.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" -c "DROP DATABASE maturidi_restore_test;"
gunzip -c /var/backups/maturidi/pg-YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# ۷. migrationها را به head برسانید (بکاپ ممکن است از ایمیج قدیمی‌تر باشد)
docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head

# ۸. فایل‌ها (MinIO) — فقط اگر فایل هم آسیب دیده
# کانتینر یک‌بارمصرف mc (ایمیج minio سرور دستور mc ندارد)؛ دایرکتوری بکاپ
# به کانتینر mount می‌شود و mirror معکوس انجام می‌شود.
docker compose -f docker-compose.prod.yml run --rm \
  -e "MC_MINIO_USER=$MINIO_ROOT_USER" \
  -e "MC_MINIO_PASSWORD=$MINIO_ROOT_PASSWORD" \
  -e "MC_BUCKET=$S3_BUCKET" \
  -v /var/backups/maturidi/minio-YYYY-MM-DD:/restore \
  --entrypoint sh "quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z" -c \
  "mc alias set dst http://minio:9000 \"\$MC_MINIO_USER\" \"\$MC_MINIO_PASSWORD\" >/dev/null && mc mirror --overwrite /restore \"dst/\$MC_BUCKET\""

# ۹. بالا آوردن و راستی‌آزمایی نهایی
docker compose -f docker-compose.prod.yml up -d
curl -f http://localhost:8000/health
# چک‌لیست: ورود ادمین به CRM، صفحهٔ اصلی وب، یک جست‌وجو، یک فتوای آزمایشی
```

### سناریو B: از دست رفتن کامل هاست

۱. هاست جدید + docker نصب کنید.
۲. ریپو را clone کنید، `.env.prod` را از secrets manager بازیابی کنید (⚠️ `.env.prod` هرگز در بکاپ سرورِ ازدست‌رفته تنها نباشد — یک کپی امن جدا نگه دارید).
۳. آخرین بکاپ را از **off-site** برگردانید: `rclone copy offsite:maturidi-backups/ /var/backups/maturidi/`
۴. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d` (postgres خالی بالا می‌آید)
۵. ادامه از قدم ۶ سناریوی A.
۶. DNS را به IP جدید برگردانید؛ گواهی TLS را چک کنید.

---

## ۶. مسیر کاهش RPO/RTO (اختیاری، پس از go-live)

| اقدام | اثر | هزینه/پیچیدگی |
|---|---|---|
| WAL archiving (`archive_command` → off-site) + `pg_basebackup` هفتگی | RPO: ۲۴h → ‎~۱h | متوسط |
| Hot standby / read replica (بخش مقیاس‌پذیری) | RTO: ۴h → ‎~۳۰min (failover) | بالا |
| تمرین فصلی restore روی staging (خودکار با cron + گزارش) | اطمینان از RTO واقعی | کم |

---

## ۷. چک‌لیست پذیرش DR (باید پیش از go-live تیک بخورد)

- [ ] `infra/backup.sh` روی هاست production در cron فعال و لاگ موفق دارد
- [ ] rclone off-site پیکربندی و **یک کپی واقعی** منتقل شده (`rclone ls` دیده شده)
- [ ] تمرین restore روی **staging با PostgreSQL واقعی** انجام و مستند شده
- [ ] `.env.prod` در secrets manager جدا از هاست ذخیره شده
- [ ] مخاطبین on-call و مسیر escalate در `docs/ops/runbook.md` به‌روز است
