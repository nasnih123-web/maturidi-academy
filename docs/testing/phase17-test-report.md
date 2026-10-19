# گزارش تست — فاز ۱۷ (Track 2: Testing)

- **تاریخ:** 2026-10-19
- **نتیجهٔ نهایی سوئیت:** ‏411 passed‏ + ‏3 xfailed‏ (در ۱۴:۳۰)؛ تک‌خطای flaky
  زمان‌بندی وب‌سوکت (`test_realtime.py::test_ws_subscribe_and_receive`) در اجرای
  جداگانه ۱۲/۱۲ سبز است و به این ترک ربطی ندارد.
- **تست‌های جدید این ترک:** ۳۹ (۳۶ سبز + ۳ xfail مستند)
- **tsc:** وب و CRM سبز | **بیلد وب:** سبز

## ۱) فایل‌های تست جدید (`apps/api/tests/`)

| فایل | تعداد | پوشش |
|---|---|---|
| `test_phase17_fiqh_golden.py` | ۱۲ | golden vectorهای ارث/زکات روی فیکسچر synthetic (TEST) + پین digest + قطعی‌بودن + خلوص موتور (بدون import از app) + گیت نسخه در API |
| `test_phase17_rag_eval.py` | ۸ | eval set قطعی RAG: پرسش شناخته‌شده → chunk موردانتظار، اعتبار قالب استناد، draft هرگز بازیابی نمی‌شود، گیت scope، خارج از KB → «نمی‌دانم» (سه‌زبان)، بدون LLM هیچ متنی ساخته نمی‌شود |
| `test_phase17_webhook_replay.py` | ۴ | وبهوک جلوتر از نیت (404)، مبلغ دست‌کاری‌شده → حقیقت سمت‌سرور، طوفان ۱۲تایی retry → دقیقاً یک ثبت، وبهوک بعد از کال‌بک |
| `test_phase17_sync_conflicts.py` | ۵ | مسابقهٔ حذف/ویرایش یادداشت → تعارض (هر دو نسخه)، احیای صریح، تاریخچهٔ حل تعارض، پیوستگی کرسر pull، طوفان ۲۰تایی push → یک changelog |
| `test_phase17_gdpr.py` | ۴+۳ | export واقعی (پروفایل/نشست/رضایت/ترجیحات، بدون secret) + حذف واقعی (راستی‌آزمایی در DB)؛ ۳ شکاف export به‌صورت xfail مستند |
| `test_phase17_e2e.py` | ۲ | سفر سرتاسری: ثبت‌نام → خانه → فتوا → هم‌گروهی → اهدای موک → رسید PDF |
| `test_phase17_a11y.py` | ۱ | خط لولهٔ axe-core — آستانه: صفر تخلف Critical |

## ۲) دسترس‌پذیری (جزئیات: `docs/testing/a11y-phase17.md`)

- axe-core 4.10.2 روی ۵ صفحه (home/fatwa/donate/login/library) از طریق
  `apps/web/scripts/a11y/run.mjs` (بیلد production + mirror + CDP).
- قبل از رفع: ۰ Critical/Serious، چند moderate (`region`، `heading-order`).
- رفع‌شده (غیربصری): skip-link به داخل `<header>`، `role="region"` برای نوار
  اذان، سطوح عنوان فوتر (`h3→h2`، `h4→h3`) و empty-stateها (`h3→h2`).
- بعد از رفع: **صفر تخلف در هر ۵ صفحه** (home: ۴۳ قانون موفق، بقیه ۴۱–۴۳).

## ۳) GDPR واقعی

- `POST /users/me/export`: پروفایل، نشست‌ها (≥۱)، رضایت‌های terms/privacy،
  ۱۵ ترجیح اعلان؛ بدون `password_hash`؛ رویداد `user.data_exported` + audit.
- `DELETE /users/me`: در DB راستی‌آزمایی شد — `email/phone` به NULL، نام به
  «حساب حذف‌شده»، `is_active/is_verified=false`، `totp_secret` پاک، همهٔ
  refresh tokenها و sessionها revoke؛ audit (`user.delete`) و رویداد دامنه
  (`user.deleted`) بدون دادهٔ شخصی می‌مانند (تصمیم طراحی مستند).
- **شکاف‌های واقعی (xfail صریح برای Track 1):**
  - `GAP-P17-GDPR-1`: export شامل `fatwa_sessions`/messages نیست
  - `GAP-P17-GDPR-2`: export شامل یادداشت‌های قرآن نیست
  - `GAP-P17-GDPR-3`: export شامل اهداها/رسیدها نیست

## ۴) یافته‌های رفتاری (نه باگ، ولی ارزش مستندسازی)

- وبهوک زرین‌پال بعد از کال‌بک موفق: چون `PaymentWebhookLog` فقط payload
  وبهوک را dedupe می‌کند، اولین وبهوک بعد از کال‌بک `processed` برمی‌گرداند
  (نه `duplicate`) — ولی `_finalize_success` re-entrant است و donation دوم
  ساخته نمی‌شود. رفتار در تست پین شده است.

## ۵) موارد اجراشده در sandbox (صادقانه)

- ✅ pytest کامل (۴۱۱ سبز)، tsc وب/CRM، `next build`، axe واقعی با Chromium
- ✅ E2E با زرین‌پال موک‌شده (hermetic)
- ⚠️ k6/بار چند هزار session، ZAP، رزمایش DR واقعی، staging واقعی — در scope
  ترک‌های دیگر فاز ۱۷ است، نه Track 2
- ⚠️ اسکن axe برای صفحات نیازمند لاگین و CRM انجام نشد (کار آینده — در
  `docs/testing/a11y-phase17.md` ثبت شد)

## ۶) اسکرین‌شات‌ها (`~/workspace/your_files/maturidi-academy/`)

- `phase17-pytest-final.png` — نتیجهٔ نهایی سوئیت
- `phase17-a11y.png` — خلاصهٔ نتایج axe
- `phase17-e2e.png` — گام‌های سفر سرتاسری
