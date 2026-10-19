"""موتور محاسبات ارث و زکات — فاز ۷.

توابع PURE: هیچ import از app، هیچ دسترسی به DB/شبکه. همهٔ اعداد و
کلیدها از rule_data می‌آیند (که فقط از config تأییدشدهٔ عالم پر می‌شود).

⚠ قانون سخت (§۱۵.۵): این فایل هیچ جدول فرائض، هیچ نصاب و هیچ نرخ زکاتی
را هاردکد نمی‌کند. قرارداد rule_data در ADR-0006 مستند است.

قرارداد rule_data برای ارث:
{
  "shares": { "<heir_type>": {"share": "1/6"} },   # سهم ثابت گروهی، رشتهٔ کسری
  "awl": {"enabled": true},                        # تنقیص تناسبی وقتی جمع > ۱
  "radd": {"enabled": true, "excluded": ["spouse"]},# بازگرداندن مازاد
  "asaba_priority": ["child", "grandchild", ...],   # ترتیب عصبه
}

قرارداد rule_data برای زکات:
{
  "zakat_rate": "0.025",
  "nisab_basis": "gold" | "silver",
  "nisab_gold_grams": "85",
  "nisab_silver_grams": "595",
  "asset_categories": {
     "<key>": {"type": "value"} | {"type": "grams", "price": "gold_per_gram"|"silver_per_gram"}
  }
}
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from fractions import Fraction
from typing import Any


class CalculatorError(ValueError):
    """خطای محاسباتی با کد ماشین‌خوان — سرویس آن را به APIError تبدیل می‌کند."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


_MONEY = Decimal("0.0001")


def _money(value: Decimal) -> str:
    return str(value.quantize(_MONEY, rounding=ROUND_HALF_UP))


def _frac(text: str, *, field: str) -> Fraction:
    try:
        return Fraction(str(text))
    except (ValueError, ZeroDivisionError) as exc:
        raise CalculatorError(
            "bad_rule_fraction",
            f"کسر نامعتبر در rule_data (فیلد {field}): {text!r}",
        ) from exc


def _dec(text: Any, *, field: str) -> Decimal:
    try:
        return Decimal(str(text))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise CalculatorError(
            "bad_rule_number", f"عدد نامعتبر در rule_data (فیلد {field}): {text!r}"
        ) from exc


# ---------------------------------------------------------------------------
# ارث
# ---------------------------------------------------------------------------


def compute_inheritance(
    heirs: list[dict],
    estate_value: Decimal | str | float,
    rule_data: dict,
    rule_version: int,
) -> dict:
    """اجرای ژنریک قواعد ارث از روی rule_data.

    heirs: [{"type": str, "count": int>=1}]
    خروجی: shares=[{heir_type,count,share_fraction,amount,per_person_amount}],
           notes, applied_rule_version, total_allocated_fraction.
    """
    estate = _dec(estate_value, field="estate_value")
    if estate <= 0:
        raise CalculatorError("bad_estate_value", "ارزش ترکه باید مثبت باشد")
    if not isinstance(rule_data, dict) or not rule_data:
        raise CalculatorError(
            "rule_data_empty",
            "rule_data خالی است — قاعده هنوز توسط عالم وارد نشده است",
        )

    shares_cfg: dict = rule_data.get("shares") or {}
    awl_enabled = bool((rule_data.get("awl") or {}).get("enabled", False))
    radd_cfg: dict = rule_data.get("radd") or {}
    radd_enabled = bool(radd_cfg.get("enabled", False))
    radd_excluded = set(radd_cfg.get("excluded") or [])
    asaba_priority: list = list(rule_data.get("asaba_priority") or [])

    # --- اعتبارسنجی وراث ---
    normalized: list[tuple[str, int]] = []
    seen_types: set[str] = set()
    for h in heirs:
        htype = (h.get("type") or "").strip()
        count = h.get("count", 1)
        if not htype or not isinstance(count, int) or count < 1:
            raise CalculatorError("bad_heir_entry", f"ورودی وارث نامعتبر: {h!r}")
        if htype not in shares_cfg and htype not in asaba_priority:
            raise CalculatorError(
                "unknown_heir",
                f"نوع وارث «{htype}» در rule_data تعریف نشده است",
            )
        if htype in seen_types:
            raise CalculatorError(
                "duplicate_heir", f"نوع وارث «{htype}» تکراری است"
            )
        seen_types.add(htype)
        normalized.append((htype, count))

    # --- سهم‌های ثابت ---
    group_fractions: dict[str, Fraction] = {}
    total_fixed = Fraction(0)
    for htype, _count in normalized:
        cfg = shares_cfg.get(htype)
        if cfg is None:
            continue
        frac = _frac(cfg.get("share"), field=f"shares.{htype}.share")
        if frac < 0 or frac > 1:
            raise CalculatorError(
                "bad_rule_fraction",
                f"سهم «{htype}» باید بین ۰ و ۱ باشد: {cfg.get('share')!r}",
            )
        group_fractions[htype] = frac
        total_fixed += frac

    notes: list[str] = []
    asaba_types = [t for t in asaba_priority if t in seen_types]
    remainder = Fraction(1) - total_fixed

    if remainder < 0:
        if not awl_enabled:
            raise CalculatorError(
                "shares_exceed_estate",
                "جمع سهم‌های ثابت از کل ترکه بیشتر است و عول در rule_data "
                "فعال نشده است",
            )
        scale = Fraction(1, 1) / total_fixed
        for htype in group_fractions:
            group_fractions[htype] *= scale
        notes.append("awl_applied")
        remainder = Fraction(0)
    elif remainder > 0:
        if asaba_types:
            # بالاترین اولویتِ حاضر، کل مازاد را می‌برد (طبق ترتیب rule_data)
            winner = asaba_types[0]
            group_fractions[winner] = group_fractions.get(winner, Fraction(0)) + remainder
            notes.append(f"asaba_applied:{winner}")
        elif radd_enabled:
            eligible = [t for t in group_fractions if t not in radd_excluded]
            if eligible:
                eligible_total = sum(group_fractions[t] for t in eligible)
                if eligible_total > 0:
                    scale = (eligible_total + remainder) / eligible_total
                    for t in eligible:
                        group_fractions[t] *= scale
                    notes.append("radd_applied")
                else:
                    notes.append("unallocated_remainder")
            else:
                notes.append("unallocated_remainder")
        else:
            notes.append("unallocated_remainder")

    # --- خروجی ---
    out_shares: list[dict] = []
    total_allocated = Fraction(0)
    for htype, count in normalized:
        frac = group_fractions.get(htype, Fraction(0))
        total_allocated += frac
        amount = estate * Decimal(frac.numerator) / Decimal(frac.denominator)
        out_shares.append(
            {
                "heir_type": htype,
                "count": count,
                "share_fraction": f"{frac.numerator}/{frac.denominator}",
                "amount": _money(amount),
                "per_person_amount": _money(amount / count),
            }
        )

    return {
        "shares": out_shares,
        "total_allocated_fraction": (
            f"{total_allocated.numerator}/{total_allocated.denominator}"
        ),
        "notes": notes,
        "applied_rule_version": rule_version,
    }


