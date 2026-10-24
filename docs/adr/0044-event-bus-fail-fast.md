# ADR-0044 — fail-fast گذرگاه رویداد بیرون از dev

## زمینه
`create_event_bus` هنگام در دسترس نبودن Redis در همهٔ محیط‌ها بی‌صدا
به `InMemoryBus` می‌افتاد و فقط یک warning لاگ می‌شد. در production
این یعنی fan-out رویدادها فقط داخل همان پردازه می‌ماند، بقیهٔ
workerها و دروازهٔ WebSocket در پردازه‌های دیگر هیچ رویدادی
نمی‌بینند، و هیچ‌کس از degradation باخبر نمی‌شود.

## تصمیم
- در `APP_ENV != dev` (staging/production) شکست اتصال Redis در
  startup به `RuntimeError` تبدیل و با لاگ CRITICAL ثبت می‌شود؛
  اپ بالا نمی‌آید.
- در dev/test fallback حافظه‌ای با همان لاگ هشدار قبلی می‌ماند.

## پیامدها
- استقرار بدون Redis سالم در محیط واقعی همان لحظه و با دلیل روشن
  fail می‌شود؛ رویدادها همچنان در جدول `domain_events` durable
  هستند و با برگشت Redis، dispatcher آن‌ها را منتشر می‌کند.
- تست‌ها هر دو محیط را پوشش می‌دهند (fail-fast در production و
  staging، fallback در dev، مسیر عادی Redis سالم در production).

## جایگزین‌های ردشده
- وضعیت readiness قرمز بدون fail: اپ «بالا» می‌ماند ولی رویداد
  منتشر نمی‌کند — همان degradation نامرئی، فقط با یک پرچم بیشتر.
- retry بی‌نهایت در startup: بوت را برای همیشه قفل می‌کند و دلیل
  را از لاگ استقرار جدا می‌کند.
