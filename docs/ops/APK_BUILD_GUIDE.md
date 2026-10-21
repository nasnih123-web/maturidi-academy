# راهنمای بیلد APK (و iOS) — CRM Builds + EAS

> **وضعیت صادقانه (2026-10-21):** ماشین dispatch واقعی است و از CRM کار
> می‌کند، **اما هنوز هیچ APKای ساخته نشده است**: ساخت APK روی Expo/EAS
> نیازمند حساب Expo مالک پروژه است (**MOBILE-EAS-01 — BLOCKED**، گام‌های
> دقیق مالک در §۵). تا وقتی آن گام‌ها انجام نشوند، وضعیت درست در CRM
> «ارائه‌دهندهٔ بیلد پیکربندی نشده» است، نه موفقیت جعلی.

## ۱) جریان کاری (آنچه واقعاً اتفاق می‌افتد)

1. ادمین در CRM به صفحهٔ **Builds** می‌رود و «درخواست بازسازی» را می‌زند:
   پلتفرم (android/ios/desktop) + برندینگ — نام اپ، `package_id`،
   `version_code`، نشانی API و محیط (development/preview/production).
   اعتبارسنجی سمت سرور: `package_id` باید نام پکیج معتبر جاوا باشد،
   `version_code` عدد صحیح مثبت، و برای production نشانی API نمی‌تواند
   localhost باشد (422).
2. API اگر provider پیکربندی شده باشد (متغیرهای §۲)، یک
   `workflow_dispatch` واقعی به GitHub می‌فرستد (برای موبایل:
   `.github/workflows/mobile.yml`؛ دسکتاپ: `desktop.yml`) و `run id` و
   URL اجرا را روی رکورد ذخیره می‌کند. اگر dispatch شکست بخورد، رکورد
   همان لحظه `failed` می‌شود و API خطای 502 می‌دهد.
3. تسک دوره‌ای ARQ به نام `build-status-sync` (روی صف analytics، هر ۲
   دقیقه) وضعیت run را از GitHub می‌خواند و رکورد را به‌روز می‌کند:
   `queued → running → completed/failed` + نام artifact.
4. در CRM: ردیف‌های dispatched لینک اجرای واقعی + نام artifact دارند.
   ردیف‌های قدیمی فاز ۱۴ (پیش از این ماشین) هرگز dispatch نشده‌اند؛ CRM
   آن‌ها را «ارسال نشده» نشان می‌دهد — نه «در صف» جعلی.

## ۲) پیش‌نیاز سمت API (بدون این‌ها دکمهٔ بیلد صادقانه 503 می‌دهد)

روی سرویس API این متغیرها را ست کنید (مقادیر واقعی هرگز در ریپو نیست):

| متغیر | مقدار |
|---|---|
| `GITHUB_DISPATCH_TOKEN` | توکن GitHub با دسترسی `actions:write` روی ریپو (fine-grained PAT مالک) |
| `GITHUB_REPO` | `nasnih123-web/maturidi-academy` |

بدون این دو، `POST /api/v1/admin/builds/rebuild` خطای
`503 build_provider_not_configured` می‌دهد و **هیچ ردیفی ساخته نمی‌شود**؛
هدر صفحهٔ Builds در CRM هم همین وضعیت را از قبل اعلام می‌کند
(`GET /api/v1/admin/builds/prereqs → provider.configured`).

> ⚠️ **نکتهٔ workflow:** اپ GitHub این پروژه اجازهٔ push فایل‌های
> `.github/workflows/*` را ندارد (403). نسخهٔ جدید `mobile.yml` (با
> inputهای dispatch) روی همین برنچ هست؛ هنگام مرج، مالک باید آن را از
> طریق وب GitHub روی `main` اعمال کند، وگرنه dispatch موبایل inputها را
> نمی‌شناسد.

## ۳) ورودی‌های workflow (mobile.yml)

`platform` (android/ios/all) · `profile` (development/preview/production —
برای دکمهٔ CRM به‌صورت خودکار map می‌شود: production → ‏`production-apk`)
· `app_name` · `package_id` · `app_version` · `version_code` · `api_url` ·
`environment` · `request_id`. این مقادیر در اکشن به‌صورت env به
`app.config.js` می‌رسند (`EXPO_PUBLIC_API_URL`, `APP_NAME`,
`APP_PACKAGE_ID`, `APP_VERSION_NAME`, `APP_VERSION_CODE`).

در خود اکشن: `eas build --no-wait` اجرا می‌شود — یعنی «موفقیت» run یعنی
بیلد با موفقیت به EAS **تحویل** شده است؛ لینک نهایی APK داخل artifactای
به نام `mobile-build-<request_id>` (فایل `build-info.json`) ذخیره می‌شود.
تعمداً این‌طور مستند شده تا تحویل به EAS با «APK آماده» اشتباه گرفته
نشود.

## ۴) پروفایل‌های EAS (`apps/mobile/eas.json`)

| پروفایل | کاربرد | خروجی |
|---|---|---|
| `development` | dev client | development build |
| `preview` | توزیع داخلی | APK |
| `production-apk` | انتشار مستقیم | **APK واقعی** ‏(`android.buildType: "apk"`) |
| `production` | فروشگاه | AAB |

آیکون‌ها/اسپلش واقعی از نشان مدرسه ساخته و در `apps/mobile/assets/`
هستند؛ `app.config.js` نشانی API را از env می‌خواند و در پروفایل‌های
preview/production بدون نشانی واقعی **با خطای صریح متوقف می‌شود**
(localhost فقط برای development مجاز — F-09).

## ۵) MOBILE-EAS-01 — گام‌های باقی‌ماندهٔ مالک (BLOCKED)

این‌ها فقط با حساب Expo مالک انجام می‌شوند؛ هیچ‌کدام قابل شبیه‌سازی
نیست:

```bash
# ۱) ورود به حساب Expo (حساب مالک پروژه)
npx eas-cli login

# ۲) مقداردهی واقعی projectId (جای خالی extra.easProjectId پر می‌شود)
cd apps/mobile
npx eas-cli init

# ۳) ساخت توکن Expo برای CI و ثبتش به‌عنوان GitHub secret به نام EXPO_TOKEN:
#    در expo.dev وارد شوید → Account settings → Access tokens → ساخت توکن
#    GitHub → repo → Settings → Secrets and variables → Actions → EXPO_TOKEN

# ۴) ساخت/ثبت keystore اندروید (امضای انتشار)
npx eas-cli credentials
```

بعد از این ۴ گام: از CRM یک بیلد preview بگیرید؛ لینک اجرا در جدول
درخواست‌ها می‌آید و APK از artifact ‏(`build-info.json` → ‏`buildUrl`)
قابل دانلود است. برای iOS علاوه بر این‌ها حساب Apple Developer لازم
است (خارج از اسکوپ این فاز).

## ۶) دسکتاپ از همان صفحه

برای پلتفرم desktop، dispatch به `desktop.yml` می‌رود (بدون input —
GitHub برای ورک‌فلو بدون input تعریف‌شده، body دارای inputs را 422
می‌کند). خود باینری دسکتاپ پوستهٔ محلی ADR-0023 است و URL وب production
را از `shell/config.js` می‌خواند — راهنما: `apps/desktop/README.md`.
