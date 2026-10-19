# ممیزی اولیه — hardening/audit-pass-1

**تاریخ:** 2026-10-19 | **برنچ:** `hardening/audit-pass-1` (از `1c3d7da`) | **master دست‌نخورده**

## ۱. منابع در دسترس و ناموجود (بخش ۲ مسترپرامپت)

| منبع | وضعیت |
|---|---|
| PDF اولیه (`~/workspace/user/files/2__1.pdf`) | ✅ موجود |
| سند نیازمندی‌ها / مسترپرامپت (`~/workspace/user/files/-3.md`) | ✅ موجود |
| سورس کامل (api/web/crm/mobile/desktop/packages/infra/docs/tests) | ✅ موجود |
| **گزارش جامع ممیزی کد و امنیت** | ❌ **ناموجود** — در `~/workspace/user/files/` و مخزن یافت نشد |
| **گزارش قبلی ممیزی + فایل تحلیل شکاف** | ❌ **ناموجود** — یافت نشد |

طبق دستور، محتوای این گزارش‌ها **جعل نشده**؛ کار از روی سورس واقعی + PDF + `-3.md` انجام شد.

## ۲. وضعیت پایه (Wave 0)

- `git status`: تمیز در شروع؛ برنچ `hardening/audit-pass-1` از `1c3d7da` ساخته شد.
- ابزارها: Python 3.12.3، pytest 8.3.4، Node v24.20.0، semgrep 1.181.0، pip-audit 2.10.1، ruff 0.17.1. **PostgreSQL و rustc در سندباکس موجود نیستند** (موارد وابسته → Blocked).
- فایل‌های حساس: `.env`‌ها در gitignore؛ اسرار واقعی در کامیت‌ها/لاگ‌ها چاپ نشد.
- وضعیت امنیتی پیش از این پاس (فاز ۱۷): Semgrep 0 خطا، Bandit تمیز (۷ false positive مستند B613)، تست‌های حمله سبز، ۴۱۲ تست سبز.

## ۳. فرضیه‌های اولیه (از مسترپرامپت) و سرنوشت‌شان

مسترپرامپت فهرستی از نواحی مشکوک داد (JWT، TOTP، RBAC، WebSocket، آپلود، اسرار، outbox، Docker، CI، مرز ماژول‌ها، پکیج‌های مشترک، demo-data). هر مورد در سه ترک موازی (A: امنیت، B: زیرساخت، C: معماری) با taxonomy زیر بررسی شد:

**Confirmed / Reproduced / Likely / Not Reproduced / False Positive / Blocked / Fixed**

نتیجهٔ تفصیلی در `findings-matrix.md`؛ خلاصه:

- **۷ یافتهٔ امنیتی تأییدشده و اصلاح‌شده** (Track A): عدم enforce سمت‌سرور TOTP برای ادمین‌ها، race در refresh، JWT بلندمدت در query string وب‌سوکت، channel-auth وب‌سوکت، cursor تک‌جزئی replay، سایزکپ آپلود پس از load در RAM، بازنویسی claimهای رزرو JWT.
- **۱۱ یافتهٔ زیرساختی اصلاح‌شده** (Track B): از جمله crash-loop استقرار (alembic جاافتاده در Dockerfile)، اجرای root در کانتینر، ایمیج MinIO حذف‌شده از Docker Hub، `|| true` روی semgrep در CI، سه CVE واقعی در dependencyها (pyjwt، python-multipart، cryptography).
- **معماری** (Track C): models.py تفکیک **نشد** (ADR-0019 — ریسک DB در برابر منفعت صفر)؛ پکیج‌های غایب ساخته **نشدند** (تکرار واقعی اثبات نشد)؛ دو تداخل شمارهٔ ADR اصلاح شد؛ demo-data سالم بود (ایزوله).

## ۴. روش کار

سه ترک روی یک برنچ کار کردند؛ در میانهٔ کار تداخل‌هایی رخ داد (تغییرات ناتمام ترک A درخت را موقتاً شکست؛ DB تست مشترک wipe شد) که با `MATURIDI_TEST_DB` جداگانه و بازبینی متقابل مدیریت شد. هر اصلاح امنیتی با **negative test** همراه است. هیچ‌چیز به master مرج، به GitHub پوش یا به Drive منتقل نشد.
