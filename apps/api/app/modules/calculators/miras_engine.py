"""موتور فرائض (میراث) حنفی — بازپیاده‌سازی مستقل از منطق صفحهٔ مرجع.

مبنا: السراجیة، همان‌طور که صفحهٔ مرجع (miras.html، منسوب به مهران
ساعدی) پیاده کرده است. این موتور خالص است: کسرهای فروض از rule_data
(قرارداد miras_v1 در source_rules.py) خوانده می‌شوند و همهٔ سهم‌ها با
fractions.Fraction دقیق‌اند (بدون هیچ float).

رفتار امانتیِ موتور (دقیقاً مانند منبع): خروجی هرگز ناقص نیست. هرجا
منبع از صدور نتیجه خودداری می‌کند — موانع ارث، نبودِ وارث قابل توزیع،
مجموعِ نابرابر با یک، و ترکیب‌های چندشاخهٔ ذوی‌الأرحام — این موتور هم
با MirasStopped و همان کد توقف برمی‌گردد و هیچ سهمی صادر نمی‌کند.
چند شاخهٔ ذوی‌الأرحام در منبع سهم «به‌ازای هر نفر» را به‌جای سهم گروهی
ثبت می‌کنند و فقط در حالت تک‌نفره به مجموع یک می‌رسند؛ همان رفتار
عیناً حفظ شده و با تست طلایی قفل شده است (جزئیات و دلیل در
docs/calculators/CALCULATORS_INTEGRATION.md).

ترتیب توزیع (همان ترتیب منبع):
زوج ← مادر ← جدّات ← پدر/جد (فرض) ← حجب‌های جد ← اخوه لأم ← دختران
← بنت‌الابن ← خواهران (فرض) ← عمریه ← عول ← عصبه ← رد/ذوی‌الأرحام
← حجب‌های پایانی ← أکدریه ← قفل ایمنی و کنترل مجموع.
"""
from __future__ import annotations

from decimal import Decimal
from fractions import Fraction

from .engine import CalculatorError, _frac, _money


def _f(text: str) -> Fraction:
    """خواندن کسر از rule_data با برچسب فیلد ثابت برای خطاهای engine."""
    return _frac(text, field="miras")

ZERO = Fraction(0)
ONE = Fraction(1)

# کلیدهای وراث ذوی‌الأرحام به ترتیب منبع
_DISTANT_KEYS = [
    "daughter_sons", "daughter_daughters", "son_daughter_sons",
    "son_daughter_daughters", "maternal_grandfather", "remote_grandmothers",
    "sister_sons", "sister_daughters", "full_brother_daughters",
    "paternal_brother_daughters", "uterine_brother_children",
    "uterine_sister_children", "maternal_uncles", "maternal_aunts",
    "maternal_paternal_uncles", "paternal_aunts",
    "paternal_uncle_daughters",
]

_BOOL_KEYS = ("husband", "father", "mother", "grandfather", "mgm", "pgm")
_COUNT_KEYS = [
    "wives", "sons", "daughters", "son_sons", "son_daughters",
    "brothers", "sisters", "paternal_brothers", "paternal_sisters",
    "uterine_brothers", "uterine_sisters",
    "full_brother_sons", "paternal_brother_sons",
    "full_uncles", "paternal_uncles", "full_uncle_sons",
    "paternal_uncle_sons",
] + _DISTANT_KEYS


class MirasStopped(CalculatorError):
    """توقف محاسبه با کد ماشینی (رفتار منبع: عدم صدور نتیجه)."""

    def __init__(self, code: str) -> None:
        super().__init__(code, f"محاسبهٔ فرائض متوقف شد ({code})")
        self.code = code


