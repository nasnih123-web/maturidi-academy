# فاز ۵ — برابری حفاظ با ترتیل: Audio Pipeline + WebSocket Contract

- تاریخ: ۲۰۲۶-۱۱-۰۷
- شاخه: `feature/hifz-tarteel-parity`، مبنا main `47a50261` (مرج PR #114)
- ریسک‌های هدف: R-01 (P0) ،R-02 (P1) ،R-04 ،R-11
- کامیت نشده است (کامیت با هماهنگ‌کننده است).

## چه تغییر کرد و چرا

### ۱. R-01 — مسیر زنده بدون resampling (P0)

**مشکل:** وب با `ScriptProcessorNode` منسوخ قاب می‌فرستاد و نرخ ۱۶kHz
فقط «درخواست» شده بود؛ اگر مرورگر گوشی ۴۸kHz می‌داد، صوت با سرعت ۳
برابر به مدل می‌رسید و هیچ خطایی دیده نمی‌شد.

**راه‌حل:**
- `apps/web/lib/quran-audio.ts` (جدید، خالص و تست‌پذیر):
  - `Resampler`: resample واقعی به ۱۶kHz مونو با فیلتر anti-alias
    (windowed-sinc، ۱۲۹ tap، Blackman، بهرهٔ DC ‏۱). نرخ‌های ۱۶/۳۲/
    ۴۴٫۱/۴۸kHz و چندکاناله (میانگین کانال‌ها) پشتیبانی می‌شوند؛
    NaN/Infinity با ۰ جایگزین و clip clamp می‌شوند (هر دو شمرده
    می‌شوند)؛ بافرِ ورودی سقف ۱ ثانیه دارد (بدون رشد بی‌حد).
  - `AudioFrameAssembler`: قاب‌های ثابت ۴۰۹۶ نمونه (۲۵۶ میلی‌ثانیه)
    Int16LE تک‌کاناله؛ سکوت شمرده می‌شود؛ قابِ ناقصِ انتهایی فقط در
    `flush` با صفر پر می‌شود.
- `apps/web/public/worklets/quran-capture-processor.js` (جدید):
  AudioWorklet که ورودی میکروفون را به تکه‌های ۴۰۹۶ نمونه‌ایِ مونو
  انباشته و به نخ اصلی می‌فرستد (transferable). resample در نخ اصلی
  است تا منطق تست‌پذیر بماند.
- `QuranHifzStudy.tsx`: `ScriptProcessorNode` فقط fallback **صریح**
  است — وقتی `audioWorklet` نباشد یا ماژول بار نشود، همان Resampler
  استفاده می‌شود و UI صریحاً «مسیر صوتی قدیمی» را نشان می‌دهد
  (نه fallback پنهان). نرخ واقعی سخت‌افزار (`ctx.sampleRate`) در خط
  تشخیص نشان داده می‌شود.
- مسیر ضبط-سپس-نمره (record-then-grade) که resample واقعی داشت، دست
  نخورده است.
- میکروفون: pause/resume با `ctx.suspend()/resume()`؛ توقف،
  trackها و AudioContext و گره را آزاد می‌کند؛ `devicechange` و
  `track.onended` (تغییر دستگاه / لغو دسترسی / جدا شدن) جلسه را با
  پیام روشن می‌بندند؛ `visibilitychange` (رفتن به پس‌زمینه) ضبط را
  موقتاً متوقف و با بازگشت ادامه می‌دهد.

### ۲. R-02 — readiness واقعی WebSocket (P1)

**مشکل:** `ws.onopen` فوراً Listening را فعال می‌کرد در حالی که
بازشناس بعد از `start` ساخته می‌شد و قاب‌های اول با `_drop_stale_frames`
بی‌صدا دور ریخته می‌شدند.

**راه‌حل:**
- ماشین وضعیت صریح سمت سرور (`hifz_ws_contract.py`):
  `idle → connecting → connected → engine_loading → audio_ready →
  listening → processing → stopping → completed/failed`؛ گذر نامجاز
  خطا می‌دهد. `reconnecting`/`interrupted` فقط سمت کلاینت‌اند.
- سرور پس از `start` به‌ترتیب `session_started`، `engine_ready`
  (پس از ساخت بازشناس **+ warm-up واقعی**: نیم ثانیه سکوت از مسیر
  بومی می‌گذرد) و `audio_ready` می‌فرستد؛ حلقه با `listening` شروع
  می‌شود. کلاینت فقط پس از `listening`، «در حال گوش‌دادن» نشان
  می‌دهد و ضبط را از حالت suspend درمی‌آورد — پس قابِ پیش از
  readiness اصلاً تولید نمی‌شود.
- قاب‌های رسیده پیش از readiness (کلاینت قدیمی) رد می‌شوند و شمارشان
  با رویداد `warning` (کد `hifz_frames_before_ready`) + لاگ گزارش
  می‌شود، نه بی‌صدا دور ریخته. تابع `_drop_stale_frames` به
  `_collect_pre_ready_frames` تغییر نام داد.
- مهلت ۱۵ ثانیه‌ای اتصال حالا فقط با `listening` پاک می‌شود، نه با
  `onopen`.
- کلاینت حالت‌های تازه دارد: `requesting_permission` (پنجرهٔ اجازهٔ
  میکروفون)، `engine_loading`، `stopping`، `interrupted` (قطع ناخواسته؛
  کاربر با زدن میکروفون نشستِ **تازه** شروع می‌کند — سرور نشست را از
  سر نمی‌گیرد و کلمه‌های ذخیره‌نشدهٔ نشستِ پیشین از دست می‌روند).

### ۳. R-04 — قرارداد WS نسخه‌دار

**مشکل:** رویداد کلمه‌ای بدون seq/id بود و کلاینت کورکورانه الحاق
می‌کرد؛ duplicate/out-of-order در شبکهٔ ناپایدار، کلمهٔ تکراری
می‌ساخت.

**راه‌حل (`apps/api/app/modules/quran/hifz_ws_contract.py` جدید):**
- نسخهٔ ۱ (قدیمی): `start` بدون `protocol_version`؛ رویدادها همان
  نامِ `type` قدیمی را دارند و فیلدهای پاکتِ اضافه را نادیده
  می‌گیرند — بی‌سروصدا نمی‌شکنند.
- نسخهٔ ۲ (جاری): هر رویداد `session_id`، `event_id`، `sequence_no`
  (از ۱، یکنواختِ صعودی در هر نشست)، `event_type`، `status`، موقعیت
  قرآن (`surah`/`ayah`/`word_index` هرجا که معنا دارد؛ `page`/`line`
  سمت سرور معلوم نیست و فرستاده نمی‌شود)، `audio_ts_ms` (زمانِ
  صوتیِ تجمعیِ رسیده)، و `confidence`/`reason` (برای کلمه‌ها) دارد.
- رویدادها: `session_started`، `engine_ready`، `audio_ready`،
  `listening`، `partial` (وسطِ کلمه — حداکثر یکی برای هر واحد)،
  `stable_word`، `final_word` (کلمه‌های پایانیِ `finish`)،
  `correction`، `located`، `skipped`، `wrong`، `extra`، `progress`
  (ورود به آیهٔ تازه)، `warning`، `error`، `final`، `session_ended`.
- همان خانه هرگز دو بار نوشته نمی‌شود: تصمیمِ بعدی برای همان
  `(ayah, word_index)` رویداد `correction` است با `corrects_event_id`.
- سرور هرگز replay نمی‌کند؛ جاافتادگیِ `sequence_no` فقط گزارش
  می‌شود.
- کلاینت (`LiveEventStore` در `quran-audio.ts`): dedup با `event_id`،
  مرتب‌سازی/تشخیص بی‌ترتیبی و جاافتادگی، اعمال correction در همان
  خانه، نادیده‌گرفتن رویدادِ نشستِ دیگر (سوکتِ کهنه پس از اتصالِ
  دوباره)، و dedup رویدادِ قدیمیِ بدون پاکت با کلیدِ خانه.
- پیام `start` اعتبارسنجی می‌شود: نسخهٔ ناشناخته، فیلد ممنوع
  (`user_id`/`attempt_id`/`owner`/`session_id`)، اعلامِ قالبِ
  ناسازگار (غیر از ۱۶kHz مونو Int16LE)، و `surah` نامساوی با سورهٔ
  attempt (موقعیت مرجع را کلاینت تعیین نمی‌کند) → خطای روشن ۴۰۰.
  مالکیت attempt پیش‌تر با `_attempt_or_404` چک می‌شود.

### ۴. R-11 — سقف نرخ/اندازه در حلقهٔ WS

- هر قاب: طولِ زوج (Int16LE) و حداکثر ۶۴ کیلوبایت؛ بدشکل/بیش‌ازحد →
  خطای روشنِ غیرکشنده (`fatal: false`) + شمارش؛ سه‌بارِ پی‌درپی →
  بستن (۱۰۰۹ برای اندازه).
- نرخ قاب: سطل توکن (۵۰ قاب/ثانیه پایدار، انفجار ۱۰۰)؛ تخطیِ نخست →
  هشدار، تکرار → بستن ۴۴۰۹ با کد `hifz_rate_limited`.
- پیام متنی: حداکثر ۴٬۰۹۶ بایت؛ بزرگ‌تر → خطای غیرکشنده.
- مدت نشست: حداکثر ۳۰ دقیقه؛ پس از آن مثل `end` نهایی می‌شود
  (تخلیه + ذخیره + `final` + `session_ended` با دلیل `max_duration`).
- سکوت/کلیپِ قاب‌ها شمرده و در لاگ پایان نشست می‌آید؛ ۱۰ قابِ کلیپ →
  یک هشدار `hifz_audio_clipping`.
- بلیط (`?ticket=`) یک‌بارمصرف و ۶۰ ثانیه‌ای است و هرگز در لاگ
  نمی‌آید؛ `?token=<JWT>` همچنان پذیرفته نیست.

## فایل‌های تغییرکرده

| فایل | تغییر |
|---|---|
| `apps/api/app/modules/quran/hifz_ws_contract.py` | جدید: نسخهٔ قرارداد، پاکت رویداد، ماشین وضعیت، اعتبارسنجی start/قاب، سطل توکن |
| `apps/api/app/modules/quran/hifz_stream.py` | پاکت روی همهٔ رویدادها؛ correction؛ partial؛ progress؛ final_word؛ ساعت صوتی؛ `warmup()`؛ چک سورهٔ start |
| `apps/api/app/modules/quran/hifz_router.py` | رویدادهای readiness؛ `_collect_pre_ready_frames`؛ اعتبارسنجی قاب/نرخ/پیام؛ سقف مدت؛ `session_ended`؛ لاگ سکوت/کلیپ |
| `apps/api/tests/test_hifz_phase5_ws.py` | جدید: ۱۹ تست قرارداد/آمادگی/سقف |
| `apps/api/tests/test_hifz_stream.py` | به‌روزرسانی ۴ assertion به پاکت نسخهٔ ۲ (بدون ضعیف‌کردن) + تغییر نام تست قاب‌های مانده |
| `apps/web/lib/quran-audio.ts` | جدید: Resampler + AudioFrameAssembler + LiveEventStore + ماشین وضعیت کلاینت + پیام start نسخهٔ ۲ |
| `apps/web/public/worklets/quran-capture-processor.js` | جدید: AudioWorklet ضبط |
| `apps/web/lib/__tests__/quran-audio.test.ts` | جدید: ۲۲ تست واحد (بدون runner، با node:test) |
| `apps/web/components/QuranHifzStudy.tsx` | AudioWorklet + fallback صریح؛ state machine؛ store؛ مدیریت دستگاه/پس‌زمینه؛ خط تشخیصِ گسترده |
| `apps/web/app/[locale]/quran/[surah]/page.tsx` | ۱۰ برچسب تازه |
| `apps/web/messages/{fa,ar,en}.json` | ۱۰ کلید تازه (فارسی/عربی/انگلیسی) |

## تست‌ها و نتایج (اعداد واقعی)

| تست | فرمان | نتیجه |
|---|---|---|
| pytest زیرمجموعهٔ hifz | `pytest tests/test_hifz_phase5_ws.py tests/test_hifz_stream.py tests/test_hifz_phase3.py tests/test_hifz_mapping.py tests/test_hifz_phoneme_grade.py -q` | **۸۷ passed، ۲ skipped** |
| pytest کامل API | `pytest -q -p no:cacheprovider` | **۱۰۵۲ passed، ۶ skipped، ۷۱۰ warning، ۳۸۷٫۸۸ ثانیه، exit 0** — مبنا ۱۰۳۳ بود؛ ۱۹ تست تازهٔ فاز ۵ اضافه شده و هیچ رگرسیونی نیست. (اجرای اول با ری‌استارت runtime کشته شد؛ اجرای دوم کامل شد.) |
| تست واحد وب (resampler + store) | tsc به `/tmp/quran-audio-test` + `node --test` | **۲۲ passed، ۰ failed** (شامل ۴۸k→16k با فرکانس ۱kHz حفظ‌شده و ۱۲kHz حذف‌شده با نسبت <۰٫۰۵) |
| نحو worklet | `node --check public/worklets/quran-capture-processor.js` | OK |
| tsc وب | `./node_modules/.bin/tsc --noEmit` | **exit 0، بدون خطا** |
| Ruff | `tools/check_ruff_baseline.py` | **PASS — دقیقاً روی baseline (۱۲۹ خطای شناخته‌شده، بدون افزایش)** |

اجرای تست وب (بدون runner در مخزن):
```sh
cd apps/web
./node_modules/.bin/tsc lib/quran-audio.ts lib/__tests__/quran-audio.test.ts \
  --outDir /tmp/quran-audio-test --module commonjs --target es2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
node --test /tmp/quran-audio-test/__tests__/quran-audio.test.js
```

## موارد باز / تصمیم‌های موردنیاز کاربر

1. **تست گوشی (POCO X5) هنوز بدهکار است:** نرخ واقعی ۴۸kHz،
   AudioWorklet، و رسیدن `listening` پیش از شروع خواندن فقط روی
   گوشی کاربر قابل تأیید نهایی است (تست واحد، resample را با سیگنال
   مصنوعی اثبات می‌کند، نه با میکروفون واقعی).
2. **بازپخش (replay) تعریف‌شده ولی پیاده نشده:** سرور هرگز رویداد
   را دوباره نمی‌فرستد؛ جاافتادگیِ `sequence_no` فقط در شمارنده‌های
   store ثبت می‌شود و در UI نمایش داده نمی‌شود (به‌جز `dropped`
   در خط تشخیص). اگر کاربر بخواهد جاافتادگی به او نشان داده شود،
   باید گفته شود.
3. **`partial` فقط نمایش داده می‌شود، نه روی دیوار نوشته می‌شود:**
   کلمهٔ جاری به‌صورت «در حال خواندن: …» زیر دکمه می‌آید. اگر ترتیل
   رفتار دیگری دارد (فیلم‌ها هنوز نرسیده‌اند)، این قسمت باز است.
4. **اتصالِ دوباره = نشستِ تازه:** کلمه‌های ذخیره‌نشدهٔ نشستِ قطع‌شده
   از دست می‌روند (قرارداد سرور: فقط `end` ذخیره می‌کند). اگر کاربر
   بخواهد قطعِ موقت، نشست را از سر بگیرد، تصمیم محصول لازم است.
5. **سقف ۳۰ دقیقه و ۵۰ قاب/ثانیه** مقادیر انتخاب‌شدهٔ این فازند؛
   اگر کاربر حد دیگری می‌خواهد، بگوید.
6. **سازگاری:** کلاینت قدیمی (نسخهٔ ۱) همان رویدادهای قدیمی را
   می‌گیرد (با فیلدهای اضافه که نادیده می‌گیرد)؛ رویدادهای تازهٔ
   نسخهٔ ۲ را نادیده می‌گیرد و قاب‌های پیش از readiness آن مثل قبل
   بی‌صدا رد می‌شوند (هشدار فقط برای کلاینت نسخهٔ ۲ قابل مشاهده
   است). موبایل هنوز حفاظ ندارد (R-15، خارج از این فاز).
