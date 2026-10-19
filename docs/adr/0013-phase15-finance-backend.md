# ADR-0013: بک‌اند فاز ۱۵ — مالی، اهدا و درگاه پرداخت

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- میل‌استون: فاز ۱۵ — Track 1 (بک‌اند)

## زمینه

فاز ۱۵ به پرداخت واقعی (زرین‌پال)، اهدا به کمپین‌ها، دفتر مالی سبک، رسید PDF
و تطبیق دوره‌ای نیاز دارد. قرارداد §۴ مهندسی (outbox/idempotency) برای پول
حیاتی است: «کلیک دوبارهٔ پرداخت» نباید دو تراکنش بسازد و «وبهوک تکراری»
نباید مبلغ را دوبار ثبت کند.

## تصمیم

۱. **سه هویت جدا برای idempotency (§۴):**
   - `Idempotency-Key` (هدر HTTP): فرمانِ «ایجاد نیت پرداخت» را idempotent
     می‌کند. کلید → دقیقاً یک ردیف `payment_intents.idempotency_key` (یکتا)؛
     کلید تکراری → همان نیتِ موجود برمی‌گردد (۲۰۱/۲۰۰)، بدون فراخوان جدید
     به درگاه. مسابقهٔ هم‌زمان با `IntegrityError` روی کلید یکتا حل می‌شود.
   - `event_id`: هویت رویداد `donation.completed` در outbox؛ consumer با چک
     `event_id` دوبار پردازش نمی‌کند. `idempotency_key` آن رویداد از کلیدِ
     فرمان مشتق می‌شود (`donate:<key>`) — جدا از `event_id`.
   - `gateway_reference` (زرین‌پال: `ref_id`): هویت پرداختِ سمت درگاه؛ ستون
     یکتا در `donations`. تکرار کال‌بک/وبهوک از مسیر مشترک `_finalize_success`
     (re-entrant) می‌گذرد و هرگز ردیف دوم نمی‌سازد.
۲. **کال‌بک** (`GET /finance/callback?Authority=&Status=`): مقصد redirect
   زرین‌پال. روی `OK`، تأیید سمت‌سرور (`verify.json`) صدا زده می‌شود؛ کد
   `100` موفق و `101` (قبلاً verify شده) هر دو پذیرفته‌اند — چون retry
   کال‌بک عادی است. نیتِ موفقِ تکراری → همان donation موجود (۲۰۰).
۳. **وبهوک** (`POST /finance/webhook/{gateway}`):
   - dedupe اول: `payload_hash = sha256(raw_body)` در `payment_webhook_log`
     (یکتا). replay → ۲۰۰ با `already_processed: true`، بدون اثر دوم.
   - احراز اصالت دو مسیره: درگاه‌های وبهوک‌دار (مثل IDPay) → HMAC-SHA256 روی
     بدنهٔ خام با `payment.webhook_secret`؛ **زرین‌پال وبهوک امضاشده نمی‌فرستد
     — «تأیید»، همان فراخوان verify سمت‌سرور روی authority است.** پس وبهوک
     زرین‌پال باید `authority` داشته باشد و verify صدا زده می‌شود؛ بدون آن
     → ۴۰۰/۴۰۱.
   - ردشده‌ها با هشِ نمک‌دار ثبت می‌شوند تا retry مشروع بعدی با dedupe
     برخورد نکند (dedupe فقط روی processed/duplicate).
۴. **چرا سندباکس زرین‌پال:** `https://sandbox.zarinpal.com` برای تست
   end-to-end بدون پول واقعی؛ حالت از `payment.zarinpal_sandbox` (پیش‌فرض:
   روشن) خوانده می‌شود. merchant key همیشه از `platform_settings` (رمزنگاری‌شده،
   §۳) — هرگز هاردکد، هرگز در لاگ/audit (§۱۴).
۵. **reconcile** (`GET /admin/finance/reconcile`): نیت‌های موفق داخلی در برابر
   گزارش درگاه (`gateway.fetch_report()`)؛ مغایرت‌ها: `internal_without_gateway`
   ، `gateway_without_internal`، `amount_mismatch`. زرین‌پال API عمومیِ گزارش
   تراکنش ندارد → `fetch_report` صادقانه `GatewayError` می‌دهد و endpoint به‌جای
   دادهٔ ساختگی ۵۰۳ `gateway_report_unavailable` برمی‌گرداند (§۱۵.۹).
۶. **کمپین‌ها** با پرچم سادهٔ وضعیت (`active|draft|archived`) — کمپین محتوای
   قابل‌انتشار §۹ نیست، پس از موتور گردش‌کار مشترک استفاده نمی‌کند؛
   `raised_amount` فقط از `_finalize_success` افزایش می‌یابد (هرگز دستی).
۷. **رسید PDF** سه‌زبانه با همان الگوی گواهی فاز ۸ (reportlab + reshaper +
   bidi، فونت‌های سیستمی) — فقط نام اهداکننده، عنوان کمپین، مبلغ، کدهای مرجع
   و تاریخ؛ هیچ محتوای فقهی. دسترسی: مالک اهدا یا `finance.manage`.
۸. **اهدای مکرر**: فقط ثبت (`recurring_donations`)؛ اجرای شارژ دوره‌ای با
   صف `critical` در فاز ۱۶ — در این فاز `next_charge_at` خالی می‌ماند.
۹. **کلیدهای تنظیمات جدید:** `payment.zarinpal_sandbox` (json/bool)،
   `payment.webhook_secret` (secret)، `payment.callback_url` (string).
   مجوز `finance.manage` از قبل در seed موجود بود (فاز ۰) — نیازی به تغییر
   seed نبود.

## پیامدها

- مثبت: هر سه مسیر (donate/callback/webhook) روی یک تابع نهایی‌سازی idempotent
  سوارند؛ پول هرگز دوبار ثبت نمی‌شود. افزودن IDPay فقط یک کلاس gateway جدید است.
- منفی: reconcile برای زرین‌پال تا اتصال منبع گزارش واقعی (export پنل) ۵۰۳
  می‌دهد؛ شارژ مکرر تا فاز ۱۶ غیرفعال است.

## جایگزین‌های ردشده

- dedupe فقط در حافظه: با restart از بین می‌رود؛ dedupe باید در DB باشد.
- اعتماد به `Status=OK` در کال‌بک بدون verify سمت‌سرور: جعل‌پذیر است.
- پذیرش وبهوک زرین‌پال بدون authority/verify: هیچ اصالتی اثبات نمی‌شود.
