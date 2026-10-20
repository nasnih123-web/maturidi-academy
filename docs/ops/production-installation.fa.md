# راهنمای نصب Production — آکادمی ماتریدی

نصب و بهره‌برداری از پلتفرم روی یک سرور لینوکس واقعی با
`docker-compose.prod.yml`.

> **وضعیت تا ۲۰۲۶-۱۰-۲۰ (۲۰ اکتبر ۲۰۲۶).** این راهنما از روی فایل‌های
> Compose، ‏Dockerfileها و قالب‌های محیطی واقعیِ داخل مخزن نوشته شده است.
> گام‌هایی که با برچسب **«نیازمند آزمایش روی سرور واقعی»** مشخص شده‌اند،
> توسط نویسندهٔ این سند روی یک سرور production واقعی **اجرا نشده‌اند** —
> سندباکس توسعه دیمون داکر ندارد. آن‌ها را چک‌لیستی بدانید که در اولین
> استقرار واقعی باید اجرا و تأیید شوند، نه نتیجه‌ای که از پیش ثابت شده
> باشد.

---

## ۱. معماری‌ای که مستقر می‌کنید

فایل `docker-compose.prod.yml` دقیقاً همین سرویس‌ها را تعریف می‌کند —
چیز دیگری جزئی از معماری فعلی production نیست:

| گروه | سرویس‌ها | نقش |
|---|---|---|
| داده | `postgres`،‏ `redis`،‏ `minio` | دیتابیس، کش/صف/محدودیت نرخ، ذخیره‌سازی شیء سازگار با S3 |
| مایگریشن | `migrate` | جاب **یک‌بارهٔ** Alembic؛ ‏`api` و ورکرها فقط بعد از اتمام موفق آن بالا می‌آیند |
| API | `api` | ‏FastAPI (async)، گیت‌وی WebSocket |
| ورکرها | `worker-critical`،‏ `worker-ai`،‏ `worker-media`،‏ `worker-telegram`،‏ `worker-notifications`،‏ `worker-analytics` | ورکرهای پس‌زمینهٔ ARQ بر اساس کلاس صف |
| فرانت‌اندها | `web`،‏ `crm` | سایت Next.js، ‏CRM مدیریتی React/Vite |
| تحلیل | `metabase-db`،‏ `metabase` | ‏Metabase روی PostgreSQL جدا |
| مشاهده‌پذیری | `prometheus`،‏ `grafana`،‏ `loki` | متریک، داشبورد، تجمیع لاگ |

دادهٔ ماندگار در والیوم‌های نام‌دار زندگی می‌کند (`pgdata`،‏
`redisdata`،‏ `miniodata`،‏ `promdata`،‏ `grafanadata`،‏
`metabase-pgdata`). از آن‌ها بکاپ بگیرید — کانتینرها دورریختنی‌اند،
والیوم‌ها نه.

## ۲. پیش‌نیازهای سرور

### ۲.۱ سیستم‌عامل

از یک توزیع لینوکس **پشتیبانی‌شده توسط Docker Engine** استفاده کنید —
در عمل یک ‏Ubuntu LTS جاری (22.04 / 24.04) یا Debian پایدار. این الزام از
سمت Docker Engine و ایمیج‌های بر پایهٔ `python:3.12-slim` می‌آید، نه از
کد برنامه.

### ۲.۲ منابع — **تخمین اولیه، نه ظرفیت اندازه‌گیری‌شده**

هنوز هیچ بار productionای اندازه‌گیری نشده است. موارد زیر را نقطهٔ شروعی
برای یک لانچ کوچک بدانید که بعد از وجود دادهٔ مانیتورینگ واقعی باید
بازبینی شوند:

| منبع | حداقل (تخمین) | توضیح |
|---|---|---|
| CPU | ‏4 vCPU | ‏API + ‏۶ ورکر + فرانت‌اندها میزبان را شریک‌اند |
| RAM | ‏8 GB | ‏PostgreSQL، ‏Redis، ‏MinIO، ‏Metabase و Grafana همه مقیم‌اند |
| دیسک | ‏60 GB SSD | ایمیج‌ها + والیوم‌ها؛ **به‌علاوهٔ فضای بکاپ جدا، دست‌کم هم‌اندازهٔ والیوم‌های داده** |

### ۲.۳ نرم‌افزار

- ‏Docker Engine + **پلاگین Compose** ‏(نحو `docker compose` نسخهٔ ۲).
- ‏`git`،‏ `curl`،‏ `openssl`.
- یک دامنه با کنترل DNS و یک نقطهٔ پایانی TLS (بخش ۴).

