# QPC V4 Tajweed Fonts — فونت‌های تجوید V4

## فارسی

این پوشه شامل ۶۰۴ فونت صفحه‌ای **QPC V4 Tajweed** است (یکی برای هر صفحهٔ مصحف، `p1.woff2` تا `p604.woff2`) که برای نمایش رنگ تجوید حرف‌به‌حرف استفاده می‌شود.

**منبع:** QUL (Quranic Universal Library — qul.tarteel.ai)، منبع ۲۴۰
- صفحهٔ منبع: https://qul.tarteel.ai/resources/font/240
- صفحهٔ کپی‌رایت: https://qul.tarteel.ai/resources/240/copyright
- CDN دانلود: `https://static-cdn.tarteel.ai/qul/fonts/quran_fonts/v4-tajweed/woff2/p{n}.woff2`

**دادهٔ همراه:** `apps/web/public/quran-mushaf-v4-tajweed.json` — اسکریپت کلمه‌به‌کلمهٔ «V4 Glyphs (With Tajweed)» (منبع ۴۷ QUL، https://qul.tarteel.ai/resources/quran-script/47)، ۸۳٬۶۶۸ کلمه، SHA-256: `40964a1b7932e9a69e0dfc0d58dce3b73e30a803febda119fd6828bcb75fac98`.

**تاریخ دانلود:** ۲۰۲۶-۱۱-۰۸

**وضعیت مجوز — نامشخص (مهم):** صفحهٔ کپی‌رایت QUL برای منبع فونت (۲۴۰) و منبع داده (۴۷) می‌گوید: «We don't have copyright information for this resource.» — یعنی مجوز مشخصی برای این منابع منتشر نشده است. مجوز MIT پلتفرم QUL فقط نرم‌افزار پلتفرم را پوشش می‌دهد، نه منابع را. شرایط عمومی فونت‌های KFGQPC (توزیع رایگان بدون تغییر) برای فونت «Uthmanic Script Hafs» مستند است، نه مشخصاً برای فونت‌های صفحه‌ای V4 Tajweed — پس اثبات مجوز نیست، فقط سرنخ است.

**این فونت و داده به دستور صریح کاربر (۲۰۲۶-۱۱-۰۸) باندل شده‌اند، با آگاهی از نامشخص بودن مجوز.** فونت و داده بدون هیچ تغییری استفاده شده‌اند.

**استثنا — صفحهٔ ۳۲۸:** فایل `p328.woff2` در CDN QUL وجود نداشت (HTTP 404؛ درحالی‌که `p328.ttf` و `p328.woff` موجود بودند). نسخهٔ TTF آن از CDN دانلود و با fontTools (تبدیل بدون‌اتلاف TTF → WOFF2) به WOFF2 تبدیل شد؛ تعداد گلیف (۳۶۷) پیش و پس از تبدیل یکسان است و فایل حاصل magic معتبر `wOF2` دارد.

## English

This folder contains 604 page fonts of **QPC V4 Tajweed** (one per mushaf page, `p1.woff2`–`p604.woff2`), used to render letter-by-letter tajweed colours.

**Source:** QUL (Quranic Universal Library — qul.tarteel.ai), resource 240
- Resource page: https://qul.tarteel.ai/resources/font/240
- Copyright page: https://qul.tarteel.ai/resources/240/copyright
- Download CDN: `https://static-cdn.tarteel.ai/qul/fonts/quran_fonts/v4-tajweed/woff2/p{n}.woff2`

**Companion data:** `apps/web/public/quran-mushaf-v4-tajweed.json` — the word-by-word "V4 Glyphs (With Tajweed)" script (QUL resource 47, https://qul.tarteel.ai/resources/quran-script/47), 83,668 words, SHA-256: `40964a1b7932e9a69e0dfc0d58dce3b73e30a803febda119fd6828bcb75fac98`.

**Download date:** 2026-11-08

**License status — UNCLEAR (important):** QUL's copyright page for both the font resource (240) and the data resource (47) says: "We don't have copyright information for this resource." — no clear license has been published for these resources. The QUL platform MIT license covers only the platform software, not the resources. The KFGQPC general font terms (free distribution without modification) are documented for the "Uthmanic Script Hafs" font, not specifically for the V4 Tajweed page fonts — so they are a clue, not proof of license.

**This font and data were bundled by the user's explicit order (2026-11-08), with awareness that the license is unclear.** The font and data are used without any modification.

**Exception — page 328:** `p328.woff2` was missing from the QUL CDN (HTTP 404, while `p328.ttf` and `p328.woff` existed). Its TTF was downloaded from the CDN and converted to WOFF2 with fontTools (lossless TTF → WOFF2 conversion); the glyph count (367) is identical before and after conversion, and the resulting file has a valid `wOF2` magic.
