"""دادهٔ قواعد استخراج‌شده از ماشین‌حساب‌های مرجع — فاز ۴ (ادغام منابع).

منبع: سه صفحهٔ تک‌فایل از dl.ghadimyol.ir (واکشی 2026-10-21 از مسیر
HTTP؛ HTTPS پاسخ نداد)، منسوب به مهران ساعدی:
- zakat.html  — SHA-256 2a8e68cd4f3c3bada08511c8b93395e1b1ba01e87ececafe22e356d62addd4f8
- miras.html  — SHA-256 8cb9d11c5eb41f73612dd6abc43957e324a1ce5460304296d6281ae24c3dc8e6

⚠ وضعیت حقوقی: در هیچ‌یک از صفحات متن لایسنس صریحی وجود ندارد؛ بنابراین
هیچ کدی و هیچ متن توضیحی از منبع کپی نشده است — فقط «قواعد/اعداد» آن‌ها
(دادهٔ فقهی کلاسیک + پارامترهای انتخابی مؤلف) به‌صورت داده در این فایل
بازثبت و منطقشان با کد اصیل بازپیاده‌سازی شده است.
جزئیات: docs/calculators/CALCULATORS_INTEGRATION.md

⚠ وضعیت فقهی (§۱۵.۵): این داده‌ها DRAFT هستند و فقط از مسیر seed به‌صورت
rule_config نسخهٔ جدید با status=draft وارد DB می‌شوند. محاسبهٔ عمومی
همچنان فقط با config تأییدشدهٔ عالم ممکن است (گیت rules_not_approved).
این اعداد «فتوا» نیستند و تا بازبینی عالم نباید مبنای پاسخ عمومی شوند.

این فایل فقط داده است؛ هیچ منطق محاسباتی ندارد. موتورها
(zakat_engine.py / miras_engine.py) همهٔ اعداد را از همین ساختارها
می‌خوانند — همان قرارداد engine-vs-data در ADR-0006.
"""
from __future__ import annotations

SOURCE_ATTRIBUTION = (
    "بازثبت قواعد از صفحهٔ مرجع dl.ghadimyol.ir (منسوب به مهران ساعدی) — "
    "بدون لایسنس صریح در منبع؛ بازپیاده‌سازی مستقل، در انتظار بازبینی عالم"
)

# ---------------------------------------------------------------------------
# زکات — قرارداد rule_data["extended"] برای zakat_engine
#
# مدل محاسبهٔ منبع برای طلا/نقره/اموال «پلکانی» است، نه درصد ساده:
# تا نصاب چیزی نیست؛ در نصاب، زکاتِ پایه؛ و به‌ازای هر «پلهٔ» کاملِ
# مازاد (یک‌پنجم نصاب) مقدار ثابتی اضافه می‌شود؛ کسرِ پله شمرده نمی‌شود.
# ---------------------------------------------------------------------------

ZAKAT_SOURCE_RULE_DATA: dict = {
    "format": "source_extended_v1",
    # اموال تجاری/نقد: مقدار به «سکه» تبدیل می‌شود (قیمت سکه ورودی کاربر).
    "money": {
        "nisab_coins": "10.4545454545",
        "zakat_at_nisab_coins": "0.2613636364",
        "step_coins": "2.0909090909",
        "step_zakat_coins": "0.0727272727",
    },
    # طلا (گرم)
    "gold": {
        "nisab_grams": "92",
        "zakat_at_nisab_grams": "2.3",
        "step_grams": "18.4",
        "step_zakat_grams": "0.46",
    },
    # نقره (گرم) — ورودی منبع ابتدا به نزدیک‌ترین ۰٫۱ گرم گرد می‌شود.
    "silver": {
        "nisab_grams": "644",
        "zakat_at_nisab_grams": "16.1",
        "step_grams": "128.8",
        "step_zakat_grams": "3.22",
        "input_round_grams": "0.1",
    },
    # گوسفند: نصاب + جدول [سقفِ شامل، تعداد] + قاعدهٔ مازادِ صدتایی
    "sheep": {
        "nisab": 40,
        "table": [[120, 1], [200, 2], [399, 3]],
        "per_hundred": {"from": 400, "divisor": 100},
    },
    # شتر: جدول [سقفِ شامل، [[نوع, سن, تعداد]]] + قاعدهٔ بالای ۱۵۰
    # نوع‌ها: sheep | camel_female (سن به سال)
    "camel": {
        "table": [
            [4, []],
            [9, [["sheep", None, 1]]],
            [14, [["sheep", None, 2]]],
            [19, [["sheep", None, 3]]],
            [24, [["sheep", None, 4]]],
            [35, [["camel_female", 1, 1]]],
            [45, [["camel_female", 2, 1]]],
            [60, [["camel_female", 3, 1]]],
            [75, [["camel_female", 4, 1]]],
            [90, [["camel_female", 2, 2]]],
            [124, [["camel_female", 3, 2]]],
            [149, [["camel_female", 3, 2], ["camel_female", 1, 1]]],
            [150, [["camel_female", 3, 3]]],
        ],
        # بالای ۱۵۰: به‌ازای هر ۵۰ شتر یک مادهٔ سه‌ساله + باقی‌مانده طبق
        # جدول باقی‌مانده (همان پله‌های زیر ۵۰، با سقف ۴۹ برای آخرین بازه)
        "over": {
            "threshold": 150,
            "base_per": 50,
            "base_due": ["camel_female", 3, 1],
            "remainder_table": [
                [4, []],
                [9, [["sheep", None, 1]]],
                [14, [["sheep", None, 2]]],
                [19, [["sheep", None, 3]]],
                [24, [["sheep", None, 4]]],
                [35, [["camel_female", 1, 1]]],
                [45, [["camel_female", 2, 1]]],
                [49, [["camel_female", 3, 1]]],
            ],
        },
    },
    # گاو: آستانه‌ها + الگوریتم ترکیب ۳۰/۴۰ برای ۷۰ به بالا
    "cow": {
        "tabii_from": 30,       # ۳۰–۳۹: یک تبیع (یک‌ساله)
        "musinna_from": 40,     # ۴۰–۵۹: یک مسنّه (دوساله) + کسرِ چهلم‌ها
        "double_tabii_from": 60,  # ۶۰–۶۹: دو تبیع
        "combo_from": 70,       # ۷۰+: ترکیب a×۳۰ + b×۴۰ روی عددِ گرد به ده
        "combo_round_to": 10,
        "combo_units": [30, 40],
        "musinna_share_denominator": 40,  # هر رأس مازاد بر ۴۰ = ۱/۴۰ مسنّه
    },
    # اسب: منبع فقط قاعده را اعلام می‌کند (به‌ازای هر اسب یک دینار
    # یا یک‌چهلم ارزش) — محاسبهٔ عددیِ ورودی‌محور در منبع وجود ندارد.
    "horse": {"per_head_dinar": 1, "value_rate": "1/40"},
    # عشر: بدون نصاب در منبع؛ نرخ بر حسب آبیاری
    "oshr": {"rates": {"rain_fed": "1/10", "irrigated": "1/20"}},
    # خمس: نرخ ثابت روی مبلغ ورودی
    "khoms": {"rate": "0.2"},
}

