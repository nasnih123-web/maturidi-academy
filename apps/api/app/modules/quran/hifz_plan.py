"""منطق خالص برنامهٔ حفظ، SRS و روش‌های تمرین تسمی — فاز ۱۰ قرآن.

این ماژول هیچ I/Oای ندارد (بدون DB، بدون شبکه، بدون صوت) تا با تست
واحد خالص قابل اثبات باشد. سرویس‌های DBایِ همین قابلیت‌ها در
`hifz_plan_service.py` هستند و از همین توابع استفاده می‌کنند.

قواعد ثبت‌شده:
- SRS: الگوریتم SM-2 کلاسیک (SuperMemo) با پارامترهای نسخه‌دار
  (SM2_PARAMS). کیفیت ۰ تا ۵ از نمرهٔ ASR مشتق می‌شود — نه از یک
  درصد ثابت: نوع/شدت خطا، تکرار، Peek و فاصله از آخرین مرور در آن
  اثر می‌گذارند (نگاه کنید به `quality_from_grade`).
- برنامهٔ معکوس: فقط ترتیب سوره‌ها معکوس است (از ناس به فاتحه)؛
  ترتیب آیات درون هر سوره عادی و صحیح می‌ماند. این نوع برنامهٔ
  هدف‌گذاری است، نه تغییر ترتیب متن قرآن.
- روش‌های تسمی از سایت رسمی tasmi.cloud (خوانده‌شده ۲۰۲۶-۱۱-۰۷)
  برداشته شده‌اند و کاملاً مبتنی بر خودارزیابی کاربرند: tap کاربر
  به‌معنی موفقیت ASR نیست و هرگز به‌عنوان نمرهٔ ASR ذخیره نمی‌شود.
  هیچ ادعای اثربخشی قطعی/علمی‌ای در مورد این روش‌ها نمی‌شود.
- بازه‌های مرور تسمی (Forgot: ده دقیقه، hard: فردا، good: چهار روز،
  easy: نه روز) از همان صفحهٔ رسمی‌اند.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

# ---------------------------------------------------------------------------
# SM-2 — پارامترهای نسخه‌دار
# ---------------------------------------------------------------------------
# نسخهٔ ۱. اگر پارامتری عوض شد، نسخه را بالا ببرید و ردیف‌های قدیمی را
# با نسخهٔ خودشان بخوانید؛ هرگز پارامترِ ردیفِ موجود را بی‌صدا عوض نکنید.
SM2_PARAMS_VERSION = 1
SM2_PARAMS: dict = {
    "version": 1,
    "algorithm": "SM-2",
    # کیفیت زیر ۳ یعنی «فراموش‌شده»: تکرار از اول و جریمهٔ ease.
    "lapse_quality": 3,
    "initial_ease": 2.5,
    "min_ease": 1.3,
    "first_interval_days": 1,
    "second_interval_days": 6,
    "easy_bonus": 1.3,
    "lapse_ease_penalty": 0.2,
    # جریمهٔ Peek: هر Peek یک پله از کیفیت کم می‌کند (حداکثر ۲ پله).
    "peek_quality_penalty_per_peek": 1,
    "peek_quality_penalty_max": 2,
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def quality_from_grade(
    counts: dict[str, int],
    *,
    peek_count: int = 0,
    total_words: int | None = None,
) -> int:
    """کیفیت SM-2 (۰ تا ۵) از نمرهٔ یک آیه.

    قاعده (مستند، نه درصد ثابت):
    - همه درست و بدون Peek → ۵.
    - همه درست ولی با Peek → ۴ (Peek یعنی بازیابیِ ناقص).
    - نزدیک (تشکیله) غالب → ۳.
    - خطای تشکیله/کلمه در اقلیت → ۲.
    - غلطِ کلمه غالب یا جاافتادگیِ زیاد → ۱.
    - هیچ کلمهٔ درستی (یا آیه کاملاً جاافتاده) → ۰.
    - هر Peek یک پله کم می‌کند (حداکثر ۲ پله) — Peek در امتیاز
      آزمون هم شمرده می‌شود و این‌جا هم در کیفیت اثر می‌گذارد.
    """
    correct = int(counts.get("correct", 0))
    close = int(counts.get("close", 0))
    wrong = int(counts.get("wrong", 0))
    skipped = int(counts.get("skipped", 0))
    total = total_words if total_words is not None else correct + close + wrong + skipped
    if total <= 0:
        return 0
    if wrong + skipped == 0 and close == 0:
        quality = 5
    elif wrong + skipped == 0:
        quality = 4 if close <= max(1, total // 4) else 3
    elif correct == 0 and close == 0:
        quality = 0
    elif wrong >= total // 2 or skipped >= total // 2:
        quality = 1
    elif wrong + skipped <= max(1, total // 4):
        quality = 2 if close > 0 else 3
    else:
        quality = 2
    penalty = min(
        int(peek_count) * SM2_PARAMS["peek_quality_penalty_per_peek"],
        SM2_PARAMS["peek_quality_penalty_max"],
    )
    return max(0, quality - penalty)


def sm2_next(
    quality: int,
    repetitions: int,
    ease: float,
    interval_days: int,
    *,
    now: datetime | None = None,
) -> dict:
    """یک گام SM-2. ورودی/خروجی صریح؛ بدون I/O.

    برمی‌گرداند: repetitions, ease, interval_days, due_at.
    - quality < 3: فراموش‌شده — تکرار از اول (repetitions=0) و
      فاصلهٔ ۱ روز، با جریمهٔ ease.
    - quality >= 3: repetitions+1؛ فاصله: ۱ روز (اولین)، ۶ روز
      (دومین)، بعد interval * ease (با easy_bonus برای quality=5).
    - ease هرگز زیر ۱٫۳ نمی‌رود.
    """
    if not 0 <= quality <= 5:
        raise ValueError("quality must be 0..5")
    now = now or _utcnow()
    params = SM2_PARAMS
    ease = max(
        params["min_ease"],
        ease
        + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    )
    if quality < params["lapse_quality"]:
        repetitions = 0
        interval = 1
        ease = max(params["min_ease"], ease - params["lapse_ease_penalty"])
    else:
        repetitions += 1
        if repetitions == 1:
            interval = params["first_interval_days"]
        elif repetitions == 2:
            interval = params["second_interval_days"]
        else:
            interval = math.ceil(interval_days * ease)
            if quality == 5:
                interval = math.ceil(interval * params["easy_bonus"])
    interval = max(1, int(interval))
    return {
        "repetitions": repetitions,
        "ease": round(ease, 4),
        "interval_days": interval,
        "due_at": now + timedelta(days=interval),
        "params_version": params["version"],
    }


# ---------------------------------------------------------------------------
# برنامهٔ حفظ — ترتیب آیات
# ---------------------------------------------------------------------------

def plan_ayah_order(
    start: tuple[int, int],
    end: tuple[int, int],
    *,
    direction: str = "normal",
    ayah_counts: dict[int, int] | None = None,
) -> list[tuple[int, int]]:
    """فهرست (سوره، آیه)‌های یک بازهٔ پیوسته، به ترتیب برنامه.

    normal: سوره صعودی، آیه صعودی.
    reverse: سوره نزولی (از ناس به فاتحه)، آیه درون هر سوره صعودی
    (ترتیب آیات درون سوره عادی و صحیح می‌ماند).
    ayah_counts: تعداد آیات هر سوره؛ اگر داده نشد، از
    `quran_service.get_surah` خوانده نمی‌شود — فراخواننده باید بدهد
    (این تابع خالص می‌ماند). برای بازهٔ تک‌سوره‌ای، تعداد آیات لازم
    نیست.
    """
    (ss, sa), (es, ea) = start, end
    if direction not in ("normal", "reverse"):
        raise ValueError("direction must be normal or reverse")
    if (ss, sa) > (es, ea):
        raise ValueError("range start must be <= range end")
    order: list[tuple[int, int]] = []
    if ss == es:
        order = [(ss, a) for a in range(sa, ea + 1)]
        return order
    if ayah_counts is None:
        raise ValueError("ayah_counts is required for a multi-surah range")
    surahs = range(ss, es + 1)
    if direction == "reverse":
        surahs = range(es, ss - 1, -1)
    for s in surahs:
        total = ayah_counts.get(s)
        if total is None:
            raise ValueError(f"ayah count missing for surah {s}")
        first = sa if s == ss else 1
        last = ea if s == es else total
        order.extend((s, a) for a in range(first, last + 1))
    return order


# ---------------------------------------------------------------------------
# روش‌های تمرین تسمی — ماشین‌های حالت خالص
# ---------------------------------------------------------------------------
# منبع منطق: https://tasmi.cloud (خوانده‌شده ۲۰۲۶-۱۱-۰۷).
# هر سه روش، «خودارزیابی»‌اند: پیشرفت فقط با tap کاربر جلو می‌رود و
# state پس از هر tap ذخیره می‌شود تا قطع‌شدن (interruption) نشست را
# از همان‌جا ادامه دهد (resume = خواندنِ همان state).

# --- 6446 ---
# یک آیه در هر نوبت؛ ۲۰ تکرار در چهار ست:
# خواندن ۶× (با نگاه به مصحف) → از حفظ ۴× → خواندن ۴× → از حفظ ۶×.
# هر تکرار با یک tap شمرده می‌شود.
METHOD_6446_SETS: tuple[tuple[str, int], ...] = (
    ("read", 6),
    ("recite", 4),
    ("read", 4),
    ("recite", 6),
)


def method_6446_initial_state(ayahs: list[tuple[int, int]]) -> dict:
    return {
        "ayahs": [[s, a] for s, a in ayahs],
        "ayah_pos": 0,
        "set_pos": 0,
        "count_in_set": 0,
        "done": False,
    }


def method_6446_tap(state: dict) -> dict:
    """یک tap: یک تکرار از ستِ جاری. در پایان ست، ستِ بعد؛ در پایان
    آیه، آیهٔ بعد؛ در پایان فهرست، done."""
    state = dict(state)
    if state.get("done"):
        return state
    sets = METHOD_6446_SETS
    count = int(state.get("count_in_set", 0)) + 1
    set_pos = int(state.get("set_pos", 0))
    _kind, target = sets[set_pos]
    if count >= target:
        count = 0
        set_pos += 1
        if set_pos >= len(sets):
            set_pos = 0
            ayah_pos = int(state.get("ayah_pos", 0)) + 1
            if ayah_pos >= len(state.get("ayahs", [])):
                state["done"] = True
                state["ayah_pos"] = len(state.get("ayahs", []))
                state["set_pos"] = 0
                state["count_in_set"] = 0
                return state
            state["ayah_pos"] = ayah_pos
    state["set_pos"] = set_pos
    state["count_in_set"] = count
    return state


def method_6446_current(state: dict) -> dict:
    """وضعیت نمایشی ستِ جاری: آیه، نوع (خواندن/از حفظ)، شمارش."""
    ayahs = state.get("ayahs", [])
    pos = int(state.get("ayah_pos", 0))
    set_pos = int(state.get("set_pos", 0))
    kind, target = METHOD_6446_SETS[set_pos]
    return {
        "ayah": ayahs[pos] if 0 <= pos < len(ayahs) else None,
        "ayah_pos": pos,
        "ayah_total": len(ayahs),
        "set_pos": set_pos,
        "set_kind": kind,
        "count_in_set": int(state.get("count_in_set", 0)),
        "set_target": target,
        "done": bool(state.get("done", False)),
    }


# --- 3x3 ---
# گروه‌های سه‌آیه‌ای؛ هر گروه هفت گام (از سایت رسمی):
# خواندن هر سه ۵× → از حفظ آیهٔ ۱ (۳×) → آیهٔ ۲ (۳×) → آیهٔ ۳ (۳×)
# → پیوند ۱-۲ (۳×) → پیوند ۲-۳ (۳×) → پیوند هر سه (۳×).
# بازهٔ بلندتر به گروه‌های سه‌آیه‌ای تقسیم می‌شود.
METHOD_3X3_STEPS: tuple[tuple[str, int], ...] = (
    ("read_all", 5),
    ("recite_1", 3),
    ("recite_2", 3),
    ("recite_3", 3),
    ("join_1_2", 3),
    ("join_2_3", 3),
    ("join_all", 3),
)


def method_3x3_initial_state(ayahs: list[tuple[int, int]]) -> dict:
    groups = [ayahs[i : i + 3] for i in range(0, len(ayahs), 3)]
    return {
        "groups": [[[s, a] for s, a in g] for g in groups],
        "group_pos": 0,
        "step_pos": 0,
        "count_in_step": 0,
        "done": False,
    }


def method_3x3_tap(state: dict) -> dict:
    state = dict(state)
    if state.get("done"):
        return state
    steps = METHOD_3X3_STEPS
    count = int(state.get("count_in_step", 0)) + 1
    step_pos = int(state.get("step_pos", 0))
    _kind, target = steps[step_pos]
    if count >= target:
        count = 0
        step_pos += 1
        if step_pos >= len(steps):
            step_pos = 0
            group_pos = int(state.get("group_pos", 0)) + 1
            if group_pos >= len(state.get("groups", [])):
                state["done"] = True
                state["group_pos"] = len(state.get("groups", []))
                state["step_pos"] = 0
                state["count_in_step"] = 0
                return state
            state["group_pos"] = group_pos
    state["step_pos"] = step_pos
    state["count_in_step"] = count
    return state


def method_3x3_current(state: dict) -> dict:
    groups = state.get("groups", [])
    pos = int(state.get("group_pos", 0))
    step_pos = int(state.get("step_pos", 0))
    kind, target = METHOD_3X3_STEPS[step_pos]
    return {
        "group": groups[pos] if 0 <= pos < len(groups) else None,
        "group_pos": pos,
        "group_total": len(groups),
        "step_pos": step_pos,
        "step_kind": kind,
        "count_in_step": int(state.get("count_in_step", 0)),
        "step_target": target,
        "done": bool(state.get("done", False)),
    }


# --- Tasmi Method (هشت مرحله) ---
# از صفحهٔ رسمی tasmi.cloud (۲۰۲۶-۱۱-۰۷):
# 1. Meet the Ayahs — گوش‌دادن، تطبیق ترجمه، خواندن بلند.
# 2. First Recall — پر کردن جاهای خالی؛ اول آسان، بعد سخت‌تر.
# 3. Recite the Sequence — تولید آیه‌ها به ترتیب، با صدای بلند.
# 4. Bridge the Gaps — گذرهای آیه‌به‌آیه.
# 5. Continue from Here — ادامه از یک مکث طبیعی.
# 6. Chain Challenge — خواندن کل بازه بدون کمک.
# 7. Recite in Prayer — آوردن آیه‌ها به نماز.
# 8. Share a Reflection — نوشتنِ آنچه آیه‌ها بر جای گذاشتند.
# گونه‌ها (همان صفحه): Standard — هر هشت مرحله. Gentle — مرحله‌های
# اول تکرار می‌شوند. Revision — چهار مرحله، مستقیم به یادآوری.
# «چهار مرحله» در صفحه نام برده نشده‌اند؛ عملیاتی‌سازیِ ما (مستند،
# قابل تغییر با تصمیم کاربر): First Recall، Recite the Sequence،
# Bridge the Gaps، Chain Challenge.
TASMI8_STAGES: tuple[tuple[str, str], ...] = (
    ("meet", "Meet the Ayahs"),
    ("first_recall", "First Recall"),
    ("recite_sequence", "Recite the Sequence"),
    ("bridge_gaps", "Bridge the Gaps"),
    ("continue_from_here", "Continue from Here"),
    ("chain_challenge", "Chain Challenge"),
    ("recite_in_prayer", "Recite in Prayer"),
    ("share_reflection", "Share a Reflection"),
)

TASMI8_VARIANTS: dict[str, list[str]] = {
    # Standard: هر هشت مرحله، یک بار.
    "standard": [s[0] for s in TASMI8_STAGES],
    # Gentle: مرحله‌های اول (Meet / First Recall / Recite the
    # Sequence) هر کدام دو بار، بعد بقیه یک بار.
    "gentle": [
        "meet", "meet",
        "first_recall", "first_recall",
        "recite_sequence", "recite_sequence",
        "bridge_gaps", "continue_from_here", "chain_challenge",
        "recite_in_prayer", "share_reflection",
    ],
    # Revision: مستقیم به یادآوری (چهار مرحله — عملیاتی‌سازیِ ما).
    "revision": [
        "first_recall", "recite_sequence", "bridge_gaps", "chain_challenge",
    ],
}

# بازه‌های مرور تسمی از صفحهٔ رسمی (رتبه‌بندیِ کاربر پس از پایان بازه):
# Forgot → ده دقیقه؛ hard → فردا؛ good → چهار روز؛ easy → نه روز.
TASMI_REVIEW_INTERVALS: dict[str, timedelta] = {
    "forgot": timedelta(minutes=10),
    "hard": timedelta(days=1),
    "good": timedelta(days=4),
    "easy": timedelta(days=9),
}


def tasmi8_initial_state(variant: str = "standard") -> dict:
    if variant not in TASMI8_VARIANTS:
        raise ValueError(f"unknown tasmi8 variant: {variant}")
    return {
        "variant": variant,
        "stages": list(TASMI8_VARIANTS[variant]),
        "stage_pos": 0,
        "done": False,
    }


def tasmi8_advance(state: dict) -> dict:
    """تکمیلِ مرحلهٔ جاری با خودارزیابی کاربر → مرحلهٔ بعد."""
    state = dict(state)
    if state.get("done"):
        return state
    pos = int(state.get("stage_pos", 0)) + 1
    if pos >= len(state.get("stages", [])):
        state["done"] = True
        state["stage_pos"] = len(state.get("stages", []))
        return state
    state["stage_pos"] = pos
    return state


def tasmi8_current(state: dict) -> dict:
    stages = state.get("stages", [])
    pos = int(state.get("stage_pos", 0))
    stage_id = stages[pos] if 0 <= pos < len(stages) else None
    title = dict(TASMI8_STAGES).get(stage_id) if stage_id else None
    return {
        "stage": stage_id,
        "stage_title": title,
        "stage_pos": pos,
        "stage_total": len(stages),
        "done": bool(state.get("done", False)),
    }


def tasmi_review_due_at(rating: str, *, now: datetime | None = None) -> datetime:
    """موعد مرور بعدی از رتبه‌بندیِ خودارزیابیِ کاربر (تسمی)."""
    if rating not in TASMI_REVIEW_INTERVALS:
        raise ValueError(f"unknown tasmi rating: {rating}")
    return (now or _utcnow()) + TASMI_REVIEW_INTERVALS[rating]


# ---------------------------------------------------------------------------
# امتیاز آزمون — محاسبهٔ دوباره پس از حذف خطای کاذب
# ---------------------------------------------------------------------------

def test_question_score(raw_events: list[dict]) -> dict:
    """امتیاز یک سؤال آزمون از رویدادهای خام، بدون رویدادهای حذف‌شده.

    امتیاز = درست / (درست + نزدیک + غلط + جاافتاده) روی رویدادهای
    حذف‌نشده؛ Peek جداگانه شمرده می‌شود و در مخرج نمی‌آید ولی در
    امتیاز کل آزمون (test_score) هر Peek پنج صدم (۰٫۰۵) از امتیاز
    آن سؤال کم می‌کند (مستند؛ قابل تنظیم با تصمیم کاربر).
    برمی‌گرداند: score (None اگر هیچ رویداد حذف‌نشده‌ای نباشد)، counts.
    """
    counts = {"correct": 0, "close": 0, "wrong": 0, "skipped": 0}
    peeks = 0
    seen_peeks: set[tuple] = set()
    for ev in raw_events:
        if ev.get("removed"):
            continue
        if ev.get("mistake_type") == "peek":
            # یک کلمهٔ Peekشده فقط یک بار شمرده می‌شود، حتی اگر هم
            # رویداد Peek و هم رویداد نمرهٔ همان کلمه در فهرست باشد.
            key = (ev.get("surah"), ev.get("ayah"), ev.get("word_index"))
            if key not in seen_peeks:
                seen_peeks.add(key)
                peeks += 1
            continue
        status = ev.get("status")
        if status in counts:
            counts[status] += 1
    total = sum(counts.values())
    if total == 0:
        return {"score": None, "counts": counts, "peek_count": peeks}
    score = counts["correct"] / total
    return {"score": round(score, 4), "counts": counts, "peek_count": peeks}


def test_total_score(questions: list[dict]) -> dict | None:
    """امتیاز کل آزمون: میانگین امتیاز سؤال‌های پاسخ‌داده‌شده، با
    جریمهٔ Peek (هر Peek پنج صدم از امتیاز آن سؤال). None اگر هیچ
    سؤالی پاسخ داده نشده باشد."""
    scores: list[float] = []
    for q in questions:
        s = q.get("score")
        if s is None:
            continue
        peeks = int(q.get("peek_count", 0))
        scores.append(max(0.0, float(s) - 0.05 * peeks))
    if not scores:
        return None
    return {
        "score": round(sum(scores) / len(scores), 4),
        "answered": len(scores),
        "total": len(questions),
    }
