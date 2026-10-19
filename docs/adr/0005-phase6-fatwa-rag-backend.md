# ADR-0005: بک‌اند فاز ۶ — موتور فتوای هوشمند (RAG) و راستی‌آزمایی

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- میل‌استون: فاز ۶ — Track 1 (بک‌اند)

## زمینه

فاز ۶ حساس‌ترین فاز از نظر دقت محتواست: دستیار AI باید فقط از محتوای
فقهیِ تأییدشده پاسخ بگوید، چهار لایهٔ prompt فاز ۰ §۱۰ همیشه مجزا بماند،
و بدون کلید LLM هم پاسخ صادقانه («نمی‌دانم» / `llm_unavailable`) بدهد —
نه متن ساخته‌شده. اتصال فیزیکی به `library_items` متعلق به فاز ۹ است
(قرارداد §۹.۵: هیچ FK آینده‌نگر).

## تصمیم

۱. **مدل داده** (migration ‏`d8f6e3b1a2c0`):
   - `fiqh_knowledge_chunks`: متن chunk + `embedding` (JSON؛ روی Postgres با
     pgvector می‌تواند به ستون `embedding_vec` ارتقا یابد)، `source_type`,
     `source_ref` (JSON: type/id/version — بدون FK فیزیکی §۹.۵)،
     `source_library_item_ref` (string خالیِ رزروشده برای فاز ۹)،
     `source_citation` (LocalizedText — نام کتاب/اثر)، `topic_category`,
     `madhab_scope` (nullable)، `workflow_status` (ماشین §۹ — RAG فقط
     approved/published را می‌بیند)، `approved_by`، `ai_scopes` (آرایهٔ
     fatwa/assistant/quiz/verification/semantic_search).
   - `fiqh_topics` + `madhab_positions` (مقایسهٔ مذاهب؛ position_text به‌صورت
     LocalizedText).
   - `fatwa_sessions` / `fatwa_messages` (گفتگوی چندنوبتی؛ user_id nullable
     برای ask عمومی).
   - `quiz_questions` (الزامی: `source_chunk_id` → chunk تأییدشده؛ آزمون فقط
     از پرسش‌های ریشه‌دار در محتوای approved/published با scope=quiz ساخته
     می‌شود — بدون تولید خودکار سؤال از LLM)، `quiz_attempts`.
   - `verification_checks` (ورودی، hash، verdict، نزدیک‌ترین‌ها).
   - `trusted_external_sources` (نام، دامنه، مسیرهای مجاز، اولویت، الزام
     استناد، last_checked_at) — فقط super_admin ‏(`platform.settings`).
   - `ai_usage_log` (user/endpoint/model/token_in/out/cost) و
     `ai_provider_configs` (provider/model/version/enabled/is_fallback).
   - `ingestion_runs` (source_type/status/stats/زمان شروع-پایان).

۲. **Embedding** (`embeddings.py`): یک رابط `embed(texts)` / `search(...)`.
   Backend A ‏(pgvector) فقط وقتی DATABASE_URL روی postgres است و پکیج
   pgvector نصب شده؛ Backend B (پیش‌فرض/SQLite): ستون JSON + cosine در
   پایتون. امتیاز ترکیبی `score = lexical + semantic` (lexical: هم‌پوشانی
   trigram). providerهای embedding: ‏`hash` (قطعی، پیش‌فرض — تست‌پذیر،
   مستند و صریح)، ‏`external_api` (endpoint/کلید از settings — بدون اختراع
   embedding)، ‏`local_model` (تنبل: فقط اگر sentence-transformers نصب بود).

۳. **LLM** (`providers.py`): انتزاع `generate(prompt_layers, ...)`.
   Claude از طریق httpx؛ کلید از setting استیج‌شدهٔ `ai.claude_api_key`
   (هرگز لاگ/آدیت نمی‌شود). **بدون کلید → وضعیت graceful:**
   retrieval + استناد همیشه کار می‌کند؛ سنتز `llm_unavailable` برمی‌گرداند
   با منابع بازیابی‌شده، هرگز متن ساخته‌شده. چهار لایه همیشه مجزا
   (system / safety / context بازیابی‌شده / ورودی کاربر) با جداکننده و strip.

۴. **Ingestion**: ‏`extract → normalize → provenance → approval → chunk →
   embed → index` به‌صورت جاب ARQ روی صف `ai` (رجیستری `@register_task("ai")`
   در `ingestion.py`؛ workerها از `app/worker.py` موجود تغذیه می‌شوند).
   Chunking: paragraph-aware، حدود ۵۰۰ واژه با overlap ۵۰ واژه.
   منبع مستقیم (متن/فایل)؛ لینک `library_items` در فاز ۹.

۵. **سهمیه**: ‏`ai.daily_quota_per_user=20` و `ai.rate_per_minute=5` از
   platform_settings؛ تخطی → ۴۲۹ با پاکت یکدست. Rate-limit درون‌فرایندی
   (محدودیت replica مثل dedup تسبیح فاز ۵ — در صورت نیاز به Redis منتقل
   می‌شود).

۶. **مجوزها**: `fatwa.approve` (از فاز ۰ موجود) و `knowledge.manage`
   (جدید) برای مدیریت chunk/topic/position؛ `platform.settings` برای
   trusted sources.

۷. **رویدادها** (الگوی outbox موجود): ‏`fatwa.asked`، `fatwa.answered`،
   ‏`fatwa.chunk_approved`، ‏`ingestion.run_completed`.

## پیامدها

- مثبت: پاسخ AI همیشه برچسب‌دار و منبع‌دار؛ بدون کلید، سیستم retrieval
  صادقانه بدون توهم کار می‌کند؛ quiz/verify روی همان pipeline یکسان‌اند.
- منفی: provider پیش‌فرض embedding از نوع hashing است (کیفیت معنایی کمتر
  از مدل واقعی) — برای production باید `ai.embedding_provider=external_api`
  تنظیم شود؛ پاسخ فارسی ask بدون LLM فقط منابع را نشان می‌دهد (Track 2
  نمای این را می‌سازد).

## جایگزین‌های ردشده

- pgvector اجباری در migration: SQLite محلی را می‌شکست؛ JSON + ارتقای
  lazy به ستون vector روی Postgres (بدون شکست dev).
- تولید خودکار سؤال آزمون از LLM: ریسک تولید احکام جعلی (§۱۵.۵)؛ سؤال
  فقط توسط انسانِ مجاز و ریشه‌دار در chunk تأییدشده ثبت می‌شود.
- ذخیرهٔ کلید Claude در DB بدون encryption-envelope: نقض §۳؛ از
  `platform_settings` (نوع secret) خوانده می‌شود.
