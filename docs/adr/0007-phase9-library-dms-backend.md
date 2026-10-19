# ADR-0007: بک‌اند فاز ۹ — کتابخانهٔ چندرسانه‌ای (DMS)

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- میل‌استون: فاز ۹ — Track 1 (بک‌اند)

## زمینه

فاز ۹ کتابخانهٔ چندرسانه‌ای علما را به یک DMS واقعی ارتقا می‌دهد: نسخه‌بندی،
گردش‌کار تأیید، دسترسی سطح‌بندی‌شده با signed URL، جست‌وجوی متن‌کامل روی
transcript/OCR، پایپ‌لاین STT/OCR در صف `media`، و ایندکس AI که از انتشار جداست.
اتصال chunkهای فتوای فاز ۶ به `library_items` در ADR-0005 رزرو شده بود
(`source_library_item_ref`) — این ADR آن را فعال می‌کند.

## تصمیم

۱. **مدل داده** (migration ‏`74f3c6f810a58fac`):
   - `library_items`: kind (video/video_360/pdf/audio/mindmap)، عنوان/توضیح
     LocalizedText، `cover_media_key`/`media_key` (کلید storage، هرگز URL)،
     `scholar_id` (FK users)، `topic_tags`، `related_lesson_id` (UUID بدون FK —
     §۹.۵)، `religious_place_ref` (رشتهٔ رزروشده برای فاز ۱۱ — بدون FK آینده‌نگر)،
     `visibility` (public/registered/scholars_only)، `workflow_status` (ماشین
     مشترک §۹)، `version`، `ai_scopes`، `include_in_fatwa_rag`، `ai_indexed`
     (جدا از انتشار)، `download_policy`، `transcript`/`transcript_status`،
     `ocr_text`/`ocr_status`/`processing_error`، `duration_seconds`،
     `file_size_bytes`، `mime_type`، `source_type` (upload/telegram_import)،
     `source_ref`، `created_by`، `created_at/updated_at/published_at`.
   - `library_item_versions`: snapshot کامل JSON نسخهٔ قبلی + created_by/note.
     ویرایش/بازگشت، نسخهٔ قبلی را بایگانی می‌کند — هرگز حذف فیزیکی.

۲. **گردش‌کار**: ماشین مشترک `app.core.workflow` (§۹) بدون هیچ پیاده‌سازی جدا.
   درون‌ریزی برنامه‌ریزی‌شده (تلگرام، فاز ۱۱) همیشه در `in_review` می‌نشیند؛
   انتشار بدون بازبینی انسانی ممکن نیست. DELETE یعنی `archived` (نرم).

۳. **دسترسی**: ناشناس → فقط public؛ کاربر احرازهویتی → public+registered؛
   عالم/ادمین (نقش scholar/admin/super_admin یا مجوز `library.manage`) → همه.
   آیتم `scholars_only` برای غیرمجاز **۴۰۴** است نه ۴۰۳ (عدم افشای وجود).
   `media_url`/`cover_url` فقط signed URL با انقضای ۳۰۰ ثانیه (§۶)؛ کلید خام
   هرگز در پاسخ API نیست. `GET .../stream` → 302 به signed URL + audit log +
   rate limit (۶۰/دقیقه به‌ازای IP).

۴. **آپلود** (§۷): اعتبارسنجی پسوندِ مجازِ هر kind + **magic-byte** + سقف حجم،
   پیش از هر پردازش. `get_presigned_url` یک پارامتر اختیاری `download_path`
   گرفت (سازگار با عقب‌رو) تا هر ماژول endpoint دانلود خودش را بدهد؛ امضا
   (HMAC روی key+exp) مستقل از مسیر است.

۵. **جست‌وجو**: واژگانیِ LIKE-based با وزن (عنوان ۳ > برچسب ۲ > توضیح ۱.۵ >
   transcript/OCR ۱) — §۸: جدا از جست‌وجوی معنایی؛ معنایی از طریق
   scope=semantic_search فاز ۶ انجام می‌شود.

۶. **پایپ‌لاین media** (صف `media`، قرارداد §۵): `transcribe_media` (Whisper)
   و `ocr_pdf` (Tesseract+pdftoppm). اگر ابزار غایب باشد، وضعیت `failed` با
   دلیل صریح ثبت می‌شود — هرگز transcript/OCR جعلی. فعال‌سازی خودکار پس از
   آپلود با پرچم `media.auto_pipeline` (پیش‌فرض روشن).

۷. **ایندکس AI** (جدا از انتشار): `POST .../index-ai` فقط روی آیتم
   approved/published (§۱۰ — RAG هرگز draft نمی‌بیند). متن = عنوان/توضیح
   (هر سه لوکیل) + transcript + OCR؛ chunkها با
   `source_ref={type: library_item, id, version}` و `source_library_item_ref`
   (فیلد رزروشدهٔ ADR-0005) ثبت می‌شوند؛ استناد شامل
   `url=/library/items/<id>` (مسیر نسبی صفحهٔ وب — Track 2) است.
   **حاکمیت**: تأیید chunk فقط با مجوز `fatwa.approve` (ADR-0005)؛ اگر
   فراخواننده آن را نداشته باشد chunkها draft می‌مانند و `ai_indexed=false`
   برمی‌گردد. `extract_source` فاز ۶ یک شاخهٔ `library_item` گرفت (متن از
   پیش استخراج‌شده در payload).

۸. **مجوز**: `library.manage` جدید در seed؛ audit (§۱۴، بدون secret) و
   رویدادهای دامنه (`library.item.created/transition/published/updated/
   reverted/ai_indexed`) برای همهٔ جهش‌ها.

۹. **افزودنی‌های مدیریتی CRM** (خارج از قرارداد صریح مسیرها ولی لازم برای
   Media Manager): `GET /api/v1/admin/library/items` (فهرست همهٔ وضعیت‌ها) و
   `GET /api/v1/admin/library/items/{id}` (نمای مدیریتی با transcript/OCR).

## پیامدها

- مثبت: DMS کامل با نسخه‌بندی واقعی؛ RAG می‌تواند به آیتم‌های کتابخانه استناد
  کند با URL قابل‌کلیک؛ پایپ‌لاین‌ها graceful و صادق‌اند.
- منفی: provider پیش‌فرض embedding همان hash فاز ۶ است (مستند در ADR-0005).

## جایگزین‌های ردشده

- تأیید خودکار chunkها با library.manage تنها: نقض حاکمیت ADR-0005؛ تأیید
  نهایی chunk نزد دارندگان fatwa.approve ماند.
- ذخیرهٔ transcript/OCR داخل snapshot نسخه: حجم‌زا و غیرضروری؛ snapshot فقط
  متادیتا + کلیدهای رسانه را نگه می‌دارد.
- ClamAV در این فاز: قرارداد §۷ آن را می‌خواهد ولی زیرساخت استقرار ندارد؛
  magic-byte + سقف حجم + sanitize نام فایل پیاده شد، اسکن ویروس به فاز
  استقرار موکول شد (ثبت‌شده به‌عنوان deferred).
