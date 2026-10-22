# تمرین DR روی Staging — ران‌بوک قدم‌به‌قدم + برگهٔ اندازه‌گیری RTO (C-06)

> سیاست و تعهدات کلی (RPO‏=۲۴h / RTO‏=۴h) در ‏docs/ops/disaster-recovery.md
> است؛ این سند فقط «تمرین» است: بکاپ واقعیِ staging را روی محیط جدا
> restore می‌کنیم، زمان هر گام را اندازه می‌گیریم و نتیجه را ثبت می‌کنیم.
>
> **وضعیت: NOT RUN روی staging** — در محیط توسعهٔ این پروژه staging/docker
> در دسترس نیست. اجرای این ران‌بوک کار مالک زیرساخت است؛ ساختن سابقهٔ
> جعلی ممنوع. (یک restore محلیِ کوچک در فاز ۱۷ انجام و در
> disaster-recovery.md ثبت شده؛ آن «تمرین staging» محسوب نمی‌شود.)

## ۰) پیش‌نیازها

- staging سالم با دادهٔ ساختگی (docs/ops/staging.md) و حداقل یک بکاپ
  موفق از ‏infra/backup.sh در ‏$BACKUP_DIR (پیش‌فرض ‏/var/backups/maturidi):
  یک ‏dump.sql.gz ‏(PostgreSQL) + آینهٔ ‏MinIO ‏(mc mirror).
- **منبع بکاپ (m-04):** روی استک production بکاپ را سرویس `backup`
  در docker-compose.prod.yml می‌گیرد (همان backup.sh، روزانه در
  `BACKUP_AT_UTC`) و خروجی در والیوم `backupdata` است؛ برای drill
  آن را روی هاست کپی کنید:
  `docker run --rm -v <project>_backupdata:/backups -v $PWD/drill-src:/out alpine cp -a /backups/. /out/`
  (نام والیوم را با `docker volume ls | grep backupdata` پیدا کنید.)
  اجرای آزمایشی فوری سرویس: `BACKUP_RUN_ON_START=true` در env استک.
  وضعیت اجرای واقعی سرویس و restore از خروجی‌اش: **NOT RUN** (بدون
  Docker در محیط توسعه) — مثل بقیهٔ این ران‌بوک، کار مالک زیرساخت
  روی staging است.
- یک مقصد restore جدا (VM یا همان هاست با نام پروژهٔ compose جدا:
  ‏`-p maturidi-drill`) — هرگز روی دیتابیس staging/production ننویسید.
- ساعت/کرونومتر برای برگهٔ اندازه‌گیری (بخش ۳).

## ۱) گام‌های دقیق restore (همان خروجی backup.sh)

```bash
cd /opt/maturidi
cp .env.prod.example .env.drill        # مقادیر جدا برای مقصد drill
export COMPOSE_FILE=docker-compose.prod.yml

# ۱) فقط زیرساخت مقصد بالا می‌آید (بدون api/worker)
docker compose --env-file .env.drill -p maturidi-drill up -d postgres redis minio clamav

# ۲) restore دیتابیس از آخرین dump — شروع کرونومتر از این لحظه
ls -t /var/backups/maturidi/*.sql.gz | head -1
gunzip -c /var/backups/maturidi/<LATEST>.sql.gz | \
  docker compose --env-file .env.drill -p maturidi-drill exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# ۳) restore فایل‌ها (MinIO) با همان کانتینر mc یک‌بارمصرفِ backup.sh
#    (مسیر آینهٔ محلی بکاپ → bucket مقصد؛ جزئیات alias در backup.sh)
docker compose --env-file .env.drill -p maturidi-drill up -d migrate   # alembic upgrade head
docker compose --env-file .env.drill -p maturidi-drill up -d            # کل استک

# ۴) راستی‌آزمایی: دود کامل باید سبز شود
docker compose --env-file .env.drill -p maturidi-drill exec -T api \
  python - < tools/ci/compose_smoke.py
```

## ۲) معیار قبولی تمرین

- [ ] ‏compose_smoke.py کامل سبز است (health ‏+ media_tools ‏+ auth ‏+ home ‏+ WS)
- [ ] سه رکورد تصادفی از دادهٔ ساختگیِ staging در مقصد دیده می‌شود (کاربر/فتوا/فایل کتابخانه)
- [ ] یک فایل رسانه‌ای از MinIO مقصد با URL امضاشده دانلود و checksum آن با مبدأ یکی است
- [ ] هیچ خطای ‏migration یا ‏seed رخ نداده؛ لاگ api بدون traceback بحرانی است

## ۳) برگهٔ اندازه‌گیری RTO (هر تمرین یک ردیف)

| گام | شروع | پایان | مدت | سقف هدف |
|---|---|---|---|---|
| بالا آوردن زیرساخت مقصد | | | | ‏۱۰ دقیقه |
| restore ‏PostgreSQL | | | | بسته به حجم — ثبت شود |
| restore ‏MinIO | | | | بسته به حجم — ثبت شود |
| ‏alembic upgrade head | | | | ‏۵ دقیقه |
| بالا آمدن api + سبز شدن دود | | | | ‏۱۰ دقیقه |
| **مجموع (RTO اندازه‌گیری‌شده)** | | | | **‏≤ ‏۴ ساعت** |

## ۴) سابقهٔ تمرین‌ها

| تاریخ | محیط | اجراکننده | RTO اندازه‌گیری‌شده | نتیجه |
|---|---|---|---|---|
| — | staging | — | — | **NOT RUN** |
