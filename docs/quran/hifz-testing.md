# تست حفاظ — روش، اجراها و نتایج (فارسی)

> مبنا: `feature/hifz-tarteel-parity` روی main ‏`47a50261`. این سند وضعیت تست را در لحظهٔ تحویل PR ثبت می‌کند؛ اعداد بدون اجرای واقعی ادعا نشده‌اند.

## ۱. Baseline (فاز ۰، پیش از هر تغییر)

| تست | فرمان | نتیجه |
|---|---|---|
| API pytest کامل | `cd apps/api && ~/workspace/overnight/.venv-item/bin/python -m pytest -q -p no:cacheprovider` | **۱۰۳۳ passed / ۶ skipped**، ۷۱۰ warning، ۳۷۳٫۹۸s، exit 0 |
| Ruff | `~/workspace/.venv-ruff/bin/python tools/check_ruff_baseline.py` | PASS — دقیقاً ۱۲۹ خطای شناخته‌شده |
| tsc وب | symlink موقت node_modules از `~/workspace/globe-fixes/apps/web/node_modules` | exit 0 |
| tsc CRM | symlink موقت node_modules از `~/workspace/articles-slider-editor/apps/crm/node_modules` | exit 0 |

## ۲. وضعیت نهایی (فاز ۱۲)

| تست | نتیجه |
|---|---|
| API pytest کامل (با `QURAN_PHONEME_MAP_DIR` تنظیم‌شده) | **۱۱۲۲ passed / ۴ skipped / ۰ failed**، ۶۰۲٫۷۹s، ۷۵۱ warning |
| زیرمجموعهٔ hifz (۱۰ فایل) | **۱۶۱ passed / ۰ failed** |
| زیرمجموعه‌های مرتبط خارج از حفاظ (۹ فایل: realtime، auth، quran phase5، recitation timing و…) | **۱۳۸ passed / ۰ failed** |
| تست‌های وب (node:test) | **۴۰ passed / ۰ failed** |
| تست پروتکل موبایل (`npm run test:hifz-protocol`) | **۲۱ passed / ۰ failed** |
| E2E با Playwright (قرارداد UI، با mock) | **۱۴/۱۴ پاس، بدون SKIP** |
| tsc وب + tsc CRM | هر دو exit 0 |
| typecheck موبایل | exit 0 |
| Ruff | PASS — دقیقاً روی baseline (۱۲۹) |
| Alembic | تک‌head ‏`2e6a9529d1a0`؛ upgrade از صفر + downgrade ‏-1 موفق |
| cargo test/check (دسکتاپ، لینوکس) | **۱۱/۱۱**، exit 0 |
| smoke دسکتاپ (لینوکس) | **۱۴/۱۴** |

رشد شمار تست از مبنا (۱۰۳۳) تا نهایی (۱۱۲۲) = ‏۸۹ تست تازه، بدون رگرسیون. هیچ تست شکست‌خورده‌ای حذف یا ضعیف نشد.

## ۳. تست صوتی واقعی (مدل واقعی، صدای واقعی کاربر)

- **فاتحه (۴۴٫۵ ثانیه، ۲۹ کلمه، ۱۲۱ توکن):** **۲۵ درست / ۴ نزدیک / ۰ غلط / ۰ جاافتاده** — دقیقاً مثل مرجع `result-waslah.json`؛ پس از همهٔ تغییرات بدون رگرسیون. نتایج: `~/workspace/hifz-voice-test/result-voice-phase12.json`.
- **locate کهف ۱۱۰:** **۲۴ درست / ۱ جاافتاده، `located=1` به آیهٔ ۱۱۰**. نتایج: `~/workspace/hifz-voice-test/result-locate-phase12.json`.
- **بازتولید عیب سورهٔ ۲۴ (فاز ۶):** پیش از اصلاح A ‏`6/135/21`؛ پس از اصلاح A ‏`4/18/1` و C ‏`13/21/2` (۱۳ درست دقیقاً ۱۳ کلمهٔ ۲۴:۱؛ اشاره‌گر هرگز از آیهٔ ۲ بیرون نرفت). سناریوها به‌عنوان ۳ تست واقعی در `test_hifz_phase6_alignment.py` ماندگار شدند.

## ۴. بنچمارک مدل

Abdou در برابر Zipformer روی همان فاتحهٔ کاربر — جزئیات کامل در `docs/quran/hifz-asr-benchmark.md`. نتیجه: Abdou مردود فنی است (WER ‏۵۵٫۱۷٪ کامل‌فایل، ۴۴٫۸۳٪ تکه‌تکه؛ توهم روی پنجره‌های کوتاه؛ بدون streaming). عدد WER ‏۴٫۴۹٪ صاحب مدل روی بنچمارک ۶۰۰ کلیپی تک‌آیه‌ای کوتاه است و به تلاوت پیوسته منتقل نمی‌شود.

## ۵. E2E (قرارداد UI — نه آزمون ASR)

۱۴ سناریو با Playwright و mock ‏WS/API: میکروفون، readiness، کلمهٔ تکراری/خارج از ترتیب، رنگ/لیبل، حرکت آیه، شروع از آیهٔ دیگر، پنل خطا، Peek، Listen، رد میکروفون/آفلاین/قطع WS/موتور در دسترس نیست، refresh/خروج هنگام ضبط. **۱۴/۱۴ پاس.** اسکریپت‌ها در `~/workspace/quran-hifz-shots-parity/phase12/evidence/.phase12-e2e/`.

E2E با mock فقط قرارداد UI را تأیید می‌کند؛ آزمون ASR واقعی نیست.

## ۶. Visual QA

- صفحهٔ مطالعه + هاب در ۶ viewport؛ RTL/shaping/فاصله/خط سالم، هیچ overflow سراسری. اسکرین‌شات‌ها در `~/workspace/quran-hifz-shots-parity/phase12/`.
- سربرگ موبایل (فاز ۷): ۵ viewport × ۲ صفحه، `scrollW == vw` در همه؛ پیش/پس در `~/workspace/quran-hifz-shots-parity/phase7-header/` (۴۰ PNG).

## ۷. رگرسیون خارج از حفاظ

فایل‌های shared تغییرکرده: `realtime.py`، `middleware.py`، `main.py`، `auth/service.py`، `messages/*`، `globals.css` — مصرف‌کننده‌هایشان تست شدند (۱۳۸ passed در ۹ فایل مرتبط). هیچ route/API/داده/رفتار عموم یا کودکان بازنویسی نشد.

## ۸. NOT RUN / BLOCKED (با دلیل)

| مورد | دلیل |
|---|---|
| اندازه‌گیری latency end-to-end روی دستگاه واقعی | نبود دستگاه/ابزار اندازه‌گیری در sandbox |
| تست گوشی POCO X5 | نبود دستگاه/شبیه‌ساز در sandbox — دروازهٔ پایانی کاربر |
| EAS build | نیازمند حساب/secretهای Expo و runner ابری |
| iOS | هیچ محیط/حساب Apple در sandbox نیست |
| macOS/Windows (دسکتاپ) | فقط لینوکس در sandbox تست شد |
| تست صوتی روی سرعت‌های مختلف تلاوت / قاریان متعدد | فقط یک فایل/یک قاری/یک سوره در دسترس بود |
