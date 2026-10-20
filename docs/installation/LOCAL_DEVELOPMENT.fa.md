# راهنمای نصب و اجرای محلی — آکادمی ماتریدی

راهنمای گام‌به‌گام اجرای کل مونوریپو روی کامپیوتر توسعه‌دهنده.

> **وضعیت تا ۲۰۲۶-۱۰-۲۰ (۲۰ اکتبر ۲۰۲۶).** فرمان‌ها و مسیرهای زیر با ساختار
> واقعی مخزن تطبیق داده شده‌اند. گام‌هایی که با برچسب **«نیازمند راستی‌آزمایی
> روی یک کامپیوتر تمیز»** مشخص شده‌اند، توسط نویسندهٔ این سند از ابتدا تا
> انتها روی یک سیستم تازه اجرا نشده‌اند — یک بار آن‌ها را اجرا کنید و هر
> مغایرتی را گزارش دهید.

---

## ۱. چه چیزهایی اجرا می‌شود

| بخش | فناوری | نشانی محلی |
|---|---|---|
| API | ‎FastAPI (Python 3.12)‎، پوشهٔ `apps/api` | http://localhost:8000 |
| وب | ‎Next.js 15.5.28‎، پوشهٔ `apps/web` | http://localhost:3000 |
| CRM | ‎React + Vite 6.4.4‎، پوشهٔ `apps/crm` | http://localhost:5173 |
| زیرساخت (کامپوز توسعه) | PostgreSQL،‏ Redis،‏ MinIO،‏ Prometheus،‏ Grafana،‏ Loki | پورت‌های مختلف |

**`package.json` ریشه وجود ندارد** — هر اپ وابستگی‌های خودش را جدا نصب
می‌کند. اسکریپت‌های کمکی در ریشهٔ مخزن (`bootstrap.sh` / `bootstrap.ps1`)
راه‌اندازی معمول توسعه را خودکار می‌کنند.

## ۲. پیش‌نیازها (همهٔ سیستم‌عامل‌ها)

| ابزار | نسخه | توضیح |
|---|---|---|
| Git | هر نسخهٔ اخیر | کلون و کنترل نسخه |
| Node.js | **22.11.0** (طبق `.nvmrc`) | وب، CRM، موبایل و پوستهٔ دسکتاپ |
| npm | همراه Node | مدیر بسته‌ای که واقعاً همهٔ اپ‌های این پروژه استفاده می‌کنند |
| Python | **3.12.x — الزامی** | فقط برای اجرای *مستقیم* (بدون داکر) API لازم است. نسخهٔ پین‌شدهٔ `pydantic` در `apps/api/requirements.txt` برای **Python 3.14 ویل ندارد** — از 3.14 استفاده نکنید. |
| Docker Desktop / ‏Docker Engine + Compose | نسخهٔ جاری | روش پیشنهادی اجرای سرویس‌های زیرساخت |

> **Python 3.12 برای مسیر مستقیم API یک الزام سخت است.** اگر روی سیستم‌تان
> فقط Python 3.14 دارید، یا 3.12 را کنار آن نصب کنید یا از مسیر داکر
> استفاده کنید (ایمیج API بر پایهٔ `python:3.12-slim` است).

---

## ۳. ویندوز ۱۰/۱۱

### ۳.۱ نصب ابزارها

1. **Git for Windows** — از https://git-scm.com/download/win
2. **Docker Desktop** با موتور **WSL 2** فعال
   (Settings ← General ← گزینهٔ "Use the WSL 2 based engine"). آن را اجرا
   کنید و صبر کنید تا وضعیت "Engine running" را نشان دهد.
3. **Node.js 22.11.0** — یکی از دو راه:
   - نصب‌کنندهٔ LTS از https://nodejs.org (نسخهٔ نوشته‌شده در `.nvmrc`)، یا
   - nvm-windows: ‎`nvm install 22.11.0`‎ و سپس `nvm use 22.11.0`.
4. **Python 3.12** (فقط برای مسیر مستقیم API) — از https://www.python.org
   (نصب‌کنندهٔ 3.12.x؛ گزینهٔ "Add python.exe to PATH" را فعال کنید).

در یک پنجرهٔ PowerShell جدید بررسی کنید:

```powershell
git --version
node --version      # انتظار: v22.11.0
npm --version
python --version    # انتظار: Python 3.12.x (فقط مسیر مستقیم API)
docker --version
docker compose version
```

### ۳.۲ کلون کردن مخزن

```powershell
cd $HOME\dev
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
```

### ۳.۳ فایل محیطی

```powershell
Copy-Item .env.example .env
```

