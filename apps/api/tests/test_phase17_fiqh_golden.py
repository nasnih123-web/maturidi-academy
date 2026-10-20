"""تست‌های فاز ۱۷ (Track 2) — golden tests قواعد فقهی ماشین‌حساب‌ها.

قانون سخت (§۱۵.۵ / ADR-0006) همچنان برقرار است: همهٔ فیکسچرها synthetic
و صریحاً برچسب «TEST» خورده‌اند؛ هیچ عدد فقهی واقعی در تست‌ها نیست.

پوشش (مکمل تست‌های فاز ۷، بدون تکرار):
- golden vector ارث: مقادیر دقیقِ دستی + پین‌کردن digest پایدار خروجی
- golden vector زکات: مرز دقیق نصاب (net == nisab → مشمول) + digest
- قطعی‌بودن (determinism): ورودی یکسان → خروجی بایت‌به‌بایت یکسان،
  مستقل از نوع عددی ورودی (Decimal/str/float)
- نرمال‌سازی کسرها: «2/4» → «1/2»
- خلوص موتور: engine.py هیچ import از app/DB/شبکه ندارد (قرارداد ADR-0006)
- گیت نسخه: نسخهٔ اعمال‌شده در پاسخ API دقیقاً همان config تأییدشدهٔ فعال است؛
  نسخهٔ تأییدنشدهٔ جدیدتر اعمال نمی‌شود؛ خروجی API با golden سطح موتور یکی است
"""
from __future__ import annotations

import ast
import hashlib
import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select

from app.modules.calculators import engine

BASE = "/api/v1"

# --- فیکسچرهای synthetic (TEST ONLY — نه فقه واقعی) --------------------------
# اعداد عمداً غیرواقعی انتخاب شده‌اند (نرخ ۱۳٪، نصاب ۵۰ گرم).

GOLDEN_INHERIT_RULE = {
    "note": "SYNTHETIC TEST FIXTURE — not fiqh, engine math only",
    "shares": {
        "spouse_t": {"share": "1/2"},
        "parent_t": {"share": "1/6"},
    },
    "awl": {"enabled": True},
    "radd": {"enabled": True, "excluded": ["spouse_t"]},
    "asaba_priority": ["sibling_t"],
}

GOLDEN_INHERIT_HEIRS = [
    {"type": "spouse_t", "count": 1},
    {"type": "parent_t", "count": 1},
    {"type": "sibling_t", "count": 2},
]

# مقادیر دستیِ موردانتظار برای ترکهٔ ۱۲۰۰:
# spouse: 1/2 → ۶۰۰ | parent: 1/6 → ۲۰۰ | sibling: باقیماندهٔ ۱/۳ → ۴۰۰ (نفری ۲۰۰)
GOLDEN_INHERIT_EXPECTED = {
    "spouse_t": ("1/2", "600.0000", "600.0000"),
    "parent_t": ("1/6", "200.0000", "200.0000"),
    "sibling_t": ("1/3", "400.0000", "200.0000"),
}
# پین digest خروجی کامل (sort_keys) — هر تغییر موتور این تست را می‌شکند.
GOLDEN_INHERIT_DIGEST = (
    "3ae6ca8f0b5618d69ceddeeaab2721d78aaa41cfcf1aeb8bbfb3d776a3abaafb"
)

GOLDEN_ZAKAT_RULE = {
    "note": "SYNTHETIC TEST FIXTURE — not fiqh",
    "zakat_rate": "0.13",  # عمداً غیرواقعی
    "nisab_basis": "gold",
    "nisab_gold_grams": "50",  # عمداً غیرواقعی
    "nisab_silver_grams": "300",
    "asset_categories": {
        "cash": {"type": "value"},
        "gold_grams": {"type": "grams", "price": "gold_per_gram"},
    },
}

GOLDEN_RATES = {
    "gold_per_gram": Decimal(20),
    "silver_per_gram": Decimal(2),
    "currency": "TST",
    "stale": False,
    "fetched_at": None,
}

# دارایی ۷۰۰ + ۲۰گرم×۲۰ = ۱۱۰۰؛ بدهی ۱۰۰ → خالص دقیقاً ۱۰۰۰ = نصاب (۵۰×۲۰)
GOLDEN_ZAKAT_DIGEST = (
    "0696ed21b01a6337e1ab3e09f3c75a4e0010d8ef5cb5c8e79237a26838eb130c"
)


def _digest(obj: dict) -> str:
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


# --- golden: ارث ---------------------------------------------------------------


