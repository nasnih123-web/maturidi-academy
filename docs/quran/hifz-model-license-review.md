# بررسی مجوز مدل‌های ASR قرآنی — بخش حفاظ آکادمی ماتریدی

> تاریخ بررسی: ۲۰۲۶-۱۱-۰۷ (۱۷ آبان ۱۴۰۵) — ساعت بررسی حدود ۰۳:۳۴ تا ۰۴:۰۰ به‌وقت تهران.
> روش: خواندن مستقیم صفحهٔ اصلی هر مخزن در Hugging Face (مدل‌کارت + فایل `LICENSE` + frontmatter خام `README.md`) و متادیتای API عمومی HF (`https://huggingface.co/api/models/<repo>`).
> نکتهٔ مهم دربارهٔ متادیتا: فیلد `license` در پاسخ API برای **همهٔ** مخزن‌های زیر `None` برگشت؛ پس مرجع این سند فایل `LICENSE` و frontmatter خوانده‌شدهٔ مستقیم است، نه فیلد API.
> این سند مشاورهٔ حقوقی نیست؛ جمع‌بندی «نتیجهٔ محصولی» یعنی آیا با متن مجوزِ خوانده‌شده می‌شود مدل را در محصول آکادمی به‌کار برد یا نه.

## ۱. جدول خلاصه

| مدل | revision (main) | مجوز (سند خوانده‌شده) | فایل LICENSE | تجاری؟ | نتیجهٔ محصولی |
|---|---|---|---|---|---|
| `Abdou/quran-asr-small` | `004f898639f3127a74eac1b898a2cb3ef0b5268d` | MIT | دارد — SHA-256 `3a9d7909…5583c` | بله (با حفظ اعلان کپی‌رایت) | ✅ مجاز؛ تنها مدل دارای مجوزِ بازِ صریح در این فهرست |
| `Muno459/zipformer_p-quran` | `5cf149946f9ccf7bab30f16462e871e9031b4585` | NPL-1.1 | دارد — SHA-256 `8ee6366f…8476b34` | خیر | ❌ ممنوع در هر محصول درآمدزا (بند ۳: کل اپ) |
| `Quran-Lab/zipformer_p-arabic-v3` (موتور فعلی، v3.1) | `5a115aa91cf7401213a62c22f3458445687d1701` | NPL-1.2 | دارد — SHA-256 `77526bdb…10cab5` | خیر | ⚠️ موتور فعلی؛ قابلیت حفاظ باید همیشه رایگان بماند (بند ۳) |
| `TheGreatQuran/QuranKarim-SpeechToText-onnxModel` | `76eab42481554dfe2fd837596802af243482a894` | `cc-by-4.0` فقط در frontmatter؛ فایل LICENSE ندارد | ندارد (404) | مشروط (نیازمند انتساب + تأیید مجوز مدل پایه) | ⚠️ مشروط؛ پیش از استفاده، بنچمارک محلی + تأیید مجوز لازم است |
| `Muno459/fastconformer-quran` | `77dbe5d809628ea89422243695de4c0d69770775` | NPL-1.1 | دارد — SHA-256 `8ee6366f…8476b34` (متن یکسان با zipformer_p-quran) | خیر | ❌ ممنوع در هر محصول درآمدزا |
| `saif96/itqan-fastconformer-quran-int8` | `4cac7a113d87af91ead71065e1daf6c66c4666bd` | NPL-1.1 (آینهٔ بدون تغییر upstream) | دارد — SHA-256 `8ee6366f…8476b34` | خیر | ❌ همان ممنوعیت upstream |
| `tarteel-ai/whisper-base-ar-quran` (موتور دوم فعلی) | `5c3c53fdf9272c4f6ee0bee09a1e5a4a615ee25c` | `apache-2.0` فقط در frontmatter (خودکارِ Trainer)؛ فایل LICENSE ندارد | ندارد (404) | تأیید نشده | ⚠️ استفادهٔ تجاری مجاز فرض **نشود**؛ وضعیت فعلی حفظ شود |

هش‌های کامل SHA-256 فایل‌های LICENSE (دانلودشده ۲۰۲۶-۱۱-۰۷):

