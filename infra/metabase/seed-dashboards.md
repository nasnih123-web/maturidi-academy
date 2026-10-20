# Metabase seed dashboards — Maturidi Academy (Phase 14, Track 3)

Metabase dashboards are created **in-app** (native questions, not migrations).
This document is the seed spec: for each of the 7 required dashboards you get
its **purpose**, the **SQL against the real production schema** (table/column
names verified against `apps/api/app/models/models.py` — nothing invented),
and the **setup steps** to recreate it in Metabase.

Conventions used in the SQL below:

- All timestamps are UTC in the DB (contract §1); convert to the viewer's
  timezone in Metabase with `{{timezone}}` or `AT TIME ZONE 'Asia/Tehran'`.
- Metabase date variables (`{{start_date}}`, `{{end_date}}`) are used where a
  dashboard benefits from a date filter; they become required dashboard
  filters on setup.
- `LocalizedText` columns (`title`, `name`) are JSONB `{"fa","ar","en"}` —
  display with `title->>'fa'`.

Prerequisite for everything below: add a **PostgreSQL database** connection in
Metabase named `Maturidi Academy` pointing at the product database (or its
read replica when load is high — see the replica guidance in
`docker-compose.metabase.yml`). The CRM embeds Metabase via the non-secret
platform setting `bi.metabase_url` (see `apps/crm/src/pages/Analytics.tsx`).

---

## 1. User growth — رشد کاربران

**Purpose:** daily/weekly signups, active share, and locale/verification split —
the top-line health of the platform.

```sql
-- Signups per day, with locale and verification split
SELECT
  date_trunc('day', created_at)::date              AS day,
  locale,
  COUNT(*)                                        AS signups,
  COUNT(*) FILTER (WHERE is_verified)             AS verified,
  COUNT(*) FILTER (WHERE NOT is_active)           AS deactivated
FROM users
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2
ORDER BY 1, 2;
```

**Setup:** native question → line chart (x = day, y = signups, break-out by
locale) + a second question as a number card: total signups in range
(`COUNT(*) FROM users WHERE created_at BETWEEN …`).

---

## 2. Per-module engagement — تعامل به‌تفکیک ماژول

**Purpose:** which product modules people actually use, aggregated from the
real domain-event stream (`domain_events`, contract §4).

The `event_type` values below are the real vocabulary emitted by the backend
(grep `event_type="` in `apps/api/app` to re-verify after new phases).

```sql
-- Events per module per day
SELECT
  date_trunc('day', created_at)::date AS day,
  CASE
    WHEN event_type LIKE 'fatwa.%'     THEN 'fatwa'
    WHEN event_type LIKE 'voice.%'     THEN 'voice'
    WHEN event_type LIKE 'tasbih.%'    THEN 'tasbih'
    WHEN event_type LIKE 'quran.%'     THEN 'quran'
    WHEN event_type LIKE 'lms.%'       THEN 'lms'
    WHEN event_type LIKE 'social.%'    THEN 'social'
    WHEN event_type LIKE 'library.%'   THEN 'library'
    WHEN event_type LIKE 'sync.%'      THEN 'sync'
    WHEN event_type LIKE 'user.%'      THEN 'user_account'
    WHEN event_type LIKE 'place.%'     THEN 'places'
    ELSE 'other'
  END                                AS module,
  COUNT(*)                           AS events,
  COUNT(DISTINCT (payload->>'user_id')) FILTER (WHERE payload ? 'user_id')
                                     AS distinct_users
FROM domain_events
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2
ORDER BY 1, 2;
```

**Setup:** stacked bar/area chart (x = day, stack = module, y = events).
Add a dashboard filter on `module` for drill-down.

---

## 3. Popular content — محبوب‌ترین محتوا

**Purpose:** what content resonates — most-liked social posts (with comment
volume) and the most-used library items.

`social_posts` carries real counters (`likes_count`, `comment_count`);
`library_items` has no view counter, so its table shows publication/AI-usage
footprint — the honest available signal.

```sql
-- Top social posts by likes (with comments)
SELECT
  p.id,
  LEFT(p.body, 120)        AS excerpt,
  p.likes_count,
  p.comment_count,
  p.created_at
FROM social_posts p
WHERE p.status = 'published'
  AND p.created_at >= {{start_date}} AND p.created_at < {{end_date}}
ORDER BY p.likes_count DESC, p.comment_count DESC
LIMIT 50;
```

```sql
-- Library items: publication status + AI-index footprint
SELECT
  kind,
  COUNT(*)                                        AS items,
  COUNT(*) FILTER (WHERE workflow_status = 'published') AS published,
  COUNT(*) FILTER (WHERE ai_indexed)              AS ai_indexed,
  MAX(published_at)                               AS latest_publish
FROM library_items
GROUP BY kind
ORDER BY items DESC;
```

**Setup:** table question for posts (top-50), bar chart for library items by
`kind`. Note in the dashboard description that per-item view tracking does
not exist yet — if `content.viewed` events are added to `domain_events` later,
extend dashboard 2's query instead.

---

## 4. Fatwa volume — حجم فتوا

**Purpose:** fatwa demand (sessions/messages), topic mix via message roles,
and AI cost — from `fatwa_sessions`, `fatwa_messages`, and `ai_usage_log`.

