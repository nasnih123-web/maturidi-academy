#!/usr/bin/env python3
"""ساخت خودکار داشبوردهای پایهٔ Metabase — m-03.

از REST API متابیس (v0.52) استفاده می‌کند: اتصال دیتابیس محصول،
کالکشن، سؤال‌های native (SQLهای infra/metabase/seed-dashboards.md —
این دو باید هم‌گام بمانند) و داشبوردهای گروه‌بندی آن‌ها.
Idempotent است: آبجکت هم‌نام آپدیت می‌شود، دوباره ساخته نمی‌شود.

پیش‌نیاز: ساخت اولین ادمین در UI متابیس (API راه headless ندارد).

env لازم:
  MB_URL, MB_ADMIN_EMAIL, MB_ADMIN_PASSWORD
  MB_PRODUCT_DB_HOST, MB_PRODUCT_DB_USER, MB_PRODUCT_DB_PASSWORD
  (اختیاری: MB_PRODUCT_DB_PORT=5432, MB_PRODUCT_DB_NAME=maturidi)

وضعیت اثبات: در محیط سندباکس نمونهٔ Metabaseای نیست — اجرا NOT RUN؛
کد با dry-run ‏(MB_DRY_RUN=1) بدون ساخت session فقط payloadها را
چاپ می‌کند تا شکل درخواست‌ها بازبینی شود.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

MB_URL = os.environ.get("MB_URL", "http://localhost:3001").rstrip("/")
DRY_RUN = os.environ.get("MB_DRY_RUN") == "1"

DATE_TAGS = {
    "start_date": {
        "id": "maturidi-start-date",
        "name": "start_date",
        "display-name": "Start date",
        "type": "date",
        "required": True,
    },
    "end_date": {
        "id": "maturidi-end-date",
        "name": "end_date",
        "display-name": "End date",
        "type": "date",
        "required": True,
    },
}

# (نام سؤال, داشبورد, SQL, نمایش) — SQLها از seed-dashboards.md
QUESTIONS: list[tuple[str, str, str, str]] = [
    (
        "User growth — signups per day",
        "1. User growth",
        """SELECT date_trunc('day', created_at)::date AS day, locale,
  COUNT(*) AS signups,
  COUNT(*) FILTER (WHERE is_verified) AS verified,
  COUNT(*) FILTER (WHERE NOT is_active) AS deactivated
FROM users
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2 ORDER BY 1, 2""",
        "line",
    ),
    (
        "Engagement — events per module per day",
        "2. Per-module engagement",
        """SELECT date_trunc('day', created_at)::date AS day,
  CASE
    WHEN event_type LIKE 'fatwa.%' THEN 'fatwa'
    WHEN event_type LIKE 'voice.%' THEN 'voice'
    WHEN event_type LIKE 'tasbih.%' THEN 'tasbih'
    WHEN event_type LIKE 'quran.%' THEN 'quran'
    WHEN event_type LIKE 'lms.%' THEN 'lms'
    WHEN event_type LIKE 'social.%' THEN 'social'
    WHEN event_type LIKE 'library.%' THEN 'library'
    WHEN event_type LIKE 'sync.%' THEN 'sync'
    WHEN event_type LIKE 'user.%' THEN 'user_account'
    WHEN event_type LIKE 'place.%' THEN 'places'
    ELSE 'other' END AS module,
  COUNT(*) AS events
FROM domain_events
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2 ORDER BY 1, 2""",
        "bar",
    ),
    (
        "Popular content — top social posts",
        "3. Popular content",
        """SELECT p.id, LEFT(p.body, 120) AS excerpt, p.likes_count,
  p.comment_count, p.created_at
FROM social_posts p
WHERE p.status = 'published'
  AND p.created_at >= {{start_date}} AND p.created_at < {{end_date}}