- Abdou (MIT، ‏۱۰۶۲ بایت): `3a9d79091d3c680c22dfa9af3dc8dfa12e62f6f9eb94bad36361393453a5583c`
- Muno459 ‏zipformer_p-quran / fastconformer-quran / saif96 (NPL-1.1، ‏۵۸۵۲ بایت، هر سه یک متن): `8ee6366f4b3ccb70dd2e9265d8a02505b402c088065a72b2251e1b89e8476b34`
- Quran-Lab ‏v3 (NPL-1.2، ‏۷۰۴۱ بایت): `77526bdbfac94132e5114c3a34492c33f915e4b7f310f00b9995500d3610cab5`

## ۲. بررسی تک‌تک مدل‌ها

### ۲.۱ `Abdou/quran-asr-small` — ✅ MIT، تجاری مجاز

- نشانی: `https://huggingface.co/Abdou/quran-asr-small`
- ‏revision بررسی‌شده: `004f898639f3127a74eac1b898a2cb3ef0b5268d` — gated نیست، دانلود آزادانه انجام شد.
- ‏LICENSE: متن کامل MIT، ‏Copyright (c) 2026 Abdou — استفاده/کپی/تغییر/توزیع/فروش آزاد است؛ شرط تنها درج اعلان کپی‌رایت و متن مجوز در همهٔ نسخه‌ها یا بخش‌های عمده است.
- فایل‌ها: `model.int8.onnx` (‏۳۶٬۰۸۱٬۷۶۲ بایت، SHA-256 ‏`88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0`)، `model.onnx` (‏۱۳۳٬۰۹۴٬۳۷۴ بایت، SHA-256 ‏`d1afdf13c1d249021358d03f169dd8e16392b297521366cf7488f443e7cd3f7e`)، `model.pt`، ‏`tokens.txt` (۳۱ توکن)، `spelling.json`، ‏`transcribe.py`، کد آموزش در `code/`، مقاله در Zenodo (DOI ‏`10.5281/zenodo.23761691`).
- خروجی: **حروف عربی بدون حرکت/تشدید** — ۳۱ توکن = ۲۹ حرف + جداکنندهٔ کلمه (▁) + blank. تشدید و حرکات در خروجی نیست (در بنچمارک محلی تأیید شد).
- نوع دیکد: **آفلاین (record-then-grade)** در اسکریپت رسمی (`OfflineRecognizer.from_zipformer_ctc`). گراف ONNX فقط ورودی‌های `x` و `x_lens` و خروجی `log_probs` را دارد؛ هیچ تنسور کش/حالت جریانی و هیچ متادیتای `encoder_dims` ندارد — ساخت `OnlineRecognizer.from_zipformer2_ctc` در sherpa-onnx ۲٫۰٫۱ با خطای «`'encoder_dims' does not exist in the metadata`» شکست خورد. پس **streaming واقعی با وزن‌های منتشرشده ممکن نیست**؛ فقط دیکد آفلاین یا پنجره‌بندیِ دستیِ فایل.
- معماری/اندازه: Conformer-CTC، ۹ بلوک، ‏d=384‎، حدود ۳۳ میلیون پارامتر؛ int8 حدود ۳۶ مگابایت.
- وابستگی inference: ‏`sherpa-onnx` + ‏`soundfile` + ‏`numpy` + ‏`scipy` (طبق `transcribe.py`)؛ بدون PyTorch در زمان اجرا.
- دادهٔ آموزش (طبق مدل‌کارت): ۱٬۵۳۲ ساعت — EveryAyah ‏(۱٬۱۳۲ ساعت)، Warsh ‏(۹۶ ساعت)، ‏`tarteel-ai/tlog` ‏(۲۸۳ ساعت)، ‏Iqra'Eval ‏(۲۱ ساعت). خود کارت می‌گوید: «Training data keeps its own terms (tlog: CC-BY-4.0)» — یعنی مجوز MIT **وزن‌ها و کد** را می‌پوشاند و دادهٔ آموزش تابع شرایط خودش است؛ برای tlog یعنی CC-BY-4.0 (انتساب). مجوز IqraEval در کارت ذکر نشده است.
- اعداد گزارش‌شدهٔ صاحب مدل (فقط نقل‌قول، نه نتیجهٔ مستقل): WER کلی ۴٫۴۹٪ و CER ‏۲٫۱۷٪ روی بنچمارک ۶۰۰ کلیپی Quran-Lab؛ WER مجموعهٔ Phone ‏۱۰٫۴۵٪؛ عدد ۰٫۴۶٪ WER مربوط به مجموعهٔ **جداگانهٔ** ۱٬۰۰۰ کلیپی قاریان دیده‌نشده است و نباید با ۴٫۴۹٪ مخلوط شود.
- ‏Self-hosting: بله — وزن ONNX روی CPU اجرا می‌شود و بدون اینترنت کار می‌کند.
- نتیجه: از نظر مجوز، تنها گزینهٔ دارای مجوز بازِ صریح در این فهرست است. (اما از نظر فنی در بنچمارک محلی مردود شد — رجوع کنید به `hifz-asr-benchmark.md`.)

