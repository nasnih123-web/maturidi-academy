# قرارداد اسکیمای تنظیمات پلتفرم — میل‌استون polish (Track A)

> منبع حقیقت کد: `apps/api/app/core/platform_settings.py` (`SETTING_DEFS`)
> و `apps/api/app/seed.py` (`seed_platform_settings_defaults`).
> همهٔ مقادیر در DB با envelope رمزنگاری‌شده ذخیره می‌شوند (فاز ۰ §۳).

## ۱) کلیدهای جدید polish

| کلید | نوع | پیش‌فرض (seed) | مصرف‌کننده | اعتبارسنجی |
|---|---|---|---|---|
| `particles` | json (object) | `{enabled: true, count: 100, speed: 1.0, parallax: 1.0, lines: true}` | web (AtmosphericEngine) + CRM (لایهٔ ذرات) | object؛ فیلد ناشناخته → ۴۰۰؛ `enabled`/`lines` بولی، `count` عدد صحیح ۰..۱۰۰۰، `speed`/`parallax` عدد ≥ ۰؛ فیلدهای غایب با پیش‌فرض پر می‌شوند |
| `fonts.fa` / `fonts.ar` / `fonts.en` | json (object \| null) | `null` = فونت داخلی (fa→Vazirmatn، ar→Cairo، en→Inter) | web + CRM (فونت هر لوکیل؛ آپلودشده بر داخلی اولویت دارد) | `null` یا `{family: string غیرخالی, url: string غیرخالی}` |
| `home.sections` | json (array) | ۹ اسلات زیرِ هیرو به ترتیب فعلی seed بخش‌ها (`live_status` … `footer`) | web (ترتیب/فعال‌بودن اسلات‌ها) | آرایه‌ای از `{id: string غیرخالی و یکتا, variant: string غیرخالی, enabled: bool}` |
| `hero.fa` / `hero.ar` / `hero.en` | json (object) | کپی فعلی هیروی وب (title/subtitle/primary_cta/secondary_cta هر لوکیل) | web (متن هیرو) | `title` غیرخالی الزامی؛ `subtitle` رشته؛ `primary_cta`/`secondary_cta` یا `null` یا `{label: string, href: string}` |

### واریانت‌های `home.sections` (۱۰ مدل بخش — مستندسازی برای Track C)

`variant` هر رشتهٔ غیرخالی را می‌پذیرد (بدون نیاز به migration برای واریانت جدید)؛
۱۰ مدل فعلی از `seed_home_sections`:

`hero`، `live_status`، `latest_fatwas`، `quran_of_day`، `suggested_lessons`،
`fresh_library`، `community`، `nearby_map`، `donation_banner`، `footer`

پیش‌فرض seed فقط ۹ تای زیرِ هیرو را دارد (`hero` جدا با `hero.<locale>` مدیریت می‌شود).

### نوع `json` (جدید در این میل‌استون)

پنجمین نوع تنظیمات در کنار `secret | string | localized | uuid`. مقدار ورودی
باید JSON-serializable باشد؛ برای کلیدهای polish اعتبارسنج اختصاصی اعمال و
خروجی canonical ذخیره می‌شود. `decode` در GET، آبجکت/آرایهٔ واقعی برمی‌گرداند
(نه رشتهٔ JSON).

## ۲) revalidation تنظیمات (تسک #۳)

- `GET /api/v1/admin/settings` هر آیتم را با `updated_at` (زمان UTC آخرین نوشتن
  همان کلید، ISO 8601) و کل پاسخ را با `version` (عدد صحیح) برمی‌گرداند.
- `PUT /api/v1/admin/settings` و endpointهای فونت بعد از هر commit موفق،
  نسخه را بالا می‌برند (`bump_settings_version`) و کش را باطل می‌کنند —
  hot-reload بدون ری‌استارت (ADR-002).
- کش درون‌فرایندی: تنها کش سمت‌سرور تنظیمات است. هر ورودی حداکثر
  `SETTINGS_CACHE_TTL = 60` ثانیه عمر دارد (`app/core/platform_settings.py`)؛
  نوشتن فوراً باطلش می‌کند. وب per-request می‌خواند و با `version` revalidate می‌کند.
- کلیدهای حساس همچنان در GET به‌صورت `"***"` mask می‌شوند و در audit فقط
  `{"changed": true}` ثبت می‌شود (فاز ۰ §۱۴).

## ۳) endpointهای فونت (تسک #۶)

