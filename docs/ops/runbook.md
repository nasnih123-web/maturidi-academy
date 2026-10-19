# Runbook عملیاتی روزانه — آکادمی ماتریدی (فاز ۱۷)

> برای on-call و نگه‌داشت روزمره. نسخهٔ فشردهٔ ترک دیگر: [`docs/operations/runbook.md`](../operations/runbook.md)
> بازیابی فاجعه: [`disaster-recovery.md`](disaster-recovery.md) | استقرار: [`deployment.md`](deployment.md) | استیجینگ: [`staging.md`](staging.md)

---

## ۱. چک‌لیست روزانه (۵ دقیقه)

```bash
cd /opt/maturidi
D="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$D ps                          # همه up و healthy؟
curl -sf https://api.example.com/health        # {"status":"ok"}
curl -sf https://example.com/ -o /dev/null     # web
$D exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT count(*) FROM domain_events WHERE processed_at IS NULL AND failed_at IS NULL;"
# اگر رویداد پردازش‌نشدهٔ قدیمی زیاد است → بخش ۴ (صف گیرکرده)
df -h /var/lib/docker /var/backups/maturidi   # دیسک < ۸۰٪؟
ls -la /var/backups/maturidi/pg-$(date +%F).sql.gz   # بکاپ دیشب هست؟
```

## ۲. سلامت و لاگ‌ها — کجا چه چیزی است

| چه | کجا |
|---|---|
| لاگ ساختاریافتهٔ API (JSON) | Loki (پورت داخلی 3100) → Grafana |
| متریک‌ها | Prometheus (`/metrics` روی api) → Grafana |
| خطاهای unhandled | Sentry (اگر پیکربندی شده) + Loki |
| لاگ کانتینرها | `docker compose logs -f <service>` |
| لاگ بکاپ | خروجی cron `infra/backup.sh` (ایمیل cron یا `/var/log/`) |
| audit وقایع حساس | جدول `audit_logs` (فتوا، پرداخت، نقش‌ها، تنظیمات — §۱۴) |
| dead-letter رویدادها | `domain_events` با `failed_at NOT NULL` (قابل مشاهدهٔ ادمین) |

### داشبوردهای پیشنهادی Grafana (حداقل)

1. نرخ 5xx و p95 latency به‌تفکیک endpoint
2. عمق صف‌های ARQ (lag) به‌تفکیک ۶ صف
3. فضای دیسک postgres/minio + سن آخرین بکاپ موفق
4. نرخ لاگین ناموفق (هشدار نفوذ)

## ۳. هشدارهای بحرانی

- هشدار بحرانی → **بات تلگرام مدیریتی** (قرارداد §۱۱) — توکن/چت‌آیدی از `platform_settings`
  (`telegram.*`)، نه هاردکد.
- آستانه‌های پیشنهادی شروع: 5xx > ۱٪ در ۵ دقیقه؛ p95 > ۳s در ۱۰ دقیقه؛
  دیسک > ۸۵٪؛ بکاپ شبانه ناموفق؛ صف `critical` با lag > ۵ دقیقه.

---

## ۴. رخدادهای رایج — علامت → تشخیص → رفع

### ۴.۱. دیتابیس down / کند

**علامت:** همهٔ endpointها 500 یا timeout؛ `pg_isready` fail.
```bash
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs postgres | tail -30
df -h   # شایع‌ترین علت: پر شدن دیسک (WAL/لاگ)
```
**رفع:** دیسک را آزاد کنید → `up -d postgres` → صبر برای healthy → `up -d api worker-*`.
اگر دیتا خراب است → [`disaster-recovery.md`](disaster-recovery.md) سناریوی A.
**پیشگیری:** هشدار دیسک ۸۵٪؛ `pg_stat_statements` برای کوئری کند (بخش ۵).

### ۴.۲. صف ARQ گیر کرده (کارها انجام نمی‌شوند)

**علامت:** ایمیل/تلگرام/رونویسی نمی‌رسد؛ `domain_events` با `processed_at NULL` انباشته.
```bash
docker compose -f docker-compose.prod.yml logs worker-notifications | tail -20
# آیا worker اصلاً بالاست؟
docker compose -f docker-compose.prod.yml ps | grep worker
# اتصال Redis؟
docker compose -f docker-compose.prod.yml exec -T redis redis-cli -a "$REDIS_PASSWORD" ping
```
**رفع:** ری‌استارت worker مربوطه؛ اگر Redis خراب است آن را اول بالا بیاورید
(رویدادها در `domain_events` durableاند — dispatcher بعد از بالا آمدن، عقب‌ماندگی را جبران می‌کند، §۴).
dead-letterها (`failed_at` دار) را از CRM بازبینی و retry کنید.

### ۴.۳. دیسک پر شد

