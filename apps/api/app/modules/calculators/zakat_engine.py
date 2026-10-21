"""موتور زکاتِ توسعه‌یافته — بازپیاده‌سازی مستقل از قواعد صفحهٔ مرجع.

این موتور «خالص» است: بدون I/O و بدون DB. همهٔ اعداد از rule_data
(قرارداد source_extended_v1 در source_rules.py) خوانده می‌شوند؛ اگر
rule_data تأییدشده در دست نباشد، سرویس اصلاً این موتور را صدا نمی‌زند.

قرارداد محاسبه (دقیقاً همان مدل صفحهٔ مرجع — توضیح در
docs/calculators/CALCULATORS_INTEGRATION.md):
- طلا/نقره/اموال: پلکانی؛ زکاتِ پایه در نصاب + افزایش ثابت به‌ازای هر
  پلهٔ کاملِ مازاد (یک‌پنجم نصاب)؛ کسرِ پله نادیده گرفته می‌شود.
- نقره: ورودی ابتدا به نزدیک‌ترین ۰٫۱ گرم گرد می‌شود (رفتار منبع).
- چهارپایان: جدول‌های نصاب منبع (شتر با قاعدهٔ بالای ۱۵۰، گاو با
  ترکیب ۳۰/۴۰ و کسرِ چهلمِ مسنّه برای بازهٔ ۴۰–۵۹).
- اسب: منبع فقط قاعده را اعلام می‌کند؛ اینجا هم فقط قاعده برمی‌گردد
  (همراه یک‌چهلم ارزش، اگر ارزش داده شده باشد).
- عشر: بدون بررسی نصاب در منبع؛ نرخ برحسب آبیاری. خمس: نرخ ثابت.

همهٔ محاسبات پولی/وزنی با Decimal — هرگز float.
زکاتِ حیوان «تعداد/نوع» است و هرگز به پول تبدیل نمی‌شود؛ تنها استثنا
کسرِ چهلمِ مسنّهٔ گاو است که منبع آن را پولی می‌داند و قیمت مسنّه را
ورودیِ اختیاریِ کاربر می‌گیرد (قیمتِ مثالِ داخل منبع هرگز قانون نیست).
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from .engine import CalculatorError

_Q_GRAMS = Decimal("0.01")
_Q_MONEY = Decimal(1)


def _dec(value: str | int) -> Decimal:
    return Decimal(str(value))


def _plain(value: Decimal) -> str:
    """نمایش اعشاریِ ساده بدون صفرهای انتهایی و بدون نماد علمی."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _staircase(amount: Decimal, nisab: Decimal, at_nisab: Decimal,
               step: Decimal, step_zakat: Decimal) -> tuple[bool, Decimal]:
    """مدل پلکانی منبع: (به نصاب رسیده؟، مقدار زکات خام)."""
    if amount < nisab:
        return False, Decimal(0)
    steps = (amount - nisab) // step  # Decimal floor-division — دقیق
    return True, at_nisab + Decimal(int(steps)) * step_zakat


def _money_section(cfg: dict, amount: Decimal, coin_price: Decimal) -> dict:
    nisab = _dec(cfg["nisab_coins"])
    total_coins = amount / coin_price
    met, coins = _staircase(
        total_coins, nisab, _dec(cfg["zakat_at_nisab_coins"]),
        _dec(cfg["step_coins"]), _dec(cfg["step_zakat_coins"]),
    )
    due_amount = (coins * coin_price).quantize(_Q_MONEY, rounding=ROUND_HALF_UP)
    return {
        "nisab_met": met,
        "total_coins": str(total_coins),
        "zakat_coins": str(coins),
        "zakat_amount": str(due_amount),
    }


def _metal_section(cfg: dict, grams: Decimal) -> dict:
    met, zakat = _staircase(
        grams, _dec(cfg["nisab_grams"]), _dec(cfg["zakat_at_nisab_grams"]),
        _dec(cfg["step_grams"]), _dec(cfg["step_zakat_grams"]),
    )
    return {
        "nisab_met": met,
        "zakat_grams": str(zakat.quantize(_Q_GRAMS, rounding=ROUND_HALF_UP)),
    }