- `POST /api/v1/admin/fonts` (multipart؛ مجوز `platform.settings` — عملاً super_admin):
  فیلدها `locale` (fa|ar|en)، `family` (۱..۱۲۰ نویسه)، `file`.
  اعتبارسنجی (قرارداد §۷): پسوند ∈ {woff2, woff, ttf}، حجم ≤ ۵MB،
  magic bytes (`wOF2` / `wOFF` / `00 01 00 00`) — رد با پاکت خطای استاندارد
  (`invalid_font_extension` / `font_too_large` ۴۱۳ / `invalid_font_file` /
  `invalid_locale` / `invalid_font_family`).
  ذخیره‌سازی: `apps/api/static/fonts/<locale>/<slug>-<rand8>.<ext>` و سرو از
  `/static` (در `main.py` با `StaticFiles` mount شده؛ دایرکتوری runtime است و
  در `.gitignore` قرار دارد). موفق → `fonts.<locale> = {family, url}` + پاسخ ۲۰۱
  `{locale, family, url, version}` + audit و domain event.
- `DELETE /api/v1/admin/fonts/{locale}`: `fonts.<locale> = null`، حذف فایل
  (با محافظت در برابر path traversal)، پاسخ `{locale, family: null, url: null, version}`.
- OpenAPI خودکار از FastAPI (قرارداد §۱ — دستی نوشته نشده).

## ۴) حذف dark mode (تسک #۹ — بخش بک‌اند)

جست‌وجوی کامل بک‌اند (`apps/api`: کلیدهای تنظیمات، منطق تم/حالت) هیچ کلید یا
منطق dark-mode/theme-mode نداشت — چیزی برای حذف نبود. استایل imperial
dark-obsidian تنها تم است و در `platform_settings` ثبت نشده بود.

## ۶) کلیدهای فاز ۵ — قرآن / مناجات (Track 1 — بک‌اند)

> منبع حقیقت کد: `apps/api/app/core/platform_settings.py` (`SETTING_DEFS` +
> اعتبارسنج‌های `_validate_*`) و `apps/api/app/seed.py`
> (`seed_platform_settings_defaults`). همه نوع `json` (الگوی ADR-0003)؛
> مصرف‌کنندهٔ همهٔ کلیدها وب/موبایل/دسکتاپ آینده‌اند (Track 2).

| کلید | نوع | پیش‌فرض (seed) | اعتبارسنجی |
|---|---|---|---|
| `quran.provider` | json (string) | `"alquran_cloud"` | رشتهٔ غیرخالی از providerهای ثبت‌شده (`alquran_cloud`) |
| `quran.translations` | json (array) | `["en.sahih", "fa.makarem"]` | آرایه‌ای از شناسه‌های edition غیرخالی و یکتا؛ ترتیب = ترتیب نمایش |
| `quran.tafsirs` | json (array) | `["ar.muyassar"]` | مثل بالا |
| `quran.reciters` | json (array) | `["ar.alafasy"]` | مثل بالا |
| `quran.active_languages` | json (array) | `["fa", "ar", "en"]` | زیرمجموعهٔ غیرخالی `{fa, ar, en}` |
| `quran.show_translation` | json (bool) | `true` | بولی |
| `quran.show_tafsir` | json (bool) | `true` | بولی |
| `quran.highlight_mode` | json (string) | `"ayah"` | یکی از `word`/`ayah`/`off` |
| `quran.font_size` | json (number) | `20` | عدد ۱۲..۷۲ |
| `quran.playback` | json (object) | `{autoplay: false, repeat: "off"}` | `{autoplay: bool, repeat: off\|ayah\|surah}`؛ فیلد ناشناخته → ۴۰۰ |
| `munajat.enabled` | json (bool) | `true` | بولی |
| `munajat.window` | json (object) | `{start: "02:00", end: "05:00"}` | `{start, end}` هر دو `HH:MM` (‏۰۰:۰۰–۲۳:۵۹) |
| `adhan.defaults` | json (object) | `{calculation_method: "mwl", madhab: "shafi"}` | `calculation_method`: یکی از `isna`/`mwl`/`egypt`/`karachi`/`makkah`/`jafari`؛ `madhab`: ‏`shafi`/`hanafi` |
| `ai.provider` | json (string) | `"none"` | یکی از `none`/`claude` — بدون provider، پاسخ‌ها graceful (`llm_unavailable`) برمی‌گردند |
| `ai.claude_model` | json (string) | `"claude-sonnet-4-5"` | رشتهٔ غیرخالی — مدل Anthropic Messages API |
| `ai.claude_api_key` | secret | (seed نمی‌شود) | کلید Anthropic — فقط از CRM (استیج) یا env؛ هرگز لاگ/آدیت نمی‌شود |
| `ai.daily_quota_per_user` | json (number) | `20` | عدد صحیح ۱..۱۰۰۰۰ — سقف روزانهٔ endpointهای AI |
| `ai.rate_per_minute` | json (number) | `5` | عدد صحیح ۱..۶۰۰ — سقف درخواست در دقیقه |
| `ai.external_research_enabled` | json (bool) | `false` | بولی — تحقیق خارجی (§۹.۶)؛ پیش‌فرض خاموش |
| `ai.stream_timeout_s` | json (number) | `60` | عدد صحیح ۵..۶۰۰ — timeout تولید/استریم |
| `ai.embedding_provider` | json (string) | `"hash"` | یکی از `hash`/`external_api`/`local_model` — ‏`hash` قطعی و بدون وابستگی است |
| `ai.embedding_endpoint` | json (string\|null) | `null` | endpoint سرویس embedding خارجی (برای `external_api`) |
| `ai.embedding_api_key` | secret | (seed نمی‌شود) | کلید سرویس embedding خارجی |
| `ai.embedding_model` | json (string\|null) | `null` | نام مدل embedding خارجی |

