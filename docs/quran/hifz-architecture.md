# معماری واقعی فعلی ماژول حفاظ — ممیزی فاز ۲ «برابری با ترتیل»

- **مبنا:** شاخهٔ `feature/hifz-tarteel-parity`، مرج `47a50261` (PR #114 — بازسازی صفحهٔ مطالعهٔ حفاظ عین ترتیل)
- **تاریخ ممیزی:** ۲۰۲۶-۱۱-۰۷
- **قاعدهٔ کار:** فقط خواندنی؛ هیچ کد production تغییر نکرده است. هر ادعا به فایل/خط ارجاع دارد.
- **سند همراه:** `hifz-risk-register.md` (رجیستر ریسک/ایراد، P0 تا P3)

---

## ۱. تصویر کلی

ماژول حفاظ دو مسیر نمره‌دهی دارد که موتور و قراردادشان جداست:

| مسیر | ورودی | موتور | خروجی |
|---|---|---|---|
| **زنده (live)** — WebSocket | قاب‌های صوتی Int16LE از میکروفون | فقط Zipformer (sherpa_onnx) | رویداد کلمه‌ای `word`/`extra`/`located`/`final` در لحظه |
| **ضبط-سپس-نمره (grade)** — REST | فایل WAV کامل (MediaRecorder → resample آفلاین به ۱۶kHz) | Zipformer پیش‌فرض، یا Whisper-quran اگر در CRM انتخاب شده باشد | نمرهٔ کامل آیه/کلمه پس از پایان ضبط |

نکتهٔ معماری مهم: **موتور زنده و موتور ضبطی یکی نیستند.** انتخاب Whisper در CRM فقط مسیر ضبطی را عوض می‌کند؛ مسیر زنده در هر صورت Zipformer می‌خواهد و اگر موتور انتخاب‌شده Zipformer نباشد، با خطای صادقانه رد می‌شود (`hifz_stream.py:1025-1027`، `LiveUnavailableError`) — بدون fallback پنهان.

متن معیار همهٔ مسیرها متن عثمانی Tanzil است (`apps/api/app/modules/quran/data/tanzil_uthmani.txt`، ۶٬۲۳۶ آیه) که از `quran_service.get_ayah_bundle` با edition ‏`quran-uthmani` خوانده می‌شود (`hifz_service.py:85-101`).

---

## ۲. مسیر صوت end-to-end (زنده)

### ۲.۱ سمت وب — `apps/web/components/QuranHifzStudy.tsx` (۲٬۳۰۹ خط)

1. **شروع:** `startLive` (حدود خط ۱۲۱۱) → ساخت attempt با `POST /hifz/attempts` (اگر attempt برای همین سوره نباشد، attempt تازه ساخته می‌شود؛ `ensureAttempt` خط ۱۰۵۷) → گرفتن بلیط یک‌بارمصرف `POST /api/v1/auth/ws-ticket` → باز کردن WebSocket به `/hifz/attempts/{attemptId}/stream?ticket=…`.
2. **میکروفون:** `navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })` (خط ۱۳۵۴)، سپس `new AudioContext({ sampleRate: 16000 })` (خط ۱۳۶۲) و **`ctx.createScriptProcessor(4096, 1, 1)`** (خط ۱۳۶۸) — یعنی **ScriptProcessorNode منسوخ**؛ هیچ AudioWorkletای در کار نیست. کامنت خود کد (خط ۱۳۵۱) می‌گوید «deprecated but needs no extra worklet file».
3. **ارسال قاب:** در `onaudioprocess` هر بافر Float32 به Int16LE تبدیل و با `ws.send(buf)` فرستاده می‌شود (خط ~۱۳۷۰-۱۳۸۵). **هیچ resamplingای انجام نمی‌شود:** اگر مرورگر نرخ درخواستی ۱۶kHz را نادیده بگیرد (در گوشی‌ها معمولاً ۴۸kHz)، قاب‌ها با همان نرخ واقعی فرستاده می‌شوند ولی سرور آن‌ها را ۱۶kHz فرض می‌کند. خود کد این را می‌داند و نرخ واقعی را در خط تشخیص (`liveDiag.sampleRate`، خط ۱۳۶۶ و ۲۲۱۶) نشان می‌دهد — ولی جبران نمی‌کند. ← ریسک R-01 (P0).
4. **وضعیت Listening:** در `ws.onopen` بلافاصله `setLiveState('listening')` می‌شود (خط ۱۲۵۲-۱۲۵۶) و پیام `{type:'start', surah, ayah}` فرستاده می‌شود. **هیچ readiness واقعی موتور در کار نیست:** ساخت بازشناس (بارگذاری مدل ۷۳ مگابایتی) در سرور *بعد* از پیام start و در نخ جدا انجام می‌شود (`hifz_router.py:309-318`)؛ تا آن موقع قاب‌های رسیده دور ریخته می‌شوند (`_drop_stale_frames` در `serve_stream`). کاربر «در حال گوش‌دادن» می‌بیند در حالی که موتور هنوز بالا نیامده است. ← ریسک R-02 (P1). مهلت اتصال ۱۵ ثانیه‌ای (`cancelLive(true)` در خط ~۱۲۳۸) فقط قطع‌شدنِ اتصال را پوشش می‌دهد، نه آماده‌شدنِ موتور را.
5. **دریافت رویداد:** `ws.onmessage` بر اساس `msg.type` شاخه‌بندی می‌کند (خط ~۱۲۷۳):
   - `word` → `setLiveWords(prev => [...prev, msg])` — **الحاق کورکورانه؛ بدون شمارهٔ ترتیب (seq)، بدون dedup، بدون correction**. نوع `LiveWordEvent` (خط ۳۹۶-۴۰۵) هیچ فیلد seq/id ندارد: `{type, surah, ayah, word_index, expected, status, prob, heard}`. اگر رویدادی دو بار برسد یا دیر برسد، دو بار نوشته می‌شود. ← ریسک R-04 (P2).
   - `located` → جابه‌جایی صفحه به آیهٔ پیداشده (خط ~۱۲۸۲).
   - `extra` → شمارندهٔ کلمهٔ اضافه (خط ~۱۲۹۰).
   - `final` → پاک‌شدن کلمه‌های زنده پس از رسیدن نمرهٔ سرور؛ اگر `refreshDetail` ناموفق باشد کلمه‌های زنده می‌مانند (خط ~۱۲۹۳-۱۳۲۵).
   - `error` → نمایش خطا و بازگشت به `idle`.
6. **توقف:** `stopLive` (خط ۱۴۲۱) فوری است: `end` می‌فرستد و سوکت را می‌بندد؛ کامنت می‌گوید ترتیب قاب‌ها روی یک اتصال حفظ می‌شود پس `end` پیش از قاب close به سرور می‌رسد. قطع ناگهانی بدون `end` چیزی ذخیره نمی‌کند (قرارداد سرور).
7. **ضبطی (غیرزنده):** `startRecording` (خط ~۱۰۷۷) با MediaRecorder ضبط می‌کند، بعد با `OfflineAudioContext` به ۱۶kHz resample می‌کند (خط ۱۰۹۲-۱۱۰۰) و WAV می‌سازد — **این مسیر resample واقعی دارد**، بر خلاف مسیر زنده. نمره از `POST …/grade` یا `grade-word` (تمرین تک‌کلمه) می‌آید.

### ۲.۲ سمت API — WebSocket و نشست زنده

- **نقطهٔ ورود:** `hifz_router.py:233` (`@hifz_router.websocket("/attempts/{attempt_id}/stream")`) — احراز هویت با بلیط یک‌بارمصرف `?ticket=` (۶۰ ثانیه اعتبار، `auth/service.py:69`، `WS_TICKET_EXPIRE_SECONDS = 60`) یا JWT در هدر؛ `?token=<JWT>` هرگز پذیرفته نیست. ناموفق → بستن با ۴۴۰۱.
- **مالکیت نشست:** `start_live_session` (‏`hifz_stream.py:1007-1056`) با `hifz_service._attempt_or_404(db, user, attempt_id)` مالکیت attempt را با کاربر چک می‌کند؛ attempt دیگری → ۴۰۴.
- **توالی شروع سرور:** پیام `start` → دروازهٔ نگاشت (`require_phoneme_mapping`) → ساخت `LiveSession` → **ساخت بازشناس در `asyncio.to_thread`** (`hifz_router.py:309-318`) → `serve_stream`. زمان‌بندی هر مرحله لاگ می‌شود (`wait_start_ms`، `mapping_ms`، `session_ms`، `build_ms`).
- **حلقهٔ جریان:** `serve_stream` (`hifz_router.py:369`) — قاب باینری → `recognizer.feed(bytes)` → `session.feed_phonemes(phonemes)` → رویدادها از صف به سوکت پمپ می‌شوند (`_pump_events`). پیام متنی `end` → تخلیهٔ واج‌های مانده → ذخیرهٔ نشست → `final` → بستن ۱۰۰۰. **هیچ سقف نرخ/اندازهٔ قاب در حلقه نیست** (نه شمار قاب در ثانیه، نه حداکثر بایت) — ← ریسک R-11 (P2).
- **بازشناس:** `SherpaPhonemeStream` (`hifz_stream.py:220-300`) — `sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc` با `tokens.txt` و مدل ONNX؛ خروجی واج است نه کلمه. قرارداد دیکد رعایت شده: `decode_stream` فقط وقتی `is_ready(stream)` درست باشد (خط ۲۷۱-۲۷۹)؛ دیکد روی چانک ناقص در sherpa-onnx 2.0.1 فرایند را می‌کشد (خروج ۲۵۵) — همین باگ در PR #109 رفع شده بود. نتیجه از `get_result_as_json_string` با فیلد `tokens` خوانده می‌شود و فقط توکن‌های تازه (`_seen_tokens`) به جلو داده می‌شوند — dedup در سطح واج هست، در سطح رویداد کلمه‌ای نیست.

### ۲.۳ تطابق واج → کلمه — `hifz_mapping.py` و `hifz_stream.py`

- **منبع نگاشت:** فایل خارجی `ordered_quran_phonemes.json` (در `QURAN_PHONEME_MAP_DIR`؛ پیش‌فرض در `hifz_mapping.py:67`). بدون آن، نشست زنده ساخته نمی‌شود (`require_phoneme_mapping` → خطای صادقانه؛ تست `test_require_phoneme_mapping_is_pending`).
- **ساختار:** هر آیه به قطعه‌های واجی (Segment) تقسیم می‌شود؛ هر قطعه یک یا چند کلمه را می‌پوشاند. نشانه‌های وقفِ تنها (‏`ۖۗۘۙۚۛۜ`، ‏`_PAUSE_MARKS` خط ۷۴) در فهرست «تعدیل‌شده» حذف می‌شوند ولی با `index_map` به شاخص کامل Tanzil برگردانده می‌شوند (`hifz_mapping.py:511-533`) — پس `word_index` سرور با شمارش کامل کلمات (شامل نشانه‌های وقف) سازگار است.
- **پوشش:** تست واقعی `test_real_mapping_coverage_and_sample_segments` (`test_hifz_mapping.py:299-334`) آستانهٔ پذیرش را **≥۶٬۱۵۰ از ۶٬۲۳۶** می‌گذارد؛ عدد ۶٬۱۸۵ در مخزن پیدا نشد (در هیچ فایل کد/تستی نیست) — پوشش دقیق پذیرفته‌شده در این ممیزی **تأیید نشده** و فقط آستانهٔ ۶٬۱۵۰ مستند است. آیهٔ پذیرفته‌نشده در زنده خطای صادقانهٔ ۵۰۳ (`hifz_mapping_ayah_unavailable`) می‌دهد (`hifz_stream.py:424-435`). بارگذاری کامل نگاشت ~۲۲۷ ثانیه طول می‌کشد (مستند در docstring ‏`map_files_present`).
- **گرم‌کردن (warm-up):** فقط نگاشت در startup گرم می‌شود (`main.py:182-202`، `_warmup_hifz` — بارگذاری نگاشت در task پس‌زمینه، بدون شکستن بوت). **مدل ASR گرم نمی‌شود** — نخستین نشست زنده مدل ۷۳ مگابایتی را همان لحظه بار می‌کند. `/hifz/status` (`hifz_router.py:58-63`) فقط «پیکربندی‌شده‌بودن» موتور را گزارش می‌کند، بدون بارگذاری مدل و بدون readiness واقعی.
- **قوانین تطابق زنده (`LiveSession.feed_phonemes`):**
  - آستانه‌ها: سبز ≥۰٫۸ / کهربایی ۰٫۵–۰٫۸ / قرمز <۰٫۵ (از `get_thresholds` در CRM؛ پیش‌فرض در کد).
  - جاافتادنِ بیش از ۵ آیه → خاکستری نمی‌شود؛ پرچم `_relocate_pending` می‌خورد و یافتنِ دوباره لازم است (`_advance_ayah`).
  - **اشتباه‌خوانی:** پرچم `_locate_failed` (`hifz_stream.py`) — وقتی بافر با هیچ آیه‌ای نمی‌خواند، واحدِ بی‌تطابق «غلط» علامت می‌خورد نه «جاافتاده»، تا اشاره‌گر جلو نرود و آیهٔ نخوانده نوشته نشود. این همان رفتار پرمیوم ترتیل (علامت خطا + ادامهٔ جریان، بدون یخ‌زدن) است و تست دارد (`test_feed_phonemes_wrong_surahm_does_not_write_unrecited_ayahs`).
  - مد (madd): کشش مد فروپاشیده می‌شود (`collapse_phoneme_runs`) تا طول مدِ نگاشت با شنیده‌شده فرق نکند؛ تست `test_feed_phonemes_madd_length_ignored`.
- **نمره‌دهی ضبطی:** `hifz_service.py` — موتور از `quran.asr_engine` در CRM خوانده می‌شود (`resolve_engine_id`، ‏`hifz_engines.py:362-373`)؛ موتور نامعتبر/بارنشدنی → `EngineError` صادقانه، **بدون جابه‌جایی بی‌صدا به موتور دیگر** (مستند در سربرگ `hifz_engines.py:10-12`).

### ۲.۴ موتورها — `hifz_engines.py` (۳۷۵ خط)

- `ZipformerEngine`: sherpa_onnx، مدل `zipformer_p_arabic_v3.1(.int8).onnx` + ‏`tokens.txt`؛ بارگذاری تنبل (lazy) در نخستین استفاده؛ نبود sherpa_onnx → ‏`engine_not_configured`.
- `WhisperQuranEngine`: faster-whisper روی تبدیل CTranslate2 از `tarteel-ai/whisper-base-ar-quran` (مخزن transformers به‌تنهایی قابل‌بارگذاری با faster-whisper نیست؛ تبدیل third-party ‏`hkhan0327/faster-whisper-base-ar-quran`)؛ زمان‌بندی کلمه‌ها تخمین DTW است نه تراز واجی دقیق (مستند در خط ۴۵-۴۶). فقط ضبط-سپس-نمره؛ جریانی نیست.
- هیچ fallback پنهانی بین موتورها نیست؛ هیچ نمرهٔ ساختگی برنمی‌گردد.

---

## ۳. رندر صفحهٔ مطالعه — `QuranHifzStudy.tsx` + مصحف

- **چیدمان مصحف:** صفحهٔ سفید با چیدمان خطی دقیق مصحف از `apps/web/lib/quran-mushaf-lines.json` — فایل `{pages: MushafExactLine[][]}` با **۶۰۴ صفحه**؛ هر خط فقط `{t, x, v, w}` دارد: نوع خط (`text`/`surah-header`/`basmala`)، متن خط، و بازهٔ آیهٔ اول/آخر (`v`/`w` به‌صورت `"S:A"`). **فقط line break است، نه layout کامل:** بدون شیءِ هر کلمه، بدون مختصات، بدون گلیف. `quran-mushaf-lines.ts` (۵۰ خط) فقط lazy-load می‌کند و در صورت خطا `null` برمی‌گرداند (fallback به متن جاری، نه صفحهٔ خالی).
- **نگاشت چاپ → کلمه:** `parseTextLine` (خط ۱۵۰) خط را به توکن‌های whitespace تقسیم می‌کند؛ توکنِ عددِ عربی (شمارهٔ آیه) مرز قطعه است (`isMarkerToken`، خط ۱۲۶). در `renderLines` (خط ~۴۳۰) هر توکن چاپی به‌صورت موقعیتی به کلمهٔ متن provider با همان شاخص (`study[start+i]`) نگاشت می‌شود — **نه بر اساس تطابق متن، بلکه بر اساس شمارش**. همین‌جا ریسک R-03 (۞) می‌نشیند: ۞ در Tanzil نیست ولی در خط چاپی توکن جداست.
- **حالت‌های نمایش (منوی پایین، §۱۰ سند مأموریت):** هر سه حالت پیاده شده و واقعاً اعمال می‌شوند — `displayMode: 'page' | 'scroll' | 'card'` (خط ۱۱۲-۱۱۸، state خط ۷۲۱، رندر خط ۱۹۷۲-۱۹۷۶، منو خط ۲۱۷۶-۲۱۹۷): ورق‌زدن (یک صفحه)، اسکرولی (همهٔ صفحات سوره)، کادر (صفحه داخل قاب مصحف). ذخیره در localStorage (`readDisplayMode`).
- **تنظیم Mushaf:** کامپوننت `initialMushaf` را می‌گیرد ولی **نادیده می‌گیرد** (خط ۶۱۹-۶۲۰: «Ignored: the line data is always Hafs») — چون متن همیشه حفص Tanzil است و مصحف‌های دیگر شماره‌گذاری متفاوت دارند. پس در صفحهٔ حفاظ «تنظیم مصحف» عملاً بی‌اثر است؛ layout همیشه یکی است (حفص QPC1). در `QuranReader` (بخش عموم) انتخاب‌گر مصحف هست ولی فقط حفص گزینهٔ واقعی است و بقیه یادداشت‌اند (`QuranReader.tsx:49`).
- **رنگ کلمه‌ها:** متن با `colorizeTajweedWord` از `quran-tajweed.ts` (۱۵۷ خط، رنگ حرف‌به‌حرف: سبز غنه/اخفا، آبی رای سنگین، صورتی مد، خاکستری وصل الف) رندر می‌شود. کلمهٔ زندهٔ تازه‌شنیده‌شده **سبز** (`#1b7a2e`، ‏`hifz-word-live-new` در `globals.css:2514`) و اگر غلط/نزدیک باشد قرمز (`hifz-word-live-new-wrong`، ‏`globals.css:2519`) است؛ کلمه‌های زندهٔ قدیمی‌تر به جوهر سیاه + رنگ تجوید برمی‌گردند (کامنت خط ۱۶۲۲-۱۶۲۵). کلیپ اول ترتیل کلمهٔ تازه را **آبی** نشان می‌دهد — اختلاف ثبت‌شده در R-07.
- **Peek:** `peekTarget` (خط ۱۰۳۷-۱۰۵۰) = نخستین کلمهٔ ننوشته‌شده از آیهٔ انتخاب‌شده به بعد؛ دکمه فقط همان یک کلمه را آشکار می‌کند و peek در سرور ثبت می‌شود (`POST …/attempts/{id}/peek`). رفتار peek در ترتیل در هیچ ویدیویی دیده نشده (spec §۸٫۱) — پیاده‌سازی فعلی حدسِ تأییدنشده است. ← R-05.
- **آیهٔ شروع:** فقط deep-link ‏`?ayah=` (خط ۶۱۵-۶۲۶) + دکمه‌های قبلی/بعدی و select (خط ۱۸۷۴-۱۸۹۲، ۲۱۲۰-۲۱۴۳). **هیچ starting-ayah pickerای نیست** (spec §۸٫۲). ← R-06.
- **سربرگ:** `.hifz-header` خودش sticky نیست (`globals.css:2560` — فقط padding/center) ولی `.site-header` سراسری سایت sticky است (`globals.css:223`، `position: sticky; top: 0; z-index: 100`). هم‌پوشانی گزارش‌شدهٔ سربرگ موبایل (D-HEADER-MOBILE) در کدِ این کامپوننت ریشهٔ آشکاری ندارد — نیازمند بازتولید روی گوشی. ← R-08.

### حالت گوش‌دادن (listen) — `quran-listen.ts` + `quran-recitation-timing.ts`

- هوک `useQuranListen` هنگام پخش صوت قاری، کلمهٔ جاری را روی صفحهٔ مصحف همگام هایلایت می‌کند (سبز `#188653` + متن سفید؛ فقط کلمهٔ جاری).
- دو استراتژی: **SEGMENTS (واقعی)** — زمان‌بندی کلمه‌به‌کلمه از endpoint بک‌اند (Quran.com v4)؛ **INTERPOLATED (تخمینی)** — اگر endpoint در دسترس نباشد، مدت آیه بر اساس طول کلمه‌ها تقسیم می‌شود و UI آن را «تخمینی» برچسب می‌زند. مسیر واقعی در تست ۳×۳ گوش‌دادن تأیید شده (۹/۹، `~/workspace/hifz-voice-test-rebuild/listen-3x3.json`)؛ مسیر تخمینی روی دستگاه تأیید نشده.

---

## ۴. API — نقاط پایانی حفاظ

همه زیر `/hifz` (به‌جز `/status` عمومی، بقیه نیازمند احراز هویت‌اند؛ `hifz_router.py:3`):

| مسیر | کار |
|---|---|
| `GET /hifz/status` | موتور انتخاب‌شده + در دسترس بودن (بدون بارگذاری مدل) |
| `POST /hifz/attempts` | ساخت attempt برای یک سوره |
| `GET /hifz/attempts`, `GET /hifz/attempts/{id}` | فهرست/جزئیات (فقط attemptهای خود کاربر) |
| `POST /hifz/attempts/{id}/grade`, `grade-word` | نمره‌دهی ضبطی (آیه / تک‌کلمه) |
| `POST /hifz/attempts/{id}/peek` | ثبت peek |
| `POST /hifz/attempts/{id}/complete`, `DELETE …` | پایان/حذف attempt |
| `WS /hifz/attempts/{id}/stream` | خواندن زنده (قرارداد در §۲٫۲) |

**قرارداد WebSocket فعلی (خلاصه):**

- احراز هویت: `?ticket=` یک‌بارمصرف (۶۰ ثانیه) یا JWT در هدر؛ `?token=` ممنوع؛ رد → ۴۴۰۱.
- نخستین پیام مشتری باید `{"type":"start","surah":N,"ayah":M}` باشد، وگرنه خطا + ۴۴۰۰.
- قاب صوتی: باینری Int16LE تک‌کانالهٔ ۱۶kHz؛ صوت گذراست و ذخیره نمی‌شود؛ پیام متنی ناشناخته → `unknown_message` بدون بستن.
- سرور: `{"type":"word",…}` برای هر کلمهٔ نوشته‌شده (جاافتاده هم با `status:"skipped"` می‌آید)، `{"type":"extra","text":…}`، `{"type":"located","ayah":…}`، `{"type":"final",…}` پس از ذخیره.
- مشتری `{"type":"end"}` بفرستد → ذخیره + `final` + بستن ۱۰۰۰؛ قطع ناگهانی بدون `end` چیزی ذخیره نمی‌کند.
- خطاهای شروع → `{"type":"error","code":…}` + بستن ۴۴۰۴ (نشست) یا ۴۵۰۰ (موتور/نگاشت).
- **در قرارداد فعلی هیچ فیلد seq/id برای رویداد کلمه‌ای نیست** و هیچ پیام readiness موتور (مثل `ready`) تعریف نشده است — وب از `onopen` به‌عنوان readiness استفاده می‌کند.

---

## ۵. تست‌ها — چه چیزی واقعاً اثبات شده است

| فایل | روش | وضعیت |
|---|---|---|
| `test_hifz_phase3.py` (۴۸۰ خط) | `_FakeEngine` (خط ۹۷) + `_fake_ayah_bundle` (خط ۵۵)؛ فایل‌های مدل ساختگی (`b"fake"`) | منطق سرویس/نمره با موتور ساختگی اثبات شده؛ **نه با مدل واقعی** |
| `test_hifz_stream.py` (۱٬۱۹۲ خط، ۳۳ تست) | `_fake_mapping`، `_MaddMapping`، `_AnchorMapping` + monkeypatch روی `_ayah_words`/`_store_grade`؛ نشست با `sender=events.append` (لیست) به‌جای سوکت واقعی | منطق تطابق/relocate/resync با نگاشت مصنوعی اثبات شده؛ یک تست سرتاسری با نگاشت واقعی و رشتهٔ واجی واقعی هست (`test_real_mapping_live_alignment_end_to_end`، فقط ۱۱۲:۱) |
| `test_hifz_mapping.py` (۳۶۵ خط) | نگاشت مصنوعی (synthetic dir) + تست پوشش واقعی (`test_real_mapping_coverage_and_sample_segments` — آستانه ≥۶٬۱۵۰/۶٬۲۳۶) | پوشش واقعی تا سطح آستانه اثبات شده؛ عدد دقیق پذیرفته‌شده گزارش نمی‌شود |
| `test_hifz_phoneme_grade.py` (۲۷۵ خط) | fake recognizer | درجه‌بندی واجی با ورودی مصنوعی |

**تنها اثبات با صوت واقعی انسان:** تست صوتی کاربر در `~/workspace/hifz-voice-test/` (فاتحه؛ ادعای ثبت‌شده: ۲۵ درست / ۴ نزدیک / ۰ جاافتاده / ۰ غلط). در این ممیزی فایل `result-new.json` همان پوشه توزیع دیگری نشان می‌دهد (شامل `skipped`) — یعنی عدد ۲۵/۴/۰/۰ به یک فایلِ نتیجهٔ مشخص در آن پوشه گره نخورد و **نیازمند بازتولید/تأیید مجدد** است (R-13). تست گوش‌دادن ۳×۳ (`listen-3x3.json`): هر ۹ ترکیب (۳ قاری × ۳ سوره) `pass: true` با `in_order: true`.

---

## ۶. فونت / مصحف

- `apps/web/public/fonts/` — ۲۵ فایل: فقط KFGQPC Uthmanic (حفص/ورش/قالون/دوری/شعبه) + Vazirmatn/Cairo/Inter. **هیچ فونت IndoPak، Nastaleeq، KFGQPC Nastaleeq یا Digital Khatt V2 در assets نیست** (جست‌وجوی کامل در `apps/web` نتیجه‌ای نداد).
- `quran-display.ts` (خط ۱۳-۱۹) صریح است: فونت‌ها فقط **stack خانوادهٔ فونت OFL** هستند (Amiri، Scheherazade New)؛ «No font file is bundled» — یعنی رندر مصحف به فونتِ نصب‌شده روی دستگاه کاربر وابسته است و با fallback کار می‌کند.
- پس «فونت مصحف عین ترتیل» (هندوپاک / Digital Khatt V2) در حال حاضر **پیاده نشده**؛ QPC1 فقط line break می‌دهد (§۳) و گلیف/فونت چاپی ندارد. ← R-14، و spec §۸٫۶ (لینک/مجوز Digital Khatt V2) همچنان باز است.
- SVGهای مصحف: در `QuranSvgPage.tsx` / `QuranMushafPage.tsx` صفحات چاپی واقعی برای هر پنج مصحف از طریق پارامتر mushaf-key رندر می‌شوند (طبق حافظهٔ پروژه) — ولی صفحهٔ **حفاظ** از SVG استفاده نمی‌کند؛ از خطوط متنی `quran-mushaf-lines.json` استفاده می‌کند.

---

## ۷. موبایل / دسکتاپ

- **موبایل** (`apps/mobile/src/screens/QuranScreens.tsx`، `services/quran.ts`، `hooks/useQuran.ts`): **هیچ Hifzای نیست** — جست‌وجوی `hifz` در هر سه فایل صفر نتیجه داد. موبایل فقط نمایش/خواندن قرآن است؛ نه صفحهٔ مطالعهٔ حفاظ دارد، نه موتور زنده، نه میکروفون. برابری حفاظ فعلاً فقط وب است.
- **دسکتاپ** (`apps/desktop`, Tauri 2): `tauri.conf.json` — `devUrl: http://localhost:3000` و `frontendDist: ../shell`. یعنی دسکتاپ پوسته‌ای دور وب است؛ باندل‌کردنِ asset محلیِ کاملِ وب در این ممیزی تأیید نشده (پوشهٔ `shell/` جداگانه است) و آفلاین‌بودن دسکتاپ اثبات نشده. ← نیازمند بررسی جداگانه (R-16).

---

## ۸. راستی‌آزمایی موارد §۸ سند مأموریت (`tarteel-rebuild-spec-fa.md` §۸)

| مورد §۸ | وضعیت در کد | نتیجه |
|---|---|---|
| ۸٫۱ اثر دکمهٔ «نمایش» (peek) | پیاده شده به‌صورت «آشکارکردنِ فقط کلمهٔ جاریِ ننوشته» (`QuranHifzStudy.tsx:1037-1050`، `peekNext` خط ۱۴۴۷)؛ در هیچ ویدیوی ترتیل دیده نشده | **باز — تأییدنشده در برابر ترتیل** (R-05) |
| ۸٫۲ انتخاب آیهٔ شروع / شروع از وسط سوره | فقط `?ayah=` + دکمهٔ قبلی/بعدی؛ هیچ pickerای نیست | **باز — پیاده نشده** (R-06) |
| ۸٫۳ یخ‌زدن روی کلمهٔ کاملاً غلط / حالت آزمون | رفتار پرمیوم پیاده شده: `_locate_failed` + علامت «غلط» بدون جلو رفتن اشاره‌گر (`hifz_stream.py`)، با تست | **پیاده شده، با تست مصنوعی؛ نیازمند تست صوتی واقعی** |
| ۸٫۴ معنای شمارندهٔ «N / ص» در قرص دقت | قرص‌ها شمار درست/نزدیک/غلط/جاافتاده را نشان می‌دهند (خط ~۱۵۰۹-۱۵۲۶)؛ معنای «ص» در کد/پیام‌ها پیدا نشد | **باز — نامشخص** |
| ۸٫۵ معنای «٨:٢١» پس از ورق‌خوردن به صفحهٔ ۱۸۵ در ۲۰:۴۶ | در کد چیزی معادل آن پیدا نشد (شمارندهٔ جلسه MM:SS است، خط ~۴۳) | **باز — نامشخص** |
| ۸٫۶ فونت Digital Khatt V2 (دانلود/مجوز) | در assets نیست؛ `digitalkhatt.org` در واکشی متنی رندر نشد (طبق spec) | **باز — پیاده نشده** (R-14) |

موارد §۱۰ (منوی سه‌حالتهٔ نمایش) پیاده شده‌اند (§۳) و تست پذیرش §۱۱ (۳×۳) در `listen-3x3.json` پاس شده است.

---

## ۹. مرز ماژول‌ها (جمع‌بندی)

```
میکروفون (وب) ──ScriptProcessor 4096──▶ WS باینری Int16LE (بدون resample)
        │                                        │
        │                              hifz_router.stream_attempt
        │                                        │ ticket 60s / _attempt_or_404
        │                              SherpaPhonemeStream (lazy، 73MB)
        │                                        │ is_ready-gated decode
        │                              LiveSession.feed_phonemes
        │                                        │ ordered_quran_phonemes.json
        │                                        │ + Tanzil (quran-uthmani)
        ▼                                        ▼
QuranHifzStudy.tsx ◀── word/extra/located/final ── رویداد کلمه‌ای (بدون seq)
        │  رندر خطی QPC1 (quran-mushaf-lines.json، ۶۰۴ صفحه)
        │  + tajweed حرف‌به‌حرف (quran-tajweed.ts)
        │  + listen (quran-listen.ts / Quran.com v4 segments یا interpolated)
        │
        └── ضبطی: MediaRecorder → OfflineAudioContext 16k → POST grade/grade-word
                (Zipformer یا Whisper-quran از CRM؛ بدون fallback)
```

**نقاط شکنندهٔ معماری (خلاصه):** نرخ نمونه‌برداری در مسیر زنده تضمین نشده (R-01)؛ readiness موتور در قرارداد WebSocket نیست (R-02)؛ رویداد کلمه‌ای بدون ترتیب/تکرارپذیری است (R-04)؛ شمارش موقعیتی خط چاپی در برابر ۞ آسیب‌پذیر است (R-03)؛ نگاشت خارجی ۵۱+ آیه را پوشش نمی‌دهد و بارگذاری‌اش ۲۲۷ ثانیه است (R-09)؛ موبایل اصلاً حفاظ ندارد (R-16).
