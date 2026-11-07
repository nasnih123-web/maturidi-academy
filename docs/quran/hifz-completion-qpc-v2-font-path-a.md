# مسیر A بنیاد قرآن (QF) برای فونت واقعی QPC V2 — راستی‌آزمایی موج ۲الف، بخش ۲

> **تاریخ بررسی زنده:** ۲۰۲۶-۱۱-۰۷، ~۱۵:۲۴–۱۵:۳۵ UTC (۱۸:۵۴–۱۹:۰۵ تهران)
> **وضعیت:** فقط تحقیق و راستی‌آزمایی + مستندسازی — **هیچ فونت QCFای دانلود، باندل یا سیم‌کشی نشد**؛ هیچ حسابی ساخته نشد؛ فونت فعلی دست نخورد.
> **شاخه:** `feature/hifz-tarteel-redesign` سر `0a05deb`؛ main ‏`47a50261` دست‌نخورده.
> **این گزارش حقوقیِ رسمی نیست** (not legal advice)؛ جمع‌بندیِ مستندِ منابع رسمیِ قابل‌خواندن است.

## ۰. حکم یک‌خطی

**مسیر A (بنیاد قرآن) از نظر حقوقی واقعی و قابل پیاده‌سازی است، ولی فعلاً قابل سیم‌کشی نیست — چون حساب Developer Console وجود ندارد.**

- فونت‌های QCF V2 از CDN رسمی QF **فقط** با حساب فعال Developer Console + انتساب QF قابل کش/باندل‌اند و فقط به‌عنوان بخش یکپارچهٔ اپ.
- توزیعِ دیتابیسِ ازپیش‌بسته‌بندی‌شده یا bundle زمانِ بیلد **مجاز نیست**؛ نگهداری آفلاینِ محتوای QF فقط از مسیر Content Sync و با sync دست‌کم هر ۷ روز.
- **سؤال باز موج ۱ بسته شد: snapshot ‏`mushafs:1` فیلد `code_v2` ندارد** (تایپ رسمی SDK — §۳). پس حتی با حساب، glyph codes یا باید از API معمولی (زنده، با قید ۱ هفته) گرفته شوند یا معنای فیلد `text` در snapshot با fetch احرازشده بررسی شود.
- تا وقتی حساب نیست، موتور مصحف روی **مسیر B** می‌ماند: layout ‏V2 ‏(روشن) + کلمات تنزیل (CC BY 3.0) + فونت Unicode ‏KFGQPC از بستهٔ رسمی. **هرگز ادعا نمی‌شود فونت QPC V2 استفاده شده است.**

## ۱. شرایط دقیق — نقل‌قول از Developer Terms بنیاد قرآن

منبع: `https://api-docs.quran.com/legal/developer-terms/` — آخرین به‌روزرسانی **۲۰۲۶-۱۰-۱۱**، بازخوانی زنده ۲۰۲۶-۱۱-۰۷.

### ۱٫۱ نگهداری و Content Sync (§۳٫۱ بند ۳)

> «Cache or store QF Content longer than **1 week** unless it is obtained and maintained through the Content Sync APIs […], or consists of font files or Mushaf images cached or bundled as described below. If a content resource is available through Content Sync, **Content Sync is the only permitted path for obtaining and maintaining an offline copy** of that resource […]. When using Content Sync, you must perform a next sync at least every **7 days** when connectivity to QF permits and apply all available changes.»

### ۱٫۲ محتوای ازپیش‌بسته‌بندی‌شده (Prepackaged content)

> «The Content Sync storage exception does not itself authorize distributing a prepackaged database or build-time bundle of QF Content. Section 2.2's redistribution terms apply, except for caching and bundling font files and Mushaf images as described below.»

> «A Developer may cache or bundle font files and Mushaf images obtained through QF APIs or documented CDN URLs for use in an Application if the Developer maintains an active account in the **Developer Console** and credits Quran Foundation in a reasonably accessible place in the Application or its associated credits. The files may be distributed only as an integrated part of the Application. They may not be offered separately to others — for example, through the Developer's own API, asset package, or standalone download.»

### ۱٫۳ فروش / توزیع مجدد (§۲٫۲)

نمایش QF Content در اپ آزاد است؛ فروش، اعطای مجوز فرعی یا توزیع مجددِ محتوا یا دادهٔ خام (به‌عنوان دیتاست، فید، API یا بستهٔ محتوا) فقط با «signed commercial license» جداگانه مجاز است. سروکردن QF Content از بک‌اندِ تحت کنترل توسعه‌دهنده، به‌خودی‌خود توزیع مجدد نیست.

