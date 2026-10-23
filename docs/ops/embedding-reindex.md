# سازگاری امبدینگ‌ها و بازنمایه‌سازی (reindex) — FIX3-04 / ADR-0051

## چرا لازم است

هر بردار دانش فقهی فقط در فضای (provider, model, projection) خودش
معنا دارد. جست‌وجوی معنایی بردار فضای دیگر را قاطی نمی‌کند
(نگهبان FIX2-03)، پس هر chunk ناسازگار عملاً از جست‌وجوی معنایی
بیرون است تا وقتی با هویت جاری بازنمایه شود. منابع ناسازگاری:

- ردیف‌های legacy پیش از FIX2-03 — هویت provider/model ‏NULL است.
- بردارهای پیش از FIX2-03 با «برش سادهٔ ۲۵۶ مؤلفهٔ اول» ساخته
  شده‌اند؛ پروجکشن فعلی (`folding-v1`، از FIX2-03) معنای دیگری
  دارد و آن ردیف‌ها نشان پروجکشن ندارند → `embedding_projection`
  ‏NULL یعنی «نامعلوم» و ناسازگار شمرده می‌شود.
- تغییر provider/model در تنظیمات (`ai.embedding_provider` و
  مدل external) — همهٔ chunkهای قبلی ناسازگار می‌شوند.

## گزارش سازگاری

سه راه، یک منبع واحد (`chunk_compatibility_report`):

1. **داشبورد/وضعیت:** `semantic_search_status` کلید `compatibility`
   را دارد: هویت جاری + گروه‌های (provider, model, projection,
   dim) با شمار و پرچم سازگار/ناسازگار + شمار کل ناسازگارها.
2. **CLI:** ‏`python -m app.modules.fatwa.reindex --report`
   همان گزارش را چاپ می‌کند.
3. **برنامه‌ای:** ‏`app.modules.fatwa.embeddings.chunk_compatibility_report(db)`

## اجرای reindex

```bash
cd apps/api
python -m app.modules.fatwa.reindex --dry-run     # برنامه، بدون نوشتن
python -m app.modules.fatwa.reindex               # اجرای واقعی
python -m app.modules.fatwa.reindex --batch-size 100
python -m app.modules.fatwa.reindex --resume-from <chunk-id>   # ادامه از checkpoint
```

- پردازش به ترتیب صعودی id و batchای است؛ پس از هر batch کامیت
  می‌شود و خط `processed X/Y (last_id=...)` چاپ می‌شود — همان
  `last_id`، checkpoint ادامه است.
- اجرای دوباره روی دادهٔ سالم **no-op** است: chunkهای سازگار
  رد می‌شوند، پس قطع و اجرای مجدد امن است.
- اگر provider واقعی در دسترس نباشد (کلید/endpoint تنظیم نیست یا
  پکیج مدل نصب نیست)، ابزار **پیش از هر نوشتنی** با خطای روشن و
  exit code ‏۲ متوقف می‌شود — اول یک probe واقعی زده می‌شود.
- برای provider پیش‌فرض dev (‏hash) و local_model (وقتی مدل نصب
  و حاضر است) ابزار end-to-end کار می‌کند؛ تست‌ها روی دیتاست
  آزمایشی با hash اثبات شده‌اند.

## مرز مالک‌گیت (صادقانه)

اجرای reindex روی دادهٔ واقعی production نیازمند کلید/مدل واقعی
مالک و پنجرهٔ اجرایی است و در این دور انجام **نشده** است
(BLOCKED سمت مالک). ابزار، گزارش، تست‌ها و همین ران‌بوک تحویل
شده‌اند. ترتیب پیشنهادی اجرا در production:

1. بکاپ دیتابیس (قرارداد §۱۷).
2. `--report` — ثبت شمار گروه‌های ناسازگار.
3. `--dry-run` — تطبیق شمار برنامه با گزارش.
4. اجرای واقعی در پنجرهٔ کم‌ترافیک؛ پایش خطوط پیشرفت.
5. `--report` دوباره — انتظار: ‏`incompatible=0`.

## تغییر پروجکشن در آینده

هر تغییر در الگوریتم `fit_dim` باید نسخهٔ `PROJECTION_ID` در
`app/modules/fatwa/embeddings.py` را بالا ببرد؛ از همان لحظه
همهٔ بردارهای قبلی در گزارش «ناسازگار» دیده می‌شوند و همین
ابزار آن‌ها را بازنمایه می‌کند.