```sql
-- Fatwa sessions & messages per day
SELECT
  date_trunc('day', s.created_at)::date AS day,
  COUNT(DISTINCT s.id)                  AS sessions,
  COUNT(m.id) FILTER (WHERE m.role = 'user')      AS user_messages,
  COUNT(m.id) FILTER (WHERE m.role = 'assistant') AS assistant_messages
FROM fatwa_sessions s
LEFT JOIN fatwa_messages m ON m.session_id = s.id
WHERE s.created_at >= {{start_date}} AND s.created_at < {{end_date}}
GROUP BY 1
ORDER BY 1;
```

```sql
-- Token usage & estimated cost (fatwa endpoints)
SELECT
  date_trunc('day', created_at)::date AS day,
  model,
  SUM(tokens_in)  AS tokens_in,
  SUM(tokens_out) AS tokens_out,
  SUM(cost_estimate) AS cost_estimate
FROM ai_usage_log
WHERE endpoint IN ('fatwa.ask', 'fatwa.rag')
  AND created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2
ORDER BY 1, 2;
```

**Setup:** line chart (sessions vs messages) + table/number cards for tokens
and cost. Verify the `endpoint` values against `ai_usage_log` rows in your
environment — the query lists the two currently emitted.

---

## 5. Widget embed stats — آمار ویجت embed

**Purpose:** how often Phase-11 embeddable widgets are rendered off-site.

> **Prerequisite (honest gap):** no widget-impression table and no
> `widget.rendered` domain event exist in the schema yet. The query below is
> written against `domain_events` so it starts working the moment the backend
> emits `widget.rendered` events with `payload = {"widget_id": …, "host": …,
> "user_id": …}`. Until then this dashboard shows "no data" — do not fake it.

```sql
-- Widget renders per widget/host per day (needs widget.rendered events)
SELECT
  date_trunc('day', created_at)::date       AS day,
  payload->>'widget_id'                     AS widget_id,
  payload->>'host'                          AS host,
  COUNT(*)                                  AS renders,
  COUNT(DISTINCT (payload->>'user_id')) FILTER (WHERE payload ? 'user_id')
                                            AS distinct_users
FROM domain_events
WHERE event_type = 'widget.rendered'
  AND created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2, 3
ORDER BY 1, 4 DESC;
```

**Setup:** create the question now (it will be empty); add the dashboard card
anyway so the slot exists. Backend TODO: emit `widget.rendered` from the
widget render path (Phase 11 widgets, `docs/adr/0008-phase11-telegram-widgets-backend.md`).

---

## 6. Conversion funnel — قیف تبدیل

**Purpose:** signup → lesson activity → course completion → certificate —
built from `users`, `user_progress` (status `completed`), and `certificates`.

```sql
-- Funnel for courses with activity in range
WITH started AS (
  SELECT DISTINCT user_id FROM user_progress
  WHERE updated_at >= {{start_date}} AND updated_at < {{end_date}}
),
completed AS (
  SELECT DISTINCT user_id FROM user_progress
  WHERE status = 'completed'
    AND completed_at >= {{start_date}} AND completed_at < {{end_date}}
),
certified AS (
  SELECT DISTINCT user_id FROM certificates
  WHERE issued_at >= {{start_date}} AND issued_at < {{end_date}}
),
signed_up AS (
  SELECT id AS user_id FROM users
  WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
)
SELECT 'signed_up'   AS stage, COUNT(*) AS users FROM signed_up
UNION ALL
SELECT 'lesson_started', COUNT(*) FROM started
UNION ALL
SELECT 'lesson_completed', COUNT(*) FROM completed
UNION ALL
SELECT 'certified', COUNT(*) FROM certified;
```

**Setup:** funnel visualization in Metabase (ordered by the fixed stage
order above). Optional second question: per-course completion rate joining
`courses` → `lessons` → `user_progress` on `lesson_id` where `status =
'completed'`.

---

## 7. Finance reports — گزارش مالی

**Purpose:** donations and ledger overview.

> **Prerequisite (Phase 15):** the finance tables (`donations`,
> `payment_intents`, `donation_campaigns`, `ledger_entries`) are specified in
> the Phase 15 spec and do **not exist yet**. The draft SQL below follows the
> Phase 15 contract (`donations.donor_id` nullable, `donations.gateway`,
> `donations.gateway_reference`, `donations.status`, `donations.created_at`;
> `payment_intents.status` ∈ pending/succeeded/failed). Create this dashboard
> only after Phase 15 migrations land, and re-verify column names against
> `models.py` at that time.

```sql
-- Draft — enable after Phase 15
-- Donations per day by gateway and status
-- SELECT
--   date_trunc('day', created_at)::date AS day,
--   gateway,
--   status,
--   COUNT(*) AS donations,
--   SUM(amount) AS total_amount
-- FROM donations
-- WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
-- GROUP BY 1, 2, 3
-- ORDER BY 1, 2, 3;
```

**Setup:** placeholder dashboard with this note; wire it up in Phase 15.

---

## General setup steps (all dashboards)

1. Start Metabase: `docker compose -f infra/metabase/docker-compose.metabase.yml up -d`.
2. Open `http://localhost:3001` (or `MB_SITE_URL`), finish the admin setup.
3. Admin → Databases → Add database → PostgreSQL → name it `Maturidi Academy`,
   host = product Postgres (or the read replica), dbname `maturidi`.
4. For each dashboard above: **+ New → Native query**, paste the SQL, **Save**
   as a question, then **+ New → Dashboard**, add the saved questions, and add
   the `{{start_date}}` / `{{end_date}}` variables as **dashboard filters**
   (type: Date).
5. Set the CRM setting `bi.metabase_url` to the Metabase base URL so the CRM
   Analytics page embeds it (`apps/crm/src/pages/Analytics.tsx`).
