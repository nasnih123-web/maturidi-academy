# ADR-0026 — pgvector واقعی: ستون برداری + بازیابی کامل در دیتابیس (B-03)

وضعیت: پذیرفته‌شده (رفع اشکال حسابرسی 197efa0، آیتم B-03)
تاریخ: ۲۰۲۶-۱۰-۲۲

## زمینه

یافتهٔ Blocker حسابرسی: «pgvector» روی کاغذ بود — ایمیج compose
‏postgres ساده بود، ستون برداری در اولین کوئری به‌صورت تنبل (lazy DDL)
ساخته می‌شد، و بازیابی روی `.limit(500)` chunk تازه‌تر اسکن می‌شد؛
یعنی سقف نامرئی ۵۰۰تایی عملاً سقف RAG بود و chunk قدیمی‌تر از ۵۰۰
chunk تازه، هرگز — حتی با تطابق کامل — پیدا نمی‌شد. تصمیم Postgres:
نسل ۱۶ می‌ماند (پرش major در این دور ممنوع) با ایمیج رسمی
`pgvector/pgvector:pg16` در هر دو compose (تصمیم نسخهٔ Postgres
همین‌جا ثبت می‌شود؛ بازبینی رسمی آن در ADR ارتقای نسخه‌های M-06).

## تصمیم

۱) ایمیج Postgres در docker-compose.yml و docker-compose.prod.yml
(سرویس postgres اصلی؛ metabase-db دیتابیس BI جداست و دست‌نخورده
می‌ماند) → `pgvector/pgvector:pg16`.

۲) مهاجرت روبه‌جلو `e2b3c4d5f6a7` (dialect-guarded):
- روی PostgreSQL: `CREATE EXTENSION IF NOT EXISTS vector` و
  `pg_trgm`، ستون `embedding_vec vector(256)`، بک‌فیل از ستون JSON
  موجود، ایندکس HNSW (‏vector_cosine_ops) و ایندکس GIN تری‌گرام روی
  chunk_text.
- روی SQLite: فقط ستون (نوع تعریف‌شدهٔ کاربر) — هیچ DDL مخصوص PG.
مدل ORM ستون را با `pgvector.sqlalchemy.Vector(256)` نگه می‌دارد و
پکیج `pgvector==0.5.1` در requirements پین شد.

۳) نوشتن دوگانه: هر چهار مسیر ساخت chunk (ingestion، ساخت دستی در
fatwa service، تأیید submission، seed) روی Postgres هر دو ستون
JSON و embedding_vec را پر می‌کنند؛ JSON منبع سازگاری و مسیر
SQLite می‌ماند.

۴) بازیابی (ChunkIndex.search) بدون هیچ سقف اسکن:
- Backend A (PostgreSQL): نامزدها کاملاً در دیتابیس انتخاب می‌شوند —
  معنایی با `<=>` روی HNSW و واژگانی با `word_similarity` (pg_trgm)
  — و فقط ردیف‌های نامزد برای امتیازدهی هیبریدی نهایی خوانده
  می‌شوند. DDL تنبل از مسیر کوئری حذف شد؛ نبود ستون/اکستنشن →
  fallback صادقانه به Backend B.
- Backend B (SQLite، مسیر dev/test): اسکن کامل بدون limit روی ستون
  JSON با cosine پایتون.

۵) اثبات: job ‏`postgres` در ci.yml با سرویس واقعی
pgvector/pgvector:pg16 مهاجرت را اجرا و
`tests/test_pgvector_integration.py` را صدا می‌زند (chunk شمارهٔ
۵۰۱ — قدیمی‌ترین — باید رتبهٔ اول شود). این تست بدون
PG_INTEGRATION_DATABASE_URL صادقانه skip می‌شود: در sandbox داکر/PG
نیست و اجرای واقعی آن CI-only است (NOT RUN LOCALLY).

## پیامدها

- سقف ۵۰۰ از هر دو مسیر حذف شد؛ هزینهٔ Backend B روی SQLite خطی
  است و آگاهانه پذیرفته شده (مسیر dev/test) — production روی
  Backend A مقیاس می‌گیرد.
- QuestionCluster.embedding (خوشه‌بندی سؤال‌ها) عمداً خارج از این
  ADR است: مسیر بازیابی RAG نیست؛ اگر روزی جست‌وجوی برداری روی آن
  لازم شد، ADR جدا می‌خواهد.