ORDER BY p.likes_count DESC, p.comment_count DESC
LIMIT 50""",
        "table",
    ),
    (
        "Fatwa — sessions & messages per day",
        "4. Fatwa volume",
        """SELECT date_trunc('day', s.created_at)::date AS day,
  COUNT(DISTINCT s.id) AS sessions,
  COUNT(m.id) FILTER (WHERE m.role = 'user') AS user_messages,
  COUNT(m.id) FILTER (WHERE m.role = 'assistant') AS assistant_messages
FROM fatwa_sessions s
LEFT JOIN fatwa_messages m ON m.session_id = s.id
WHERE s.created_at >= {{start_date}} AND s.created_at < {{end_date}}
GROUP BY 1 ORDER BY 1""",
        "line",
    ),
    (
        "Widgets — API key usage this month",
        "5. Widget embed stats",
        """SELECT name, key_prefix, used_this_month, quota_monthly,
  ROUND(100.0 * used_this_month / NULLIF(quota_monthly, 0), 1) AS quota_pct,
  last_used_at
FROM api_keys
WHERE is_active
ORDER BY used_this_month DESC""",
        "table",
    ),
    (
        "Funnel — signup to certificate",
        "6. Conversion funnel",
        """WITH started AS (
  SELECT DISTINCT user_id FROM user_progress
  WHERE updated_at >= {{start_date}} AND updated_at < {{end_date}}),
completed AS (
  SELECT DISTINCT user_id FROM user_progress
  WHERE status = 'completed'
    AND completed_at >= {{start_date}} AND completed_at < {{end_date}}),
certified AS (
  SELECT DISTINCT user_id FROM certificates
  WHERE issued_at >= {{start_date}} AND issued_at < {{end_date}}),
signed_up AS (
  SELECT id AS user_id FROM users
  WHERE created_at >= {{start_date}} AND created_at < {{end_date}})
SELECT 'signed_up' AS stage, COUNT(*) AS users FROM signed_up
UNION ALL SELECT 'lesson_started', COUNT(*) FROM started
UNION ALL SELECT 'lesson_completed', COUNT(*) FROM completed
UNION ALL SELECT 'certified', COUNT(*) FROM certified""",
        "funnel",
    ),
    (
        "Finance — donations per day by gateway",
        "7. Finance reports",
        """SELECT date_trunc('day', created_at)::date AS day, gateway, status,
  COUNT(*) AS donations, SUM(amount) AS total_amount_irr
FROM donations
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""",
        "bar",
    ),
    (
        "Finance — revenue by campaign",
        "7. Finance reports",
        """SELECT COALESCE(c.title->>'fa', 'بدون کمپین') AS campaign,
  COUNT(d.id) AS donations,
  SUM(d.amount) AS revenue_irr,
  c.goal_amount,
  ROUND(100.0 * SUM(d.amount) / NULLIF(c.goal_amount, 0), 1) AS goal_pct
FROM donations d
LEFT JOIN donation_campaigns c ON c.id = d.campaign_id
WHERE d.status = 'succeeded'
  AND d.created_at >= {{start_date}} AND d.created_at < {{end_date}}
GROUP BY c.id, c.title, c.goal_amount
ORDER BY revenue_irr DESC""",
        "table",
    ),
    (
        "Finance — payment intents by status",
        "7. Finance reports",
        """SELECT gateway, status, COUNT(*) AS intents, SUM(amount) AS amount_irr
