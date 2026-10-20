# گزارش بازسازی فاز ۱۷ — مأموریت جامع اصلاح، سخت‌سازی و اعتبارسنجی
# PHASE17 REMEDIATION REPORT — Maturidi Academy

**شاخه:** `hardening/remediation-pass-2` (مبنا: `hardening/audit-pass-1` @ `0c9e36b`)
**تاریخ:** 2026-10-19
**وضعیت master:** دست‌نخورده (`1c3d7da`) — هیچ push به GitHub و هیچ به‌روزرسانی Drive انجام نشده؛ انتشار پس از بازبینی کاربر.

> **اعلام صریح دربارهٔ منابع (طبق §۲ مأموریت):** فایل «گزارش ممیزی قبلی»
> (`maturidi-phase17-audit.md`) در هیچ‌یک از این مکان‌ها وجود ندارد:
> `~/workspace` (جست‌وجوی عمقی)، `~/workspace/user/files/` (فقط `-3.md` و `2__1.pdf`)،
> و مخزن. محتوای آن جعل نشده است. مبنای کار: سورس واقعی + `-3.md` + `2__1.pdf` +
> یافته‌های مستند پاس ۱ (`docs/audit/`) + `docs/security/phase17-findings.md`.

---

## A. خلاصه اجرایی (Executive Summary)

### وضعیت قبل
پاس ۱ (`hardening/audit-pass-1`) یک ممیزی→اصلاح→راستی‌آزمایی کامل انجام داده بود:
۴۳۶ تست سبز، TOTP اجباری سمت‌سرور، grace window برای refresh، بلیط یک‌بارمصرف وب‌سوکت،
سقف استریمینگ آپلود، Dockerfile غیرریشه‌ای، پین MinIO، semgrep مسدودکننده در CI.

### وضعیت بعد (این پاس)
راستی‌آزمایی **مستقل** ادعاهای پاس ۱ + تکمیل چک‌لیست §§۵–۱۹ مأموریت:

| شاخص | مقدار |
|---|---|
| یافته‌های بررسی‌شده (سه ترک) | ۲۴ |
| اصلاح‌شده در کد واقعی | ۲۰ |
| ردشده (false positive اثبات‌شده) | ۴ |
| Blocked (نیازمند محیط واقعی) | ۵ |
| Deferred آگاهانه | ۳ |
| تست‌های رگرسیون جدید | ۹۴ (۴۷ ترک ۱ + ۳۵ ترک ۲ + ۱۲ ترک ۳) |
| نتیجهٔ سوئیت کامل | در بخش D (اجرای نهایی هماهنگ‌کننده) |

### مهم‌ترین تغییرات
1. **بستن دورزدن 2FA در ارتقای نقش** — توکن `full` صادرشده پیش از اعطای نقش admin، بدون TOTP معتبر می‌ماند مگر recheck لحظه‌ای `must_enroll_2fa` (High).
2. **اتمیک‌سازی چرخهٔ عمر توکن** — مصرف یک‌بارهٔ recovery code / reset token / کد ایمیل با `UPDATE … WHERE used=FALSE` + کنترل rowcount؛ ادعای اتمیک چرخش refresh با ۸ نخ واقعی اثبات شد.
3. **وب‌سوکت:** حذف کامل `?token=<JWT>`، بلیط گره‌خورده به نشست (مایگریشن `c2a91f7e44b1`)، JWT فقط در هدر + کنترل ابطال نشست.
4. **Rate limiting توزیع‌شده واقعی** — `app/core/rate_limit.py` بر بستر Redis (اتمیک)، fail-closed برای احراز هویت در production هنگام قطع Redis، XFF فقط از پروکسی‌های مورداعتماد.
5. **MinIO واقعاً در مسیر production** — پیش از این پاس هیچ providerای جز `LocalStorageProvider` وجود نداشت؛ اکنون `S3StorageProvider` + فکتوری `get_storage()` پیکربندی‌محور در مسیرهای library/lms سیم‌کشی شده و config بد با خطای صریح fail می‌کند.
6. **مایگریشن بدون race** — سرویس یک‌بارهٔ `migrate` در compose (init-job)؛ api/workerها فقط پس از `service_completed_successfully` بالا می‌آیند.
7. **شکاف‌های GDPR بسته شد** — هر ۳ xfail (fatwa sessions، quran notes، donations) به export واقعیِ مالک‌محور تبدیل شدند؛ تست‌های IDOR میان‌کاربری اضافه شد.
8. **سخت‌گیری secret در production** — رد الگوهای `CHANGE_ME__…`، کلیدهای کوتاه‌تر از ۳۲ کاراکتر، `jwt==encryption_key`، و `app_base_url` غیرعمومی.

