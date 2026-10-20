# ADR-0012: آشتی قرارداد UI/Backend فاز ۱۴ (Contract Reconciliation)

**تاریخ:** ۲۰۲۶-۱۰-۱۹
**وضعیت:** پذیرفته‌شده
**مرتبط با:** ADR-0011 (بک‌اند کنترل ادمین فاز ۱۴)، §۹/§۹.۵/§۱۴ قرارداد مهندسی

## زمینه

Track 2 (UI مرکز کنترل CRM) بر اساس یک قرارداد فرضی از بک‌اند کدنویسی شده بود؛
Track 1 (بک‌اند) قرارداد واقعی متفاوتی پیاده کرده بود. بدون آشتی، UI به
endpointهای ناموجود صدا می‌زد (۴۰۴ قطعی در ۱۴+ تابع سرویس).

## تصمیم

به‌جای بازنویسی UI، قرارداد بک‌اند را در مواردی که UI نیاز واقعی داشت گسترش
دادیم و لایهٔ سرویس UI (`apps/crm/src/lib/admin14.ts`) را به قرارداد واقعی
بک‌اند rewiring کردیم. اصل: **بک‌اند مرجع حقیقت است؛ UI تطبیق می‌یابد**، مگر
آنجا که افزودن یک endpoint کوچک، شکاف واقعی محصول را پر کند.

## تغییرات API (افزودنی، بدون شکستن قرارداد موجود)

| متد | مسیر | دلیل |
|---|---|---|
| POST | `/api/v1/admin/content/items/{d}/{ct}/{id}/transition` | گذار تکی گردش‌کار از تب Workflow (bulk فقط گروهی بود) |
| POST | `/api/v1/admin/content/placements/reorder` | جابه‌جایی بدون deploy (مدیر جایگذاری) |
| PATCH | `/api/v1/admin/content/items/{d}/{ct}/{id}/distribution` | سیاست توزیع یکجای همهٔ کانال‌ها (تب Distribution) |
| PATCH | `/api/v1/admin/content/placements/{id}` | ویرایش placement تکی |
| GET | `/api/v1/admin/content/audit` | فید audit فیلتردار (تب Audit Log، §۱۴) |
| GET | `/api/v1/admin/content/ai-sources` | مرکز منابع AI (provenance + reindex_supported) |
| POST | `/api/v1/admin/content/ai-sources/{d}/{ct}/{id}/reindex` | re-index (برای کتابخانه به trigger_ingestion فاز ۶ delegate می‌شود) |
| POST | `/api/v1/admin/notifications/preview` | dry-run fan-out (پیش‌نمایش قبل از ارسال) |
| PATCH | `/api/v1/admin/users/{user_id}/roles` | جایگزینی نقش‌ها (role_ids یا role_names؛ محافظت super_admin خود) |
| POST | `/api/v1/admin/users/{user_id}/sessions/revoke` | ابطال نشست‌ها (نمای ۳۶۰°) |
| POST | `/api/v1/admin/fatwa/trusted-sources/{id}/check` | health-check منبع خارجی (HEAD/GET با timeout؛ super_admin) |
| POST | `/api/v1/telegram/distribute/approve/{id}` | تأیید دستی صف manual_approval (idempotent via send_pending) |
| POST | `/api/v1/telegram/distribute/reject/{id}` | رد دستی صف manual_approval |
| — | اکشن `ban_user` در `/api/v1/admin/social/reports/{id}/action` | غیرفعال‌سازی کاربر + ابطال نشست‌ها (محافظت super_admin) |

## نگاشت‌های UI → بک‌اند (بدون تغییر بک‌اند)

- صندوق محتوا: `/content/inbox` → `/content/items`؛ `channel` → `distribution_channel`
- placementها: فراخوانی‌های item-scoped → `/content/placements` واقعی با فیلتر؛ ساخت → PUT upsert با `surface`+`sort_order`
- توزیع: `GET /content/distribution?domain=&content_type=&id=`؛ `policy` تخت `{channel: bool}` (نه nested)
- نسخه‌ها: endpoint مجزا وجود ندارد → از `detail.versions` یا endpointهای کتابخانه
- منابع خارجی: → `/api/v1/admin/fatwa/trusted-sources` (+ `/check` جدید)
- مرکز تلگرام: → `/api/v1/telegram/distribute/*` (policies/log/retry/revoke/approve/reject)؛ dedupe سمت‌کلاینت از روی log
- کاربران: لیست → `/api/v1/admin/users`؛ جزئیات → `/{id}/overview` (شکل `{profile, roles, lms, ...}`)
- پرچم‌ها: → `/api/v1/admin/social/reports`؛ `hide_content` → `remove_content`
- اعلان‌ها: broadcast با `cohort:{type,roles?,user_ids?}`؛ لاگ → `GET /broadcasts`
- نقش‌ها: `GET /roles` (لیست) + `GET /roles/permissions`؛ ویرایش → `PUT /roles/{id}` با `permission_keys`

## پیامدها

- همهٔ endpointهای جدید RBAC-gated و audit‌شده‌اند (§۱۴).
- هیچ قرارداد موجودی شکسته نشد (افزودنی محض).
- تست: `tests/test_admin_phase14_contract.py` (۱۱ تست) قراردادهای جدید را پوشش می‌دهد.

## جایگزین‌های ردشده

- بازنویسی کامل UI بر اساس قرارداد بک‌اند: هزینهٔ زمانی بالا، بدون ارزش افزوده.
- ساخت endpointهای موازی جدید برای هر نیاز UI: تورم API و دوگانگی قرارداد.
