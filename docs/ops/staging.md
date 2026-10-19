# محیط Staging — رویهٔ پیش‌انتشار (فاز ۱۷)

> **قانون طلایی:** روی staging فقط و فقط **دادهٔ ساختگی (fake/seed)** — هرگز دادهٔ واقعی کاربران.
> نقض این قانون، نقض حریم خصوصی کاربران است، نه فقط یک خطای عملیاتی.

---

## ۱. هدف staging

آخرین دروازهٔ پیش از production: کل مسیر استقرار (build → migrate → seed → smoke)
روی محیطی **مشابه production** ولی با دادهٔ fake اجرا می‌شود تا باگ‌های استقرار،
ناسازگاری migration و رگرسیون‌های E2E **قبل** از رسیدن به کاربران واقعی گرفته شوند.

## ۲. تفاوت‌های محیطی (staging در برابر production)

| محور | staging | production |
|---|---|---|
| دیتابیس | PostgreSQL جدا (هاست/دیتابیس جدا) | PostgreSQL اصلی |
| داده | فقط seed ساختگی (`app.seed` + سناریوهای E2E) | دادهٔ واقعی کاربران |
| درگاه پرداخت | **حتماً sandbox** (`payment.zarinpal_sandbox=true`) | واقعی |
| تلگرام | بات تستی جدا یا `telegram.enabled=false` | بات اصلی |
| ایمیل/پیامک | provider تستی یا لاگ (dev-mode) | واقعی |
| دامنه | `staging.example.com` جدا | دامنهٔ اصلی |
| Secrets | مقادیر تستی جدا (کلیدهای واقعی هرگز) | secrets manager |
| AI/LLM | کلید تستی یا حالت `llm_unavailable` | کلید واقعی |

### ساختن staging از compose تولید

```bash
# همان فایل production، با env جدا:
cp .env.prod.example .env.staging   # مقادیر staging (sandbox، دامنهٔ staging)
docker compose -f docker-compose.prod.yml --env-file .env.staging -p maturidi-staging up -d --build

# seed ساختگی (هرگز restore بکاپ production به staging نکنید!)
docker compose -f docker-compose.prod.yml --env-file .env.staging -p maturidi-staging \
  exec api python -m app.seed
```

> ⚠️ **هرگز** dump production را روی staging restore نکنید — حتی «موقتاً برای دیباگ».
> اگر باگ فقط با دادهٔ واقعی بازتولید می‌شود، داده را **ناشناس‌سازی (anonymize)** کنید
> یا سناریوی E2E معادل بنویسید (`apps/api/tests/test_phase17_e2e.py`).

## ۳. چک‌لیست promotion به production (مرحله‌به‌مرحله)

### ۳.۱. پیش‌نیاز (روی staging سبز)

- [ ] `alembic upgrade head` روی دیتابیس خالی staging بدون خطا (تست migration از صفر)
- [ ] `alembic upgrade head` روی دیتابیسی که **یک نسخه عقب‌تر** است (تست مسیر ارتقا — مثل تمرین DR)
- [ ] سوئیت کامل pytest سبز (CI)
- [ ] تست دود k6 (`tests/load/k6-smoke.js`) روی staging بدون رگرسیون نسبت به baseline بخش ۴
- [ ] اسکن امنیتی (Semgrep/Bandit/ZAP) بدون یافتهٔ Critical/High باز
- [ ] E2E حیاتی دستی: ثبت‌نام → لاگین → جست‌وجو → فتوا → اهدای sandbox → لاگین CRM

### ۳.۲. بکاپ و آماده‌سازی production

- [ ] بکاپ تازهٔ production گرفته و **قابل restore بودن آن تأیید** شده (`docs/ops/disaster-recovery.md` §۵)
- [ ] `.env.prod` بازبینی شده (کلیدهای واقعی، `APP_ENV=production`، `DEBUG` خاموش)
- [ ] پنجرهٔ نگهداری (maintenance window) اگر migration مخرب/زمان‌بر است، اعلام شده
- [ ] rollback plan آماده است: تگ ایمیج قبلی + بکاپ pre-deploy (جزئیات: `docs/ops/deployment.md`)

### ۳.۳. استقرار

- [ ] deploy طبق `docs/ops/deployment.md` (ابتدا staging، بعد production)
- [ ] `alembic upgrade head` روی production موفق
- [ ] health checks سبز: `GET /health` هر سه سرویس + لاگین ادمین + یک تراکنش sandbox

### ۳.۴. پس از استقرار (۳۰ دقیقهٔ اول)

- [ ] مانیتورینگ: خطای 5xx در Loki/Grafana، صف‌های ARQ (lag)، فضای دیسک
- [ ] یک پرداخت واقعی کوچک (مبلغ ناچیز) و بازپرداخت/لغو آن — تأیید زنجیرهٔ پرداخت
- [ ] اعلام پایان به on-call بعدی با یادداشت تغییرات (runbook §۸)

## ۴. نگهداری staging

- staging را **هفته‌ای یک‌بار** از `main` rebuild کنید تا کهنه نشود (drift بین staging و
  production خودش یک ریسک است).
- دادهٔ seed را دوره‌ای reset کنید (`docker compose down -v` + up + seed) تا تست‌ها روی
  دادهٔ تمیز اجرا شوند.
- دسترسی به staging را محدود به تیم نگه دارید (دادهٔ fake هم نباید عمومی باشد — ممکن است
  شامل سناریوهای امنیتی/پرداخت sandbox باشد).
