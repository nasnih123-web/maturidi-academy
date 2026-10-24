# ADR-0028 — اسکن ویروس ClamAV با سیاست fail-closed (C-01)

وضعیت: پذیرفته‌شده (رفع اشکال حسابرسی 197efa0، آیتم C-01)
تاریخ: ۲۰۲۶-۱۰-۲۲
جایگزینِ بخش «ClamAV در این فاز» در ADR-0007 می‌شود (همان‌جا هم ارجاع داده شد).

## زمینه

قرارداد §۷ اسکن ClamAV روی آپلودها را می‌خواست؛ ADR-0007 آن را به
دلیل نبود زیرساخت به تعویق انداخته بود و حسابرسی آن را Critical
کرد. متن کامل پرامپت رفع اشکال صراحت دارد: همهٔ مسیرهای آپلود
(کتابخانه، درون‌ریزی تلگرام، آپلودهای CRM) و رفتار هنگام در دسترس
نبودن اسکنر باید **fail-closed** باشد — هرگز ردِّ بی‌صدا.

## تصمیم

۱) کلاینت واقعی INSTREAM روی TCP در `app/core/antivirus.py`
(فرمان zINSTREAM + قطعه‌های طول‌دار؛ پاسخ OK/FOUND پارس می‌شود).
پیکربندی از env: CLAMAV_HOST/CLAMAV_PORT (پیش‌فرض سرویس compose)/
CLAMAV_TIMEOUT_SECONDS.

۲) سیاست fail-closed در همهٔ محیط‌ها (تابع `scan_upload_or_reject`):
- آلوده → 422 `file_infected` (با نام امضا) + ممیزی در لایهٔ سرویس.
- اسکنر غایب/خطای پروتکل → 503 `antivirus_unavailable` و آپلود رد
  می‌شود.
- تنها استثنا: `CLAMAV_ALLOW_INSECURE_DEV_BYPASS=true` **و**
  app_env=dev — پیش‌فرض خاموش، در production بی‌اثر، و هر فراخوانی
  با لاگ CRITICAL همراه است.

۳) نقاط خفگیِ اسکن (همهٔ مسیرهای آپلود):
- `library/service.create_item` (فایل + کاور) و `update_item`
  (فایل جایگزین) — درون‌ریزی تلگرام هم از همین create_item می‌گذرد،
  پس آن مسیر هم پوشیده است.
- `admin/service.upload_font` (آپلود فونت CRM).
- `voice/service.transcribe` (هر دو endpoint رونویسی/پرسش صوتی).
اسکن همیشه پیش از اعتبارسنجی/ذخیره انجام می‌شود؛ ردِّ آلودهٔ
کتابخانه و فونت با actionهای `*.upload_rejected_infected` ممیزی
می‌شود.

۴) زیرساخت: سرویس `clamav` (ایمیج clamav/clamav:1.4 + volume دیتابیس
ویروس + healthcheck پروتکل PING/PONG) در هر دو compose؛ API و
workerها با CLAMAV_HOST=clamav و depends_on healthy به آن وصل‌اند.

۵) اثبات: tests/test_antivirus.py — پروتکل INSTREAM علیه یک stub
clamd با سوکت واقعی (در conftest، session-wide؛ پس کل سوئیت مسیر
اسکن واقعی را تمرین می‌کند)، EICAR → FOUND و ردِّ 422 + ممیزی،
فایل پاک → 201، و ماتریس سیاست (down=503 در dev و prod؛ بای‌پس
فقط dev). اجرای clamd واقعی در compose: با C-04 (compose-smoke CI)
پوشیده می‌شود؛ در sandbox داکر نیست — NOT RUN LOCALLY.
