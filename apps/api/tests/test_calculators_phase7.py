"""تست‌های فاز ۷ — ماشین‌حساب ارث و زکات.

پوشش:
- engine: ریاضیات سهم‌ها در برابر فیکسچر synthetic با برچسب TEST
  (هرگز نام مذهب واقعی — قانون سخت §۱۵.۵)
- گیت تأیید: بدون config تأییدشده → rules_not_approved؛ بعد از approve → کار می‌کند
- نسخه‌بندی: نسخهٔ تأییدشدهٔ جدیدتر برنده است
- audit: هر گذار قاعده در audit_logs ثبت می‌شود
- قیمت نصاب: پرچم staleness + مسیر graceful بدون منبع

همهٔ اعداد فیکسچرها synthetic و صریحاً برچسب‌خورده‌اند؛ هیچ جدول فقهی
واقعی در تست‌ها هاردکد نشده است.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

BASE = "/api/v1"

# --- فیکسچر synthetic موتور (برچسب TEST — نه مذهب واقعی) --------------------
# اعداد کاملاً ساختگی و فقط برای اعتبارسنجی ریاضی موتور.

SYNTHETIC_RULE = {
    "note": "SYNTHETIC TEST FIXTURE — not fiqh, engine math only",
    "shares": {
        "spouse_t": {"share": "1/4"},
        "mother_t": {"share": "1/6"},
    },
    "awl": {"enabled": True},
    "radd": {"enabled": True, "excluded": ["spouse_t"]},
    "asaba_priority": ["child_t"],
}

SYNTHETIC_ZAKAT_RULE = {
    "note": "SYNTHETIC TEST FIXTURE — not fiqh",
    "zakat_rate": "0.1",  # عمداً ۱۰٪ تا synthetic بودنش واضح باشد
    "nisab_basis": "gold",
    "nisab_gold_grams": "100",  # عمداً ۱۰۰ تا synthetic بودنش واضح باشد
    "nisab_silver_grams": "700",
    "asset_categories": {
        "cash": {"type": "value"},
        "trade_goods": {"type": "value"},
        "gold_grams": {"type": "grams", "price": "gold_per_gram"},
    },
}

SYNTHETIC_RATES = {
    "gold_per_gram": Decimal("10"),
    "silver_per_gram": Decimal("1"),
    "currency": "TST",
    "stale": False,
    "fetched_at": None,
}


# --- engine: ارث ---


def test_engine_fixed_shares_and_asaba():
    from app.modules.calculators import engine

    out = engine.compute_inheritance(
        [
            {"type": "spouse_t", "count": 1},
            {"type": "mother_t", "count": 1},
            {"type": "child_t", "count": 2},
        ],
        Decimal("1200"),
        SYNTHETIC_RULE,
        rule_version=1,
    )
    by_type = {s["heir_type"]: s for s in out["shares"]}
    assert by_type["spouse_t"]["amount"] == "300.0000"
    assert by_type["mother_t"]["amount"] == "200.0000"
    assert by_type["child_t"]["amount"] == "700.0000"
    assert by_type["child_t"]["per_person_amount"] == "350.0000"
    assert out["total_allocated_fraction"] == "1/1"
    assert any(n.startswith("asaba_applied") for n in out["notes"])
    assert out["applied_rule_version"] == 1


def test_engine_awl_scales_down_proportionally():
    from app.modules.calculators import engine

    rule = {
        "shares": {
            "a_t": {"share": "1/2"},
            "b_t": {"share": "1/3"},
            "c_t": {"share": "1/4"},
        },  # جمع = ۱۳/۱۲ > ۱
        "awl": {"enabled": True},
    }
    out = engine.compute_inheritance(
        [
            {"type": "a_t", "count": 1},
            {"type": "b_t", "count": 1},
            {"type": "c_t", "count": 1},
        ],
        Decimal("1300"),
        rule,
        rule_version=1,
    )
    by_type = {s["heir_type"]: s for s in out["shares"]}
    assert by_type["a_t"]["amount"] == "600.0000"  # ۱/۲ × ۱۲/۱۳ × ۱۳۰۰
    assert by_type["b_t"]["amount"] == "400.0000"
    assert by_type["c_t"]["amount"] == "300.0000"
    assert "awl_applied" in out["notes"]


def test_engine_radd_returns_surplus():
    from app.modules.calculators import engine

    rule = {
        "shares": {"mother_t": {"share": "1/6"}},
        "radd": {"enabled": True, "excluded": []},
    }
    out = engine.compute_inheritance(
        [{"type": "mother_t", "count": 1}], Decimal("600"), rule, rule_version=1
    )
    assert out["shares"][0]["amount"] == "600.0000"  # ۱/۶ → رد به ۱
    assert out["shares"][0]["share_fraction"] == "1/1"
    assert "radd_applied" in out["notes"]


def test_engine_unknown_heir_rejected():
    from app.modules.calculators import engine

    try:
        engine.compute_inheritance(
            [{"type": "nope_t", "count": 1}],
            Decimal("100"),
            SYNTHETIC_RULE,
            rule_version=1,
        )
    except engine.CalculatorError as exc:
        assert exc.code == "unknown_heir"
    else:
        raise AssertionError("expected CalculatorError")


def test_engine_empty_rule_data_rejected():
    from app.modules.calculators import engine

    try:
        engine.compute_inheritance(
            [{"type": "spouse_t", "count": 1}], Decimal("100"), {}, rule_version=1
        )
    except engine.CalculatorError as exc:
        assert exc.code == "rule_data_empty"
    else:
        raise AssertionError("expected CalculatorError")


# --- engine: زکات ---


def test_engine_zakat_ok():
    from app.modules.calculators import engine

    out = engine.compute_zakat(
        {"cash": Decimal("500"), "gold_grams": Decimal("60"), "trade_goods": Decimal("0")},
        Decimal("100"),
        SYNTHETIC_ZAKAT_RULE,
        SYNTHETIC_RATES,
        rule_version=1,
    )
    # دارایی: ۵۰۰ + ۶۰×۱۰ = ۱۱۰۰؛ خالص ۱۰۰۰؛ نصاب ۱۰۰×۱۰=۱۰۰۰ → مشمول
    assert out["status"] == "ok"
    assert out["total_assets"] == "1100.0000"
    assert out["net_assets"] == "1000.0000"
    assert out["nisab_value"] == "1000.0000"
    assert out["nisab_met"] is True
    assert out["zakat_due"] == "100.0000"  # ۱۰٪ synthetic
    assert out["price_stale"] is False


def test_engine_zakat_below_nisab():
    from app.modules.calculators import engine

    out = engine.compute_zakat(
        {"cash": Decimal("50")},
        Decimal("0"),
        SYNTHETIC_ZAKAT_RULE,
        SYNTHETIC_RATES,
        rule_version=1,
    )
    assert out["nisab_met"] is False
    assert out["zakat_due"] == "0.0000"


def test_engine_zakat_price_unavailable():
    from app.modules.calculators import engine

    rates = dict(SYNTHETIC_RATES, gold_per_gram=None)
    out = engine.compute_zakat(
        {"gold_grams": Decimal("10")},
        Decimal("0"),
        SYNTHETIC_ZAKAT_RULE,
        rates,
        rule_version=1,
    )
    assert out["status"] == "price_unavailable"


# --- API: گیت تأیید، نسخه‌بندی، audit ---


async def _make_user(tc, permissions: tuple[str, ...] = ()):
    import uuid as _uuid

    from app.core.security import create_access_token, hash_password
    from app.models.models import Permission, Role, RolePermission, User, UserRole

    suffix = _uuid.uuid4().hex[:8]
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
        role = Role(name=f"calc_test_role_{suffix}", description="calc test role")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست ماشین‌حساب",
            email=f"calc-{suffix}@example.com",
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
        return {"Authorization": f"Bearer {token}", "user_id": str(user.id)}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


async def _create_rule(client, headers, kind, version, madhab="hanafi",
                       rule_data=None, **kw):
    body = {
        "kind": kind,
        "madhab": madhab,
        "source": "SYNTHETIC TEST FIXTURE — not fiqh",
        "version": version,
        "effective_from": _now_iso(),
        "effective_to": None,
        "change_reason": "test",
        "rule_data": rule_data if rule_data is not None else dict(SYNTHETIC_RULE),
    }
    body.update(kw)
    r = await client.post(
        f"{BASE}/admin/calculators/rules?kind={kind}", json=body, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _submit_and_approve(client, manage_h, approve_h, kind, rule_id):
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule_id}/submit?kind={kind}",
        headers=manage_h,
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule_id}/review?kind={kind}",
        json={"decision": "approve", "note": "synthetic test approval"},
        headers=approve_h,
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_gating_unapproved_returns_rules_not_approved(tc):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    await _create_rule(client, manage_h, "inheritance", 1)  # draft می‌ماند

    r = await client.post(
        f"{BASE}/calculators/inheritance",
        json={
            "madhab": "hanafi",
            "estate_value": "1200",
            "heirs": [
                {"type": "spouse_t", "count": 1},
                {"type": "child_t", "count": 1},
            ],
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "rules_not_approved"


async def test_approve_then_calculate_and_versioning(tc):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))

    rule_v1 = await _create_rule(client, manage_h, "inheritance", 2)
    await _submit_and_approve(client, manage_h, approve_h, "inheritance",
                              rule_v1["id"])

    body = {
        "madhab": "hanafi",
        "estate_value": "1200",
        "heirs": [
            {"type": "spouse_t", "count": 1},
            {"type": "mother_t", "count": 1},
            {"type": "child_t", "count": 2},
        ],
    }
    r = await client.post(f"{BASE}/calculators/inheritance", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["result"]["applied_rule_version"] == 2
    by_type = {s["heir_type"]: s for s in data["result"]["shares"]}
    assert by_type["spouse_t"]["amount"] == "300.0000"

    # نسخهٔ ۳ تأییدشده → باید برنده شود
    rule_v2 = await _create_rule(client, manage_h, "inheritance", 3)
    await _submit_and_approve(client, manage_h, approve_h, "inheritance",
                              rule_v2["id"])
    r = await client.post(f"{BASE}/calculators/inheritance", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["result"]["applied_rule_version"] == 3

    # مذهب دیگر هنوز config تأییدشده ندارد → گیت
    r = await client.post(
        f"{BASE}/calculators/inheritance",
        json={**body, "madhab": "maliki"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "rules_not_approved"


async def test_future_effective_version_not_active(tc):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))

    rule = await _create_rule(
        client, manage_h, "inheritance", 9,
        effective_from=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    )
    await _submit_and_approve(client, manage_h, approve_h, "inheritance",
                              rule["id"])
    # v9 در آینده اثربخش است؛ v3 (تست قبلی) همچنان فعال است
    r = await client.post(
        f"{BASE}/calculators/inheritance",
        json={
            "madhab": "hanafi",
            "estate_value": "1200",
            "heirs": [{"type": "spouse_t", "count": 1},
                      {"type": "child_t", "count": 1}],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["result"]["applied_rule_version"] == 3


async def test_rule_lifecycle_audit_logged(tc):
    from app.models.models import AuditLog

    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))

    rule = await _create_rule(client, manage_h, "inheritance", 50)
    await _submit_and_approve(client, manage_h, approve_h, "inheritance",
                              rule["id"])

    async with tc["maker"]() as db:
        rows = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.entity_type == "inheritance_rule_config",
                    AuditLog.entity_id == rule["id"],
                )
            )
        ).scalars().all()
    actions = {r.action for r in rows}
    assert "calculator.rule_created" in actions
    assert "calculator.rule_submitted" in actions
    assert "calculator.rule_approved" in actions
    approved = [r for r in rows if r.action == "calculator.rule_approved"][0]
    assert approved.new_values["status"] == "approved"
    assert approved.actor_id is not None


async def test_idempotency_key_reuses_case(tc):
    client = tc["client"]
    body = {
        "madhab": "hanafi",
        "estate_value": "1200",
        "heirs": [{"type": "spouse_t", "count": 1},
                  {"type": "child_t", "count": 1}],
    }
    headers = {"Idempotency-Key": "calc-test-key-001"}
    r1 = await client.post(f"{BASE}/calculators/inheritance", json=body,
                           headers=headers)
    assert r1.status_code == 200, r1.text
    r2 = await client.post(f"{BASE}/calculators/inheritance", json=body,
                           headers=headers)
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] == r2.json()["id"]


async def test_reject_and_rbac(tc):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))
    no_perm_h = await _make_user(tc, ())

    rule = await _create_rule(client, manage_h, "inheritance", 60)
    # بدون مجوز approve → ۴۰۳
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule['id']}/submit?kind=inheritance",
        headers=no_perm_h,
    )
    assert r.status_code == 403

    # submit سپس reject
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule['id']}/submit?kind=inheritance",
        headers=manage_h,
    )
    assert r.status_code == 200
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule['id']}/review?kind=inheritance",
        json={"decision": "reject", "note": "needs work"},
        headers=approve_h,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"


# --- قیمت نصاب ---


async def _seed_price_cache(tc, *, hours_ago: float):
    from app.models.models import NisabPriceCache

    async with tc["maker"]() as db:
        row = NisabPriceCache(
            source="default",
            currency="TST",
            gold_per_gram=Decimal("10"),
            silver_per_gram=Decimal("1"),
            fetched_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        )
        db.add(row)
        await db.commit()


async def _clear_price_cache(tc):
    from sqlalchemy import delete

    from app.models.models import NisabPriceCache

    async with tc["maker"]() as db:
        await db.execute(delete(NisabPriceCache))
        await db.commit()


async def test_nisab_rate_stale_flag(tc):
    await _clear_price_cache(tc)
    await _seed_price_cache(tc, hours_ago=10)  # قدیمی‌تر از TTL ۶ ساعته
    r = await tc["client"].get(f"{BASE}/calculators/zakat/nisab-rate")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "stale"
    assert data["stale"] is True
    assert Decimal(data["gold_per_gram"]) == Decimal("10")


async def test_nisab_rate_fresh_ok(tc):
    await _clear_price_cache(tc)
    await _seed_price_cache(tc, hours_ago=1)
    r = await tc["client"].get(f"{BASE}/calculators/zakat/nisab-rate")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "ok"
    assert data["stale"] is False


async def test_nisab_rate_unavailable_graceful(tc):
    await _clear_price_cache(tc)
    r = await tc["client"].get(f"{BASE}/calculators/zakat/nisab-rate")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "price_unavailable"
    assert data["gold_per_gram"] is None


async def test_zakat_calc_end_to_end_with_stale_price(tc):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))

    rule = await _create_rule(
        client, manage_h, "zakat", 1, madhab=None,
        rule_data=dict(SYNTHETIC_ZAKAT_RULE),
        asset_categories=dict(SYNTHETIC_ZAKAT_RULE["asset_categories"]),
    )
    await _submit_and_approve(client, manage_h, approve_h, "zakat", rule["id"])

    await _clear_price_cache(tc)
    await _seed_price_cache(tc, hours_ago=10)  # stale

    r = await client.post(
        f"{BASE}/calculators/zakat",
        json={"assets": {"cash": "500", "gold_grams": "60"},
              "debts": "100", "madhab": None},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["result"]["status"] == "ok"
    assert data["result"]["zakat_due"] == "100.0000"
    assert data["result"]["price_stale"] is True
    assert "price_stale" in data["result"]["notes"]
    assert data["nisab_snapshot"]["stale"] is True
    assert Decimal(data["nisab_snapshot"]["gold_per_gram"]) == Decimal("10")


async def test_zakat_calc_price_unavailable(tc):
    client = tc["client"]
    await _clear_price_cache(tc)
    r = await client.post(
        f"{BASE}/calculators/zakat",
        json={"assets": {"gold_grams": "60"}, "debts": "0", "madhab": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["result"]["status"] == "price_unavailable"


async def test_zakat_rejects_unknown_asset_category(tc):
    client = tc["client"]
    r = await client.post(
        f"{BASE}/calculators/zakat",
        json={"assets": {"spaceship": "5"}, "debts": "0", "madhab": None},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "unknown_asset_category"


async def test_rule_history_returns_versions_desc(tc):
    """تاریخچهٔ نسخه‌ها: همهٔ نسخه‌های همان kind+madhab، مرتب نزولی."""
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    # نسخه‌های بالا برای این تست تا با state مشترک session-scoped تداخل نکند
    r1 = await _create_rule(client, manage_h, "inheritance", 90)
    r2 = await _create_rule(client, manage_h, "inheritance", 91)
    # kind دیگر نباید در تاریخچه بیاید
    await _create_rule(client, manage_h, "zakat", 90)

    r = await client.get(
        f"{BASE}/admin/calculators/rules/{r2['id']}/history?kind=inheritance",
        headers=manage_h,
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["version"] for i in items[:2]] == [91, 90]
    assert all(i["madhab"] == "hanafi" for i in items)
    assert {r1["id"], r2["id"]} <= {i["id"] for i in items}


async def test_rule_history_404_for_unknown_rule(tc):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    r = await client.get(
        f"{BASE}/admin/calculators/rules/00000000-0000-0000-0000-000000000000"
        "/history?kind=inheritance",
        headers=manage_h,
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "rule_not_found"