# ---------------------------------------------------------------------------
# میراث — قرارداد rule_data["miras"] برای miras_engine
#
# کسرهای فروض و ترتیب عصبات داده‌اند؛ «رویهٔ» توزیع (ترتیب اعمال،
# حجب‌های ساختاری، عول/رد، عمریه، أکدریه و اصناف ذوی‌الأرحام) در کد
# موتور است و در docs/calculators/CALCULATORS_INTEGRATION.md مستند شده.
# مبنا: السراجیة در فقه حنفی — همان‌طور که صفحهٔ مرجع پیاده کرده است.
# ---------------------------------------------------------------------------

MIRAS_SOURCE_RULE_DATA: dict = {
    "format": "miras_v1",
    "shares": {
        "husband": {"with_descendants": "1/4", "without_descendants": "1/2"},
        "wives": {"with_descendants": "1/8", "without_descendants": "1/4"},
        "mother": {"reduced": "1/6", "full": "1/3", "sibling_threshold": 2},
        "grandmothers": "1/6",
        "father_fixed": "1/6",
        "grandfather_fixed": "1/6",
        "uterine": {"single": "1/6", "multiple": "1/3"},
        "daughters": {"single": "1/2", "multiple": "2/3"},
        "son_daughters": {
            "single": "1/2",
            "multiple": "2/3",
            "completion": "1/6",  # با یک دختر صلبی، تکمیلِ دوسوم
        },
        "full_sisters": {"single": "1/2", "multiple": "2/3"},
        "paternal_sisters": {
            "completion": "1/6",  # با یک خواهر تنی، تکمیلِ دوسوم
            # رفتار منبع: در نبود خواهر تنی و وارثِ مقدم، گروه خواهران
            # پدری (با هر تعداد) دوسوم می‌برند — حتی یک نفر.
            # (انحراف از قاعدهٔ مشهور ۱/۲ برای تک‌خواهر؛ مستند در
            # CALCULATORS_INTEGRATION.md و با تست طلایی قفل شده است.)
            "group": "2/3",
        },
    },
    # عمریه: مادر ثلثِ باقی‌مانده پس از سهم زوج را می‌برد
    "umariyya": {"mother_fraction_of_remainder": "1/3"},
    # رد: زوجین از رد محروم‌اند (مبنای منبع و السراجیة)
    "radd": {"excluded_keys": ["husband", "wives"]},
    # ترتیب عصبه بالنفس/بالغیر/مع‌الغیر در منبع (کلیدهای موتور)
    "asaba_priority": [
        "sons", "sonSons", "father", "grandfather", "brothers",
        "sistersFemaleDesc", "pBrothers", "pSistersFemaleDesc",
        "fullBrotherSons", "paternalBrotherSons", "fullUncles",
        "paternalUncles", "fullUncleSons", "paternalUncleSons",
    ],
    # وصیت: سقف نافذ برای غیر وارث بدون رضایت ورثه
    "will": {"non_heir_cap": "1/3"},
}
