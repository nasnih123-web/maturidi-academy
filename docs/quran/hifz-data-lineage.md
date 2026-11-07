# منبع حقیقت متن و lineage داده‌های قرآن — فاز ۴ «برابری حفاظ با ترتیل»

- تاریخ: ۲۰۲۶-۱۱-۰۷
- مخزن: `nasnih123-web/maturidi-academy`
- Worktree: `~/workspace/quran-hifz-parity`
- شاخه: `feature/hifz-tarteel-parity`
- مبنا: main `47a50261` (مرج PR #114)
- قاعدهٔ کار: فقط پژوهش و راستی‌آزمایی؛ هیچ کد production تغییر نکرده، هیچ فایلی bundle نشده است.
- سند همراه: `hifz-fonts-and-mushaf.md` (پروفایل‌های مصحف، فونت‌ها، مقایسهٔ layout)

## ۱. منبع حقیقت متن: Tanzil Uthmani v1.1

تنها متن عربی خودمیزبان و تنها «منبع حقیقت» (source of truth) در مخزن، فایل زیر است:

| مورد | مقدار |
|---|---|
| فایل | `apps/api/app/modules/quran/data/tanzil_uthmani.txt` |
| منبع | Tanzil Project (`tanzil.net`) |
| نسخه | Uthmani v1.1 |
| روایت | حفص از عاصم (Hafs 'an 'Asim) |
| رسم‌الخط | عثمانی (Uthmani) |
| نظام شماره‌گذاری | کوفی — بسملهٔ فاتحه آیهٔ ۱ است؛ سورهٔ ۹ (توبه) بسمله ندارد |
| مجوز | Creative Commons Attribution 3.0 + شرط «بدون تغییر» (verbatim only) |
| گزینه‌های دانلود | pause marks روشن، sajdah روشن، rub-el-hizb خاموش، tatweel روشن، قالب `txt-2` |

### ۱٫۱ راستی‌آزمایی مستقل (۲۰۲۶-۱۱-۰۷)

| بررسی | نتیجه |
|---|---|
| SHA-256 | `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f` — **مطابق مقدار شناخته‌شده** (و مطابق `THIRD_PARTY_NOTICES.md`) |
| اندازه | **۱٬۳۹۶٬۰۸۷ بایت** — مطابق مقدار شناخته‌شده |
| خط‌ها | **۶٬۲۶۶ خط** = ۶٬۲۳۶ خط داده (`سوره\|آیه\|متن`) + ۳۰ خط سربرگ (۲۸ خط توضیح کپی‌رایت با `#` + ۲ خط خالی) |
| سوره‌ها | **۱۱۴** سوره |
| آیه‌ها | **۶٬۲۳۶** رکورد، کلیدهای `(سوره، آیه)` یکتا، ۰ متن خالی |
| نمونهٔ شمارش | فاتحه ۷ آیه (۱:۱ بسمله)؛ بقره ۲۸۶؛ توبه ۱۲۹ (آیهٔ ۱ بدون بسمله)؛ یس ۸۳؛ اخلاص ۴؛ ناس ۶ |

> **هشدار شمارش:** «۶٬۲۳۶ خط» یعنی خط‌های داده. فایل روی دیسک ۶٬۲۶۶ خط دارد؛ هر اسکریپتی که خط‌های فایل را بشمرد باید خط‌های سربرگ را کنار بگذارد (loader همین کار را می‌کند). عدد ۶٬۲۳۶ را در کد hard-code نکنید؛ loader در زمان بارگذاری ۱۱۴ سوره و ۶٬۲۳۶ آیه را اعتبارسنجی می‌کند و در غیر این صورت ۵۰۳ می‌دهد (بخش ۲).

### ۱٫۲ بارگذاری و اعتبارسنجی در کد

- `apps/api/app/modules/quran/providers.py` — `_load_tanzil_text()` (lazy، thread-safe): فقط خط‌های منطبق با `^(\d+)\|(\d+)\|(.*)$` خوانده می‌شوند؛ سربرگ کپی‌رایت نادیده گرفته می‌شود. اگر ۱۱۴ سوره یا ۶٬۲۳۶ آیه نباشد، `QuranProviderError` (۵۰۳) می‌دهد. فایل **سمت سرور** است و هرگز در باندل وب نمی‌آید. `SelfHostedProvider` فقط نوع `text` را سرو می‌کند؛ ترجمه/تفسیر/صوت از providerهای خودشان می‌آیند.
- `apps/api/app/modules/quran/hifz_mapping.py` — `_load_tanzil()` همان regex و همان اعتبارسنجی (۱۱۴ / ۶٬۲۳۶) را برای نگاشت واج‌به‌کلمه تکرار می‌کند.
- متن ذخیره‌شده **هرگز تغییر نمی‌کند**: نرمال‌سازی جستجو و تقسیم نمایشی ۶/۷ فاتحه فقط در زمان نمایش/ایندکس انجام می‌شود، نه روی متن ذخیره‌شده.

### ۱٫۳ تفکیک «متن نمایشی» از «لایهٔ نرمال‌سازی مقایسه»

| لایه | کجا | چه می‌کند |
|---|---|---|
| متن ذخیره‌شده | `tanzil_uthmani.txt` | عثمانی کامل: حرکات، تشدید، همزه، الف خنجری (U+0670)، علائم وقف (U+06D6–U+06ED)، تطویل (U+0640) — دست‌نخورده |
| نرمال‌سازی تطابق ASR | `apps/api/app/modules/quran/alignment.py` — `normalize_arabic_word()` / `strip_diacritics()` | فقط برای **مقایسه**: حذف حرکات (U+064B–U+0652)، مدّه/همزهٔ بالا و پایین (U+0653–U+0655)، الف خنجری (U+0670)، علائم عربی (U+0610–U+061A)، علائم قرآنی وقف (U+06D6–U+06ED) و تطویل؛ تا کردن الف (آ أ إ ٱ ← ا)، یاء (ى ئ ← ي)، واو (ؤ ← و)، تاء مربوطه (ة ← ه)؛ فقط حروف عربی (category `Lo`) نگه داشته می‌شود. `expected_text` ذخیره‌شده همچنان شکل عثمانی اصلی را دارد |
| تعدیل کلمات حفاظ | `hifz_mapping.py` — `_split_adjusted()` | تقسیم بر اساس whitespace روی متن Tanzil، با دو تعدیل: (۱) حذف ۴ کلمهٔ بسمله از ابتدای آیهٔ ۱ (جز سوره‌های ۱ و ۹)؛ (۲) حذف نشانه‌های وقفِ تنها (ۖ ۗ ۘ ۙ ۚ ۛ ۜ). ترتیب حفظ و نگاشت شاخص یک‌به‌یک است |
| نمایش فاتحه ۶/۷ | لایهٔ نمایش وب | بسمله سربرگ بدون شماره (حنفی) در برابر شمارش ۷ آیه‌ای در صفحهٔ مطالعه — تصمیم نمایشی، نه تغییر متن |

### ۱٫۴ موجودی نویسه‌های خاص در متن (شمارش مستقیم از فایل)

| نویسه | کد | تعداد | توضیح |
|---|---|---|---|
| الف خنجری | U+0670 | ۹٬۸۳۸ | |
| تطویل | U+0640 | ۶٬۸۴۸ | گزینهٔ دانلود: روشن |
| تشدید | U+0651 | ۲۳٬۰۱۶ | |
| همزهٔ بالا | U+0654 | ۷۷۳ | |
| علامت وقف ۟ | U+06DF | ۳٬۹۸۸ | |
| ۠ | U+06E0 | ۶۶ | |
| ۢ | U+06E2 | ۵۱۰ | |
| ۭ | U+06ED | ۹۹ | |
| ۖ | U+06D6 | ۱٬۶۸۲ | |
| ۗ | U+06D7 | ۶۰۳ | |
| ۘ | U+06D8 | ۲۲ | |
| ۙ | U+06D9 | ۶۸ | |
| ۚ | U+06DA | ۱٬۹۷۲ | |
| ۛ | U+06DB | ۱۲ | |
| ۜ | U+06DC | ۷ | |
| U+06DD (پایان آیه) | U+06DD | **۰** | در Tanzil نیست؛ نشانهٔ پایان آیه در فایل‌های QUL جداگانه می‌آید (بخش ۳) |
| U+08F0–U+08F2 | — | ۰ | |

### ۱٫۵ مجوز و attribution (Tanzil)

- **مجوز:** CC BY 3.0؛ کپی لفظ‌به‌لفظ آزاد، **تغییر ممنوع**؛ منبع (Tanzil Project) باید صریح ذکر شود + لینک به `tanzil.net`؛ بلوک کپی‌رایت (`Copyright (C) 2007-2026 Tanzil Project`) در همهٔ کپی‌ها حفظ شود — بلوک در فایل ذخیره‌شده دست‌نخورده است.
- **Attribution در محصول:** خط نمایان پایین خوانندهٔ قرآن («Arabic text: Tanzil Project (tanzil.net), CC BY 3.0»، بومی‌سازی‌شدهٔ fa/ar/en) وقتی provider خودمیزبان متن را سرو می‌کند.
- **مقایسهٔ قبلی با AlQuran Cloud** (ثبت‌شده در `THIRD_PARTY_NOTICES.md`، راستی‌آزمایی ۲۰۲۶-۱۱-۰۴): ۱٬۳۲۰ آیه byte-identical؛ ۴٬۹۱۱ آیه فقط در علائم متفاوت (کلمات یکسان)؛ ۳ آیه فقط در فاصله («بَعْدَ مَا» در برابر «بَعْدَمَا»)؛ ۲ آیه در یک حرف (الف خنجری در برابر الف مقصوره در «صَاحِبَيِ»، ۱۲:۳۹ و ۱۲:۴۱)؛ ۰ عدم‌تطابق محتوای کلمه. جزئیات: `tanzil-diff-report.json` (گزارش worktree، ship نمی‌شود).

## ۲. نظام‌های شماره‌گذاری — هر مصحف شمارش خودش را دارد

عدد ۶٬۲۳۶ **فقط شمارش کوفی/حفص** است و نباید به‌عنوان ثابت سراسری hard-code شود. شمارش آیه در هر روایت از `surah.json` همان مصحف خوانده می‌شود:

| مصحف (quran-ws/quran-svg) | آیه‌ها | منبع شمارش |
|---|---|---|
| Hafs (`hafs/kfqc`) | ۶٬۲۳۶ | Tanzil + `surah.json` همان مصحف |
| Warsh (`warsh/kfqc`) | ۶٬۲۱۴ | `surah.json` همان مصحف |
| Qalun (`qalon/kfqc`) | ۶٬۲۱۴ | `surah.json` همان مصحف |
| Duri (`douri/kfqc`) | ۶٬۲۱۸ | `surah.json` همان مصحف |
| Shubah (`shubah/kfqc`) | ۶٬۲۳۶ | `surah.json` همان مصحف |

قاعدهٔ کد (`apps/web/lib/quran-svg-page.ts`): شمارهٔ صفحه **per-mushaf** است و هرگز بین روایت‌ها جابه‌جا نمی‌شود (Warsh ص ۴۲ با ۲:۲۵۱ شروع می‌شود، Hafs ص ۴۲ با ۲:۲۵۳). مرجع آیه بدون روایتش مرجع کامل نیست؛ کلید مصحف همیشه همراه شمارهٔ صفحه می‌گردد (deep link، bookmark، resume). ترجمه/تفسیر/صوت برنامه با شماره‌گذاری حفص ایندکس شده‌اند و بدون نگاشت تأییدشده (Qiraat Ayah Map) به مرجع غیرحفص وصل نمی‌شوند.

## ۳. فایل‌های JSON دانلودشدهٔ QUL — ساختار واقعی و تفاوت‌ها

پنج فایل در `~/workspace/qul-downloads/` (خارج از مخزن؛ **bundle نشده‌اند**):

| فایل | بایت | SHA-256 (کامل در §۳٫۵) |
|---|---|---|
| `qpc-v4.json` | ۷٬۸۲۴٬۹۰۴ | `40964a1b…` |
| `digital-khatt-v2.json` | ۸٬۸۹۲٬۵۲۹ | `c7f72b9b…` |
| `qpc-hafs-word-by-word.json` | ۸٬۸۴۱٬۴۱۷ | `f3662692…` |
| `digital-khatt-indopak.json` | ۸٬۸۹۷٬۲۰۷ | `51d6ff91…` |
| `qpc-nastaleeq.json` | ۸٬۸۷۸٬۳۴۱ | `97e37799…` |

### ۳٫۱ ساختار (هر پنج فایل یکسان)

- آبجکت JSON با کلید `surah:ayah:word` (مثلاً `1:1:1`)؛ مقدار آبجکتی با فیلدهای: `id` (عدد، ۱ تا ۸۳٬۶۶۸، پیوسته)، `surah` (رشته)، `ayah` (رشته)، `word` (رشته)، `location` (برابر کلید)، `text` (متن کلمه).
- هر پنج فایل **دقیقاً ۸۳٬۶۶۸ کلمه**، مجموعهٔ کلید یکسان، `id` پیوستهٔ ۱ تا ۸۳٬۶۶۸، و `key == location` در همهٔ رکوردها.
- ۱۱۴ سوره؛ بیشینهٔ آیه: ۱:۷، ۲:۲۸۶، ۹:۱۲۹، ۱۱۴:۶ — همان شماره‌گذاری کوفی/حفص.

### ۳٫۲ سه تفاوت ساختاری با Tanzil (مهم برای حفاظ)

1. **بسمله جزو آیهٔ ۱ نیست.** در QUL کلمات بسمله در آیهٔ ۱ سوره‌های ۲ تا ۱۱۴ نیامده‌اند (در layout بسمله یک `line_type` جداست، نه بخشی از آیه). در Tanzil بسمله داخل متن آیهٔ ۱ همان سوره‌ها آمده و `_split_adjusted` آن را حذف می‌کند. (نمونه: QUL ‏`2:1:1` = `الٓمٓ`؛ Tanzil ‏`2:1` با بسمله شروع می‌شود.)
2. **نشانهٔ پایان آیه یک «کلمه» است.** هر آیه دقیقاً یک کلمهٔ نشانه دارد (عدد عربی + ‎U+06DD یا فقط عدد)؛ **۶٬۲۳۶ کلمهٔ نشانه**، و هر ۶٬۲۳۶ آیه با کلمهٔ نشانه تمام می‌شوند. در Tanzil چنین توکنی نیست.
3. **نشانه‌های وقف به کلمهٔ قبل چسبیده‌اند** (مثلاً `ٱلۡقَيُّومُۚ`)، در حالی که در Tanzil نشانهٔ وقفِ تنها یک توکن جداگانه با whitespace است (مثلاً `ۚ`).

### ۳٫۳ حساب واژه‌ها — چرا ۸۳٬۶۶۸ با ۸۲٬۲۶۰ فرق دارد

| | تعداد |
|---|---|
| توکن‌های whitespace در Tanzil | ۸۲٬۲۶۰ |
| + کلمه‌های نشانهٔ پایان آیه (QUL) | +۶٬۲۳۶ |
| − کلمات بسملهٔ داخل آیهٔ ۱ (۱۱۲ سوره × ۴) | −۴۴۸ |
| − توکن‌های وقفِ تنها که در QUL چسبیده‌اند | −۴٬۳۶۴ |
| − تفاضل خالص segmentation دیگر (ادغام/تفکیک کلمات) | −۱۶ |
| **= کلمات QUL** | **۸۳٬۶۶۸** |

نتیجهٔ عملی: **شناسه‌های کلمهٔ QUL با تقسیم whitespace در Tanzil قابل‌تعویض نیستند.** در ۴٬۶۳۵ آیه از ۶٬۲۳۶ آیه، شمار کلمات QUL (`qpc-hafs`) با شمار توکن‌های Tanzil فرق دارد. نگاشت واج‌به‌کلمهٔ حفاظ روی تقسیم Tanzil ساخته شده (`hifz_mapping.py: _split_adjusted`)؛ استفاده از `id`های QUL در برابر آن نگاشت، بدون جدول تبدیل، کلمات را جابه‌جا نشان می‌دهد. (نمونه: ۲:۲۵۵ در QUL ‏۵۱ کلمه، در Tanzil ‏۵۸ توکن؛ ۲:۲ در QUL ‏۸ کلمه، در Tanzil ‏۹ توکن.)

### ۳٫۴ تفاوت `text` بین نسخه‌ها (نمونه‌برداری)

تفاوت جفتی (از ۸۳٬۶۶۸ کلمه):

| | digital-khatt-v2 | qpc-hafs | qpc-nastaleeq | qpc-v4 |
|---|---|---|---|---|
| **digital-khatt-indopak** | ۵۹٬۸۸۹ | ۷۲٬۴۳۷ | ۱۷٬۸۲۲ | ۸۳٬۶۶۸ |
| **digital-khatt-v2** | — | ۵۱٬۶۴۳ | ۶۲٬۹۷۴ | ۸۳٬۶۶۸ |
| **qpc-hafs** | — | — | ۶۸٬۵۵۳ | ۸۳٬۶۶۸ |
| **qpc-nastaleeq** | — | — | — | ۸۳٬۶۶۸ |

نمونه‌ها (۱:۱):

| کلید | digital-khatt-v2 | qpc-hafs | digital-khatt-indopak | qpc-nastaleeq | qpc-v4 |
|---|---|---|---|---|---|
| ۱:۱:۱ | بِسْمِ | بِسۡمِ | بِسْمِ | بِسْمِ | ﱁ (لیگاچر) |
| ۱:۱:۲ | ٱللَّهِ | ٱللَّهِ | اللّٰهِ | اللّٰهِ | ﱂ |
| ۱:۱:۳ | ٱلرَّحْمَٰنِ | ٱلرَّحۡمَٰنِ | الرَّحْمٰنِ | الرَّحْمٰنِ | ﱃ |
| ۱:۱:۵ (نشانه) | ‎١ U+06DD | ١ | ‎U+06DD | ١ | ﱅ |

نکته‌های نسخه‌ای:

- **qpc-v4**: هر ۸۳٬۶۶۸ کلمه **یک لیگاچر واحد** در بازهٔ Arabic Presentation Forms-B (U+FCxx) است — متن Unicode نیست و **فقط با فونت V4 Tajweed** خوانده می‌شود؛ بدون آن فونت، کاراکترها بی‌معنا نمایش داده می‌شوند. با هر چهار فایل دیگر ۱۰۰٪ تفاوت دارد.
- **qpc-hafs در برابر digital-khatt-v2**: تفاوت در جزئیات رسم‌الخط است (مثلاً `بِسۡمِ` با ۡ در برابر `بِسْمِ` با سکون؛ `ٱلرَّحۡمَٰنِ` در برابر `ٱلرَّحْمَٰنِ`) — این‌ها دو رسم‌الخط متفاوت‌اند، نه دو رندر از یک متن.
- **indopak / nastaleeq**: شکل حروف متفاوت است (ی فارسی `یٰمُوْسٰی`، `الرَّحْمٰنِ` با الف کوچک، `اللّٰهِ`) و نشانه‌های وقف به شکل دیگری می‌آیند (مثلاً `١ﶔ`، `۟ۙ`).
- **digital-khatt-v2 در برابر متن خطوط مصحف ما**: فایل خطوط ما (`quran-mushaf-lines.json`) متن Tanzil را دارد (مثلاً `ٱلْعَـٰلَمِينَ` با تطویل)؛ Digital Khatt V2 همان کلمه را `ٱلْعَٰلَمِينَ` (بدون تطویل) می‌نویسد. پس **شکست خط‌ها با V2 یکی است، رسم‌الخط متن یکی نیست** (جزئیات در سند همراه).

### ۳٫۵ SHA-256 کامل فایل‌های QUL (راستی‌آزمایی ۲۰۲۶-۱۱-۰۷)

| فایل | SHA-256 |
|---|---|
| `qpc-v4.json` | `40964a1b7932e9a69e0dfc0d58dce3b73e30a803febda119fd6828bcb75fac98` |
| `digital-khatt-v2.json` | `c7f72b9b5969006a86ba0ea4307d7262ca5e4522a4ce92b82a1fa531e919775b` |
| `qpc-hafs-word-by-word.json` | `f366269234e24f322146c043fe5fbf0132990613a94aff4b3f23847f45793ea7` |
| `digital-khatt-indopak.json` | `51d6ff9120a1d374f07d8f51482b8400d09a1af0ce570a8475a666b973a8072e` |
| `qpc-nastaleeq.json` | `97e37799459a8963d51b016664e5c46cbd06d6cc1dde1cb4d7cd90e3ab94ca6b` |

این فایل‌ها **خارج از مخزن** و **bundle نشده** نگه داشته شده‌اند.

## ۴. QUL — کاتالوگ جاری و وضعیت مجوز (بررسی ۲۰۲۶-۱۱-۰۷)

### ۴٫۱ دو نظام شناسه — اخطار مهم

QUL دو شماره‌گذاری متفاوت دارد که نباید قاطی شوند:

| نظام | مثال | کجا دیده می‌شود |
|---|---|---|
| **شناسهٔ ابزار (tool)** | Madinah V2 = `mushaf_layouts/1` | صفحهٔ ابزار layout در سایت |
| **شناسهٔ منبع (resource)** | KFGQPC V2 layout = `resources/mushaf-layout/10` | صفحهٔ دانلود منبع + issue #596 گیت‌هاب |

جدول §۲۰٫۲ سند مأموریت («Madinah V2=1») شناسهٔ **ابزار** را می‌دهد، نه شناسهٔ منبع دانلود. شناسه‌های زیر در ۲۰۲۶-۱۱-۰۷ با `browser.open` راستی‌آزمایی شدند:

| شناسهٔ ادعاشده | نتیجهٔ بررسی جاری |
|---|---|
| layout: Digital Khatt V2 = ۲۱ | ✅ تأیید — `resources/mushaf-layout/21` «Digital Khatt (KFGQPC V2 1421H print) layout»؛ کپی دقیق V2 با script/font دیجیتال‌خط |
| layout: KFGQPC V4 = ۱۹ | ✅ تأیید — `resources/mushaf-layout/19` «KFGQPC V4 layout (1441H print)»، ۶۰۴ ص، ۱۵ خط، glyph-based؛ «V4 Tajweed fonts are currently disabled, we're proofreading them» |
| layout: Indopak 15-line Qudratullah = ۱۲ | ✅ تأیید — `resources/mushaf-layout/12`، ۶۱۰ صفحه، ۱۵ خط، انتشارات قدرة‌الله لاهور؛ changelog: اصلاح ص ۴۴۳ و ۴۷۲ در ۲۰۲۶-۰۹-۳۰ |
| layout: Madinah V2 = ۱ | ⚠️ شناسهٔ **ابزار** (`mushaf_layouts/1`)، نه منبع؛ منبع دانلود همان layout = **۱۰** |
| layout: Madinah V1 = ۲ | ❌ **تأیید نشد** — `resources/mushaf-layout/2` در ۲۰۲۶-۱۱-۰۷ خطای HTTP 500 داد (سه تلاش). نبودِ صفحه اثبات نشده؛ فقط «در این بررسی باز نشد». (V1 به‌عنوان منبع جدا در ۱۵ تأیید شد — پایین را ببینید) |
| layout: Indopak 16-line Taj = ۷ | ❌ **شناسهٔ اشتباه در این مسیر** — `resources/mushaf-layout/7` صفحهٔ «Surah Info - Malayalam» است، نه layout. ۷ احتمالاً شناسهٔ ابزار است، نه منبع |
| layout: QPC Hafs Nastaleeq 15-line = ۱۴ | ❌ **تأیید نشد** — `resources/mushaf-layout/14` در ۲۰۲۶-۱۱-۰۷ خطای HTTP 500 داد (سه تلاش) |
| layout: QPC Hafs Nastaleeq 16-line = ۱۵ | ⚠️ `resources/mushaf-layout/15` **KFGQPC V1 layout (1405H print)** است (۶۰۴ ص، ۱۵ خط) — نه Nastaleeq 16-line. ۱۵ احتمالاً شناسهٔ ابزار است، نه منبع |
| layout: KFGQPC 1421 Hafs Unicode = ۲۷ | ❌ **شناسهٔ اشتباه در این مسیر** — `resources/mushaf-layout/27` صفحهٔ «Tafseer Al-Baghawi» است، نه layout |
| layout: KFGQPC V2 = ۱۰ | ✅ تأیید — `resources/mushaf-layout/10` «KFGQPC V2 layout (1421H print)»، ۶۰۴ ص، ۱۵ خط |
| layout: KFGQPC V1 = ۱۵ | ✅ تأیید — همان‌طور که بالا آمد (۱۴۰۵هـ) |

فونت‌ها (همه با `browser.open` در ۲۰۲۶-۱۱-۰۷ تأیید شدند):

| شناسه | نام در QUL | نوع | نکته |
|---|---|---|---|
| font ۲۴۵ | QPC Hafs font | Unicode text | فونت رسمی عثمانی مجمع، همراه script ‏QPC Hafs؛ دانلود: font pack / woff2 / ttf |
| font ۲۴۰ | QPC V4 Tajweed Font | Page by Page، glyph-based | هر گلیف = یک کلمه؛ پیش‌نمایش PUA (ﱁﱂ…)؛ دانلود woff2/woff/ttf |
| font ۲۴۲ | Indopak Nastaleeq font | Unicode text، With Waqf Lazmi | منابع مرتبط: Indopak 15 lines (Qudratullah)، 13 lines (Taj)، 13 lines (Qudratullah) |
| font ۵۶۸ | Digital Khatt Indopak font | variable، otf | فونت متغیر دیجیتال‌خط؛ دانلود فقط otf |
| font ۴۶۲ | KFGQPC Nastaleeq | (Quran) | منبع مرتبط: QPC Nastaleeq script - Word by Word |
| font ۲۴۹ | QPC V2 Font | Page by Page | **۶۰۴ فونت جدا**، یکی برای هر صفحه؛ هر گلیف = یک کلمه (لیگاچر) |
| font ۲۳۸ | QPC V1 Font | Page by Page | ۶۰۴ فونت جدا؛ changelog فعال: اصلاح ص ۲۴۴ و ۹۸ در اکتبر ۲۰۲۶ |
| font ۲۴۷ | Digital Khatt V2 Font | variable | **در فهرست مأموریت نبود** — فونت متغیر دیجیتال‌خط، سازگار با Madani 1420H؛ از لینک مرتبط منبع ۴۸ پیدا شد |

اسکریپت‌ها:

| شناسه | نام در QUL | نکته |
|---|---|---|
| script ۴۸ | Digital Khatt V2 script - Word by word | پیش‌نمایش ۷۳:۴: `أَوْ, زِدْ, عَلَيْهِ, وَرَتِّلِ, ٱلْقُرْءَانَ, تَرْتِيلًا, ٤`؛ دانلود json/sqlite |
| script ۴۷ | V4 Glyphs (With Tajweed) - Word by word | پیش‌نمایش ۷۳:۴ به‌صورت لیگاچرهای PUA (ﱏﱐﱑ…)؛ دانلود json/sqlite |

### ۴٫۲ مجوز QUL — جمع‌بندی

| دسته | وضعیت در صفحهٔ منبع (۲۰۲۶-۱۱-۰۷) | نتیجه |
|---|---|---|
| اسکریپت‌ها (۴۷، ۴۸) | **هیچ بخش مجوز/کپی‌رایتی در صفحه نیست**؛ فقط Tags، Download Links، پیش‌نمایش، Related resources | **نامشخص — bundle ممنوع تا تعیین مجوز** |
| فونت‌ها (۲۳۸، ۲۴۰، ۲۴۲، ۲۴۵، ۲۴۷، ۲۴۹، ۴۶۲، ۵۶۸) | **هیچ بخش مجوز/کپی‌رایتی در صفحه نیست** | **نامشخص — bundle ممنوع تا تعیین مجوز** |
| Layoutها (۱۰، ۱۲، ۱۵، ۱۹، ۲۱) | **هیچ بخش مجوز/کپی‌رایتی در صفحه نیست** | **نامشخص در صفحهٔ منبع**؛ اما اظهار maintainer (پایین) برای layoutها |

- گزارش قبلی که صفحات ۴۷ و ۴۸ گفته‌اند «We don't have copyright information for this resource» در بررسی جاری **تأیید نشد**: در متن واکشی‌شدهٔ ۲۰۲۶-۱۱-۰۷ اصلاً بخش مجوز وجود ندارد — نه جملهٔ مذکور و نه مجوز دیگر. وضعیت عملی همان است: **مجوز نامشخص**.
- **اظهار maintainer برای layoutها:** Issue #596 در `TarteelAI/quranic-universal-library` («Licensing clarification — Madinah V2 layout (mushaf-layout/10)»، باز ۲۰۲۶-۰۵-۰۵، بسته ۲۰۲۶-۰۵-۰۶): پاسخ maintainer — «All layouts, including Madinah V2, are available for free and can be used in both personal and commercial projects. You're welcome to bundle the SQLite in your app, use it offline, modify it, or transform it into other formats as needed. Attribution is optional.» — این یک **کامنت گیت‌هاب** است، نه فایل مجوز؛ و فقط **layoutها** را پوشش می‌دهد، نه اسکریپت و فونت. در صفحهٔ issue که واکشی شد فقط متن سؤال دیده شد و پاسخ در snippet جستجو آمده است؛ برای استناد رسمی باید متن کامل issue خوانده شود.
- **FAQ #9** (به‌نقل از issue #596): «commercial use permitted with per-resource license review» — یعنی استفادهٔ تجاری منوط به بررسی مجوز هر منبع است؛ و صفحهٔ منبع فعلاً مجوزی نشان نمی‌دهد.
- **نتیجهٔ عملی:** تا وقتی مجوز self-host/mirror برای یک منبع QUL به‌صورت کتبی تأیید نشده، **دانلود و bundle ممنوع** است — شامل هر پنج فایل JSON §۳ و همهٔ فونت‌های QUL. استثنا فقط **شکست خط‌های Madinah V2** است که در `quran-mushaf-lines.json` از قبل آمده و attribution آن در `quran-mushaf-lines.ts` نگه داشته شده است (اظهار maintainer در #596 + «intended for you to download and package» در بیانیهٔ پلتفرم؛ همچنان بدون فایل مجوز رسمی — در سند همراه، بخش layout را ببینید).

### ۴٫۳ Schema واقعی QUL (از مستندات `qul.tarteel.ai/docs/mushaf-layout`)

برای رندر یک layout لازم است: (۱) script کلمه‌به‌کلمه، (۲) فونت سازگار با آن script، (۳) دادهٔ layout، (۴) نام سوره‌ها.

- **جدول `pages`:** ‏`page_number`، ‏`line_number`، ‏`line_type` (`ayah` | `surah_name` | `basmallah`)، ‏`is_centered` (bool)، ‏`first_word_id`، ‏`last_word_id`، ‏`surah_number`.
- **جدول `words`:** ‏`word_index` (شناسهٔ یکتا؛ مرجع `first/last_word_id`)، ‏`word_key` (به‌صورت `surah:ayah:word`)، ‏`surah`، ‏`ayah`، ‏`text`.
- مثال مستندات (ص ۱، V2): ۸ خط — `surah_name` + ۷ خط آیه، با `first/last_word_id` برابر ۱–۵، ۶–۱۰، ۱۱–۱۷، ۱۸–۲۳، ۲۴–۲۹، ۳۰–۳۳، ۳۴–۳۶. همین بازه‌ها در فایل خطوط ما دیده می‌شوند (سند همراه §۴).

## ۵. quran-ws — صفحات چاپی و متن روایت‌ها (live، هرگز bundle نشده)

| مورد | مقدار |
|---|---|
| صفحات SVG | `quran-ws/quran-svg` — `raw.githubusercontent.com/quran-ws/quran-svg/main/mushafs/{key}/svg/{page:03}.svg`؛ یک صفحه در هر بار (ص ۱ حفص ~۱۹۶ KB، ص ۴۲ ~۶۱۸ KB)؛ نسخه‌های brotli (`svg-br/`) کنار فایل‌هاست ولی raw.githubusercontent.com آن‌ها را بدون Content-Encoding سرو می‌کند، پس مسیر زنده فایل ساده را می‌گیرد |
| متن روایت‌ها | `quran-ws/quran-text` — `data/mushaf/{hafs,warsh,qalun,duri,shubah}.json`؛ فقط برای پنل tap در مصحف غیرحفص (کلمات همان روایت، بدون علائم وقف که لایهٔ جدا دارند) |
| لایهٔ چندضلعی آیه + JSON | **CC BY 4.0**، attribution داخل محصول بخشیده شده |
| اثر هنری صفحه | KFGQPC — استفادهٔ دیجیتال/وب/نرم‌افزار/رسانه در سراسر جهان رایگان؛ **تنها محدودیت: چاپ فیزیکی مصحف برای فروش تجاری** (ممنوع؛ محفوظ برای مجمع) |
| دسترسی از ایران | raw.githubusercontent.com از داخل ایران **تأییدنشده**؛ fallback صفحهٔ متنی (خطوط دقیق) load-bearing است، نه تزئینی |
| شمار آیه | از `surah.json` هر مصحف (جدول §۲)؛ شمارهٔ صفحه per-mushaf |

## ۶. lineage هر corpus در یک نگاه

| corpus | منبع | نسخه/روایت | شماره‌گذاری | مجوز | وضعیت در مخزن | checksum |
|---|---|---|---|---|---|---|
| متن عربی اصلی | Tanzil | Uthmani v1.1، حفص | کوفی ۶٬۲۳۶ | CC BY 3.0 (بدون تغییر) | خودمیزبان، سمت سرور | SHA-256 §۱٫۱ ✅ |
| خطوط مصحف | QUL layout (Madinah V2) | حفص، چاپ ۱۴۲۱هـ | کوفی ۶٬۲۳۶ | اظهار maintainer در #596 (بدون فایل مجوز) | bundle شده (فقط شکست خط + متن Tanzil) | — (فایل JSON؛ هش در سند همراه) |
| صفحات چاپی SVG | quran-ws/quran-svg | ۵ روایت KFGQPC | هر مصحف جدا | CC BY 4.0 (لایه) + بیانیهٔ KFGQPC (اثر هنری) | live fetch، بدون bundle | — |
| متن روایت‌های غیرحفص | quran-ws/quran-text | warsh/qalun/duri/shubah | هر مصحف جدا | همان خانوادهٔ quran-ws | live fetch، بدون bundle | — |
| فونت‌های KFGQPC | quran-text data / qurancomplex.gov.sa | v3.0 (حفص/ورش/قالون/شعبه)، v2.0 (دوری) | — | EULA داخل فونت (رایگان؛ بدون تغییر/مهندسی معکوس) | bundle شده در `public/fonts` | TTF ✅، WOFF2 ⚠️ (سند همراه §۳) |
| فایل‌های QUL (۵ JSON) | QUL | حفص/دیجیتال‌خط/نستعلیق | کوفی ۶٬۲۳۶ | **نامشخص** | **bundle نشده؛ ممنوع تا تعیین مجوز** | SHA-256 §۳٫۵ |
| فونت‌های QUL | QUL | — | — | **نامشخص** | **bundle نشده؛ ممنوع تا تعیین مجوز** | — |

## ۷. چک‌لیست راستی‌آزمایی (برای تکرار)

```bash
# متن Tanzil
sha256sum apps/api/app/modules/quran/data/tanzil_uthmani.txt
# انتظار: 6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f
wc -c apps/api/app/modules/quran/data/tanzil_uthmani.txt   # انتظار: 1396087
grep -cE '^[0-9]+\|[0-9]+\|' apps/api/app/modules/quran/data/tanzil_uthmani.txt  # انتظار: 6236
# فایل‌های QUL (خارج از مخزن)
python3 -c "import json; [print(f, len(json.load(open('/home/hatch/workspace/qul-downloads/'+f)))) for f in ['qpc-v4.json','digital-khatt-v2.json','qpc-hafs-word-by-word.json','digital-khatt-indopak.json','qpc-nastaleeq.json']]"
# انتظار: هرکدام 83668
```

## ۸. موارد باز / BLOCKED

1. **مجوز QUL (اسکریپت + فونت): نامشخص — bundle ممنوع.** هیچ صفحهٔ منبع QUL بخش مجوز ندارد؛ اظهار #596 فقط layoutها را پوشش می‌دهد. تعیین مجوز نیازمند تماس کتبی با Tarteel یا انتشار فایل مجوز از سوی QUL است.
2. **شناسه‌های §۲۰٫۲ جدول مأموریت باید اصلاح شوند:** ۷ و ۲۷ در مسیر `resources/mushaf-layout/` منبع layout نیستند؛ ۲ و ۱۴ در این بررسی باز نشدند (HTTP 500)؛ منبع دانلود Madinah V2 عدد **۱۰** است، نه ۱.
3. **فونت V4 در QUL غیرفعال است** («currently disabled, we're proofreading them») — layout ‏۱۹ تا پایان proofreading قابل رندر کامل نیست.
4. **QUL در حال تغییر است:** changelogهای فعال (اصلاح V1 ص ۲۴۴/۹۸ در اکتبر ۲۰۲۶؛ اصلاح Indopak ص ۴۴۳/۴۷۲ در سپتامبر ۲۰۲۶) یعنی هر snapshot از QUL نیازمند revision + تاریخ است؛ «آخرین نسخه» بدون revision قابل‌استناد نیست.
5. **WOFF2های KFGQPC در مخزن با هش‌های ثبت‌شده در `THIRD_PARTY_NOTICES.md` نمی‌خوانند** (TTFها می‌خوانند) — راستی‌آزمایی دوبارهٔ provenance در سند همراه §۳.
