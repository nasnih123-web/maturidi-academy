# آمادگی تولید — چک‌لیست و سابقهٔ اجرا (C-04)

> این سند دو بخش دارد: (الف) اثبات‌های خودکار که در CI اجرا می‌شوند و
> (ب) اجرای یک‌بارهٔ دستی روی زیرساخت واقعی مالک. هیچ‌کدام جای دیگری
> را نمی‌گیرد و وضعیت هرکدام صریح نوشته شده است.

## الف) اثبات‌های خودکار (CI — .github/workflows/ci.yml)

| بررسی | job | وضعیت |
|---|---|---|
| تست‌های بک‌اند + mypy + ruff + semgrep + pip-audit | `backend` | ✅ در CI |
| migration روی PostgreSQL واقعی + تست یکپارچگی pgvector ‏(B-03) | `postgres` | ✅ در CI (سرویس pgvector/pgvector:pg16؛ ‏alembic upgrade head + تست chunk ‏#501) |
| build تولیدی وب و CRM + typecheck | `web` / `crm` | ✅ در CI |
| build ایمیج API + حضور زنجیرهٔ ابزار رسانه ‏(B-04) | `docker` | ✅ در CI |
| **بالا آمدن کل استک تولید** (compose prod با env آزمایشی، migration، دود health/auth/home/WS) | `compose-smoke` | ✅ در CI — اسکریپت: ‏tools/ci/compose_smoke.py |

## ب) اجرای یک‌باره روی زیرساخت واقعی — ⚠️ NOT RUN (زیرساخت مالک)

اجرای دستی زیر روی VM واقعی مالک **هنوز انجام نشده است** (در محیط
توسعهٔ این پروژه docker/VM در دسترس نیست؛ ساختن سابقهٔ جعلی ممنوع).
مالک زیرساخت آن را با همین چک‌لیست اجرا و نتیجه را همین‌جا ثبت می‌کند:

```bash
cp .env.prod.example .env.prod        # مقادیر واقعی (هرگز commit نشود)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps   # همه healthy؟
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
  python - < tools/ci/compose_smoke.py
```

چک‌لیست پیش‌انتشار (هر مورد را با تاریخ/نام ثبت کنید):

- [ ] ‏`docker compose ps` — همهٔ سرویس‌ها healthy (postgres/redis/minio/clamav/api/workerها)
- [ ] دود کامل سبز است (health ‏+ media_tools.ready ‏+ auth ‏+ home ‏+ WS)
- [ ] بکاپ اولیه گرفته و restore آزمایشی روی محیط جدا موفق است (docs/ops/disaster-recovery.md)
- [ ] دامنه و TLS لبه (reverse proxy خارجی — §۱۵ قرارداد؛ compose عمداً TLS را به لبه واگذار می‌کند)
- [ ] چرخش اسرار: JWT_SECRET/ENCRYPTION_KEY مقادیر واقعی و یکتا (نه نمونه‌ها)
- [ ] CAPTCHA_ENABLED=true و کلیدهای Turnstile واقعی ثبت شده‌اند (C-02)
- [ ] ClamAV بالا و یک آپلود آزمایشی اسکن شده است (C-01)
- [ ] درگاه پرداخت از sandbox به واقعی تغییر و یک تراکنش خرد آزمایشی موفق است
- [ ] مانیتورینگ (infra/monitoring) و هشدارها فعال و یک هشدار آزمایشی رسیده است

### سابقهٔ اجراهای دستی

| تاریخ | محیط | اجراکننده | نتیجه |
|---|---|---|---|
| — | — | — | **هنوز اجرا نشده است (NOT RUN)** |