### ۱٫۴ تعهدات جانبی که پیاده‌سازی آینده باید رعایت کند

- توکن/secret فقط سمت سرور؛ هرگز در مرورگر (راهنمای رندر فونت هم همین را می‌گوید).
- Privacy Policy و Terms of Use عمومی برای اپ؛ گزارش رخنهٔ امنیتی ظرف ۲۴ ساعت به QF.
- QF می‌تواند API را با اطلاعِ معمولاً ۳۰روزه تغییر یا منسوخ کند؛ تعلیق/لغو اعتبارنامه در صورت نقض، فوری و بدون مسئولیت است.
- قانون حاکم: ایالت نیویورک.

## ۲. راهنمای Content Sync و رندر فونت — چه چیزی تأیید شد

منابع (بازخوانی زنده ۲۰۲۶-۱۱-۰۷):

- `https://api-docs.quran.com/docs/tutorials/content-sync/getting-started/` — گروه `mushafs` شامل «Mushaf metadata, page mappings, and positioned words» است؛ **«Font files and images are not included»**. `mushafs:1` همان QCF V2 است. محیط production: `https://apis.quran.foundation/content/api/v4`. نیازمند `x-auth-token` و `x-client-id`.
- `https://api-docs.quran.com/docs/tutorials/fonts/font-rendering/` — QCF V2 = ‏`code_v2` + ‏`page_number`، mushaf ‏۱؛ QCF V4 = ‏`code_v2`، mushaf ‏۱۹؛ برای `end` markers باید از فونت Unicode ‏(UthmanicHafs) استفاده شود، نه QCF؛ مقادیر `code_v2` **باید** با `innerHTML` (یا `dangerouslySetInnerHTML` در React) رندر شوند، نه `textContent`.
- URLهای مستند CDN فونت (پایه `https://verses.quran.foundation/fonts/quran`):
  - QCF V2 (۶۰۴ فایل): `hafs/v2/woff2/p{PAGE}.woff2` ،`hafs/v2/woff/p{PAGE}.woff` ،`hafs/v2/ttf/p{PAGE}.ttf` (‏`{PAGE}` ‏۱–۶۰۴)
  - QCF V1: `hafs/v1/...`؛ QCF V4 Tajweed: `hafs/v4/colrv1/...` و `hafs/v4/ot-svg/{light,dark,sepia}/...`
  - Unicode fallback: `hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2` / `.ttf`
  - «Loading fonts from the CDN at runtime is the simplest way… Local font caching and bundling … are also allowed if both of these conditions are met: (1) active Developer Console account, (2) QF credit in the app.»

## ۳. پاسخ سؤال باز موج ۱ — آیا snapshot ‏`mushafs:1` فیلد `code_v2` دارد؟

**خیر — طبق قراردادِ تایپ‌شدهٔ رسمی SDK.**

بررسیِ SDK رسمی جاوااسکریپت `@quranjs/api` (نسخهٔ npm روز ۲۰۲۶-۱۱-۰۷، فایل `dist/verses-DmsWogMz.d.ts`):

```ts
interface MushafWordSnapshotRecord extends Record<string, unknown> {
    recordType: "mushaf_word";
    id: number;
    mushafId: number;
    wordId: number;
    verseId: number;
    sourceVerseId: number | null;
    text: string | null;
    charTypeId: number | null;
    charTypeName: string | null;
    pageNumber: number | null;
    lineNumber: number | null;
    positionInVerse: number | null;
    positionInLine: number | null;
    positionInPage: number | null;
    cssClass: string | null;
    cssStyle: string | null;
}
```

**هیچ فیلد `code_v2` / `codeV2` در رکورد snapshot نیست.** فیلدهای `codeV2` در SDK فقط روی تایپ `Word` در پاسخ API معمولی (verses) هستند، نه snapshot. SDK پایتون رسمی (`quran-foundation-api` ‏۰٫۱۰٫۰) هم برای mushaf هیچ تایپ رکوردی ندارد (فقط `get_mushaf_snapshot()` خام) �� در README می‌گوید: «Mushaf snapshots contain the layout metadata, pages, publicly distributable font assets, and words needed for offline use» و «Mushaf-specific pages and glyphs remain in `mushafs:<id>`» — ولی شکل دقیق رکورد را نمی‌گوید.

دو نکتهٔ ظریف که باید ثبت شود:

