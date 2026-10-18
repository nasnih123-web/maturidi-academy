# برج کنترل — CRM آکادمی ماتریدی

React 18 + Vite 5 + TypeScript 5 + React Router 6 + TanStack Query 5.
Structural scaffold (Phase 2) — functional skeleton, UI polish in later phases.

## اجرا

```bash
cd apps/crm
npm install
cp .env.example .env   # VITE_API_URL → آدرس بک‌اند؛ پیش‌فرض http://localhost:8000
npm run dev            # http://localhost:5173
```

| اسکریپت       | کار                  |
| ------------- | -------------------- |
| `npm run dev` | سرور توسعه (پورت 5173) |
| `npm run build` | typecheck + بیلد production |
| `npm run preview` | پیش‌نمایش بیلد      |
| `npm run typecheck` | `tsc --noEmit`     |

## چه کار می‌کند

- **ورود** (`/login`): ایمیل/شماره + رمز → `POST /api/v1/auth/login`؛ اگر بک‌اند
  `requires_2fa` برگرداند، فیلد کد TOTP ظاهر می‌شود (2FA برای admin/super_admin اجباری است).
- **توکن**: access کوتاه‌مدت + refresh با **rotation**؛ با 401 خودکار یک‌بار
  `POST /api/v1/auth/refresh` صدا زده می‌شود و درخواست تکرار می‌گردد (تک‌پروازی برای 401های هم‌زمان).
- **فید زندهٔ رویدادها** (`/events`): WebSocket به `/ws/events?token=<jwt>`؛
  اتصال مجدد خودکار با backoff نمایی + jitter، ارسال `last_event_id` هنگام وصل مجدد
  (بازیابی رویدادهای ازدست‌رفته از دیتابیس)، پاسخ به heartbeat، حذف تکراری‌ها با `event_id`.
- **مرکز کنترل محتوا** (`/content`): فیلتر (نوع/ماژول/وضعیت/مالک/بازهٔ تاریخ/جست‌وجو) →
  `GET /api/v1/content/items`؛ کلیک روی ردیف → کشوی پیش‌نمایش + سیاست‌ها
  (AI policy، توزیع، زمان‌بندی، جایگاه‌ها). فقط orchestration — منطق دامنه کپی نمی‌شود (§9).
- **تنظیمات پلتفرم** (`/settings`, فقط super_admin): AI، تلگرام، پرداخت، ایمیل/پیامک؛
  `GET`/`PUT /api/v1/admin/settings`. مقادیر secret هرگز نمایش داده نمی‌شوند
  (placeholder `••••`) و فقط در صورت واردکردن مقدار جدید ارسال می‌گردند.
  «بدون ری‌استارت فعال می‌شود».
- **برندینگ** (`/branding`): `app_display_name` سه‌زبانه + شناسهٔ رسانهٔ آیکون/اسپلش؛
  انتخاب‌گر رسانه stub است (media_assets در فاز بعد).
- **i18n**: فارسی (پیش‌فرض، rtl) / عربی (rtl) / انگلیسی (ltr)؛ direction روی `document.documentElement`
  ست می‌شود و از locale جداست. هیچ رشتهٔ قابل‌مشاهده‌ای بیرون از دیکشنری هاردکد نشده.

## کامپوننت‌های مشترک

از `@maturidi/ui-web` (پکیج `packages/ui-web`): `Button`، `Card`، `Badge` (+ نگاشت
وضعیت‌های گردش‌کار §9 به رنگ با `statusTone`). این همان تفکیک پکیج مشترک قرارداد فاز ۰ است.
وابستگی با `file:../../packages/ui-web` است — npm در نصب **کپی** می‌کند، پس بعد از هر
تغییر در `packages/ui-web` دوباره `npm install` بزنید (یا از `npm link` استفاده کنید).

## چه چیز stub/ناقص است (فازهای بعد)

- گیتینگ نقش‌ها در منو stub است — فقط `/users/me` خوانده می‌شود؛ RBAC کامل (role_permissions) بعداً.
- endpointهای `/api/v1/content/*` و `/api/v1/admin/settings` هنوز در بک‌اند نیستند
  (ترک بک‌اند فاز ۲ می‌سازدشان)؛ صفحات طبق قرارداد صدا می‌زنند و empty/error state دارند.
- انتخاب‌گر رسانهٔ برندینگ دستی است؛ دکمهٔ «بازسازی اپ‌ها» در فاز ۱۴ می‌آید.
- توکن‌ها در localStorage نگه‌داری می‌شوند (scaffold) — برای production باید httpOnly cookie بررسی شود.
- تست‌ها (unit/component/E2E) و CI برای CRM در فازهای بعد.
