# ADR-0006: بک‌اند فاز ۸ — LMS (پیشخوان یادگیری طلاب)

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- میل‌استون: فاز ۸ — Track 1 (بک‌اند)

## زمینه

فاز ۸ LMS کامل می‌خواهد: برنامه‌های درسی، دوره‌ها، درس‌ها، پیشرفت کاربر،
گواهی PDF سه‌زبانه با کد قابل‌استعلام، هم‌گروهی‌ها، پیش‌نیازها، گزارش مطالعه
و پیشنهاد درس. موتور آزمون از فاز ۶ موجود است (`quiz_questions` /
`quiz_attempts`) و قرارداد §۱۵.۲ کپی منطق را ممنوع می‌کند. همچنین باید با
قرارداد §۹.۵ (بدون FK آینده‌نگر) و §۱۵.۴ (LocalizedText) سازگار باشد.

## تصمیم

۱. **مدل داده** (migration ‏`f8a4b6c2d9e1`، forward-only):
   - `curricula` (title LocalizedText، description، sort_order، is_active).
   - `courses` (curriculum_id nullable، title/description LocalizedText،
     level: beginner/intermediate/advanced، visibility: public/private،
     thumbnail_media_ref nullable، sort_order، is_active).
   - `lessons` (course_id، title LocalizedText، body JSON لیست بلاک‌ها،
     duration_minutes، sort_order، is_free_preview).
   - `user_progress` (user_id، lesson_id، status، position_seconds،
     completed_at، updated_at؛ یکتا روی (user_id, lesson_id)).
   - `certificates` (user_id، course_id، code یکتا، issued_at،
     pdf_storage_ref nullable، locale).
   - `course_cohorts` (course_id، title LocalizedText، starts_at/ends_at،
     max_seats، is_open) و `cohort_enrollments` (یکتا روی (cohort_id, user_id)).
   - `course_prerequisites` (course_id، requires_course_id؛ یکتا روی جفت).
   - ALTER ‏`quiz_attempts` ADD ‏`lesson_id` nullable FK → ‏lessons
     (جدول lessons در همین migration ساخته می‌شود — §۹.۵ رعایت شده).

۲. **study_reports جدول نیست.** گزارش مطالعه از `user_progress` +
   `quiz_attempts` (که lesson_id دارد) به‌صورت service-computed ساخته
   می‌شود: درصد پیشرفت هر دوره، میانگین آزمون‌ها، streak روزهای فعالیت.
   جایگزین ردشده: جدول materialized — همگام‌سازی و منبع حقیقت دوگانه
   می‌ساخت؛ محاسبه روی دادهٔ زنده همیشه درست است و حجم LMS در این مقیاس
   ناچیز است.

۳. **استفادهٔ مجدد از موتور آزمون فاز ۶ (بدون کپی).**
   `POST /api/v1/lms/quiz/{lesson_id}` مستقیماً
   `app.modules.fatwa.service.quiz_generate` را صدا می‌زند و بعد `attempt.lesson_id`
   را ست می‌کند؛ submit هم از `quiz_submit` استفاده می‌کند. امضای توابع فاز ۶
   تغییر نکرده و `/fatwa/quiz/*` دست‌نخورده باقی مانده است. درس فقط از
   سؤال‌های ریشه‌دار در chunk تأییدشده (ADR-0005) آزمون می‌گیرد.

۴. **گواهی خودکار.** با تکمیل همهٔ درس‌های یک دوره **و** برآورده‌شدن زنجیرهٔ
   پیش‌نیازها (گواهی برای هر پیش‌نیاز)، گواهی صادر می‌شود؛ idempotent
   (صدور دوباره همان دوره گواهی دوم نمی‌سازد). کد: ‏`MA-<سال>-<۸ رقم hex>`.
   PDF سه‌زبانه (fa/ar/en در یک صفحهٔ A4) با reportlab + arabic-reshaper +
   python-bidi و فونت‌های سیستمی عربی‌قابل؛ ذخیره از طریق انتزاع
   `StorageProvider` (§۶). استعلام عمومی `GET /api/v1/certificates/{code}/verify`
   بدون احراز هویت ولی rate-limited (۳۰/دقیقه به‌ازای IP).