def test_golden_inheritance_exact_amounts():
    out = engine.compute_inheritance(
        GOLDEN_INHERIT_HEIRS, Decimal(1200), GOLDEN_INHERIT_RULE,
        rule_version=100,
    )
    by_type = {s["heir_type"]: s for s in out["shares"]}
    assert set(by_type) == {"spouse_t", "parent_t", "sibling_t"}
    for htype, (frac, amount, per_person) in GOLDEN_INHERIT_EXPECTED.items():
        assert by_type[htype]["share_fraction"] == frac, htype
        assert by_type[htype]["amount"] == amount, htype
        assert by_type[htype]["per_person_amount"] == per_person, htype
    assert out["total_allocated_fraction"] == "1/1"
    assert out["notes"] == ["asaba_applied:sibling_t"]
    assert out["applied_rule_version"] == 100


def test_golden_inheritance_digest_pinned():
    out = engine.compute_inheritance(
        GOLDEN_INHERIT_HEIRS, Decimal(1200), GOLDEN_INHERIT_RULE,
        rule_version=100,
    )
    assert _digest(out) == GOLDEN_INHERIT_DIGEST


def test_engine_deterministic_across_runs_and_numeric_types():
    """یک ورودی، ده بار اجرا و سه نوع عددی → خروجی یکسان."""
    results = []
    for _ in range(10):
        results.append(
            engine.compute_inheritance(
                GOLDEN_INHERIT_HEIRS, Decimal(1200), GOLDEN_INHERIT_RULE,
                rule_version=100,
            )
        )
    first = json.dumps(results[0], sort_keys=True)
    assert all(json.dumps(r, sort_keys=True) == first for r in results)

    as_str = engine.compute_inheritance(
        GOLDEN_INHERIT_HEIRS, "1200", GOLDEN_INHERIT_RULE, rule_version=100
    )
    as_float = engine.compute_inheritance(
        GOLDEN_INHERIT_HEIRS, 1200.0, GOLDEN_INHERIT_RULE, rule_version=100
    )
    assert json.dumps(as_str, sort_keys=True) == first
    assert json.dumps(as_float, sort_keys=True) == first


def test_engine_normalizes_fractions():
    """«2/4» در خروجی به «1/2» نرمال می‌شود (canonical)."""
    rule = {"shares": {"a_t": {"share": "2/4"}}}
    out = engine.compute_inheritance(
        [{"type": "a_t", "count": 1}], Decimal(1000), rule, rule_version=1
    )
    assert out["shares"][0]["share_fraction"] == "1/2"
    assert out["shares"][0]["amount"] == "500.0000"
    assert out["notes"] == ["unallocated_remainder"]


def test_engine_pure_no_app_or_io_imports():
    """قرارداد ADR-0006: موتور pure است — بدون app، بدون DB، بدون شبکه."""
    import app.modules.calculators.engine as eng_mod

    src = open(eng_mod.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    banned = {
        "app", "sqlalchemy", "httpx", "requests", "socket",
        "asyncio", "aiohttp", "psycopg2", "asyncpg",
    }
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] in banned:
                    found.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] in banned:
                found.add(node.module)
    assert not found, f"engine.py imports ممنوعه دارد: {found}"


# --- golden: زکات ---------------------------------------------------------------


def test_golden_zakat_exact_nisab_boundary():
    """خالص دقیقاً برابر نصاب → مشمول (net >= nisab)."""
    out = engine.compute_zakat(
        {"cash": Decimal(700), "gold_grams": Decimal(20)},
        Decimal(100),
        GOLDEN_ZAKAT_RULE,
        GOLDEN_RATES,
        rule_version=7,
    )
    assert out["status"] == "ok"
    assert out["nisab_value"] == "1000.0000"
    assert out["net_assets"] == "1000.0000"
    assert out["nisab_met"] is True
    assert out["zakat_due"] == "130.0000"  # ۱۳٪ synthetic روی ۱۰۰۰
    assert out["applied_rule_version"] == 7


def test_golden_zakat_just_below_nisab():
    out = engine.compute_zakat(
        {"cash": Decimal("699.99"), "gold_grams": Decimal(20)},
        Decimal(100),
        GOLDEN_ZAKAT_RULE,
        GOLDEN_RATES,
        rule_version=7,
    )
    assert out["nisab_met"] is False
    assert out["zakat_due"] == "0.0000"


def test_golden_zakat_digest_pinned():
    out = engine.compute_zakat(
        {"cash": Decimal(700), "gold_grams": Decimal(20)},
        Decimal(100),
        GOLDEN_ZAKAT_RULE,
        GOLDEN_RATES,
        rule_version=7,
    )
    assert _digest(out) == GOLDEN_ZAKAT_DIGEST