1. **معنای `text` در snapshot مستند نیست.** در API معمولی، فیلد `text` کلمه برابر مقدار `code_v2` است (مثال راهنما: `code_v2: "ﱁ"` و `text: "ﱁ"`). ممکن است `text` در snapshot هم همان کد glyph باشد — ولی در تایپ رسمی snapshot این گفته نشده و **فقط با یک fetch احرازشده می‌توان فهمید**، که آن هم نیازمند حساب است. پس این سؤال تا داشتن حساب، باز می‌ماند — ولی دیگر «نامشخصِ کامل» نیست: قرارداد تایپ‌شده می‌گوید `code_v2`ای در کار نیست.
2. **رکوردهای `font_asset` در snapshot هستند.** تایپ `MushafFontAssetSnapshotRecord` شامل `assetKey`، `pageNumber`، `fontFamily`، `format`، `url`، `sha256`، `byteSize`، `version`، `provider`، `licenseName`، `licenseUrl`، `attribution` است — یعنی فونت‌های قابل‌توزیع عمومی از طریق snapshot قابل کشف و اعتبارسنجی‌اند (با هش SHA-256).

**پیامد معماری:** حتی با حساب فعال، «bundle آفلاینِ ایستا» ممکن نیست. glyph یا از snapshot می‌آید (اگر `text` همان glyph باشد — نیازمند تأیید با fetch) یا باید از Content API معمولی (`/verses/by_page/{n}?mushaf=1&words=true&word_fields=code_v2,...`) به‌صورت زنده گرفته شود، با قید ۱ هفته و بدون ساخت کپی آفلاین از پاسخ‌های API معمولی. فونت‌ها از CDN رسمی با کش/باندلِ مجاز (با حساب + انتساب) می‌آیند.

## ۴. حساب Developer Console — چه چیزی وجود ندارد و دقیقاً چه چیزی از کاربر لازم است

### ۴٫۱ وضعیت امروز (راستی‌آزمایی‌شده در کد)

- **هیچ حساب Developer Console و هیچ credentialای در پروژه نیست.** در کد فقط جای خالیِ پیکربندی هست:
  - `apps/api/app/seed.py:386-388` و `apps/api/app/modules/quran/service.py:128-130`: ‏`quran.qf_base_url` = ‏`https://api.quran.com/api/v4`، ‏`quran.qf_client_id` = ‏`""`، ‏`quran.qf_client_secret` = ‏`""` (خالی).
  - `apps/api/app/modules/quran/providers.py:518-527`: ورودی `quran_foundation` با `implemented: False` و `config_only: True` و توضیح «Quran Foundation v4 فقط پیکربندی است (بدون OAuth، بدون محتوای باندل‌شده، بدون کلمه‌به‌کلمه) تا فاز بعد».
  - CRM هم همان دو کلید را با مقدار خالی نشان می‌دهد (`apps/crm/src/lib/quran.ts:197-198`).
- جستجوی کل worktree و مخزن برای `quran.foundation` / `dev-console` / `QF_CLIENT` هیچ credential یا حسابی برنگرداند.
- **هیچ حسابی ساخته نشد** — دستور مأموریت: بدون ساخت حساب؛ ساخت حساب کارِ کاربر است (ایمیل و هویت خودش لازم است).

### ۴٫۲ فهرست دقیق کارهایی که از کاربر لازم است (برای بازکردن مسیر A)

1. **ساخت حساب در Developer Console بنیاد قرآن** (`dev-console.quran.foundation`) با ایمیل خودش و ثبت اپلیکیشن «Maturidi Academy».
2. **ایجاد credentialهای Content API** (‏`client_id` + ‏`client_secret`) برای همان اپلیکیشن؛ secret فقط سمت سرور نگه داشته می‌شود و هرگز در کد مرورگر یا مخزن نمی‌آید.
3. **واردکردن آن‌ها در CRM** — بخش قرآن، کلیدهای ازپیش‌آمادهٔ `quran.qf_client_id` و `quran.qf_client_secret` (جای خالی از قبل هست؛ مقدار جدید لازم است).
4. **انتساب QF در محلِ قابل‌دسترس اپ**، مثلاً «Quran fonts provided by Quran Foundation» + لینک `quran.foundation` (در خواننده/اعتبارات).
5. **پذیرش تعهد عملیاتی sync هر ≤ ۷ روز** (یک cron/job سروری) و حذف محتوای QF در صورت پایان Terms.
6. توجه: `quran.qf_base_url` فعلی (`https://api.quran.com/api/v4`) مربوط به API قدیمی quran.com است، **نه** Content API جدید (`https://apis.quran.foundation/content/api/v4`) — هنگام پیاده‌سازی باید عوض شود (نکته برای عامل پیاده‌سازی).

## ۵. وضعیت فعلی (مسیر B) — چه چیزی اثبات شد

