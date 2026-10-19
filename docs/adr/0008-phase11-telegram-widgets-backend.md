# ADR-0008 — فاز ۱۱: بک‌اند نقشهٔ اماکن، تلگرام دوطرفه و ویجت‌های جاسازی‌شونده

> **وضعیت:** پذیرفته‌شده — فاز ۱۱ (Track 1: Backend)
> **تاریخ:** 2026-10-19

## زمینه

فاز ۱۱ سه دامنهٔ جدید به بک‌اند اضافه می‌کند که هیچ‌کدام در فازهای قبل
وجود نداشتند: (۱) جدول دامنه‌ای `religious_places`، (۲) اتصال دوطرفهٔ
تلگرام (بات + Telethon + درون‌ریزی + توزیع)، (۳) ویجت‌های عمومی جاسازی‌شونده
با `api_keys`. هر سه باید با قراردادهای فاز ۰ سازگار باشند: پاکت خطای §۱،
secrets §۳، صف `telegram` از §۵، گردش‌کار مشترک §۹، سیاست توزیع §۹.۵،
ممیزی §۱۴، و جدایی UI از منطق (ADR-001/0002).

## تصمیم‌ها

### ۱) `religious_places` — جدول typed جدا (§۹.۵: اصل ضد-جدول-غول‌پیکر)

- ستون‌ها: `name`/`description` به‌صورت LocalizedText، `lat`/`lng`،
  `type` (enum رشته‌ای: `mosque | shrine | holy_site | museum | other`)،
  `video_360_id` با **FK واقعی** به `library_items.id` (فاز ۹ قبلاً ساخته
  شده، پس «no future-FK coupling» نقض نمی‌شود)، `submitted_by` nullable،
  `workflow_status` با ماشین مشترک §۹ (پیاده‌سازی واحد
  `app/core/workflow.py`)، `version`، `created_by`، timestamps.
- ستون `religious_place_ref` روی `library_items` (رشتهٔ رزروشدهٔ فاز ۹)
  دست‌نخورده می‌ماند؛ FK جدید مسیر typed است، رشتهٔ قدیم برای ارجاع‌های
  غیرسخت‌گیرانه حفظ می‌شود. چون جدول places تازه ساخته می‌شود، سطر موجودی
  برای backfill نیست؛ migration فقط FK را می‌سازد.

### ۲) بات تلگرام (python-telegram-bot) — سرویس نازک، توکن هرگز هاردکد

- توکن فقط از `platform_settings` (`telegram.bot_token` از نوع secret،
  رمزنگاری‌شده با کلید env — §۳) خوانده می‌شود؛ در لاگ/خطا هرگز چاپ نمی‌شود.
- همه‌چیز پشت `telegram.enabled` است؛ بدون توکن/غیرفعال، همهٔ فراخوانی‌ها
  صادقانه `None`/`False` برمی‌گردانند (graceful degradation)، نه خطای پنهان.

### ۳) دکمه‌های inline تأیید/رد فتوا — جدول `telegram_callbacks`

- محدودیت ۶۴ بایتی `callback_data` تلگرام اجازهٔ UUID داخل دکمه را نمی‌دهد؛
  پس هر دکمه یک nonce تصادفی (`telegram_callbacks.nonce`) دارد که به
  `(content_type, content_id, op, actor_user_id, expires_at)` بایند شده است.
- Webhook (`POST /api/v1/telegram/webhook`) اول هدر
  `X-Telegram-Bot-Api-Secret-Token` را با `telegram.webhook_secret` چک
  می‌کند (احراز هویت واقعی درخواست)، بعد nonce را یک‌بارمصرف مصرف می‌کند و
  گذار را از **همان مسیر مجوزدار** `submissions_service.transition` با
  `actor` = کاربری که اعلان برایش ارسال شده بود اجرا می‌کند — یعنی چک
  `is_approver` واقعی، نه میان‌بر.
- علاوه بر آن، payload دکمه با HMAC-SHA256 (کلید: `encryption_key`) امضا
  می‌شود تا دست‌کاری data پیش از رسیدن به سرور هم قابل تشخیص باشد.

### ۴) اتصال Telethon از CRM — بدون اسکریپت دستی

- `api_id`/`api_hash` از تنظیمات (secret، رمزنگاری‌شده). جریان دو مرحله‌ای:
  `request-code` → Telethon کد می‌فرستد و `phone_code_hash` **رمزنگاری‌شده**
  در `platform_settings` (کلیدهای داخلی `telegram.pending_*`) با TTL ده‌دقیقه‌ای
  ذخیره می‌شود؛ `confirm-code` → `sign_in` (با `password` دومرحله‌ای در صورت
  نیاز) → `StringSession` رمزنگاری‌شده در `telegram.session` ذخیره می‌شود.
- §۱۴: در audit فقط `{"field": "telegram_session", "changed": true}` ثبت
  می‌شود، هرگز مقدار session؛ scrub خودکار `_SECRET_HINTS` هم `session` را
  پوشش می‌دهد.
- لایهٔ `telethon_client.py` یک factory قابل‌تزریق است تا تست‌ها با
  «MTProto جعلی» (fake client) بدون هیچ شبکه‌ای اجرا شوند؛ در مسیر عملیاتی
  هیچ mock نیست (§۱۶).

### ۵) درون‌ریزی کانال — ARQ صف `telegram`

- `POST /api/v1/telegram/import` فقط یک جاب در صف `telegram` می‌گذارد؛
  خودِ کار (iterate history، دانلود مدیا، ثبت) در ورکر انجام می‌شود.