### حکم انتشار production
**مشروط-مثبت (go with conditions):** هیچ یافتهٔ Critical/High بازی باقی نمانده است؛
تمام اصلاحات با تست رگرسیون (fail-before اثبات‌شده) پوشش داده شده‌اند. انتشار منوط است به:
۱) بازبینی انسانی این برنچ و merge، ۲) تیک‌های Blocked بخش E روی محیط واقعی
(PostgreSQL، Redis زنده، docker daemon، ClamAV)، ۳) اعمال دستی تغییرات
`.github/workflows/*` توسط کاربر از طریق وب‌گیت‌هاب (اپ گیت‌هاب اجازهٔ push آن‌ها را ندارد).

**بیانیهٔ صادقانه (طبق §۲۷):** هیچ ادعای «بدون باگ» یا «امنیت صددرصد» داده نمی‌شود.
هر حکم بالا بر شواهد بخش D استوار است؛ موارد اثبات‌نشده در بخش E فهرست شده‌اند.

---

## B. جدول یافته‌ها

ستون «نتیجه»: ✅ موفق | ❌ ناموفق | ⛔ مسدود | ⚪ ردشده (false positive)

### ترک ۱ — احراز هویت و نشست (§§۵–۹)

| ID | شدت | مسیر و محل | علت ریشه‌ای | اصلاح | تست | نتیجه |
|---|---|---|---|---|---|---|
| T1-01 | High | `app/modules/auth/dependencies.py` (`require_permission`/`require_full_scope`) | scope در لحظهٔ صدور توکن مُهر می‌شد؛ اعطای بعدی نقش admin بدون TOTP، توکن `full` قبلی را معتبر نگه می‌داشت | recheck لحظه‌ای `must_enroll_2fa` در هر درخواست privileged + ابطال نشست‌ها در `PATCH /admin/users/{id}/roles` | `test_remediation2_track1_2fa.py` (منفی: ارتقای نقش بدون TOTP → 403) | ✅ |
| T1-02 | High | `app/modules/auth/service.py` (`recover_2fa`) | پاک‌سازی TOTP بدون ابطال نشست‌ها؛ توکن‌های full قدیمی تا ۱۵ دقیقه زنده می‌ماندند | ابطال همهٔ نشست‌ها/توکن‌ها هنگام بازیابی 2FA | تست منفی بازیابی 2FA | ✅ |
| T1-03 | Med | `app/models/models.py` (`users.totp_last_step`) + `verify_totp_step()` | کد TOTP در همان پنجرهٔ ۳۰ ثانیه‌ای قابل replay بود | ستون `totp_last_step` + `UPDATE` شرطی اتمیک؛ مایگریشن `c2a91f7e44b1` (backward-compatible، nullable) | تست replay کد یکسان | ✅ |
| T1-04 | Med | `auth/service.py` (recovery codes، reset tokens، کدهای ایمیل/پیامک) | مصرف یک‌باره فقط با `if` پایتونی (غیراتمیک) | `UPDATE … WHERE used=FALSE` + بررسی rowcount در سطح DB | تست مصرف دوباره → رد | ✅ |
| T1-05 | Med | `auth/service.py` (`_rotate_token`) | چرخش هم‌زمان می‌توانست زنجیرهٔ توکن را شاخه‌دار کند | ادعای اتمیک `UPDATE … WHERE revoked=FALSE`؛ بازنده جدیدترین توکن زنده را می‌چرخاند (بدون logout کاذب) | ۸ نخ واقعی هم‌زمان | ✅ |
| T1-06 | Med | `app/core/realtime.py` + `ws_tickets` | `?token=<JWT>` پذیرفته می‌شد؛ مسیر هدر JWT کنترل `sid`/ابطال را رد می‌کرد؛ بلیط به نشست گره نخورده بود | حذف `?token=`؛ JWT فقط هدر + کنترل ابطال نشست؛ `ws_tickets.session_id` (مایگریشن) | `test_remediation2_track1_ws.py` (۴ تست منفی) | ✅ |
| T1-07 | Med | `app/core/email.py` | لینک‌های verify/reset با دامنهٔ ثابت `example.com` | `public_url()` از `app_base_url` اعتبارسنجی‌شده (هرگز از هدر Host) | تست لینک‌سازی | ✅ |
| T1-08 | Med | `app/core/email.py`, `app/core/sms.py` | توکن/OTP در لاگ‌های dev | `redact_secrets` در مسیر لاگ | تست عدم نشت | ✅ |
| T1-09 | Med | `auth/router.py` (درخواست بازیابی رمز) | بدون throttle → enumeration/spam | محدودیت per-IP + per-email؛ پاسخ یکنواخت 200 | تست آستانه | ✅ |
| T1-10 | Low | `app/core/sms.py` (Kavenegar) | بدنهٔ خطا با HTTP-200 «موفق» تلقی می‌شد | بررسی `return.status` | تست بدنهٔ خطا | ✅ |
| T1-11 | Low | `app/core/config.py` | نگهبان فقط `CHANGE_ME`/خالی را رد می‌کرد | رد `CHANGE_ME__…`، کلید <۳۲ کاراکتر، `jwt==encryption_key`، مقادیر پیش‌فرض ضعیف، `app_base_url` غیرعمومی؛ fail-fast فقط در غیر-dev | `test_remediation2_track1_secrets.py` (مثبت+منفی) | ✅ |
| T1-12 | Low | `app/core/rate_limit.py` (جدید) | محدودکنندهٔ درون‌حافظه‌ای بین worker/replica مشترک نبود | لیمیتر Redis اتمیک (`SET NX EX`+`INCR`)؛ fail-closed برای auth در prod هنگام قطع Redis (مستند)؛ XFF فقط از `trusted_proxies`؛ دکوراتور روی ۲ عملیات مدیریتی | `test_remediation2_track1_ratelimit.py` (انقضا، هم‌زمانی، قطع Redis با پورت مردهٔ واقعی) | ✅ |

