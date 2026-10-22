# ADR-0037 — هم‌ترازی نسخه‌های monorepo و تصمیم PostgreSQL (M-06)

- وضعیت: پذیرفته‌شده — ۲۰۲۶-۱۰-۲۲ (رفع اشکال‌های audit روی 197efa0)

## تصمیم نسخه‌ها (همه با پین دقیق، بدون `latest`)
| حوزه | از | به | اثبات |
|---|---|---|---|
| وب — Next.js | 15.5.x | **16.4.2** | بیلد production سبز (Turbopack) |
| وب/CRM — React | 18.3.1 | **19.3.1** | tsc + بیلد هر دو سبز |
| موبایل — Expo SDK | 53 | **58.0.17** | expo-doctor ‏20/20، config resolve |
| موبایل — React Native | 0.79.5 | **0.88.0** | tsc سبز؛ align از bundledNativeModules |
| موبایل — React | 19.0.0 | **19.3.0** | پین bundled ‏SDK 58 (سازگاری RN) |
| TypeScript (هر ۴ پکیج) | 5.6.3 / 5.8.3 | **5.9.3 یکپارچه** | typecheck هر سه frontend سبز |
| @types/node | 22.9.0 / — | **24.19.2** | = خط مبنای `.nvmrc` ‏(Node 24) |
| @types/react(-dom) | 18.x / 19.0 | **19.3.0 یکپارچه** | — |

- **چرا TS ‏5.9.3 و نه 7.0.2:** ‏TypeScript 7 (پورت native) تازه منتشر
  شده و ابزارهای این stack ‏(Next 16، Expo SDK 58، Vite) روی خط 5.9
  اعتبارسنجی شده‌اند؛ یکپارچگی نسخه (هدف M-06) با 5.9.3 در هر چهار
  پکیج محقق است و پرش به 7 موج جدا می‌خواهد. هیچ پکیجی روی نسخهٔ
  دیگری از TS نماند.
- **React موبایل 19.3.0** (نه 19.3.1) چون SDK 58 همان را bundle و
  با RN 0.88 تست کرده است؛ خط نسخه در کل monorepo ‏19.3 است.
- تغییرات breaking مدیریت‌شده: Turbopack پیش‌فرض Next 16
  (transpilePackages + turbopack.root)، حذف `next lint`، انتقال
  splash موبایل به پلاگین `expo-splash-screen`، API کلاسیک
  expo-file-system به زیرمسیر `/legacy`، تایپ‌های RN از
  `exports.types` در 0.88. CRM روی vite 6 ماند چون plugin-react 6
  به vite 8 نیاز دارد و نسخهٔ فعلی با React 19 سبز است.

## تصمیم PostgreSQL
**نسل ۱۶ می‌ماند** — ارتقای major دیتابیس در این موج انجام نمی‌شود:
1. ایمیج compose روی `pgvector/pgvector:pg16` پین شده (B-03) و
   افزونه‌های vector/pg_trgm برای نسل ۱۶ در دسترس و تست‌شده‌اند
   (CI job ‏postgres با همان ایمیج migration + integration test
   را اجرا می‌کند).
2. ارتقای major ‏PostgreSQL نیازمند چرخهٔ جدا با تست restore از
   بکاپ واقعی و dump/restore یا pg_upgrade روی staging است؛ ترکیب
   آن با موج ارتقای frontend ریسک را بدون سود فوری چند برابر می‌کند.
3. بازبینی: وقتی staging واقعی (C-04) در دسترس بود، ارتقا به نسل
   جاری با runbook ‏DR (m-04) در یک موج مستقل انجام شود.

## پیامدها
- هر سه frontend روی React 19 و یک TS واحدند؛ نصب‌ها reproducible
  (پین دقیق برای همهٔ اقلام ارتقایافته؛ بقیهٔ وابستگی‌ها دست نخورد).
