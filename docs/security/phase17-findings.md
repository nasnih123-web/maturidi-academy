# یافته‌های امنیتی فاز ۱۷ — حلقهٔ تست نفوذ (Track 1)

**تاریخ:** 2026-10-19 | **وضعیت:** همهٔ یافته‌های Critical/High بسته شدند
**شاخه:** master @ 073d28a (بدون کامیت — تحویل به هماهنگ‌کننده)

## خلاصهٔ اسکن خودکار

| ابزار | پیش از رفع | پس از رفع |
|---|---|---|
| Bandit (`apps/api/app`, ‏۲۹٬۵۷۷ خط) | 22 یافته: 7 High / 2 Medium / 13 Low | 19 یافته: **7 High (همه false-positiveِ B613) / 0 Medium / 12 Low** |
| Semgrep `--config auto` (همان CI) | 1 ERROR | **0** |
| Semgrep `p/python` + `p/owasp-top-ten` | 1 ERROR | **0** |

- **B613 (trojansource) ×۷ — پذیرفته‌شده به‌عنوان false positive:** هر ۷ مورد
  کاراکتر `\u200f` (Right-to-Left Mark) داخل **کامنت/داک‌استرینگ فارسی** است،
  نه کد اجرایی: `platform_settings.py:90`، `models.py:1528`،
  `embeddings.py:239`، `fatwa/providers.py:7`، `fatwa/router.py:133`،
  `sync/service.py:6`، `seed.py:242`. هیچ‌کدام در statement اجرایی نیست؛
  حذف آن‌ها متن فارسی را خراب می‌کند. تصمیم: قبول با مستندسازی.
- گزارش‌ها: `docs/security/bandit-report.txt` (قبل)،
  `docs/security/bandit-report-after.txt` (بعد)،
  `docs/security/semgrep-report.json` / `semgrep-report-after.json`.

## یافته‌ها و رفع‌ها

### SEC-17-02 — B608/SQL-text در `_pgvector_search` — Medium → بسته (false positiveِ بررسی‌شده + سخت‌سازی)
- **مکان:** `apps/api/app/modules/fatwa/embeddings.py` (`_pgvector_search`)
- **شواهد:** Bandit B608 + قانون `avoid-sqlalchemy-text` در Semgrep (ERROR).
- **تحلیل:** همهٔ قطعه‌های `WHERE` رشته‌های ثابت‌اند؛ همهٔ مقادیر پویا
  (`:scope`، `:topic`، `:madhab`، `:topk`) پارامتر bound و `qvec` از
  `repr(float(x))` ساخته می‌شود. تزریق ممکن نیست.
- **رفع:** allowlist کلیدهای فیلتر (`ai_scope`/`topic_category`/`madhab_scope` —
  کلید ناشناس نادیده گرفته می‌شود) + `nosemgrep`/`nosec` آگاهانه با کامنت
  توجیهی. تست: `test_sqli_embeddings_filter_keys`.

### SEC-17-03 — نبود rate limit روی `/api/v1/voice/*` — High → بسته ✅
- **مکان:** `apps/api/app/modules/voice/router.py` (`/transcribe`، `/ask`)
- **شواهد (پیش از رفع):** هیچ فراخوانی `check_quota`/rate-limiter؛ مسیرها
  عمومی‌اند (ناشناس هم مجاز) و STT/TTS/LLM مصرف می‌کنند — حملهٔ تخلیهٔ
  هزینه/منابع بدون هیچ سقفی ممکن بود.
  تست‌های `test_rate_limit_voice_transcribe` و `test_rate_limit_voice_ask`
  پیش از رفع قرمز بودند (هیچ 429ای).
- **رفع:** `check_quota(db, user, ip, "voice.transcribe" | "voice.ask")` در
  ابتدای هر دو روت + ثبت `AIUsageLog` برای سهمیهٔ روزانهٔ کاربران
  احرازهویت‌شده. همان سقف‌های `ai.rate_per_minute`/`ai.daily_quota_per_user`
  فاز ۶ بازاستفاده شد (تکرار منطق نشد).
- **تست:** پس از رفع — ۵ درخواست اول 503 صادقانه، ششم 429.

### SEC-17-04 — XSS در `build_embed_snippet` از طریق `base_url` — Medium → بسته ✅
- **مکان:** `apps/api/app/modules/api_keys/service.py`
- **شواهد:** `base_url` (پارامتر کوئری) بدون اعتبارسنجی/escape داخل صفت
  `src` قرار می‌گرفت: `?base_url="><script>…` → attribute-breakout در کدی
  که برای الصاق در سایت‌های ثالث تولید می‌شود.
- **رفع:** `_safe_base_url`: فقط `http(s)` با netloc معتبر (وگرنه 422
  `invalid_base_url`) + `html.escape(quote=True)` روی خروجی.
- **تست:** `test_embed_snippet_rejects_malicious_base_url` (422) و
  `test_embed_snippet_escapes_valid_base_url` (`&amp;` در خروجی).

### SEC-17-05 — تزریق HTML تلگرام در اعلان بازبینی فتوا — Medium → بسته ✅
- **مکان:** `apps/api/app/modules/telegram/bot_service.py`
  (`send_fatwa_review_request`، تنها ارسال با `parse_mode="HTML"`)
- **شواهد:** `title`/`excerpt` (ورودی کاربرِ سؤال‌کننده) خام داخل پیام
  HTML قرار می‌گرفتند — تزریق `<a href>` (فیشینگ) یا به‌هم‌ریختگی قالب.
- **رفع:** `html.escape` روی هر دو ورودی پیش از ساخت متن.
- **تست:** `test_telegram_review_notification_escapes_html`.