نصب Docker Engine روی Debian/Ubuntu (مخزن apt رسمی داکر —
**«نیازمند آزمایش روی سرور واقعی»**):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version
```

(در Debian در هر دو نشانی به‌جای `linux/ubuntu` از `linux/debian` استفاده کنید.)

## ۳. شبکه، پورت‌ها، فایروال و SSH

- **عمومی**: فقط reverse proxy ‏(80/443) — و SSH ‏(22)، محدودشده.
- **فقط داخلی** (هرگز روی اینترنت منتشر نکنید): ‏PostgreSQL ‏5432،
  ‏Redis ‏6379، ‏MinIO ‏9000/9001، ‏API و ورکرها، Prometheus ‏9090،
  ‏Grafana، ‏Loki، ‏Metabase. آن‌ها را روی شبکهٔ Compose نگه دارید / به
  localhost ببندید و برای رابط‌های مدیریتی از تونل SSH یا پروکسیِ
  احرازهویت‌شده استفاده کنید.
- فایروال: پیش‌فرض deny ورودی؛ 80/443 از همه‌جا، 22 فقط از IP(های) مدیر.
- سیاست SSH: ورود فقط با کلید (`PasswordAuthentication no`)، بدون ورود
  مستقیم root، یک کاربر deploy غیرریشه در گروه `docker` یا با sudo.

مثال (UFW) — **«نیازمند آزمایش روی سرور واقعی»**:

```bash
sudo ufw default deny incoming
sudo ufw allow from <your-admin-ip> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## ۴. دامنه، DNS، ‏TLS و Reverse Proxy

1. دامنه(ها) را به سرور اشاره دهید (رکوردهای A/AAAA): یک میزبان برای وب
   عمومی، یکی برای CRM/مدیریت، و API قابل دسترس برای هر دو فرانت‌اند
   (مستقیم یا از طریق پروکسی).
2. ‏TLS را در یک reverse proxy ‏(nginx یا Caddy) جلوی `web`،‏ `crm` و
   `api` خاتمه دهید؛ گواهی‌ها را با Let's Encrypt بگیرید.
3. نشانی‌های عمومی را در `.env.prod` دقیقاً هماهنگ تنظیم کنید (بخش ۵):
   `APP_BASE_URL`،‏ `WEB_API_URL`،‏ `CRM_API_URL` و
   `CORS_ALLOW_ORIGINS` محدود به مبدأهای واقعی‌تان.
4. نشانی‌های فایل MinIO: ‏`STORAGE_PROVIDER=s3` را نگه دارید و مطمئن شوید
   URLهای presigned در برابر endpoint عمومی‌ای ساخته می‌شوند که مرورگرها
   به آن می‌رسند (به [یادداشت‌های ذخیره‌سازی](storage.md) مراجعه کنید).

اسنیپت‌های دقیق پروکسی وابسته به استقرارند؛ vhost نهایی روی پروکسی
انتخابی‌تان **«نیازمند آزمایش روی سرور واقعی»** است.

## ۵. پیکربندی و اسرار (`.env.prod`)

### ۵.۱ ساخت فایل