### ۲.۲ `Muno459/zipformer_p-quran` — ❌ NPL-1.1، ممنوع در محصول درآمدزا

- نشانی: `https://huggingface.co/Muno459/zipformer_p-quran`
- ‏revision بررسی‌شده: `5cf149946f9ccf7bab30f16462e871e9031b4585` — **gated (دستی)**؛ دسترسی بدون تأیید صاحب مخزن ممکن نیست (دانلود خام با curl بدون احراز هویت رد شد؛ متن مجوز از صفحهٔ عمومی خوانده شد). هیچ credential وارد یا درخواست نشده است.
- ‏LICENSE: متن کامل NPL-1.1 خوانده شد. بندهای کلیدی:
  - بند ۳ «NO PROFIT»: «This applies to the app or service as a whole, not only to the feature that uses the Model. An application that charges its users for anything, even for features unrelated to the Model, is a revenue-generating product and is not permitted to include the Model.» — یعنی حتی اگر آکادمی فقط برای قابلیت‌های نامربوط پول بگیرد، باز هم نمی‌شود این مدل را در همان اپ گذاشت.
  - بند ۵: سرویس میزبانی‌شده فقط بر مبنای بازیابی هزینهٔ مستقیم (Cost Recovery) و بدون هیچ حاشیهٔ سود.
  - بند ۷: share-alike — هر مشتق باید تحت همان NPL-1.1 منتشر شود.
  - بند ۹: «There is no commercial license for this Model and none will be granted.»
  - بند ۱۰: هر تخلف، مجوز را فوراً و خودکار خاتمه می‌دهد.
- خروجی: **واج (phoneme)** — حدود ۲۵۰ واحد واجی؛ خروجی متن/کلمه نیست و برای WER نیازمند retrieval روی متن آیات است.
- ‏Streaming: بله، واقعی — ONNX جریانیِ cache-aware، سازگار با sherpa-onnx؛ PER گزارش‌شدهٔ صاحب مدل: chunk=8 ‏(۳۲۰ms) حدود ۱۲٫۰۶٪، chunk=24 ‏(۱٬۰۰۰ms) حدود ۱۱٫۶۳٪؛ WER ‏۵٫۸۳٪ (با retrieval).
- اندازه: ۶۵٫۵ میلیون پارامتر؛ int8 حدود ۷۳ مگابایت.
- وابستگی: sherpa-onnx برای ONNX؛ یا icefall/k2 + PyTorch برای وزن `.pt`.
- دادهٔ آموزش: fine-tune از `Muno459/zipformer_p-arabic` روی `Muno459/quran-phonemes` (everyayah + tlog) و `obadx/muaalem-annotated-v3`.
- نتیجه: در هیچ محصولی که برای چیزی از کاربر پول می‌گیرد قابل‌استفاده نیست — حتی اگر خود حفاظ رایگان باشد.

### ۲.۳ `Quran-Lab/zipformer_p-arabic-v3` — ⚠️ NPL-1.2، موتور فعلی؛ قید روی محصول

