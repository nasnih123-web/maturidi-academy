# سخت‌سازی امنیتی — hardening/audit-pass-1

**تاریخ:** 2026-10-19 | برنچ: `hardening/audit-pass-1` | جزئیات کامل: `findings-matrix.md`

## مدل تهدید (خلاصه)

دارایی‌ها: حساب‌های کاربران/ادمین‌ها، دادهٔ فقهی و محتوای علمی، فایل‌های خصوصی کتابخانه، تراکنش‌های مالی (درگاه پرداخت)، نشست‌ها و توکن‌ها. مهاجم مفروض: کاربر احرازهویت‌شدهٔ مخرب + شنود شبکه + تلاش برای ارتقای دسترسی.

## تغییرات این پاس

### احراز هویت و نشست
- **TOTP اجباری سمت‌سرور** (ADR-0020): claim جدید `scope` در JWT (`full` / `2fa_setup`). ورود/refresh برای نقش‌های privileged بدون TOTP فقط توکن `2fa_setup` صادر می‌کند؛ `require_permission` و `require_full_scope` با 403 `requires_2fa` رد می‌کنند. توکن مرحلهٔ اول برای هیچ endpoint مدیریتی کافی نیست.
- **Refresh:** چرخش در هر استفاده + تشخیص reuse واقعی (revoke کل session + ایونت `token.reuse_detected`) + **پنجرهٔ grace ۶۰ ثانیه‌ای** برای race هم‌زمان (دو refresh موازی دیگر کاربر را بیرون نمی‌اندازد).
- **سخت‌سازی JWT:** پین الگوریتم `HS256` (تست‌شده در برابر `none`/کلید اشتباه)، لیست رزرو برای claimهای امنیتی در برابر بازنویسی از `extra`. (`iss`/`aud` عمداً نیست — سرویس دیگری این توکن‌ها را accept نمی‌کند؛ ثبت‌شده.)
- **اسرار:** prod روی `jwt_secret`/`encryption_key` placeholder با fail-fast متوقف می‌شود (تست‌شده). کلیدهای dev از prod جدا.

### وب‌سوکت (`app/core/realtime.py`)
- دیگر JWT بلندمدت در query string نیست: **تیکت یک‌بارمصرف ۶۰ ثانیه‌ای** (`POST /api/v1/auth/ws-ticket`، فقط full-scope) با هش ذخیره‌شده و مصرف اتمی (`UPDATE … WHERE used_at IS NULL`). `?token=` فقط برای سازگاری عقب‌رو.
- **Channel authorization:** ایونت‌های user-aggregate فقط به مالک یا دارندگان `users.manage` تحویل داده می‌شوند (broadcast زنده + replay). Wildcard عمومی به کانال خصوصی بسته شد.
- **Replay:** cursor دوجزئی `(created_at, event_id)` با ترتیب tuple پایدار؛ پیام `resume` حالا واقعاً replay می‌کند + ack. ایونت‌های هم‌زمانِ `created_at` برابر، بدون حذف/تکرار کنترل‌نشده پوشش داده می‌شوند.
- CRM به flow تیکت مهاجرت کرد (`apps/crm/src/lib/events.ts`).

### فایل و storage
- **سایزکپ قبل از RAM:** `read_capped_upload` در `core/storage.py` — استریم chunkهای 1MB با 413 زودهنگام روی library/voice/font. magic-byte + MIME + پسوند همچنان بررسی می‌شوند؛ فایل‌ها با نام سیستمی ذخیره می‌شوند؛ path traversal بسته است.
- Signed URLهای خصوصی: HMAC + `compare_digest`، انقضا، scope تک‌فایل؛ URL داخلی MinIO به مرورگر داده نمی‌شود.
- **CVEهای dependency:** pyjwt→2.15.1، python-multipart→0.0.31 (path traversal + DoS در مسیر آپلود!)، cryptography→50.0.0.

### زیرساخت امنیتی
- کانتینر API با کاربر **non-root** (uid 10001).
- CI: `semgrep … || true` حذف شد (حالا blocking)؛ job جدید pip-audit.

## محدودیت‌های شناخته‌شده (صادقانه)

- انتشار تنظیمات بین replicaها: TTL ۶۰ ثانیه‌ای، بدون pub/sub بین‌نودی — staleness حداکثر ۶۰ ثانیه (تصمیم مستند، نه آسیب‌پذیری پنهان).
- ایونت‌های غیر user-aggregate (مثل `task.assigned`) هنوز به همهٔ subscriberهای کانال broadcast می‌شوند — PII ندارند؛ سیاست per-aggregate در ADR-0020 به‌عنوان کار آینده ثبت شد.
- تست چندreplica/چندپردازه‌ای واقعی در sandbox غیرممکن بود (Blocked).