نکته‌ها:
- متن معیار قرآن فقط از provider می‌آید؛ این کلیدها فقط *انتخاب* و *نحوهٔ نمایش*
  را کنترل می‌کنند — هیچ‌کدام متن را ویرایش نمی‌کند (ADR-0004).
- `GET /api/v1/quran/providers` همین مقادیر را (با fallback پیش‌فرض‌های سرویس)
  به کلاینت می‌دهد تا CRM نمایش/ترتیب را مدیریت کند.
- پنجرهٔ مناجات به وقت محلی کاربر است؛ endpoint وضعیت (`GET /api/v1/quran/munajat/status`)
  افست `tz` را از کلاینت می‌گیرد.

## ۸) کلیدهای تلگرام — فاز ۱۱ (ADR-0008)

| کلید | نوع | مصرف‌کننده | نکته |
|---|---|---|---|
| `telegram.enabled` | json (bool) | بات تلگرام | `false`/غایب → همهٔ فراخوانی‌ها graceful غیرفعال |
| `telegram.bot_token` | secret | بات تلگرام | هرگز لاگ/نمایش داده نمی‌شود |
| `telegram.webhook_secret` | secret | وبهوک بات | هدر `X-Telegram-Bot-Api-Secret-Token` |
| `telegram.channel` | string | توزیع/اعلان‌ها | کانال پیش‌فرض (مثل `@madrasto_al_emamo_al_matoridi`) |
| `telegram.api_id` / `telegram.api_hash` | secret | اتصال Telethon از CRM | دستی از CRM وارد می‌شود |
| `telegram.session` | secret | درون‌ریزی Telethon | StringSession رمزنگاری‌شده (§۳)؛ در audit فقط `{"field": "telegram_session", "changed": true}` |
| `telegram.phone_masked` | string | نمایش وضعیت CRM | فقط ۴ رقم آخر |
| `telegram.pending_*` | secret/string | جریان دومرحله‌ای اتصال | داخلی؛ TTL ده دقیقه، یک‌بارمصرف |

## ۱۰) کلید نقشهٔ اماکن — فاز نقشه (overnight/w10)

| کلید | نوع | مصرف‌کننده | نکته |
|---|---|---|---|
| `places.popup` | json | نقشهٔ وب (`/places` + بخش نقشهٔ صفحهٔ اصلی) | شکل پاپ‌آپ: `{"show_image": bool, "show_description": bool, "show_type": bool, "show_city": bool}`؛ همه پیش‌فرض `true`؛ از CRM (صفحهٔ اماکن، بخش «نمایش نقشه») کنترل می‌شود؛ در `GET /api/v1/settings/public` سفیدلیست شده است |
| `places.types` | json | کرهٔ سه‌بعدی وب (`/places`: راهنما، نشانگرها، فرم ثبت) + CRM (صفحهٔ اماکن) | فهرست نوع‌های مکان: `[{"key", "emoji", "fa", "ar", "en"}]`؛ پیش‌فرض ۶ نوع (مسجد 🕌، حرمین 🕋، کتابخانه 📚، موزه 🏛️، زیارتی 🌙، سایر 📍)؛ در زمان نوشتن اعتبارسنجی می‌شود (کلید یکتا، حداکثر ۳۲ نویسه)؛ بک‌اند نوع مکان را برابر همین فهرست بررسی می‌کند (با فهرست پیش‌فرض به‌عنوان fallback)؛ از CRM (بخش «انواع مکان») قابل افزودن/ویرایش است؛ در `GET /api/v1/settings/public` سفیدلیست شده است |
| `places.globe` | json | کرهٔ سه‌بعدی وب (`/places`) | نمای پیش‌فرض کره: `{"defaultLat", "defaultLng", "defaultAltitude", "defaultMode" ("satellite"\|"simple"\|"dark"\|"topology"), "autoRotate"}`؛ پیش‌فرض روی کعبه (21.4225, 39.8262)، ارتفاع 2.5، حالت ماهواره‌ای، بدون چرخش خودکار؛ از CRM (بخش «نمای پیش‌فرض کرهٔ سه‌بعدی») کنترل می‌شود؛ در `GET /api/v1/settings/public` سفیدلیست شده است |

