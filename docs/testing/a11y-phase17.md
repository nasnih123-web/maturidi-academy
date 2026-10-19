# دسترس‌پذیری خودکار — فاز ۱۷ (axe-core)

- **وضعیت:** اجرا شد 2026-10-19 — صفر تخلف Critical/Serious
- **ابزار:** axe-core 4.10.2 (devDependency وب) + Chromium (`/opt/meta-chromium/chrome`) از طریق CDP
- **خط لوله:** `apps/web/scripts/a11y/run.mjs` — API موقت (SQLite) + `next start`
  (بیلد production) → curl SSR → mirror دارایی‌های `_next` → صفحهٔ `file://`
  (چون Chromium نمی‌تواند localhost را ببیند) → تزریق axe → `axe.run`
- **تست خودکار:** `apps/api/tests/test_phase17_a11y.py` — آستانه: صفر Critical

## روش اجرا

```bash
cd apps/web && node scripts/a11y/run.mjs --repo ~/workspace/maturidi-academy --out /tmp/a11y-out
```

اسکریپت خودش دیتابیس SQLite موقت می‌سازد، `seed_home_sections` را اجرا می‌کند
(تا hero/h1 واقعی رندر شود)، API را روی پورت 18081 و وب را روی 13101 بالا
می‌آورد، ۵ صفحه (home, fatwa, donate, login, library) را mirror می‌کند و
برای هر صفحه `*-axe.json` (تخلفات) و `*-shot.png` (اسکرین‌شات 1440×900)
تولید می‌کند.

## یافته‌ها (قبل از رفع)

| صفحه | Critical | Serious | Moderate | شرح |
|---|---|---|---|---|
| home | 0 | 0 | 1 | `region` (skip-link و نوار اذان بیرون از landmark) |
| fatwa | 0 | 0 | 2 | `region` + `heading-order` (h3 برند فوتر) |
| donate | 0 | 0 | 2 | `region` + `heading-order` (h3 در empty-state) |
| login | 0 | 0 | 2 | `region` + `heading-order` |
| library | 0 | 0 | 2 | `region` + `heading-order` |

یادداشت: در اسکن اول، home علاوه بر `region` یک `page-has-heading-one` هم داشت
که آرتیفکت دیتابیس خالی اسکن بود (بخش hero از API می‌آید)؛ با seed واقعی،
home هم h1 دارد («آکادمی ماتریدی»).

## رفع‌شده (تغییرات غیربصری، فقط معنایی)

1. **`region` — محتوای بیرون از landmark:**
   - `components/SiteHeader.tsx`: لینک skip (پرش به محتوای اصلی) به داخل
     `<header>` منتقل شد (اولین فرزند) — همچنان اولین عنصر فوکوس‌پذیر است.
   - `app/[locale]/layout.tsx`: نوار شمارش اذان (`adhan-strip-bar`) که بیرون
     از landmark بود، `role="region"` با `aria-label` (از `countdownAria`
     ترجمه‌شده) گرفت.
2. **`heading-order` — پرش سطح عنوان:**
   - `components/SiteFooter.tsx`: نام برند `<h3>` → `<h2>`، عنوان ستون‌ها
     `<h4>` → `<h3>` (استایل‌های inline دست‌نخورده — فقط سطح معنایی).
   - `components/EmptyState.tsx` (کامپوننت مشترک) + دو empty-state داخلی
     (`InheritanceCalculator.tsx`، `MadhabCompare.tsx`): `<h3>` → `<h2>`؛
     سلکتور CSS در `app/[locale]/globals.css` به
     `.empty-state h2, .empty-state h3` تعمیم داده شد تا استایل هر دو حفظ شود.

## بعد از رفع

اسکن مجدد روی بیلد تازه (`next build` سبز، `tsc --noEmit` وب و CRM سبز):

| صفحه | تخلف | passes |
|---|---|---|
| home | 0 | 43 |
| fatwa | 0 | 42 |
| donate | 0 | 41 |
| login | 0 | 42 |
| library | 0 | 43 |

**صفر تخلف در هر سطح (Critical/Serious/Moderate/Minor) در هر ۵ صفحه.**

## موارد باز (غیر Critical — مستند، نه رفع‌شده)

- `incomplete=1` در هر صفحه: قانون `color-contrast` روی برخی نودها نیاز به
  بررسی چشمی دارد (axe در حالت headless روی گرادیان/پس‌زمینهٔ canvas
  نمی‌تواند قطعی قضاوت کند) — پالت طراحی در فاز ۳ با کنتراست WCAG AA
  تأیید شده است.
- صفحات نیازمند احراز هویت (داشبورد، CRM) در این دور اسکن نشدند — نیازمند
  نشست لاگین در harness است (کار آینده).
- CRM (Vite) هنوز اسکن axe نشده — همان خط لوله با `vite preview` قابل
  تعمیم است (کار آینده).
