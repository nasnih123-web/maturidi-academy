# ADR-0036 — چرخش کلید رمزنگاری تنظیمات (M-05)

- وضعیت: پذیرفته‌شده — ۲۰۲۶-۱۰-۲۲ (رفع اشکال‌های audit روی 197efa0)

## زمینه
`app/core/secrets.py` envelope نسخه‌دار داشت ولی
`_fernet_for_version` هر نسخه‌ای جز نسخهٔ جاری را رد می‌کرد — یعنی
عملاً rotation ناممکن بود: بالا بردن `ENCRYPTION_KEY_VERSION` همهٔ
مقادیر ذخیره‌شده (تنظیمات حساس پلتفرم و TOTP secret کاربران) را
ناخوانا می‌کرد. قرارداد §۳ صراحتاً envelope نسخه‌دار را برای همین
rotation طراحی کرده بود.

## تصمیم
1. **`ENCRYPTION_KEYS`** (env، JSON map نسخه→کلید) در کنار
   `ENCRYPTION_KEY`/`ENCRYPTION_KEY_VERSION`:
   - خواندن: نسخه در map → از map؛ نسخهٔ جاری → از map یا
     `ENCRYPTION_KEY` قدیمی؛ غیر از این → `ValueError` (مثل قبل).
   - نوشتن: همیشه نسخهٔ جاری. JSON نامعتبر → خطای صریح در اولین
     استفاده (نه fallback خاموش).
2. **مهاجرت تدریجی:** `app/core/key_rotation.py::reencrypt_all`
   هر دو مخزن envelope (`platform_settings` و `users.totp_secret`)
   را اسکن و مقادیر قدیمی را با کلید جاری باز-رمز می‌کند؛ خروجی
   فقط شمارنده‌هاست. endpoint مدیریتی
   `POST /api/v1/admin/settings/reencrypt` با مجوز
   `platform.settings` + audit log (`platform.key_rotation`).
3. **اعتبارسنجی production** (`assert_production_secrets_ok`):
   کلیدهای داخل map هم از نظر placeholder/ضعف بررسی می‌شوند و
   نبود کلید نسخهٔ جاری fail-fast است.

## روند rotation برای اپراتور
کلید تازه را به map اضافه + نسخهٔ جاری را بالا ببرید → deploy →
`POST /admin/settings/reencrypt` را بزنید تا شمار rotated صفر شود →
کلید قدیمی را از map حذف کنید.

## پیامدها
- rotation بدون downtime و بدون ناخوانا شدن TOTP کاربران ممکن شد.
- کلیدها همچنان فقط از env می‌آیند (دیتابیس/ریپو هرگز) — قرارداد §۳.
