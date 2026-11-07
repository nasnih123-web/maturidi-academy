# پیاده‌سازی P1-3 / P1-4 / P1-5 — مأموریت تکمیلی بازطراحی حفاظ

> **شاخه:** `feature/hifz-tarteel-redesign`، سر `0a05deb` — **مرج نشده، دیپلوی نشده، PR ساخته نشده است.**
> **مبنا:** طراحی Wave-1 ‏`~/workspace/quran-hifz-completion/wave1/p1-investigation/p1-345-design-fa.md`
> **تاریخ:** ۲۰۲۶-۱۱-۰۷
> **زبان:** فارسی

---

## ۰. خلاصهٔ یک‌خطی

هر سه مورد پیاده و تست شده‌اند: limiter توزیع‌شدهٔ سقف زنده (فعال فقط با Redis + production)، سیاست نگهداری پیکربندی‌پذیر با پیش‌فرضِ همه‌خاموش، و حذف یک‌جای دادهٔ حفظ فقط در دامنهٔ `hifz_only` با همهٔ ایمنی‌ها. **هیچ‌کدام در production فعال/روشن نیستند مگر با تصمیم و اقدام صریح کاربر** — جزئیات در §۴.

## ۱. P1-3 — سقف اتصال زندهٔ توزیع‌شده

### ساخته‌ها

| فایل | چه شد |
|---|---|
| `apps/api/app/core/hifz_live_limiter.py` (تازه) | `DistributedLiveStreamLimiter` (یک ZSET ‏`hifz:live:sessions`، عضو `"{user_id}:{session_id}"`، امتیاز = انقضای lease) + `LiveStreamLimiterGateway` (دروازه: Redis وقتی هست، محلی وقتی نیست) + `live_lease_heartbeat` + `get_live_stream_limiter()` |
| `apps/api/app/core/config.py` | `hifz_live_max_per_user=1`، `hifz_live_max_total=4`، `hifz_live_lease_s=60`، `hifz_live_heartbeat_s=20`، `hifz_live_fail_closed=true` |
| `apps/api/app/modules/quran/hifz_ws_contract.py` | `LiveStreamLimiter.release_all(user_id)` + کامنتِ به‌روزِ سقف + نمونهٔ `live_stream_gateway` (روی همان `live_stream_limiter` سراسری) |
| `apps/api/app/modules/quran/hifz_router.py` | `stream_attempt` حالا از دروازه می‌گیرد؛ `hifz_too_many_streams` مثل قبل، `hifz_live_unavailable` تازه (۴۴۰۹)؛ تسک heartbeat هر اتصال (لغو در `finally`)؛ release از راه دروازه |
| `docs/ops/railway-deployment.md` | قید سفت «۱ replica / ۱ worker» بدون Redis + چک‌لیست فعال‌سازی |

### رفتار

- **acquire اتمیک (Lua):** جاروی leaseهای منقضی + شمارش کل و کاربر + ZADD در یک دستور؛ دو worker هم‌زمان نمی‌توانند هر دو «جا هست» ببینند. acquire تکراری برای همان نشست (همان `attempt_id`) عضو را تازه می‌کند، نه تکثیر.
- **heartbeat:** هر ۲۰ ثانیه `ZADD … XX` (فقط اگر عضو هنوز هست)؛ lease ‏۶۰ ثانیه‌ای یعنی اسلاتِ فرایندِ مرده حداکثر ۶۰ ثانیه بعد آزاد می‌شود.
- **قطع Redis:** اتصال‌های موجود **قطع نمی‌شوند** (heartbeat فقط warning می‌خورد)؛ اتصال‌های تازه در production رد می‌شوند (`UNAVAILABLE` → ‏`hifz_live_unavailable`) و در dev/test به limiter محلی برمی‌گردند. پس از بهبودی، شمارش معتبر از سر گرفته می‌شود؛ کلیدهای lease در دورهٔ قطع هرگز پاک نمی‌شوند. الگوی cooldown/probe ‏۳۰ ثانیه‌ای از `rate_limit.py` گرفته شده است.
- **فعال‌سازی (هر سه):** (الف) پلاگین Redis در Railway + ‏`REDIS_URL` روی api و همهٔ workerها؛ (ب) `APP_ENV=production`؛ (ج) تست‌های P1-3 سبز. **وضعیت زندهٔ Redis راستی‌آزمایی نشده است** (Railway CLI/توکن در sandbox نیست) و limiter توزیع‌شده در production فعال نیست — تا آن روز سقفِ محلی با قید «دقیقاً ۱ replica و ۱ worker» (وضعیت فعلی `start.sh` بدون `--workers`) درست است.