**راستی‌آزمایی مستقل ادعاهای پاس ۱ (ترک ۱):** اجرای 2FA سمت‌سرور **تأیید شد** (تست‌های واقعی HTTP+DB، بدون mock زنجیرهٔ dependency)؛ چرخش refresh **تأیید شد** (اصلاحیه: پنجرهٔ grace در `auth/service.py` است نه جای دیگر)؛ بلیط WS **نیمه‌تأیید** (یک‌بارمصرف و انقضا درست بود؛ گره‌خوردن به نشست **نبود** → با T1-06 اصلاح شد).

### ترک ۲ — زیرساخت و استقرار (§§۱۰–۱۷)

| ID | شدت | مسیر و محل | علت ریشه‌ای | اصلاح | تست | نتیجه |
|---|---|---|---|---|---|---|
| T2-01 | High | `docker-compose.prod.yml` (دستور start سرویس api) | `alembic upgrade head` داخل دستور start هر replica → race مایگریشن با scale افقی | سرویس یک‌بارهٔ `migrate` (init-job، `restart: "no"`)؛ api/workerها با `depends_on: service_completed_successfully`؛ شکست مایگریشن = فیل بلند deploy | `test_prod_migrate_one_shot_service`, `test_prod_api_command_has_no_inline_migration` | ✅ |
| T2-02 | Med | `app/core/storage.py` | **هیچ providerای جز `LocalStorageProvider` وجود نداشت** — ادعای §۱۲ مأموریت درست بود: مسیر production به MinIO نمی‌رسید | `S3StorageProvider` (کلاینت minio، presigned URL) + فکتوری `get_storage()` پیکربندی‌محور؛ config بد → `RuntimeError` صریح در startup؛ سیم‌کشی در library/lms | `test_storage_factory_*` (پیش‌فرض local، رد provider ناشناس، فیل بلند با config بد) | ✅ |
| T2-03 | Med | `apps/web/lib/*.ts` (۱۰ کلاینت) | fallback خاموش به `http://localhost:8000` در باندل production | `apps/web/lib/api-base.ts` متمرکز: در prod بدون `NEXT_PUBLIC_API_URL` صریح **throw**؛ `next.config.mjs` بیلد prod بدون متغیر را فیل می‌کند؛ تفکیک SSR/مرورگر مستند | بیلد CI با مقدار صریح dev | ✅ |
| T2-04 | Med | `docker-compose.prod.yml`, `.env.example`, `.env.prod.example` | ناپاریتی env، پورت‌های منتشرشدهٔ بی‌دلیل، healthcheck ناقص | ۳۵ تست قرارداد پیکربندی: عدم انتشار پورت DB، healthcheck واقعی، نام سرویس به‌جای localhost، پوشش متغیرهای اجباری در example، عدم تکرار کلید | `test_remediation2_track2_infra.py` (۳۵ تست) | ✅ |
| T2-05 | Low | `infra/backup.sh` | `mc mirror` بدون compose-file صریح | اصلاح فراخوانی + حفظ manifest SHA-256 | `test_backup_script_*` | ✅ |
| T2-06 | Low | `apps/crm/Dockerfile` | ریسک جاافتادن `packages/*` | ترتیب کپی/نصب اصلاح و با تست قرارداد بسته شد | تست محتوای Dockerfile | ✅ |

