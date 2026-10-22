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

**Purpose:** how much Phase-11 embeddable widgets are used off-site.

**Current reality (updated — audit m-03, after C-06):** widget renders are
counted per API key. Since C-06 the counter is a Redis/in-process buffered
counter flushed periodically into `api_keys.used_this_month` (with
`quota_period` = `YYYY-MM` and `last_used_at`) — no per-render event stream
exists, so the honest dashboard is monthly usage per key, not per-day
renders. The `widget.rendered` event design below remains a future option;
until the backend emits it, do not present per-day render numbers.

```sql
-- Widget/API-key usage this month (real signal, api_keys)
SELECT
  name,
  key_prefix,
  used_this_month,
  quota_monthly,
  ROUND(100.0 * used_this_month / NULLIF(quota_monthly, 0), 1) AS quota_pct,
  last_used_at
FROM api_keys
WHERE is_active
ORDER BY used_this_month DESC;
```

**Setup:** table question sorted by usage; add a bar chart variant grouped
by `quota_period` history if you snapshot monthly (the table keeps only the
current period counter).

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

**Purpose:** donations, campaign revenue, and gateway health — Phase 15
tables are **live** (this section was rewritten in audit m-03; the earlier
"does not exist yet" draft is obsolete).

Real schema (verified against `apps/api/app/models/models.py`):
`donations(amount IRR, status ∈ succeeded|refunded|failed, gateway,
gateway_reference, campaign_id, created_at)`,
`payment_intents(amount, status, gateway, campaign_id)`,
`donation_campaigns(title JSONB, goal_amount, raised_amount, status)`,
`ledger_entries`.

```sql
-- Donations per day by gateway and status
SELECT
  date_trunc('day', created_at)::date AS day,
  gateway,
  status,
  COUNT(*)                            AS donations,
  SUM(amount)                         AS total_amount_irr
FROM donations
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

```sql
-- Revenue by campaign (succeeded donations only)
SELECT
  COALESCE(c.title->>'fa', 'بدون کمپین')  AS campaign,
  COUNT(d.id)                             AS donations,
  SUM(d.amount)                           AS revenue_irr,
  c.goal_amount,
  ROUND(100.0 * SUM(d.amount) / NULLIF(c.goal_amount, 0), 1) AS goal_pct
FROM donations d
LEFT JOIN donation_campaigns c ON c.id = d.campaign_id
WHERE d.status = 'succeeded'
  AND d.created_at >= {{start_date}} AND d.created_at < {{end_date}}
GROUP BY c.id, c.title, c.goal_amount
ORDER BY revenue_irr DESC;
```

```sql
-- Payment funnel: intents by status (gateway health)
SELECT
  gateway,
  status,
  COUNT(*)      AS intents,
  SUM(amount)   AS amount_irr
FROM payment_intents
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2
ORDER BY 1, 2;
```

**Setup:** bar chart (donations per day, break out by gateway), table for
revenue-by-campaign, number card for total succeeded revenue in range.
This dashboard is also created by the automation script below.

---

## Automation (m-03)

`infra/metabase/seed_dashboards.py` creates the base set over the Metabase
REST API — idempotently (existing questions/dashboards are matched by name
and updated, not duplicated):

- database connection `Maturidi Academy` (from `MB_PRODUCT_DB_*` env),
- collection `Maturidi Academy`,
- one native question per dashboard query in this file (dashboards 1–7,
  including finance + revenue-by-campaign),
- dashboards grouping those questions.

Run it after the manual first-admin setup (the API needs an admin
account — Metabase has no headless first-user creation without the setup
token dance):

```bash
MB_URL=http://localhost:3001 \
MB_ADMIN_EMAIL=admin@example.com MB_ADMIN_PASSWORD=... \
MB_PRODUCT_DB_HOST=postgres MB_PRODUCT_DB_USER=... \
MB_PRODUCT_DB_PASSWORD=... MB_PRODUCT_DB_NAME=maturidi \
python3 infra/metabase/seed_dashboards.py
```

**Automated vs manual (honest split):** questions + dashboards + the
database connection are automated. Still manual: the first Metabase admin
account, dashboard *filters* wiring (date variables are created inside the
questions; linking them as dashboard filters is a UI step), sharing /
permissions, and subscriptions/alerts.

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
