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

> **وضعیت کامل خط لوله (C-05):** همان endpoint حالا بخش `pipeline` را هم
> برمی‌گرداند — توکن callback بیلد (B-01)، نشانی عمومی API، و لینک‌شدن
> پروژهٔ Expo (شناسه در تنظیم `builds.expo_project_id` در CRM ثبت
> می‌شود) — و فهرست `ci_side` پیش‌نیازهایی را که داخل GitHub Secrets /
> EAS زندگی می‌کنند و API به آن‌ها دید ندارد (مثل EXPO_TOKEN و
> keystore) با برچسب صادقانهٔ «تأیید در CI» نشان می‌دهد. صفحهٔ Builds
> در CRM هر سه بخش را نمایش می‌دهد؛ هیچ پیش‌نیازی «آماده» نشان داده
> نمی‌شود مگر وقتی واقعاً برقرار باشد.

> ⚠️ **نکتهٔ workflow:** اپ GitHub این پروژه اجازهٔ push فایل‌های
> `.github/workflows/*` را ندارد (403). نسخهٔ جدید `mobile.yml` (با
> inputهای dispatch) روی همین برنچ هست؛ هنگام مرج، مالک باید آن را از
> طریق وب GitHub روی `main` اعمال کند، وگرنه dispatch موبایل inputها را
> نمی‌شناسد.

## ۳) ورودی‌های workflow (mobile.yml)

`platform` (android/ios/all) · `profile` (development/preview/production —
برای دکمهٔ CRM به‌صورت خودکار map می‌شود: production → ‏`production-apk`)
· `app_name` · `package_id` · `app_version` · `version_code` · `api_url` ·
`environment` · `request_id` · `release_tag`. این مقادیر در اکشن به‌صورت
env به `app.config.js` می‌رسند (`EXPO_PUBLIC_API_URL`, `APP_NAME`,
`APP_PACKAGE_ID`, `APP_VERSION_NAME`, `APP_VERSION_CODE`).

**سیاست `release_tag` (سمت API، `release_tag_for` در builds_service):**
تگ فقط وقتی ساخته و فرستاده می‌شود که محیط بیلد `production` باشد **و**
نسخه شکل معتبر `digits.digits.digits` داشته باشد؛ آن‌وقت
`release_tag = v<version>` است. در همهٔ حالت‌های دیگر (preview/development
یا نسخهٔ خالی/نامعتبر) تگ خالی است و خروجی فقط workflow artifact می‌ماند —
هیچ Releaseای لمس نمی‌شود. روی رکورد CRM، وقتی درخواست با تگ dispatch شده
باشد `release_url` هم پر می‌شود:
`https://github.com/<repo>/releases/tag/<tag>`.

در خود اکشن: بیلد EAS ثبت و تا وضعیت نهایی **Poll** می‌شود؛ فقط بیلد
`FINISHED` دانلود می‌شود و پیش از هر انتشاری بر اساس نوعش اعتبارسنجی
می‌شود (APK: ‏`apksigner` + ‏`aapt`؛ ‏AAB: ‏`jarsigner` + ‏bundletool
پین‌شده؛ IPA: ‏`plistlib` + وجود `mobileprovision` — و چون روی رانر
لینوکسی `codesign` قابل راستی‌آزمایی نیست، در مانیفست همین ثبت می‌شود).
خروجی معتبر + `build-manifest.json` (نوع دقیق، package/version استخراج‌شده
از خود فایل، SHA-256، وضعیت امضا، commit، لینک run، و `install_test:
NOT TESTED`) + `SHA256SUMS.txt` به Release پیش‌نویس همان نسخه وصل می‌شوند.
گارد Release در workflow: به Release **منتشرشده** هرگز چیزی اضافه
نمی‌شود؛ Tag موجودِ اشاره‌کننده به کامیت دیگر جابه‌جا نمی‌شود (فقط الصاق
به Draftِ همان نسخه، با هشدار و ثبت `tag_commit` در مانیفست)؛ Release
جدید همیشه Draft است و Tag جدید دقیقاً روی کامیت همان بیلد ساخته می‌شود.
موفقیت بیلد به‌تنهایی اثبات نصب سالم نیست.

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
درخواست‌ها می‌آید و خروجی اعتبارسنجی‌شده در artifact همان run است. برای
بیلد production (با نسخهٔ معتبر)، APK علاوه بر آن به Release پیش‌نویس
همان نسخه وصل می‌شود و `release_url` روی رکورد CRM می‌آید — انتشار
نهایی Release همیشه دستی است. برای iOS علاوه بر این‌ها حساب Apple
Developer لازم است (خارج از اسکوپ این فاز).

## ۶) دسکتاپ از همان صفحه

برای پلتفرم desktop، dispatch به `desktop.yml` می‌رود. آن workflow فقط
یک input تعریف کرده است — `release_tag` — و API دقیقاً همان را (با همان
سیاست §۳: فقط production + نسخهٔ معتبر) می‌فرستد؛ وقتی سیاست تگی ندهد،
اصلاً `inputs` فرستاده نمی‌شود (GitHub برای input تعریف‌نشده 422
می‌دهد). `desktop.yml` هم همان گارد Release موبایل را دارد و باندل‌های
هر سه سیستم‌عامل را با مانیفست جدا (`build-manifest-<platform>.json` —
فعلاً با وضعیت امضای صادقانهٔ `unsigned` و `install_test: NOT TESTED`)
به همان Release پیش‌نویس وصل می‌کند. خود باینری دسکتاپ پوستهٔ محلی
ADR-0023 است و URL وب production را از `shell/config.js` می‌خواند —
راهنما: `apps/desktop/README.md`.
