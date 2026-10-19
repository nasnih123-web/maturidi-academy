# Maturidi Academy API — راهنمای توسعه‌دهنده (فاز ۵)

## شروع سریع (بدون Docker)

```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../../.env.example .env   # و ENCRYPTION_KEY و JWT_SECRET را عوض کن
alembic upgrade head
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='<redacted>' python -m app.seed
uvicorn app.main:app --reload
```

## بلادرنگ (WebSocket) — `/ws/events`

احراز هویت در handshake: `?token=<JWT>` یا هدر `Authorization: Bearer <JWT>`.

```
ws://localhost:8000/ws/events?token=<JWT>&channels=fatwa.*,content.*&last_event_id=<uuid>
```

- پیام‌های کلاینت: `{"type":"subscribe","channel":"..."}`،
  `{"type":"unsubscribe","channel":"..."}`، `{"type":"pong"}`
- پیام‌های سرور: `{"type":"subscribed","channel":"..."}`،
  `{"type":"event", ...}`، `{"type":"ping"}`، `{"type":"error","code":"..."}`
- کانال: تطبیق دقیق، `prefix.*` یا `*`. کانال‌های `admin.*` نیازمند مجوز
  `realtime.admin` هستند.
- heartbeat: سرور هر ۲۵ ثانیه `ping` می‌فرستد (`WS_HEARTBEAT_INTERVAL`)؛
  بعد از ۶۰ ثانیه بی‌پاسخی (`WS_HEARTBEAT_TIMEOUT`) اتصال بسته می‌شود.
- اتصال مجدد با `last_event_id` + `channels`: رویدادهای ازدست‌رفته از دیتابیس
  به‌ترتیب بازپخش می‌شوند.

## dispatcher رویدادها

تسک پس‌زمینه (`app/core/dispatcher.py`) در lifespan استارت می‌خورد:

1. `domain_events` با `processed_at IS NULL` را به‌ترتیب `created_at` می‌خواند،
2. روی bus منتشر می‌کند (Redis، وگرنه حافظه‌ای — با لاگ هشدار در startup)،
3. `processed_at` را ثبت می‌کند؛ در شکست backoff نمایی، بعد از ۵ شکست `failed_at`.

dead-letter برای ادمین: `GET /api/v1/admin/events/dead-letter` و
`POST /api/v1/admin/events/dead-letter/{id}/retry`.

## صف‌های ARQ

شش صف جدا (`app/core/queues.py`): `critical`، `ai`، `media`، `telegram`،
`notifications`، `analytics` — هرکدام concurrency/retry جدا.
اجرای ورکر: `python -m app.worker <queue>` (اجرای دائمی ورکرها عملیات فاز ۲+ است).

## تنظیمات پلتفرم (hot-reload)

`GET/PUT /api/v1/admin/settings` — فقط دارندگان مجوز `platform.settings`.

- مقادیر حساس (کلید AI، توکن تلگرام، ...) فقط به‌صورت envelope رمزنگاری‌شده
  در DB؛ در GET به‌صورت `"***"` برمی‌گردند؛ در audit log فقط `{"changed": true}`.
- **بدون ری‌استارت:** هر PUT موفق نسخهٔ کش درون‌فرایندی را بالا می‌برد؛
  ماژول‌ها باید با `get_typed_setting(db, key)` از `app/core/platform_settings.py`
  بخوانند تا کلید جدید بلافاصله اعمال شود. نسخهٔ فعلی در پاسخ GET هست.

## Content Control Center (اسکلت)

`GET /api/v1/content/items` (+ فیلترها)،
`GET /api/v1/content/items/{type}/{id}/preview`،
`GET /api/v1/content/policies/{type}/{id}`.
ماژول‌های آینده با `register_adapter()` از `app/modules/content/service.py`
ثبت می‌شوند؛ رجیستری فعلاً خالی است و endpointها لیست خالی برمی‌گردانند.

## قرآن / تسبیح / اذان (فاز ۵)

- `GET /api/v1/quran/surahs` — فهرست ۱۱۴ سوره (مرجع ثابت)؛
  `GET /api/v1/quran/surah/{n}` و `GET /api/v1/quran/ayah/{s}/{a}` — متن عثمانی +
  ترجمه + تفسیر + صوت از provider (پیش‌فرض AlQuranCloud؛ خرابی → ۵۰۳ graceful).
