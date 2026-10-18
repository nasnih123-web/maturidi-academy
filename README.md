# آکادمی ماتریدی — Maturidi Academy

پلتفرم آموزشی اسلامی جامع: وب، CRM، موبایل، دسکتاپ — روی یک بک‌اند مشترک.

## شروع سریع (dev)

```bash
cp .env.example .env
# ویرایش .env — مخصوصاً ENCRYPTION_KEY (نکتهٔ امنیتی فاز ۰ §۳)
docker compose up -d        # PostgreSQL + Redis + MinIO
cd apps/api && ./setup.sh   # migration + ساخت super_admin
docker compose up           # اجرای همهٔ سرویس‌ها
```

> اگر Docker در دسترس نیست: برای توسعهٔ سبک می‌توان از SQLite استفاده کرد —
> جزئیات در `docs/engineering-contract.md` §۳ و `.env.example`.

## ساختار

```
apps/
  api/        FastAPI (async) — Modular Monolith + ARQ workers + WebSocket gateway
  web/        Next.js (App Router) + TypeScript + next-intl
  crm/        React + Vite
  mobile/     React Native + Expo
  desktop/    Tauri
packages/
  design-tokens/  رنگ/تایپوگرافی/فاصله — خام، بدون فریم‌ورک خاص
  ui-web/         کامپوننت React (DOM) برای web و crm
  ui-native/      کامپوننت React Native برای mobile
  icons/         آیکون‌ها
  shared-types/  تایپ‌های مشترک
  config/        کانفیگ مشترک
infra/        Docker Compose و اسکریپت‌های زیرساخت
docs/
  engineering-contract.md   قرارداد مهندسی — قبل از هر تغییری خوانده شود
  adr/                      تصمیم‌های معماری
```

## قراردادها

**قبل از هر تغییر کد، به‌ترتیب بخوان:**
1. `docs/engineering-contract.md`
2. ADRهای مرتبط در `docs/adr/`
3. وضعیت واقعی فعلی ریپازیتوری
4. آخرین قرارداد پذیرفته‌شدهٔ API/رویداد/دیتابیس

## محیط‌ها

سه محیط جدا: `dev` (لوکال)، `staging`، `production` — با متغیرهای مجزا.
دادهٔ واقعی کاربران هرگز در staging استفاده نمی‌شود.

## فازها

نقشهٔ راه ۱۸ فازه در سند پروژه (فاز ۰: قرارداد مهندسی — همین ریپو).
هر فاز = یک نشست، بعد از هر فاز: چک «تعریف انجام‌شده» → `git commit` + تگ.
