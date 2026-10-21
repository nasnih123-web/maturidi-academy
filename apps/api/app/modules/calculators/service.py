"""سرویس فاز ۷ — ماشین‌حساب ارث و زکات.

همهٔ منطق کسب‌وکار اینجاست (§۱۵.۲)؛ روتر فقط سیم‌کشی است.

گیت تأیید (قرارداد فاز ۷): محاسبهٔ عمومی فقط با جدیدترین rule_configِ
تأییدشده انجام می‌شود: status=approved و effective_from<=now<(effective_to|∞).
در غیر این صورت APIError با کد rules_not_approved — نه حدس، نه جدول پیش‌فرض.
"""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.errors import APIError
from app.models.models import (
    InheritanceCase,
    InheritanceRuleConfig,
    User,
    ZakatCalculation,
    ZakatRuleConfig,
)

from . import engine, miras_engine, mosaref_engine, prices, zakat_engine

_VALID_MADHABS = ("hanafi", "maliki", "shafii", "hanbali")
_RULE_STATUSES = ("draft", "pending_review", "approved", "rejected")

# هر دو مدل rule-config ستون‌های مشترک _RuleConfigMixin را دارند؛ گونهٔ یونیونی
# یعنی همهٔ دسترسی‌های ستونی این سرویس روی هر دو مدل معتبر است.
RuleConfig = InheritanceRuleConfig | ZakatRuleConfig