# ---------------------------------------------------------------------------
# زکات
# ---------------------------------------------------------------------------


def compute_zakat(
    assets: dict,
    debts: Decimal | str | float,
    nisab_config: dict,
    rates: dict,
    rule_version: int,
) -> dict:
    """اجرای ژنریک قواعد زکات از روی rule_data.

    nisab_config: همان rule_data زکات (نرخ/نصاب/دسته‌ها — از config عالم).
    rates: {"gold_per_gram": Decimal|None, "silver_per_gram": Decimal|None,
            "currency": str, "stale": bool, "fetched_at": str|None}
    اگر نرخ در دسترس نباشد، status=price_unavailable برمی‌گردد (نه حدس).
    """
    if not isinstance(nisab_config, dict) or not nisab_config:
        raise CalculatorError(
            "rule_data_empty",
            "rule_data خالی است — قاعده هنوز توسط عالم وارد نشده است",
        )

    debt = _dec(debts, field="debts")
    if debt < 0:
        raise CalculatorError("bad_debts", "بدهی نمی‌تواند منفی باشد")

    categories: dict = nisab_config.get("asset_categories") or {}
    if not categories:
        raise CalculatorError(
            "rule_data_empty",
            "asset_categories در rule_data تعریف نشده است",
        )

    total = Decimal("0")
    for key, raw in (assets or {}).items():
        cat = categories.get(key)
        if cat is None:
            raise CalculatorError(
                "unknown_asset_category",
                f"دستهٔ دارایی «{key}» در rule_data تعریف نشده است",
            )
        value = _dec(raw, field=f"assets.{key}")
        if value < 0:
            raise CalculatorError("bad_asset_value", f"مقدار «{key}» منفی است")
        if cat.get("type") == "grams":
            price_key = cat.get("price")
            price = rates.get(price_key)
            if price is None:
                return {
                    "status": "price_unavailable",
                    "notes": [f"missing_price:{price_key}"],
                    "applied_rule_version": rule_version,
                }
            total += value * _dec(price, field=f"rates.{price_key}")
        else:
            total += value

    notes: list[str] = []
    net = total - debt
    if net < 0:
        net = Decimal("0")
        notes.append("debts_exceed_assets")

    basis = nisab_config.get("nisab_basis", "gold")
    grams_key = "nisab_gold_grams" if basis == "gold" else "nisab_silver_grams"
    price_key = "gold_per_gram" if basis == "gold" else "silver_per_gram"
    nisab_grams = _dec(nisab_config.get(grams_key), field=grams_key)
    if nisab_grams <= 0:
        raise CalculatorError(
            "bad_rule_number", f"نصاب باید مثبت باشد ({grams_key})"
        )
    price = rates.get(price_key)
    if price is None:
        return {
            "status": "price_unavailable",
            "notes": [f"missing_price:{price_key}"],
            "applied_rule_version": rule_version,
        }
    nisab_value = nisab_grams * _dec(price, field=f"rates.{price_key}")

    rate = _dec(nisab_config.get("zakat_rate"), field="zakat_rate")
    if rate < 0 or rate > 1:
        raise CalculatorError("bad_rule_number", "نرخ زکات باید بین ۰ و ۱ باشد")

    nisab_met = net >= nisab_value
    zakat_due = (net * rate) if nisab_met else Decimal("0")
    if rates.get("stale"):
        notes.append("price_stale")

    return {
        "status": "ok",
        "total_assets": _money(total),
        "debts": _money(debt),
        "net_assets": _money(net),
        "nisab_basis": basis,
        "nisab_grams": str(nisab_grams),
        "nisab_value": _money(nisab_value),
        "nisab_met": nisab_met,
        "zakat_rate": str(rate),
        "zakat_due": _money(zakat_due),
        "currency": rates.get("currency"),
        "price_stale": bool(rates.get("stale")),
        "notes": notes,
        "applied_rule_version": rule_version,
    }
