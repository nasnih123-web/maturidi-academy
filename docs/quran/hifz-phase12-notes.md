# یادداشت فاز ۱۲ — «برابری حفاظ با ترتیل»: QA کامل و رگرسیون

تاریخ: ۲۰۲۶-۱۱-۰۷ · شاخهٔ کاری: `feature/hifz-tarteel-parity`، worktree ‏`~/workspace/quran-hifz-parity` · مبنا main ‏`47a50261` (مرج PR #114).
همهٔ گزارش‌ها فارسی‌اند. **هیچ مرج/دیپلویی در این فاز انجام نشد و هیچ کامیتی زده نشد** — کامیت با هماهنگ‌کننده است.

## ۱. تست‌ها و نتایج

### pytest کامل API
- فرمان: `cd apps/api && QURAN_PHONEME_MAP_DIR=/home/hatch/workspace/hifz-voice-test/phoneme ~/workspace/overnight/.venv-item/bin/python -m pytest -q -p no:cacheprovider`
- نتیجه: **۱۱۱۴ passed / ۴ skipped / ۰ failed** در ۷۳۴٫۲۷ ثانیه (۷۴۴ warning).
- مبنای پس از فاز ۱۱ هم ۱۱۱۴/۴ بود — **بدون رگرسیون**. (مبنای فاز ۰: ۱۰۳۳ passed / ۶ skipped.)
- اجرای نهایی پس از همهٔ اصلاح‌های این فاز (بستنِ دوبارهٔ `serve_stream` + تست purge مستقل از ترتیب): **۱۱۲۲ passed / ۴ skipped / ۰ failed** در ۶۰۲٫۷۹ ثانیه (۷۵۱ warning) — یعنی ۱۱۱۴ قبلی + ۸ تست تازهٔ فاز ۱۲. لاگ در `.phase12-logs/pytest-full3.log`.

### تست صوتی واقعی — فاتحهٔ کاربر
- اسکریپت تطبیق‌یافته با کد همین worktree: `~/workspace/hifz-voice-test/run_voice_test_phase12.py` (اسکریپت‌های قدیمی به worktreeهای `quran-hifz-resync` و `quran-hifz-locate` اشاره می‌کردند).
- نتیجه: **finish_counts = ۲۵ درست / ۴ نزدیک / ۰ غلط / ۰ جاافتاده، ۱۲۱ توکن** — دقیقاً مثل مرجع `result-waslah.json`.
- خروجی: `~/workspace/hifz-voice-test/result-voice-phase12.json` و `tokens-voice-phase12.json`.

### تست locate — کهف ۱۱۰
- اسکریپت: `~/workspace/hifz-voice-test/run_locate_test_phase12.py`؛ بارگذاری نگاشت ۳۵۳٫۸ ثانیه.
- بخش A (فاتحه، locating=ON): live ‏۲۵ درست / ۴ نزدیک؛ finish ‏۲۵/۴/۰/۰؛ located=0.
- بخش B (کهف ۱۱۰، hint=1): live ‏۲۴ درست / ۱ جاافتاده؛ **located=1 به آیهٔ ۱۱۰**، heard_ayahs=[110]؛ finish ‏۲۴ درست / ۰ نزدیک / ۰ غلط / ۱ جاافتاده — دقیقاً مثل مرجع.
- خروجی: `~/workspace/hifz-voice-test/result-locate-phase12.json`.

### زیرمجموعهٔ hifz + تست‌های تازهٔ فاز ۱۲
- فرمان: همان env؛ ۱۰ فایل hifz (`test_hifz_assets.py`، `test_hifz_mapping.py`، `test_hifz_phase10.py`، `test_hifz_phase11_security.py`، `test_hifz_phase3.py`، `test_hifz_phase5_ws.py`، `test_hifz_phase6_alignment.py`، `test_hifz_phoneme_grade.py`، `test_hifz_stream.py` + `test_hifz_phase12_regression.py` تازه).
- **نکتهٔ اجرایی:** اجرای اولِ این زیرمجموعه بیش از ۳۷ دقیقه در `epoll_wait` گیر کرد (CPU ~۱۳٪، بدون پیشرفت)؛ هم‌زمان سرور stub فاز E2E روی پورت ۸۰۰۰ بالا و پایین می‌شد و چند اتصال TIME_WAIT به `127.0.0.1:8000` در جدول TCP آن فرایند دیده شد. علت قطعی ثابت نشد؛ فرایند با SIGTERM متوقف و زیرمجموعه **بدون هیچ سرور روی پورت ۸۰۰۰** از نو اجرا شد.
- نتیجهٔ نهایی: **۱۶۱ passed / ۰ failed** در ۲۷۶٫۶۳ ثانیه (۶۸ warning).
- فایل تازه `apps/api/tests/test_hifz_phase12_regression.py`: **۸ تست، هر ۸ پاس** (اجرای جداگانه: ۸ passed در ۵٫۵۵ ثانیه) — معافیت میدل‌ویر سقف بدنه، purge بلیط‌های WS، JWT با sid، بلیط با نشست، بلیط نامعتبر → ۴۴۰۱، `session_still_valid`، serve_stream با نشست باطل → ۴۴۰۱ و عدم feed، serve_stream با نشست سالم → feed و بستن ۱۰۰۰.
- **نکتهٔ اجرایی (دو اجرای ناتمام پیش از سبز شدن):** اجرای اول بیش از ۳۷ دقیقه در `epoll_wait` گیر کرد؛ علت قطعی ثابت نشد (تداخل احتمالی پورت ۸۰۰۰ با stub ‏E2E) و فرایند با SIGTERM متوقف شد. اجرای دوم (تمیز) در تست ۶۶ متوقف شد و با verbose مشخص شد علت دو تست تازهٔ serve_stream است (بخش ۲، «دو باگ تست + یک باگ واقعی»)، نه تداخل پورت. پس از اصلاح، اجرای سوم کامل سبز شد.

### Ruff
- `tools/check_ruff_baseline.py` → **PASS — دقیقاً روی baseline (۱۲۹ خطای شناخته‌شده، بدون افزایش).**

### tsc وب + CRM
- وب: exit 0؛ CRM: exit 0 (هر دو با symlink موقت node_modules؛ وب از `~/workspace/globe-fixes/apps/web/node_modules`، CRM از `~/workspace/articles-slider-editor/apps/crm/node_modules`؛ پس از اجرا symlinkها حذف و `apps/web/tsconfig.tsbuildinfo` با git checkout برگردانده شد).

### Alembic
- تک‌head: `2e6a9529d1a0`؛ upgrade از صفر روی `/tmp/p12-mig.db` تا head موفق؛ downgrade ‏-1 به `3718ca12e5c5`؛ ۶ جدول فاز ۱۰ حذف و ۳ جدول فاز ۳ (`hifz_attempts`، `hifz_word_scores`، `hifz_mistakes`) سالم ماندند.

### تست پروتکل موبایل + typecheck موبایل
- `npm run test:hifz-protocol` → **۲۱ passed / ۰ failed** (۱۶ قبلی + ۵ تازه).
- `npm run typecheck` → **exit 0، بدون خطا** (پس از یک اصلاح import گمشدهٔ `HifzReadinessEvent`).

### پورت تجوید موبایل
- اسکریپت `/tmp/p12/check-mobile-tajweed.mjs` → ۲۰/۲۰ مورد کلمه + ممیزی کامل تنزیل (۸۲٬۲۶۰ کلمه) با شمارش‌های دقیقاً برابر فاز ۷ وب: gray ‏۲۷٬۴۵۶، darkblue ‏۵۱٬۲۷۶، lightorange ‏۱۲٬۸۶۹، yellow ‏۳۸٬۴۶۲، darkred ‏۴٬۱۷۵، lightblue ‏۹٬۹۷۰، green ‏۲۲٬۰۳۱، orangered ‏۴٬۷۲۸.

## ۲. رگرسیون‌های پیدا و رفع‌شده

### موبایل — ناسازگاری با قرارداد v2 نهایی
فایل‌ها: `apps/mobile/src/lib/hifzProtocol.ts`، `apps/mobile/src/services/hifzLive.ts`، `apps/mobile/src/hooks/useHifz.ts`.
- `needs_review` و `finality` روی رویداد کلمه/correction حفظ می‌شوند (فاز ۶؛ وب هم همین سیگنال را دارد ولی نمایش نمی‌دهد).
- **باگ واقعی:** `partial` با `retracted: true` پیش‌تر به‌اشتباه به‌عنوان کلمهٔ جاری نشان داده می‌شد؛ حالا پرچم می‌گیرد و useHifz فقط همان خانه را پاک می‌کند.
- رویدادهای `repeat`/`revisit` فاز ۶ که پیش‌تر در parser به null می‌رسیدند (ساکت حذف می‌شدند) حالا parse و در diag شمرده می‌شوند (`repeatCount`/`revisitCount`).
- readiness payload حفظ می‌شود (`engine`/`build_ms`/`warmup_ms`/`state`)؛ `engine` از `engine_ready` در useHifz ست می‌شود.
- `located` فیلد `surah`، `warning` فیلدهای `dropped`/`clipped_frames`، و `session_ended` فیلد `state` را گرفتند.
- `describeWsCloseCode(1011)` از `closed-1011` به `stream-error` تغییر کرد (۱۰۱۱ خطای عمومی استریم در `hifz_router.py` است)؛ `onclose` در hifzLive حالا reason سرور را ترجیح می‌دهد چون ۴۴۰۹ بین rate limiter و stream limiter (فاز ۱۱) مشترک است و reason (`hifz_rate_limited` در برابر `hifz_too_many_streams`) تفکیک می‌کند.
- تست قدیمی deepStrictEqual به کلیدهای `undefined` حساس بود؛ فیلدهای اختیاری فاز ۶ فقط وقتی سرور بفرستد اضافه می‌شوند. تست موجود `describeWsCloseCode(1011)` به‌روز شد.

### موبایل — همگام‌سازی تجوید (۸رنگ وب)
فایل‌ها: `apps/mobile/src/lib/quranTajweed.ts` (بازنویسی کامل از روی وب با guardهای `noUncheckedIndexedAccess`)، `apps/mobile/src/screens/HifzScreens.tsx` (نقشهٔ رنگ به‌روز شد).
- پالت ۸رنگ وب با hexهای وب: darkred `#8b0000`، orangered `#c2410c`، lightorange `#d97706`، yellow `#a16207`، green `#15803d`، lightblue `#0284c7`، darkblue `#1d4ed8`، gray `#57534e`.
- **اخفا دیگر رنگ نمی‌شود** (سبز قدیمی اشتباه بود).

### دو باگ تست + یک باگ واقعی در serve_stream (پیدا شده از اجرای زیرمجموعهٔ hifz)
1. **تست‌ها ساعت asyncio را منجمد می‌کردند:** هر دو تست serve_stream در آغاز `hifz_router.time.monotonic` را با تابعی patch می‌کردند که پس از ۲ فراخوانی همیشه ۱۰۰۰٫۰ برمی‌گرداند. اما `loop.time()` همان `time.monotonic` سراسری است؛ با منجمد شدن ساعت، تایمرهای `asyncio.sleep`/`wait_for` هرگز به موعد نمی‌رسند و `receive()` سوکت ساختگی (که `sleep(0.01)` دارد) برای همیشه می‌خوابد → تست `test_serve_stream_valid_session_keeps_flowing` بی‌نهایت hang می‌کرد (دو بار، هر بار در تست ۶۶ متوقف شد؛ CPU ~۰٪ و ۱ thread در `epoll_wait`). اصلاح تست: حذف patch سراسری؛ به‌جایش `LIVE_SESSION_REVALIDATION_SECONDS = 0` با monkeypatch روی ماژول `hifz_router` تا بررسی در نخستین تکرار حلقه انجام شود.
2. **تست revoke قاب را زودتر خورانده بود:** در تست باطل‌شده، قاب در تکرار اول خورانده می‌شد و بررسی دوره‌ای تازه در تکرار بعد آتش می‌گرفت، پس `recognizer.calls == 0` غلط بود. با بازهٔ ۰، بررسی پیش از خوراندن هر قاب انجام می‌شود.
3. **باگ واقعی در کد تولیدی (`hifz_router.py::serve_stream`):** وقتی نشست باطل می‌شد، حلقه درست رویداد `hifz_session_revoked` را می‌فرستاد و سوکت را با **۴۴۰۱** می‌بست و `return` می‌کرد — اما بلاک `finally` پس از آن **دوباره `close(1000)` می‌زد** و کد بستن را بازنویسی می‌کرد (روی سوکت واقعی، close دوم معمولاً no-op است و کلاینت همان ۴۴۰۱ را می‌بیند؛ روی سوکت ساختگی کد نهایی ۱۰۰۰ ثبت می‌شد و تست شکست می‌خورد). اصلاح: پرچم `_explicit_close` — پیش از هر بستنِ صریح با کد خطا (۴۴۰۱ ابطال، ۱۰۰۹ قاب بزرگ، ۴۴۰۹ rate-limit، ۴۴۰۴/۴۵۰۰ خطای API، ۱۰۱۱ خطای استریم) ست می‌شود و بستنِ نهاییِ `finally` فقط وقتی انجام می‌شود که بستنِ صریحی نبوده باشد. مسیرهای end/disconnect/cancel (با break) بی‌تغییر با ۱۰۰۰ بسته می‌شوند. پس از اصلاح: هر ۸ تست فایل رگرسیون پاس شدند.
4. **تست purge وابسته به ترتیب اجرا بود:** `test_purge_expired_ws_tickets` روی `n == 3` assert می‌کرد، ولی `purge_expired_ws_tickets` سراسری حذف می‌کند و دیتابیس تست session-scoped و مشترک است؛ در اجرای کامل، تست‌های قبلی ۵ بلیط منقضی به‌جا گذاشته بودند و purge ‏۸ ردیف پاک کرد (`assert 8 == 3`). اصلاح تست: شمارش دقیق فقط روی ردیف‌های خودِ تست با شناسه (۳ ردیف مرده حذف، ۲ ردیف زنده باقی) + ‏`n >= 3` برای شمارش سراسری. اجرای ترکیبی `test_auth.py` + `test_hifz_phase11_security.py` + `test_hifz_phase5_ws.py` + `test_hifz_phase12_regression.py`: ‏۵۰ passed.
5. **سه خطای F841 در همان فایل** (متغیرهای `expired_unused`/`expired_used`/`used_old` استفاده نمی‌شدند) با استفاده‌شدنِ آن‌ها در assertهای تازه رفع شد؛ Ruff دوباره روی baseline است.
1. **P1-6 پاک‌سازی بلیط WS:** `purge_expired_ws_tickets` (منقضی‌ها + مصرف‌شده‌های قدیمی‌تر از ۱ ساعت) + `run_ws_ticket_cleanup_loop` (ساعتی، الگوی `run_usage_flush_loop`) در `apps/api/app/modules/auth/service.py`؛ در `apps/api/app/main.py` lifespan ساخته و لغو می‌شود.
2. **P1-1 ابطال نشست وسط جریان:** `redeem_ws_ticket_with_session` در auth/service؛ `session_still_valid` (SELECT تازه، fail-open در خطای DB) + `_authenticate_with_session` + `authenticate_ws_with_session` در `apps/api/app/core/realtime.py` (تعریف قدیمی `_authenticate` حذف و به delegator تبدیل شد)؛ ثابت `LIVE_SESSION_REVALIDATION_SECONDS = 300` در `hifz_ws_contract.py`؛ `stream_attempt` در `hifz_router.py` نشست گره‌خورده را می‌گیرد و `serve_stream` پارامتر `auth_session_id` گرفت — هر ۵ دقیقه بررسی می‌کند؛ باطل‌شده → رویداد `hifz_session_revoked` + بستن ۴۴۰۱، بدون ذخیره (مثل قطع ناگهانی؛ همان الگوی rate-limit).
3. **P1-2 سقف بدنه:** `BodySizeLimitMiddleware` در `apps/api/app/core/middleware.py` چهار مسیر POST آپلود صوت حفاظ را از گیت Content-Length معاف می‌کند (regex: `^/api/v1/quran/hifz/attempts/[^/]+/grade(-word)?$`، `^/api/v1/quran/hifz/tests/[^/]+/questions/[^/]+/answer$`، `^/api/v1/quran/hifz/voice-search$`) تا سقف ۳۲MB خودشان (`read_capped_upload`، کد `hifz_audio_too_large`، `MAX_AUDIO_BYTES = 32MB` در `hifz_service.py`) اعمال شود؛ سقف سراسری ۱۰MB (`max_request_body_bytes` در config) برای بقیه دست نخورده.

### رگرسیون خارج از حفاظ — بررسی اولیه (بدون تغییر کد)
- `apps/web/messages/{fa,ar,en}.json`: فقط ۱۶۶ کلید اضافه در هر زبان + حذف `quran.hifzPeek` (فاز ۷، جایگزین `hifzPeekWord`/`hifzPeekAyah`)؛ هیچ کلید موجودی تغییر نکرده و هیچ ارجاع مانده‌ای به `hifzPeek` در کد وب نیست.
- `realtime.py` فقط `check_ws_origin` اضافه کرده. `globals.css` تغییراتش در محدودهٔ حفاظ/سربرگ/تجوید است.
- زیرمجموعه‌های مرتبط خارج از حفاظ (realtime/WS، قرآن عموم، صوت/ترجمه/تفسیر، auth/session، مایگریشن/infra) جداگانه اجرا شدند: **۱۳۸ passed / ۰ failed** (بخش ۱).

## ۳. E2E با Playwright (قرارداد UI — نه ASR واقعی)

- سرور stub: `/tmp/p12/stub_api.py` (aiohttp — نسخهٔ اول با websockets نوشته شد ولی پارسر HTTP آن هر درخواست دارای بدنه را رد می‌کند (`ValueError: unsupported request body`) و POST /attempts پاسخ خالی می‌داد؛ بازنویسی با aiohttp) + اسکریپت `/tmp/p12/e2e_hifz.py`. سرور dev وب با `next dev --webpack -p 3000`؛ پس از کار kill شد و `.next` + symlink موقت node_modules پاک شدند.
- متن فاتحه از تنزیل واقعی؛ WAV تستی ۳ ثانیه‌ای؛ readiness واقعی v2 با تأخیر ۰٫۳ ثانیه‌ای بین مراحل؛ شمارش فریم‌های باینری.
- نتیجه: **۱۴/۱۴ سناریو پاس، بدون SKIP**:
  - S1 شروع/توقف میکروفون: پیام start با `protocol_version: 2`، ayah=1؛ پیش از `listening` هیچ فریمی فرستاده نشد (۱۶٬۳۸۴ بایت فریم پس از listening)؛ توقف → `end` به سرور + آزادشدن track میکروفون (۱/۱).
  - S1b پایان از سمت سرور (`final` + `session_ended`/max_duration) → متن «خواندن زنده به پایان رسید» + آزادشدن میکروفون.
  - S2 کلمهٔ تکراری (همان event_id) حذف شد؛ correction جای همان خانه نشست؛ رویداد خارج از ترتیب (پرش sequence از ۶ به ۲۰) نمایش داده شد؛ بِسْمِ دقیقاً یک بار رندر شد.
  - S3 رنگ کلمهٔ درستِ تازه: `rgb(27, 122, 46)` (سبز #1b7a2e)؛ کلاس wrong حاضر؛ دکمهٔ میکروفون aria-label دارد؛ live region حاضر.
  - S4 حرکت آیه با کلمهٔ آیهٔ دیگر: ۱ → ۲ با همگام‌سازی `?ayah=2` در URL.
  - S5 شروع از آیهٔ دیگر: `?ayah=3` → پیام start با ayah=3.
  - S6 پنل خطا: شیت «خطاها» کلمهٔ غلط بِسْمِ را با «مورد انتظار» فهرست می‌کند.
  - S7 Peek: ‏POST `/peek` با بدنهٔ `{"surah": 1, "ayah": 1, "word_indices": [0]}` + یک عنصر `.hifz-word-peeked`.
  - S8 Listen: هایلایت با timing stub از بِسْمِ به کلمهٔ بعد پیش رفت.
  - S9a رد میکروفون (NotAllowedError) → پیام متمایز رد میکروفون.
  - S9b موتور در دسترس نیست → پیام + دکمهٔ میکروفون غیرفعال.
  - S9c آفلاین → بنر «اینترنت قطع است»؛ با بازگشت شبکه پاک شد.
  - S9d قطع ناگهانی WS (بستن ۱۰۱۱ از سمت سرور) → «اتصال به سرور قطع شد» + آزادشدن میکروفون.
  - S10 خروج/refresh هنگام ضبط: refresh و ناوبری بدون خطای JS تازه.
- یافته‌های E2E (جزئیات در گزارش نهایی):
  - کنترل زنده یک میکروفون شناور با aria-label است، نه دکمهٔ متنی؛ برچسب‌ها «شروع/پایان/لغو خواندن زنده» هستند.
  - `page.content()` برای اثبات نمایش برچسب قابل اعتماد نیست — رشته‌ها در payload ‏RSC داخل `<script>` هم هستند؛ بررسی‌ها با `innerText` انجام شد.
  - شیت خطا وقتی باز است روی میکروفون شناور را می‌پوشاند (برای توقف باید اول بسته شود)؛ ردیف‌های شیت قابل‌کلیک نیستند — ناوبری «کلیک روی خطا → رفتن به محل» در UI وجود ندارد.
  - listener ‏`page.on("request")` در Playwright درخواست‌های fetch پس از await در این صفحه را گزارش نمی‌کند (POST /peek با UA مرورگر به سرور رسید ولی هیچ request eventای نیامد)؛ در S7 مرجع حقیقت رکورد سمت سرور stub شد.
  - hydration mismatch در dev: سرور «اینترنت قطع است» رندر می‌کند و کلاینت دوباره رندر می‌کند (بج «2 Issues» در شات‌های dev دیده می‌شود) — آرتیفکت dev، در S10 فیلتر شد.

## ۴. Visual QA

- اسکرین‌شات‌ها در `~/workspace/quran-hifz-shots-parity/phase12/`: هاب در ۶ viewport (۳۶۰×۶۴۰، ۳۹۳×۸۵۲ POCO، ۴۳۰×۹۳۲، ۷۶۸×۱۰۲۴، ۱۲۸۰×۸۰۰، ۱۹۲۰×۱۰۸۰) + صفحهٔ مطالعه (idle/live/error-sheet) در POCO/لپ‌تاپ/دسکتاپ.
- صفحهٔ مطالعه (POCO و دسکتاپ): RTL درست، shaping درست، فاصله و ارتفاع خط سالم، نشان‌های ۸گلبرگی، pills «خطاها: ۱ / دقت: ۲ از ۳ / زمان: ۰:۰۱» درست؛ کلمات درستِ تثبیت‌شده تیره، کلمهٔ غلطِ تازه قرمز با زیرخط چین‌دار؛ میکروفون در حالت زنده مربع توقف سفید روی سبز؛ شیت خطا تمیز رندر می‌شود؛ هیچ overflow سراسری (scrollWidth == clientWidth در همهٔ viewportهای هاب؛ هیچ عنصر محتوایی از viewport بیرون نزد — فقط orbهای تزئینی و skip-link که by design بیرون‌اند).
- یافته‌های تصویری (جزئی):
  - **هاب، جدول روند روزانه در ۳۹۳px:** سرستون‌های «روند روزانه (۳۰ روز)»، «تمرین»، «کلمه‌های نمره‌داده‌شده» در کنار هم چسبیده/روی هم دیده می‌شوند (با دادهٔ خالی stub). نیازمند بررسی با دادهٔ واقعی.
  - فرم «برنامه‌ها» در هاب در موبایل بدون padding راست است — اینپوت‌ها دقیقاً تا لبهٔ viewport می‌رسند (R=393)؛ مقدارها کامل دیده می‌شوند ولی flush با لبه‌اند.
  - بخش «کلمات اضافه» در شیت خطا وقتی خالی است همان متن «خطایی ثبت نشده است.» را نشان می‌دهد (متن خالیِ مشترک با بخش کلمات غلط).
- مقایسهٔ تصویری با timecodeهای ویدئو در حد مشاهده: چیدمان صفحهٔ مطالعه (صفحهٔ مصحف سفید وسط، میکروفون سبز پایین-راست، pills بالا) با مرجع ترتیل هم‌خوان است؛ تست گوشی کاربر دروازهٔ پایانی است.

## ۵. موارد باز فاز ۱۱ (سند امنیتی)

- **اصلاح‌شده در این فاز:** P1-1 (ابطال نشست وسط جریان)، P1-2 (سقف بدنه)، P1-6 (پاک‌سازی بلیط WS). تست‌هایشان در `test_hifz_phase12_regression.py` است.
- **باز — نیازمند تصمیم کاربر:**
  - **P1-3:** سقف اتصال زنده درونِ فرایند است؛ در استقرار چندworker سقف مؤثر چند برابر می‌شود (limiter مشترک Redis لازم است).
  - **P1-4:** سیاست نگهداری (retention) دادهٔ غیرصوتی تعیین نشده (نامحدود تا حذف کاربر).
  - **P1-5:** حذفِ یک‌جای همهٔ دادهٔ حفظ وجود ندارد؛ ردیف‌های SRS هیچ endpoint حذفی ندارند.
- **P2 باز:** باقیماندهٔ فایل موقت صوت پس از مرگ فرایند؛ صف رویداد WS و فهرست `_events` بی‌سقف؛ FKهای مایگریشن فاز ۱۰ `NO ACTION`؛ حذف‌های سخت رکورد audit ندارند؛ پیام عمومی شروع جریان زنده مستقیم تست نشده است.
- **توجه:** تکلیف فاز از «۷ مورد P1 باز» گفت؛ سند امنیتی ۶ مورد P1 (۱–۶) + موارد P2 دارد — این اختلاف در گزارش نهایی شفاف شد.

## ۶. NOT RUN / BLOCKED

- **زیرمجموعهٔ hifz (اجرای اول):** بیش از ۳۷ دقیقه در `epoll_wait` گیر کرد؛ با SIGTERM متوقف شد (بخش ۱). اجرای تمیز در جریان است.
- **تست گوشی POCO X5 کاربر:** دروازهٔ پایانی — فقط کاربر می‌تواند ببندد (باز از PR #112 و #113: متن سوره با VPN ناپایدار، نبود SRS، تشخیص پس از خواندنِ اشتباه یک کلمه؛ مربع‌های خالی سربرگ مصحف؛ هم‌پوشانی سربرگ چسبان هنگام اسکرول؛ نمایش پس از کلیک «نمایش»).
- **تولید ویدیو:** ۴۰۳ و در دسترس نیست — تلاش نشد (محدودیت پایدار حساب).
- **پاک‌شدن /tmp در میانهٔ کار:** محیط در میانهٔ اجرای نهایی pytest کامل ری‌استارت شد و همهٔ فایل‌های `/tmp` (اسکریپت‌های stub و E2E، لاگ‌های pytest) پاک شدند. همهٔ نتایجِ ثبت‌شده در workspace سالم ماندند (اسکرین‌شات‌ها، خروجی‌های JSON تست صوتی، یادداشت فاز، کد). اسکریپت‌های stub و E2E از روی حافظهٔ جلسه در `.phase12-e2e/` (داخل worktree) بازسازی شدند — همان نسخهٔ اجراشده؛ لاگ اجرای کامل نهایی در `.phase12-logs/pytest-full3.log` است.
- **ClamAV:** به‌تصمیم کاربر defer شده — هیچ تغییری داده نشد.