_KIND_MODELS: dict[str, tuple[type[RuleConfig], str]] = {
    "inheritance": (InheritanceRuleConfig, "inheritance_rule_config"),
    "zakat": (ZakatRuleConfig, "zakat_rule_config"),
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _model_for(kind: str) -> tuple[type[RuleConfig], str]:
    try:
        return _KIND_MODELS[kind]
    except KeyError as exc:
        raise APIError(422, "bad_rule_kind", f"kind نامعتبر: {kind!r}") from exc


# ---------------------------------------------------------------------------
# گیت تأیید
# ---------------------------------------------------------------------------


async def get_active_rule(
    db: AsyncSession, kind: str, madhab: str | None = None,
    require_key: str | None = None,
):
    """جدیدترین config تأییدشدهٔ در پنجرهٔ اثربخشی؛ وگرنه rules_not_approved.

    با require_key، جدیدترین کانفیگی انتخاب می‌شود که آن کلید را در
    rule_data دارد — قالب‌های هم‌زیست (Phase-7 در برابر قالب‌های منبعِ
    فاز ۴) همدیگر را shadow نمی‌کنند و دروازهٔ هر قالب مستقل می‌ماند.
    """
    model, _ = _model_for(kind)
    now = _utcnow()
    stmt = (
        select(model)
        .where(model.status == "approved")
        .where(model.effective_from <= now)
        .where((model.effective_to.is_(None)) | (model.effective_to > now))
        .order_by(model.version.desc())
    )
    if kind == "inheritance":
        if madhab not in _VALID_MADHABS:
            raise APIError(422, "bad_madhab", f"مذهب نامعتبر: {madhab!r}")
        stmt = stmt.where(model.madhab == madhab)
    elif madhab is not None:
        stmt = stmt.where(model.madhab == madhab)
    else:
        stmt = stmt.where(model.madhab.is_(None))
    rule: Any = None
    for candidate in (await db.execute(stmt)).scalars().all():
        data = getattr(candidate, "rule_data", None) or {}
        if require_key is None or require_key in data:
            rule = candidate
            break
    if rule is None:
        raise APIError(
            422,
            "rules_not_approved",
            "هنوز هیچ پیکربندی تأییدشده‌ای برای این محاسبه وجود ندارد؛ "
            "قواعد باید ابتدا توسط عالم بازبینی و تأیید شوند",
            details={"kind": kind, "madhab": madhab},
        )
    return rule


# ---------------------------------------------------------------------------
# محاسبات عمومی
# ---------------------------------------------------------------------------


def _engine_error(exc: engine.CalculatorError) -> APIError:
    return APIError(422, exc.code, exc.message)


def _not_approved(kind: str, madhab: str | None) -> APIError:
    return APIError(
        422,
        "rules_not_approved",
        "هنوز هیچ پیکربندی تأییدشده‌ای برای این محاسبه وجود ندارد؛ "
        "قواعد باید ابتدا توسط عالم بازبینی و تأیید شوند",
        details={"kind": kind, "madhab": madhab},
    )


async def calculate_inheritance(
    db: AsyncSession,
    *,
    madhab: str,
    heirs: list[dict],
    estate_value: Decimal,
    user: User | None = None,
    idempotency_key: str | None = None,
    ip: str | None = None,
) -> dict[str, Any]:
    if idempotency_key:
        existing = (
            await db.execute(
                select(InheritanceCase).where(
                    InheritanceCase.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return _case_to_dict(existing)

    rule = await get_active_rule(db, "inheritance", madhab,
                                 require_key="shares")
    try:
        result = engine.compute_inheritance(
            heirs, estate_value, rule.rule_data or {}, rule.version
        )
    except engine.CalculatorError as exc:
        raise _engine_error(exc) from exc

    case = InheritanceCase(
        user_id=user.id if user else None,
        estate_value=estate_value,
        madhab=madhab,
        heirs=[{"type": h["type"], "count": h["count"]} for h in heirs],
        result=result,
        rule_config_id=rule.id,
        idempotency_key=idempotency_key,
    )
    db.add(case)
    await db.flush()
    await db.commit()
    return _case_to_dict(case)


def _case_to_dict(case: InheritanceCase) -> dict[str, Any]:
    return {
        "id": case.id,
        "madhab": case.madhab,
        "estate_value": str(case.estate_value),
        "heirs": case.heirs,
        "result": case.result,
        "rule_config_id": case.rule_config_id,
        "created_at": case.created_at,
    }


async def list_inheritance_cases(
    db: AsyncSession,
    user: User,
    *,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    stmt = (
        select(InheritanceCase)
        .where(InheritanceCase.user_id == user.id)
        .order_by(InheritanceCase.created_at.desc())
    )
    if cursor:
        stmt = stmt.where(InheritanceCase.id < UUID(cursor))
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = str(rows[-1].id) if len(rows) > limit else None
    return [_case_to_dict(r) for r in rows[:limit]], next_cursor


async def calculate_zakat(
    db: AsyncSession,
    *,
    assets: dict[str, Any],
    debts: Decimal,
    madhab: str | None = None,
    user: User | None = None,
    idempotency_key: str | None = None,
    ip: str | None = None,
) -> dict[str, Any]:
    if idempotency_key:
        existing = (
            await db.execute(
                select(ZakatCalculation).where(
                    ZakatCalculation.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return _zakat_calc_to_dict(existing)

    rule = await get_active_rule(db, "zakat", madhab,
                                 require_key="asset_categories")
    price_info = await prices.get_nisab_prices(db)

    def _rate(v: Any) -> Decimal | None:
        return Decimal(str(v)) if v is not None else None

    rates = {
        "gold_per_gram": _rate(price_info.get("gold_per_gram")),
        "silver_per_gram": _rate(price_info.get("silver_per_gram")),
        "currency": price_info.get("currency"),
        "stale": bool(price_info.get("stale")),
        "fetched_at": price_info.get("fetched_at"),
    }
    try:
        result = engine.compute_zakat(
            assets or {}, debts, rule.rule_data or {}, rates, rule.version
        )
    except engine.CalculatorError as exc:
        raise _engine_error(exc) from exc

    calc = ZakatCalculation(
        user_id=user.id if user else None,
        inputs={
            "assets": {k: str(v) for k, v in (assets or {}).items()},
            "debts": str(debts),
            "madhab": madhab,
        },
        result=result,
        nisab_snapshot=price_info,
        rule_config_id=rule.id,
        idempotency_key=idempotency_key,
    )
    db.add(calc)
    await db.flush()
    await db.commit()
    return _zakat_calc_to_dict(calc)


def _zakat_calc_to_dict(calc: ZakatCalculation) -> dict[str, Any]:
    return {
        "id": calc.id,
        "inputs": calc.inputs,
        "result": calc.result,
        "nisab_snapshot": calc.nisab_snapshot,
        "rule_config_id": calc.rule_config_id,
        "created_at": calc.created_at,
    }


async def get_nisab_rate(db: AsyncSession) -> dict[str, Any]:
    return await prices.get_nisab_prices(db)


# ---------------------------------------------------------------------------
# فاز ۴ — محاسبه‌گرهای منبع (Stateless: هیچ رکوردی در DB نوشته نمی‌شود)
# ---------------------------------------------------------------------------


async def calculate_zakat_extended(
    db: AsyncSession, *, sections: dict[str, Any]
) -> dict[str, Any]:
    """زکات توسعه‌یافته (چهارپایان/طلا/نقره/اموال/عشر/خمس) با قالب extended.

    گیت: فقط وقتی جدیدترین config تأییدشده بخش extended داشته باشد؛
    در غیر این صورت همان rules_not_approved فاز ۷.
    """
    rule = await get_active_rule(db, "zakat", require_key="extended")
    extended = (rule.rule_data or {}).get("extended")
    if not isinstance(extended, dict) or \
            extended.get("format") != "source_extended_v1":
        raise _not_approved("zakat", None)
    try:
        result = zakat_engine.compute_zakat_extended(sections, extended)
    except engine.CalculatorError as exc:
        raise _engine_error(exc) from exc
    return {"sections": result, "applied_rule_version": rule.version}


async def calculate_miras(
    db: AsyncSession, *, payload: dict[str, Any]
) -> dict[str, Any]:
    """فرائض حنفی (موتور miras) — فقط مذهب حنفی و فقط config دارای miras.

    توقف محاسبه (موانع/نبود وارث/مجموع ناقص) خطا نیست: با
    status=stopped و stop_code ماشینی برمی‌گردد تا UI همان هشدار منبع
    را نشان دهد. هیچ رکوردی ذخیره نمی‌شود.
    """
    rule = await get_active_rule(db, "inheritance", "hanafi",
                                 require_key="miras")
    miras = (rule.rule_data or {}).get("miras")
    if not isinstance(miras, dict) or miras.get("format") != "miras_v1":
        raise _not_approved("inheritance", "hanafi")
    estate_keys = (
        "estate_value", "funeral", "debt", "will", "will_for_heir",
        "will_approved", "impediments",
    )
    estate = {k: payload.get(k) for k in estate_keys}
    estate["impediments"] = payload.get("impediments") or {}
    family = {k: v for k, v in payload.items() if k not in estate_keys}
    try:
        result = miras_engine.compute_miras(family, estate, miras)
    except miras_engine.MirasStopped as exc:
        return {
            "status": "stopped",
            "stop_code": exc.code,
            "applied_rule_version": rule.version,
        }
    except engine.CalculatorError as exc:
        raise _engine_error(exc) from exc
    result["applied_rule_version"] = rule.version
    return result


def conjugate_mosaref(
    *, root: str, bab: str, transitivity: str, harf_jar: str
) -> dict[str, Any]:
    """صرف فعل عربی — زبان‌شناسی است، نه فقه؛ بدون گیت و بدون DB."""
    try:
        return mosaref_engine.conjugate_verb(
            root, bab, transitivity, harf_jar)
    except engine.CalculatorError as exc:
        raise _engine_error(exc) from exc


# ---------------------------------------------------------------------------
# ادمین: CRUD و گردش‌کار rule_configs
# ---------------------------------------------------------------------------


async def rule_list(
    db: AsyncSession,
    *,
    kind: str | None = None,
    madhab: str | None = None,
    status: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    kinds = [kind] if kind else ["inheritance", "zakat"]
    merged: list[dict[str, Any]] = []
    for k in kinds:
        model, _ = _model_for(k)
        stmt = select(model).order_by(model.created_at.desc())
        if madhab is not None:
            stmt = stmt.where(model.madhab == madhab)
        if status is not None:
            if status not in _RULE_STATUSES:
                raise APIError(422, "bad_rule_status", f"وضعیت نامعتبر: {status!r}")
            stmt = stmt.where(model.status == status)
        rows = (await db.execute(stmt)).scalars().all()
        merged.extend(_rule_to_dict(k, r) for r in rows)
    merged.sort(key=lambda d: d["created_at"], reverse=True)
    if cursor:
        merged = [d for d in merged if str(d["id"]) < cursor]
    page = merged[:limit]
    next_cursor = str(page[-1]["id"]) if len(merged) > limit else None
    return page, next_cursor


def _rule_to_dict(kind: str, rule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "kind": kind,
        "madhab": rule.madhab,
        "source": rule.source,
        "version": rule.version,
        "status": rule.status,
        "effective_from": rule.effective_from,
        "effective_to": rule.effective_to,
        "approved_by": rule.approved_by,
        "approved_at": rule.approved_at,
        "change_reason": rule.change_reason,
        "rule_data": rule.rule_data or {},
        "asset_categories": getattr(rule, "asset_categories", None) or {},
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


async def _rule_get_or_404(db: AsyncSession, kind: str, rule_id: UUID):
    model, _ = _model_for(kind)
    rule = await db.get(model, rule_id)
    if rule is None:
        raise APIError(404, "rule_not_found", "پیکربندی قاعده یافت نشد")
    return rule


_CALC_ENTITY_TYPES = ("inheritance_rule_config", "zakat_rule_config")


async def calculator_audit_list(
    db: AsyncSession, *, limit: int = 50, cursor: str | None = None
) -> tuple[list, str | None]:
    """حسابرسی تغییرات قواعد ماشین‌حساب‌ها (§۱۴) — صفحه‌بندی cursor-based."""
    from app.models.models import AuditLog

    stmt = (
        select(AuditLog)
        .where(AuditLog.entity_type.in_(_CALC_ENTITY_TYPES))
        .order_by(AuditLog.created_at.desc())
    )
    if cursor:
        stmt = stmt.where(AuditLog.id < UUID(cursor))
    rows = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    next_cursor = str(rows[-1].id) if len(rows) > limit else None
    return list(rows[:limit]), next_cursor


async def rule_history(
    db: AsyncSession, kind: str, rule_id: UUID
) -> list[dict[str, Any]]:
    """تاریخچهٔ نسخه‌های یک قاعده — همهٔ نسخه‌های همان (kind, madhab)، نزولی."""
    rule = await _rule_get_or_404(db, kind, rule_id)
    model, _ = _model_for(kind)
    stmt = (
        select(model)
        .where(model.madhab == rule.madhab)
        .order_by(model.version.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_rule_to_dict(kind, r) for r in rows]


async def rule_create(
    db: AsyncSession,
    user: User,
    *,
    kind: str,
    madhab: str | None,
    source: str,
    version: int,
    effective_from: datetime,
    effective_to: datetime | None,
    change_reason: str | None,
    rule_data: dict,
    asset_categories: dict | None = None,
    ip: str | None = None,
):
    model, entity_type = _model_for(kind)
    if kind == "inheritance":
        if madhab not in _VALID_MADHABS:
            raise APIError(422, "bad_madhab", f"مذهب نامعتبر: {madhab!r}")
    elif madhab is not None and madhab not in _VALID_MADHABS:
        raise APIError(422, "bad_madhab", f"مذهب نامعتبر: {madhab!r}")
    if not isinstance(rule_data, dict):
        raise APIError(422, "bad_rule_data", "rule_data باید آبجکت باشد")
    kwargs: dict[str, Any] = {
        "madhab": madhab,
        "source": source,
        "version": version,
        "effective_from": effective_from,
        "effective_to": effective_to,
        "change_reason": change_reason,
        "rule_data": rule_data,
        "status": "draft",
    }
    if kind == "zakat":
        kwargs["asset_categories"] = asset_categories or {}
    rule = model(**kwargs)
    db.add(rule)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise APIError(
            409, "rule_version_exists",
            "برای این مذهب نسخه‌ای با همین شماره از قبل وجود دارد",
        ) from exc
    await log_audit(
        db, actor_id=user.id, actor_type="user", action="calculator.rule_created",
        entity_type=entity_type, entity_id=str(rule.id),
        new_values={"kind": kind, "madhab": madhab, "version": version,
                    "status": "draft", "source": source},
        ip=ip,
    )
    await db.commit()
    return _rule_to_dict(kind, rule)


async def rule_update(
    db: AsyncSession,
    user: User,
    kind: str,
    rule_id: UUID,
    patch: dict[str, Any],
    ip: str | None = None,
):
    model, entity_type = _model_for(kind)
    rule = await _rule_get_or_404(db, kind, rule_id)
    if rule.status not in ("draft", "rejected"):
        raise APIError(
            422, "rule_locked",
            "فقط پیکربندی‌های draft/rejected قابل ویرایش‌اند؛ برای تغییر "
            "نسخهٔ تأییدشده، نسخهٔ جدید بسازید",
        )
    old = {"status": rule.status, "version": rule.version,
           "source": rule.source}
    allowed: tuple[str, ...] = ("source", "effective_from", "effective_to",
                                 "change_reason", "rule_data")
    if kind == "zakat":
        allowed = allowed + ("asset_categories",)
    changed: dict[str, Any] = {}
    for field in allowed:
        if field in patch and patch[field] is not None:
            setattr(rule, field, patch[field])
            changed[field] = True
    if rule.status == "rejected":
        rule.status = "draft"
        changed["status"] = "draft"
    rule.updated_at = _utcnow()
    await log_audit(
        db, actor_id=user.id, actor_type="user", action="calculator.rule_updated",
        entity_type=entity_type, entity_id=str(rule.id),
        old_values=old, new_values={"changed_fields": sorted(changed)},
        ip=ip,
    )
    await db.commit()
    return _rule_to_dict(kind, rule)


async def rule_submit(
    db: AsyncSession, user: User, kind: str, rule_id: UUID, ip: str | None = None
):
    _, entity_type = _model_for(kind)
    rule = await _rule_get_or_404(db, kind, rule_id)
    if rule.status != "draft":
        raise APIError(
            422, "bad_rule_transition",
            f"فقط draft قابل ارسال برای بازبینی است (وضعیت فعلی: {rule.status})",
        )
    rule.status = "pending_review"
    rule.updated_at = _utcnow()
    await log_audit(
        db, actor_id=user.id, actor_type="user",
        action="calculator.rule_submitted",
        entity_type=entity_type, entity_id=str(rule.id),
        old_values={"status": "draft"}, new_values={"status": "pending_review"},
        ip=ip,
    )
    await db.commit()
    return _rule_to_dict(kind, rule)


async def rule_review(
    db: AsyncSession,
    user: User,
    kind: str,
    rule_id: UUID,
    decision: str,
    note: str | None = None,
    ip: str | None = None,
):
    _, entity_type = _model_for(kind)
    rule = await _rule_get_or_404(db, kind, rule_id)
    if rule.status != "pending_review":
        raise APIError(
            422, "bad_rule_transition",
            f"فقط pending_review قابل بازبینی است (وضعیت فعلی: {rule.status})",
        )
    if decision == "approve":
        rule.status = "approved"
        rule.approved_by = user.id
        rule.approved_at = _utcnow()
        action = "calculator.rule_approved"
    elif decision == "reject":
        rule.status = "rejected"
        action = "calculator.rule_rejected"
    else:
        raise APIError(422, "bad_review_decision", "decision باید approve یا reject باشد")
    if note:
        rule.change_reason = note
    rule.updated_at = _utcnow()
    await log_audit(
        db, actor_id=user.id, actor_type="user", action=action,
        entity_type=entity_type, entity_id=str(rule.id),
        old_values={"status": "pending_review"},
        new_values={"status": rule.status,
                    "approved_by": str(rule.approved_by) if rule.approved_by else None,
                    "note": bool(note)},
        ip=ip,
    )
    await db.commit()
    return _rule_to_dict(kind, rule)