def _round_input(grams: Decimal, round_to: str) -> Decimal:
    unit = _dec(round_to)
    return (grams / unit).quantize(Decimal(1), rounding=ROUND_HALF_UP) * unit


def _sheep_due(cfg: dict, count: int) -> list[dict]:
    if count < int(cfg["nisab"]):
        return []
    per_hundred = cfg["per_hundred"]
    if count >= int(per_hundred["from"]):
        return [{"kind": "sheep", "count": count // int(per_hundred["divisor"])}]
    for upper, due in cfg["table"]:
        if count <= int(upper):
            return [{"kind": "sheep", "count": int(due)}]
    return []


def _merge_due(items: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for item in items:
        for existing in merged:
            if (
                existing["kind"] == item["kind"]
                and existing.get("age_years") == item.get("age_years")
            ):
                existing["count"] += item["count"]
                break
        else:
            merged.append(dict(item))
    return merged


def _table_due(entries: list) -> list[dict]:
    due: list[dict] = []
    for kind, age, count in entries:
        item: dict = {"kind": kind, "count": int(count)}
        if age is not None:
            item["age_years"] = int(age)
        due.append(item)
    return due


def _camel_due(cfg: dict, count: int) -> list[dict]:
    over = cfg["over"]
    if count > int(over["threshold"]):
        base_per = int(over["base_per"])
        kind, age, _ = over["base_due"]
        base_count = count // base_per
        due = [{"kind": kind, "count": base_count, "age_years": int(age)}]
        remainder = count - base_count * base_per
        for upper, entries in over["remainder_table"]:
            if remainder <= int(upper):
                due.extend(_table_due(entries))
                break
        return _merge_due(due)
    for upper, entries in cfg["table"]:
        if count <= int(upper):
            return _table_due(entries)
    return []


def _cow_result(cfg: dict, count: int, musinna_price: Decimal | None) -> dict:
    tabii_from = int(cfg["tabii_from"])
    musinna_from = int(cfg["musinna_from"])
    double_from = int(cfg["double_tabii_from"])
    combo_from = int(cfg["combo_from"])
    due: list[dict] = []
    fortieths = 0
    if count < tabii_from:
        pass
    elif count < musinna_from:
        due = [{"kind": "cow_tabii", "count": 1}]
    elif count < double_from:
        due = [{"kind": "cow_musinna", "count": 1}]
        # هر رأسِ مازاد بر آستانه = یک چهلمِ ارزشِ یک مسنّه (قاعدهٔ منبع)
        fortieths = count - musinna_from
    elif count < combo_from:
        due = [{"kind": "cow_tabii", "count": 2}]
    else:
        # ترکیب a×واحد۱ + b×واحد۲ روی عددِ گرد‌شده؛ کمینه‌کردن |a-b|
        # با پیمایش b صعودی و بهبودِ اکید (تساوی → نخستین برنده می‌ماند)
        unit_small, unit_big = (int(u) for u in cfg["combo_units"])
        rounded = (count // int(cfg["combo_round_to"])) * int(cfg["combo_round_to"])
        best: tuple[int, int, int] | None = None  # (diff, a, b)
        b = 0
        while b * unit_big <= rounded:
            rest = rounded - b * unit_big
            if rest % unit_small == 0:
                a = rest // unit_small
                diff = abs(a - b)
                if best is None or diff < best[0]:
                    best = (diff, a, b)
            b += 1
        if best is not None:
            _, a, b = best
            if a:
                due.append({"kind": "cow_tabii", "count": a})
            if b:
                due.append({"kind": "cow_musinna", "count": b})
    out: dict = {"due": due, "musinna_fortieths": fortieths}
    if fortieths and musinna_price is not None:
        extra = (Decimal(fortieths) * musinna_price
                 / Decimal(int(cfg["musinna_share_denominator"])))
        out["extra_money"] = str(extra.quantize(_Q_MONEY, rounding=ROUND_HALF_UP))
    return out


def _horse_result(cfg: dict, count: int,
                  total_value: Decimal | None) -> dict:
    # منبع قاعده را اعلام می‌کند و محاسبهٔ عددی ندارد؛ هر دو صورت قاعده
    # برگردانده می‌شود تا UI همان انتخاب کلاسیک را نمایش دهد.
    rate_num, rate_den = (int(p) for p in str(cfg["value_rate"]).split("/"))
    out: dict = {
        "rule_note": "dinar_or_fortieth_per_horse",
        "dinar_per_head": int(cfg["per_head_dinar"]),
        "total_dinar": int(cfg["per_head_dinar"]) * count,
    }
    if total_value is not None:
        value_due = total_value * Decimal(rate_num) / Decimal(rate_den)
        out["value_zakat"] = str(
            value_due.quantize(_Q_MONEY, rounding=ROUND_HALF_UP))
    return out


def compute_zakat_extended(sections: dict, rule_data: dict) -> dict:
    """اجرای همهٔ بخش‌های درخواستی زکات با rule_data تأییدشده.

    sections (ورودی اعتبارسنجی‌شدهٔ سرویس):
      money: {"amount": Decimal, "coin_price": Decimal}
      gold_grams / silver_grams: Decimal
      sheep / cows / camels: int — cows: {"count": int, "musinna_price": Decimal?}
      horses: {"count": int, "total_value": Decimal?}
      oshr: {"amount_kg": Decimal, "irrigation": "rain_fed"|"irrigated"}
      khoms: {"amount": Decimal}
    """
    if rule_data.get("format") != "source_extended_v1":
        raise CalculatorError(
            "unsupported_rule_format",
            "قالب rule_data زکات پشتیبانی نمی‌شود")
    out: dict = {}
    if "money" in sections:
        sec = sections["money"]
        out["money"] = _money_section(
            rule_data["money"], sec["amount"], sec["coin_price"])
    if "gold_grams" in sections:
        out["gold"] = _metal_section(rule_data["gold"], sections["gold_grams"])
    if "silver_grams" in sections:
        cfg = rule_data["silver"]
        grams = sections["silver_grams"]
        if "input_round_grams" in cfg:
            grams = _round_input(grams, cfg["input_round_grams"])
        out["silver"] = _metal_section(cfg, grams)
    if "sheep" in sections:
        out["sheep"] = {"due": _sheep_due(rule_data["sheep"], sections["sheep"])}
    if "cows" in sections:
        sec = sections["cows"]
        out["cows"] = _cow_result(
            rule_data["cow"], sec["count"], sec.get("musinna_price"))
    if "camels" in sections:
        out["camels"] = {"due": _camel_due(rule_data["camel"], sections["camels"])}
    if "horses" in sections:
        sec = sections["horses"]
        out["horses"] = _horse_result(
            rule_data["horse"], sec["count"], sec.get("total_value"))
    if "oshr" in sections:
        sec = sections["oshr"]
        rates = rule_data["oshr"]["rates"]
        if sec["irrigation"] not in rates:
            raise CalculatorError(
            "unknown_irrigation", "نوع آبیاری نامعتبر است")
        num, den = (int(p) for p in str(rates[sec["irrigation"]]).split("/"))
        kg = sec["amount_kg"] * Decimal(num) / Decimal(den)
        out["oshr"] = {"oshr_kg": _plain(kg)}
    if "khoms" in sections:
        amount = sections["khoms"]["amount"] * _dec(rule_data["khoms"]["rate"])
        out["khoms"] = {"khoms": _plain(amount)}
    if not out:
        raise CalculatorError(
            "no_sections", "هیچ بخشی برای محاسبه ارسال نشده است")
    return out