```bash
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

فایل `.env.prod` **هرگز** Commit نمی‌شود. فقط `.env.prod.example` در گیت است.

### ۵.۲ تولید اسرار قوی

هر placeholder در نمونه باید جایگزین شود. هر مقدار را مستقل تولید کنید:

```bash
openssl rand -hex 32    # JWT_SECRET
openssl rand -hex 32    # ENCRYPTION_KEY (هنگام چرخش، ENCRYPTION_KEY_VERSION را هم هماهنگ کنید)
openssl rand -hex 24    # POSTGRES_PASSWORD
openssl rand -hex 24    # REDIS_PASSWORD
openssl rand -hex 24    # MINIO_ROOT_PASSWORD
openssl rand -hex 24    # GRAFANA_PASSWORD, MB_APP_DB_PASS, ...
```

### ۵.۳ متغیرهای اجباری

| متغیر | توضیح |
|---|---|
| `JWT_SECRET` | تصادفی قوی، یکتا برای هر محیط |
| `ENCRYPTION_KEY` + `ENCRYPTION_KEY_VERSION` | کلید رمزنگاری فیلدها؛ گم‌کردنش یعنی از دست دادن داده‌های رمز‌شده — یک نسخه را در مدیر رمزتان نگه دارید |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | باید با مشخصات داخل `DATABASE_URL` یکی باشد |
| `REDIS_PASSWORD` | باید با `REDIS_URL` یکی باشد |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | مشخصات روت ذخیره‌سازی شیء |
| `DATABASE_URL`،‏ `REDIS_URL` | رشته‌های اتصال ساخته‌شده از مقادیر بالا — آن‌ها را سازگار نگه دارید |
| `APP_BASE_URL`،‏ `WEB_API_URL`،‏ `CRM_API_URL`،‏ `CORS_ALLOW_ORIGINS` | فقط نشانی‌ها/مبدأهای عمومی واقعی‌تان |
| `STORAGE_PROVIDER` | در production برابر `s3` ‏(MinIO) |
| `GRAFANA_PASSWORD`،‏ `MB_*` | مشخصات مانیتورینگ / Metabase |

یکپارچه‌سازی‌های اختیاری (قابلیت‌ها در نبودشان به‌نرمی degrade می‌شوند):
`SMTP_*` ‏(ایمیل)، `SMS_*` ‏(پیامک)، `ANTHROPIC_API_KEY` ‏(فتوا/دستیار AI —
بدون آن آن قابلیت‌ها به‌جای پاسخ ساختگی، «در دسترس نیست» صادقانه
برمی‌گردانند)، `SENTRY_DSN`،‏ `OTEL_EXPORTER_OTLP_ENDPOINT`.

برنامه در حالت production روی اسرار placeholder یا کوتاه **در زمان بوت
fail-fast** می‌کند — اگر API بالا نیامد، اول همین بخش را بررسی کنید.

### ۵.۴ اسرار گیت‌هاب (برای CI / بیلدهای پلتفرم)

CI روی گیت‌هاب به هیچ راز productionای نیاز ندارد. گواهی‌های امضای کد و
مشخصات فروشگاه‌ها برای بیلدهای بومی آینده متعلق به GitHub Secrets /
مخزن اسرار CI شماست — هرگز در مخزن و هرگز در اشتراک‌گذاری‌های Drive نه.

> ⚠️ **هرگز یک `.env.prod` واقعی، توکن، کلید امضای خصوصی، دامپ دیتابیس
> کاربران واقعی یا هیچ رمزی را در GitHub یا پوشهٔ اشتراکی Google Drive
> قرار ندهید.** فقط قالب‌ها و گزارش‌های پاک‌سازی‌شده آنجا جایشان است.

## ۶. نصب اول — **«نیازمند آزمایش روی سرور واقعی»**

### ۶.۱ پیش‌اعتبارسنجی

```bash
docker compose -f docker-compose.prod.yml config > /dev/null && echo "compose config OK"
```

این فرمان پیکربندی ادغام‌شده را با مقادیر `.env.prod` شما اعتبارسنجی
می‌کند، بدون اینکه اسرار را چاپ کند.

### ۶.۲ ساخت و راه‌اندازی

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### ۶.۳ مایگریشن‌ها — الگوی جاب یک‌باره

سرویس `migrate` یک بار Alembic را اجرا می‌کند (`alembic upgrade head`) و
خارج می‌شود؛ `api` و ورکرها روی آن
`depends_on: service_completed_successfully` اعلام کرده‌اند. **هرگز
مایگریشن را هم‌زمان از چند رپلیکای API اجرا نکنید** — الگوی init-job
دقیقاً برای جلوگیری از همین ساخته شده است. برای اجرای دستی دوباره:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

### ۶.۴ بررسی سلامت

```bash
docker compose -f docker-compose.prod.yml ps        # همهٔ سرویس‌ها up/healthy
curl https://<your-api-host>/health
curl https://<your-api-host>/api/v1/health
```

### ۶.۵ حساب مدیر و 2FA

کاربر super_admin توسط seedای که با راه‌اندازی API اجرا می‌شود از روی
مقادیر محیطی **`ADMIN_EMAIL`** / **`ADMIN_PASSWORD`** ساخته می‌شود —
حساب دمو وجود ندارد. بعد از اولین ورود، **2FA ‏(TOTP) را برای حساب مدیر
فوراً فعال کنید**؛ نقش‌های admin/super_admin در سمت سرور به آن نیاز دارند.

### ۶.۶ تست‌های دودی (همه را اجرا و نتیجه را ثبت کنید)

1. ورود به وب و CRM با حساب مدیر.
2. بررسی دسترسی نقش‌محور: حساب غیرمدیر نباید بخش‌های مدیریتی را ببیند.
3. **ساخت یک PDF گواهی/رسید** — این فونت‌های سیستمی پخته‌شده در ایمیج
   API ‏(`fonts-noto-core` + `fonts-dejavu-core`) را می‌آزماید.
4. آپلود یک فایل و دانلود دوبارهٔ آن از نشانی عمومی (مسیر URL
   ‏presigned در MinIO).
5. فعال‌کردن یک جاب پس‌زمینه (مثلاً یک اعلان) و تأیید پردازش آن توسط یک ورکر.

تا وقتی هر پنج مورد روی سرور واقعی پاس نشده‌اند، استقرار را «در حال کار»
اعلام نکنید.

## ۷. ارتقا و بازگشت (Rollback)

### ۷.۱ ارتقا — **«نیازمند آزمایش روی سرور واقعی»**

1. **اول بکاپ** — دیتابیس + والیوم‌ها، پیش از هر مایگریشن
   (به [بازیابی فاجعه](disaster-recovery.md) و `infra/backup.sh` مراجعه کنید).
2. روی سرور، commit/tag هدف را `git pull` کنید.
3. ‏`docker compose -f docker-compose.prod.yml build`
4. ‏`docker compose -f docker-compose.prod.yml up -d` — جاب یک‌بارهٔ
   `migrate` تغییرات اسکیما را پیش از شروع API جدید اعمال می‌کند.
5. بررسی‌های سلامت و تست‌های دودی (۶.۴ تا ۶.۶) را دوباره اجرا کنید.

### ۷.۲ بازگشت

1. commit/tag خوبِ قبلی را checkout کنید.
2. دوباره build و `up -d` کنید.
3. اگر نسخهٔ شکست‌خورده مایگریشنی اجرا کرده بود، بکاپ پیش از ارتقای گام
   ۷.۱.۱ را بازیابی کنید — بازگشت دستی اسکیما مسیر پشتیبانی‌شده‌ای نیست.

## ۸. بکاپ و نگهداری داده

- سیاست، ‏RPO/RTO و دریل بازیابی در
  [بازیابی فاجعه](disaster-recovery.md) مستند است؛ اسکریپت کمکی
  `infra/backup.sh` است (بکاپ‌هایی با مانیفست SHA-256 تولید می‌کند).
- یک دریل واقعی بکاپ→بازیابی در سندباکس توسعه پاس شده است (فاز ۱۷)، اما
  **بازیابی روی این سرور production ‏«نیازمند آزمایش روی سرور واقعی»
  است** — پیش از go-live یکی را زمان‌بندی کنید.
- بکاپ‌ها را بیرون از میزبان برنامه نگه دارید؛ بکاپ‌های حاوی دادهٔ کاربر
  را رمزنگاری کنید؛ هرگز با لینک عمومی به اشتراک نگذارید.

## ۹. لاگ‌ها و مانیتورینگ

```bash
docker compose -f docker-compose.prod.yml logs -f api worker-ai
docker compose -f docker-compose.prod.yml logs --tail=200 migrate
```

‏Prometheus سرویس‌ها را scrape می‌کند، Grafana داشبوردها را نگه می‌دارد و
Loki لاگ‌ها را جمع می‌کند (`infra/monitoring/prometheus.yml`). رویه‌های
عملیاتی و پاسخ به هشدار در [ران‌بوک](runbook.md) است؛ یادداشت‌های
گسترده‌تر استقرار در [استقرار](deployment.md) و [Staging](staging.md).

## ۱۰. آنچه هنوز روی production راستی‌آزمایی نشده است (فهرست صادقانه)

- اجرای سرتاسری `docker-compose.prod.yml` روی یک سرور واقعی
  (در سندباکس توسعه دیمون داکر در دسترس نبود).
- رفتار زندهٔ PostgreSQL / ‏Redis چندپردازشی، ‏MinIO زنده و اسکن ClamAV
  زیر ترافیک واقعی.
- نصب‌کننده‌های بومی موبایل/دسکتاپ و بیلدهای ابری EAS ‏(نیازمند اتصال
  expo.dev و گواهی‌های امضای مالک).
- اعداد ظرفیت بار — بخش ۲.۲ تخمین است؛ پیش از هر ادعای مقیاس‌پذیری
  اندازه‌گیری کنید. به [یادداشت‌های مقیاس](scaling-to-100k.md) مراجعه کنید.

## همچنین ببینید

- [راهنمای توسعهٔ محلی](../installation/LOCAL_DEVELOPMENT.fa.md)
- [یادداشت‌های استقرار](deployment.md) · [ران‌بوک](runbook.md) ·
  [بازیابی فاجعه](disaster-recovery.md) · [ذخیره‌سازی](storage.md)
- [قرارداد مهندسی](../engineering-contract.md)
