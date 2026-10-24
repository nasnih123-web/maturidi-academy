# ADR-0029 — کپچای ثبت‌نام: Cloudflare Turnstile (C-02)

وضعیت: پذیرفته‌شده (رفع اشکال حسابرسی 197efa0، آیتم C-02)
تاریخ: ۲۰۲۶-۱۰-۲۲

## زمینه

قرارداد §۲ کپچا روی ثبت‌نام را الزام می‌کند ولی هیچ کپچایی در کد
نبود. انتخاب: **Cloudflare Turnstile** — رایگان، بدون کوکی/ردیابی
کاربر، siteverify سادهٔ سمت سرور، و ویجت سبک برای وب و WebView
موبایل. (جایگزین‌ها: reCAPTCHA — ردیابی گوگل و اصطکاک بیشتر؛
hCaptcha — معادل قابل‌قبول ولی اکوسیستم کوچک‌تر در این پروژه.)

## تصمیم

۱) راستی‌آزمایی سمت سرور در `app/core/captcha.py` با siteverify
واقعی (secret از env: ‏TURNSTILE_SECRET_KEY؛ هرگز در پاسخ/لاگ/DB
نمی‌آید). گیت در ابتدای `auth/service.register` اجرا می‌شود و فیلد
`captcha_token` به RegisterIn اضافه شد (سازگار با عقب: کلاینت‌های
قدیمی بدون فیلد، وقتی کپچا active است 403 می‌گیرند — رفتار عمدی).

۲) ماشین وضعیت دقیق و fail-closed:
- `CAPTCHA_ENABLED=false` (صریح) → خاموش (فقط dev).
- enabled + secret → توکن معتبر الزامی؛ نبود/نامعتبر → 403
  `captcha_failed`.
- enabled + نبود secret → 503 `captcha_not_configured` در همهٔ
  محیط‌ها — «بی‌سکوت قبول» نداریم.

۳) کلید عمومی (TURNSTILE_SITE_KEY) از همان env خوانده و با
`GET /api/v1/settings/public` (فیلد turnstile_site_key) به
کلاینت‌ها می‌رسد؛ secret هرگز در آن پاسخ نیست.

۴) کلاینت‌ها:
- وب: `components/TurnstileWidget.tsx` (رندر صریح api.js + callback
  توکن) و `auth-client.register()` + `fetchTurnstileSiteKey()`.
  نکتهٔ صادقانه: وب امروز صفحهٔ ثبت‌نام ندارد (فقط login) — کامپوننت
  و کلاینت کامل و آماده‌اند و گیت سروری روی همهٔ کلاینت‌ها اعمال
  می‌شود؛ ساخت صفحهٔ ثبت‌نام وب خارج از دامنهٔ این آیتم است.
- موبایل: `src/components/TurnstileWidget.tsx` روی
  react-native-webview (توکن با postMessage)؛ AuthScreen در حالت
  register وقتی site key هست ویجت را رندر و بدون توکن submit را
  متوقف می‌کند؛ services/auth توکن را می‌فرستد.

۵) اثبات: tests/test_captcha.py — siteverify با MockTransport
(توکن خوب/بد)، ماتریس کامل وضعیت‌ها، و این‌که secret در پاسخ
عمومی نشت نمی‌کند. در harness تست، کپچا به‌صورت پیش‌فرض و مستند
خاموش است (conftest) و تست‌های C-02 آن را صریح روشن می‌کنند؛
پیش‌فرض production روشن و fail-closed می‌ماند.