def test_engine_zakat_deterministic():
    outs = [
        engine.compute_zakat(
            {"cash": Decimal(700), "gold_grams": Decimal(20)},
            Decimal(100), GOLDEN_ZAKAT_RULE, GOLDEN_RATES, rule_version=7,
        )
        for _ in range(5)
    ]
    first = json.dumps(outs[0], sort_keys=True)
    assert all(json.dumps(o, sort_keys=True) == first for o in outs)


# --- API: گیت نسخه در برابر golden موتور ----------------------------------------


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = uuid.uuid4().hex[:8]
    async with tc["maker"]() as db:
        perms = []
        for key in permissions:
            p = (
                await db.execute(select(Permission).where(Permission.key == key))
            ).scalar_one_or_none()
            if p is None:
                p = Permission(key=key, description=key)
                db.add(p)
                await db.flush()
            perms.append(p)
        role = Role(name=f"p17_golden_role_{suffix}", description="p17 golden")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست golden",
            email=f"p17golden-{suffix}@example.com",
            password_hash=hash_password("TestPass123"),
            locale="fa",
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        await db.commit()
        token = create_access_token(str(user.id))
        return {"Authorization": f"Bearer {token}"}


async def _create_rule(client, headers, version, rule_data):
    body = {
        "kind": "inheritance",
        "madhab": "hanafi",
        "source": "SYNTHETIC TEST FIXTURE — not fiqh",
        "version": version,
        "effective_from": datetime.now(UTC).isoformat(),
        "effective_to": None,
        "change_reason": "p17 golden test",
        "rule_data": rule_data,
    }
    r = await client.post(
        f"{BASE}/admin/calculators/rules?kind=inheritance", json=body,
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _submit_and_approve(client, manage_h, approve_h, rule_id):
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule_id}/submit?kind=inheritance",
        headers=manage_h,
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule_id}/review?kind=inheritance",
        json={"decision": "approve", "note": "p17 golden synthetic approval"},
        headers=approve_h,
    )
    assert r.status_code == 200, r.text


async def _calculate(client):
    r = await client.post(
        f"{BASE}/calculators/inheritance",
        json={
            "madhab": "hanafi",
            "estate_value": "1200",
            "heirs": GOLDEN_INHERIT_HEIRS,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_api_applies_active_approved_version_and_matches_engine_golden(tc):
    """نسخهٔ اعمال‌شده دقیقاً همان config تأییدشدهٔ فعال است و
    نتیجهٔ API با golden سطح موتور بایت‌به‌بایت یکی است."""
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))

    rule = await _create_rule(client, manage_h, 100,
                              dict(GOLDEN_INHERIT_RULE))
    await _submit_and_approve(client, manage_h, approve_h, rule["id"])

    data = await _calculate(client)
    result = data["result"]
    assert result["applied_rule_version"] == 100
    # نتیجهٔ API همان golden موتور است (بدون هیچ تبدیلی)
    engine_out = engine.compute_inheritance(
        GOLDEN_INHERIT_HEIRS, Decimal(1200), GOLDEN_INHERIT_RULE,
        rule_version=100,
    )
    assert json.dumps(result, sort_keys=True) == json.dumps(
        engine_out, sort_keys=True
    )


async def test_api_newer_unapproved_version_never_applies(tc):
    """نسخهٔ جدیدترِ تأییدنشده هرگز در محاسبهٔ عمومی اعمال نمی‌شود."""
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))

    # نسخهٔ ۱۰۱ draft می‌ماند (submit نمی‌شود)
    await _create_rule(client, manage_h, 101, dict(GOLDEN_INHERIT_RULE))

    data = await _calculate(client)
    assert data["result"]["applied_rule_version"] == 100


async def test_api_newer_approved_version_wins(tc):
    """بعد از تأیید نسخهٔ ۱۰۲ با دادهٔ متفاوت، همان اعمال می‌شود."""
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))

    rule2_data = {
        **GOLDEN_INHERIT_RULE,
        "shares": {"spouse_t": {"share": "1/4"}, "parent_t": {"share": "1/6"}},
    }
    rule = await _create_rule(client, manage_h, 102, rule2_data)
    await _submit_and_approve(client, manage_h, approve_h, rule["id"])

    data = await _calculate(client)
    result = data["result"]
    assert result["applied_rule_version"] == 102
    by_type = {s["heir_type"]: s for s in result["shares"]}
    assert by_type["spouse_t"]["amount"] == "300.0000"  # ۱/۴ از ۱۲۰۰
    # ثبت تاریخی: شناسهٔ config اعمال‌شده روی case ذخیره شده است
    assert data["rule_config_id"] == rule["id"]
