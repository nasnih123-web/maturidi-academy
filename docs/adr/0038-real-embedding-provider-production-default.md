# ADR-0038 — provider واقعی embedding، پیش‌فرض production (M-07)

- وضعیت: پذیرفته‌شده — ۲۰۲۶-۱۰-۲۲ (رفع اشکال‌های audit روی 197efa0)

## زمینه
سه provider از فاز ۶ وجود داشت (hash / external_api / local_model)
ولی پیش‌فرض در همهٔ محیط‌ها hash بود — یعنی جست‌وجوی «معنایی»
production در عمل معنایی نبود و هیچ هشداری هم داده نمی‌شد.

## تصمیم
1. **تفکیک پیش‌فرض بر اساس محیط** (`resolve_provider_name`):
   setting صریح همیشه اول است؛ بدون setting: ‏production →
   `local_model` (مدل واقعی چندزبانهٔ sentence-transformers، بدون
   نیاز به کلید خارجی)، dev/test → `hash` (قطعی و سبک، برای تست‌ها).
2. **hash فقط dev/test:** اگر در production فعال باشد (صریح یا
   به‌هر دلیل)، `semantic_search_status` مقدار
   `semantic_enabled: false` با دلیل «semantic search disabled: …»
   می‌دهد و startup در production آن را **CRITICAL** لاگ می‌کند
   (در dev فقط info). بوت fail نمی‌شود — هشدار صریح است، نه سکوت
   و نه crash.
3. **داشبورد اتصالات CRM** بخش `embeddings` را از همان تابع وضعیت
   می‌گیرد و کارت «جست‌وجوی معنایی» با Badge قرمزِ
   «semantic search disabled» نشان می‌دهد تا خاموشی از UI هم دیده
   شود، نه فقط لاگ.
4. **قرارداد بُعد:** همهٔ providerهای واقعی خروجی را با `fit_dim`
   به ‏`EMBEDDING_DIM=256` پروجکت می‌کنند (برش + نرمال‌سازی مجدد /
   pad) چون ستون B-03 از نوع `vector(256)` است؛ بدون این، مدل‌های
   ۳۸۴/۱۵۳۶بعدی روی PostgreSQL در ingestion خطا می‌دادند.
5. `sentence-transformers==6.2.0` به requirements اضافه شد
   (مدل `paraphrase-multilingual-MiniLM-L12-v2` در اولین استفاده
   دانلود می‌شود؛ برای محیط‌های بدون شبکه، external_api مسیر
   جایگزینِ پیکربندی‌شده است).

## ارزیابی زنده
- تست زندهٔ مدل واقعی (`test_local_model_live_semantic_ordering`):
  شباهت هم‌معنا > نامرتبط روی متن فارسی — در CI با نصب پکیج اجرا
  می‌شود؛ بدون پکیج skip شفاف دارد.
- eval فاز ۱۷ (`test_phase17_rag_eval.py`) با provider قطعی hash
  برای CI دست‌نخورده ماند (نقش آن رگرسیون قطعی است، نه سنجش مدل).

## پیامدها
- production از روز اول یا معناییِ واقعی دارد یا فریاد می‌زند که
  ندارد؛ وضعیت میانیِ خاموش وجود ندارد.