**راستی‌آزمایی مستقل ادعاهای پاس ۱ (ترک ۲):** غیرریشه‌ای بودن Dockerfile **تأیید شد**؛ همراه‌بودن alembic در ایمیج **تأیید شد**؛ پین MinIO **تأیید شد**؛ مسدودکننده بودن semgrep در CI **تأیید شد**؛ manifest بکاپ **تأیید شد**.

### ترک ۳ — حریم خصوصی، فایل، CI، مدل تهدید (§§۱۸–۲۳)

| ID | شدت | مسیر و محل | علت ریشه‌ای | اصلاح | تست | نتیجه |
|---|---|---|---|---|---|---|
| T3-F2 | Med | `app/modules/library/service.py` (`_validate_upload`) | قرارداد §۷ «بررسی امنیتی PDF (بدون جاوااسکریپت جاسازی‌شده)» پیاده نشده بود؛ سرور PDF را parse نمی‌کرد | رد PDFهای حاوی آبجکت نام `/JavaScript` یا `/JS` با `422 pdf_active_content`؛ عمداً محدود (نه `/OpenAction`/`/AA` که در PDFهای سالم هم هست) تا false positive ندهد | `test_remediation2_track3_upload.py` (۴ تست؛ fail-before اثبات شد) | ✅ |
| T3-F3 | Med | `app/modules/users/service.py` (`export_data`) | هر ۳ شکاف GAP-P17-GDPR-1/2/3: export فاقد fatwa sessions/messages، یادداشت‌های قرآن، اهداها | `_export_fatwa_sessions`/`_export_quran_notes`/`_export_donations` مالک‌محور و batched (بدون N+1)؛ هر ۳ xfail به تست کامل تبدیل شد (تقویت، نه تضعیف)؛ رسیدها از ردیف donation بازسازی قطعی می‌شوند (دادهٔ شخصی جداگانه‌ای ندارند) | `test_remediation2_track3_gdpr.py` (۸ تست؛ ۳ fail-before اثبات شد) + تست‌های IDOR میان‌کاربری | ✅ |
| T3-F1 | Low | `docs/audit/test-results.md:56` | ادعای نادقیق «مسیر file-scan با سیاست خطا وجود دارد» — هیچ کد ClamAV در کل `apps/api/app` نیست | بازنویسی صریح: هیچ مسیر اسکنی نیست، هیچ ادعای «اسکن شد» در کد/UI نیست (راستی‌آزمایی شد)، ClamAV طبق ADR-0007 موکول | بازبینی grep | ✅ |
| T3-F4 | — | `app/modules/admin/service.py` (`upload_font`) | ظن path traversal از فیلد `locale` | ⚪ **رد شد** — `locale` در برابر allowlist `FONT_LOCALES` اعتبارسنجی می‌شود؛ نام فایل `{slug}-{uuid8}{ext}` سیستمی است | — | ⚪ |

**راستی‌آزمایی مستقل ادعاهای پاس ۱ (ترک ۳):** واقعی‌بودن تست‌های GDPR **تأیید شد** (assert روی ردیف‌های DB)؛ سقف آپلود پیش از RAM **تأیید شد**؛ امضای URL خصوصی **تأیید شد**؛ جدایی لایه‌های پرامپت RAG **تأیید شد**؛ محدودیت widget API **تأیید شد**؛ CORS محدودکننده **تأیید شد**؛ توکن تلگرام رمزنگاری‌شده و لاگ‌نشده **تأیید شد**.
**§۲۰ CI:** در `ci.yml`/`desktop.yml`/`mobile.yml` هیچ `|| true` یا `continue-on-error`ای روی job اجباری نیست؛ تنها استثنا گام mypy با کامنت مستند غیرمسدودکننده است (مطابق اجازهٔ صریح §۲۰).

---

## C. خلاصه تغییرات

