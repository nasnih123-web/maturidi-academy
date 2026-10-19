# ADR-0004: بک‌اند فاز ۵ — provider قرآن، اذان، تسبیح، یادداشت آیه

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- میل‌استون: فاز ۵ — Track 1 (بک‌اند)

## زمینه

فاز ۵ به متن/ترجمه/تفسیر/صوت قرآن، یادداشت خصوصی آیه، تسبیح دیجیتال، پنجرهٔ
مناجات شبانه و اوقات اذان نیاز دارد. قرارداد §۱۵.۱۰ هر تغییری در مدل داده یا
قرارداد API را منوط به ADR می‌کند.

## تصمیم

۱. **provider قرآن** (`app/modules/quran/providers.py`): انتزاع `QuranProvider` با
   پیاده‌سازی پیش‌فرض `AlQuranCloudProvider` (متن عثمانی Tanzil از
   `api.alquran.cloud`؛ endpoint ترکیبی `/editions/` برای متن+ترجمه+تفسیر+صوت
   در یک round-trip). متن معیار فقط از provider می‌آید — هیچ endpointای متن را
   ویرایش نمی‌کند (مشخصات فاز ۵).
۲. **خرابی provider → ‏۵۰۳ graceful**: timeout (۱۰ ثانیه) + retry با backoff،
   کش درون‌فرایندی ۶۰۰ ثانیه‌ای؛ هر خطای حمل‌ونقل (`httpx.HTTPError`) به
   `QuranProviderError` و سپس به پاکت یکدست `quran_provider_unavailable` (۵۰۳)
   تبدیل می‌شود — هرگز ۵۰۰ با traceback. پروکسی از env صریح خوانده و به httpx
   پاس داده می‌شود (تجزیهٔ خودکار env در httpx روی بعضی محیط‌ها InvalidURL می‌دهد).
۳. **اذان**: پیاده‌سازی pure-Python الگوریتم PrayTimes در `adhan.py` (بدون وابستگی
   خارجی): روش‌های isna/mwl/egypt/karachi/makkah/jafari و عصر شافعی/حنفی.
   در برابر مقادیر مرجع aladhan (تهران، ۲۰۲۶-۱۰-۱۹، MWL) با تلورانس ۲ دقیقه
   اعتبارسنجی شد — نتیجه: انطباق کامل (حداکثر اختلاف ۱ دقیقه).
۴. **مدل داده** (migration ‏`c7d21f4a9053`): ‏`user_ayah_notes`، ‏`dhikr_sessions`،
   ‏`dhikr_daily_counts` (یکتای سه‌تایی user/date/dhikr). یادداشت‌ها workflow ندارند
   (دادهٔ کاربر، نه محتوای قابل‌انتشار §۹)؛ حریم خصوصی با کوئری‌های owner-scoped
   در سرویس + ۴۰۴ برای شناسهٔ دیگران.
۵. **تسبیح**: شمارش با `idempotency_key` اختیاری (dedup درون‌فرایندی ۱۰ دقیقه‌ای —
   «idempotent-ish» طبق مشخصات)؛ تکمیل هدف → ‏`ended_at` + رویداد
   `tasbih.session_completed`.
۶. **تنظیمات** (الگوی ADR-0003، نوع `json`): ‏۱۲ کلید جدید `quran.*` و `munajat.*`
   با اعتبارسنج اختصاصی و seed پیش‌فرض؛ مستندات در `docs/settings-schema.md`.
۷. **رویدادهای دامنه** (الگوی موجود `app/core/events.py`): ‏`quran.note_created`،
   ‏`tasbih.session_started`، ‏`tasbih.session_completed` — بدون الگوی جدید.

## پیامدها

- مثبت: UI آینده (Track 2) فقط همین قراردادهای پایدار را مصرف می‌کند؛ تعویض
  provider (مثلاً Quran.com) فقط با یک کلاس جدید و ثبت در `PROVIDERS`.
- منفی: کش provider و dedup تسبیح درون‌فرایندی‌اند (با چند replica هماهنگ نیستند؛
  برای فاز ۵ کافی است، در صورت نیاز به Redis منتقل می‌شوند).

## جایگزین‌های ردشده

- ذخیرهٔ متن کامل قرآن در DB: حجم و نگهداری نسخه‌ها؛ provider مرجع به‌روزتر است.
- کتابخانهٔ اذان خارجی (مثل Adhan.js سمت‌سرور): وابستگی جدید؛ الگوریتم PrayTimes
  ساده و اعتبارسنجی‌شده است.