فونتِ در حال استفاده همان فونتِ ازپیش‌موجودِ KFGQPC است و دست نخورد:

| مورد | مقدار (راستی‌آزمایی‌شده ۲۰۲۶-۱۱-۰۷) |
|---|---|
| فایل | `apps/web/public/fonts/UthmanicHafs-v-3.0.ttf` (۳۰۱٬۳۹۶ بایت) + `UthmanicHafs-v-3.0.woff2` |
| SHA-256 ‏TTF | `5c47602425fb4190327ab9e1a2e8ed2f53dceaf595d8ccc29ac32b8b209ad398` — مطابق `THIRD_PARTY_NOTICES.md` |
| SHA-256 ‏WOFF2 | `111b4332b5d54438bb4ea303fec56e254f8c71b5dc338fbf72d9fe6a3ccd2bbd` |
| مجوز | EULA داخلی KFGQPC (استفاده/کپی/توزیع رایگان؛ بدون فروش و بدون تغییر) — متن کامل در گزارش موج ۱ §۴٫۱ |
| فونت QCF در بیلد | **هیچ‌کدام** — `public/fonts/` فقط فونت‌های Unicode ‏KFGQPC و فونت‌های UI را دارد |

**شواهد رندر واقعی** (وب پروداکشن :3000 + ‏API سالم از HEAD روی :8000؛ اسکریپت `~/workspace/quran-hifz-shots-completion/font/shot-font.py`، گزارش `report.json`):

| صفحه | کلمات رندرشده | درخواست WOFF2 | `document.fonts.check` | خانوادهٔ محاسباتی | کلمهٔ صفرعرض | حکم |
|---|---|---|---|---|---|---|
| ۱ (گوشی ۳۹۳px) | ۲۹ | ۲۰۰ | true | KFGQPC… | ۰ | ✅ |
| ۱ (دسکتاپ) | ۲۹ | ۲۰۰ | true | KFGQPC… | ۰ | ✅ |
| ۲ | ۳۶ | ۲۰۰ | true | KFGQPC… | ۰ | ✅ |
| ۲۹۳ | ۱۲۷ | ۲۰۰ | true | KFGQPC… | ۰ | ✅ |
| ۶۰۴ | ۵۸ | ۲۰۰ | true | KFGQPC… | ۰ | ✅ |

شات‌ها: `~/workspace/quran-hifz-shots-completion/font/font-p{1-phone,1-desktop,2-desktop,293-desktop,604-desktop}.png` — بازبینی چشمی صفحه‌های ۱ و ۲۹۳: شکل کلمات، اعراب، علائم وقف و نشان‌های پایان آیه درست‌اند؛ هیچ مربع خالی (tofu) و هیچ fallback ناخواسته‌ای نیست. خط‌شکست‌ها و ترتیب کلمات دقیقاً V2 است (layout روشن).

## ۶. تفاوت‌های بصری باقی‌مانده از نداشتن فونت واقعی QPC V2

چون رندر با فونت Unicode است نه glyphهای صفحه‌ای، این تفاوت‌ها با مصحف چاپی می‌مانند (و با ترتیل هم، تا وقتی مسیر A باز نشود):

1. **شکل حروف/کلمات:** کشیدگی‌ها، ترکیب‌های خاص و فرم دست‌نویس عثمان طه دقیقاً مثل چاپ نیست؛ فونت Unicode شکل استاندارد حروف را می‌دهد.
2. **فاصله‌گذاری خطوط:** عرض خط با فونت Unicode تنظیم می‌شود، نه با عرض glyphهای صفحه‌ای — در بعضی خطوط، پراکندگی کلمات با چاپ فرق می‌کند (خط‌شکست‌ها همان V2 است، ولی «پر بودن» خط ممکن است فرق کند).
3. **علائم پایان آیه:** اعداد آیات در rosetteهای خودمان (SVG) رندر می‌شوند، نه glyph چاپی؛ علائم وقف/سجده/ربع حزب هم با فونت Unicodeاند.
4. **سربرگ سوره:** با SVG جداگانه (CC BY 4.0) رندر می‌شود، نه به‌عنوان بخشی از صفحهٔ چاپی — عمدی و پذیرفته‌شده در مسیر B.
5. **رنگ تجوید:** در حالت مطالعه با رنگ‌های خودمان روی حروف Unicode اعمال می‌شود، نه با فونت V4 Tajweed (که آن هم مجوز نامشخص دارد و جداگانه باید بررسی شود).