- FloodWait: گرفتن `telethon.errors.FloodWaitError` → sleep نمایی با سقف
  ۳۰۰ ثانیه و حداکثر ۳ تلاش مجدد برای هر پیام.
- هر فایل از **همان فیلتر امنیتی فاز ۹** (`validate_upload_content`:
  پسوند + magic-byte + سقف حجم — §۷) عبور می‌کند و با `source_type=
  "telegram_import"`، `workflow_status=in_review` و
  `source_ref={origin:"telegram", channel, message_id}` ثبت می‌شود.
  **هرگز auto-publish یا auto-repost نمی‌شود** — چک محافظه‌کارانه در
  distribute_service: هر `library_item` با `source_type="telegram_import"`
  (واردشدهٔ واقعی یا برنامه‌ریزی‌شدهٔ `import_item` فاز ۹) از auto-repost
  مستثناست.
- هوک توزیع خودکار روی رویداد دامنه‌ای `fatwa.submission_published`:
  `submissions_service.transition` بعد از commit، با lazy-import و
  try/except محافظت‌شده، `distribute_service.auto_publish_if_policy` را
  صدا می‌زند (بدون import چرخه‌ای، بدون شکستن مسیر اصلی).

### ۶) توزیع (`telegram_distributions` → `telegram_distribution_policies`)

- سیاست به‌ازای `content_type`: `never | manual_approval | auto_publish |
  scheduled` — پیش‌فرض `never` (سیاستِ گمشده با get-or-create ساخته می‌شود).
- لاگ `telegram_published` با کلید یکتای idempotency
  (`{content_type}:{content_id}:{target}`) — ارسال دوباره همان کلید، رکورد
  موجود را برمی‌گرداند، نه رکورد تکراری؛ `published_message_id` برای لغو/حذف
  بعدی نگه‌داری می‌شود. retry شمارشی + audit کامل.

### ۷) ویجت‌ها و `api_keys` — CORS wildcard فقط و فقط روی `/api/v1/widgets/*`

- `api_keys`: فقط **هش SHA-256** کلید ذخیره می‌شود (+ ۸ کاراکتر prefix برای
  نمایش)؛ خودِ کلید فقط لحظهٔ ساخت یک‌بار دیده می‌شود. scopeها JSON،
  `rate_limit_per_min` (token-bucket درون‌حافظه‌ای، قفل thread-safe) و
  `quota_monthly` (شمارنده در DB با دورهٔ `YYYY-MM`).
- احراز هویت ویجت با هدر `X-API-Key` یا پارامتر `?api_key=` — **بدون کوکی و
  بدون credential**؛ بنابراین `Access-Control-Allow-Origin: *` امن است.
- پیاده‌سازی CORS با یک middleware سفارشی (`WidgetCorsMiddleware`) که فقط
  مسیرهای زیر `/api/v1/widgets/` را لمس می‌کند (preflight + هدر `*` روی
  پاسخ) تا OpenAPI روی همان اپ اصلی بماند؛ تست صریح assert می‌کند هیچ
  endpoint احرازهویت‌شدهٔ دیگری هدر wildcard نمی‌گیرد.
- ویجت‌ها: `prayer-times` (موتور اذان فاز ۵ — هیچ قاعدهٔ فقهی جدیدی هاردکد
  نمی‌شود)، `ayah-of-day` (انتخاب قطعی روزانه از فهرست ارجاع‌های
  surah:ayah — متن آیه همیشه از provider می‌آید، نه هاردکد)،
  `latest-fatwa` (فقط `published`)، `zakat-mini` (موتور واقعی فاز ۷ با
  rule فعال؛ اگر rule نبود ۵۰۳ صادقانه، نه نرخ ساختگی — §۱۵.۵).

## پیامدها

- ۵ جدول جدید + migration forward-only؛ هیچ تغییری در قراردادهای موجود
  (no breaking change — §۱۵.۱۱).
- دو وابستگی جدید پین‌شده: `python-telegram-bot==21.9`، `telethon==1.41.2`.
- سه مجوز جدید در seed: `places.manage`، `telegram.manage`، `api_keys.manage`.
- کلیدهای جدید `platform_settings` (مقادیر در `.env.example` خالی):
  `telegram.enabled`، `telegram.webhook_secret`، `telegram.api_id`،
  `telegram.api_hash`، `telegram.session`، `telegram.phone_masked`،
  `telegram.pending_*` (داخلی).

## جایگزین‌های ردشده

- **ذخیرهٔ session تلگرام در جدول جدا:** رد شد — `platform_settings` با
  envelope رمزنگاری نسخه‌دار §۳ دقیقاً برای همین ساخته شده؛ جدول جدید
  فقط سطح حمله را زیاد می‌کرد.
- **CORS wildcard سراسری یا sub-app جدا برای ویجت‌ها:** رد شد — اولی §۹.۵ را
  نقض می‌کند، دومی OpenAPI را از اپ اصلی جدا می‌کرد؛ middleware مسیر-مبنا
  هر دو را حفظ می‌کند.
- **UUID داخل callback_data:** رد شد — سقف ۶۴ بایت تلگرام؛ nonce جدول‌مبنا
  هم کوتاه است هم یک‌بارمصرف و قابل‌ابطال.
- **auto-publish پیش‌فرض برای محتوای واردشده:** رد شد — §۹.۵ و اسپک فاز ۱۱
  صراحتاً ممنوع کرده‌اند؛ چک `source_type == "telegram_import"` در لایهٔ
  سرویس (محافظه‌کارانه: شامل برنامه‌ریزی‌شده‌های فاز ۹ هم می‌شود).