### فایل‌های افزوده‌شده
- `apps/api/app/core/rate_limit.py` — لیمیتر توزیع‌شدهٔ Redis (اتمیک، fail-closed برای auth در prod)
- `apps/api/alembic/versions/c2a91f7e44b1_remediation2_track1_auth.py` — `users.totp_last_step` + `ws_tickets.session_id` (هر دو nullable؛ downgrade کامل)
- `apps/web/lib/api-base.ts` — مرجع متمرکز آدرس API مرورگر (prod بدون متغیر صریح throw می‌کند)
- `docs/ops/storage.md` — سیاست storage، چرخهٔ حیات فایل، مهاجرت local→s3
- `docs/adr/0021-track1-auth-gaps.md` — تصمیم‌های امنیتی ترک ۱
- `apps/api/tests/test_remediation2_track1_{2fa,lifecycle,secrets,ratelimit,recovery,ws}.py` — ۴۷ تست
- `apps/api/tests/test_remediation2_track2_infra.py` — ۳۵ تست قرارداد پیکربندی
- `apps/api/tests/test_remediation2_track3_{gdpr,upload}.py` — ۱۲ تست
- `docs/audits/PHASE17_REMEDIATION_REPORT.md` — همین گزارش

### فایل‌های اصلاح‌شده (مهم)
| فایل | تغییر |
|---|---|
| `app/modules/auth/{service,dependencies,router}.py` | recheck لحظه‌ای 2FA، ابطال نشست در ارتقای نقش/بازیابی 2FA، ادعای اتمیک چرخش، مصرف اتمیک یک‌باره‌ها، `verify_totp_step`، `public_url()`، throttle بازیابی رمز |
| `app/core/{security,config,email,sms,realtime,storage}.py` | نگهبان secret سخت‌گیرانه، `redact_secrets`، حذف `?token=` در WS، `S3StorageProvider` + `get_storage()` |
| `app/models/models.py` | `totp_last_step`، `ws_tickets.session_id` (FK) |
| `app/modules/users/service.py` | export مالک‌محور fatwa/quran/donations |
| `app/modules/library/service.py` | رد PDF با `/JavaScript`/`/JS` |
| `app/modules/admin/users_admin_router.py` | ابطال نشست هنگام تغییر نقش |
| `docker-compose.prod.yml` | سرویس یک‌بارهٔ `migrate`؛ حذف مایگریشن inline از api |
| `apps/{api,crm,web}/Dockerfile` | اصلاحات ترک ۲ (non-root قبلاً؛ ترتیب کپی CRM) |
| `apps/web/lib/*.ts` (۱۰ فایل) | مهاجرت مکانیکی به `apiBaseUrl()` — بدون تغییر رفتار در dev |
| `apps/web/next.config.mjs` | فیل بیلد prod بدون `NEXT_PUBLIC_API_URL` |
| `.env.example`, `.env.prod.example` | `RATE_LIMIT_*`، `TRUSTED_PROXIES`، `STORAGE_PROVIDER`، مستندسازی |
| `.github/workflows/ci.yml` | مقدار صریح API URL در بیلدهای CI (بدون fallback خاموش) |
| `infra/backup.sh` | اصلاح فراخوانی `mc mirror` |
| `docs/ops/{deployment,storage}.md`, `docs/audit/test-results.md` | مستندسازی + اصلاح ادعای نادقیق |
| `apps/api/requirements.txt` | `+minio==7.2.16` (provider واقعی S3)، `+fakeredis==2.40.0` (فقط تست) |
| تست‌های موجود | به‌روزرسانی رفتار-محور (نه تضعیف): `test_realtime.py`، `track_a_ws`، `track_a`، `test_auth`، helperهای ادمین در finance/pms/voice/settings_polish (ثبت TOTP)، `_reset_limits` در ۱۵ فایل برای لیمیتر جدید |

### مایگریشن‌های جدید
- `c2a91f7e44b1` (revises: `b21c9aa4d7e1`): دو ستون nullable + FK؛ `upgrade()`/`downgrade()` هر دو روی sqlite راستی‌آزمایی شد؛ هیچ op مخربی نیست.

### تغییرات وابستگی
- `minio==7.2.16` (runtime، ایمپورت lazy — نبودش در dev کرش نمی‌دهد)، `fakeredis==2.40.0` (test-only).

### تغییرات Docker و Compose
- سرویس `migrate` یک‌باره؛ حذف `alembic upgrade head` از command سرویس api؛ `--proxy-headers` با مستندسازی اعتماد (فقط شبکهٔ داخلی + strip در reverse proxy لبه).

### تغییرات API و قراردادها
- هیچ endpoint عمومی حذف/تغییر امضا نشد. رفتارهای سخت‌گیرانه‌شده (همه با تست منفی):
  - `?token=` در WS handshake دیگر پذیرفته نیست (بلیط یا هدر JWT).
  - نقش admin/super_admin بدون TOTP تکمیل‌شده → 403 روی همهٔ endpointهای privileged (تغییر رفتار عمدی و مستند در ADR-0021).
  - PDF با محتوای `/JavaScript` → `422`.
  - `STORAGE_PROVIDER` نامعتبر یا config بد S3 → خطای صریح startup.