- نشانی: `https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3`
- ‏revision بررسی‌شده: `5a115aa91cf7401213a62c22f3458445687d1701` — **gated (دستی)**، مثل مورد قبل. نسخهٔ مستقر در محصول v3.1 است (`zipformer_p_arabic_v3.1.int8.onnx`).
- ‏LICENSE: متن کامل NPL-1.2 خوانده شد. **این نام را با `Muno459/zipformer_p-quran` یکی نکنید** — مجوزها متفاوت‌اند (۱٫۲ در برابر ۱٫۱) و متن‌ها فرق دارند:
  - بند ۳ در ۱٫۲ نسبت به ۱٫۱ **محدودتر** شده است: شرط به «Work» و «هر قابلیتی که Work تأمینش می‌کند» می‌چسبد، نه به کل اپ: «You may not Charge for the Work or for any Derivative… neither the Work nor any feature it powers may be placed behind a payment, a subscription, a paywall, or advertising.» — یعنی برخلاف ۱٫۱، اگر آکادمی برای قابلیت‌های کاملاً نامربوط پول بگیرد، متن ۱٫۲ مانع نیست؛ اما **خود قابلیت حفاظ (و هر قابلیت دیگری که این مدل تأمینش کند) هرگز نباید پولی/اشتراکی/تبلیغاتی شود**.
  - بند ۵: سرویس میزبانی‌شده فقط Cost Recovery (بدون حاشیهٔ سود، بدون حقوق/پشتیبانی) و با اثبات‌پذیری هزینه‌ها.
  - بند ۷: share-alike تحت NPL-1.2 یا نسخهٔ جدیدتر Quran-Lab.
  - بند ۹: «There is no license to Charge for this Work, and none will be granted.»
  - بند ۶: انتساب لازم نیست، اما فایل LICENSE باید هنگام توزیع حفظ شود.
- خروجی: واج — الفبای واجی ۲۵۱ نمادی (۲۵۱ نماد + blank با `tokens.txt`)؛ کدگذاری تجوید (مد، تشدید، غنه، اخفا، قلقله).
- ‏Streaming: بله، واقعی — ONNX جریانیِ cache-aware + بسته‌های CoreML برای iOS؛ chunkهای ۸/۱۶/۲۴ در آموزش.
- اندازه: ۶۵٫۵ میلیون پارامتر؛ int8 (فایل v3.1 در محصول)؛ بستهٔ CoreML ‏float8 حدود ۶۳ مگابایت.
- وابستگی: sherpa-onnx (ONNX) یا CoreML (iOS 18+‎).
- دادهٔ آموزش: حدود ۵٬۴۰۰ ساعت مؤثر در هر epoch؛ تلاوت‌های حرفه‌ای، ضبط‌های تلفنی، برچسب‌های واجی قطعی `quran-transcript` (حفص).
- اعداد گزارش‌شدهٔ صاحب مدل: PER روی بنچمارک Quran-Lab نسخهٔ ۱٫۱ — استودیو ۱٫۴۳٪، تلفن واقعی ۳٫۶۵٪، قاری حرفه‌ای دیده‌نشده ۹٫۱۰٪. (این‌ها PER واجی‌اند، نه WER کلمه‌ای.)
- **پیامد محصولی (مهم):** موتور پیش‌فرض فعلیِ حفاظ همین مدل است و تحت NPL-1.2 منتشر شده است. پس تا وقتی این موتور در محصول است: (۱) قابلیت حفاظ و هر قابلیتی که این مدل تأمین کند باید رایگان بماند؛ (۲) نمی‌شود آن را پشت اشتراک/پرداخت/تبلیغات گذاشت؛ (۳) هر مشتق/بازصادرات باید تحت NPL-1.2 بماند؛ (۴) فایل LICENSE باید در توزیع‌ها حفظ شود. اگر روزی قرار شد حفاظ پولی شود، باید موتور با مجوزِ باز جایگزین شود یا مجوز جداگانه‌ای گرفته شود — و طبق بند ۹ چنین مجوزی «داده نخواهد شد». این قید باید در `THIRD_PARTY_NOTICES.md` مخزن ثبت شود (در بررسی ۲۰۲۶-۱۱-۰۷ هیچ اشاره‌ای به Zipformer/NPL در آن فایل دیده نشد).

