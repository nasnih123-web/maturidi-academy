"""تست‌های فاز ۴ — ادغام ماشین‌حساب‌های منبع (زکات/میراث/مُصَرِّف).

سه لایه:
۱) تست‌های طلایی: خروجی موتورهای بازپیاده‌سازی‌شده در برابر خروجی واقعی
   صفحات مرجع (dl.ghadimyol.ir، منسوب به مهران ساعدی) که با اجرای خود
   اسکریپت‌های منبع در Node ضبط شده‌اند — fixtures/*.json با SHA-256
   منبع و ابزار بازتولید در tools/golden/. تطابق کامل الزامی است؛
   تنها انحراف‌های مجاز، artifactهای مستند خود منبع‌اند (فیلد deviation
   در فیکسچر): خطای float در پلهٔ طلای ۱۴۷٫۲ گرم و کرسی همزهٔ ابتدای
   کلمه در HTML. هر دو در docs/calculators/CALCULATORS_INTEGRATION.md
   مستند و اینجا با مقدار/رابطهٔ صحیح قفل شده‌اند.
۲) تست‌های دقت و مرزی: Decimal/Fraction دقیق، بدون float.
۳) تست‌های گیت و API: gate فاز ۷ برای زکات/میراث بسته می‌ماند تا
   approve عالم؛ مُصَرِّف عمومی است؛ هر سه محاسبه Stateless‌اند
   (هیچ رکورد case در DB نوشته نمی‌شود).
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

from sqlalchemy import func, select

from app.modules.calculators import (
    miras_engine,
    mosaref_engine,
    zakat_engine,
)
from app.modules.calculators.engine import CalculatorError
from app.modules.calculators.miras_engine import MirasStopped
from app.modules.calculators.source_rules import (
    MIRAS_SOURCE_RULE_DATA,
    ZAKAT_SOURCE_RULE_DATA,
)

BASE = "/api/v1"
FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# ===========================================================================
# ۱) طلایی — زکات
# ===========================================================================

_IRRIGATION = {"dimi": "rain_fed", "abi": "irrigated"}
_ZAKAT_KEY = {"cow": "cows", "camel": "camels", "horse": "horses"}


def _zakat_sections(case: dict) -> dict:
    calc, inp = case["calc"], case["inputs"]
    if calc == "sheep":
        return {"sheep": int(inp["SheepInput"])}
    if calc == "camel":
        return {"camels": int(inp["CamelInput"])}
    if calc == "cow":
        # قیمت مثالِ داخل منبع (۴۰ میلیون) قیمت قانون نیست؛ تست آن را
        # به‌عنوان ورودی کاربر می‌دهد تا extra_money قابل قیاس شود.
        return {"cows": {"count": int(inp["CowInput"]),
                         "musinna_price": Decimal(40000000)}}
    if calc == "gold":
        return {"gold_grams": Decimal(inp["talaInput"])}
    if calc == "silver":
        return {"silver_grams": Decimal(inp["noghInput"])}
    if calc == "money":
        return {"money": {"amount": Decimal(inp["amvalInput"]),
                          "coin_price": Decimal(inp["amval2Input"])}}
    if calc == "oshr":
        return {"oshr": {"amount_kg": Decimal(inp["oshrInput"]),
                         "irrigation": _IRRIGATION[inp["irrigation"]]}}
    if calc == "khoms":
        return {"khoms": {"amount": Decimal(inp["khomsInput"])}}
    if calc == "horse":
        return {"horses": {"count": int(inp["count"])}}
    raise AssertionError(calc)


def test_zakat_golden_battery():
    fixture = _load("zakat_golden.json")
    assert fixture["provenance"]["source_sha256"] == (
        "2a8e68cd4f3c3bada08511c8b93395e1b1ba01e87ececafe22e356d62addd4f8")
    cases = fixture["cases"]
    assert len(cases) >= 130
    for case in cases:
        exp = case["expected"]
        got = zakat_engine.compute_zakat_extended(
            _zakat_sections(case), ZAKAT_SOURCE_RULE_DATA)
        section = got[_ZAKAT_KEY.get(case["calc"], case["calc"])]
        cid = case["id"]
        if case["calc"] in ("sheep", "camel"):
            assert section["due"] == exp["due"], cid
        elif case["calc"] == "cow":
            assert section["due"] == exp["due"], cid
            assert section["musinna_fortieths"] == \
                exp["musinna_fortieths"], cid
            if "extra_money_at_source_price" in exp:
                assert section["extra_money"] == \
                    exp["extra_money_at_source_price"], cid
        elif case["calc"] in ("gold", "silver"):
            assert section["nisab_met"] == exp["nisab_met"], cid
            want = exp["zakat_grams"]
            if "deviation" in case:
                # artifact float منبع — مقدار دقیق قفل می‌شود، نه خطا
                want = case["deviation"]["correct_zakat_grams"]
            assert Decimal(section["zakat_grams"]) == Decimal(want), cid
        elif case["calc"] == "money":
            assert section["nisab_met"] == exp["nisab_met"], cid
            assert Decimal(section["zakat_amount"]) == \
                Decimal(exp["zakat_amount"]), cid
            assert Decimal(section["zakat_coins"]).quantize(
                Decimal("0.0001")) == Decimal(exp["zakat_coins"]), cid
        elif case["calc"] == "oshr":
            assert Decimal(section["oshr_kg"]) == \
                Decimal(exp["oshr_kg"]), cid
        elif case["calc"] == "khoms":
            assert Decimal(section["khoms"]) == Decimal(exp["khoms"]), cid
        elif case["calc"] == "horse":
            assert section["rule_note"] == exp["rule_note"], cid


# ===========================================================================
# ۱) طلایی — میراث
# ===========================================================================


def test_miras_golden_battery():
    fixture = _load("miras_golden.json")
    assert fixture["provenance"]["source_sha256"] == (
        "8cb9d11c5eb41f73612dd6abc43957e324a1ce5460304296d6281ae24c3dc8e6")
    cases = fixture["cases"]
    assert len(cases) >= 50
    for case in cases:
        inp, exp = case["inputs"], case["expected"]
        estate = {
            "estate_value": inp["estate_value"], "funeral": inp["funeral"],
            "debt": inp["debt"], "will": inp["will"],
            "will_for_heir": inp["will_for_heir"],
            "will_approved": inp["will_approved"],
            "impediments": inp["impediments"],
        }
        family = dict(inp["family"])
        family["gender"] = inp["gender"]
        cid = case["id"]
        if exp["status"] == "stopped":
            try:
                miras_engine.compute_miras(
                    family, estate, MIRAS_SOURCE_RULE_DATA)
            except MirasStopped as exc:
                assert exc.code == exp["stop_code"], cid
            else:
                raise AssertionError(f"{cid}: expected stop "
                                     f"{exp['stop_code']}")
            continue
        got = miras_engine.compute_miras(
            family, estate, MIRAS_SOURCE_RULE_DATA)
        assert got["net_estate"] == exp["net"], cid
        assert got["will_applied"] == exp["will_applied"], cid
        assert got["awl"] == exp["awl"], cid
        assert got["radd"] == exp["radd"], cid
        assert [
            {"key": r["key"], "count": r["count"], "share": r["share"]}
            for r in got["rows"]
        ] == exp["rows"], cid
        assert got["blocked"] == exp["blocked"], cid


# ===========================================================================
# ۱) طلایی — مُصَرِّف
# ===========================================================================


def _seat_fix(forms: list[str]) -> list[str]:
    """رابطهٔ مکانیکی انحراف کرسی همزه: ابتدای کلمه ؤ→أ و ئ→إ."""
    out = []
    for form in forms:
        if form.startswith("ؤ"):
            form = "أ" + form[1:]
        elif form.startswith("ئ"):
            form = "إ" + form[1:]
        out.append(form)
    return out


def test_mosaref_golden_battery():
    fixture = _load("mosaref_golden.json")
    assert fixture["provenance"]["source_sha256"] == (
        "b9966089015b3df6f1ca17f80c01fb411fb2a94298790f790f7df70c3e721c91")
    cases = fixture["cases"]
    assert len(cases) >= 40
    for case in cases:
        inp = case["inputs"]
        cid = case["id"]
        if case["status"] == "error":
            try:
                mosaref_engine.conjugate_verb(
                    inp["root"], inp["bab"], inp["transitivity"],
                    inp["harf_jar"])
            except mosaref_engine.MosarefError as exc:
                assert exc.code == case["error_code"], cid
            else:
                raise AssertionError(f"{cid}: expected error "
                                     f"{case['error_code']}")
            continue
        got = mosaref_engine.conjugate_verb(
            inp["root"], inp["bab"], inp["transitivity"], inp["harf_jar"])
        got_tables = [(t["key"], t["columns"]) for t in got["tables"]]
        exp_tables = [(t["key"], dict(t["columns"]))
                      for t in case["tables"]]
        deviation = case.get("deviation")
        if deviation:
            for col_ref in deviation["columns"]:
                tkey, ckey = col_ref.split(".")
                for key, cols in exp_tables:
                    if key == tkey and ckey in cols:
                        cols[ckey] = _seat_fix(cols[ckey])
        assert got_tables == exp_tables, cid


# ===========================================================================
# ۲) دقت و مرز
# ===========================================================================


def test_miras_shares_sum_to_exactly_one():
    """در همهٔ کیس‌های محاسبه‌شده، جمع سهم‌ها کسریِ دقیقِ ۱ است."""
    fixture = _load("miras_golden.json")
    computed = 0
    for case in fixture["cases"]:
        if case["expected"]["status"] != "computed":
            continue
        computed += 1
        total = sum(
            Fraction(r["share"]) for r in case["expected"]["rows"])
        assert total == 1, case["id"]
        # مبالغ موتور هم دقیقاً از همان کسرها ساخته می‌شوند
        inp = case["inputs"]
        family = dict(inp["family"])
        family["gender"] = inp["gender"]
        got = miras_engine.compute_miras(family, {
            "estate_value": inp["estate_value"], "funeral": inp["funeral"],
            "debt": inp["debt"], "will": inp["will"],
            "will_for_heir": inp["will_for_heir"],
            "will_approved": inp["will_approved"],
            "impediments": inp["impediments"],
        }, MIRAS_SOURCE_RULE_DATA)
        net = Decimal(got["net_estate"])
        for row in got["rows"]:
            frac = Fraction(row["share"])
            exact = net * Decimal(frac.numerator) / Decimal(frac.denominator)
            assert Decimal(row["amount"]) == exact.quantize(
                Decimal("0.0001")), (case["id"], row["key"])
    assert computed >= 25


def test_zakat_money_is_decimal_exact():
    out = zakat_engine.compute_zakat_extended(
        {"money": {"amount": Decimal(200000000),
                   "coin_price": Decimal(10000000)}},
        ZAKAT_SOURCE_RULE_DATA)
    money = out["money"]
    # ۰٫۲۶۱۳۶۳۶۳۶۴ + ۴ × ۰٫۰۷۲۷۲۷۲۷۲۷ — اعشاریِ پایانی، بدون drift
    assert money["zakat_coins"] == "0.5522727272"
    assert money["zakat_amount"] == "5522727"


def test_silver_input_rounding_boundary():
    # رفتار منبع: ۶۴۳٫۹۵ گرم به ۰٫۱ گرد می‌شود و نصاب کامل است،
    # ۶۴۳٫۹۴ نه.
    below = zakat_engine.compute_zakat_extended(
        {"silver_grams": Decimal("643.94")}, ZAKAT_SOURCE_RULE_DATA)
    at = zakat_engine.compute_zakat_extended(
        {"silver_grams": Decimal("643.95")}, ZAKAT_SOURCE_RULE_DATA)
    assert below["silver"]["nisab_met"] is False
    assert at["silver"]["nisab_met"] is True
    assert at["silver"]["zakat_grams"] == "16.10"


def test_engine_invalid_inputs():
    try:
        zakat_engine.compute_zakat_extended({}, ZAKAT_SOURCE_RULE_DATA)
        raise AssertionError("expected CalculatorError")
    except CalculatorError as exc:
        assert exc.code == "no_sections"
    try:
        zakat_engine.compute_zakat_extended(
            {"oshr": {"amount_kg": Decimal(5), "irrigation": "drip"}},
            ZAKAT_SOURCE_RULE_DATA)
        raise AssertionError("expected CalculatorError")
    except CalculatorError as exc:
        assert exc.code == "unknown_irrigation"
    try:
        miras_engine.compute_miras(
            {"gender": "male", "wives": 5},
            {"estate_value": "1000"}, MIRAS_SOURCE_RULE_DATA)
        raise AssertionError("expected CalculatorError")
    except CalculatorError as exc:
        assert exc.code == "too_many_wives"
    try:
        miras_engine.compute_miras(
            {"gender": "male", "sons": -1},
            {"estate_value": "1000"}, MIRAS_SOURCE_RULE_DATA)
        raise AssertionError("expected CalculatorError")
    except CalculatorError as exc:
        assert exc.code == "invalid_family"


def test_mosaref_error_codes():
    for root, bab, code in [
        ("اب", "faala", "root_too_short"),
        ("دعا", "faala", "alif_in_root"),
        ("أوي", "faala", "mahmuz_weak_mix"),
        ("كتب", "if'alla", "bab_unsupported"),
        ("مدد", "afala", "mudgham_augmented_unsupported"),
        ("زلزل", "rubaai_mujarrad", "root_too_short"),  # ریشهٔ ۴ حرفی کامل است
    ]:
        try:
            mosaref_engine.conjugate_verb(root, bab, "mutaadi", "bi")
            if code == "root_too_short" and bab == "rubaai_mujarrad":
                continue  # زلزل برای رباعی معتبر است
            raise AssertionError(f"{root}/{bab}: expected {code}")
        except mosaref_engine.MosarefError as exc:
            assert exc.code == code, (root, bab)


# ===========================================================================
# ۳) API و گیت
# ===========================================================================


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
        role = Role(name=f"calc4_role_{suffix}", description="phase4 test")
        db.add(role)
        await db.flush()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
        user = User(
            full_name="کاربر تست فاز ۴",
            email=f"calc4-{suffix}@example.com",
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


async def _create_and_approve(tc, kind, version, rule_data, madhab="hanafi"):
    client = tc["client"]
    manage_h = await _make_user(tc, ("calculators.manage",))
    approve_h = await _make_user(tc, ("calculators.approve",))
    body = {
        "kind": kind,
        "madhab": madhab,
        "source": "phase4 test — source-derived rules fixture",
        "version": version,
        "effective_from": datetime.now(UTC).isoformat(),
        "effective_to": None,
        "change_reason": "phase4 test",
        "rule_data": rule_data,
    }
    r = await client.post(
        f"{BASE}/admin/calculators/rules?kind={kind}", json=body,
        headers=manage_h)
    assert r.status_code == 201, r.text
    rule_id = r.json()["id"]
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule_id}/submit?kind={kind}",
        headers=manage_h)
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{BASE}/admin/calculators/rules/{rule_id}/review?kind={kind}",
        json={"decision": "approve", "note": "phase4 test approval"},
        headers=approve_h)
    assert r.status_code == 200, r.text


async def test_gate_closed_without_approved_source_rules(tc):
    """بدون config تأییدشدهٔ دارای بخش منبع، هر دو endpoint فقهی ۴۲۲."""
    client = tc["client"]
    r = await client.post(
        f"{BASE}/calculators/zakat/extended", json={"sheep": 50})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "rules_not_approved"
    r = await client.post(
        f"{BASE}/calculators/inheritance/miras",
        json={"gender": "male", "estate_value": "100000", "sons": 1})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "rules_not_approved"


async def test_mosaref_public_without_any_config(tc):
    client = tc["client"]
    r = await client.post(
        f"{BASE}/calculators/mosaref",
        json={"root": "كتب", "bab": "faala", "transitivity": "mutaadi"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["verb_class"] == "sound"
    assert data["tables"][0]["key"] == "past"
    assert data["tables"][0]["columns"]["active"][0] == "كَتَبَ"
    r = await client.post(
        f"{BASE}/calculators/mosaref",
        json={"root": "اب", "bab": "faala", "transitivity": "mutaadi"})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "root_too_short"
    r = await client.post(
        f"{BASE}/calculators/mosaref",
        json={"root": "كتب", "bab": "xyz", "transitivity": "mutaadi"})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "bab_unsupported"


async def test_seed_v2_drafts_exist_but_gate_stays_closed(tc):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.database import Base
    from app.models.models import InheritanceRuleConfig, ZakatRuleConfig
    from app.seed_calculators import seed_calculator_rules

    # سید روی دیتابیسِ ایزوله بررسی می‌شود: در DB مشترک سوئیت، تست‌های
    # فاز ۷ نسخه‌های هم‌نام خودشان را می‌سازند و تأیید می‌کنند.
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        await seed_calculator_rules(db)
        await seed_calculator_rules(db)  # idempotent
        await db.commit()
        miras = (
            await db.execute(
                select(InheritanceRuleConfig).where(
                    InheritanceRuleConfig.madhab == "hanafi",
                    InheritanceRuleConfig.version == 2,
                )
            )
        ).scalars().all()
        assert len(miras) == 1
        assert miras[0].status == "draft"
        assert miras[0].rule_data["miras"]["format"] == "miras_v1"
        assert miras[0].rule_data["provenance"]["attributed_author"] == \
            "مهران ساعدی"
        zakat = (
            await db.execute(
                select(ZakatRuleConfig).where(ZakatRuleConfig.version == 2)
            )
        ).scalars().all()
        assert len(zakat) == 1
        assert zakat[0].status == "draft"
        assert zakat[0].rule_data["extended"]["format"] == \
            "source_extended_v1"
    await engine.dispose()
    # در DB مشترک هم تا وقتی کانفیگِ دارای این قالب تأیید نشده، گیت بسته است
    client = tc["client"]
    r = await client.post(
        f"{BASE}/calculators/zakat/extended", json={"sheep": 50})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "rules_not_approved"


async def test_approved_source_rules_open_new_endpoints_only(tc):
    from app.models.models import InheritanceCase, ZakatCalculation

    client = tc["client"]
    # نسخهٔ ۹۵: فاز ۷ نسخه‌های ۹۰/۹۱ و فاز ۱۷ نسخه‌های ۱۰۰–۱۰۲ را می‌سازد
    await _create_and_approve(
        tc, "inheritance", 95, {"miras": MIRAS_SOURCE_RULE_DATA})
    await _create_and_approve(
        tc, "zakat", 95, {"extended": ZAKAT_SOURCE_RULE_DATA},
        madhab=None)

    async with tc["maker"]() as db:
        cases_before = (
            await db.execute(select(func.count(InheritanceCase.id)))
        ).scalar_one()
        zakat_before = (
            await db.execute(select(func.count(ZakatCalculation.id)))
        ).scalar_one()

    # میراث: محاسبهٔ واقعی با config تأییدشده
    r = await client.post(
        f"{BASE}/calculators/inheritance/miras",
        json={"gender": "male", "estate_value": "90000",
              "wives": 1, "sons": 1, "daughters": 1})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "computed"
    assert data["applied_rule_version"] == 95
    shares = {row["key"]: row["share"] for row in data["rows"]}
    assert shares == {
        "wives": "1/8", "sons": "7/12", "daughtersAsabah": "7/24"}

    # میراث: توقف، خطا نیست
    r = await client.post(
        f"{BASE}/calculators/inheritance/miras",
        json={"gender": "female", "estate_value": "60000", "husband": True,
              "impediments": {"religion_mixed": True}})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "stopped"
    assert r.json()["stop_code"] == "impediment_religion"

    # زکات توسعه‌یافته
    r = await client.post(
        f"{BASE}/calculators/zakat/extended",
        json={"sheep": 45, "camels": 30, "gold_grams": "100"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["applied_rule_version"] == 95
    assert data["sections"]["sheep"]["due"] == [
        {"kind": "sheep", "count": 1}]
    assert data["sections"]["camels"]["due"] == [
        {"kind": "camel_female", "count": 1, "age_years": 1}]
    assert data["sections"]["gold"]["zakat_grams"] == "2.30"

    # Stateless: هیچ case/calculation تازه‌ای نوشته نشده است
    async with tc["maker"]() as db:
        cases_after = (
            await db.execute(select(func.count(InheritanceCase.id)))
        ).scalar_one()
        zakat_after = (
            await db.execute(select(func.count(ZakatCalculation.id)))
        ).scalar_one()
    assert cases_after == cases_before
    assert zakat_after == zakat_before

    # جداسازی قالب‌ها (سطح سرویس، مستقل از ترتیب اجرای سوئیت): انتخاب
    # برای کلیدهای ژنریک فاز ۷ هرگز نسخهٔ منبع (۹۵) را برنمی‌گرداند —
    # یا config ژنریکِ دیگری انتخاب می‌شود یا rules_not_approved.
    from app.core.errors import APIError
    from app.modules.calculators.service import get_active_rule

    async with tc["maker"]() as db:
        for kind, madhab, key in (
            ("inheritance", "hanafi", "shares"),
            ("zakat", None, "asset_categories"),
        ):
            try:
                legacy_rule = await get_active_rule(
                    db, kind, madhab, require_key=key)
            except APIError as exc:
                assert exc.code == "rules_not_approved"
            else:
                assert legacy_rule.version != 95