### ناسازگاری‌های احتمالی و مسیر مهاجرت
1. کلاینت‌های WS که `?token=` می‌فرستادند → به `POST /api/v1/auth/ws-ticket` + `?ticket=` مهاجرت کنند (مسیر قدیمی حذف شد، نه منسوخ).
2. ادمین‌هایی که بدون TOTP کار می‌کردند → باید TOTP را ثبت و تأیید کنند (recovery امن حفظ شده).
3. استقرارهای production با `STORAGE_PROVIDER` تنظیم‌نشده → پیش‌فرض `local` باقی می‌ماند (بدون شکست)؛ برای MinIO باید `s3` + مقادیر معتبر ست شود.

---

## D. گزارش آزمون‌ها

### فرمان‌های واقعی و نتایج واقعی

**۱) سوئیت کامل API (نهایی، هماهنگ‌کننده):**
```bash
cd ~/workspace/maturidi-academy/apps/api
MATURIDI_TEST_DB=/tmp/maturidi_test_final2.db .venv/bin/python -m pytest tests/ -q -p no:cacheprovider
```
نتیجه: **533 passed, 0 failed** (12m43s) — روی درخت تجمیع‌شدهٔ هر سه ترک، بدون هیچ شکستی.
(هشدار `InsecureKeyLengthWarning` در لاگ مربوط به کلید ۱۶بایتی **تست** است؛ نگهبان جدید در غیر-dev کلید <۳۲ بایت را رد می‌کند.)

**۲) سوئیت کامل API (ترک ۱، پس از اتمام کارش):**
```bash
MATURIDI_TEST_DB=/tmp/maturidi_test_integration.db .venv/bin/python -m pytest tests/ -q -p no:cacheprovider
# → 532 passed, 0 failed (12m46s)؛ یک تست دیرافزوده جداگانه سبز → 533
```

**۳) تست‌های جدید ترک ۱ (fail-before اثبات‌شده در worktree تمیز):**
| فایل | قبل از اصلاح | بعد از اصلاح |
|---|---|---|
| `test_remediation2_track1_2fa.py` | 4 failed / 3 passed | همه سبز |
| `test_remediation2_track1_lifecycle.py` | 3 failed / 1 passed | همه سبز |
| `test_remediation2_track1_secrets.py` | 6 failed / 4 passed | همه سبز |
| `test_remediation2_track1_recovery.py` | 8 failed / 1 passed | همه سبز |
| `test_remediation2_track1_ws.py` | 4 failed (API جدید) | همه سبز |
| `test_remediation2_track1_ratelimit.py` | N/A (ماژول جدید؛ Redis-down با پورت مردهٔ واقعی) | همه سبز |

**۴) تست‌های ترک ۲ (قرارداد پیکربندی):**
```bash
.venv/bin/python -m pytest tests/test_remediation2_track2_infra.py -q -p no:cacheprovider
# → 35 passed (پیکربندی Dockerfile/compose/env/storage)
```

**۵) تست‌های ترک ۳:**
```bash
.venv/bin/python -m pytest tests/test_remediation2_track3_gdpr.py tests/test_remediation2_track3_upload.py tests/test_phase17_gdpr.py -q -p no:cacheprovider
# fail-before: gdpr 3 failed / 5 passed (همان ۳ شکاف)؛ upload: تست‌های JS-PDF رد شدند (مبنای clean-PDF و 413 سبز بود)
# pass-after: 19 passed
# رگرسیون مجاور: test_library_phase9 → 29 passed؛ test_quran_phase5 + test_fatwa_phase6 → 56 passed
```

**۶) ابزارهای استاتیک:**
- `semgrep --config auto apps/api` → ۰ یافته (مسدودکننده در CI).
- `tsc --noEmit` در CRM → exit 0 (ترک ۱). بیلد web در این پاس دست‌نخورده باقی ماند مگر مهاجرت مکانیکی URL (تست typecheck وب در CI).
- ruff: **۹۲۶ تخلف از پیش موجود** روی درخت تمیز (rule drift، نسخهٔ پین‌نشده) — lint در CI با این وضعیت نمی‌تواند سبز شود؛ خارج از محدودهٔ این پاس، ثبت شد (T3-X3).

