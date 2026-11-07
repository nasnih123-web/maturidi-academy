# فاز ۸ — Native Mobile Hifz (React Native/Expo) — یادداشت

- تاریخ: ۲۰۲۶-۱۱-۰۷
- Worktree: `~/workspace/quran-hifz-parity`، شاخهٔ `feature/hifz-tarteel-parity`، مبنا main `47a50261` (مرج PR #114)
- قاعدهٔ کار: فقط پوشهٔ `apps/mobile` تغییر کرده است؛ هیچ مرج/دیپلویی انجام نشده؛ کامیت با هماهنگ‌کننده است.
- مرجع‌ها: `hifz-architecture.md`، `hifz-risk-register.md` (به‌ویژه R-15)، `hifz-phase0-baseline.md`، و قرارداد نسخه‌دار فاز ۵ (`apps/api/app/modules/quran/hifz_ws_contract.py`).

## ۱. ممیزی معماری واقعی اپ موبایل (وضعیت پیش از فاز ۸)

| بخش | وضعیت واقعی |
|---|---|
| Routing | Expo Router نیست؛ React Navigation (bottom tabs + native-stack). استک قرآن: `QuranHome` (فهرست سوره‌ها) → `Surah` (آیات + یادداشت). هیچ مسیر حفاظی نبود. |
| Audio permissions | هیچ مجوزی برای میکروفون نبود؛ `app.json` فقط `RECEIVE_BOOT_COMPLETED`/`VIBRATE`/`SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`/`POST_NOTIFICATIONS` داشت. |
| Native modules | هیچ ماژول صوتی نبود (`expo-av`/`expo-audio` نصب نبود). |
| Build profile | Expo SDK 58 (managed workflow)؛ `eas.json` چهار پروفایل (development/preview/production/production-apk)؛ `EXPO_PUBLIC_API_URL` در production اجباری و غیرlocalhost است (`app.config.js`). |
| API client | `src/lib/api.ts`: توکن کوتاه‌مدت + refresh چرخشی (یک refresh برای 401های هم‌زمان)، پاکت خطای یکنواخت بک‌اند؛ ولی multipart نداشت. |
| Quran | فقط خواندن: `services/quran.ts` (فهرست سوره/جزئیات/یادداشت‌ها با کش آفلاین SQLite) + `hooks/useQuran.ts` + `screens/QuranScreens.tsx`. جست‌وجوی `hifz` در هر سه فایل **صفر** نتیجه بود (R-15 تأیید شد). |
| تست | هیچ test runnerای در `apps/mobile` نبود (نه jest، نه script تست). CI موبایل فقط `npm ci` + `npm run typecheck` + `npx expo config` است. |
| `node_modules` | در شروع فاز خالی بود (۰ فایل)؛ با `npm install` از lockfile نصب شد. |

## ۲. چه ساخته شد

### ۲٫۱ صفحه/جریان Hifz بومی — `src/screens/HifzScreens.tsx` + `src/hooks/useHifz.ts`

- مسیر جدید `HifzStudy {number, nameAr, ayah?}` در استک قرآن (`RootNavigator.tsx`)؛ دکمهٔ «تمرین حفظ» در صفحهٔ هر سوره (`QuranScreens.tsx`).
- دو حالت، هر دو با میکروفون بومی:
  - **زنده (live):** میکروفون → قاب PCM16 مونو ۱۶kHz → WebSocket نسخهٔ ۲ → رویداد کلمه‌ای در لحظه.
  - **ضبطی (grade):** میکروفون → انباشت قاب‌ها → WAV ۱۶kHz مونو → `POST /grade` پس از توقف.
- انتخاب آیهٔ شروع: دکمه‌های قبلی/بعدی + ورودی عددی + «برو» (پاسخ به R-06 در موبایل؛ در جلسهٔ فعال قفل است).
- کلماتِ تمرین پیش‌فرض پنهان‌اند (مثل وب)؛ دکمهٔ «نمایش» (Peek) نخستین کلمهٔ پنهان را آشکار می‌کند و خطا ثبت می‌شود؛ «نمایش متن» همه را آشکار می‌کند.
- شمارنده‌های درست/نزدیک/غلط/جاافتاده + اضافه؛ ساعت جلسه (MM:SS) از مدت بومی ضبط؛ خط تشخیص (نرخ نمونه‌برداری، قاب ارسالی/ردشده، کلمهٔ دریافتی، پرش ترتیب، موتور).
- کلمهٔ تازه‌شنیده‌شدهٔ زنده کاملاً آبی است (R-07، کلیپ ترتیل)؛ کلمه‌های قدیمی‌تر به رنگ نمره‌شان برمی‌گردند؛ `partial` (کلمهٔ در حال خوانده‌شدن) فقط یک قاب نقطه‌چین می‌گیرد و متن را آشکار نمی‌کند.
- پس از پایان زنده، جزئیات attempt از سرور خوانده می‌شود تا صفحه، حقیقتِ ذخیره‌شده را نشان دهد، نه فقط جریان زنده را.

### ۲٫۲ قرارداد WebSocket نسخهٔ ۲ (فاز ۵ وسط این فاز نهایی شد)

در میانهٔ فاز ۸، فاز ۵ قرارداد نسخه‌دار را در همان worktree نهایی کرد (`hifz_ws_contract.py` + `test_hifz_phase5_ws.py`، ۱۹ تست سبز — با همان venv فاز ۰ اجرا شد). کلاینت موبایل از ابتدا با قرارداد v2 نوشته شد (نه v1):

- `start`: `{"type":"start","surah":N,"ayah":M,"protocol_version":2,"audio":{"sample_rate":16000,"channels":1,"format":"pcm16le"}}`؛ فیلدهای ممنوع (user_id/attempt_id/owner/session_id) هرگز فرستاده نمی‌شوند.
- **Readiness واقعی (R-02 رفع‌شده در سرور):** سرور به‌ترتیب `session_started` → `engine_ready` → `audio_ready` → `listening` می‌فرستد. کلاینت فقط پس از `listening` «در حال گوش‌دادن» نشان می‌دهد و قاب می‌فرستد؛ پیش از آن هیچ قابی نمی‌فرستد (پس هیچ قابی pre-ready رد نمی‌شود). مهلت readiness ۶۰ ثانیه (ساخت مدل ۷۳ مگابایتی در نخستین نشست سرد).
- **قاب:** پروفایل سالم ۴۰۹۶ نمونه (۲۵۶ میلی‌ثانیه، ۸۱۹۲ بایت) در هر قاب، ~۴ قاب/ثانیه؛ سقف سرور ۶۴KiB و طول زوج؛ نرخ با سطل توکن (۵۰ قاب/ثانیه) محدود می‌شود.
- **رویدادها (پاکت v2):** `stable_word`/`final_word`/`skipped`/`wrong` (با `type:"word"` قدیمی و `confidence`)، `correction` (تصمیم بعدی برای همان خانه — **جایگزین** می‌شود، تکراری نمی‌ماند)، `partial` (فقط نشانگر کلمهٔ جاری، هرگز شمرده نمی‌شود)، `progress` (همگام‌سازی موقعیت/شمارنده‌ها)، `warning` (غیرکشنده: `hifz_frames_before_ready`، `hifz_rate_limited`، `hifz_audio_clipping`)، `error` (با `fatal`)، `final`، `session_ended` (دلیل `end`/`max_duration`/`cancel`/`disconnect`/`error`).
- Dedup با `event_id`؛ پرش `sequence_no` فقط گزارش می‌شود (سرور replay نمی‌کند).
- پایان: `{"type":"end"}` → ذخیره + `final` + بستن ۱۰۰۰؛ `{"type":"cancel"}` → بستن بدون ذخیره؛ قطع ناگهانی بدون هیچ‌کدام چیزی ذخیره نمی‌کند.
- **سازگاری عقب‌رو:** پارسر، رویدادهای بدون پاکتِ سرورِ قدیمی (v1) را هم می‌خواند و با dedup سطح خانه پوشش می‌دهد؛ پس اگر API دیپلوشده هنوز v1 باشد، کلاینت نمی‌شکند (فقط readiness/correction/partial را نمی‌گیرد).

### ۲٫۳ صوت بومی — `src/services/hifzAudio.ts` (`@siteed/audio-studio` 3.2.1)

- چرا این ماژول: `expo-audio` فقط در فایل ضبط می‌کند و قاب PCM خام نمی‌دهد (نه برای سوکت زنده کافی است، نه WAV ۱۶kHz مونو را در اندروید تضمین می‌کند — MediaRecorder خروجی WAV/PCM ندارد). `audio-studio` (جانشینِ نگهداری‌شدهٔ `@siteed/expo-audio-stream`، MIT) در هر دو پلتفرم PCM16 خام با نرخِ پیکربندی‌شده (۱۶٬۰۰۰ هرتز، مونو) استریم می‌کند — بدون resampling، بدون نرخ بومی نامعلوم (R-01: نرخ، درخواست نیست، اعمال‌شده است).
- یک ماژول برای هر دو مسیر: همان قاب‌ها یا به سوکت می‌روند یا انباشته و WAV می‌شوند؛ پس فرمت هر دو مسیر یکی است.
- مجوز: پلاگینِ ماژول در `app.json` (با متن فارسی `NSMicrophoneUsageDescription`) `RECORD_AUDIO` و توضیح میکروفون iOS را اضافه می‌کند؛ درخواستِ runtime پیش از هر ضبط انجام می‌شود و ردِ آن، جلسه را با پیام روشن تمام می‌کند، نه با جلسهٔ ساختگی.
- قطع (interruption: تماس، قطع مسیر، از دست‌رفتن focus): جلسه با همان قواعد پس‌زمینه پایان می‌یابد (زنده: `end` و ذخیره؛ ضبطی: دورریختن با پیام)؛ ضبطِ متوقف‌شده‌ای که هرگز ادامه پیدا نکند، «زنده» نشان داده نمی‌شود.
- ضبط ضبطی حداکثر ۵ دقیقه است (کران حافظه)؛ صوت گذراست: قاب‌ها فقط در حافظه‌اند؛ فایل WAV موقتِ grade بلافاصله پس از آپلود حذف می‌شود (در همهٔ مسیرها، با `finally`).

### ۲٫۴ REST — `src/services/hifz.ts` (+ `postForm` در `src/lib/api.ts`)

- `GET /status` (پیش از زنده: اگر موتور Whisper باشد، زنده سریع و با پیام روشن رد می‌شود — R-10؛ اگر نگاشت آماده نباشد هم همین‌طور)، `POST /attempts`، `GET /attempts/{id}`، `POST /grade` و `/grade-word` (multipart با فایل WAV)، `POST /peek`، `POST /complete`، `POST /api/v1/auth/ws-ticket`.
- `api.postForm` به `lib/api.ts` اضافه شد: همان چرخهٔ auth + تک-refresh 401، بدون `Content-Type: application/json` (boundary را fetch می‌گذارد).
- فایل WAV با API جدید `expo-file-system` ۵۸ (`File`/`Paths` — API قدیمی `cacheDirectory`/`writeAsStringAsync` در این نسخه حذف شده) نوشته می‌شود؛ سربرگ WAV پیش از آپلود با همان قوانین `validate_wav_16k_mono` بررسی می‌شود.

### ۲٫۵ فونت/مصحف موبایل — `assets/fonts/UthmanicHafs-v-3.0.ttf`

- همان فایل وب (`apps/web/public/fonts/UthmanicHafs-v-3.0.ttf`)، بدون تغییر، با SHA-256 ثبت‌شده در `THIRD_PARTY_NOTICES.md` مطابقت داده شد: `5c47602425fb4190327ae1a2e8ed2f53dceaf595d8ccc29ac32b8b209ad398` (۳۰۱٬۳۹۶ بایت؛ مجوز KFGQPC: استفاده/کپی/توزیع رایگان، بدون تغییر). در باندلِ export اندروید هم با همان هش پیدا شد.
- متن قرآن فقط با این فونت رندر می‌شود؛ تا وقتی فونت بار نشده، spinner است، نه متن با فونت رابط (متن قرآن هرگز با فونت عمومی رابط جایگزین نمی‌شود).
- رنگ تجوید حرف‌به‌حرف، پورتِ `apps/web/lib/quran-tajweed.ts` است (`src/lib/quranTajweed.ts` — منطق byte-identical به‌جز دو guard برای `noUncheckedIndexedAccess` موبایل؛ همان قوانینِ تأییدشده با کلیپ: سبز غنه/اخفا، آبی رای سنگین، صورتی مد، خاکستری وصل الف).
- متن از همان provider وب می‌آید (Tanzil عثمانی، `editions[0]`) و تقسیم کلمات whitespace است، دقیقاً مثل `word_index` سرور؛ چون لایهٔ `mushaf-lines` در موبایل نیست، جابه‌جایی ۞ (R-03) در موبایل نمی‌تواند رخ دهد: متنِ نمایش‌داده‌شده خودِ متنِ نمره‌دهی‌شده است.
- IndoPak / Digital Khatt V2 در موبایل هم مثل وب **نیست** (مجوز QUL نامشخص — `hifz-fonts-and-mushaf.md` §۶)؛ فقط پروفایل حفص/Madinah V2.

### ۲٫۶ مدیریت background/foreground و lifecycle

- رفتن به پس‌زمینه وسط جلسه: زنده → `end` (جلسهٔ جزئی ذخیره می‌شود)؛ ضبطی → توقف و دورریختن صوتِ نمره‌نگرفته با پیام؛ waiting_engine → `cancel`.
- سقف ۳۰ دقیقهٔ سرور: `session_ended` با دلیل `max_duration` → توقف ضبط و نمایش نتیجهٔ ذخیره‌شده.
- Unmount صفحه: `abort()` (ارسال `cancel` + بستن)؛ صوتِ ذخیره‌نشده باقی نمی‌ماند.

## ۳. فایل‌های تغییرکرده (فقط `apps/mobile`)

| فایل | تغییر |
|---|---|
| `package.json` / `package-lock.json` | افزودن `@siteed/audio-studio@^3.2.1` و `expo-font@^58.0.11`؛ حذف کپی تودرتوی `expo-font@58.0.9` (dedupe؛ تغییر دیگری نیست) + اسکریپت `test:hifz-protocol` |
| `app.json` | پلاگین `@siteed/audio-studio` با `NSMicrophoneUsageDescription` فارسی |
| `assets/fonts/UthmanicHafs-v-3.0.ttf` | جدید؛ کپیِ بدون تغییرِ فایل وب (هش بالا) |
| `src/lib/hifzProtocol.ts` | جدید؛ قرارداد v2 + WAV/base64 + dedup + تست‌پذیر خالص |
| `src/lib/hifzProtocol.test.mjs` | جدید؛ ۱۶ تست `node --test` |
| `src/lib/quranTajweed.ts` | جدید؛ پورت تجوید وب |
| `src/lib/api.ts` | افزودن `postForm` (multipart با auth/refresh) |
| `src/services/hifz.ts` | جدید؛ REST حفاظ + آپلود WAV موقت |
| `src/services/hifzAudio.ts` | جدید؛ هوک ضبط بومی (`useHifzAudioRecorder`) |
| `src/services/hifzLive.ts` | جدید؛ کلاینت WS v2 با readiness-gating |
| `src/hooks/useHifz.ts` | جدید؛ ماشین وضعیت جلسه |
| `src/screens/HifzScreens.tsx` | جدید؛ صفحهٔ مطالعهٔ حفاظ |
| `src/screens/QuranScreens.tsx` | دکمهٔ «تمرین حفظ» در صفحهٔ سوره |
| `src/navigation/RootNavigator.tsx` | مسیر `HifzStudy` در استک قرآن |
| `src/i18n/strings.ts` | بخش `hifz` (فارسی/عربی/انگلیسی) + `quran.hifzPractice` |

**دست‌نخورده (طبق دستور):** هیچ فایلی بیرون `apps/mobile` تغییر نکرده است. قرارداد shared وب/API در فاز ۵ تغییر کرد و کلاینت با آن سازگار شد؛ نیازی به اصلاح قرارداد نبود.
**توجه:** فایل‌های `apps/api/...` و `apps/web/...` که در `git status` دیده می‌شوند، کار فازهای موازی (۵ و وب) در همین worktree هستند، نه این فاز.

## ۴. راستی‌آزمایی (اعداد واقعی)

| بررسی | فرمان | نتیجه |
|---|---|---|
| تست پروتکل | `npm run test:hifz-protocol` | **۱۶ passed، ۰ failed** (v2 envelope، correction، partial، readiness، warning، session_ended، final، fallback v1، WAV، base64، سقف قاب، close codeها) |
| Typecheck موبایل | `npm run typecheck` | **exit 0، بدون خطا** (مبنا هم سبز بود) |
| تست قرارداد فاز ۵ (فقط خواندنی) | `pytest tests/test_hifz_phase5_ws.py` با venv فاز ۰ | **۱۹ passed** — قراردادی که کلاینت علیه آن نوشته شد، تأیید شده است |
| Expo config (آینهٔ CI) | `npx expo config --json` | **OK** (`آکادمی ماتریدی`؛ پلاگین audio-studio با متن فارسی دیده می‌شود) |
| Prebuild اندروید | `npx expo prebuild --platform android` (موقت؛ پس از بررسی حذف شد) | **OK**؛ `RECORD_AUDIO` در `AndroidManifest.xml` هست |
| Prebuild آی‌اواس | `npx expo prebuild --platform ios` (موقت؛ پس از بررسی حذف شد) | **OK**؛ `NSMicrophoneUsageDescription` فارسی در `Info.plist` هست |
| Autolinking بومی | `expo-modules-autolinking resolve --platform android` | `@siteed/audio-studio` و `expo-font` هر دو resolve می‌شوند |
| JS bundle اندروید | `npx expo export --platform android` | **OK** (باندل ۲٫۹MB؛ رشته‌های Hifz در باندل؛ فونت با هش `5c4760…` در assets خروجی) |
| Lint موبایل | — | اسکریپت lint در `apps/mobile` نیست (مثل مبنا)؛ انجام نشد |
| EAS build | — | **BLOCKED** — بیلد EAS نیازمند حساب/secretهای Expo و محیط ابری است و در sandbox ممکن نیست؛ هیچ ادعای buildای نشده است (به §۵) |

## ۵. BLOCKEDها + مراحل تست روی گوشی (POCO X5)

### BLOCKED-1 — تست روی گوشی Android واقعی (الزامی، ممکن نیست در sandbox)
هیچ شبیه‌ساز/دستگاه اندرویدی در sandbox نیست؛ `expo run:android` و EAS build هم نیازمند دستگاه/حساب‌اند. **هیچ‌کدام از رفتارهای زیر بدون گوشی تأیید نشده‌اند:** درخواست runtime مجوز میکروفون، شروع/توقف ضبط بومی، نرخ واقعی قاب‌ها (۲۵۶ms)، رسیدن `listening` و شروع جریان، شنیده‌شدن کلمه‌ها و رنگ‌گرفتن‌شان، Peek، خطاها، background/interruption، و رندر فونت UthmanicHafs روی صفحهٔ واقعی.

**مراحل تست روی POCO X5 (مدل گوشی: POCO X5 5G؛ اندرویدِ دستگاه را از Settings → About phone → Android version + Build ID بخوانید و در گزارش تست بنویسید):**
1. پیش‌نیاز: بیلد development (`npx expo run:android` با دستگاه متصل، یا APK پروفایل `preview` از EAS) + ورود به حساب کاربری + VPN روشن (دامنهٔ API بدون VPN از ایران باز نمی‌شود) + موتور CRM روی Zipformer.
2. **ناوبری:** قرآن → یک سوره → «تمرین حفظ» → صفحهٔ مطالعه باز می‌شود؛ متن با فونت مصحف (نه فونت رابط) دیده می‌شود؛ کلمات پنهان «···»‌اند.
3. **مجوز:** «شروع خواندن زنده» → دیالوگ میکروفون اندروید می‌آید → اجازه بدهید. رد کردن: پیام فارسی «دسترسی به میکروفون داده نشد» دیده می‌شود.
4. **زنده:** سورهٔ فاتحه، آیهٔ ۱ → «شروع خواندن زنده» → ابتدا «موتور در حال آماده‌شدن…» (waiting_engine)، بعد «در حال گوش‌دادن» → «بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ» را بخوانید → کلمه‌ها یکی‌یکی آبی (تازه‌ترین) و بعد سبز می‌شوند؛ شمارندهٔ درست بالا می‌رود؛ «پایان خواندن» → نتیجهٔ ذخیره‌شده می‌ماند.
5. **ضبطی:** حالت «ضبطی» → «شروع ضبط» → همان آیه را بخوانید → «توقف و نمره‌دهی» → «در حال نمره‌دهی…» → نمرهٔ کلمه‌ها با رنگ می‌آید.
6. **Peek:** در حالت پنهان، «نمایش» → فقط یک کلمه آشکار می‌شود (با قاب نارنجی)؛ دوباره زدن، کلمهٔ بعد را نشان می‌دهد.
7. **اشتباه‌خوانی:** یک کلمه را عمداً غلط بخوانید → قرمز می‌شود و اشاره‌گر جلو نمی‌رود (رفتار پرمیوم ترتیل)؛ یک کلمه را جا بیندازید → خاکستری می‌شود.
8. **خطاها:** حالت پرواز وسط جلسهٔ زنده → پیام قطع اتصال؛ موتور را در CRM روی Whisper بگذارید و زنده را شروع کنید → پیام روشن «Whisper زنده کار نمی‌کند».
9. **Background/interruption:** وسط جلسهٔ زنده، Home را بزنید (پس‌زمینه) → برگردید: جلسه پایان یافته و (برای زنده) نتیجهٔ جزئی ذخیره شده است؛ وسط ضبط، تماس دریافتی (یا پخش موسیقی دیگر) → جلسه با پیام قطع پایان می‌یابد.
10. **ساعت/تشخیص:** خط تشخیص زیر دکمه‌ها را بخوانید: `16000Hz`، شمار قاب ارسالی، کلمهٔ دریافتی، `zipformer`.

### BLOCKED-2 — EAS build
بیلد EAS در sandbox ممکن نیست (حساب Expo + secretها + runner ابری لازم است). `eas.json` دست نخورده است؛ پروفایل `preview` (APK داخلی، `EXPO_PUBLIC_API_URL` برابر `https://maturidi-academy-production.up.railway.app`) مسیر تست گوشی است. **iOS:** هیچ محیط/حساب Apple در sandbox نیست؛ بیلد و تست iOS کاملاً انجام نشده است (فقط prebuild و Info.plist بررسی شد).

### BLOCKED-3 — تست صوتی واقعی سرتاسر
نمره‌دهی واقعی (دقت Zipformer روی صدای کاربر، ۳×۳ قاری/سوره) فقط روی گوشی + API زنده ممکن است؛ تست‌های این فاز، قرارداد و فرمت را اثبات می‌کنند، نه دقت ASR را.

## ۶. تصمیم‌های ثبت‌شده برای هماهنگ‌کننده

1. **قرارداد v2 فاز ۵ وسط کار رسید و کلاینت با آن نوشته شد** (با fallback پارسر v1 برای سرورِ هنوزبه‌روزنشده). اگر API دیپلوشده هنوز v1 است، کلاینت کار می‌کند ولی readiness/correction/partial را نمی‌بیند — پس از دیپلوی فاز ۵، تست گوشی باید دوباره با همان سناریوها انجام شود.
2. **قاب ۲۵۶ms (۴۰۹۶ نمونه)** انتخاب شد تا با پروفایل سالم v2 بخواند؛ قاب‌های کوتاه‌تر هم معتبرند ولی با پروفایل مستند نمی‌خوانند.
3. **ساعت جلسه از `durationMs` بومی ضبط** می‌آید، نه از تایمر JS.
4. **Peek موبایل = وب:** فقط کلمهٔ جاریِ ننوشته؛ رفتار ترتیل همچنان تأییدنشده است (R-05 — با فیلم ترتیل بررسی شود).
5. **شروع از وسط سوره** با انتخاب آیه حل شد (R-06 در موبایل)؛ ولی «شروع از وسط» در جریان زنده یعنی `start` با همان آیه — سرور از همان‌جا تطابق می‌دهد.
6. **رنگ کلمهٔ تازه آبی است** (R-07)؛ اگر کاربر از روی کلیپ، رنگ دیگری تأیید کرد، یک خط در `HifzScreens.tsx` عوض می‌شود.
7. **بدون mock data:** هیچ کلمه/نمرهٔ ساختگی در کد نیست؛ همهٔ نمره‌ها از سرور می‌آیند. تست‌ها فقط قرارداد/فرمت را با دادهٔ مصنوعیِ صریحِ تست بررسی می‌کنند، نه به‌عنوان دادهٔ واقعی.
8. **نیازمند تصمیم هماهنگ‌کننده (بیرون `apps/mobile`):** هیچ‌کدام — قرارداد shared نیازی به اصلاح نداشت.

## ۷. سطح قابلیت موبایل (L0–L5)

- **L0 — هیچ حفاظی در موبایل:** وضعیت پیش از این فاز (R-15).
- **L1 — صفحهٔ مطالعهٔ بومی:** متن مصحف + فونت محلی + پنهان‌سازی/Peek + ناوبری آیه — **انجام شد (کد؛ تست گوشی بدهکار).**
- **L2 — ضبط-سپس-نمرهٔ بومی:** میکروفون بومی + WAV ۱۶kHz + `POST /grade` — **انجام شد (کد؛ تست گوشی بدهکار).**
- **L3 — خواندن زنده:** WS v2 + readiness واقعی + correction + partial + progress — **انجام شد (کد؛ تست گوشی بدهکار).**
- **L4 — کنترل جلسه و ایمنی:** Peek، پایان/لغو، background/interruption، هشدارهای غیرکشنده، خطاهای روشن، تشخیص — **انجام شد (کد؛ تست گوشی بدهکار).**
- **L5 — تأییدشده روی گوشی واقعی و آمادهٔ انتشار:** **BLOCKED** — نیازمند تست POCO X5 (§۵) + بیلد EAS + (برای iOS) محیط/حساب Apple.

**جمع‌بندی:** موبایل از L0 به **L4 (کد کامل، بدون تأیید دستگاه)** رسید؛ L5 فقط با تست گوشی و بیلد EAS باز می‌شود.