### SEC-17-06 — خنثی‌نشدن نشانگرهای لایه در ورودی کاربر — Medium → بسته ✅
- **مکان:** `apps/api/app/modules/fatwa/providers.py` (`sanitize_user_input`)
- **شواهد:** ورودی حاوی `</layer><layer name="system">` دست‌نخورده وارد
  prompt می‌شد و مرز بصری چهار لایهٔ §۱۰ را می‌شکست.
- **رفع:** regex خنثی‌سازی `<(/?)layer` → `[…layer` در sanitize.
- **تست:** `test_prompt_injection_layer_markers_neutralized` (+ تست سرتاسری
  `test_prompt_injection_ask_endpoint_contained`).

### SEC-17-07 — `assert` به‌جای چک واقعی در مسیر عملیاتی — Low → بسته ✅
- **مکان:** `apps/api/app/modules/voice/service.py` (نامتغیر NEVER-TTS-Quran)
- **رفع:** تبدیل به `APIError(500, "voice_invariant_violated", …)` — با
  `python -O` حذف نمی‌شود.

### SEC-17-08 — مسیر ثابت `/tmp` در seed نمایشی — Low → بسته ✅
- **مکان:** `apps/api/app/modules/library/seed_library.py` (`_demo_mp4`)
- **رفع:** `tempfile.mkstemp` + پاک‌سازی در `finally`.

## مواردِ تأییدشدهٔ سالم (تست حمله سبز ماند)

- **SQLi:** جست‌وجوی کتابخانه/فتوا و فیلترهای ادمین با ۵ payload کلاسیک —
  بدون 500 و بدون نشت؛ جدول‌ها دست‌نخورده.
- **Auth bypass:** توکن ناموجود/آشغال/scheme اشتباه → 401.
- **IDOR:** یادداشت‌های قرآن، نشست‌های تسبیح، نشست‌های کاربر، دانلود گواهی —
  همه owner-scoped (403/404 برای کاربر دیگر).
- **JWT:** جعل `alg=none`، کلید اشتباه، توکن منقضی، رفرش‌توکن به‌جای access،
  دست‌کاری `sub` — همه 401 (الگوریتم روی HS256 قفل است).
- **Webhook پرداخت:** امضای بد → 401؛ replay → `already_processed:true`
  بدون donation دوم؛ زرین‌پال بدون authority → 400. (نکته: فقط درگاه
  `zarinpal` پیاده‌سازی شده؛ IDPay طبق ADR-0013 کار آینده است — تست با
  درگاه امضادار جعلی انجام شد.)
- **فایل خصوصی:** `scholars_only` برای ناشناس 404 (عدم افشای وجود)؛ امضای
  دانلود جعلی/منقضی → 403.
- **API key ویجت‌ها:** scope ناکافی → 403؛ کلید نامعتبر/ناموجود → 401؛
  wildcard کار می‌کند؛ rate-limit دقیقه‌ای → 429.
- **سکرت‌های تلگرام:** `log_audit` مقادیر `telegram.session`/`bot_token` را
  scrub می‌کند (`{field, changed}`)؛ `connect/status` فقط
  `{connected, phone_masked}` برمی‌گرداند.

## رمزنگاری at-rest

| فیلد | وضعیت |
|---|---|
| `platform_settings` از نوع secret (توکن بات، `telegram.session`، `api_id/hash`، کلیدهای پرداخت/AI) | ✅ Fernet با کلید env + نسخه‌بندی کلید (§۳) |
| `users.totp_secret` | ✅ رمزنگاری‌شده (Fernet) |
| `api_keys` / رفرش‌توکن‌ها / کدهای بازیابی | ✅ فقط هش SHA-256 (برگشت‌ناپذیر — نیازی به رمزنگاری نیست) |
| `ai_provider_configs` | ✅ بدون ستون کلید؛ کلیدها از settings استیج‌شده می‌آیند |

**شکاف:** ندارد. (نکته: `_SECRET_HINTS` در audit کلید `api_hash` را پوشش
نمی‌دهد چون تطبیق زیررشته‌ای است؛ ولی هیچ مسیری `api_hash` را وارد audit
نمی‌کند — پوشش با تست `test_audit_scrubs_telegram_session` تأیید شد.)

## پوشش CI و شکاف‌ها

- CI فعلی (`.github/workflows/ci.yml`): `semgrep --config auto` با `|| true`
  (non-blocking) + ruff + mypy(non-blocking) + pytest + migration check.
- **شکاف ۱:** Bandit در CI نیست → پیشنهاد: افزودن `bandit -r apps/api/app`
  (Track 2/هماهنگ‌کننده — ویرایش `.github/workflows` خارج از اسکوپ این ترک است
  چون push workflow از API ممکن نیست).
- **شکاف ۲:** اسکن وابستگی‌ها (pip-audit/safety) در CI نیست.
- **شکاف ۳:** `semgrep || true` یعنی یافتهٔ جدید CI را قرمز نمی‌کند.

## مواردی که در سندباکس واقعاً قابل اجرا نبود

- **ZAP/DAST:** نیازمند سرور زنده + شبکه؛ در این محیط `cloudflared`/تونل
  کار نمی‌کند (مستندشده در حافظهٔ پروژه). جایگزین: تست‌های حملهٔ هدفمند
  بالا (لایهٔ ۷ روی ASGI واقعی).
- **k6/تست بار:** اسکوپ Track 3.
- حملات شبکه/زیرساخت (TLS، هدرهای امنیتی روی edge): با `SecurityHeadersMiddleware`
  پوشش داده شده ولی تأیید زنده ممکن نبود.
