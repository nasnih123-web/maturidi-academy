# ADR-0014: بک‌اند فاز ۱۶ — مدیریت پروژه و نیروی انسانی داخلی (PMS)

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-19
- میل‌استون: فاز ۱۶ — Track 1 (بک‌اند)

## زمینه

فاز ۱۶ ابزار تیم داخلی است، نه کاربر نهایی: بورد کانبان پروژه‌ها، تسک‌های
محول‌شدنی (از جمله اتصال به آیتم کتابخانه)، اعلان محول‌شدن/سررسید، و رجیستر
سادهٔ نیروی انسانی. اسپک صراحتاً می‌گوید حقوق/دستمزد، مرخصی و قرارداد رسمی
ساخته نمی‌شود. قراردادهای حاکم: §۱۵.۴ (LocalizedText)، §۴ (outbox)،
§۱۴ (audit)، §۲ (RBAC واقعی)، §۹.۵ (no future-FK coupling).

## تصمیم

۱. **سه جدول typed** (`projects`, `tasks`, `staff_members`) در migration
   `e6f1a2b3c4d5`؛ FK فقط به جدول‌های موجود (`users`, `projects`).
   `tasks.related_entity_type/id` مرجع نرم (رشته + UUID) است — بدون FK
   فیزیکی (§۹.۵)؛ lookup معکوس از `GET /api/v1/projects/tasks/by-entity`.
۲. **وضعیت‌ها پرچم ساده‌اند، نه موتور گردش‌کار §۹:** پروژه‌ها ابزار داخلی‌اند،
   نه محتوای قابل‌انتشار؛ تسک‌ها ماشین گذار اختصاصی خود را دارند
   (`TASK_TRANSITIONS` در schemas — `move` فقط گذار مجاز را قبول می‌کند،
   بقیه ۴۲۲). `done → todo` برای بازگشایی مجاز است.
۳. **RBAC:** مجوز جدید `projects.manage` (seed: همهٔ مجوزها خودکار به
   super_admin می‌رسد + اعطای صریح به نقش admin). همهٔ writeها این مجوز را
   می‌خواهند؛ readها «کارمند احرازشده» (دارندهٔ مجوز یا ردیف فعال
   staff_members) — چون PMS ابزار داخلی تیم است، نه API عمومی.
۴. **اعلان assignment/due_soon** از همان `notify_service` فاز ۱۴ استفاده
   می‌کند: کانال‌های مؤثر از `effective_channels` (احترام به
   `notification_preferences`، پیش‌فرض in_app فعال) و senderهای واقعی
   `CHANNEL_SENDERS` با تنزل صادقانهٔ همان ماژول. تحویل in_app در جدول
   موجود `notifications` با `notif_type="task"` و `data={source:"pms", kind,
   task_id, project_id}` ثبت می‌شود — جدول `notification_deliveries` به
   `broadcast_id` گره خورده و برای اعلان مستقیم مناسب نیست، پس رکورد
   `notifications` سند تحویل است.
۵. **کرون due_soon** هر ۶ ساعت روی صف `notifications`
   (`hour={0,6,12,18}`): کاندیدا = `due_date ≤ now+24h`، `status ≠ done`،
   `due_notified_at` خالی یا قدیمی‌تر از ۲۰ ساعت (ضد اسپم). تسک بدون
   assignee هم علامت‌گذاری می‌شود تا هر اجرا دوباره اسکن نشود. منطق در
   `service.run_task_due_soon_cycle(db, now=...)` با now تزریقی است و پوستهٔ
   ARQ در `due_cron.py` فقط session می‌سازد (الگوی `calendar_tasks` فاز ۴).
۶. **رویدادهای دامنه (§۴):** `project.created`، `task.created`،
   `task.assigned`، `task.status_changed`، `task.due_soon` — همه در همان
   تراکنش تغییر از طریق `emit_event`.
۷. **Audit (§۱۴):** روی create/update/delete پروژه و تسک، `move`، `assign`
   (جداگانه وقتی assignee عوض می‌شود) و CRUD نیروی انسانی؛ بدون secret.
۸. **Seed:** فقط یک پروژهٔ «نمونه (دمو — قابل حذف)» با برچسب واضح در هر سه
   زبان — بدون تسک (وضعیت صادقانهٔ خالی). payroll/leave/contracts عمداً
   ساخته نشد.

## پیامدها

- مثبت: کانبان با گذارهای اعتبارسنجی‌شده؛ تسک از صفحهٔ آیتم کتابخانه قابل
  دسترس است (by-entity)؛ اعلان‌ها چندکاناله و قابل‌تنظیم توسط کاربر؛
  هیچ اسپم سررسیدی.
- منفی: readها برای غیرعضو تیم بسته است (حتی با توکن معتبر) — تصمیم آگاهانه
  برای ابزار داخلی. اعلان مستقیم delivery رکورد per-channel در
  `notification_deliveries` ندارد (محدودیت اسکیمای همان جدول).

## جایگزین‌های ردشده

- استفاده از موتور گردش‌کار مشترک §۹ برای وضعیت تسک‌ها: آن موتور برای
  محتوای قابل‌انتشار (draft→in_review→approved→published) طراحی شده؛
  کانبان (backlog→todo→in_progress→review→done) معنای متفاوتی دارد —
  تحمیل آن، قرارداد را خراب می‌کرد.
- FK فیزیکی tasks → library_items: نقض §۹.۵ (coupling بین فازها)؛ مرجع نرم
  کافی است و lookup معکوس را هم پوشش می‌دهد.
- ساخت جدول اعلان مستقیم جدا: تکرار غیرضروری؛ جدول `notifications` موجود
  دقیقاً برای همین (اعلان per-user) ساخته شده بود.
- اعلان SMS/push اجباری برای assignment: نقض احترام به ترجیحات کاربر؛
  کانال از `notification_preferences` خوانده می‌شود.
