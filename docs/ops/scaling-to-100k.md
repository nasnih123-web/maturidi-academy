# مسیر رشد به ۱۰۰هزار کاربر — آکادمی ماتریدی

> **فاز ۱۷ — 2026-10-19** | Track 3 (Docs + Ops + Scale)
> سند برنامهٔ عملیاتی ترک دیگر: [`docs/operations/scaling.md`](../operations/scaling.md) —
> این سند، نسخهٔ **شواهدمحور** فاز ۱۷ است: نتایج واقعی تست بار، گلوگاه‌های پیداشده، و
> برنامهٔ مقیاس‌پذیری هر سرویس.

---

## ۱. نتایج واقعی تست بار k6 (فاز ۱۷ ✅ اجرا شد — نه فقط اسکریپت)

**محیط تست:** API واقعی (uvicorn، SQLite dev، تک‌worker) روی سندباکس؛
`tests/load/k6-smoke.js`؛ سه سناریوی هم‌زمان به‌مدت ~۶۰ ثانیه.

| سناریو | بار | نتیجه |
|---|---|---|
| `rest_smoke` (search + fatwa ask) | 10 VUs | search p95 ≈ **۶۶۴ms**؛ fatwa p95 ≈ **۱۱۹ms** |
| `widget_burst` (ویجت‌های embed) | ramp تا 25 VUs | prayer-times p95 ≈ **۴۱۸ms** |
| `ws_connect` (WebSocket + JWT واقعی) | 10 VUs | **۰ خطا** — همهٔ handshakeها باز شد |

**یافته‌های مهم (صادقانه):**

1. **F1 — `ayah-of-day` و طوفان retry به provider خارجی:** وقتی provider قرآن
   (`api.alquran.cloud`) در دسترس نبود، هر درخواست ~۳۴ ثانیه retry کرد (timeout ۱۰s ×
   ۳ تلاش) و در نهایت ۵۰۳ داد. زیر burst، این workerها را اشباع می‌کند.
   **راه‌حل:** آیهٔ روز قطعیِ روزانه است (ADR-0008) → کش ۲۴ ساعته + circuit breaker +
   timeout کوتاه‌تر. (ارجاع به Track 1)
2. **F2 — شمارندهٔ سهمیهٔ ویجت روی هر درخواست write می‌کند:**
   `validate_key` در هر فراخوانی `used_this_month += 1` + `commit()` می‌زند. روی
   SQLite زیر هم‌زمانی → lock contention و 500 پراکنده؛ روی Postgres هم hotspot
   write است. **راه‌حل:** شمارنده در Redis (incr اتمیک) + سینک دوره‌ای به DB. (ارجاع به Track 1)
3. **F3 — rate-limit فتوا درست کار کرد:** زیر بار، `429 rate_limited` برگشت (۵/دقیقه
   به‌ازای کاربر — ADR-0005). این **یافتهٔ مثبت** است: guardrail هزینهٔ AI عمل می‌کند.
   برای تست بار سنگین‌تر، در محیط load حدود را بالا ببرید.
4. **صفحهٔ اصلی وب** در سندباکس تست نشد (سرویس web بالا نبود — `web_unreachable`
   در گزارش k6). اسکریپت این حالت را best-effort و شفاف ثبت می‌کند؛ روی staging با
   web روشن باید دوباره اجرا شود.
5. **توکن JWT فقط ۱۵ دقیقه عمر می‌کند** (§۲) — سناریوی WebSocket در اجراهای طولانی‌تر
   از ۱۵ دقیقه با 4401 رد می‌شود؛ قبل از هر اجرا توکن تازه بگیرید (در خود اسکریپت مستند است).

**حدودیت محیط:** SQLite تک‌نویسنده + تک worker — اعداد بالا **کف** عملکردند، نه سقف؛
روی Postgres + چند worker بهتر می‌شوند، ولی F1 و F2 مستقل از دیتابیس‌اند و باید رفع شوند.

---

## ۲. راستی‌آزمایی stateless بودن

| سرویس | وضعیت | توضیح |
|---|---|---|
| API (FastAPI) | ✅ stateless | JWT کوتاه‌مدت + refresh چرخشی در DB؛ هیچ state در حافظهٔ پردازش (به‌جز کش‌ها/rate-limitهای درون‌حافظه‌ای که باید به Redis بروند — بخش ۳) |
| Workerهای ARQ | ✅ stateless | وضعیت کار در Redis + DB (outbox)؛ هر worker جایگزین‌پذیر |
| Web (Next.js) | ✅ stateless | خروجی build استاتیک + SSR بدون state سرور |
| CRM | ✅ stateless | SPA استاتیک روی nginx |
| WebSocket gateway | ⚠️ نیمه‌stateful | اتصال‌ها در حافظهٔ هر instance است؛ با چند replica باید **sticky session** یا Redis pub/sub برای fan-out (یادداشت ADR-0001: InMemoryBus تک‌فرایندی است) |

### موارد درون‌حافظه‌ای که پیش از scale افقی باید به Redis بروند

- `_rate_buckets` ویجت‌ها (ADR-0008) و `rate_limiter` لاگین/فتوا — وگرنه هر replica
  سقف جداگانه اعمال می‌کند (هم ناعادلانه، هم قابل دورزدن با چرخش replica).