### نکتهٔ صداقت دربارهٔ تست

fakeredis در این venv دستور `EVAL` را پشتیبانی نمی‌کند (lupa نصب نیست)، پس مسیر Lua فقط روی Redis واقعی می‌رود. پیاده‌سازی در صورت `ResponseError` («unknown command eval») به مسیر fallback می‌رود: همان دستورهای ZSET با `asyncio.Lock` همین فرایند. اتمی‌بودنِ میان‌فرایندی فقط روی مسیر Lua تضمین می‌شود؛ fallback فقط برای تست/توسعه است و در production هرگز استفاده نمی‌شود (Redis واقعی `EVAL` دارد).

## ۲. P1-4 — سیاست نگهداری پیکربندی‌پذیر

### ساخته‌ها

| فایل | چه شد |
|---|---|
| `apps/api/app/core/platform_settings.py` | ۶ کلید تازه در `SETTING_DEFS` (درس PR #100) + اعتبارسنج `_validate_retention_days` (null یا int ‏۱ تا ۳۶۵۰؛ نوعِ اشتباه TypeError) |
| `apps/api/app/modules/quran/hifz_retention.py` (تازه) | `get_retention_policy` + `purge_expired_hifz_data` (dry-run + حذف واقعی، یک تراکنش) + `run_hifz_retention_loop` (روزانه، گذر اول dry-run) |
| `apps/api/app/main.py` | حلقه در lifespan (ساخت + لغو در خاموشی) |

### کلیدها و پیش‌فرض‌ها — همه null (نامحدود = حذف خودکار خاموش)

| کلید (`quran.hifz_retention.*`) | پیش‌فرض |
|---|---|
| `attempts_days` | `null` |
| `mistakes_days` | `null` |
| `tests_days` | `null` |
| `reviews_inactive_days` | `null` |
| `tasmi_days` | `null` |
| `plans_days` | `null` |

قانون «آزمون‌های تکمیل‌شده پس از ۳۰ روز» **فقط** به‌صورت یک قانونِ پیکربندی‌پذیرِ پیش‌فرض‌خاموش پیاده شده است — عدد ۳۰ هیچ‌جا hardcode نشده و هیچ حذفی بدون تصمیم صریح کاربر روشن نمی‌شود.

### ایمنی‌ها

فقط ردیف‌های **پایانی** مشمول‌اند (نشست/آزمون/تسمی/برنامهٔ `completed`؛ SRS فقط وقتی غیرفعال است)؛ ساعت انقضا = جدیدترینِ (`completed_at`، ‏`updated_at`، ‏`last_reviewed_at`)؛ نمرهٔ کلمه هرگز جدا حذف نمی‌شود (تابع نشست)؛ خطا فقط وقتی جدا حذف می‌شود که نشستش تکمیل شده باشد؛ ترجیح‌های کاربر هیچ انقضایی ندارند. هر اجرا فقط تعداد به‌تفکیک جدول را لاگ می‌کند.

## ۳. P1-5 — حذف یک‌جای دادهٔ حفظ (فقط `hifz_only`)

### ساخته‌ها

| فایل | چه شد |
|---|---|
| `apps/api/app/modules/quran/hifz_purge.py` (تازه) | `preview_hifz_data_counts` + `purge_hifz_data` (یک تراکنش، bulk deletes، audit فقط با تعداد) |
| `apps/api/app/modules/quran/hifz_schemas.py` | `HifzDataPurgeIn` (`extra="forbid"`) + `HifzDataPreviewOut` + `HifzDataPurgeOut` |
| `apps/api/app/modules/quran/hifz_router.py` | `GET /api/v1/quran/hifz/data/preview` + `POST /api/v1/quran/hifz/data/purge` (نرخ‌محدود: ۳ بار در ساعت به‌ازای هر نشست) |

### دامنه — فقط ۱۰ جدول (۹ + ترجیح‌ها)

`hifz_word_scores` → `hifz_mistakes` → `hifz_test_questions` → `hifz_plan_items` → `hifz_attempts` → `hifz_tests` → `hifz_plans` → `hifz_reviews` (SRS) → `hifz_tasmi_sessions` → `hifz_user_settings` (ترتیب فرزند→والد؛ هیچ FK حفاظ `CASCADE` ندارد).

### ایمنی‌ها

بدون `user_id` در ورودی (فقط کاربرِ توکن)؛ همهٔ حذف‌ها با فیلتر مالکیت؛ تراکنش واحد (هر خطا → rollback کامل)؛ پیش‌نمایش (فقط تعداد) بعد تأیید صریح (`confirm: true`)؛ `idempotency_key` (UUID) الزامی — فراخوانیِ دوباره روی دادهٔ خالی صفر برمی‌گرداند (idempotent)؛ audit ‏`hifz.data_purged` فقط با تعداد به‌تفکیک جدول (هرگز `heard`/`reflection`/عنوان برنامه) + رویداد `user.hifz_data_purged` با payload خالی؛ پیش از حذف، اسلات‌های زندهٔ کاربر از limiter آزاد می‌شوند (best-effort)؛ نرخ‌محدود ۳/ساعت. دامنهٔ `quran_all` (یادداشت/ذکر) **ساخته نشده است** — فرستادن `scope` در body ‏۴۲۲ می‌گیرد.

### یافته‌های جانبی (مستند، بدون تغییر)

- `delete_account` دادهٔ حفظ را پاک نمی‌کند (فقط ناشناس می‌کند)؛ پیوند purge با حذف حساب تصمیم کاربر را می‌خواهد و انجام نشده است.
- خروجی GDPR (`export_data`) دادهٔ حفظ را پوشش نمی‌دهد؛ به‌روزرسانی‌اش بیرون از دامنهٔ این کار است.
- `domain_events.idempotency_key` یکتاست — به همین دلیل کلیدِ درخواستِ purge به رویداد داده نمی‌شود (در audit ثبت می‌شود)؛ وگرنه فراخوانیِ دوباره با همان کلید با خطای یکتایی می‌شکست.

## ۴. تصمیم‌های باز برای کاربر (هیچ‌کدام در این کار گرفته نشده‌اند)

| # | تصمیم | وضعیت |
|---|---|---|
| ۱ | Redis در Railway ساخته شود؟ (پیش‌شرط limiter توزیع‌شده) | باز — بدون آن، قید تک‌replica می‌ماند |
| ۲ | هنگام قطع Redis، اتصالِ تازه رد شود (fail-closed) یا با limiter محلی قبول شود؟ | پیاده شده: fail-closed در production، fallback در dev/test |
| ۳ | آزمون‌های تکمیل‌شده پس از ۳۰ روز پاک شوند؟ | باز — مکانیزم آماده است، پیش‌فرض خاموش |
| ۴ | بقیهٔ داده نامحدود بماند؟ | باز — پیش‌فرض همه null |
| ۵ | دامنهٔ purge: فقط حفظ (الف) یا همهٔ دادهٔ قرآن کاربر (ب)؟ | فقط الف پیاده شده؛ ب تصمیم می‌خواهد |
| ۶ | حذف حساب، purge حفظ را هم بکند؟ | باز — وضع فعلی (بدون تغییر) مستند شد |
| ۷ | واریانت ادمین purge (CRM) ساخته شود؟ | نه — ساخته نشده است |

## ۵. شواهد تست

سوئیت تازه: `apps/api/tests/test_hifz_p1_345.py` — **۲۴ تست، همه سبز** (۲۷ ثانیه).

| گروه | تست‌ها | پوشش |
|---|---|---|
| P1-3 limiter توزیع‌شده | ۹ | سقف + release، دو نمونه روی یک Redis مشترک، ۲۰ acquire موازی → دقیقاً ۴ موفق، انقضای lease بدون release (با `now_ms` قطعی)، fail-closed هنگام قطع (prod) + fallback محلی (dev)، اتصالِ موجود قطع نمی‌شود، دو دروازه سقف مشترک، `release_all` محلی، singleton در dev محلی است |
| P1-4 نگهداری | ۶ | ثبت ۶ کلید در SETTING_DEFS + اعتبارسنج (null/۱/۳۰/۳۶۵۰ قبول؛ ۰/منفی/۳۶۵۱ → ‏ValueError؛ نوعِ اشتباه → ‏TypeError)، پیش‌فرضِ همه null و purge بی‌اثر، قانون آزمون (فقط قدیمیِ تکمیل‌شده + dry-run بدون حذف)، قانون نشست (فرزندها همراه نشست)، فعال/در حال ��جرا/ترجیح‌ها هرگز حذف نمی‌شوند، قانون SRS غیرفعال |
| P1-5 حذف یک‌جا | ۹ | پیش‌نمایش = حذفِ واقعی + کاربر B ردیف‌به‌ردیف سالم، audit فقط تعداد (رشته‌های نگهبان `SENTINEL_*` در audit نیستند) + رویداد با payload خالی، idempotent (دومین purge صفر)، rollback کامل هنگام خطا پیش از commit، آزادسازی اسلات زنده، HTTP: پیش‌نمایش + purge + پیش‌نمایشِ صفر، بدون confirm → ‏۴۲۲، ‏`user_id`/`scope` در body → ‏۴۲۲، بدون توکن → ‏۴۰۱، purge چهارم در ساعت → ‏۴۲۹ |

رگرسیون: `test_hifz_phase11_security` + `test_hifz_phase5_ws` + `test_hifz_phase3` + `test_hifz_phase4` + `test_hifz_phase10` + `test_hifz_phase12_regression` + `test_hifz_stream` + `test_rate_limit_distributed_fix3` + `test_remediation2_track1_ratelimit` + `test_event_bus_failfast` — **۱۵۶ تست سبز، ۰ ناموفق**. Ruff: فایل‌های تازهٔ این کار تمیز؛ خطاهای باقی‌مانده در فایل‌های تغییریافته روی خط‌های ازپیش‌موجودند (PLE2502 خط ۱۳۰ و TRY004های قدیمیِ `platform_settings.py`، BLE001های قدیمیِ `main.py`) — سهم این کار صفر است. (کل درخت ۱۳۷ در برابر baseline ‏۱۲۹ است؛ مابه‌التفاوت از تغییرهای موازیِ ایجنت‌های دیگر در همین درخت است، نه این کار.)

## ۶. محدودیت‌های صادقانه

- وضعیت زندهٔ Redis در Railway راستی‌آزمایی نشده است (بدون Railway CLI/توکن)؛ ادعایی دربارهٔ فعال‌بودن limiter توزیع‌شده در production نمی‌شود.
- مسیر Lua فقط روی Redis واقعی آزمایش می‌شود؛ تست‌ها مسیر fallback ‏fakeredis را می‌پوشانند.
- بستنِ اتصالِ WS زندهٔ کاربر هنگام purge به‌صورت آزادسازی اسلات limiter انجام می‌شود (تست شده)؛ رجیستریِ اتصال‌های WS برای بستنِ مستقیمِ سوکت در این کد نیست و رفتارِ اتصالِ در حال اجرا پس از purge (روی نشستِ حذف‌شده) به‌صورت زنده آزمایش نشده است.
- حلقهٔ نگهداری روزانه است و گذر اولش dry-run؛ حذف واقعی از گذر دوم به بعد انجام می‌شود.
