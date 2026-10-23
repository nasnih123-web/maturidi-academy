# ADR-0042 — وحدت resolve امبدینگ و ثبت هویت provider/model روی chunk

## زمینه
سه ناسازگاری در FIX-PROMPT-2 (FIX2-03) ثابت شد:
- ingestion پیش‌فرض خودش را داشت (`get_setting(...) or "hash"`) ولی
  بازیابی از `resolve_provider_name` استفاده می‌کرد؛ در production
  دانش با hash ایندکس و با local_model بازیابی می‌شد و کسینوس بین
  دو فضای برداری بی‌معنا، بی‌صدا نتیجه می‌داد.
- هیچ رکوردی از این‌که هر بردار با کدام provider/model ساخته شده
  وجود نداشت؛ تعویض provider یا پروجکشن بدون reindex نامرئی بود.
- `fit_dim` با برش ۲۵۶ مؤلفهٔ اول، بقیهٔ بردار را بی‌صدا دور می‌ریخت.

## تصمیم
- یک resolve واحد: همهٔ مسیرها (ingestion، بازیابی، ساخت دستی chunk،
  افزودن فتوا به RAG، seed) از `resolve_provider_name` و
  `get_embedding_provider` می‌گذرند؛ پیش‌فرض محلی در ingestion حذف شد.
- دو ستون nullable روی `fiqh_knowledge_chunks` (مهاجرت `a4b5c6d7e8f9`):
  `embedding_provider` و `embedding_model` — هر نویسندهٔ chunk هویت
  سازندهٔ بردار را با `provider_identity()` ثبت می‌کند.
- نگهبان اختلاط: در امتیازدهی، chunk با provider ثبت‌شدهٔ متفاوت
  امتیاز معنایی صفر می‌گیرد (فقط واژگانی می‌ماند) — هرگز قاطی نمی‌شود.
- ردیف‌های legacy (هویت NULL) فعلاً خوانده می‌شوند ولی در
  `semantic_search_status` با `chunks_without_provider` /
  `chunks_other_provider` / `reindex_recommended` شمرده و expose
  می‌شوند تا reindex تصمیم آگاهانه باشد.
- `fit_dim`: folding دوره‌ای (مؤلفهٔ j به خانهٔ j % 256) جای برش را
  می‌گیرد؛ انرژی همهٔ مؤلفه‌ها حفظ می‌شود و برای بردار کوتاه معادل
  pad قبلی است. تغییر پروجکشن یعنی reindex — که حالا قابل‌مشاهده است.
- ارزیابی قطعی محلی (hash + corpus ثابت + هر دو مسیر رتبه‌بندی) در
  `tests/test_rag_eval_fix2.py`؛ اعداد در گزارش مأموریت آمده است.
  ارزیابی با provider زنده نیازمند کلید/مدل مالک است (BLOCKED).

## پیامدها
- تعویض provider از این پس قابل‌ردیابی است: chunkهای provider قبلی
  خودکار از امتیاز معنایی کنار می‌روند و داشبورد نیاز reindex را
  نشان می‌دهد.
- هزینه: دو ستون nullable و چند شمارش ارزان در status.

## جایگزین‌های ردشده
- ذخیرهٔ هویت داخل `source_ref` JSON: پرس‌وجو و ایندکس روی JSON
  پرتابل نیست و provenance منبع با هویت بردار دو مفهوم جدا هستند.
- حذف کامل ردیف‌های legacy از بازیابی: دانش موجود را یک‌شبه از
  دسترس خارج می‌کرد؛ مسیر امن، expose + reindex تدریجی است.
- تغییر بُعد ستون به بُعد بومی مدل: نیازمند drop ایندکس HNSW و
  reindex اجباری همه‌چیز بود؛ قرارداد ۲۵۶ با folding اصولی‌تر است.