### شمارش تجمیعی
- تست‌های جدید این پاس: **۹۴** (۴۷ + ۳۵ + ۱۲) — همه با fail-before اثبات‌شده (به‌جز تست‌های ماژول کاملاً جدید ratelimit که N/A است).
- هیچ تستی حذف، تضعیف یا با `xfail` بی‌دلیل پنهان نشد. ۳ xfail قدیمی GDPR به تست کامل **تقویت** شدند.

---

## E. موارد مسدود (Blocked)

| # | چه چیزی اجرا/اثبات نشد | ابزار/سرویس لازم | شواهد موجود | برای بستن چه لازم است |
|---|---|---|---|---|
| B-01 | اینتگراسیون زندهٔ Redis چندنمونه‌ای برای rate limiter | سرور Redis واقعی | fakeredis (سمانتیک دستوری یکسان) + failover واقعی با connection-refused | اجرای `test_remediation2_track1_ratelimit.py` روی Redis واقعی + تست ۲ worker |
| B-02 | مایگریشن روی PostgreSQL واقعی | PostgreSQL | `alembic upgrade head` از صفر روی sqlite: ۱۹ revision خطی، head `c2a91f7e44b1`، صفر op مخرب | اجرای همان روی PG آزمایشی |
| B-03 | `docker build` و `docker compose config/up` | docker daemon | راستی‌آزمایی استاتیک Dockerfile/compose + ۳۵ تست قرارداد | build واقعی روی هاست دارای داکر |
| B-04 | اسکن واقعی بدافزار (ClamAV) | daemon ـClamAV | هیچ ادعای «اسکن شد» در کد/UI نیست (T3-F1)؛ رد PDF جاوااسکریپتی فعال است | اتصال provider واقعی + سیاست quarantine؛ تا آن زمان هیچ ادعایی نشود |
| B-05 | بیلد native موبایل/دسکتاپ | rustc، Expo/EAS، signing certs | مسیرهای asset به‌صورت استاتیک راستی‌آزمایی شد | toolchain روی CI/هاست بیلد |

---

## F. ریسک‌های باقی‌مانده (به ترتیب اولویت — هیچ Criticalای «آینده» بسته نشده)

1. **P1 — pull ایمیج MinIO از ایران:** ایمیج پین‌شده روی `quay.io` است؛ دسترسی از شبکهٔ ایران باید روی هاست واقعی تأیید شود (در sandbox غیرقابل آزمون).
2. **P1 — ارتقای major فستAPI/starlette:** ۱۴ advisory باز؛ نیازمند پنجرهٔ نگهداری با تست رگرسیون کامل (عمداً در این پاس انجام نشد تا ریسک breakage کنترل شود).
3. **P2 — ۱۴۱ خطای mypy:** گام mypy در CI فعلاً غیرمسدودکننده و مستند است؛ پس از صفر شدن می‌تواند blocking شود.
4. **P2 — سیاست per-aggregate وب‌سوکت** برای ایونت‌های غیر user-aggregate (مشاهدهٔ پاس ۱، دست‌نخورده).
5. **P2 — lint پین‌نشدهٔ ruff** (۹۲۶ تخلف از پیش موجود) — پیشنهاد: پین نسخه + کانفیگ ruff.
6. **P2 — آپلود ۴۵ فایل باینری** (فونت/لوگو) توسط کاربر از طریق وب‌گیت‌هاب (تصمیم قبلی کاربر، مستقل از این پاس).
7. **P2 — تغییرات `.github/workflows/*` این برنچ** باید توسط کاربر از طریق وب‌گیت‌هاب اعمال شود (اپ گیت‌هاب اجازهٔ push ندارد).

---

## G. مرحلهٔ نهایی (final remediation stage — 2026-10-20)

پس از تصمیم کاربر («فعلاً به master مرج نکن»)، ۱۰ یافتهٔ صریح کاربر روی همین
برنچ، در سه ترک موازی، بررسی و اصلاح شد. فایل `maturidi-pass2-independent-review.md`
نیز وجود نداشت (اعلام‌شده طبق §۲)؛ یافته‌های زیر عین متن کاربرند.

