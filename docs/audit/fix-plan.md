# برنامهٔ اصلاح — hardening/audit-pass-1

## ترتیب اجرا (موج‌ها)

**موج ۰ — Baseline** ✅ انجام شد: برنچ `hardening/audit-pass-1` از `1c3d7da`، ثبت وضعیت git، موجودی ابزارها، اعلام ناموجود بودن گزارش‌های ممیزی.

**موج A — P0 امنیت** ✅ انجام شد (Track A، کامیت `ad495f1`):
1. TOTP اجباری سمت‌سرور (A1)
2. پنجرهٔ grace برای refresh race (A2)
3. تیکت یک‌بارمصرف وب‌سوکت (A3)
4. channel authorization وب‌سوکت (A4)
5. cursor دوجزئی replay (A5)
6. سایزکپ استریمینگ آپلود (A6)
7. لیست رزرو claimهای JWT (A7)
- هر مورد با negative test. Migration: `b21c9aa4d7e1_ws_tickets.py` (جدول تیکت‌ها).

**موج B — P1 صحت و پایداری** ✅ انجام شد (Track B، کامیت `4346bac`):
1. Dockerfile: alembic جاافتاده + کاربر non-root (B1/B2)
2. پین MinIO به quay.io (B3)
3. hostnameهای سرویسی در compose (B4)
4. `.env.prod.example` + تکمیل `.env.example`‌ها (B5/B6)
5. `infra/backup.sh`: env + SHA-256 manifest (B7)
6. CI: حذف `|| true` از semgrep، jobهای pip-audit و CRM (B8/B9/B10)
7. ارتقای pyjwt/multipart/cryptography (B11)
- وابستگی‌ها: B4 (starlette) و B6 (mypy) به «ترک جدا» موکول شدند — ارتقای major فستAPI و تایپ‌کردن ۱۴۱ خطا خارج از اسکوپ این پاس است.

**موج C — P2 معماری** ✅ انجام شد (Track C، تغییرات در working tree):
1. ADR-0019 (عدم تفکیک models.py) + تست‌های نگهبان مرز ماژول
2. رفع تداخل شماره‌های ADR (→ 0017/0018)
3. تکمیل `.env.example`‌ها، `packages/README.md`
- عدم ساخت پکیج‌های اسمی و عدم حذف کد مردهٔ اثبات‌نشده: تصمیم آگاهانه.

## وابستگی‌های بین موجی (رعایت‌شده)

- Migration تیکت WS (موج A) قبل از تست replay اجرا شد.
- ارتقای cryptography (موج B) قبل از اجرای سوئیت کامل، با roundtrip Fernet راستی‌آزمایی شد.
- تغییرات ترک‌ها روی یک برنچ بود؛ تداخل‌های میانی (شکست موقت `auth/dependencies.py` توسط ویرایش ناتمام، wipe شدن DB تست مشترک) با بازبینی متقابل و `MATURIDI_TEST_DB` جداگانه حل شد.

## کارهای باقی‌مانده (اولویت‌بندی‌شده)

1. **P1:** اجرای `docker compose -f docker-compose.prod.yml config` و `docker pull` ایمیج MinIO روی هاست داکر واقعی (Blocked در sandbox).
2. **P1:** ارتقای major فستAPI/starlette (۱۴ advisory) — ترک جدا با تست رگرسیون کامل.
3. **P2:** تایپ‌کردن تدریجی برای صفر کردن ۱۴۱ خطای mypy، سپس blocking کردن job.
4. **P2:** `npm audit` برای web/crm وقتی registry در دسترس باشد.
5. **P2:** سیاست per-aggregate برای ایونت‌های غیر user-aggregate وب‌سوکت (ثبت‌شده در ADR-0020).
6. **P2:** تصمیم مالک پروژه دربارهٔ بایگانی/ادغام `001` با `0002` (هر دو UI/UX).
