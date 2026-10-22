# Monitoring bundle (m-02)

استک مانیتورینگ production در `docker-compose.prod.yml` — همهٔ فایل‌ها
در همین پوشه‌اند و با provisioning بالا می‌آیند (بدون کلیک در UI).

| جزء | فایل | نقش |
|---|---|---|
| Prometheus | `prometheus.yml` | scrape ‏API ‎/metrics‎ + node-exporter + postgres-exporter؛ `alerts.yml` با rule_files وصل است |
| قوانین هشدار | `alerts.yml` | ‏5xx rate ‏(>۵٪)، ‏queue lag (قدیمی‌ترین رویداد outbox > ‏۳۰۰s)، ‏dead-letter تازه، دیسک ‏(<۱۵٪)، ‏ApiDown |
| Grafana | `grafana/provisioning/` + `grafana/dashboards/` | دیتاسورس‌های Prometheus/Loki و ۴ داشبورد: API، صف‌ها/Outbox، دیتابیس، خطاها |
| Loki | `loki/local-config.yaml` | ذخیرهٔ فایل‌سیستمی، retention ‏۱۴ روز — کانفیگ صریح (قبلاً به پیش‌فرض ایمیج تکیه بود) |
| Promtail | `promtail/config.yml` | لاگ کانتینرها از docker.sock به Loki با `job="docker"` |

متریک‌های outbox (`outbox_pending_events`,
`outbox_oldest_pending_age_seconds`, `outbox_dead_letter_events`) را
dispatcher هر دور در `/metrics` تازه می‌کند (app/core/metrics.py) —
داشبورد صف‌ها و هشدار lag روی دادهٔ واقعی‌اند، نه placeholder.

## وضعیت اثبات
- **اعتبارسنجی استاتیک:** تست `tests/test_monitoring_bundle.py`
  (parse همهٔ YAML/JSONها، ارجاع داشبوردها به uidهای provisionشده،
  وجود متریک‌های قوانین در exposition ‏API).
- **اجرای زندهٔ compose در این محیط ممکن نیست (بدون Docker)** —
  NOT RUN LOCALLY؛ روی سرور با `docker compose -f
  docker-compose.prod.yml up -d prometheus grafana loki promtail
  node-exporter postgres-exporter` بالا می‌آید و داشبوردها خودکار
  در فولدر Maturidi ظاهر می‌شوند.

## قدم بعدی (خارج از این bundle)
اتصال Alertmanager برای رساندن firingها به کانال اطلاع‌رسانی
(ایمیل/وب‌هوک): سرویس `alertmanager` + `alertmanager.yml` با
receiver محیطی اضافه و در prometheus.yml زیر کلید `alerting`
ثبت شود؛ قوانین همین فایل بدون تغییر کار می‌کنند.