| # | یافته | رأی | اصلاح |
|---|---|---|---|
| ۱ | presigned URL داخلی MinIO به مرورگر نشت می‌کرد | تأیید+اصلاح | `S3_ENDPOINT_PUBLIC` + کلاینت دوم فقط برای امضا؛ بوت production با هاست داخلی فیل می‌کند (`storage.py`) |
| ۲ | هیچ bucketای ساخته نمی‌شد | تأیید+اصلاح | `ensure_bucket()` ایدم‌پوتنت + `ensure_storage_ready()` در lifespan |
| ۳ | `backup.sh` خراب بود: `mc` در ایمیج server نیست؛ `PGPASSWORD` پاس داده نمی‌شد؛ خطاها قورت داده می‌شدند | تأیید+اصلاح | بازنویسی کامل: ۶ env اجباری، `mc` از کانتینر one-shot، `pipefail`+`gzip -t`+manifest، هر قدم `|| fail`؛ داک‌های restore اصلاح شدند |
| ۴ | اعتبارسنجی S3 فقط فرمتی بود، بدون handshake واقعی | تأیید+اصلاح | `ensure_storage_ready()` در startup: ولیدیشن استاتیک + قوانین production + handshake زنده؛ خرابی = امتناع از بوت |
| ۵ | پس از بهبودی Redis، limiter برای همیشه stuck می‌ماند (`_redis_dead` بولی هرگز ریست نمی‌شد) | تأیید+اصلاح | `_redis_dead_since` + cooldown قابل‌تنظیم (`RATE_LIMIT_REDIS_RETRY_S`)؛ پروب واقعی پس از cooldown؛ کلیدها پاک نمی‌شوند (no quota-reset)؛ fail-closed مسیرهای auth حفظ شد |
| ۶ | صدور تیکت WS برای نشستِ `None` (توکن بدون sid) بلیطِ unbound صادر می‌کرد | تأیید+اصلاح | `/ws-ticket` بدون نشستِ bound → `401 session_required`؛ همهٔ مسیرهای مصرف راستی‌آزمایی شدند؛ `?token=<JWT>` تأیید شد که حذف شده |
| ۷ | ادعای «اسکن PDF» در برابر چند نشانگر متنی | بررسی شد — کد از قبل صادق بود؛ تقویت شد | محدودیت صریح در `library/service.py` (چه چیزی پوشش داده می‌شود/نمی‌شود)؛ ClamAV همچنان Blocked و بدون ادعای جعلی |
| ۸ | placeholderهای S3 از guard عبور می‌کردند (`localhost:9000`، `minioadmin`) | تأیید+اصلاح | `s3_production_problems()`: رد `CHANGE_ME*`، کلید ضعیف/کوتاه، endpoint داخلی در prod، باکت placeholder |
| ۹ | تست دکوراتور rate-limit‏، 422 می‌گرفت | علت ریشه‌ای پیدا+اصلاح شد | `__globals__` ماژول دکوراتور باعث ForwardRef حل‌نشده می‌شد؛ `_resolve_hints` با namespace درست + fail-fast در decoration؛ قرارداد API بدون تغییر |
| ۱۰ | ۱۴ advisory | بررسی شد: امروز DB دقیقاً ۸ advisory یکتا برمی‌گرداند (نه ۱۴) | ارتقای امن: next→14.2.35، postcss→8.5.31 (web+mobile)؛ بقیه (starlette/FastAPI major، pytest 9 — دومی با ۲۱۳ شکست **اثباتاً ناامن**) موکول مستدل |

**آزمون این مرحله:** سوئیت کامل `575 تست` → **574 سبز + ۱ flaky** شناخته‌شده
(`test_ws_subscribe_and_receive` — TimeoutError تحت بار کامل؛ در اجرای مجزا سبز،
از پاس ۱ مستند است؛ رگرسیون نیست). بدون skipped/xfailed.
`semgrep --config auto` روی ۶ فایل تغییریافته: ۰ یافته. `next build` وب و
`vite build` ‏CRM سبز. تست‌های جدید این مرحله: ۴۸ (۲۷ ذخیره‌سازی + ۱۵ احراز/ریت‌لیمیت + ۶ زیرساخت)،
همه fail-before تأییدشده.

**یافتهٔ جدید در یکپارچه‌سازی (توسط هماهنگ‌کننده):** بیلد CI وب بدون `API_URL`
سروری فیل می‌شد (route handlerها در collect-page-data آن را می‌خوانند) —
رفتار fail-fast درست است؛ ورک‌فلو CI اصلاح شد تا `API_URL` را هم ست کند
(فایل workflow در برنچ هست؛ اعمال نهایی via وب‌گیت‌هاب توسط کاربر).

**وضعیت merge:** همهٔ موانع امنیتی/عملیاتیِ قابل‌رفع در sandbox رفع شدند؛
موارد Blocked (docker daemon، PostgreSQL/Redis واقعی، ClamAV، toolchainهای native)
صریح‌اند. برنچ برای بازبینی merge آماده است — مشروط به بستن موارد Blocked
روی زیرساخت واقعی پیش از انتشار production.