### ۲.۴ `TheGreatQuran/QuranKarim-SpeechToText-onnxModel` — ⚠️ مشروط (CC-BY-4.0 ادعایی، بدون فایل LICENSE)

- نشانی: `https://huggingface.co/TheGreatQuran/QuranKarim-SpeechToText-onnxModel`
- ‏revision بررسی‌شده: `76eab42481554dfe2fd837596802af243482a894` — gated نیست.
- مجوز: در frontmatter خام `README.md` آمده است: `license: cc-by-4.0`. اما **هیچ فایل `LICENSE` در مخزن نیست** (درخواست آن 404 برگشت) و فیلد license در API هم خالی است. پس ادعای CC-BY-4.0 فقط یک برچسب frontmatter است، نه متن مجوز. اگر مبنای استفاده قرار گیرد، شرط CC-BY-4.0 یعنی **انتساب الزامی** است (نام صاحب اثر + پیوند مجوز + ذکر تغییرات) و مجوز باید در توزیع حفظ شود.
- مدل پایه: `mohammed/fastconformer-quran-ar` — برای آن مخزن هم هیچ مجوزِ ثبت‌شده‌ای در متادیتای HF دیده نشد؛ پس زنجیرهٔ مجوزِ مشتق کاملاً تأییدشده نیست.
- خروجی: **متن عربی با تشکل کامل** (طبق کارت: خروجی شامل تشدید/حرکات است)؛ SentencePiece BPE با ۱٬۰۲۴ توکن + blank؛ دیکد CTC آفلاین.
- نوع دیکد: **آفلاین، غیرجریانی** — «processes the full audio context at once… not configured for frame-by-frame streaming».
- اندازه: ۱۱۴٫۶ میلیون پارامتر؛ FP32 ‏۴۵۸ مگابایت، mixed INT4+INT8 ‏۸۷ مگابایت (`qurankarim-fastconformer-mixed.onnx`)؛ یک نسخهٔ `qurankarim-fastconformer-q8.onnx` هم هست.
- وابستگی: sherpa-onnx (`OfflineRecognizer.from_nemo_ctc`) + ‏`tokens.txt`؛ بدون نیاز به NeMo در زمان اجرا.
- دادهٔ آموزش: `tarteel-ai/everyayah` (طبق کارت).
- اعداد گزارش‌شدهٔ صاحب مدل — **با احتیاط کامل**: «۹۸٫۱٪ Sequence Accuracy» دقت دنباله‌ای است، نه WER؛ روی مجموعهٔ اعتبارسنجیِ خودِ صاحب مدل و با `verified: false` در model-index ثبت شده است. مقدار WER ‏۰٫۰۰۱۴ در model-index هم روی همان اعتبارسنجیِ توزیع آموزشی است، نه بنچمارک مستقل. **Sequence accuracy را WER فرض نکنید.**
- نتیجه: مجوزِ ادعایی (CC-BY-4.0) استفادهٔ تجاریِ مشروط به انتساب را می‌دهد، اما چون فایل LICENSE نیست و مجوز مدل پایه تأیید نشده است، وضعیت «مشروط» می‌ماند: پیش از هر تصمیم تولیدی، بنچمارک محلی (روی همان فایل فاتحه) + ثبت انتساب لازم است.

### ۲.۵ `Muno459/fastconformer-quran` — ❌ NPL-1.1