**ابهام ازپیش‌موجود (از موج ۱ §۴٫۱، ربطی به این تصمیم ندارد):** EULA فونت فعلی «Modified, Altered» را ممنوع می‌کند و پروژه همین فونت را به WOFF2 تبدیل کرده است (۱٬۵۷۲ گلیف، بدون subset) — تفسیر «تغییر» برای تبدیل فرمت باز است. این ابهام پیش از این بخش بوده و هنگام تماس با KFGQPC باید پرسیده شود.

## ۷. طرح پیاده‌سازی آینده (فقط وقتی حساب هست — در این موج اجرا نشد)

1. **سرور:** Content Sync bootstrap با فیلتر `mushafs:1` (و `quran_core:1` در صورت انتشار عمومی)؛ ذخیرهٔ `next_sync_token`؛ cron سروری هر ≤ ۷ روز برای next sync؛ اعمال row mutations و جایگزینی کامل snapshot در `RESOURCE_INVALIDATE`. توکن/secret فقط سمت سرور (API).
2. **Glyph:** با یک fetch احرازشده بررسی شود `text` در رکوردهای `mushaf_word` همان کد glyph است یا نه. اگر بود، نگاشت `word_id → text` به‌عنوان glyph؛ اگر نبود، fetch زندهٔ `code_v2` از `/verses/by_page/{n}?mushaf=1&words=true&word_fields=code_v2,text_qpc_hafs` با کش حداکثر ۱ هفته و بدون ذخیرهٔ دائم. در هر دو حالت، اعتبارسنجی در برابر `quran-mushaf-v2.json` (۸۳٬۶۶۸ کلمه، ۶۰۴ صفحه، ۹٬۰۴۶ خط).
3. **فونت:** per-page WOFF2 از CDN رسمی (`hafs/v2/woff2/p{PAGE}.woff2`) برای وب و TTF (`hafs/v2/ttf/p{PAGE}.ttf`) برای موبایل؛ بارگذاری تنبل فقط برای صفحه‌های دیده‌شده از طریق رجیستریِ موجود در `apps/web/lib/quran-mushaf-font.ts` — یک provider تازهٔ `qcf-v2` با `registerMushafFontProvider` ثبت می‌شود، **بدون تغییر رندرر**؛ سقف کش (`MAX_LOADED_FAMILIES`) و placeholder بدون FOIT از قبل هست؛ `end` markers با UthmanicHafs؛ رندر `code_v2` با `dangerouslySetInnerHTML` (فقط دادهٔ QF، نه ورودی کاربر).
4. **انتساب + ثبت:** افزودن خط انتساب QF در اپ و به‌روزرسانی `THIRD_PARTY_NOTICES.md` (بخش QF) + ثبت هش SHA-256 فونت‌های کش‌شده از رکوردهای `font_asset`.
5. **تست پذیرش:** رندر/شات ۶۰۴ صفحه (یا نمونهٔ مستندشده)، تطبیق glyph با Script، نبود fallback ناخواسته، و تست آفلاینِ پس از sync (بدون bundle زمان بیلد).

## ۸. منابعِ خوانده‌شده (۲۰۲۶-۱۱-۰۷، زنده)

- `https://api-docs.quran.com/legal/developer-terms/` (به‌روزرسانی ۲۰۲۶-۱۰-۱۱)
- `https://api-docs.quran.com/docs/tutorials/content-sync/getting-started/`
- `https://api-docs.quran.com/docs/tutorials/fonts/font-rendering/`
- `https://api-docs.quran.com/docs/sdk/javascript/resources/`
- SDK رسمی پایتون `quran-foundation-api` ‏۰٫۱۰٫۰ (PyPI sdist — فقط خواندن تایپ‌ها) و SDK رسمی جاوااسکریپت `@quranjs/api` (npm — فایل `dist/verses-DmsWogMz.d.ts`، تایپ `MushafWordSnapshotRecord`)
- گزارش موج ۱: `~/workspace/quran-hifz-completion/wave1/license/qpc-v2-license-report-fa.md` (§۷ مسیر A)
- کد: `apps/web/lib/quran-mushaf-font.ts` ،`apps/web/components/QuranMushafV2Page.tsx` ،`apps/api/app/modules/quran/providers.py` ،`apps/api/app/modules/quran/service.py` ،`apps/api/app/seed.py` ،`apps/crm/src/lib/quran.ts`

---
*پایان — موج ۲الف، بخش ۲. حکم: مسیر A واقعی ولی بدون حسابِ کاربر بسته است؛ موتور مصحف روی مسیر B می‌ماند و هیچ ادعای استفاده از فونت QPC V2 نمی‌شود.*