FROM payment_intents
WHERE created_at >= {{start_date}} AND created_at < {{end_date}}
GROUP BY 1, 2 ORDER BY 1, 2""",
        "table",
    ),
]

_session: str | None = None


def _call(method: str, path: str, payload: dict | None = None) -> dict:
    url = f"{MB_URL}{path}"
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    if _session:
        req.add_header("X-Metabase-Session", _session)
    if DRY_RUN:
        print(f"[dry-run] {method} {path} :: {json.dumps(payload)[:200]}")
        return {}
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


def _login() -> None:
    global _session
    out = _call(
        "POST",
        "/api/session",
        {
            "username": os.environ["MB_ADMIN_EMAIL"],
            "password": os.environ["MB_ADMIN_PASSWORD"],
        },
    )
    _session = out.get("id")
    if not _session and not DRY_RUN:
        raise SystemExit("login failed: no session id in response")


def _find_by_name(items: list[dict], name: str) -> dict | None:
    return next((i for i in items if i.get("name") == name), None)


def _list(resp) -> list[dict]:
    """پاسخ لیست متابیس بین نسخه‌ها فرق می‌کند: لیست خام یا {data: [...]}."""
    if isinstance(resp, list):
        return resp
    return resp.get("data", []) if isinstance(resp, dict) else []


def ensure_database() -> int:
    existing = _find_by_name(_list(_call("GET", "/api/database")),
                             "Maturidi Academy")
    payload = {
        "name": "Maturidi Academy",
        "engine": "postgres",
        "details": {
            "host": os.environ["MB_PRODUCT_DB_HOST"],
            "port": int(os.environ.get("MB_PRODUCT_DB_PORT", "5432")),
            "dbname": os.environ.get("MB_PRODUCT_DB_NAME", "maturidi"),
            "username": os.environ["MB_PRODUCT_DB_USER"],
            "password": os.environ["MB_PRODUCT_DB_PASSWORD"],
            "ssl": False,
        },
    }
    if existing:
        _call("PUT", f"/api/database/{existing['id']}", payload)
        return int(existing["id"])
    return int(_call("POST", "/api/database", payload).get("id", 0))


def ensure_collection() -> int:
    existing = _find_by_name(_list(_call("GET", "/api/collection")),
                             "Maturidi Academy")
    if existing:
        return int(existing["id"])
    out = _call(
        "POST", "/api/collection",
        {"name": "Maturidi Academy", "color": "#047857"},
    )
    return int(out.get("id", 0))


def ensure_card(name: str, sql: str, display: str, db_id: int,
                collection_id: int) -> int:
    payload = {
        "name": name,
        "dataset_query": {
            "type": "native",
            "native": {"query": sql, "template-tags": DATE_TAGS},
            "database": db_id,
        },
        "display": display,
        "visualization_settings": {},
        "collection_id": collection_id,
    }
    existing = _find_by_name(_list(_call("GET", "/api/card")), name)
    if existing:
        _call("PUT", f"/api/card/{existing['id']}", payload)
        return int(existing["id"])
    return int(_call("POST", "/api/card", payload).get("id", 0))


def ensure_dashboard(name: str, card_ids: list[int], collection_id: int) -> int:
    existing = _find_by_name(_list(_call("GET", "/api/dashboard")), name)
    if existing:
        dash_id = int(existing["id"])
    else:
        dash_id = int(
            _call(
                "POST", "/api/dashboard",
                {"name": name, "collection_id": collection_id},
            ).get("id", 0)
        )
    cards = [
        {
            "id": -(i + 1),
            "card_id": cid,
            "row": i * 6,
            "col": 0,
            "size_x": 12,
            "size_y": 6,
        }
        for i, cid in enumerate(card_ids)
    ]
    _call("PUT", f"/api/dashboard/{dash_id}", {"cards": cards})
    return dash_id


def main() -> None:
    _login()
    db_id = ensure_database()
    collection_id = ensure_collection()
    by_dashboard: dict[str, list[int]] = {}
    for name, dashboard, sql, display in QUESTIONS:
        cid = ensure_card(name, sql, display, db_id, collection_id)
        by_dashboard.setdefault(dashboard, []).append(cid)
        print(f"card ok: {name} (id={cid})")
    for dashboard, card_ids in by_dashboard.items():
        did = ensure_dashboard(dashboard, card_ids, collection_id)
        print(f"dashboard ok: {dashboard} (id={did})")
    print("done.")


if __name__ == "__main__":
    sys.exit(main())