فایل `.env` را باز کنید و دست‌کم برای `JWT_SECRET` و `ENCRYPTION_KEY`
(به‌همراه `ENCRYPTION_KEY_VERSION`) مقادیر قوی و واقعیِ محلی بگذارید.
به [بخش ۶: محیط و اسرار](#۶-محیط-و-اسرار) مراجعه کنید.

> ⚠️ **هرگز یک `.env` واقعی را Commit نکنید.** این فایل عمداً در
> ‎`.gitignore`‎ است. هیچ توکن، رمز یا کلید خصوصی واقعی‌ای را در گیت — در
> این مخزن یا هیچ جای دیگر — قرار ندهید.

### ۳.۴ بوت‌استرپ تک‌فرمانی (روش پیشنهادی)

**PowerShell را داخل پوشهٔ پروژه** باز کنید (Shift + کلیک راست ←
"Open PowerShell window here"، یا با `cd` وارد پوشه شوید)، سپس اجرا کنید:

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap.ps1
```

> روی `bootstrap.ps1` **دوبار کلیک نکنید** — پنجره‌ای که با دوبار کلیک باز
> شود با اولین خطا بسته می‌شود و نمی‌بینید چه چیزی شکست خورد. همیشه آن را
> از یک پنجرهٔ PowerShell از قبل باز اجرا کنید.

بوت‌استرپ محیط را آماده و استک توسعه را بالا می‌آورد
(API روی :8000، وب روی :3000، ‏CRM روی :5173).

### ۳.۵ مسیر دستی (معادل، گام‌به‌گام)

فقط زیرساخت (PostgreSQL + Redis + MinIO + مانیتورینگ):

```powershell
docker compose up -d
docker compose ps
```

API به‌صورت مستقیم روی میزبان (برای دیباگر و reload سریع):

```powershell
cd apps\api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\setup.sh            # مایگریشن‌ها + ساخت super_admin با seed
                      # (در ویندوز از Git Bash اجرا کنید، یا دو فرمان داخل
                      #  آن را دستی بزنید: alembic upgrade head و سپس فرمان
                      #  seedای که فرا می‌خواند)
```

> **فونت‌های سیستمی برای ساخت PDF گواهی/رسید الزامی‌اند.** داخل داکر این
> کار توسط `apps/api/Dockerfile` انجام شده است
> (`fonts-noto-core` + `fonts-dejavu-core`). روی یک میزبانِ بدون این
> فونت‌ها، ساخت PDF در زمان اجرا با خطای
> `RuntimeError: arabic/latin system fonts not found for certificate PDF`
> متوقف می‌شود.

وب:

```powershell
cd apps\web
npm install
$env:NEXT_PUBLIC_API_URL = "http://localhost:8000"
$env:API_URL = "http://localhost:8000"
npm run dev           # http://localhost:3000
```

CRM:

```powershell
cd apps\crm
npm install
$env:VITE_API_URL = "http://localhost:8000"
npm run dev           # http://localhost:5173
```

### ۳.۶ اولین ورود

**حساب دمو وجود ندارد.** کاربر super_admin در گام seed (فایل `./setup.sh`)
از روی متغیرهای محیطی **`ADMIN_EMAIL`** / **`ADMIN_PASSWORD`** که برای
پروسهٔ API تنظیم کرده‌اید ساخته می‌شود. دقیقاً با همان مشخصات وارد شوید
و سپس برای حساب مدیر 2FA را فعال کنید.

**«نیازمند راستی‌آزمایی روی یک کامپیوتر تمیز»** — مسیر دستی کامل ویندوز
(بخش ۳.۵) از ابتدا تا انتها.

---

## ۴. macOS و لینوکس

تفاوت‌ها با ویندوز؛ بقیهٔ بخش ۳ بدون تغییر اعمال می‌شود.

### ۴.۱ ابزارها

- **Git**: در macOS دستور `xcode-select --install` یا در لینوکس مدیر بستهٔ توزیع.
- **Node 22.11.0**: با `nvm`:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install   # فایل .nvmrc ریشهٔ مخزن را می‌خواند
  nvm use
  ```
- **Python 3.12**: در macOS — ‎`brew install python@3.12`‎؛ در
  Debian/Ubuntu ممکن است نسخهٔ بستهٔ توزیع قدیمی‌تر/جدیدتر باشد؛ اگر
  3.12.x نیست، 3.12 را با `pyenv` نصب کنید (`pyenv install 3.12`).
- **Docker**: در macOS ‏Docker Desktop؛ در لینوکس Docker Engine + پلاگین
  Compose (فرمان‌های نصب سرور در راهنمای استقرار آمده است).

### ۴.۲ بوت‌استرپ

```bash
git clone https://github.com/nasnih123-web/maturidi-academy.git
cd maturidi-academy
cp .env.example .env   # سپس اسرار را ویرایش کنید، بخش ۶
./bootstrap.sh
```

### ۴.۳ مسیر دستی

```bash
docker compose up -d                       # زیرساخت

cd apps/api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./setup.sh                                 # مایگریشن‌ها + seed ساخت super_admin

cd ../web && npm install && npm run dev    # :3000
cd ../crm && npm install && npm run dev    # :5173
```

### ۴.۴ نکتهٔ لینوکس: فونت‌های سیستمی برای PDF

روی یک ماشین لینوکسِ خالی (بدون داکر برای API)، فونت‌هایی را که سازندهٔ
PDF نیاز دارد نصب کنید، وگرنه ساخت گواهی/رسید در زمان اجرا شکست می‌خورد:

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-core fonts-dejavu-core
```

تفاوت‌های shell که باید به خاطر بسپارید: متغیرهای محیطی با
`export NAME=value` ‏(bash/zsh) تنظیم می‌شوند، نه با
`$env:NAME = "value"` در PowerShell، و فعال‌ساز venv دستور
`source .venv/bin/activate` است، نه `.venv\Scripts\Activate.ps1`.

---

## ۵. بررسی سلامت، لاگ‌ها، تست‌ها و توقف

### بررسی سلامت

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/v1/health
```

پیش از دیباگ فرانت‌اندها، هر دو باید پاسخ JSON سالم برگردانند.

### لاگ‌ها

```bash
docker compose logs -f api          # زیرساخت + API کانتینری
docker compose logs -f postgres redis minio
```

پروسه‌های مستقیم خروجی‌شان را در ترمینال خودشان چاپ می‌کنند.

### تست‌ها و گیت‌های کیفیت

```bash
# بک‌اند — ۵۸۲ تست
cd apps/api && pytest

# ‏Ruff (پین‌شده 0.17.1) با گیت baseline بدون افزایش —
# ۱۶۰ یافتهٔ قدیمی در tools/ruff_baseline.json منجمد شده‌اند؛ هر افزایش
# یا جفت file+rule جدید = fail:
python tools/check_ruff_baseline.py

# بیلد وب / CRM (همان فرمان‌هایی که CI اجرا می‌کند)
cd apps/web && npm run build
cd apps/crm && npm run build        # = tsc --noEmit && vite build

# گیت آدیت وابستگی که CI استفاده می‌کند
npm audit --audit-level=high        # داخل apps/web و apps/crm اجرا شود
```

### توقف امن

```bash
docker compose down                 # والیوم‌های نام‌دار (دادهٔ توسعه) حفظ می‌شوند
# در هر ترمینال اجرای مستقیم Ctrl+C (API/وب/CRM)
deactivate                          # خروج از venv پایتون
```

از `docker compose down -v` **فقط** وقتی استفاده کنید که آگاهانه می‌خواهید
دیتابیس‌های توسعه و داده‌های MinIO محلی را حذف کنید.

---

## ۶. محیط و اسرار

- قالب: **`.env.example`** در ریشهٔ مخزن (توسعه).
- آن را به `.env` کپی و مقادیر واقعی محلی را پر کنید. API در حالت
  production اسرار placeholder ناامن را رد می‌کند.
- کلیدهایی که خواهید دید: `DATABASE_URL`،‏ `REDIS_URL`،‏
  `REDIS_PASSWORD`،‏ `JWT_SECRET`،‏ `ENCRYPTION_KEY`،‏
  `ENCRYPTION_KEY_VERSION`،‏ `APP_BASE_URL`،‏ `WEB_API_URL`،‏
  `CRM_API_URL`،‏ `CORS_ALLOW_ORIGINS`،‏ `STORAGE_PROVIDER`
  (`s3` در برابر MinIO توسعه، یا محلی)، `SMTP_*`،‏ `SMS_*`،‏
  `ANTHROPIC_API_KEY` (اختیاری — قابلیت‌های AI بدون آن به‌نرمی degrade
  می‌شوند)، `SENTRY_DSN`،‏ `GRAFANA_PASSWORD`.
- معنای کامل متغیرها: [اسکیمای تنظیمات](../settings-schema.md).

> ⚠️ **هرگز یک `.env` واقعی، توکن، کلید امضا یا رمز را در گیت Commit
> نکنید و در فضای اشتراک‌گذاری عمومی آپلود نکنید.** فقط قالب‌های
> `*.example` متعلق به مخزن‌اند.

---

## ۷. پیش‌نیازهای توسعهٔ موبایل و دسکتاپ

### ۷.۱ موبایل (`apps/mobile`، ‏Expo)

- استک: ‏Expo SDK **~53.0.20**، ‏React **19.0.0**، ‏React Native 0.79.5.
- توسعهٔ محلی:
  ```bash
  cd apps/mobile
  npm install
  npx expo start
  ```
  سپس پروژه را در **Expo Go** روی گوشی‌ای در همان شبکه باز کنید و نشانی
  API توسعه را به اپ بدهید (از دید گوشی، IP شبکهٔ داخلی ماشین توسعه است،
  نه `localhost`).
- **وضعیت صادقانه — بیلدهای ابری EAS هنوز وصل نشده‌اند:** نه فایل
  **`eas.json`** وجود دارد و نه **`projectId`** مربوط به EAS در
  `app.json`. وصل‌کردن پروژه به expo.dev (ورود به حساب، `eas init`)
  اقدامی است که فقط مالک پروژه می‌تواند انجام دهد. تا آن زمان بیلد ابری
  EAS و باینری فروشگاه وجود ندارد.
- **بیلد محلی Android**: به Android SDK + ‏JDK و دستور
  `npx expo run:android` نیاز دارد (یا بیلد Gradle بعد از
  `npx expo prebuild`).
- **بیلد محلی iOS**: به **macOS + Xcode** نیاز دارد. در **ویندوز ناممکن**
  است — هیچ راه میان‌بری مستند نشده، چون وجود ندارد.

### ۷.۲ دسکتاپ (`apps/desktop`، ‏Tauri 2)

- استک: ‏Tauri **2** ‏(`@tauri-apps/cli ^2.2.0`)، نسخهٔ اپ `0.1.0`.
- پیش‌نیازها: ‏Node 22.11.0، ‏**Rust** ‏(با `rustup`) و کتابخانه‌های بومی
  هر پلتفرم:
  - **لینوکس**: بسته‌های توسعهٔ WebKitGTK / GTK و ابزارهای بسته‌بندی
    توزیع‌تان (مثلاً در Debian/Ubuntu: ‏`libwebkit2gtk-4.1-dev`،‏
    `libgtk-3-dev`،‏ `librsvg2-dev`،‏ `libappindicator3-dev`،‏ `patchelf`).
  - **ویندوز**: ‏Microsoft C++ Build Tools + ‏WebView2 runtime.
  - **macOS**: ابزارهای خط فرمان Xcode.
- توسعه / بیلد:
  ```bash
  cd apps/desktop
  npm install
  npm run dev        # tauri dev
  npm run build      # tauri build
  ```
- **وضعیت صادقانه:** نصب‌کننده‌های بومی (MSI/NSIS، ‏.dmg، ‏.deb/.AppImage)
  هنوز **تولید نشده‌اند**. پوستهٔ Tauri وجود دارد و type-check می‌شود؛
  تولید اینستالر را کارِ ساخته‌نشده بدانید، نه یک خروجی تمام‌شده.
  **«نیازمند راستی‌آزمایی روی یک کامپیوتر تمیز.»**

---

## ۸. جدول رفع اشکال سریع

| نشانه | علت محتمل | رفع |
|---|---|---|
| API با شکایت از اسرار خارج می‌شود | `JWT_SECRET` / `ENCRYPTION_KEY` به‌صورت placeholder در `.env` | مقادیر تصادفی قوی بگذارید (مثال‌های `openssl rand` در بخش اسرار راهنمای production) |
| خطای `RuntimeError: arabic/latin system fonts not found` در ساخت PDF | نبود فونت روی میزبان خالی | نصب `fonts-noto-core` + `fonts-dejavu-core`، یا اجرای API با داکر |
| `pip install` می‌خواهد pydantic را از سورس بسازد / شکست می‌خورد | نسخهٔ پایتون 3.14 است، نه 3.12 | ‏Python 3.12.x نصب و venv را از نو بسازید |
| بیلد وب روی `/api/search` شکست می‌خورد | `API_URL` برای بیلد تنظیم نشده | پیش از `npm run build` هردوی `API_URL=http://localhost:8000` و `NEXT_PUBLIC_API_URL` را تنظیم کنید |
| گوشی در Expo Go به API نمی‌رسد | `localhost` به خود گوشی اشاره می‌کند | برای نشانی API از IP شبکهٔ داخلی ماشین توسعه استفاده کنید |
| پنجرهٔ `bootstrap.ps1` ناپدید می‌شود | با دوبار کلیک باز شده | اول PowerShell را در پوشه باز کنید، بعد فرمان بخش ۳.۴ را بزنید |

---

## همچنین ببینید

- [فهرست مستندات](../README.md)
- [راهنمای نصب Production](../ops/production-installation.fa.md)
- [قرارداد مهندسی](../engineering-contract.md)
- [یادداشت‌های استقرار](../ops/deployment.md) · [ران‌بوک](../ops/runbook.md)