## ۹) کلیدهای پوش — فاز ۱۳ (ADR-0010)

| کلید | نوع | مصرف‌کننده | نکته |
|---|---|---|---|
| `push.fcm_server_key` | secret | پوش موبایل (FCM) | staged و خالی؛ از CRM وارد می‌شود؛ هرگز لاگ نمی‌شود |
| `push.vapid_public_key` | string | web push (مرورگر) | staged و خالی؛ کلید عمومی در سرویس‌ورکر وب استفاده می‌شود |
| `push.vapid_private_key` | secret | web push (مرورگر) | staged و خالی؛ هرگز لاگ نمی‌شود |

کانال‌های `notification_preferences` (مقداری، بدون migration):
`email` | `sms` | `push` (FCM — موبایل) | `web_push` (مجزا — مرورگر) | `in_app`.
ثبت‌نام پیش‌فرض برای هر پنج کانال ردیف می‌سازد (`web_push` مثل `push`:
مارکتینگ پیش‌فرض خاموش). کاربران موجود ردیف `web_push` ندارند — backfill
یا endpoint مدیریت ترجیحات، کار فاز بعد است (صادقانه: در این فاز فقط seed
ثبت‌نام جدید پوشش داده شده).


## ۷) مصرف وب (Track C — `apps/web`)

- **اندپوینت:** `GET /api/v1/settings/public` (ثابت `PUBLIC_SETTINGS_PATH` در
  `apps/web/lib/settings.ts`). پاسخ مورد انتظار: `{ settings: {<کلید>: <مقدار>}, version, updated_at }` —
  مقادیر ممکن است آبجکت/آرایهٔ آماده یا رشتهٔ JSON باشند (هر دو پذیرفته می‌شود)؛
  شکل لیستی `[{key, value}]` هم تحمل می‌شود.
- **سرویس:** `getSiteConfig()` — هر درخواست با `cache: 'no-store'` (بدون کش Next،
  بدون دادهٔ کهنه). غیرپرتابه: هر خطایی → مقادیر پیش‌فرض تایپ‌شده = رفتار امروز.
  `version` / `updated_at` روی خروجی نگه داشته می‌شود (مشاهده‌پذیری)؛ چون چیزی
  کش نمی‌شود، revalidation شرطی لازم نیست — هر درخواست نسخهٔ آخر را می‌بیند.
- **امنیت parse:** `family` فونت فقط حروف/عدد/فاصله/خط‌تیره؛ همهٔ URLها از
  `safeHref` (فقط same-origin یا `http(s)`)؛ اعداد clamp؛ شکل نامعتبر → پیش‌فرض.
- **نقاط مصرف:**
  - لی‌آوت: `AtmosphericEngine config={siteConfig.particles}` (کلید `particles`:
    `enabled`/`count`/`speed`/`parallax` (ضریب عددی)/`lines`)؛ فونت آپلودشدهٔ
    `fonts.<locale>` → بلوک `<style>` با `@font-face` (`font-display: swap`) +
    بازنویسی `--font-main` همان لوکیل (فونت توکار می‌ماند fallback).
  - صفحهٔ اول: `home.sections` موجود و غیرخالی → `ComposedSections` (ترتیب
    اسلات‌ها، `variant` = شناسهٔ رجیستری `components/sections/registry.ts`،
    `enabled: false` رد می‌شود)؛ وگرنه رفتار امروز (`HomeSections`).
    `variant` ناشناخته/خالی برای یک سکشن → رندرر اختصاصی همان سکشن (امروز).
    توجه: seed پیش‌فرض `variant` را برابر کلید سکشن می‌گذارد — این مقادیر
    شناسهٔ رجیستری نیستند و عمداً به رفتار امروز برمی‌گردند.
  - هیرو: `hero.<locale>` → بازنویسی title/subtitle/CTAها؛ فیلد خالی → کپی امروز.
- **تفکیک کش:** ترکیب صفحه (اسلات/واریانت/ذرات/هیرو/فونت) per-request زنده است؛
  محتوای داخل سکشن‌ها (`home/sections` و سطوح CMS) همچنان `revalidate: 120`.
- **رجیستری واریانت‌ها** (`SECTION_VARIANTS` در `components/sections/registry.ts`)
  کانونی است؛ CRM همان id/labelها را mirror می‌کند (ایمپورت cross-app ممکن نیست).
- **صفحهٔ نمایشی** `/demo/sections` (فقط dev؛ در production ‏۴۰۴): هر ۱۰ واریانت
  با دادهٔ نمایشی `lib/demo-fixtures.ts` — هرگز در مسیر production استفاده نمی‌شود.