۵. **پیاده‌سازی محلی StorageProvider.** تاکنون فقط قرارداد ABC وجود داشت؛
   فاز ۸ ‏`LocalStorageProvider` را به‌عنوان پیاده‌سازی پیش‌فرض dev اضافه
   کرد (فکتوری `get_storage()`). دایرکتوری ذخیره‌سازی به‌صورت عمومی mount
   **نیست**؛ دانلود PDF فقط از endpoint احرازهویتی (دارنده یا `lms.manage`)
   یا با URL امضاشدهٔ کوتاه‌مدت HMAC (§۶). جایگزینی با MinIO/S3 بدون تغییر
   کد مصرف‌کننده ممکن است.

۶. **پیش‌نیازها:** خودارجاع و چرخه در service رد می‌شود (BFS روی گراف
   پیش‌نیازها)؛ ثبت‌نام هم‌گروهی و صدور گواهی هر دو زنجیره را چک می‌کنند.

۷. **قوانین پیشنهاد درس** (`GET /api/v1/lms/recommendations`):
   - سطح کاربر = سطح آخرین دورهٔ فعال او (پیش‌فرض beginner)؛
   - دروس ناتمام همان سطح به ترتیب (sort_order دوره، sort_order درس)؛
   - دوره‌هایی که پیش‌نیازشان برآورده نشده حذف می‌شوند؛
   - سپس سطح بعدی (beginner → intermediate → advanced).
   دلیل هر پیشنهاد به‌صورت کلید (`level_next_incomplete` / `next_level`)
   برمی‌گردد تا فرانت محلی‌سازی کند.

۸. **رویدادها** (outbox §۴): ‏`lms.lesson_completed`، ‏`lms.course_completed`،
   ‏`lms.certificate_issued`، ‏`lms.cohort_enrolled`.

۹. **مجوز:** ‏`lms.manage` جدید در RBAC برای CRUD ادمین
   (`/api/v1/admin/lms/*`)؛ به super_admin اعطا می‌شود.

۱۰. **سید نمایشی** (`seed_lms_demo`): یک برنامهٔ «آشنایی با فقه حنفی» با یک
    دورهٔ مقدماتی و سه درس؛ body درس‌ها فقط **ارجاع** به محتوای واقعیِ موجود
    (`fiqh_topics` / `scholar_quotes` / `quiz_questions` تأییدشده) است —
    هیچ متن فقهی اختراعی. همه‌چیز با برچسب «نمایشی».

## پیامدها

- مثبت: بدون تکرار منطق آزمون؛ گزارش همیشه با دادهٔ زنده؛ گواهی قابل‌استعلام
  با PDF واقعی سه‌زبانه؛ قرارداد §۶ برای فایل‌ها حالا پیاده‌سازی پیش‌فرض دارد.
- منفی: ‏`LocalStorageProvider` تک‌نمونه‌ای است (مثل rate limiter فاز ۲ —
  در صورت چند replica باید به S3 منتقل شود)؛ PDF فعلاً فقط فونت Regular
  دارد (بدون Bold/Italic).
- ریسک: `arabic-reshaper`/`python-bidi` در `requirements.txt` پین شده‌اند؛
  اگر فونت سیستمی عربی در محیط production نباشد، تولید PDF با خطای صریح
  fail می‌کند (نه PDF خراب).

## جایگزین‌های ردشده

- جدول `study_reports`: منبع حقیقت دوگانه (رد شد — بند ۲).
- کپی `quiz_generate` در ماژول lms: نقض §۱۵.۲ (رد شد — بند ۳).
- PDF تک‌زبانه یا سه PDF جدا: spec سه‌زبانه در یک صفحه می‌خواهد.
- ذخیرهٔ PDF به‌صورت base64 در DB: نقض §۶ (فایل باید در storage باشد).
