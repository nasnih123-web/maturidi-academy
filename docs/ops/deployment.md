# استقرار Production — اولین deploy، به‌روزرسانی، rollback (فاز ۱۷)

> فایل compose: `docker-compose.prod.yml` | پیش‌نیاز: `docs/ops/staging.md` (اول staging!)

---

## ۱. پیش‌نیازهای هاست production

- Ubuntu 22.04+ (یا معادل)، حداقل **۴ vCPU / ۱۶GB RAM / ۱۰۰GB SSD** برای شروع
  (برآورد دقیق‌تر: `docs/ops/scaling-to-100k.md`)
- Docker Engine 24+ و `docker compose` v2
- DNS: رکوردهای `example.com` ،`api.example.com` ،`crm.example.com` به IP هاست
- فایل `.env.prod` کامل (الگو: `.env.example` — همهٔ `CHANGE_ME`ها پر شده، `APP_ENV=production`)

### متغیرهای اجباری compose (با `:?` کنترل می‌شوند)

`POSTGRES_USER` ،`POSTGRES_PASSWORD` ،`REDIS_PASSWORD` ،`MINIO_ROOT_USER` ،
`MINIO_ROOT_PASSWORD` ،`GRAFANA_PASSWORD` ،`MB_APP_DB_PASS` ،`WEB_API_URL`

## ۲. اولین استقرار (از صفر)

```bash
# ۱. آماده‌سازی
git clone <repo> /opt/maturidi && cd /opt/maturidi
cp .env.example .env.prod && nano .env.prod   # همهٔ secretها را پر کنید

# ۲. اعتبارسنجی compose (بدون نیاز به بالا بودن سرویس‌ها)
docker compose -f docker-compose.prod.yml --env-file .env.prod config > /dev/null && echo OK

# ۳. بالا آوردن (build ایمیج‌های api/web/crm + اجرای migration در entrypoint سرویس api)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# ۴. صبر برای healthy شدن و seed اولیهٔ ادمین
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='<قوی>' \
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python -m app.seed

# ۵. راستی‌آزمایی
curl -f https://api.example.com/health
curl -f https://example.com/          # web
curl -f https://crm.example.com/      # crm
```

### TLS (پیش‌نیاز جدی — بدون آن 2FA/TOTP و JWT روی شبکهٔ باز ناامن است)

این compose ترمینیشن TLS را **بیرون** نگه داشته (ساده و استاندارد). دو راه:

1. **پیشنهادی:** reverse proxy جدا (Caddy/NGINX/Traefik) روی هاست که به پورت‌های
   داخلی `frontend` پروکسی می‌کند و گواهی Let's Encrypt می‌گیرد.
2. سرویس `caddy` داخل compose (در صورت نیاز، در فاز بعد اضافه می‌شود).

## ۳. به‌روزرسانی (deploy نسخهٔ جدید)

```bash
cd /opt/maturidi

# ۱. بکاپ pre-deploy (اجباری — قرارداد §۱۲: پشتیبان‌گیری پیش از migration مخرب)
/opt/maturidi/infra/backup.sh
# تگ ایمیج فعلی را نگه دارید:
docker tag maturidi-prod-api:latest maturidi-prod-api:backup-$(date +%F) 2>/dev/null || true

# ۲. دریافت نسخهٔ جدید و بازبینی تغییرات migration
git fetch && git log --oneline HEAD..origin/main -- apps/api/alembic/versions/
git pull --ff-only

# ۳. اول staging (اجباری — docs/ops/staging.md §۳)

# ۴. استقرار production — بدون قطعی برای تغییرات سازگار:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build api worker-critical worker-ai worker-media worker-telegram worker-notifications worker-analytics
# migration در entrypoint سرویس api اجرا می‌شود (alembic upgrade head)؛ لاگ را چک کنید:
docker compose -f docker-compose.prod.yml logs api | grep -i "alembic\|Running upgrade" | tail -5

# ۵. سپس web/crm (استاتیک‌اند و بدون downtime تعویض می‌شوند):
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build web crm

# ۶. راستی‌آزمایی پس از deploy (چک‌لیست staging §۳.۴)
```

> ⚠️ **ترتیب مهم:** migrationها forward-only و سازگار با عقب‌رو (§۱۲، §۱۵.۱۱) نوشته
> شده‌اند — ایمیج جدید API با دیتابیسِ migrateشده، و ایمیج قدیمی هم تا لحظهٔ تعویض با
> همان دیتابیس کار می‌کند. اگر migrationای **ناسازگار با عقب‌رو** بود (ستون drop و...)،
> باید با پنجرهٔ نگهداری و توقف کامل deploy شود — این حالت باید در PR صراحتاً اعلام شود.

## ۴. Rollback (بازگشت)

### ۴.۱. Rollback کد (دیتابیس سالم است)

```bash
# به تگ/کامیت قبلی برگردید و rebuild کنید (migration جدید forward-only است و
# دیتابیس را «برنمی‌گرداند» — این عمدی است: §۱۲)
git log --oneline -3
git checkout <commit-قبلی>
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build api web crm
```

> توجه: اگر migration نسخهٔ جدید ستون/جدولی **اضافه** کرده، کد قدیمی معمولاً بدون مشکل
> کار می‌کند (ستون اضافه را نمی‌بیند). اگر migration چیزی را **حذف/تغییرنام** داده،
> rollback کد به‌تنهایی کافی نیست → سناریوی ۴.۲.

### ۴.۲. Rollback دیتابیس (خرابی جدی)

طبق `docs/ops/disaster-recovery.md` §۵ (سناریوی A): restore آخرین بکاپ pre-deploy،
سپس `up -d --build` با کد سازگار با آن بکاپ.

### ۴.۳. بعد از هر rollback

- علت را در runbook ثبت کنید (بخش «درس‌آموخته‌ها»).
- staging را با همان نسخهٔ خراب reproduce کنید پیش از تلاش مجدد.

## ۵. عملیات روزمرهٔ deploy

| کار | دستور |
|---|---|
| دیدن وضعیت | `docker compose -f docker-compose.prod.yml ps` |
| لاگ زندهٔ api | `docker compose -f docker-compose.prod.yml logs -f api` |
| scale یک صف | `docker compose -f docker-compose.prod.yml up -d --scale worker-media=3` |
| scale افقی api | `docker compose -f docker-compose.prod.yml up -d --scale api=3` (نیازمند load balancer — بخش مقیاس‌پذیری) |
| اجرای shell در api | `docker compose -f docker-compose.prod.yml exec api sh` |
| توقف کامل | `docker compose -f docker-compose.prod.yml down` (volumeها می‌مانند) |
| پاک‌سازی کامل ⚠️ | `down -v` (دیتابیس هم پاک می‌شود — فقط staging/dev!) |
