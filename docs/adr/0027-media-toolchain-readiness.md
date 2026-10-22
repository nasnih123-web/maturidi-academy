# ADR-0027 — زنجیرهٔ ابزار رسانه در ایمیج + گیت آمادگی ورکر (B-04)

وضعیت: پذیرفته‌شده (رفع اشکال حسابرسی 197efa0، آیتم B-04)
تاریخ: ۲۰۲۶-۱۰-۲۲

## زمینه

یافتهٔ Blocker حسابرسی: صف media روی کاغذ STT/OCR داشت ولی ایمیج
production هیچ‌کدام از ابزارها را نداشت (نه ffmpeg، نه tesseract، نه
poppler) و faster-whisper هم در requirements نبود؛ تسک رونویسی حتی
باینریِ `whisper` (پکیج دیگری) را صدا می‌زد که هیچ‌جا نصب نمی‌شد.
نتیجه: هر تسک رسانه در production بی‌صدا می‌سوخت.

## تصمیم

۱) **ایمیج**: Dockerfile ابزارها را با پینِ خانوادهٔ انتشار روی
Debian trixie (پایهٔ python:3.14-slim) نصب می‌کند:
`ffmpeg=7:7.1.*` (نسخهٔ فعلی archive: ‏7:7.1.5-0+deb13u1)،
`tesseract-ocr=5.5.0-*` (5.5.0-1+b1) + پک‌های fas/ara
(eng وابستگی خود پکیج است)، `poppler-utils=25.03.0-*`
(25.03.0-5+deb13u4). پینِ خانوادهٔ انتشار (نه نسخهٔ دقیقِ نقطه‌ای)
عمدی است: به‌روزرسانی امنیتیِ نقطه‌ایِ archive نباید بیلد را بشکند،
ولی پرش نسخهٔ اصلی/فرعی بدون بازبینی ممکن نیست.

۲) **STT یکپارچه**: `faster-whisper==1.2.1` در requirements پین شد
و مدل نام‌دارِ واحد `FASTER_WHISPER_MODEL = "small"` در
`app/core/media_tools.py` منبع حقیقت است — هم provider صدا
(FasterWhisperSTT) و هم تسک رونویسی کتابخانه از همان استفاده
می‌کنند. تسک کتابخانه از باینریِ خیالیِ `whisper` به provider واقعی
مهاجرت کرد (با سقف ۱۵۰۰ ثانیه برای فایل‌های بلند).

۳) **گیت آمادگی (fail loud)**: `app/core/media_tools.py`:
`media_tools_status()` وضعیت ffmpeg/ffprobe/tesseract (+زبان‌ها)/
pdftoppm/faster-whisper را می‌دهد؛ `assert_media_tools_ready()` در
`on_startup` ورکر media (app/worker.py) با ابزارِ غایب CRITICAL
لاگ + RuntimeError می‌دهد و ورکر بالا نمی‌آید. `/api/v1/health`
وضعیت media_tools را منتشر می‌کند. تسک‌ها هم خطای صریحِ نام‌دار
می‌دهند (stt_unavailable / ocr_tools_missing / ...) و وضعیت failed
با دلیل روی آیتم ثبت می‌شود — هرگز خروجی جعلی.

۴) **اثبات**: job ‏docker در CI ایمیج را می‌سازد و داخل همان ایمیج
وجود ابزارها + خود گیت آمادگی را assert می‌کند (اجرای واقعی: CI؛
در sandbox داکر نیست — NOT RUN LOCALLY). تست‌های واحد آمادگی با
PATH دست‌کاری‌شده و باینری‌های stub در tests/test_media_tools.py
سبزند.

## پیامدها

- مدل whisper هنگام اولین استفاده از HuggingFace دانلود می‌شود؛
  در استقرار بدون اینترنتِ خروجی، مالک باید کش مدل را از پیش آماده
  کند (در غیر این صورت تسک با stt_unavailable صریح fail می‌شود،
  نه ساکت).
- تسک‌های media از این پس بدون زنجیرهٔ ابزار اصلاً شروع نمی‌شوند؛
  این تغییر رفتار عمدی و خواستهٔ حسابرسی است.