- نشانی: `https://huggingface.co/Muno459/fastconformer-quran`
- ‏revision بررسی‌شده: `77dbe5d809628ea89422243695de4c0d69770775` — **gated (دستی)**.
- ‏LICENSE: متن NPL-1.1؛ هش آن دقیقاً برابر هش LICENSE در `zipformer_p-quran` است (متن یکسان). کارت صریح می‌گوید مجوز بر «the fine-tuned weights, the ONNX exports, the pronunciation head, the tokenizer and the tajweed code» حاکم است و «You may use, fine-tune, redistribute and even host the model, but **no profit may be made from it**. You may recover only the strictly necessary direct running costs.»
- خروجی: **متن با حرکات کامل**؛ BPE با ۱٬۰۲۴ توکن؛ CTC با ویژگی‌های انکودر ۵۱۲بعدی برای نمره‌دهی تلفظ؛ موتور تشخیص اشتباه تلفظ با سه سیگنال (head + anchor + GOP).
- نوع دیکد: **آفلاین** (این مخزن)؛ نسخهٔ جداگانهٔ streaming هم هست (`fastconformer-quran-streaming`، در این بررسی نیست) با WER گزارش‌شدهٔ ۱۰٫۵۳٪ جریانی در برابر ۵٫۴۱٪ آفلاین.
- اندازه: ۱۱۴٫۶ میلیون پارامتر؛ ONNX ‏fp32 ‏۴۳۷ مگابایت، fp16 ‏۲۱۹ مگابایت؛ نسخهٔ int8 هم در مخزن هست (`onnx/model.q8.onnx`).
- وابستگی: onnxruntime + sentencepiece + کد `tajweed/`؛ یا NeMo برای چک‌پوینت `.nemo`.
- دادهٔ آموزش: EveryAyah (CC-BY 4.0) + ‏tlog (gated) + muaalem ‏(obadx/muaalem-annotated-v3)؛ مدل پایه NVIDIA ‏`stt_ar_fastconformer_hybrid_large_pcd_v1.0` که در کارت آینهٔ saif96 به‌عنوان CC-BY-4.0 ذکر شده است (این ادعا در این بررسی مستقلاً راستی‌آزمایی نشد).
- اعداد گزارش‌شدهٔ صاحب مدل: WER کلی ۵٫۴۱٪ روی بنچمارک ۶۰۰ کلیپی (نسخهٔ ۱٫۱ مراجع)؛ قاری دیده‌نشده ۰٫۹۳٪؛ تلفن واقعی ۸٫۸۸٪.
- نتیجه: ممنوع در محصول درآمدزا (همان NPL-1.1).

### ۲.۶ `saif96/itqan-fastconformer-quran-int8` — ❌ NPL-1.1 (آینه)

- نشانی: `https://huggingface.co/saif96/itqan-fastconformer-quran-int8`
- ‏revision بررسی‌شده: `4cac7a113d87af91ead71065e1daf6c66c4666bd` — gated نیست.
- ‏LICENSE: متن NPL-1.1؛ هش دقیقاً برابر upstream است. کارت می‌گوید آینهٔ بدون تغییر گراف int8 و نقشهٔ توکنِ upstream است (`model_int8.onnx` ‏۱۷۴٬۵۴۴٬۰۸۹ بایت، SHA-256 ‏`4dc38b31…a4e7c` طبق کارت؛ `tokens.txt` ‏SHA-256 ‏`7e6e2b04…f2787`) و برای دانلودِ بدون حساب HF در اپ Itqān ساخته شده است؛ «free, non-commercial, and open to everyone, which the license permits (§6, §7)».
- نتیجه: همان ممنوعیت NPL-1.1؛ آینه بودن چیزی را عوض نمی‌کند. مزیتش فقط این است که gated نیست.

### ۲.۷ `tarteel-ai/whisper-base-ar-quran` — ⚠️ مجوز تجاری تأیید نشده (موتور دوم فعلی)