class _Dist:
    """انبارهٔ توزیع: سطرهای سهم + وارثان محجوب + یادداشت‌های ساختاری."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.blocked: list[str] = []
        self.notes: list[str] = []

    def add_share(self, key: str, count: int, share: Fraction) -> None:
        # رفتار منبع: سهمِ صفر یا شمارشِ صفر سطر نمی‌سازد؛ سطر هم‌کلید
        # ادغام می‌شود (پدر: فرض + عصبه) و بخش عصبهٔ پدر/جد جدا نگه
        # داشته می‌شود (در ایجاد سطر صفر است و فقط از ادغام پر می‌شود).
        if count <= 0 or share <= 0:
            return
        for row in self.rows:
            if row["key"] == key:
                row["share"] += share
                row["count"] = max(row["count"], count)
                if key in ("father", "grandfather"):
                    row["asaba_part"] += share
                return
        new_row: dict = {"key": key, "count": count, "share": share}
        if key in ("father", "grandfather"):
            new_row["asaba_part"] = ZERO
        self.rows.append(new_row)

    def block(self, key: str) -> None:
        if key not in self.blocked:
            self.blocked.append(key)

    def note(self, code: str) -> None:
        if code not in self.notes:
            self.notes.append(code)

    def total(self) -> Fraction:
        return sum((r["share"] for r in self.rows), ZERO)


def _validate_family(family: dict) -> dict:
    state: dict = {"gender": family.get("gender")}
    if state["gender"] not in ("male", "female"):
        raise CalculatorError("invalid_gender", "جنسیت متوفی نامعتبر است")
    for key in _BOOL_KEYS:
        state[key] = bool(family.get(key, False))
    for key in _COUNT_KEYS:
        value = family.get(key, 0)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise CalculatorError("invalid_family", "ورودی خانواده نامعتبر است")
        state[key] = value
    # قیدهای ساختاری منبع: همسر بر حسب جنسیت متوفی معنا دارد
    if state["gender"] == "female":
        state["wives"] = 0
    else:
        state["husband"] = False
    if state["gender"] == "male" and state["wives"] > 4:
        raise CalculatorError("too_many_wives", "تعداد همسران بیش از چهار است")
    return state


def compute_miras(family: dict, estate: dict, rule_data: dict) -> dict:
    """محاسبهٔ فرائض. خروجی یا کامل است یا MirasStopped پرتاب می‌شود."""
    if rule_data.get("format") != "miras_v1":
        raise CalculatorError(
            "unsupported_rule_format",
            "قالب rule_data میراث پشتیبانی نمی‌شود")
    cfg = rule_data["shares"]
    s = _validate_family(family)

    # ---- مراحل ترکه: کفن‌ودفن و دین، سپس وصیت، سپس خالص قابل تقسیم
    total = Decimal(str(estate["estate_value"]))
    funeral = Decimal(str(estate.get("funeral", "0")))
    debt = Decimal(str(estate.get("debt", "0")))
    will_in = Decimal(str(estate.get("will", "0")))
    net0 = total - funeral - debt
    if net0 < 0:
        net0 = Decimal(0)

    imp = estate.get("impediments") or {}
    if imp.get("religion_mixed"):
        raise MirasStopped("impediment_religion")
    if imp.get("killer"):
        raise MirasStopped("impediment_killer")
    if imp.get("simultaneous_death"):
        raise MirasStopped("impediment_simultaneous_death")
    if imp.get("slavery"):
        raise MirasStopped("impediment_slavery")

    cap = _f(rule_data["will"]["non_heir_cap"])
    cap_amount = Decimal(cap.numerator) * net0 / Decimal(cap.denominator)
    if estate.get("will_for_heir"):
        # وصیت برای وارث فقط با اجازهٔ ورثه نافذ است (مبنای منبع)
        will_applied = will_in if (estate.get("will_approved")
                                   and will_in <= net0) else Decimal(0)
    elif will_in <= cap_amount:
        will_applied = will_in
    elif estate.get("will_approved"):
        will_applied = min(will_in, net0)
    else:
        will_applied = cap_amount
    net = net0 - will_applied
    if net <= 0:
        raise MirasStopped("nothing_to_distribute")

    d = _Dist()
    desc = (s["sons"] + s["daughters"] + s["son_sons"]
            + s["son_daughters"]) > 0
    male_desc = (s["sons"] + s["son_sons"]) > 0
    female_desc = (s["daughters"] + s["son_daughters"]) > 0
    sib_count = (s["brothers"] + s["sisters"] + s["paternal_brothers"]
                 + s["paternal_sisters"] + s["uterine_brothers"]
                 + s["uterine_sisters"])
    spouse_present = (s["gender"] == "female" and s["husband"]) or (
        s["gender"] == "male" and s["wives"] > 0)
    uterine_count = s["uterine_brothers"] + s["uterine_sisters"]
    mother_cfg = cfg["mother"]
    sib_threshold = int(mother_cfg["sibling_threshold"])

    # ---- ۱) زوج
    if s["gender"] == "female" and s["husband"]:
        c = cfg["husband"]
        d.add_share("husband", 1, _f(
            c["with_descendants"] if desc else c["without_descendants"]))
    if s["gender"] == "male" and s["wives"] > 0:
        c = cfg["wives"]
        d.add_share("wives", s["wives"], _f(
            c["with_descendants"] if desc else c["without_descendants"]))

    # ---- ۲) مادر (در عمریه سهم او بعداً تنظیم می‌شود)
    umariyya = (
        not desc and s["father"] and s["mother"] and spouse_present
        and sib_count < sib_threshold
    )
    if s["mother"] and not umariyya:
        if desc or sib_count >= sib_threshold:
            d.add_share("mother", 1, _f(mother_cfg["reduced"]))
        else:
            d.add_share("mother", 1, _f(mother_cfg["full"]))

    # ---- ۳) جدّات (محجوب به مادر؛ جدّهٔ پدری همچنین به پدر)
    if s["mother"]:
        if s["mgm"]:
            d.block("mgm")
        if s["pgm"]:
            d.block("pgm")
    if s["father"] and s["pgm"]:
        d.block("pgm")
    grandmothers = 0
    if not s["mother"]:
        grandmothers = (1 if s["mgm"] else 0) + (
            1 if (s["pgm"] and not s["father"]) else 0)
    if grandmothers > 0:
        d.add_share("grandmothers", grandmothers, _f(cfg["grandmothers"]))

    # ---- ۴) فرضِ پدر / جد صحیح
    if s["father"]:
        if male_desc:
            d.add_share("father", 1, _f(cfg["father_fixed"]))
        elif s["daughters"] > 0 or s["son_daughters"] > 0:
            d.add_share("father", 1, _f(cfg["father_fixed"]))
            d.note("father_fixed_plus_asaba")
        # در عمریه و در حالت عصبهٔ محض، پدر اینجا سهم فرضی ندارد
    elif s["grandfather"]:
        if male_desc:
            d.add_share("grandfather", 1,
                        _f(cfg["grandfather_fixed"]))
        elif s["daughters"] > 0 or s["son_daughters"] > 0:
            d.add_share("grandfather", 1,
                        _f(cfg["grandfather_fixed"]))
            d.note("grandfather_fixed_plus_asaba")

    # حجب حنفی: جد صحیح (در نبود پدر) اخوه و عصبات پایین‌تر را حجب می‌کند
    if not s["father"] and s["grandfather"]:
        for key in ("brothers", "sisters", "paternal_brothers",
                    "paternal_sisters", "uterine_brothers",
                    "uterine_sisters", "full_brother_sons",
                    "paternal_brother_sons", "full_uncles",
                    "paternal_uncles", "full_uncle_sons",
                    "paternal_uncle_sons"):
            if s[key]:
                d.block(key)
        d.note("grandfather_blocks_siblings")

    # ---- ۵) اخوه لأم (محجوب به فرع و پدر و جد)
    if desc or s["father"] or s["grandfather"]:
        if s["uterine_brothers"]:
            d.block("uterine_brothers")
        if s["uterine_sisters"]:
            d.block("uterine_sisters")
    elif uterine_count == 1:
        d.add_share("uterine", 1, _f(cfg["uterine"]["single"]))
    elif uterine_count >= 2:
        d.add_share("uterine", uterine_count,
                    _f(cfg["uterine"]["multiple"]))

    # ---- ۶) دختران و بنت‌الابن (فرض)
    if s["sons"] == 0 and s["daughters"] > 0:
        c = cfg["daughters"]
        d.add_share("daughters", s["daughters"], _f(
            c["single"] if s["daughters"] == 1 else c["multiple"]))
    if s["sons"] > 0 and s["son_daughters"] > 0:
        d.block("son_daughters")
    elif s["son_sons"] == 0 and s["son_daughters"] > 0:
        c = cfg["son_daughters"]
        if s["daughters"] == 0:
            d.add_share("sonDaughters", s["son_daughters"], _f(
                c["single"] if s["son_daughters"] == 1 else c["multiple"]))
        elif s["daughters"] == 1:
            d.add_share("sonDaughters", s["son_daughters"],
                        _f(c["completion"]))
        else:
            d.block("son_daughters")

    # ---- ۷) خواهران تنی (فرض، وقتی عصبه‌مع‌الغیر نیستند)
    can_full_fixed = (
        not male_desc and not s["father"] and not s["grandfather"]
        and s["brothers"] == 0
    )
    if s["brothers"] == 0 and s["sisters"] > 0 and not female_desc \
            and can_full_fixed:
        c = cfg["full_sisters"]
        d.add_share("fullSisters", s["sisters"], _f(
            c["single"] if s["sisters"] == 1 else c["multiple"]))

    # ---- ۸) خواهران پدری (فرض/تکمیل/گروهی — دقیقاً شاخه‌های منبع)
    if s["paternal_brothers"] == 0 and s["paternal_sisters"] > 0:
        if s["brothers"] > 0 or s["sisters"] > 0 and female_desc or s["sisters"] >= 2 and not female_desc:
            d.block("paternal_sisters")
        elif female_desc:
            pass  # عصبه مع‌الغیر؛ در مرحلهٔ عصبه
        elif s["sisters"] == 1 and not male_desc and not s["father"] \
                and not s["grandfather"]:
            d.add_share("paternalSisters", s["paternal_sisters"],
                        _f(cfg["paternal_sisters"]["completion"]))
        elif not male_desc and not s["father"] and not s["grandfather"]:
            # رفتار منبع: گروه خواهران پدری دوسوم می‌برند (حتی یک نفر)
            d.add_share("paternalSisters", s["paternal_sisters"],
                        _f(cfg["paternal_sisters"]["group"]))

    # ---- ۹) عمریه: مادر ثلثِ باقی‌مانده پس از سهم زوج
    if umariyya:
        spouse_share = _f(cfg["husband"]["without_descendants"]) \
            if s["gender"] == "female" else _f(
                cfg["wives"]["without_descendants"])
        remainder = ONE - spouse_share
        frac_of_rest = _f(
            rule_data["umariyya"]["mother_fraction_of_remainder"])
        d.add_share("mother", 1, remainder * frac_of_rest)
        d.note("umariyya")

    fixed = d.total()

    # ---- ۱۰) عول یا عصبه یا رد/ذوی‌الأرحام
    awl = False
    radd_applied = False
    dhawu_used = False
    if fixed > ONE:
        factor = ONE / fixed
        for row in d.rows:
            row["share"] *= factor
        awl = True
        d.note("awl")
    else:
        residue = ONE - fixed
        asaba_key = _select_asaba(s, female_desc)
        if residue > 0 and asaba_key is not None:
            _apply_asaba(d, s, asaba_key, residue)
            residue = ZERO
        elif residue > 0:
            dhawu_used = not any(
                r["share"] > 0 and r["key"] not in ("husband", "wives")
                for r in d.rows
            )
            radd_applied = _apply_residue(
                d, s, rule_data, residue, dhawu_used, desc, spouse_present)

    # ---- قفل ایمنی منبع: ذوی‌الأرحامِ چندشاخه → عدم صدور نتیجه
    distant_present = [k for k in _DISTANT_KEYS if s[k] > 0]
    if distant_present and dhawu_used and len(distant_present) > 1:
        raise MirasStopped("dhawu_multibranch")
    if distant_present and not dhawu_used:
        for key in distant_present:
            d.block(key)

    # ---- ۱۱) حجب‌های پایانی
    if s["father"] and s["grandfather"]:
        d.block("grandfather")
    if male_desc or s["father"] or s["grandfather"]:
        for key in ("brothers", "sisters", "paternal_brothers",
                    "paternal_sisters"):
            if s[key]:
                d.block(key)
    if s["sons"] > 0:
        if s["son_sons"]:
            d.block("son_sons")
        if s["son_daughters"]:
            d.block("son_daughters")
    if s["father"] or s["grandfather"] or s["sons"] or s["son_sons"]:
        for key in ("full_brother_sons", "paternal_brother_sons",
                    "full_uncles", "paternal_uncles", "full_uncle_sons",
                    "paternal_uncle_sons"):
            if s[key]:
                d.block(key)
    if s["brothers"] and s["full_brother_sons"]:
        d.block("full_brother_sons")
    if (s["brothers"] or s["full_brother_sons"]) \
            and s["paternal_brother_sons"]:
        d.block("paternal_brother_sons")
    if s["full_uncles"] and s["paternal_uncles"]:
        d.block("paternal_uncles")
    if s["full_uncle_sons"] and s["paternal_uncle_sons"]:
        d.block("paternal_uncle_sons")
    if female_desc and s["sisters"] > 0 and not s["father"] \
            and not s["grandfather"] and not male_desc \
            and s["brothers"] == 0:
        if s["paternal_brothers"]:
            d.block("paternal_brothers")
        if s["paternal_sisters"]:
            d.block("paternal_sisters")

    # ---- ۱۲) أکدریه (مبنای ابوحنیفه: خواهر با جد شریک نمی‌شود)
    akdariyya = (
        s["gender"] == "female" and s["husband"] and s["mother"]
        and s["grandfather"] and s["sisters"] == 1
        and s["brothers"] == 0 and s["paternal_brothers"] == 0
        and s["paternal_sisters"] == 0 and not desc
        and uterine_count == 0
    )
    if akdariyya:
        d.rows = [r for r in d.rows
                  if r["key"] not in ("fullSisters", "sisters")]
        if "sisters" in d.blocked:
            d.blocked.remove("sisters")
        d.block("sisters")
        d.note("akdariyya")

    # ---- کنترل نهایی: هیچ‌وقت نتیجهٔ ناقص صادر نمی‌شود
    positive_rows = [r for r in d.rows if r["share"] > 0]
    if not positive_rows:
        raise MirasStopped("no_distributable_heir")
    if d.total() != ONE:
        raise MirasStopped("incomplete_total")

    rows_out = []
    for row in d.rows:
        share = row["share"]
        amount_dec = (
            net * Decimal(share.numerator) / Decimal(share.denominator))
        item: dict = {
            "key": row["key"],
            "count": row["count"],
            "share": f"{share.numerator}/{share.denominator}",
            "amount": _money(amount_dec),
            "per_person_amount": _money(amount_dec / row["count"]),
        }
        if row.get("asaba_part"):
            part = row["asaba_part"]
            item["asaba_part"] = f"{part.numerator}/{part.denominator}"
        rows_out.append(item)

    return {
        "status": "computed",
        "estate_value": str(total),
        "funeral": str(funeral),
        "debt": str(debt),
        "will_applied": str(will_applied),
        "net_estate": str(net),
        "awl": awl,
        "radd": radd_applied,
        "rows": rows_out,
        "blocked": d.blocked,
        "notes": d.notes,
    }


def _select_asaba(s: dict, female_desc: bool) -> str | None:
    """انتخاب عصبه به ترتیب قرب — همان زنجیرهٔ منبع."""
    if s["sons"] > 0:
        return "sons"
    if s["son_sons"] > 0:
        return "sonSons"
    if s["father"]:
        return "father"
    if s["grandfather"]:
        return "grandfather"
    if s["brothers"] > 0:
        return "brothers"
    if female_desc and s["sisters"] > 0 and not s["father"] \
            and not s["grandfather"]:
        return "sistersFemaleDesc"
    if s["paternal_brothers"] > 0:
        return "pBrothers"
    if female_desc and s["paternal_sisters"] > 0 and s["sisters"] == 0 \
            and not s["father"] and not s["grandfather"] \
            and s["brothers"] == 0:
        return "pSistersFemaleDesc"
    if s["full_brother_sons"] > 0:
        return "fullBrotherSons"
    if s["paternal_brother_sons"] > 0:
        return "paternalBrotherSons"
    if s["full_uncles"] > 0:
        return "fullUncles"
    if s["paternal_uncles"] > 0:
        return "paternalUncles"
    if s["full_uncle_sons"] > 0:
        return "fullUncleSons"
    if s["paternal_uncle_sons"] > 0:
        return "paternalUncleSons"
    return None


def _apply_asaba(d: _Dist, s: dict, key: str, residue: Fraction) -> None:
    def grouped(males_key: str, males: int, females_key: str | None,
                females: int, row_m: str, row_f: str | None) -> None:
        units = 2 * males + females
        unit = residue / units
        d.add_share(row_m, males, unit * (2 * males))
        if females and row_f:
            d.add_share(row_f, females, unit * females)

    if key == "sons":
        grouped("sons", s["sons"], "daughters", s["daughters"],
                "sons", "daughtersAsabah")
    elif key == "sonSons":
        grouped("sonSons", s["son_sons"], "son_daughters",
                s["son_daughters"], "sonSons", "sonDaughtersAsabah")
    elif key == "father":
        d.add_share("father", 1, residue)
        d.note("father_asaba")
    elif key == "grandfather":
        d.add_share("grandfather", 1, residue)
        d.note("grandfather_asaba")
    elif key == "brothers":
        grouped("brothers", s["brothers"], "sisters", s["sisters"],
                "brothers", "sistersAsabah")
    elif key == "sistersFemaleDesc":
        d.add_share("sistersFemaleDesc", s["sisters"], residue)
        d.note("sisters_with_female_descendants")
    elif key == "pBrothers":
        grouped("pBrothers", s["paternal_brothers"], "paternal_sisters",
                s["paternal_sisters"], "pBrothers", "pSistersAsabah")
    elif key == "pSistersFemaleDesc":
        d.add_share("pSistersFemaleDesc", s["paternal_sisters"], residue)
        d.note("sisters_with_female_descendants")
    else:
        counts = {
            "fullBrotherSons": s["full_brother_sons"],
            "paternalBrotherSons": s["paternal_brother_sons"],
            "fullUncles": s["full_uncles"],
            "paternalUncles": s["paternal_uncles"],
            "fullUncleSons": s["full_uncle_sons"],
            "paternalUncleSons": s["paternal_uncle_sons"],
        }
        d.add_share(key, counts[key], residue)


def _apply_residue(d: _Dist, s: dict, rule_data: dict, residue: Fraction,
                   dhawu_used: bool, desc: bool,
                   spouse_present: bool) -> bool:
    """رد یا ذوی‌الأرحام — زنجیرهٔ شاخه‌های منبع. True اگر رد اعمال شد."""

    def do_radd() -> bool:
        excluded = set(rule_data["radd"]["excluded_keys"])
        eligible = [r for r in d.rows
                    if r["key"] not in excluded and r["share"] > 0]
        total_fixed = sum((r["share"] for r in eligible), ZERO)
        if total_fixed <= 0:
            d.note("residue_unallocated")
            return False
        cfg = rule_data["shares"]
        if spouse_present:
            if s["gender"] == "female":
                c = cfg["husband"]
                spouse_fixed = _f(
                    c["with_descendants"] if desc
                    else c["without_descendants"])
            else:
                c = cfg["wives"]
                spouse_fixed = _f(
                    c["with_descendants"] if desc
                    else c["without_descendants"])
            target = ONE - spouse_fixed
        else:
            target = ONE
        factor = target / total_fixed
        for row in eligible:
            row["share"] *= factor
        d.note("radd")
        return True

    if not dhawu_used:
        return do_radd()

    # گروه‌های اصناف (همان گروه‌بندی منبع)
    pairs = [
        ("daughter_sons", "daughter_daughters",
         "dhawu_daughterSons", "dhawu_daughterDaughters"),
        ("son_daughter_sons", "son_daughter_daughters",
         "dhawu_sonDaughterSons", "dhawu_sonDaughterDaughters"),
    ]
    class1 = [p for p in pairs if s[p[0]] > 0 or s[p[1]] > 0]
    class2 = [k for k in ("maternal_grandfather", "remote_grandmothers")
              if s[k] > 0]
    class3_keys = ["sister_sons", "sister_daughters",
                   "full_brother_daughters", "paternal_brother_daughters",
                   "uterine_brother_children", "uterine_sister_children"]
    class3 = [k for k in class3_keys if s[k] > 0]
    class4 = [k for k in ("maternal_uncles", "maternal_aunts",
                          "maternal_paternal_uncles", "paternal_aunts",
                          "paternal_uncle_daughters") if s[k] > 0]

    # ترکیب مستند صنف سوم (قول منسوب به امام محمد در منبع)
    if s["full_brother_daughters"] > 0 and (
            s["sister_sons"] > 0 or s["sister_daughters"] > 0) and all(
            k in ("full_brother_daughters", "sister_sons", "sister_daughters")
            for k in class3):
        total_units = (2 * s["full_brother_daughters"]
                       + s["sister_sons"] + s["sister_daughters"])
        unit = residue / total_units
        d.add_share("dhawu_class3_fullBrotherDaughters_mix",
                    s["full_brother_daughters"], unit * 2)
        children = s["sister_sons"] + s["sister_daughters"]
        group_share = unit * children
        denom = 2 * s["sister_sons"] + s["sister_daughters"]
        if s["sister_sons"]:
            d.add_share("dhawu_class3_sisterSons_mix", s["sister_sons"],
                        group_share * Fraction(2 * s["sister_sons"], denom))
        if s["sister_daughters"]:
            d.add_share("dhawu_class3_sisterDaughters_mix",
                        s["sister_daughters"],
                        group_share * Fraction(s["sister_daughters"], denom))
        d.note("dhawu_class3_mix")
        return False

    if len(class1) == 1:
        m_key, f_key, row_m, row_f = class1[0]
        m, f = s[m_key], s[f_key]
        if m and f:
            unit = residue / (2 * m + f)
            # رفتار منبع: سهم «هر نفر» ثبت می‌شود، نه سهم گروه
            d.add_share(row_m, m, unit * 2)
            d.add_share(row_f, f, unit)
        elif m:
            d.add_share(row_m, m, residue / m)
        else:
            d.add_share(row_f, f, residue / f)
        d.note("dhawu_class1")
        return False
    if len(class1) > 1:
        d.note("dhawu_class1_multibranch")
        return False
    if len(class2) == 1:
        key = class2[0]
        row_key = {
            "maternal_grandfather": "dhawu_class2_maternalGrandfather",
            "remote_grandmothers": "dhawu_class2_remoteGrandmothers",
        }[key]
        # رفتار منبع: سهم «هر نفر» ثبت می‌شود، نه سهم گروه
        d.add_share(row_key, s[key], residue / s[key])
        d.note("dhawu_class2")
        return False
    if len(class2) > 1:
        d.note("dhawu_class2_multibranch")
        return False
    if (s["sister_sons"] > 0 or s["sister_daughters"] > 0) and all(
            k in ("sister_sons", "sister_daughters") for k in class3):
        m, f = s["sister_sons"], s["sister_daughters"]
        unit = residue / (2 * m + f)
        # رفتار منبع: سهم «هر نفر» ثبت می‌شود، نه سهم گروه
        if m:
            d.add_share("dhawu_class3_sisterSons", m, unit * 2)
        if f:
            d.add_share("dhawu_class3_sisterDaughters", f, unit)
        d.note("dhawu_class3")
        return False
    if len(class3) == 1:
        key = class3[0]
        row_key = {
            "sister_sons": "dhawu_class3_sisterSons",
            "sister_daughters": "dhawu_class3_sisterDaughters",
            "full_brother_daughters": "dhawu_class3_fullBrotherDaughters",
            "paternal_brother_daughters":
                "dhawu_class3_paternalBrotherDaughters",
            "uterine_brother_children": "dhawu_class3_uterineBrotherChildren",
            "uterine_sister_children": "dhawu_class3_uterineSisterChildren",
        }[key]
        d.add_share(row_key, s[key], residue)
        d.note("dhawu_class3")
        return False
    if len(class3) > 1:
        d.note("dhawu_class3_multibranch")
        return False
    if len(class4) == 1:
        key = class4[0]
        row_key = {
            "maternal_uncles": "dhawu_class4_maternalUncles",
            "maternal_aunts": "dhawu_class4_maternalAunts",
            "maternal_paternal_uncles":
                "dhawu_class4_maternalPaternalUncles",
            "paternal_aunts": "dhawu_class4_paternalAunts",
            "paternal_uncle_daughters":
                "dhawu_class4_paternalUncleDaughters",
        }[key]
        # رفتار منبع: سهم «هر نفر» ثبت می‌شود، نه سهم گروه
        d.add_share(row_key, s[key], residue / s[key])
        d.note("dhawu_class4")
        return False
    if len(class4) > 1:
        d.note("dhawu_class4_multibranch")
        return False
    return do_radd()
