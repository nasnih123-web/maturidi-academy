# ADR-0009 — فاز ۱۲: بک‌اند دستیار صوتی دوزبانه (فارسی/عربی)

> **وضعیت:** پذیرفته‌شده — فاز ۱۲ (Track 1: Backend)
> **تاریخ:** 2026-10-19

## زمینه

فاز ۱۲ دستیار صوتی فشار-و-صحبت فارسی/عربی می‌سازد و از ماژول‌های فاز ۵
(قرآن) و فاز ۶ (فتوای RAG) استفادهٔ مجدد می‌کند. تصمیم‌های کلیدی: (۱) STT
واقعی فقط با faster-whisper وگرنه خطای صادقانه، (۲) طبقه‌بندی قصد قطعی و
داده‌محور بدون LLM، (۳) قاعدهٔ سخت «آیهٔ قرآن هرگز TTS نمی‌شود»، (۴) TTS
با degradation صادقانه وقتی providerای پیکربندی نشده.

## تصمیم‌ها

### ۱) STT: faster-whisper اگر نصب باشد، وگرنه `stt_unavailable` صادقانه

- `POST /api/v1/voice/transcribe` آپلود صوتی (webm/mp4/m4a/wav/ogg) را با
  اعتبارسنجی پسوند + magic-byte + سقف حجم (§۷) می‌پذیرد و هم‌زمان
  (timeout ۶۰ ثانیه) رونویسی می‌کند؛ فایل بلندتر از
  `voice.max_audio_seconds` → ۴۲۲ با راهنمایی.
- مدل faster-whisper به‌صورت lazy در thread جدا لود می‌شود تا event loop
  بلاک نشود. اگر پکیج/مدل غایب باشد، `stt.py::resolve_stt_provider` خطای
  ۵۰۳ با کد `stt_unavailable` می‌دهد — هرگز رونویسی جعلی (§۱۵.۹).
- زبان: پارامتر `lang` می‌تواند `fa`/`ar` را اجبار کند؛ در غیر این صورت
  ترکیب تشخیص خود whisper و هیوریستیک دامنهٔ اسکریپت
  (`intents.detect_language`)؛ زبان خارج از fa/ar → ۴۰۰
  `unsupported_language` صادقانه.

### ۲) طبقه‌بندی قصد قطعی و داده‌محور (`intents.py`)

- بدون LLM: الگوهای regex فارسی+عربی در `INTENT_PATTERNS` (قابل گسترش بدون
  تغییر کد)، اولویت quran سپس fatwa وگرنه general.
- استخراج ارجاع آیه (`extract_ayah_reference`): ارجاع عددی صریح (`2:153`)
  → «سوره X آیه Y» (نام عربی از `surahs.py` فاز ۵ + نام رایج فارسی) →
  کلیدواژهٔ موضوعی (`TOPIC_AYAH`: شاخص ارجاع قطعی به آیات مشهور؛ متن آیه
  همیشه از provider فاز ۵ می‌آید، نه هاردکد).
- نام سوره با نرمال‌سازی عربی (حذف تشکیلات، یکدست‌سازی الف/ی/ک/ة) تطبیق
  داده می‌شود تا «بقره»، «البقرة» و «بقرة» هر سه حل شوند.

### ۳) قاعدهٔ سخت: صوت آیه هرگز سنتز نمی‌شود

- شاخهٔ quran در `service.answer_text` فقط `get_ayah_bundle` فاز ۵ را صدا
  می‌زند و `audio_url` تلاوت واقعی قاری را برمی‌گرداند
  (`audio_kind="recitation"`)؛ اگر URL نبود → متن+ترجمه با
  `audio_kind="none"` و اعلان صادقانه — هیچ مسیری در این شاخه به `tts.py`
  نمی‌رسد (تست `NEVER-TTS-Quran` با monkeypatch این را قفل می‌کند).
- شاخهٔ fatwa موتور `fatwa.service.ask` فاز ۶ را **بازنویسی نمی‌کند**، فقط
  صدا می‌زند (پاسخ + citationهای grounded) و متن پاسخ را TTS می‌کند.
- شاخهٔ general: متن کوتاه از کدهای پیام دوزبانه (`MESSAGES` — §۱۵.۴) + TTS.

### ۴) TTS با degradation صادقانه (`tts.py`)

- انتزاع provider: `coqui` (محلی، اگر پکیج نصب باشد) و `cloud` (stub پشت
  `voice.tts_cloud_endpoint` در platform_settings)؛ پیش‌فرض
  `voice.tts_provider=none`.
- `synthesize_or_degrade` به‌جای exception، سه‌تایی
  `(bytes|None, mime|None, notice_code|None)` برمی‌گرداند تا پاسخ متنی از
  دست نرود؛ وقتی providerای نیست، `audio_kind="none"` با کد اعلان
  `tts_unavailable` — هرگز بایت صوتی جعلی، هرگز سکوت.

### ۵) مدل داده و رویدادها

- `voice_sessions` (user_id nullable — ask ناشناس مثل fatwa.ask) و
  `voice_usage_log` (session_id، intent، lang، stt_ms، tts_provider)؛ هر دو
  در همین فاز ساخته می‌شوند (§۹.۵: بدون FK آینده‌نگر).
- رویدادهای outbox (§۴): `voice.asked` هنگام ساخت نشست، `voice.answered`
  با `audio_kind`/`tts_provider`/`stt_ms`.
- ادمین (`voice.manage` — مجوز جدید در seed): `GET/PUT
  /api/v1/admin/voice/settings` (کلیدهای `voice.*` در platform_settings با
  اعتبارسنجی نوع + bump نسخهٔ hot-reload + audit) و `GET
  /api/v1/admin/voice/usage` (cursor-based، §۱).

## پیامدها

- بدون faster-whisper/TTS پیکربندی‌شده، کل pipeline به‌صورت متنی+صادقانه
  کار می‌کند؛ با نصب آن‌ها، همان قراردادها صوت واقعی می‌دهند — بدون تغییر
  API.
- تست‌ها (`tests/test_voice_phase12.py`): ماتریس قصد fa/ar، نامتغیر
  NEVER-TTS، تشخیص زبان، degradationهای stt/tts، زبان نامعتبر، رد magic-byte.

## جایگزین‌های ردشده

- **LLM برای تشخیص قصد** (پیشنهاد spec: «Claude API برای تشخیص قصد»):
  برای سه قصد قطعی، regex داده‌محور قطعی‌تر، آفلاین، بدون هزینه و کاملاً
  تست‌پذیر است؛ مسیر بعداً می‌تواند به classifier مدل‌محور ارتقا یابد بدون
  تغییر قرارداد.
- **ذخیرهٔ بایت صوت TTS در دیتابیس:** صوت به‌صورت base64 در پاسخ برمی‌گردد
  و ذخیره نمی‌شود؛ در صورت نیاز، فاز ۱۳ می‌تواند آن را به StorageProvider
  (§۶) منتقل کند.