- نشانی: `https://huggingface.co/tarteel-ai/whisper-base-ar-quran`
- ‏revision بررسی‌شده: `5c3c53fdf9272c4f6ee0bee09a1e5a4a615ee25c` — gated نیست.
- مجوز: frontmatter خام `README.md` می‌گوید `license: apache-2.0`، اما این برچسب **خودکارِ ابزار Trainer** است (کارت با جملهٔ «This model card has been generated automatically…» شروع می‌شود) و **هیچ فایل `LICENSE` در مخزن نیست** (404). بخش‌های «Model description»، «Intended uses» و «Training and evaluation data» همه «More information needed» هستند و مجموعه‌داده به‌صورت «None» ثبت شده است — یعنی دادهٔ آموزش افشا نشده است.
- پس: برچسب apache-2.0 یک نشانهٔ مثبت است، اما مجوزِ صریحِ صاحب مدل برای **وزن‌های fine-tune‌شده** به‌شمار نمی‌رود. طبق قاعدهٔ این مأموریت، تا یافتن مجوز صریح، استفادهٔ تجاری **مجاز فرض نمی‌شود**. (یادداشت کد محصول در `hifz_engines.py` هم همین را می‌گوید: «License Apache-2.0 is corroborated by secondary pages only — the official card shows no license field, so confirm it on the live HF page before commercial use.» — این بررسی تأیید می‌کند که هنوز هیچ فایل LICENSEای نیست.)
- وابستگی جانبی (مهم): محصول از تبدیل third-party ‏`hkhan0327/faster-whisper-base-ar-quran` برای faster-whisper/CTranslate2 استفاده می‌کند (مخزن transformers به‌تنهایی با faster-whisper بارگذاری نمی‌شود). مجوزِ آن تبدیل در این بررسی خوانده نشده است و باید جداگانه بررسی شود.
- خروجی: **متن** (نه واج)؛ زمان‌بندی کلمه‌ها در faster-whisper تخمین DTW است، نه تراز واجی دقیق.
- نوع دیکد: **غیرجریانی**؛ در بنچمارک Quran-Lab با دیکد chunked ‏۳۰ثانیه‌ای WER ‏۷٫۹۷٪ گزارش شده است (در برابر دیکد تک‌پنجره‌ای که نتیجه را بد نشان می‌دهد).
- اندازه: Whisper base حدود ۷۴ میلیون پارامتر (`pytorch_model.bin`)؛ در محصول به CTranslate2 تبدیل می‌شود.
- دادهٔ آموزش: نامشخص («None») — ریسک حقوقیِ دادهٔ آموزشی قابل‌ارزیابی نیست.
- اعداد گزارش‌شدهٔ صاحب مدل: WER ‏۵٫۷۵۴۴ روی مجموعهٔ ارزیابیِ نامشخصِ خودِ Trainer.
- نتیجه: به‌عنوان موتور دومِ فقط-record-then-grade بماند، با همان قید فعلی؛ در هیچ تصمیم تجاری روی آن حساب نکنید.

## ۳. جمع‌بندی حقوقی/محصولی

1. **تنها مجوز بازِ صریح در این فهرست، MIT مدل Abdou است.** بقیه یا NPL (ممنوعیت کسب سود) هستند یا مجوزشان فقط یک برچسب frontmatter بدون فایل LICENSE است.
2. **موتور پیش‌فرض فعلی (Zipformer v3.1) تحت NPL-1.2 است** و این یعنی قابلیت حفاظ — و هر قابلیتی که این مدل تأمین کند — باید همیشه رایگان بماند؛ پشت اشتراک/پرداخت/تبلیغات نمی‌رود؛ سرویس میزبانی‌شده فقط بازیابی هزینهٔ مستقیم؛ مشتق‌ها share-alike. اگر آکادمی روزی بخواهد حفاظ را پولی کند، این موتور باید عوض شود و طبق بند ۹، مجوز تجاریِ آن «داده نخواهد شد».
3. **مدل‌های NPL-1.1 (سه مورد) سخت‌گیرانه‌ترند**: شرط «بدون سود» به کل اپ می‌چسبد، نه فقط به قابلیت حفاظ — پس حتی با رایگان‌بودنِ حفاظ هم نمی‌شود آن‌ها را در اپی گذاشت که برای چیز دیگری پول می‌گیرد.
4. **Whisper-quran از نظر تجاری تأیید نشده است** و همین‌طور باقی می‌ماند تا وقتی صاحب مدل فایل LICENSE صریح منتشر کند یا دادهٔ آموزش را افشا کند.
5. **TheGreatQuran گزینهٔ مشروط** است: اگر بنچمارک محلی‌اش خوب از آب درآمد، می‌تواند نامزد موتور دومِ آفلاین شود — با ثبت انتساب CC-BY-4.0 و با این قید که مجوز مدل پایه‌اش هنوز تأیید نشده است.
6. در `THIRD_PARTY_NOTICES.md` مخزن باید برای هر موتورِ مستقر (Zipformer v3.1 با NPL-1.2 + Whisper-quran با وضعیت نامشخص) اطلاعیهٔ مجوز ثبت شود؛ در بررسی ۲۰۲۶-۱۱-۰۷ چنین اطلاعیه‌ای در آن فایل نبود.
