# QCF_BSML Font — فونت بسملهٔ QCF_BSML

## فارسی

این پوشه شامل فونت **QCF_BSML** (نسخهٔ ۵٫۱۰) است — فونت اختصاصی خطاطیِ «بسمله» از مجموعهٔ فونت‌های مجمع ملک فهد (KFGQPC) که در اکوسیستم قرآن دیجیتال (Quran.com / Quran Foundation) برای خط بسملهٔ آغاز سوره‌ها به کار می‌رود.

**منبع دریافت:** مخزن رسمی Quran Foundation در گیت‌هاب — `quran/quran.com-images`، مسیر `res/fonts/QCF_BSML.TTF` (همان فایلی که ابزار تولید تصاویر Quran.com به‌عنوان فونت پیش‌فرض بسمله استفاده می‌کند). نسخهٔ دومِ مستقل (مخزن `0xzer0x/quran-companion`، مسیر `assets/fonts/QCFV1/QCF_BSML.ttf`) بایت‌به‌بایت یکسان بود و برای راستی‌آزمایی متقابل بررسی شد.

- **SHA-256:** `6a6f234ee351be146e46e897f4cd47610df0b078a82888e5ca15f313f813698c`
- **حجم:** ۳۰۳٬۶۴۴ بایت — **تاریخ دریافت:** ۲۰۲۶-۱۱-۱۲
- **مشخصات فایل (fontTools):** نام داخلی `QCF_BSML`، نسخهٔ 5.10، © King Fahad Complex — ۵۷۴ گلیف، cmap یونیکد کامل (platform 3, encoding 1).

**وضعیت مجوز:** فونت‌های KFGQPC تحت شرایط خود مجمع منتشر می‌شوند: استفاده، کپی و توزیع **رایگان و بدون هیچ تغییری** مجاز است؛ فروش، تغییر، تبدیل قالب و زیرمجموعه‌سازی (subsetting) ممنوع است. به همین دلیل فایل **دقیقاً بایت‌به‌بایت و با همان قالب اصلی TTF** سرو می‌شود — هیچ تبدیل WOFF2 یا زیرمجموعه‌ای روی آن انجام نشده است. متن کامل شرایط در بخش مربوطه در `THIRD_PARTY_NOTICES.md` (ریشهٔ ریپو) ثبت شده است.

**نحوهٔ استفاده در این پروژه:** خط بسملهٔ صفحهٔ مصحف (ریدر) با خانوادهٔ `QCF BSML` رندر می‌شود (`apps/web/app/[locale]/globals.css`، کلاس `.mushaf-bismillah`). متنِ رندرشده ثابتِ عثمانی در `apps/web/lib/quran-basmala.ts` است؛ املای آن دقیقاً همان پیکرهٔ حرفی تنزیل است با یک تفاوت مستند: نشانهٔ الف خنجری (U+0670) در cmap این فونت وجود ندارد (با HarfBuzz راستی‌آزمایی شد: ۰ گلیف گمشده)، پس بسمله در این فونت — مانند خودِ حروف‌چینی دیجیتال KFGQPC با همین فونت — بدون آن نشانه نوشته می‌شود.

## English

This folder contains the **QCF_BSML** font (version 5.10) — the King Fahd Glorious Quran Printing Complex (KFGQPC) dedicated Basmala calligraphy font, used across the digital-Quran ecosystem (Quran.com / Quran Foundation) for the Basmala line at surah openings.

**Provenance:** the Quran Foundation's official GitHub repository `quran/quran.com-images`, path `res/fonts/QCF_BSML.TTF` (the same file the Quran.com image generator uses as its default Basmala font). A second independent copy (`0xzer0x/quran-companion`, `assets/fonts/QCFV1/QCF_BSML.ttf`) was byte-identical and was used as a cross-check.

- **SHA-256:** `6a6f234ee351be146e46e897f4cd47610df0b078a82888e5ca15f313f813698c`
- **Size:** 303,644 bytes — **Downloaded:** 2026-11-12
- **File facts (fontTools):** internal name `QCF_BSML`, version 5.10, © King Fahad Complex — 574 glyphs, full Unicode cmap (platform 3, encoding 1).

**Licence status:** KFGQPC fonts are distributed under the Complex's own terms: use, copying and distribution are permitted **free of charge and unmodified**; sale, modification, format conversion and subsetting are prohibited. The file is therefore served **byte-identical, in its original TTF format** — no WOFF2 conversion or subsetting has been applied. The full record is in `THIRD_PARTY_NOTICES.md` (repo root).

**Use in this project:** the mushaf page's Basmala line (reader) renders in the `QCF BSML` family (`apps/web/app/[locale]/globals.css`, `.mushaf-bismillah`). The rendered text is the fixed Uthmani constant in `apps/web/lib/quran-basmala.ts`; its spelling is exactly the Tanzil consonantal body with one documented difference: the dagger-alef mark (U+0670) does not exist in this font's cmap (HarfBuzz-verified: 0 missing glyphs), so — as in KFGQPC's own digital typesetting with this font — the Basmala is written without that mark.