- `GET /api/v1/quran/providers` — providerها و editions فعال (driven by settings)؛
  `GET /api/v1/quran/munajat/status?tz=` — وضعیت پنجرهٔ مناجات شبانه.
- یادداشت آیه (auth): `POST/GET/PUT/DELETE /api/v1/quran/notes` — فقط مالک؛
  صفحه‌بندی cursor-based؛ رویداد `quran.note_created`.
- تسبیح (auth): `POST /api/v1/tasbih/sessions`،
  `POST /api/v1/tasbih/sessions/{id}/count` (با `idempotency_key` اختیاری)،
  `GET /api/v1/tasbih/today`؛ رویدادهای `tasbih.session_started/completed`.
- `GET /api/v1/adhan/times?lat=&lng=&method=&madhab=&day=&tz=` — اوقات نماز
  (PrayTimes: ‏isna/mwl/egypt/karachi/makkah/jafari؛ عصر shafi/hanafi).
- تنظیمات: `quran.*` و `munajat.*` در `docs/settings-schema.md` §۶؛ جزئیات
  معماری در `docs/adr/0004-phase5-quran-backend.md`.

## فتوای هوشمند / RAG (فاز ۶)

- `POST /api/v1/fatwa/ask` (+ `?stream=true` برای SSE؛ رویداد پایانی `final`
  کل payload شامل citations/status/ai_label را دارد) — grounded روی chunkهای
  approved/published با scope=fatwa؛ بدون کلید LLM، وضعیت `llm_unavailable`
  با منابع برمی‌گردد (هرگز متن ساخته‌شده). سهمیه: `ai.daily_quota_per_user`
  و `ai.rate_per_minute`؛ تخطی → ۴۲۹.
- `GET /api/v1/fatwa/categories`، `GET /api/v1/fatwa/compare/{topic_id}`،
  `POST /api/v1/fatwa/quiz/generate|submit` (فقط سؤال‌های ریشه‌دار در chunk
  تأییدشده)، `POST /api/v1/verify/check` (‏verified/not_found/conflicting).
- ادمین (`/api/v1/admin/fatwa/...`): chunks (ساخت/تأیید با `fatwa.approve`)،
  `POST /ingest` (جاب ARQ روی صف `ai`؛ worker: ‏`python -m app.worker ai`)،
  topics/positions (مسیر تخت `POST /positions` با `topic_id` در body برای CRM)،
  quiz/questions، trusted-sources (فقط `platform.settings` — ‏§۹.۶)، audit.
- embedding: پیش‌فرض `hash` قطعی (بدون وابستگی)؛ `external_api` از
  `ai.embedding_endpoint` (+ fallback به `AI_EMBEDDING_*` در env)؛
  pgvector فقط روی Postgres و با نصب پکیج (Backend A) وگرنه JSON+cosine
  در پایتون (Backend B). امتیاز هیبریدی `lexical + semantic`.
- seed نمایشی (`app/seed_fatwa.py`): ~۱۲ chunk verbatim از متن‌های حقوقی
  واقعی ریپو (`source_type=demo_seed`) + ۲ موضوع draft؛ هیچ حکم فقهی ساخته
  نمی‌شود (§۱۵.۵). تنظیمات: `ai.*` در `docs/settings-schema.md` §۶؛
  جزئیات معماری در `docs/adr/0005-phase6-fatwa-rag-backend.md`.

## رصدپذیری (فاز ۰ §۱۱)

- `LOG_FORMAT=json` → هر رکورد لاگ یک خط JSON با `timestamp/level/logger/message/request_id`
  (آمادهٔ Loki). پیش‌فرض `text`.
- `SENTRY_DSN` تنظیم شود → خطاها به Sentry می‌روند (غیرفعال بودن = سکوت).
- `OTEL_EXPORTER_OTLP_ENDPOINT` تنظیم شود → TracerProvider با OTLP exporter
  فعال می‌شود.

## تست

```bash
pytest tests/ -q
```

تست‌های `test_realtime.py` سرور uvicorn واقعی در thread جدا بالا می‌آورند تا مسیر
کامل `emit_event → dispatcher → bus → gateway → WebSocket` تست شود.