**علامت:** write error در postgres/minio؛ کانتینرها crash-loop.
```bash
du -sh /var/lib/docker/volumes/* 2>/dev/null | sort -rh | head
docker system df
```
**رفع (به ترتیب کم‌ریسک):** `docker system prune -f` → هرس بکاپ‌های قدیمی‌تر از retention →
هرس لاگ Loki → اگر volume دیتابیس پر است، دیسک اضافه کنید (هرگز فایل‌های pgdata را دستی پاک نکنید!).

### ۴.۴. انقضای گواهی TLS

**علامت:** مرورگرها خطای cert؛ webhookهای تلگرام/زرین‌پال fail می‌شوند (تلگرام webhook حتماً HTTPS معتبر می‌خواهد).
**تشخیص:** `echo | openssl s_client -connect api.example.com:443 2>/dev/null | openssl x509 -noout -enddate`
**رفع:** تمدید Let's Encrypt (اگر Caddy/Traefik خودکار است، لاگش را چک کنید)؛ سپس
`telegram webhook` را در CRM دوباره ثبت کنید (تلگرام endpoint نامعتبر را drop می‌کند).

### ۴.۵. قطع اتصال تلگرام (بات جواب نمی‌دهد)

**علامت:** دکمه‌های تأیید فتوا کار نمی‌کنند؛ درون‌ریزی/انتشار متوقف.
```bash
# از CRM: اتصالات ← تست تلگرام (نتیجه در audit لاگ می‌شود)
```
**تشخیص:** `telegram.enabled` و `telegram.bot_token` در تنظیمات؛ هدر
`X-Telegram-Bot-Api-Secret-Token` با `telegram.webhook_secret`؛ لاگ worker-telegram.
**رفع:** توکن را در BotFather بررسی/بچرخانید → در CRM به‌روزرسانی → webhook را re-register کنید.
یادتان باشد session تلگرام (Telethon) ممکن است expire شود → اتصال مجدد از CRM (کد تأیید).

### ۴.۶. درگاه پرداخت خطا می‌دهد

**علامت:** اهداها در وضعیت pending می‌مانند؛ کال‌بک‌ها fail.
**تشخیص:** CRM ← اتصالات ← تست درگاه؛ جدول `payment_webhook_log` (وضعیت‌ها)؛
`donations` بدون `gateway_reference`.
**رفع:** حالت sandbox ناخواسته فعال نمانده؟ (`payment.zarinpal_sandbox`)؛ merchant key معتبر؟
تطبیق: `GET /api/v1/admin/finance/reconcile` (مغایرت‌های `internal_without_gateway` و...).
⚠️ هرگز پرداخت را دستی «موفق» علامت نزنید — فقط از مسیر `_finalize_success`/verify درگاه.

### ۴.۷. مشکوک به نفوذ

۱. API را از شبکه جدا کنید ولی **کانتینرها را پاک نکنید** (لاگ‌ها مدرک‌اند).
۲. `audit_logs` را برای `actor`های ناشناس/IPهای عجیب بگردید.
۳. JWT secret و کلیدهای درگاه را بچرخانید؛ نشست‌ها را از CRM باطل کنید (`sessions/revoke`).
۴. از بکاپِ **قبل** از نفوذ restore کنید (نه آخرین بکاپ — ممکن است آلوده باشد).
۵. علت ریشه‌ای (CVE؟ credential لو رفته؟) را پیدا و در runbook ثبت کنید.

---

## ۵. کوئری‌های تشخیصی آماده (PostgreSQL)

```sql
-- ۱۰ کوئری کند اخیر (نیازمند pg_stat_statements)
SELECT query, calls, mean_exec_time, max_exec_time
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- اندازهٔ جدول‌های اصلی
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;

-- قفل‌های باز
SELECT pid, usename, query, state, wait_event_type
FROM pg_stat_activity WHERE wait_event_type = 'Lock';
```

## ۶. چرخه‌های دوره‌ای

| دوره | کار |
|---|---|
| روزانه | چک‌لیست §۱ |
| هفتگی | بازبینی dead-letterها و webhookهای ناموفق؛ هرس لاگ‌ها |
| ماهانه | **تست restore بکاپ روی staging** (اجباری)؛ بازبینی دسترسی‌های ادمین؛ بررسی slow queries |
| فصلی | چرخش `JWT_SECRET` و کلیدهای درگاه؛ تمرین کامل DR (§۵ disaster-recovery)؛ بازبینی RPO/RTO |
| سالانه | مرور کامل این runbook + تست نفوذ دوره‌ای |

## ۷. تحویل شیفت on-call (handoff)

هر تحویل باید این‌ها را داشته باشد (در کانال تیم/تیکت):
- رخدادهای ۲۴ ساعت گذشته + اقدام انجام‌شده
- هشدارهای muteشده و دلیل
- deployهای امروز و rollback plan آن‌ها
- موارد باز (follow-up) با مالک مشخص
- «درس‌آموخته»: هر رخداد مهم یک خط به این runbook اضافه می‌کند — runbook زنده است.
