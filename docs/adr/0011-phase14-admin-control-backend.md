# ADR-0011: بک‌اند کنترل مرکزی ادمین — فاز ۱۴ (Track 1)

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- فاز: ۱۴ (بک‌اند — Track 1)

## زمینه

فاز ۱۴ به «صندوق واحد محتوا»، «مدیر placement»، «مدیر distribution»، «تقویم انتشار»،
«داشبورد اتصالات بیرونی»، «مرکز بیلد»، «مرکز اعلان چندکاناله»، «نمای ۳۶۰° کاربر» و
«مدیریت نقش/مجوز» نیاز دارد. قرارداد §۹.۵ دو قید سخت می‌گذارد:

1. **اصل ضد-جدول-غول‌پیکر:** هیچ جدول generic content ساخته نمی‌شود؛ هر دامنه مدل
   typed خودش را حفظ می‌کند.
2. **توزیع مستقل کانال‌ها:** انتشار در یک کانال ≠ انتشار در بقیه؛ باید در زمان سرو
   (serve time) اعمال شود، نه فقط ذخیره.

## تصمیم

۱. **Adapter registry (نه جدول):** `app/modules/admin/control_registry.py` یک رجیستری
   درون‌حافظه‌ای از adapterهاست؛ هر adapter یک `(domain, content_type)` را با چهار
   تابع typed می‌پوشاند: `list` / `get` / `transition` / `native_distribution`.
   منطق دامنه تکرار نمی‌شود — گذارها همان توابع transition خودِ ماژول‌ها را صدا
   می‌زنند (cms_service، submissions_service، library.service، places.service).
   دامنه‌های ثبت‌شده: content (۵ منبع CMS)، fatwa (submissions + knowledge_chunks)،
   library، lms (courses)، social (posts)، places.

۲. **جدول `content_distributions` جدا از `distribution` بومی دامنه‌ها:** ستون‌های
   JSONB بومی (مثل CMS) دست‌نخورده می‌مانند؛ جدول یکپارچهٔ فاز ۱۴ کلید
   `(domain, content_type, content_id, channel)` با `enabled` + `scheduled_at` /
   `until_at` (UTC؛ `schedule_tz` فقط متادیتای ورودی) دارد. تابع
   `is_channel_allowed` سه لایه دارد: ردیف صریح (override — بالاترین اولویت)،
   بعد distribution بومی دامنه (پیش‌فرض ADR-002 هنگام انتشار)، و در آخر «مجاز»
   وقتی هیچ اطلاعاتی نیست — تا رفتار موجود (مثل auto-publish فاز ۱۱) نشکند.
   گیت تلگرام در `distribute_service.send_pending` صدا زده می‌شود — رکوردِ با
   منع صریح `skipped` می‌شود، نه ارسال.

۳. **جدول `content_placements`:** ارجاع چندریختی `(domain, content_type, content_id)`
   **بدون FK فیزیکی** (§۹.۵) با یکتایی `(surface, slot, domain, content_type, content_id)`.

۴. **اعلان چندکاناله:** `notification_broadcasts` + `notification_deliveries`
   (per-user/per-channel با وضعیت sent/skipped/failed). انتخاب کانال هر کاربر از
   `notification_preferences` (فاز ۱) با `notif_type="product"`؛ ردیف غایب = غیرفعال
   (به‌جز in_app که همیشه از جدول `notifications` موجود سرو می‌شود). اگر provider
   یک کانال پیکربندی نشده باشد (مثلاً `sms_api_key` خالی یا نبود FCM sender)، کانال
   **skip** می‌شود با `skip_reason` — هرگز موفقیت جعلی. نقاط تزریق
   (`CHANNEL_SENDERS` / `CHANNEL_CONFIGURED`) برای تست قابل monkeypatch‌اند.

۵. **اتصالات بیرونی:** فقط خوانش وضعیت از `platform_settings`/env/جدول‌های موجود
   (`ai_provider_configs`, `telegram.session`) — هیچ secretای در پاسخ یا audit نیست.
   تست هر سرویس در audit لاگ می‌شود؛ پرداخت صادقانه «تا فاز ۱۵ در دسترس نیست».

۶. **بیلدها:** `build_releases` (با پرچم صادقانهٔ `signed` — هرگز ادعای امضای دروغین)
   و `build_requests` (صف درخواست بازسازی؛ امضای واقعی با CI). پیش‌نیازها از
   کلیدهای `signing.*` در platform_settings خوانده می‌شوند.

۷. **نقش/مجوز:** از `roles.manage` موجود (فقط super_admin) استفاده می‌شود؛ حذف نقش
   `super_admin` و خالی‌کردن مجوزهایش ممنوع است. کلیدهای جدید:
   `content.bulk`، `connections.test`، `builds.manage`، `notifications.broadcast`،
   `users.view360` — در `BASE_PERMISSIONS` فایل seed.py ثبت و به super_admin داده
   می‌شوند.

## پیامدها

- مثبت: صندوق واحد بدون شکستن typed بودن دامنه‌ها؛ distribution واقعاً در serve
  time اعمال می‌شود؛ تست‌پذیری بالا با نقاط تزریق.
- منفی: مرج/صفحه‌بندی چندآداپتری در پایتون انجام می‌شود (مقیاس فعلی: قابل‌قبول)؛
  دو منبع حقیقت برای distribution (بومی + یکپارچه) با ترتیب اولویت مشخص حل شده.

## جایگزین‌های ردشده

- جدول `contents` واحد: نقض صریح §۹.۵ (اصل ضد-جدول-غول‌پیکر).
- اعمال distribution فقط در لایهٔ ذخیره‌سازی: نقض «enforce at serve time» — تلگرام
  از مسیر ARQ جدا سرو می‌شود و باید خودش گیت را چک کند.
- توسیع ستون JSONB بومی همهٔ دامنه‌ها: نیازمند migration روی جدول‌های فازهای قبل
  و تکرار منطق در هر ماژول؛ جدول یکپارچه تمیزتر است.