- شمارندهٔ `used_this_month` ویجت (F2).
- کش provider قرآن و dedup تسبیح (یادداشت ADR-0004/0005: فعلاً درون‌فرایندی).

---

## ۳. برنامهٔ مقیاس‌پذیری به‌تفکیک سرویس

### API
- افقی: `docker compose up -d --scale api=3` پشت load balancer (الگوی compose آماده است).
- پیش‌نیاز: موارد درون‌حافظه‌ای بخش ۲ به Redis منتقل شوند؛ health check `/health` برای LB.
- آستانه: وقتی p95 > ۱s در ۱۰ دقیقه یا CPU > ۷۰٪ پایدار → replica اضافه.

### Workerهای ARQ (۶ صف — §۵)
- هر صف جدا scale می‌شود: `up -d --scale worker-media=3` (OCR/STT معمولاً اولین گلوگاه).
- صف `critical` (پرداخت) همیشه حداقل ۲ worker برای دسترس‌پذیری.

### WebSocket
- کوتاه‌مدت: sticky session در LB.
- بلندمدت: fan-out رویدادها از Redis (نه InMemoryBus) تا هر replica به کلاینت‌های خودش برساند.

### PostgreSQL
- **read replica** برای کوئری‌های خواندنی سنگین (جست‌وجو، فید، گزارش‌های متابیس).
  متابیس را از اول به رپلیکا وصل کنید (در `docker-compose.prod.yml` مستند شده).
- ایندکس‌های فاز ۱۷ (`f17a0b1c2d3e`: `ix_social_posts_feed` ،`ix_library_items_pub_list`) نقطهٔ شروع‌اند؛
  `pg_stat_statements` را ماهانه بازبینی کنید (کوئری‌های آماده در `runbook.md` §۵).
- pgvector: با رشد چانک‌های RAG، ایندکس IVFFlat/HNSW روی ستون embedding (مسیر ارتقای ADR-0005).
- جست‌وجوی تمام‌متن فارسی/عربی در مقیاس بالا → موتور جدا (Meilisearch/Elastic) پشت همان
  قرارداد `/api/v1/search` (تعویض پیاده‌سازی بدون تغییر وب/CRM).

### Redis
- جدا کردن نقش‌ها با رشد: یک instance برای صف/کش، و در صورت نیاز instance جدا برای rate-limit.
- persistence (AOF) روشن است (در compose) — از دست رفتن صف‌ها قابل‌قبول نیست.

### MinIO / فایل
- تک‌گره تا ~ترابایت؛ بعد: کلاستر MinIO (erasure coding) یا S3 واقعی — انتزاع
  `StorageProvider` (§۶) تعویض را بدون تغییر کد ممکن می‌کند.

## ۴. کش و CDN

| لایه | چه | TTL / سیاست |
|---|---|---|
| CDN لبه (Cloudflare) | صفحات CMS، خروجی‌های عمومی کم‌تغییر | purge هوشمند پس از انتشار (هوک روی `transition` به `published`) |
| CDN | فونت/لوگو/مدیای public | immutable + 30d (در nginx CRM همین حالا هست) |
| Redis | نتایج RAG پرتکرار، `ayah-of-day` (F1)، تم تقویم | کوتاه (دقیقه تا ۲۴h برای آیهٔ روز) |
| HTTP cache | `GET /api/v1/settings/public` | با `version` فعلی revalidate می‌شود (ADR-0003) |
| هرگز کش نکنید | endpointهای احرازهویتی‌شده، signed URLها، پاسخ فتوا (شخصی‌سازی‌شده) | — |

## ۵. برآورد هزینه (سرانگشتی، هاست اروپایی ۲۰۲۶)

| مقیاس | ترکیب پیشنهادی | برآورد ماهانه |
|---|---|---|
| شروع (تا ~۱۰هزار DAU) | ۱ هاست ۴vCPU/۱۶GB (همهٔ سرویس‌ها) + CDN رایگان | ‎~۳۰–۶۰$ |
| رشد (تا ~۵۰هزار DAU) | API جدا (۲×۲vCPU) + Postgres مدیریت‌شده/اختصاصی + Redis جدا | ‎~۱۵۰–۳۰۰$ |
| ۱۰۰هزار DAU | موارد بالا + read replica + workerهای جدا + CDN پلن پرو | ‎~۴۰۰–۸۰۰$ + هزینهٔ LLM/STT |

هزینهٔ واقعی AI (توکن/دقیقه به‌ازای کاربر) در `ai_usage_log` لاگ می‌شود (§۱۰) — سقف
بودجه را از همان داشبورد ببندید، نه حدس.

## ۶. چک‌لیست آمادگی ۱۰۰هزار کاربر

- [ ] F1 و F2 رفع شده (کش آیهٔ روز + شمارندهٔ Redis)
- [ ] rate-limitها و کش‌های درون‌حافظه‌ای به Redis منتقل شده
- [ ] read replica + اتصال متابیس به آن
- [ ] تست بار k6 روی **staging با Postgres** با آستانه‌های واقعی (نه SQLite سندباکس)
- [ ] تمرین DR فصلی + RPO/RTO بازبینی‌شده (`disaster-recovery.md`)
