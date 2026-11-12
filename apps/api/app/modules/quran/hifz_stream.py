"""جریان زندهٔ حفاظ — رنگ زنده حین خواندن (WebSocket).

طرح (بازبینی فاز ۳، بخش ۱۵ سند طراحی):
- صفحهٔ مطالعه دیگر صفحهٔ SVG نیست؛ دیوار سفید خالی است که کلمه‌ها
  حین تلاوت، یکی‌یکی و با رنگ زنده، در آن نوشته می‌شوند.
- رنگ زنده فقط از مسیر جریانیِ سمت سرور می‌آید (WebSocket)، نه ONNX
  مرورگر و نه Web Speech API. مرورگر قاب‌های صوتی ۱۶ کیلوهرتز تک‌کاناله
  می‌فرستد؛ سرور کلمه‌های شناخته‌شده را با وضعیت و احتمال برمی‌گرداند.
- ادامه پس از جاافتادگی حفظ می‌شود: کلمه/آیهٔ جاافتاده خاکستری نوشته
  می‌شود و نوشتن از آن رد می‌شود؛ نمره‌دهی هرگز سر جاافتادگی نمی‌ایستد.
- یافتنِ آیه از روی صدا: نشست با آیهٔ انتخاب‌شده به‌عنوانِ راهنما
  شروع می‌شود، ولی اگر خواندن از آیهٔ دیگری شروع شود، چند ثانیهٔ
  اولِ واج‌ها درونِ همان سوره جست‌وجو می‌شود و نشست همان‌جا لنگر
  می‌اندازد (رویداد `located`)؛ قانونِ کاربر: آیهٔ جاافتاده فقط تا
  ۵ آیه خاکستری می‌شود؛ بیشتر از آن، نشست از نو می‌یابد و آیه‌های
  بینِ راه خاکستری نمی‌شوند (نه در صفحه، نه در نمرهٔ ذخیره‌شده).
- پایان جریان، نشست را با همان جدول‌های نمره‌دهیِ ضبطی ذخیره می‌کند
  (hifz_attempts / hifz_word_scores / hifz_mistakes)؛ منطق ذخیره‌سازی
  تکرار نشده، بلکه همان `_store_grade` دوباره استفاده می‌شود.
- صوت گذراست: قاب‌ها فقط به بازشناس داده می‌شوند و دور انداخته
  می‌شوند؛ هرگز ذخیره نمی‌شوند و هرگز از دروازهٔ ClamAV نمی‌گذرند.
- قطع ناگهانیِ اتصال، چیزی ذخیره نمی‌کند؛ فقط پیام صریح `end` ذخیره
  می‌کند (مثل «پایان تمرین» در مسیر ضبطی).

نگاشت واج‌به‌کلمه (یکپارچه‌شده با دادهٔ واقعی Quran-Lab):
- موتور Zipformer واج تحویل می‌دهد، نه کلمه؛ رنگ زندهٔ کلمه‌ای روی
  این مسیر از نگاشت `ordered_quran_phonemes.json` می‌آید که مرز
  قطعه‌های واجی‌اش با DP اعتبارسنجی‌شده است (hifz_mapping.py). واحد
  تطابق، «قطعه» است نه کلمهٔ تنها: یک قطعه می‌تواند چند کلمه را
  بپوشاند (ادغام در تلفظ پیوسته) و یک کلمه می‌تواند چند قطعه داشته
  باشد (حروف مقطعه)؛ بارگذار قطعه‌ها را از پیش ادغام می‌کند.
- تطابق روی رشتهٔ واجی انجام می‌شود (توکن‌های بازشناس به هم چسبانده
  می‌شوند)، پس ابهام تجزیهٔ رشته به توکن روی نمره اثر نمی‌گذارد.
  نشانه‌های وقف، قطعهٔ «رد خودکار» دارند (خاکستری، بی‌مصرف واج).
- بدون نگاشت پیکربندی‌شده، `require_phoneme_mapping` همان خطای
  صادقانهٔ ۵۰۳ با کد `hifz_word_alignment_pending` را می‌دهد و هیچ
  خروجی واجی به‌عنوان نمرهٔ کلمه معرفی نمی‌شود؛ آیه‌ای که ترازش رد
  شده باشد، خطای صادقانهٔ `hifz_mapping_ayah_unavailable` می‌دهد.
- مسیر Whisper جریانی نیست: `whisper_quran` فقط ضبط-سپس-نمره می‌ماند
  و برای جریان زنده، خطای صادقانهٔ `hifz_live_unavailable` می‌دهد.

قانون‌های فاز ۶ (برابری حفاظ با ترتیل — Alignment + Grading):
- «جاافتاده» فقط با مدرکِ مثبتِ جلو رفتن: یافتنِ روبه‌جلو باید آیه‌ای
  جلوتر را ثابت کند؛ وگرنه واحدِ بی‌تطابق «غلط» می‌خورد و مصرف
  می‌شود (اصلاحِ عیبِ سورهٔ ۲۴). یافتن هم کفِ اثبات دارد: ۲۴ حرف،
  یا تمامِ رشتهٔ آیهٔ کوتاه (تطابقِ جزئیِ کوتاه مدرک نیست).
- سه‌وضعیتی: `partial` موقت (provisional، بی‌confidence)، کلمهٔ
  پایدار (stable، قابلِ اصلاح با `correction` در همان خانه)،
  کلمهٔ پایانیِ finish (final). «نزدیک» در مرزِ بیشینهٔ فاصله،
  پرچمِ `needs_review` می‌خورد؛ در شرایطِ مبهم، صبر بهتر از
  علامت‌گذاریِ قطعیِ اشتباه است.
- پیش‌نمایش (§۱۴٫۱): فقط `partial` برای واحدِ اشاره‌گرِ قطعی؛
  اشاره‌گرِ گمانه‌ای جداست و با اصلاحِ فرضیه پس گرفته می‌شود
  (`retracted: true`). پیش‌نمایش هرگز ثبت نمی‌شود و کلمه‌های بعد
  را بر مبنای حدس نمی‌سازد.
- دسته‌های قطعه‌ای: تکرار (بازخوانیِ واحدِ صادرشده، رویداد `repeat`)،
  برگشت (بازخوانیِ آیهٔ پیش‌تر، رویداد `revisit`، بی‌عقب‌رفتنِ
  اشاره‌گر)، شروع از آیهٔ دیگر (`located`)، مکث (نشست منتظر
  می‌ماند؛ مکث هرگز کلمه را علامت نمی‌زند)، اضافه (`extra`).
- آستانه‌ها نقطهٔ شروعِ آزمایش‌اند، نه عددِ کالیبره‌شده؛ احتمال‌های
  ۰٫۹۵/۰٫۶۵/۰٫۳۰ مقدارهای مشتق‌شده از نوعِ تطابق‌اند و هرگز نباید
  به‌صورت درصد نمایش داده شوند.
"""

from __future__ import annotations

import json
import logging
import os
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.models.models import HifzAttempt, User

from . import alignment, hifz_engines, hifz_service
from . import service as quran_service
from .hifz_mapping import (
    MappingPendingError,
    PhonemeMapping,
    Segment,
    collapse_phoneme_runs,
    load_phoneme_mapping,
)
from .hifz_ws_contract import (
    EVENT_TYPE_BY_WORD_STATUS,
    LiveEventSequencer,
)

logger = logging.getLogger(__name__)

# کلمهٔ قابل‌فهم برای آزمون: پنجرهٔ جست‌وجوی جلو در تراز زنده.
_LIVE_LOOKAHEAD = 40

# آستانه‌های تطابق — نقطهٔ شروعِ آزمایش‌اند، نه عددِ کالیبره‌شده.
# هیچ‌کدام با دادهٔ واقعی کالیبره نشده‌اند؛ «نزدیک» در مرزِ بیشینهٔ
# فاصله با پرچمِ needs_review می‌آید تا بازبینی شود، و احتمال‌های
# زیر مقدارهای مشتق‌شده از نوعِ تطابق‌اند، نه confidence کالیبره‌شده
# (هرگز نباید به‌صورت درصدِ قابل‌فهم نمایش داده شوند).
_NEAR_MISS_MAX_DISTANCE = 2
_PROB_CORRECT = 0.95
_PROB_CLOSE = 0.65
_PROB_WRONG = 0.30

# هم‌ترازیِ دوباره (ایراد ۱۴): اگر خردهٔ دورریخته دست‌کم این‌قدر
# واج باشد و ادامهٔ بافر با واحدی جلوتر بخواند، کاربر به‌جای واحدِ
# جاری چیز دیگری خوانده است — واحد «غلط» می‌خورد، نه اینکه خرده
# بی‌صدا دور ریخته شود و واحد «جاافتاده» شود. خردهٔ کوتاه‌تر از
# این (نویز/شروعِ ناتمام) همان دورریختنِ خاموشِ پیشین است.
_RESYNC_WRONG_MIN_CHARS = 4
# وقتی نشست در حالتِ «تا اصلاحِ خطا جلو نرو» نگه داشته شده، واجِ
# نامربوطِ انباشته سقف دارد تا بافر بی‌نهایت رشد نکند.
_HOLD_BUFFER_MAX_CHARS = 300

# کمترین طولِ واجی برای یافتنِ آیه: کمتر از این، جست‌وجو مبهم است
# (چند حرفِ واجی در چند آیه تکرار می‌شود).
_LOCATE_MIN_CHARS = 24
# بیشترین طولِ کاوشِ یافتن: چند ثانیهٔ اولِ خواندن برای لنگر کافی است.
_LOCATE_PROBE_CHARS = 40
# کمترین طولِ تطابقِ یک آیه: آیهٔ کوتاه (رشتهٔ واجیِ کمتر از ۲۴ حرف)
# هم باید پیدا شود؛ ۸ حرفِ واجی (حدود ۲ کلمه) هنوز متمایز است و
# تساویِ دقیق با قانونِ راهنما/ابهام حل می‌شود.
_LOCATE_MIN_MATCH = 8
# قانونِ کاربر: آیهٔ جاافتاده فقط تا ۵ آیه خاکستری می‌شود؛ بیشتر از
# آن، نشست از نو می‌یابد (جست‌وجوی تازه)، نه اینکه سوره را خاکستری کند.
_MAX_GRAY_AYAH_GAP = 5
# بیشترین طولِ «اتصال» در تشخیصِ بازخوانی (فاز ۹): پیشوندِ مصرف‌نشدهٔ
# واحدِ جاری که سرِ بافر مانده و بازخوانی پس از آن شروع می‌شود؛ بیشتر
# از طولِ یک واحد نمی‌تواند باشد و سقفِ ۱۶ حرف هم برای ایمنی است.
_REVISIT_MAX_JUNCTION = 16
# بیشترین عقب‌نشینی در برشِ بازخوانی (فاز ۹): همخوانِ مرزیِ مشترکِ
# میانِ دمِ بازخوانی و ادامهٔ واقعی، نقطهٔ دقیقِ برش را ۱–۲ حرف
# مبهم می‌کند؛ برشِ کوتاه‌تر که ��م‌ترازی را برمی‌گرداند، برنده است.
_REVISIT_TRIM_BACKOFF = 2

# وضعیتِ نهایی‌شدنِ رویدادِ کلمه‌ای (فاز ۶، سه‌وضعیتی + correction):
# provisional = موقتِ قابلِ تغییر (فقط partial)؛ stable = پایدارِ
# نسبی (واحد تطابق خورده و بافر گذشته؛ correction همان خانه را اصلاح
# می‌کند)؛ final = نهایی (finish() صادر کرده؛ پس از `final` هیچ
# رویدادِ کلمه‌ای نمی‌آید). رویدادهای غیرکلمه‌ای finality ندارند.
_FINALITY_BY_EVENT_TYPE = {
    "partial": "provisional",
    "stable_word": "stable",
    "wrong": "stable",
    "skipped": "stable",
    "final_word": "final",
    "correction": "stable",
}


def _basmala_phoneme_string(mapping) -> str:
    """رشتهٔ واجیِ بسمله از خودِ نگاشت (آیهٔ ۱:۱ خودِ بسمله است).

    نگاشتِ بدونِ مدخل ۱:۱ (مثل نگاشت مصنوعیِ تست‌ها) رشتهٔ خالی
    می‌دهد و همهٔ منطقِ بسملهٔ پایین‌دست خاموش می‌ماند.
    """
    if mapping is None:
        return ""
    segs = mapping.segments_for(1, 1)
    if not segs:
        return ""
    return "".join(
        collapse_phoneme_runs(s.phoneme) for s in segs if s.phoneme is not None
    )


def _locate_pass(
    mapping, surah, buf, hint_ayah, allow_backward, required_len,
    buf_offset,
):
    """یک گذرِ جست‌وجوی آیه با کاوش از `buf[buf_offset:]`.

    برمی‌گرداند `(best_len, best)` که `best` فهرستِ
    `(ayah, found_off, unit_pos, buf_offset)` برای آیه‌های هم‌امتیازِ
    بلندترین تطابق است. منطقِ امتیازدهی دقیقاً همانِ پیشین است:
    بلندترین پیشوندِ کاوش که زیررشتهٔ رشتهٔ موردانتظارِ آیه باشد،
    با کفِ اثباتِ `required_len` (یا تمامِ رشتهٔ آیهٔ کوتاه).
    """
    probe = buf[buf_offset:buf_offset + _LOCATE_PROBE_CHARS]
    basmala = _basmala_phoneme_string(mapping)
    meta = quran_service.get_surah(surah)
    best_len = 0
    best: list[tuple[int, int, int, int]] = []
    for ayah in range(1, meta.ayahs + 1):
        if not allow_backward and hint_ayah is not None and ayah <= hint_ayah:
            continue
        segs = mapping.segments_for(surah, ayah)
        if not segs:
            continue
        # بسمله مدرکِ یافتن نیست (ایراد ۱۴): قطعه‌های بسملهٔ ابتدای
        # آیهٔ ۱ (جز سورهٔ ۱ که آیه‌اش خودِ بسمله است) از رشتهٔ
        # موردانتظار کنار گذاشته می‌شوند — وگرنه بسملهٔ آغازِ هر
        # نشست (که ربطی به آیهٔ انتخابی ندارد) به‌تنهایی آیهٔ ۱ را
        # «اثبات» می‌کرد و نشست روی آیهٔ ۱ لنگر می‌انداخت و دیوار،
        # آیه‌های نخوانده را یکی‌یکی می‌نوشت (راستی‌آزمایی با صدای
        # واقعی مالک: نشستِ آیهٔ ۱۲ اعراف روی آیهٔ ۱ لنگر انداخت و
        # تا آیهٔ ۱۰ خاکستری نوشت). `drop` در unit_pos جبران می‌شود
        # تا اندیس با فهرستِ کاملِ قطعه‌ها بخواند.
        drop = 0
        if ayah == 1 and surah != 1 and basmala:
            acc = ""
            for s in segs:
                if acc == basmala:
                    break
                if s.phoneme is None:
                    drop += 1
                    continue
                cand = acc + collapse_phoneme_runs(s.phoneme)
                if not basmala.startswith(cand):
                    break
                acc = cand
                drop += 1
            if acc == basmala:
                segs = segs[drop:]
            else:
                drop = 0
        if not segs:
            continue
        expected = "".join(
            collapse_phoneme_runs(s.phoneme) for s in segs if s.phoneme is not None
        )
        if not expected:
            continue
        # پیش‌فیلترِ ارزان: هر تطابقِ دست‌کم ۸حرفی باید پیشوندِ
        # ۸حرفیِ کاوش را داشته باشد؛ وگرنه هیچ kای نمی‌خواند
        # (نتیجه را عوض نمی‌کند، فقط حلقهٔ کوچک‌شدنِ k را حذف می‌کند).
        if probe[:_LOCATE_MIN_MATCH] not in expected:
            continue
        # بلندترین پیشوندِ کاوش که در رشتهٔ موردانتظار هست؛ آیهٔ
        # کوتاه هم با همین کف پیدا می‌شود (تمامِ رشته‌اش).
        k = min(len(probe), len(expected))
        found_len = 0
        found_off = -1
        while k >= _LOCATE_MIN_MATCH:
            off = expected.find(probe[:k])
            if off >= 0:
                found_len = k
                found_off = off
                break
            k -= 1
        if found_len == 0:
            continue
        # کفِ اثبات: کمتر از این، آیه نامزد نیست.
        if found_len < min(required_len, len(expected)):
            continue
        # واحدی که تطابق از آن شروع می‌شود (با جبرانِ قطعه‌های
        # بسملهٔ کنارگذاشته‌شده تا اندیس روی فهرستِ کامل باشد).
        unit_pos = len(segs) - 1
        acc = 0
        for j, s in enumerate(segs):
            if s.phoneme is None:
                continue
            plen = len(collapse_phoneme_runs(s.phoneme))
            if acc + plen > found_off:
                unit_pos = j
                break
            acc += plen
        unit_pos += drop
        if found_len > best_len:
            best_len = found_len
            best = [(ayah, found_off, unit_pos, buf_offset)]
        elif found_len == best_len:
            best.append((ayah, found_off, unit_pos, buf_offset))
    return best_len, best


def _locate_ayah_full(
    mapping, surah, buf, hint_ayah=None, allow_backward=True,
    min_len: int | None = None, tie_break_recency: bool = False,
):
    """یافتنِ آیه با جابه‌جاییِ سرِ بافر؛ برمی‌گرداند
    `(ayah, unit_pos, best_len, buf_offset)` یا None.

    گذرِ اول از سرِ بافر می‌کاود — یا، اگر بافر با بسمله شروع
    شود، از بعدِ بسمله (بسمله مدرکِ موقعیت نیست؛ ایراد ۱۴).
    گذرِ دوم — فقط وقتی گذرِ اول هیچ نامزدی نیافت — تطابق را چند
    حرف جلوتر هم می‌آزماید: سرِ بافر ممکن است خردهٔ باقی‌ماندهٔ
    واحدِ پیشین باشد (اتصالِ واحدِ جاری، همزهٔ سرگردانِ آیهٔ
    پرش‌شده)، و همان چند حرف پیش‌فیلترِ ۸حرفی را می‌شکست و هر
    آیه‌ای را اثبات‌ناپذیر می‌کرد — ریشهٔ هر سه نقصِ بخش ۷
    (تکرارِ چندباره، بازگشتِ دور، پرشِ آیهٔ بلند). در گذرِ دوم،
    بلندترین تطابق در همهٔ جابه‌جایی‌ها برنده است (تساوی: کوچک‌ترین
    جابه‌جایی) و قانونِ راهنما/ابهامِ گذرِ اول همان‌طور می‌ماند.

    `tie_break_recency` فقط برای شاخهٔ بازگشت (back) است: اگر چند
    آیه دقیقاً مساوی باشند، نزدیک‌ترین آیهٔ پیش از راهنما
    (تازه‌ترینِ خوانده‌شده) برنده می‌شود. مصرفِ بازهٔ تطابق برای
    همهٔ برندگانِ مساوی یکی است (همان زیررشتهٔ بافر) — پس فقط
    برچسبِ آیهٔ رویدادِ `revisit` فرق می‌کند، نه نمره‌دهی و نه
    مصرف. بدونِ این قید، تساویِ واج‌های مشترکِ دو آیه (مثلاً
    «الرَّحْمَـٰنِ الرَّحِيمِ» که هم در آیهٔ ۱ فاتحه هست هم آیهٔ ۳)
    یافتن را None می‌کرد و آبشارِ غلط می‌ساخت: در تکرارِ چندبارهٔ
    صوتیِ آیهٔ ۲، پس از نخستین `revisit` بافر با همین خردهٔ
    مشترک شروع می‌شد و آیه‌های ۴ تا ۷ همه غلط می‌خوردند (۱۹ غلط).
    پیش‌فرض False است تا بقیهٔ فراخوان‌ها (یافتنِ جلو، لنگر) همان
    قانونِ سخت‌گیرانهٔ ابهام را نگه دارند.
    """
    if mapping is None:
        return None
    required_len = min_len if min_len is not None else _LOCATE_MIN_CHARS
    # بسملهٔ سرِ بافر مدرکِ موقعیت نیست (ایراد ۱۴): خواننده تقریباً
    # همیشه نشست را با بسمله شروع می‌کند، پس کاوش از بعدِ بسمله
    # آغاز می‌شود. شاهدِ بسمله، پیشوندِ ۲۴حرفی است (دمِ بسمله در
    # بازشناسی ممکن است چند حرف فرق کند) و جابه‌جاییِ گذرِ دوم
    # دورِ همین نقطه هم می‌گردد تا خطای چندحرفیِ طولِ بسمله جبران
    # شود. `buf_offset` برگشتی همچنان مطلق است (مصرفِ فراخوان‌ها
    # دست نمی‌خورد).
    basmala = _basmala_phoneme_string(mapping)
    base_off = 0
    if (
        basmala
        and len(buf) > len(basmala)
        and buf.startswith(basmala[:_LOCATE_MIN_CHARS])
    ):
        base_off = len(basmala)
    # کفِ ورود روی کلِ بافر است (قانونِ فاز ۶: بافرِ کوتاه — حتی
    # برابرِ تمامِ یک آیهٔ کوتاه — مدرکِ یافتن نیست)؛ بسملهٔ سرِ
    # بافر جزو این کف حساب نمی‌شود ولی از آن کم هم نمی‌کند: بافرِ
    # «بسمله + آیهٔ کوتاه» از کف می‌گذرد و کفِ هر آیه در
    # `_locate_pass` است (minِ required_len و طولِ خودِ آیه).
    # پس از برداشتنِ بسمله هم دست‌کم یک تطابقِ حداقلی باید بماند.
    if len(buf) < required_len:
        return None
    if len(buf) - base_off < _LOCATE_MIN_MATCH:
        return None
    best_len, best = _locate_pass(
        mapping, surah, buf, hint_ayah, allow_backward, required_len, base_off
    )
    if not best:
        by_ayah: dict[int, tuple[int, tuple[int, int, int, int]]] = {}
        max_off = min(_REVISIT_MAX_JUNCTION, len(buf) - _LOCATE_MIN_MATCH)
        offsets = set(range(1, max_off + 1))
        if base_off:
            offsets |= {
                base_off + d
                for d in range(-2, _REVISIT_MAX_JUNCTION + 1)
                if 0 <= base_off + d <= len(buf) - _LOCATE_MIN_MATCH
            }
            offsets.discard(base_off)
        for off in sorted(offsets):
            bl, bb = _locate_pass(
                mapping, surah, buf, hint_ayah, allow_backward,
                required_len, off,
            )
            for item in bb:
                cur = by_ayah.get(item[0])
                if cur is None or bl > cur[0] or (
                    bl == cur[0] and off < cur[1][3]
                ):
                    by_ayah[item[0]] = (bl, item)
        if by_ayah:
            best_len = max(v[0] for v in by_ayah.values())
            best = [v[1] for v in by_ayah.values() if v[0] == best_len]
    if not best:
        return None
    if hint_ayah is not None:
        for ayah, _off, unit_pos, buf_off in best:
            if ayah == hint_ayah:
                return (ayah, unit_pos, best_len, buf_off)
    if len(best) == 1:
        ayah, _off, unit_pos, buf_off = best[0]
        return (ayah, unit_pos, best_len, buf_off)
    if tie_break_recency and hint_ayah is not None:
        below = [b for b in best if b[0] < hint_ayah]
        if below:
            ayah, _off, unit_pos, buf_off = max(below, key=lambda b: b[0])
            return (ayah, unit_pos, best_len, buf_off)
    return None


def locate_ayah(
    mapping, surah, buf, hint_ayah=None, allow_backward=True,
    min_len: int | None = None, return_length: bool = False,
):
    """آیه‌ای از سوره را پیدا کن که واج‌های شنیده‌شده در آن باشد.

    `buf` رشتهٔ واجیِ فروپاشیدهٔ شنیده‌شده (چند ثانیهٔ اول) است؛
    کاوش، چند ده کاراکترِ اولِ آن است. برای هر آیه، بلندترین پیشوندِ
    کاوش که دقیقاً زیررشته‌ای از رشتهٔ واجیِ موردانتظارِ آن آیه باشد
    امتیاز می‌گیرد؛ آیهٔ برنده باید دست‌کم `min_len` کاراکتر بخواند
    (پیش‌فرض: `_LOCATE_MIN_CHARS`؛ برای آیهٔ کوتاه‌تر از آن، تمامِ
    رشتهٔ واجی‌اش). تطابقِ جزئیِ کوتاه (مثلاً ۸ حرف از یک آیهٔ بلند)
    مدرکِ یافتن نیست — باگِ سورهٔ ۲۴ از همین‌جا بود: تطابقِ تصادفیِ
    کوتاه، نشست را به آیهٔ اشتباه می‌برد و بعد خاکستریِ بی‌مهار
    شروع می‌شد. `min_len` کوچک‌تر فقط برای پرسشِ ضعیف‌ترِ «آیا این
    بافر، بازخوانیِ آیه‌ای پیش‌تر است؟» مجاز است (یافتنِ دوباره،
    نه پرش): آن‌جا تصمیمی که اشاره‌گر را جلو ببرد گرفته نمی‌شود،
    پس مدرکِ ضعیف‌تر کافی است.
    اگر آیهٔ راهنما (hint) در میانِ برندگانِ مساوی باشد، همان برمی‌گردد
    (کاربر معمولاً همان‌جایی است که انتخاب کرده)؛ اگر چند آیه دقیقاً
    مساوی باشند، مبهم است و None برمی‌گردد (نشست روی راهنما می‌ماند).
    `allow_backward=False` یعنی فقط آیه‌های جلوتر از راهنما پذیرفته
    می‌شوند (یافتنِ دوبارهٔ وسطِ نشست فقط به جلو می‌رود، مثل ترتیل —
    خواندنِ دوبارهٔ آیهٔ قبلی، نشست را به عقب نمی‌برد).
    اگر سرِ بافر خردهٔ واحدِ پیشین باشد، تطابق چند حرف جلوتر هم
    آزموده می‌شود (`_locate_ayah_full`): همان مدرکِ ۲۴حرفی/تمام‌آیه،
    فقط با جابه‌جاییِ سرِ کاوش.
    """
    hit = _locate_ayah_full(
        mapping, surah, buf, hint_ayah, allow_backward, min_len
    )
    if hit is None:
        return None
    ayah, unit_pos, best_len, _buf_off = hit
    if return_length:
        return (ayah, unit_pos, best_len)
    return (ayah, unit_pos)


def locate_ayah_span(
    mapping, surah, buf, hint_ayah=None, allow_backward=True,
    min_len: int | None = None, tie_break_recency: bool = False,
):
    """مثل `locate_ayah`، ولی طولِ تطابق و جابه‌جاییِ سرِ بافر را هم
    برمی‌گرداند: `(ayah, unit_pos, best_len, buf_offset)` یا None.

    فراخوانِ شاخهٔ ۲برابر با همین می‌فهمد دقیقاً چند حرف از بافر
    (خردهٔ سر + بازخوانی/پرشِ اثبات‌شده) باید مصرف شود، به‌جای
    حدسِ «یک طولِ کلمه» که هم‌ترازی را می‌شکست.
    `tie_break_recency` را فقط شاخهٔ بازگشت می‌دهد (تازه‌ترینِ
    خوانده‌شده میانِ برندگانِ مساوی) — شرح در `_locate_ayah_full`.
    """
    return _locate_ayah_full(
        mapping, surah, buf, hint_ayah, allow_backward, min_len,
        tie_break_recency,
    )


def _waslah_forms(phon: str) -> list[str]:
    """شکل‌های واجیِ یک واحد: خودِ رشته + شکلِ بی‌همزهٔ وصل (اگر دارد).

    همزهٔ وصل در آغازِ کلمه در خواندنِ پیوسته خوانده نمی‌شود؛ پس
    واحدِ بعد ممکن است بی‌همزه هم بیاید (همان منطقِ شاخهٔ waslah و
    `_anchor_close`).
    """
    forms = [phon]
    if phon.startswith("ء"):
        rest = phon[1:]
        if rest and 0x064B <= ord(rest[0]) <= 0x0652:
            rest = rest[1:]
        if rest:
            forms.append(rest)
    return forms


def _match_prefix_with_one_gap(rest: str, run: str) -> int:
    """طولِ تطابقِ پیشوندیِ `rest` با `run`، با حداکثر یک حرفِ جاافتاده
    در `run` (فاز ۹).

    بازشناس گاهی یک واجِ نگاشت را نمی‌نویسد — نمونهٔ اندازه‌گیری‌شده:
    نونِ پایانیِ «الْعَـٰلَمِینَ» پس از مد در جریانِ توکنِ Zipformer
    اصلاً نمی‌آید، پس بازخوانیِ آیهٔ ۲ در همان حرف می‌ایستد و رشتهٔ
    بازخوانی ناتمام می‌ماند. شکاف فقط وقتی پذیرفته می‌شود که پس از
    پرشِ یک حرفِ `run`، تطابق یا تا تهِ `run` برسد یا دست‌کم ۴ حرفِ
    پیاپی بخواند؛ وگرنه همان تطابقِ دقیقِ پیشوند برمی‌گردد. بیش از
    یک شکاف هرگز مجاز نیست و طولِ برگشتی، شمارِ حرف‌های خوانده‌شده
    است (حرفِ پرش‌شده شمرده نمی‌شود).
    """
    k = 0
    while k < len(run) and k < len(rest) and rest[k] == run[k]:
        k += 1
    if k >= len(run) or k >= len(rest):
        return k
    m = 0
    while (
        k + 1 + m < len(run)
        and k + m < len(rest)
        and rest[k + m] == run[k + 1 + m]
    ):
        m += 1
    if m >= 1 and (k + 1 + m >= len(run) or m >= 4):
        return k + m
    return k


class LiveUnavailableError(APIError):
    """موتور انتخاب‌شده جریانی نیست (Whisper فقط ضبط-سپس-نمره است)."""

    def __init__(self, engine_id: str) -> None:
        super().__init__(
            503,
            "hifz_live_unavailable",
            f"موتور {engine_id} جریانی نیست؛ خواندن زنده فقط با Zipformer "
            "ممکن است و Whisper فقط ضبط-سپس-نمره می‌ماند.",
        )


def require_phoneme_mapping() -> PhonemeMapping:
    """نگاشت واج‌به‌کلمه را از مسیر پیکربندی‌شده برمی‌گرداند.

    نبودِ فایل‌ها یا خرابی‌شان → همان خطای صادقانهٔ ۵۰۳
    `hifz_word_alignment_pending`؛ ساختن نگاشت حدسی یا کپی دادهٔ
    مشتق‌شدهٔ دیگران، ممنوع است.
    """
    return load_phoneme_mapping()


@dataclass
class LiveWord:
    """یک کلمهٔ نوشته‌شده در دیوار — همان رنگ‌های نمره‌دهی ضبطی."""

    surah: int
    ayah: int
    word_index: int
    expected: str
    status: str  # correct | close | wrong | skipped
    prob: float
    heard: str | None = None
    reason: str | None = None
    # «نزدیک» در مرزِ بیشینهٔ فاصله (یا تطابقِ دقیق با احتمالِ
    # پایین): قطعی نیست و بازبینی می‌خواهد — در رویداد می‌آید،
    # در شمارندهٔ وضعیت‌ها اثری ندارد.
    needs_review: bool = False

    def event(self) -> dict:
        event = {
            "type": "word",
            "surah": self.surah,
            "ayah": self.ayah,
            "word_index": self.word_index,
            "expected": self.expected,
            "status": self.status,
            "prob": self.prob,
            "heard": self.heard,
        }
        if self.reason is not None:
            event["reason"] = self.reason
        if self.needs_review:
            event["needs_review"] = True
        return event


@dataclass
class StreamWord:
    """یک کلمهٔ شناخته‌شده از بازشناسِ سطحِ کلمه (ماک/آینده)."""

    text: str
    prob: float | None = None


class SherpaPhonemeStream:
    """جریان واجی Zipformer از sherpa_onnx — خروجی‌اش واج است، نه کلمه.

    بارگذاری تنبل: نبودِ sherpa_onnx در محیط، import ماژول را خراب
    نمی‌کند؛ فقط ساخت نمونه خطا می‌دهد. ویژگی‌ها دقیقاً همان‌اند که
    مدل می‌خواهد: ۱۶ کیلوهرتز، ۸۰ بُعد Kaldi fbank (پیش‌فرض sherpa)؛
    جایگزینی با front-end دیگر (مثلاً slaney-mel) خطا را بالا می‌برد.
    این کلاس هرگز خودش کلمه نمی‌سازد؛ واج‌ها را به `feed_phonemes`
    می‌دهد که بدون نگاشت تأییدشده، خطا می‌دهد.

    قرارداد دیکد (مستند sherpa): `decode_stream` فقط وقتی مجاز است که
    `is_ready(stream)` درست باشد. دیکد روی چانک ناقص (کمتر از ~۶۱ فریم،
    یعنی کمتر از ~۰٫۶ ثانیه صدا) قرارداد را می‌شکند و در sherpa-onnx
    2.0.1 همان‌جا فرایند را می‌کشد (خروج ۲۵۵، بدون traceback)؛ به همین
    دلیل `feed`/`flush` پیش از دیکد، `is_ready` را چک می‌کنند و اگر
    آماده نبود، فقط قاب را می‌پذیرند و برمی‌گردند. نتیجه هم از API
    رسمی 2.0.1 خوانده می‌شود (`get_result_as_json_string` با فیلد
    `tokens`)، چون `OnlineStream` در این نسخه ویژگی `result` ندارد.
    """

    def __init__(self) -> None:
        try:
            import sherpa_onnx
        except ImportError as exc:  # pragma: no cover - محیط بدون مدل
            raise hifz_engines.EngineError(
                "sherpa_onnx_not_installed",
                "sherpa_onnx نصب نیست؛ موتور Zipformer پیکربندی نشده است.",
            ) from exc
        engine = hifz_engines.get_engine("zipformer")
        if not isinstance(engine, hifz_engines.ZipformerEngine):
            raise hifz_engines.EngineError(
                "engine_not_configured", "zipformer adapter is not a ZipformerEngine"
            )
        model_dir, reason = hifz_engines._model_dir(engine.env_var)
        if model_dir is None:
            raise hifz_engines.EngineError("engine_not_configured", reason)
        recognizer = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
            tokens=os.path.join(model_dir, "tokens.txt"),
            model=engine._onnx_path(model_dir),
        )
        self._stream = recognizer.create_stream()
        self._recognizer = recognizer
        self._seen_tokens = 0

    def _current_tokens(self) -> list[str]:
        """واج‌های تاکنون شناخته‌شده، از JSON نتیجهٔ رسمی sherpa 2.0.1."""
        try:
            data = json.loads(
                self._recognizer.get_result_as_json_string(self._stream)
            )
        except (ValueError, TypeError):
            logger.warning("hifz sherpa result json unreadable")
            return []
        tokens = data.get("tokens") if isinstance(data, dict) else None
        return list(tokens) if isinstance(tokens, list) else []

    def _decode_if_ready(self) -> bool:
        """اگر چانک کامل آماده است دیکد کن؛ در غیر این صورت هیچ‌کار نکن.

        True یعنی دیکد انجام شد و واج تازه ممکن است آمده باشد؛ False
        یعنی هنوز صدای کافی نرسیده و دیکد، قرارداد sherpa را می‌شکند.
        """
        if self._recognizer.is_ready(self._stream):
            self._recognizer.decode_stream(self._stream)
            return True
        return False

    def feed(self, pcm16: bytes) -> list[str]:
        """قاب صوتی Int16LE را بده، واج‌های تازه را بگیر."""
        count = len(pcm16) // 2
        samples = struct.unpack(f"<{count}h", pcm16[: count * 2])
        floats = [s / 32768.0 for s in samples]
        self._stream.accept_waveform(16000, floats)
        if not self._decode_if_ready():
            return []
        tokens = self._current_tokens()
        fresh = tokens[self._seen_tokens :]
        self._seen_tokens = len(tokens)
        return fresh

    def flush(self) -> list[str]:
        """پایان جریان: واج‌های باقی‌مانده را بگیر."""
        self._stream.input_finished()
        while self._decode_if_ready():
            pass
        tokens = self._current_tokens()
        fresh = tokens[self._seen_tokens :]
        self._seen_tokens = len(tokens)
        return fresh

    def warmup(self) -> float:
        """گرم‌کردن واقعی بازشناس: نیم ثانیه سکوت را بده و دیکد کن.

        مسیر بومی (accept_waveform + decode) پیش از نخستین قابِ
        واقعی یک بار تمرین می‌شود تا `engine_ready` یعنی واقعاً
        آماده، نه فقط ساخته‌شده. واجِ برگشتی (اگر بود) دور ریخته
        می‌شود — سکوت، کلمه نیست. برمی‌گرداند: میلی‌ثانیهٔ صرف‌شده.
        """
        import time

        started = time.perf_counter()
        silence = b"\x00\x00" * 8000  # ۰٫۵ ثانیه در ۱۶ کیلوهرتز
        self.feed(silence)
        return (time.perf_counter() - started) * 1000.0


def _live_pair(
    expected: str, heard: str, prob: float | None, green: float, amber: float
) -> tuple[str, float, str | None, bool]:
    """وضعیت زندهٔ یک جفت کلمه — دقیقاً همان منطق `alignment.emit_pair`.

    برمی‌گرداند: (وضعیت، احتمالِ مشتق‌شده، دلیل، needs_review).
    «نزدیک» در مرزِ بیشینهٔ فاصله (دقیقاً ۲ واج) یا تطابقِ دقیقِ
    حروف با احتمالِ پایینِ موتور، قطعی نیست و پرچمِ بازبینی می‌خورد؛
    احتمال‌ها مقدارهای مشتق‌شده از نوعِ تطابق‌اند، نه confidence
    کالیبره‌شده.
    """
    norm_exp = alignment.normalize_arabic_word(expected)
    norm_hrd = alignment.normalize_arabic_word(heard)
    if norm_exp == norm_hrd:
        if alignment.strip_diacritics(expected) == alignment.strip_diacritics(heard):
            if expected != heard:
                return "close", _PROB_CLOSE, "wrong_tashkeel", False
            p = _PROB_CORRECT if prob is None else max(0.0, min(1.0, float(prob)))
            if p >= green:
                return "correct", p, None, False
            return "close", p, None, True
        return "close", _PROB_CLOSE, "wrong_word", False
    dist = alignment.levenshtein(norm_exp, norm_hrd)
    if dist <= _NEAR_MISS_MAX_DISTANCE and len(norm_exp) > 3:
        return (
            "close",
            _PROB_CLOSE,
            "wrong_word",
            dist == _NEAR_MISS_MAX_DISTANCE,
        )
    return "wrong", _PROB_WRONG, "wrong_word", False


@dataclass
class LiveSession:
    """یک نشست خواندن زنده روی یک نشست حفاظِ ازپیش‌ساخته‌شده.

    `sender` هر رویداد را به بیرون می‌فرستد (WebSocket در محصول،
    فهرست در تست‌ها). در محصول، مسیر از `start_live_session` می‌گذرد
    که موتور واقعی را بررسی می‌کند و برای Zipformer، نگاشت را مطالبه
    می‌کند. تطابق، قطعه‌ای است (نه کلمه‌به‌کلمه): هر واحد، یک قطعهٔ
    واجی است که یک یا چند کلمه را می‌پوشاند؛ نشانهٔ وقف، واحدِ رد
    خودکار است (واج مصرف نمی‌کند).
    """

    db: AsyncSession
    attempt: HifzAttempt
    surah: int
    start_ayah: int
    green: float
    amber: float
    sender: Callable[[dict], None] | None
    mapping: PhonemeMapping | None = None
    # گزینهٔ ترتیل (ایراد ۱۴): «تا اصلاحِ خطا جلو نرو» — وقتی روشن
    # است، واحدِ «غلط» اشاره‌گر را نگه می‌دارد تا همان واحد درست
    # خوانده شود؛ اصلاح با رویدادِ correction همان خانه را درست
    # می‌کند. پیش‌فرض خاموش است (رفتارِ پیشین: علامت + ادامه).
    hold_on_wrong: bool = False
    _held: bool = False
    _basmala_cache: str | None = None

    # وضعیت داخلی — با اشاره‌گرِ یکنواخت روی کلمه‌های موردانتظار.
    _ayah: int = 0
    _index: int = 0
    _words: list[str] = field(default_factory=list)
    _units: list[Segment] | None = None
    _unit_pos: int = 0
    _exhausted: bool = False
    _ended: bool = False
    _phoneme_buffer: str = ""
    # شمارنده‌های جلسهٔ زنده — فقط تعداد، هرگز محتوا: برای اینکه
    # «هیچ کلمه‌ای نوشته نشد» از روی لاگ قابل تشخیص باشد (قاب رسید؟
    # واج برگشت؟ واج به کلمه تبدیل شد؟).
    _live_word_events: int = 0
    _live_skipped_events: int = 0
    # واج‌های دورریخته در هم‌ترازی دوباره — فقط تعداد، هرگز محتوا.
    _resync_dropped: int = 0
    # یافتنِ آیه: نشست با راهنما شروع می‌شود و تا لنگر نینداخته، در
    # حالتِ یافتن است؛ `_last_heard_ayah` آخرین آیهٔ شنیده‌شده است
    # (پنجرهٔ ۵آیه‌ایِ خاکستری از همان‌جا شمرده می‌شود) و
    # `_relocate_pending` یعنی اشاره‌گر بیش از ۵ آیه از آن جلو رفته
    # و یافتنِ دوباره لازم است.
    _locating: bool = False
    _last_heard_ayah: int = 0
    _relocate_pending: bool = False
    _located_count: int = 0
    # یافتنِ آیه ناموفق بود (بافر با هیچ آیه‌ای درونِ سوره نمی‌خواند):
    # کاربر چیزی می‌خواند که با سوره نمی‌خواند. تا وقتی این پرچم
    # بالاست، واحدِ بی‌تطابق «غلط» علامت می‌خورد (نه «جاافتاده») تا
    # اشاره‌گر بی‌مهار جلو نرود و آیه‌های نخوانده نوشته نشوند. با
    # نخستین تطابقِ درست/نزدیک، یا یافتنِ موفق، پایین می‌آید.
    _locate_failed: bool = False
    _assigned: dict = field(default_factory=dict)  # (ayah, idx) -> (heard, prob)
    # وضعیتِ فعلیِ هر خانه (برای تشخیصِ «بازخوانیِ اصلاحی» از
    # «تکرار» — ایراد ۱۴): خانه‌ای که غلط خورده و دوباره خوانده
    # می‌شود، اصلاح است نه تکرار.
    _cell_status: dict = field(default_factory=dict)  # (ayah, idx) -> status
    _touched_ayahs: list = field(default_factory=list)
    _extras: list = field(default_factory=list)
    _events: list = field(default_factory=list)
    # قرارداد نسخهٔ ۲ (فاز ۵): شماره‌گذاریِ یکنواخت رویدادها، ساعتِ
    # صوتیِ تجمعی، و ثبتِ شناسهٔ رویدادِ هر خانه برای اصلاحیه.
    _sequencer: LiveEventSequencer | None = None
    _audio_ms: int = 0
    _last_partial_key: tuple[int, int] | None = None
    _emitting_final: bool = False
    _emitted_event_ids: dict = field(default_factory=dict)  # (ayah, idx) -> event_id
    # فاز ۶ — دو اشاره‌گرِ جدا (§۱۴٫۱): اشاره‌گرِ قطعی، همان
    # `_unit_pos`/`_index` است (پایدار/نهایی)؛ اشاره‌گرِ گمانه‌ای
    # (پیش‌نمایشِ قابلِ rollback) فقط همین دو فیلد است: خانه‌ای که
    # `partial` برایش فرستاده شده و متنِ موردانتظارش. پیش‌نمایش
    # هرگز `_assigned`/`_touched_ayahs` را لمس نمی‌کند، اشاره‌گرِ
    # قطعی را جلو نمی‌برد و در `finish()` اثری ندارد؛ با اصلاحِ
    # فرضیه (بافر دیگر پیشوندِ آن واحد نیست) پس گرفته می‌شود
    # (رویدادِ `partial` با `retracted: true`).
    _preview_key: tuple[int, int] | None = None
    _preview_text: str = ""
    # شمارنده‌های دسته‌های فاز ۶ — فقط تعداد، هرگز محتوا.
    _repeat_events: int = 0
    _revisit_events: int = 0

    def __post_init__(self) -> None:
        # آخرین آیهٔ شنیده‌شده از آیهٔ شروع (راهنما) آغاز می‌شود.
        self._last_heard_ayah = self.start_ayah
        self._sequencer = LiveEventSequencer(session_id=str(self.attempt.id))

    def note_audio(self, samples: int) -> None:
        """زمانِ صوتیِ تجمعی را جلو ببر (۱۶ کیلوهرتز)."""
        self._audio_ms += int(samples * 1000 // 16000)

    def build_server_event(
        self, event_type: str, status: str = "ok", **fields
    ) -> dict:
        """رویدادِ سمت سرور (readiness/هشدار/پایان) با پاکت نسخهٔ ۲؛
        فقط می‌سازد و نمی‌فرستد (برای ارسالِ مستقیم روی سوکت)."""
        assert self._sequencer is not None
        return self._sequencer.envelope(
            event_type, status, audio_ts_ms=self._audio_ms, **fields
        )

    def emit_server_event(
        self, event_type: str, status: str = "ok", **fields
    ) -> dict:
        """رویدادِ سمت سرور با پاکت نسخهٔ ۲، از راهِ sender."""
        event = self.build_server_event(event_type, status, **fields)
        self._events.append(event)
        if self.sender is not None:
            self.sender(event)
        return event

    def _emit(self, event: dict) -> dict:
        """رویداد نشست را با پاکت نسخهٔ ۲ بفرست.

        هر رویداد `session_id`/`event_id`/`sequence_no`/`event_type`/
        `status`/`audio_ts_ms` می‌گیرد؛ `type` قدیمی می‌ماند تا
        کلاینت نسخهٔ ۱ بی‌سروصدا نشکند. کلمه‌ها `confidence` هم
        دارند. برمی‌گرداند: رویدادِ پاکت‌دارِ فرستاده‌شده.
        """
        assert self._sequencer is not None
        raw_type = str(event.get("type", ""))
        if raw_type == "word":
            word_status = str(event.get("status", "ok"))
            if self._emitting_final:
                event_type = "final_word"
            else:
                event_type = EVENT_TYPE_BY_WORD_STATUS.get(
                    word_status, "stable_word"
                )
            status = word_status
        else:
            event_type = raw_type
            status = str(event.get("status", "ok"))
        fields = {
            k: v for k, v in event.items() if k not in ("type", "status")
        }
        if raw_type == "word":
            fields["confidence"] = event.get("prob")
        # هر خروجیِ confidence وضعیتِ provisional/stable/final را
        # همراهش دارد؛ partial اصلاً confidence ندارد (prob جعلی از
        # واج ساخته نمی‌شود).
        finality = _FINALITY_BY_EVENT_TYPE.get(event_type)
        if finality is not None:
            fields["finality"] = finality
        enveloped = self._sequencer.envelope(
            event_type, status, audio_ts_ms=self._audio_ms, **fields
        )
        self._events.append(enveloped)
        if self.sender is not None:
            self.sender(enveloped)
        return enveloped

    def _touch(self, ayah: int) -> None:
        if ayah not in self._touched_ayahs:
            self._touched_ayahs.append(ayah)

    async def _load_ayah(self, ayah: int) -> list[str]:
        return await hifz_service._ayah_words(self.db, self.surah, ayah)

    async def _advance_ayah(self) -> bool:
        """به آیهٔ بعد برو؛ False یعنی سوره تمام شد."""
        meta = quran_service.get_surah(self.surah)
        if self._ayah >= meta.ayahs:
            self._exhausted = True
            return False
        self._ayah += 1
        self._words = await self._load_ayah(self._ayah)
        self._index = 0
        self._units = None
        self._unit_pos = 0
        # پیشرفت نشست: هر ورود به آیهٔ تازه، رویداد progress می‌آید
        # (کلاینت با آن، موقعیت و شمارنده‌ها را همگام نگه می‌دارد).
        self._emit(
            {
                "type": "progress",
                "surah": self.surah,
                "ayah": self._ayah,
                "words": self._live_word_events,
                "skipped": self._live_skipped_events,
            }
        )
        # قانونِ خاکستریِ ≤۵ آیه: اگر اشاره‌گر بیش از ۵ آیه از آخرین
        # کلمهٔ شنیده‌شده جلو رفته، یافتنِ دوباره لازم است — نه
        # خاکستریِ بیشتر. پرچم را بگذار تا feed_phonemes روی بافرِ
        # جاری یافتن را امتحان کند؛ آیه‌های ردشده تا این‌جا (≤۵)
        # خاکستری مانده‌اند و آیه‌های بعد از آن هرگز لمس نمی‌شوند.
        if (
            self._last_heard_ayah
            and self._ayah - self._last_heard_ayah > _MAX_GRAY_AYAH_GAP
        ):
            self._relocate_pending = True
        return True

    async def _load_units(self, ayah: int) -> list[Segment]:
        """قطعه‌های یک آیه از نگاشت؛ آیهٔ پذیرفته‌نشده خطای صادقانه است.

        رشتهٔ واجیِ هر قطعه پیش از تطابق فروپاشیده می‌شود (کششِ مد
        به یک نمونه) تا شمارِ مدِ نگاشت با شمارِ شنیده‌شده فرق نکند؛
        بافرِ شنیده‌شده هم در `feed_phonemes` همان‌طور فروپاشیده
        می‌شود، پس هر دو سو در یک فضا مقایسه می‌شوند.
        """
        if self.mapping is None:
            raise MappingPendingError()
        segs = self.mapping.segments_for(self.surah, ayah)
        if segs is None:
            raise APIError(
                503,
                "hifz_mapping_ayah_unavailable",
                f"تراز واجی آیهٔ {self.surah}:{ayah} پذیرفته نشده است؛ "
                "نمرهٔ زنده برای این آیه در دسترس نیست.",
            )
        return [
            Segment(
                word_indices=s.word_indices,
                phoneme=(
                    collapse_phoneme_runs(s.phoneme)
                    if s.phoneme is not None
                    else None
                ),
                leading_waslah=s.leading_waslah,
            )
            for s in segs
        ]

    async def _ensure_units(self) -> None:
        if self._units is None:
            self._units = await self._load_units(self._ayah)
            self._unit_pos = 0

    async def _ensure_position(self) -> bool:
        """اشاره‌گر را روی یک کلمهٔ موردانتظار معتبر بگذار."""
        if self._exhausted:
            return False
        if self.mapping is not None:
            await self._ensure_units()
            assert self._units is not None
            if self._unit_pos < len(self._units):
                return True
            return await self._advance_ayah()
        if self._index < len(self._words):
            return True
        return await self._advance_ayah()

    def _current(self) -> str | None:
        if self._index < len(self._words):
            return self._words[self._index]
        return None

    def live_counts(self) -> dict[str, int]:
        """شمارنده‌های جلسهٔ زنده — فقط تعداد، هرگز محتوا."""
        return {
            "words": self._live_word_events,
            "skipped": self._live_skipped_events,
            "buffer_chars": len(self._phoneme_buffer),
            "resync_dropped": self._resync_dropped,
            "located": self._located_count,
            "repeats": self._repeat_events,
            "revisits": self._revisit_events,
        }

    def _emit_word(
        self, ayah: int, index: int, expected: str, status: str,
        prob: float, heard: str | None, reason: str | None = None,
        needs_review: bool = False,
    ) -> None:
        """یک کلمه را بنویس — یا اگر همان خانه پیش‌تر نوشته شده،
        اصلاحیه بفرست (همان خانه به‌روز می‌شود، تکراری نمی‌ماند).

        الحاق کورکورانه ممنوع است: هر خانهٔ (ayah, word_index) فقط
        یک رویدادِ کلمه دارد؛ تصمیمِ بعدی برای همان خانه، رویداد
        `correction` است که `corrects_event_id` آن را می‌گوید.
        """
        key = (ayah, index)
        self._cell_status[key] = status
        if key in self._emitted_event_ids:
            self._assigned[key] = (heard, prob)
            self._touch(ayah)
            correction: dict = {
                "type": "correction",
                "surah": self.surah,
                "ayah": ayah,
                "word_index": index,
                "expected": expected,
                "status": status,
                "prob": prob,
                "heard": heard,
                "corrects_event_id": self._emitted_event_ids[key],
            }
            if reason is not None:
                correction["reason"] = reason
            if needs_review:
                correction["needs_review"] = True
            self._emit(correction)
            return
        if status == "skipped":
            self._live_skipped_events += 1
        else:
            self._live_word_events += 1
            # آخرین آیهٔ شنیده‌شده: پنجرهٔ ۵آیه‌ایِ خاکستری از این‌جا
            # شمرده می‌شود.
            self._last_heard_ayah = ayah
            if status in ("correct", "close"):
                # تطابقِ موفق: نشست دوباره سرِ جایش است؛ پرچمِ
                # یافتنِ ناموفق پایین می‌آید.
                self._locate_failed = False
        self._touch(ayah)
        self._assigned[key] = (heard, prob)
        enveloped = self._emit(
            LiveWord(
                self.surah, ayah, index, expected, status, prob, heard,
                reason, needs_review,
            ).event()
        )
        self._emitted_event_ids[key] = enveloped["event_id"]

    async def _emit_skipped_to(self, ayah: int, index: int) -> None:
        """همهٔ کلمه‌های جاافتاده تا نقطهٔ داده‌شده را خاکستری بنویس."""
        while (self._ayah, self._index) != (ayah, index):
            expected = self._current()
            if expected is None:
                if not await self._advance_ayah():
                    return
                continue
            self._emit_word(self._ayah, self._index, expected, "skipped", 0.0, None)
            self._index += 1

    async def feed_words(self, words: list[StreamWord]) -> None:
        """کلمه‌های شناخته‌شده (بازشناس سطح کلمه یا ماک) را بنویس."""
        for heard_word in words:
            if not await self._ensure_position():
                self._extras.append(heard_word.text)
                self._emit({"type": "extra", "text": heard_word.text})
                continue
            expected = self._current()
            assert expected is not None
            norm_exp = alignment.normalize_arabic_word(expected)
            norm_hrd = alignment.normalize_arabic_word(heard_word.text)
            if norm_exp == norm_hrd or (
                alignment.levenshtein(norm_exp, norm_hrd)
                <= _NEAR_MISS_MAX_DISTANCE
                and len(norm_exp) > 3
            ):
                status, prob, reason, needs_review = _live_pair(
                    expected, heard_word.text, heard_word.prob, self.green, self.amber
                )
                self._emit_word(
                    self._ayah, self._index, expected, status, prob, heard_word.text,
                    reason, needs_review,
                )
                self._index += 1
                continue
            # جست‌وجوی جلو: شاید کلمه‌هایی جا افتاده باشند.
            found = await self._find_ahead(norm_hrd)
            if found is None:
                self._extras.append(heard_word.text)
                self._emit({"type": "extra", "text": heard_word.text})
                continue
            await self._emit_skipped_to(found[0], found[1])
            expected = self._current()
            assert expected is not None
            status, prob, reason, needs_review = _live_pair(
                expected, heard_word.text, heard_word.prob, self.green, self.amber
            )
            self._emit_word(
                self._ayah, self._index, expected, status, prob, heard_word.text,
                reason, needs_review,
            )
            self._index += 1

    async def _find_ahead(
        self, norm_heard: str
    ) -> tuple[int, int] | None:
        """نزدیک‌ترین کلمهٔ موردانتظارِ بعدیِ مطابق را پیدا کن (حداکثر ۴۰)."""
        ayah, index, words = self._ayah, self._index, self._words
        for _ in range(_LIVE_LOOKAHEAD):
            index += 1
            if index >= len(words):
                meta = quran_service.get_surah(self.surah)
                if ayah >= meta.ayahs:
                    return None
                ayah += 1
                try:
                    words = await self._load_ayah(ayah)
                except APIError:
                    return None
                index = 0
            if index >= len(words):
                continue
            norm_exp = alignment.normalize_arabic_word(words[index])
            if norm_exp == norm_heard or (
                alignment.levenshtein(norm_exp, norm_heard)
                <= _NEAR_MISS_MAX_DISTANCE
                and len(norm_exp) > 3
            ):
                return (ayah, index)
        return None

    def _emit_spanned_pauses_before(self, word_index: int) -> None:
        """ردِ وقف‌هایِ درونِ بازهٔ قطعهٔ جاری را پیش از کلمهٔ بعد
        صادر کن (ترتیبِ رویداد).

        قطعهٔ ادغامی می‌تواند روی نشانهٔ وقف بیفتد (مثلاً
        word_indices (10, 12) روی وقفِ 11): واحدِ ردِ وقف در
        فهرستِ قطعه‌ها پس از آن می‌آید، پس حلقه اول کلمهٔ بعدِ وقف
        را می‌فرستاد و بعد خودِ وقف را (…، 10، 12، 11-ردشده، 13، …).
        نمره درست بود و هر رویداد `word_index` دارد، ولی ترتیبِ خامِ
        رویدادها جابه‌جا می‌شد. پیش از صدورِ هر کلمه، وقف‌هایِ
        ردِ‌نشده‌ای که شماره‌شان از آن کلمه کوچک‌تر است و واحدشان
        جلوتر در فهرست است، خاکستری صادر می‌شوند؛ حلقه وقتی به آن
        واحدها می‌رسد، چون کلمه‌شان صادر شده، دوباره نمی‌فرستد.
        فقط واحدهای بدونِ واج (ردِ خودکارِ وقف) دربر گرفته
        می‌شوند؛ ترتیبِ واحدهای واقعی دست نمی‌خورد.
        """
        if self._units is None:
            return
        for j in range(self._unit_pos + 1, len(self._units)):
            unit = self._units[j]
            if unit.phoneme is not None:
                continue
            for pwi in unit.word_indices:
                if pwi < word_index and (
                    self._ayah, pwi
                ) not in self._emitted_event_ids:
                    expected = (
                        self._words[pwi] if pwi < len(self._words) else ""
                    )
                    self._emit_word(
                        self._ayah, pwi, expected, "skipped", 0.0, None
                    )

    def _emit_unit(
        self, word_indices: tuple[int, ...], status: str, prob: float,
        heard: str | None = None, distance: int | None = None,
    ) -> None:
        """همهٔ کلمه‌های یک قطعه را با یک وضعیت ثبت کن و اشاره‌گر را جلو ببر.

        `heard` فقط برای وضعیتِ «غلط» داده می‌شود (تکهٔ واجیِ
        شنیده‌شده)؛ برای درست/نزدیک، شنیده‌شده همان متنِ موردانتظار
        است و برای جاافتاده/ردِ خودکار، None. `distance` فاصلهٔ
        ویرایشِ تطابقِ نزدیک است؛ «نزدیک» در مرزِ بیشینهٔ فاصله،
        پرچمِ needs_review می‌خورد. وقفِ درونِ بازهٔ قطعه پیش از
        کلمهٔ بعدش صادر می‌شود (`_emit_spanned_pauses_before`).
        """
        needs_review = (
            status == "close" and distance == _NEAR_MISS_MAX_DISTANCE
        )
        for wi in word_indices:
            self._emit_spanned_pauses_before(wi)
            expected = self._words[wi] if wi < len(self._words) else ""
            if heard is not None:
                h: str | None = heard
            else:
                h = expected if status in ("correct", "close") else None
            reason = "wrong_word" if status in ("close", "wrong") else None
            self._emit_word(
                self._ayah, wi, expected, status, prob, h, reason,
                needs_review,
            )
        if status == "wrong" and self.hold_on_wrong:
            # «تا اصلاحِ خطا جلو نرو» (ایراد ۱۴): اشاره‌گر روی همین
            # واحد می‌ایستد (جلو نمی‌رود) تا درست خوانده شود؛
            # `_try_release_hold` در حلقه، اصلاح را با همان خانه
            # (رویدادِ correction) ثبت می‌کند.
            self._held = True
            return
        if word_indices:
            self._index = max(word_indices) + 1
        self._unit_pos += 1

    def _next_unit_phon(self) -> str | None:
        """رشتهٔ واجیِ نزدیک‌ترین واحدِ واقعیِ بعد (ردِ وقف را رد کن).

        اگر واحدِ جاری آخرینِ آیه باشد، واحدِ بعد سرِ آیهٔ بعد است؛
        پس قطعه‌های آیهٔ بعد را هم (بی‌جلو بردنِ نشست) نگاه می‌کند.
        رشتهٔ آیهٔ بعد هم مثل `_load_units` فروپاشیده می‌شود.
        """
        if self._units is None:
            return None
        for j in range(self._unit_pos + 1, len(self._units)):
            phon = self._units[j].phoneme
            if phon is not None:
                return phon
        if self.mapping is None:
            return None
        nxt_segs = self.mapping.segments_for(self.surah, self._ayah + 1)
        if not nxt_segs:
            return None
        for seg in nxt_segs:
            if seg.phoneme is not None:
                return collapse_phoneme_runs(seg.phoneme)
        return None

    def _anchor_close(self, buf: str, phon: str) -> int | None:
        """موضعِ مصرفِ کلمهٔ نزدیک را روی شروعِ واحدِ بعد لنگر کن.

        نزدیک‌ترین موضع به len(phon) (در بازهٔ ±۲) که واحدِ بعد
        دقیقاً از آنجا شروع می‌شود را برمی‌گرداند؛ اگر واحدِ بعدی
        نباشد یا در بافر پیدا نشد، None. همزهٔ وصلِ اولِ واحدِ بعد
        (ء + حرکت) هم به‌عنوانِ شکلِ وصل در نظر گرفته می‌شود، چون
        در خواندنِ پیوسته خوانده نمی‌شود.
        """
        nxt = self._next_unit_phon()
        if nxt is None:
            return None
        forms = [nxt]
        if nxt.startswith("ء"):
            rest = nxt[1:]
            if rest and 0x064B <= ord(rest[0]) <= 0x0652:
                rest = rest[1:]
            if rest:
                forms.append(rest)
        for c in (
            len(phon),
            len(phon) - 1,
            len(phon) + 1,
            len(phon) - 2,
            len(phon) + 2,
        ):
            if c < 1 or c > len(buf):
                continue
            for form in forms:
                if buf[c:].startswith(form):
                    return c
        return None

    def _following_unit_forms(self, unit_pos: int) -> list[str] | None:
        """شکل‌های واجیِ واحدِ بعد از `unit_pos` (وصلِ همزه هم هست).

        واحدِ بعد، نزدیک‌ترین واحدِ واقعیِ بعد در همین آیه است؛ اگر
        واحدِ جاری آخرینِ آیه باشد، سرِ آیهٔ بعد. None یعنی واحدِ
        بعدی نیست (تهِ سوره) یا معلوم نیست (آیهٔ بعد نگاشت ندارد) —
        در هر دو حالت، تطابقِ تک‌واحدی به‌تنهایی می‌ایستد.
        """
        if self._units is None:
            return None
        for j in range(unit_pos + 1, len(self._units)):
            phon = self._units[j].phoneme
            if phon is not None:
                return _waslah_forms(phon)
        if self.mapping is None:
            return None
        nxt_segs = self.mapping.segments_for(self.surah, self._ayah + 1)
        if not nxt_segs:
            return None
        for seg in nxt_segs:
            if seg.phoneme is not None:
                return _waslah_forms(collapse_phoneme_runs(seg.phoneme))
        return None

    def _confirm_following(self, rest: str, unit_pos: int) -> bool | None:
        """آیا بقیهٔ بافر با واحدِ بعد از `unit_pos` می‌خواند؟

        True: بقیه با واحدِ بعد می‌خواند (دقیق، پیشوند، یا نزدیکِ
        ≤۲) — تطابقِ واحدِ جاری تأیید می‌شود. False: بقیه به‌اندازهٔ
        کافی بلند است و نمی‌خواند — تطابقِ تک‌واحدی تصادفی بود (مثل
        کلمهٔ مشترکِ دو سوره: «اللَّهِ» فاتحه با «اللَّهِ» ۲۴:۲).
        None: بقیه خالی یا کوتاه‌تر از ۲ حرف است — هنوز صدای کافی
        برای قضاوت نرسیده؛ صبر کن، نه اینکه رد کنی.
        """
        forms = self._following_unit_forms(unit_pos)
        if forms is None:
            return True
        if len(rest) < 2:
            return None
        for form in forms:
            if rest.startswith(form) or form.startswith(rest):
                return True
            if (
                len(rest) >= len(form)
                and len(form) > 3
                and alignment.levenshtein(rest[: len(form)], form)
                <= _NEAR_MISS_MAX_DISTANCE
            ):
                return True
        return False

    def _find_ahead_unit(self, buf: str) -> int | None:
        """نزدیک‌ترین واحد بعدیِ مطابق با ابتدای بافر (حداکثر ۴۰ واحد)."""
        if self._units is None:
            return None
        for j in range(
            self._unit_pos + 1,
            min(len(self._units), self._unit_pos + 1 + _LIVE_LOOKAHEAD),
        ):
            phon = self._units[j].phoneme
            if phon is not None and buf.startswith(phon):
                return j
        return None

    async def _jump_to(self, ayah: int, unit_pos: int) -> None:
        """پرش به آیه/واحدِ یافته‌شده؛ آیه‌های بینِ راه خاکستری نمی‌شوند.

        فقط آیهٔ مقصد لمس می‌شود؛ آیه‌های ردشده (بیش از ۵ آیه) نه
        خاکستری می‌شوند و نه ذخیره — نشست از نو می‌یابد و از همان‌جا
        ادامه می‌دهد. آیهٔ مبدأ که هیچ کلمه‌ای برایش ثبت نشده،
        «لمس‌شده» نمی‌ماند: کاربر اصلاً از آن‌جا شروع نکرده، پس
        جاافتاده هم ثبت نمی‌شود.
        پرشِ درون‌آیه‌ای به واحدِ جلوتر (مثلاً یافتنِ آغازِ خواندن
        پس از بسمله) فرق می‌کند: واحدهای ردشدهٔ همان آیه هرگز
        خوانده نشده‌اند و در `finish()` جاافتاده ذخیره می‌شوند، پس
        زنده هم خاکستری می‌شوند تا دیوارِ زنده با نمرهٔ ذخیره
        بخواند. پرش به آیهٔ دیگر، طبقِ قانونِ کاربر خاکستری نمی‌شود.
        """
        from_ayah = self._ayah
        if (
            ayah == from_ayah
            and self._units is not None
            and unit_pos > self._unit_pos
        ):
            while self._unit_pos < unit_pos:
                self._emit_unit(
                    self._units[self._unit_pos].word_indices, "skipped", 0.0
                )
        self._ayah = ayah
        self._words = await self._load_ayah(ayah)
        self._units = None
        self._unit_pos = 0
        await self._ensure_units()
        assert self._units is not None
        self._unit_pos = min(unit_pos, max(len(self._units) - 1, 0))
        unit = self._units[self._unit_pos]
        self._index = min(unit.word_indices) if unit.word_indices else 0
        self._last_heard_ayah = ayah
        self._located_count += 1
        if from_ayah != ayah and not any(
            a == from_ayah for (a, _i) in self._assigned
        ):
            self._touched_ayahs = [a for a in self._touched_ayahs if a != from_ayah]
        self._touch(ayah)
        self._emit({"type": "located", "surah": self.surah, "ayah": ayah})

    async def _try_anchor_or_locate(self) -> bool:
        """لنگرِ سریع یا یافتنِ آیه؛ True یعنی به حلقهٔ اصلی برو.

        - بافر با واحدِ جاری (یا شکلِ وصل/نزدیکِ آن) بخواند → لنگرِ
          فوری، بی‌تأخیر (حالتِ رایج: کاربر همان آیهٔ انتخاب‌شده را
          می‌خواند).
        - بافر کوتاه‌تر از آستانه باشد → False (منتظر واجِ بیشتر
          بمان؛ بافر مصرف نمی‌شود).
        - وگرنه یافتن را روی بافر اجرا کن: آیه پیدا شد → پرش
          (رویداد `located`)؛ پیدا نشد → روی همان آیهٔ راهنما بمان
          (رفتارِ پیشین) و دیگر منتظر نمان.
        """
        buf = self._phoneme_buffer
        if not buf:
            return False
        if self._locating and self.start_ayah != 1:
            # بسملهٔ آغازِ نشست جزو آیهٔ انتخابی نیست (ایراد ۱۴):
            # مصرفش کن تا لنگرِ سریع روی واحدِ اولِ همان آیه
            # بنشیند، نه اینکه یافتن با کاوشِ بسمله‌دار به آیهٔ ۱
            # پرتاب شود. (آیهٔ ۱ مستثناست: بسمله آن‌جا خودِ متن
            # است و قطعه‌اش در نگاشت هست.)
            basmala = self._session_basmala()
            if basmala and buf.startswith(basmala):
                self._phoneme_buffer = buf[len(basmala):]
                self._resync_dropped += len(basmala)
                buf = self._phoneme_buffer
                if not buf:
                    return False
        await self._ensure_units()
        assert self._units is not None
        phon = None
        waslah = False
        for j in range(self._unit_pos, len(self._units)):
            p = self._units[j].phoneme
            if p is not None:
                phon = p
                waslah = self._units[j].leading_waslah
                break
        if phon is not None:
            if buf.startswith(phon) or phon.startswith(buf):
                self._locating = False
                self._relocate_pending = False
                return True
            if waslah and phon.startswith("ء"):
                stripped = phon[1:]
                if stripped and 0x064B <= ord(stripped[0]) <= 0x0652:
                    stripped = stripped[1:]
                if stripped and (
                    buf.startswith(stripped) or stripped.startswith(buf)
                ):
                    self._locating = False
                    self._relocate_pending = False
                    return True
            if (
                len(buf) >= len(phon)
                and len(phon) > 3
                and alignment.levenshtein(buf[: len(phon)], phon)
                <= _NEAR_MISS_MAX_DISTANCE
            ):
                self._locating = False
                self._relocate_pending = False
                return True
        basmala = self._session_basmala()
        if basmala and len(buf) <= len(basmala) and basmala.startswith(buf):
            # بسمله هنوز در حال گفته‌شدن است (بافر پیشوندِ بسمله
            # است): یافتن روی بسملهٔ ناتمام «یافتنِ ناموفق» و
            # آبشارِ غلط می‌سازد — بسملهٔ این نگاشت ۲۶ حرف است و
            # کفِ یافتن ۲۴، پس واج‌ها دقیقاً وسطِ بسمله به کف
            # می‌رسند (راستی‌آزمایی با صدای واقعی مالک، اعراف ۱۲).
            return False
        if len(buf) < _LOCATE_MIN_CHARS:
            return False
        # یافتن: در شروعِ نشست هر آیه‌ای مجاز است؛ در یافتنِ دوبارهٔ
        # وسطِ نشست فقط آیه‌های جلوتر از اشاره‌گرِ جاری.
        if self._locating:
            found = locate_ayah(
                self.mapping, self.surah, buf,
                hint_ayah=self.start_ayah, allow_backward=True,
            )
        else:
            found = locate_ayah(
                self.mapping, self.surah, buf,
                hint_ayah=self._ayah, allow_backward=False,
            )
        if found is not None:
            ayah, unit_pos = found
            if ayah != self._ayah or unit_pos != self._unit_pos:
                await self._jump_to(ayah, unit_pos)
            self._locating = False
            self._relocate_pending = False
            self._locate_failed = False
            return True
        # پیدا نشد: روی همان آیه بمان و دیگر منتظر نمان. یافتن
        # ناموفق بود، پس واحدِ بی‌تطابق از این پس «غلط» می‌خورد،
        # نه «جاافتاده» — تا اشاره‌گر بی‌مهار جلو نرود.
        self._locating = False
        self._relocate_pending = False
        self._locate_failed = True
        return True

    def _session_basmala(self) -> str:
        """رشتهٔ واجیِ بسمله از نگاشتِ همین نشست (کش‌شده)."""
        if self._basmala_cache is None:
            self._basmala_cache = _basmala_phoneme_string(self.mapping)
        return self._basmala_cache

    async def feed_phonemes(self, phonemes: list[str]) -> None:
        """واج‌های Zipformer را با نگاشت قطعه‌ای به کلمه تبدیل کن.

        بدون نگاشت، این تابع هرگز کلمه تولید نمی‌کند — خطا می‌دهد.
        تطابق روی رشتهٔ واجی است: توکن‌های بازشناس به هم چسبانده
        می‌شوند و با رشتهٔ واجیِ واحد جاری مقایسه می‌شوند. واحد کامل
        در ابتدای بافر → «درست» (۰٫۹۵)؛ تفاوت اندک (لوونشتاین ≤ ۲ و
        طول > ۳) → «نزدیک» (۰٫۶۵)، ولی مصرفِ آن روی شروعِ واحدِ بعد
        لنگر می‌شود تا جابه‌جاییِ یک‌حرفیِ مرزِ کلمه (همخوانِ مشترک،
        حرکتِ پایانیِ وصل) به کلمه‌های بعد سرایت نکند. وقتی بافر با واحدی جلوتر بخواند،
        واحدهای بین‌شان «جاافتاده» می‌شوند (gray) و خواندن ادامه
        می‌یابد. واحدِ رد خودکار (نشانهٔ وقف) واج مصرف نمی‌کند.
        وقتی بافر دست‌کم دو برابرِ طولِ موردانتظار شده و با هیچ
        واحدی (جاری، نزدیک، جلوتر) نمی‌خواند و هم‌ترازیِ دوباره هم
        نشد (قانونِ فاز ۶، اصلاحِ عیبِ سورهٔ ۲۴): «جاافتاده» فقط با
        مدرکِ مثبتِ جلو رفتن صادر می‌شود — یافتنِ روبه‌جلو روی بافر
        باید آیه‌ای جلوتر را ثابت کند (۲۴ حرف، یا تمامِ آیهٔ کوتاه)؛
        اگر بافر برای یافتن کوتاه است، تصمیم نمی‌گیریم و منتظرِ واجِ
        بیشتر می‌مانیم؛ اگر یافتنِ روبه‌جلو نشد و بافر با آیه‌ای
        پیش‌تر می‌خواند، آن برگشت است (گزارش + مصرف، بی‌علامت)؛
        وگرنه واحد جاری «غلط» (قرمز) علامت می‌خورد و یک طولِ کلمهٔ
        موردانتظار از بافر مصرف می‌شود — رفتارِ پرمیوم (علامتِ خطا
        + ادامه، نه یخ‌زدن) و همان منطقِ مسیرِ ضبطی. اشاره‌گر هرگز
        بدونِ مصرفِ واجِ شنیده‌شده جلو نمی‌رود، پس آیه‌های نخوانده
        هرگز نوشته نمی‌شوند.
        شنیده‌شدهٔ درست/نزدیک، همان متن موردانتظار است — نه حدسِ
        بازشناس. هم‌ترازی دوباره: اگر سرِ بافر با هیچ واحدی
        نمی‌خواند، واج‌های اول یکی‌یکی کنار گذاشته می‌شوند تا ادامهٔ
        بافر با واحد جاری یا واحدی جلوتر بخواند؛ واج‌های دورریخته
        فقط شمرده می‌شوند (resync_dropped)، نه ثبت. اگر هیچ
        هم‌ترازی‌ای پیدا نشد، بافر دست‌نخورده می‌ماند و منطق قبلی
        (رد واحد / انتظار) کار می‌کند.
        """
        if self.mapping is None:
            raise MappingPendingError()
        self._phoneme_buffer = collapse_phoneme_runs(
            self._phoneme_buffer
            + "".join(t for t in phonemes if t != "<blank>")
        )
        await self._feed_phonemes_loop()
        # پیش‌نمایشِ کهنه (فرضیه‌ای که بافر دیگر آن را تأیید نمی‌کند)
        # پس گرفته می‌شود، بعد — اگر بافر هنوز پیشوندِ واحدِ جاری
        # است — پیش‌نمایشِ تازه فرستاده می‌شود.
        self._retract_preview_if_stale()
        # اگر بافر، پیشوندِ واحدِ جاری است (کاربر وسط کلمه است)،
        # رویداد جزئی بفرست — نه کلمهٔ نوشته‌شده، فقط نشانهٔ زنده.
        self._emit_partial_if_waiting()

    def _retract_preview_if_stale(self) -> None:
        """پیش‌نمایشِ کهنه را پس بگیر (فاز ۶، §۱۴٫۱).

        پیش‌نمایش فقط تا وقتی معتبر است که واحدِ جاری همان واحدِ
        پیش‌نمایش‌شده باشد و بافر هنوز پیشوندِ دقیقِ آن باشد. اگر
        واحد صادر شده باشد (در `_assigned` است)، رویدادِ کلمهٔ
        پایدار خودش به کلاینت گفته است و چیزی فرستاده نمی‌شود؛
        وگرنه رویدادِ `partial` با `retracted: true` می‌آید تا UI
        پیش‌نمایش را rollback کند. پیش‌نمایش هرگز روی `_assigned`
        یا شمارنده‌ها اثر نمی‌گذارد.
        """
        key = self._preview_key
        if key is None:
            return
        self._preview_key = None
        text = self._preview_text
        self._preview_text = ""
        if key in self._assigned:
            return
        stale = True
        if (
            not self._exhausted
            and self._units is not None
            and self._unit_pos < len(self._units)
        ):
            unit = self._units[self._unit_pos]
            first = (
                unit.word_indices[0] if unit.word_indices else self._index
            )
            phon = unit.phoneme
            buf = self._phoneme_buffer
            stale = not (
                (self._ayah, first) == key
                and phon is not None
                and 2 <= len(buf) < len(phon)
                and phon.startswith(buf)
            )
        if stale:
            self._emit(
                {
                    "type": "partial",
                    "status": "retracted",
                    "surah": self.surah,
                    "ayah": key[0],
                    "word_index": key[1],
                    "expected": text,
                    "heard": None,
                    "retracted": True,
                }
            )

    def _find_repeat_unit(self, buf: str) -> tuple[int, int] | None:
        """واحدِ پیش‌تر صادرشده‌ای که بافر با آن شروع می‌شود (تکرار).

        کاربر کلمه‌ای را که خوانده دوباره می‌خواند: سرِ بافر دقیقاً
        رشتهٔ واجیِ واحدی است که کلمه‌هایش در `_assigned` هستند.
        برمی‌گرداند: (موضعِ واحد، طولِ واجی‌اش) — بلندترین تطابق
        برنده است (در تساوی، نزدیک‌ترین). None یعنی تکرار نیست.
        فقط همان آیه جست‌وجو می‌شود؛ برگشت به آیهٔ پیش‌تر،
        `revisit` جداست (در شاخهٔ ۲برابر، پایین).
        """
        if self._units is None:
            return None
        best: tuple[int, int] | None = None
        for j in range(self._unit_pos):
            unit = self._units[j]
            phon = unit.phoneme
            if phon is None or len(phon) < 3:
                # واحدِ ۱–۲حرفی برای ادعای تکرار کوتاه است: پیشوندِ
                # تصادفیِ بافر با آن، مدرکِ بازخوانی نیست.
                continue
            if not all(
                (self._ayah, wi) in self._assigned for wi in unit.word_indices
            ):
                continue
            # شکلِ وصل هم آزموده می‌شود (فاز ۹): کلمه‌ای که در خواندنِ
            # پیوسته تکرار می‌شود، همزهٔ وصلِ آغازینش خوانده نمی‌شود
            # (مثل «ءَررَحمَانِ» که «ررَحمَانِ» شنیده می‌شود)؛ بدونِ
            # این شکل، تکرارِ همان کلمه از چشم می‌افتد.
            for form in _waslah_forms(phon):
                if len(form) < 3:
                    continue
                if buf.startswith(form) and (best is None or len(form) >= best[1]):
                    best = (j, len(form))
        return best

    def _ayah_phoneme_string(self, ayah: int, waslah: bool = False) -> str | None:
        """رشتهٔ واجیِ کاملِ یک آیه از نگاشت (فروپاشیده).

        `waslah=True` یعنی شکلِ پیوسته (بی‌همزهٔ وصلِ آغازین)؛
        None یعنی آیه در نگاشت نیست (از ۵۱ آیهٔ بی‌نگاشت).
        """
        if self.mapping is None:
            return None
        segs = self.mapping.segments_for(self.surah, ayah)
        if not segs:
            return None
        s = "".join(
            collapse_phoneme_runs(x.phoneme) for x in segs if x.phoneme is not None
        )
        if not s:
            return None
        if waslah:
            return _waslah_forms(s)[-1]
        return s

    def _revisit_run_string(
        self, start_ayah: int, first_form: str, current_part: str
    ) -> str | None:
        """رشتهٔ بازخوانی از آیهٔ `start_ayah` تا آیهٔ جاری (فاز ۹).

        آیهٔ آغازین با شکلِ داده‌شده (ساده یا وصل) می‌آید؛ آیه‌های
        میانی فقط شکلِ وصل دارند (خواندنِ پیوسته)؛ بخشِ آیهٔ جاری
        فقط تا جایی است که پیش‌تر خوانده شده (واحدهای صادرشده +
        پیشوندِ واحدِ جاری) — بیشتر از آن، ادامهٔ واقعی است، نه
        بازخوانی، و نباید در رشتهٔ بازخوانی باشد. آیهٔ میانیِ
        بی‌نگاشت، رشته را ناممکن می‌کند (None).
        """
        parts = [first_form]
        for ayah in range(start_ayah + 1, self._ayah):
            s = self._ayah_phoneme_string(ayah, waslah=True)
            if s is None:
                return None
            parts.append(s)
        if current_part:
            parts.append(_waslah_forms(current_part)[-1])
        return "".join(parts)

    def _find_revisit_span(self, buf: str, phon: str) -> tuple[int, int, int, int] | None:
        """بازخوانیِ آیهٔ پیش‌تر در بافر (فاز ۹) — برمی‌گرداند
        `(d, k, ayah, first_len)` یا None.

        `d` طولِ «اتصال» است: پیشوندِ مصرف‌نشدهٔ واحدِ جاری که سرِ
        بافر مانده (پس `buf[:d]` باید پیشوندِ `phon` باشد)؛ `k`
        طولِ تطابقِ بافرِ پس از اتصال با رشتهٔ بازخوانی است (از
        آیه‌ای خوانده‌شده شروع می‌شود، از آیه‌های میانی می‌گذرد و
        تا بخشِ خوانده‌شدهٔ آیهٔ جاری می‌رسد)؛ `ayah` آیهٔ آغازِ
        بازخوانی است؛ `first_len` طولِ رشتهٔ آیهٔ آغازینِ آن نامزد
        است (برای تشخیصِ بازخوانیِ ناتمام از کامل: «wait» فقط وقتی
        درست است که `k < first_len` باشد — یعنی بافر وسطِ همان
        آیهٔ آغازین تمام شده؛ وقتی آیهٔ آغازین کامل خوانده شده،
        بازخوانی مدرکِ کامل است و باید مصرف یا به شاخهٔ قدیمی
        سپرده شود، نه اینکه تا پایانِ خوراک منتظر بماند — حتی اگر
        رشتهٔ بازخوانی آیه‌های میانی را هم دربرگیرد).
        بهترین یعنی بزرگ‌ترین `k` (تساوی: جدیدترین
        آیه، کوچک‌ترین `d`). کمتر از `_LOCATE_MIN_MATCH` حرف،
        مدرکِ بازخوانی نیست. تطابق با
        `_match_prefix_with_one_gap` است: یک واجِ نگاشت که بازشناس
        ننوشته (مثل نونِ پایانیِ آیه پس از مد) تطابق را نمی‌شکند،
        اگر پس از پرش ازسرگیری شود. برخلافِ `locate_ayah`، کاوش از ابتدای
        بافر نیست — اتصال، سرِ بافر را آلوده می‌کند و همان آلودگی
        بود که شاخهٔ `revisit` پیشین را کور کرده بود (کاوشِ ۸حرفی‌اش
        روی دو تکهٔ به‌هم‌چسبیده می‌افتاد و هیچ آیه‌ای را نمی‌یافت).
        """
        if self.mapping is None or not buf or self._units is None:
            return None
        emitted = "".join(
            collapse_phoneme_runs(u.phoneme)
            for u in self._units[: self._unit_pos]
            if u.phoneme is not None
        )
        best: tuple[int, int, int, int] | None = None
        for d in range(min(_REVISIT_MAX_JUNCTION, len(phon)) + 1):
            if buf[:d] != phon[:d]:
                continue
            rest = buf[d:]
            if len(rest) < _LOCATE_MIN_MATCH:
                continue
            for ayah in sorted(self._touched_ayahs, reverse=True):
                if ayah >= self._ayah:
                    continue
                plain = self._ayah_phoneme_string(ayah, waslah=False)
                if plain is None:
                    continue
                for first_form in _waslah_forms(plain):
                    run = self._revisit_run_string(
                        ayah, first_form, emitted + phon[:d]
                    )
                    if run is None:
                        continue
                    k = _match_prefix_with_one_gap(rest, run)
                    if k < _LOCATE_MIN_MATCH:
                        continue
                    if (
                        best is None
                        or k > best[1]
                        or (k == best[1] and d < best[0])
                    ):
                        best = (d, k, ayah, len(first_form))
        return best

    def _restores_alignment(self, rest: str, phon: str) -> bool:
        """آیا بافرِ پس از حذفِ بازخوانی، با واحدِ جاری هم‌تراز است؟

        همان دو آزمونِ حلقهٔ اصلی: تطابقِ دقیق، یا نزدیک (≤۲) با
        لنگرِ روی واحدِ بعد. اگر هیچ‌کدام برقرار نباشد، حذفِ
        بازخوانی هم‌ترازی را برنمی‌گرداند و نباید انجام شود.
        """
        if rest.startswith(phon):
            return True
        return (
            len(rest) >= len(phon)
            and len(phon) > 3
            and alignment.levenshtein(rest[: len(phon)], phon)
            <= _NEAR_MISS_MAX_DISTANCE
            and self._anchor_close(rest, phon) is not None
        )

    def _try_consume_revisit(self, buf: str, phon: str) -> str | None:
        """بازخوانیِ آیهٔ پیش‌تر را در بافر پیدا و مصرف کن (فاز ۹).

        برمی‌گرداند: `"consumed"` اگر بازخوانی مصرف شد (حلقه باید
        از نو بچرخد)، `"wait"` اگر بازخوانی هنوز در حال رسیدن است
        (کلِ بافر تا اینجا با بازخوانی می‌خواند؛ حلقه باید بایستد و
        منتظرِ واجِ بیشتر بماند)، None اگر بازخوانی نیست (منطقِ
        موجود کار می‌کند). مصرف، فقط بخشِ بازخوانی را از وسطِ بافر
        برمی‌دارد (اتصال + ادامهٔ واقعی سرِ جایشان می‌مانند) و یک
        رویدادِ `revisit` می‌فرستد؛ اشاره‌گر جلو نمی‌رود و هیچ
        کلمه‌ای علامت نمی‌خورد. اگر هم‌ترازی با هیچ برش‌ای (تا ۲
        حرف عقب‌نشینی برای همخوانِ مرزیِ مشترک) برنگشت، چیزی مصرف
        نمی‌شود — تصمیمِ اشتباهِ برگشت‌ناپذیر گرفته نمی‌شود.
        """
        span = self._find_revisit_span(buf, phon)
        if span is None:
            return None
        d, k, r_ayah, first_len = span
        # بازخوانی هنوز در حال رسیدن است (کلِ بافر تا اینجا با
        # بازخوانی می‌خواند و آیهٔ آغازین کامل نشده): صبر کن.
        # اگر بازخوانی کامل شده و ادامه‌ای نرسیده (`k == first_len`
        # ولی `d + k == len(buf)`)، صبر نمی‌کنیم: کاربر ممکن است
        # همان‌جا متوقف شده باشد و رویدادِ `revisit` باید بیاید —
        # شاخهٔ بازگشتِ پایین (با مصرفِ دقیقِ تطابق) همان را
        # انجام می‌دهد و ادامهٔ بعدی هم از راهِ هم‌ترازیِ دوباره /
        # نزدیک‌یابیِ لنگردار جبران می‌شود.
        if d + k == len(buf) and k < first_len:
            return "wait"
        for kk in range(k, max(_LOCATE_MIN_MATCH, k - _REVISIT_TRIM_BACKOFF) - 1, -1):
            rest = buf[:d] + buf[d + kk:]
            if self._restores_alignment(rest, phon):
                self._phoneme_buffer = rest
                self._revisit_events += 1
                self._emit(
                    {"type": "revisit", "surah": self.surah, "ayah": r_ayah}
                )
                return "consumed"
        return None

    def _emit_partial_if_waiting(self) -> None:
        """رویداد `partial`: بافر، پیشوندِ واحدِ جاری است.

        حداکثر یک partial برای هر واحد (کلیدِ آخرین partial نگه
        داشته می‌شود) تا سیلِ رویداد نیاید؛ partial در شمارنده‌های
        کلمه نمی‌آید و دیوار را نمی‌نویسد — فقط کلمهٔ جاری را
        «در حال خوانده‌شدن» نشان می‌دهد.
        """
        if not self._phoneme_buffer or self._exhausted:
            return
        if self._units is None or self._unit_pos >= len(self._units):
            return
        unit = self._units[self._unit_pos]
        phon = unit.phoneme
        if phon is None:
            return
        buf = self._phoneme_buffer
        if len(buf) < 2 or len(buf) >= len(phon):
            return
        if not phon.startswith(buf):
            return
        first_index = unit.word_indices[0] if unit.word_indices else self._index
        key = (self._ayah, first_index)
        if key == self._last_partial_key:
            return
        self._last_partial_key = key
        expected = self._words[first_index] if first_index < len(self._words) else ""
        # اشاره‌گرِ گمانه‌ای (§۱۴٫۱): فقط همین خانه + متنِ موردانتظار؛
        # هیچ confidenceای ندارد و هیچ‌جا ثبت نمی‌شود.
        self._preview_key = key
        self._preview_text = expected
        self._emit(
            {
                "type": "partial",
                "status": "partial",
                "surah": self.surah,
                "ayah": self._ayah,
                "word_index": first_index,
                "expected": expected,
                "heard": None,
            }
        )

    async def _try_release_hold(self) -> bool:
        """آیا واحدِ نگه‌داشته‌شده (غلط) حالا درست خوانده شد؟

        فقط وقتی نشست با گزینهٔ «تا اصلاحِ خطا جلو نرو» نگه داشته
        شده صدا زده می‌شود. بازخوانیِ درستِ همان واحد (دقیق، وصل،
        یا نزدیکِ لنگردار) در بافر جست‌وجو می‌شود؛ هرچه پیش از آن
        آمده نادیده گرفته می‌شود (معنای نگه‌داشتن همین است: تا
        اصلاح نشود، هیچ‌چیز شمرده نمی‌شود). اصلاح با `_emit_unit`
        روی همان خانه می‌نشیند و رویدادِ correction می‌سازد.
        برمی‌گرداند True یعنی آزاد شد و حلقه ادامه دهد؛ False یعنی
        هنوز اصلاح نشده و باید منتظرِ واجِ بیشتر ماند.
        """
        await self._ensure_units()
        if self._units is None or self._unit_pos >= len(self._units):
            self._held = False
            return True
        unit = self._units[self._unit_pos]
        phon = unit.phoneme
        if phon is None:
            self._held = False
            return True
        buf = self._phoneme_buffer
        for form in _waslah_forms(phon):
            idx = buf.find(form)
            if idx >= 0:
                self._phoneme_buffer = buf[idx + len(form):]
                self._held = False
                self._emit_unit(unit.word_indices, "correct", _PROB_CORRECT)
                return True
        if len(buf) >= len(phon) and len(phon) > 3:
            dist = alignment.levenshtein(buf[: len(phon)], phon)
            if dist <= _NEAR_MISS_MAX_DISTANCE:
                anchored = self._anchor_close(buf, phon)
                if anchored is not None:
                    self._phoneme_buffer = buf[anchored:]
                    self._held = False
                    self._emit_unit(
                        unit.word_indices, "close", _PROB_CLOSE, distance=dist
                    )
                    return True
        if phon.startswith(buf):
            return False  # وسطِ بازخوانیِ واحد است؛ صبر کن.
        if len(buf) > _HOLD_BUFFER_MAX_CHARS:
            drop = len(buf) - _HOLD_BUFFER_MAX_CHARS
            self._phoneme_buffer = buf[drop:]
            self._resync_dropped += drop
        return False

    async def _feed_phonemes_loop(self) -> None:
        """حلقهٔ تطابق واج‌به‌کلمه (بدنهٔ پیشینِ `feed_phonemes`)."""
        while self._phoneme_buffer:
            if self._held:
                # «تا اصلاحِ خطا جلو نرو»: هیچ منطقِ دیگری تا اصلاحِ
                # واحدِ غلط اجرا نمی‌شود.
                if not await self._try_release_hold():
                    return
                continue
            if not await self._ensure_position():
                self._phoneme_buffer = ""
                return
            # یافتنِ آیه (شروعِ نشست یا یافتنِ دوباره پس از پرشِ بیش
            # از ۵ آیه): این چک، پس از `_ensure_position` است تا
            # پرچمی که همان `_ensure_position` (در `_advance_ayah`)
            # بلند کرده، پیش از لمسِ واحدهای آیهٔ تازه دیده شود —
            # وگرنه نخستین واحدِ آیهٔ تازه خاکستری می‌شد و بعد
            # یافتن اجرا می‌شد. تا لنگر نینداخته، حلقهٔ اصلی اجرا
            # نمی‌شود؛ اگر بافر هنوز کوتاه است، این فراخوانی
            # هیچ‌کار نمی‌کند و واج‌ها برای فراخوانیِ بعد می‌مانند.
            if (
                (self._locating or self._relocate_pending)
                and not await self._try_anchor_or_locate()
            ):
                return
            await self._ensure_units()
            assert self._units is not None
            if self._unit_pos >= len(self._units):
                if not await self._advance_ayah():
                    self._phoneme_buffer = ""
                    return
                continue
            if self._unit_pos == 0 and self._ayah != 1:
                # بسملهٔ آغازِ آیهٔ تازه (ایراد ۱۴): خواننده سرِ هر
                # آیه بسمله می‌گوید ولی بسمله جزو متنِ این آیه
                # نیست؛ سرِ بافر بماند، واحدِ اول را می‌شکند و
                # هم‌ترازی/شاخهٔ غلط آن را خطای کاربر حساب می‌کند.
                basmala = self._session_basmala()
                if basmala and self._phoneme_buffer.startswith(basmala):
                    self._phoneme_buffer = self._phoneme_buffer[len(basmala):]
                    self._resync_dropped += len(basmala)
                    if not self._phoneme_buffer:
                        return
            unit = self._units[self._unit_pos]
            word_indices, phon = unit.word_indices, unit.phoneme
            if phon is None:
                # رد خودکار (نشانهٔ وقف): خاکستری، بی‌مصرف واج.
                # اگر همین وقف پیش‌تر درونِ بازهٔ قطعهٔ ادغامیِ
                # پیشین صادر شده باشد
                # (`_emit_spanned_pauses_before`)، دوباره نفرست:
                # فقط اشاره‌گر جلو می‌رود.
                if all(
                    (self._ayah, wi) in self._emitted_event_ids
                    for wi in word_indices
                ):
                    self._unit_pos += 1
                    continue
                self._emit_unit(word_indices, "skipped", 0.0)
                continue
            buf = self._phoneme_buffer
            if buf.startswith(phon):
                if self._locate_failed:
                    # گم‌شده: تطابقِ تک‌واحدی مدرک نیست (کلمهٔ مشترکِ
                    # دو سوره هم دقیق می‌خواند)؛ واحدِ بعد باید تأیید
                    # کند. تأیید نشد → غلط؛ هنوز صدا نرسیده → صبر.
                    verdict = self._confirm_following(
                        buf[len(phon):], self._unit_pos
                    )
                    if verdict is None:
                        break
                    if verdict is False:
                        chunk = buf[: len(phon)]
                        self._emit_unit(
                            word_indices, "wrong", _PROB_WRONG, heard=chunk
                        )
                        self._phoneme_buffer = buf[len(phon):]
                        continue
                self._phoneme_buffer = buf[len(phon):]
                self._emit_unit(word_indices, "correct", _PROB_CORRECT)
                continue
            if unit.leading_waslah and phon.startswith("ء"):
                # همزهٔ وصل در آغاز کلمه: در خواندنِ پیوسته خوانده
                # نمی‌شود؛ اگر بافر با رشتهٔ بی‌همزه بخواند، درست
                # است (همزهٔ قطع — أ/إ — این‌گونه نیست و این شاخه
                # برای آن نمی‌افتد).
                stripped = phon[1:]
                if stripped and 0x064B <= ord(stripped[0]) <= 0x0652:
                    stripped = stripped[1:]
                if stripped and buf.startswith(stripped):
                    if self._locate_failed:
                        verdict = self._confirm_following(
                            buf[len(stripped):], self._unit_pos
                        )
                        if verdict is None:
                            break
                        if verdict is False:
                            chunk = buf[: len(stripped)]
                            self._emit_unit(
                                word_indices, "wrong", _PROB_WRONG, heard=chunk
                            )
                            self._phoneme_buffer = buf[len(stripped):]
                            continue
                    self._phoneme_buffer = buf[len(stripped):]
                    self._emit_unit(word_indices, "correct", _PROB_CORRECT)
                    continue
            near_dist: int | None = None
            if len(buf) >= len(phon) and len(phon) > 3:
                near_dist = alignment.levenshtein(buf[: len(phon)], phon)
            if near_dist is not None and near_dist <= _NEAR_MISS_MAX_DISTANCE:
                # کلمهٔ نزدیک: مرزِ کلمه را روی شروعِ واحدِ بعد لنگر
                # کن تا جابه‌جاییِ یک‌حرفیِ مرز (همخوانِ مشترکِ دو
                # کلمه، حرکتِ پایانیِ خوانده‌شده در وصل) به کلمه‌های
                # بعد سرایت نکند. اگر واحدِ بعد هنوز نرسیده، صبر کن؛
                # اگر با وجودِ بافرِ بلند لنگر پیدا نشد، مصرف نکن و
                # به جست‌وجوی جلو / هم‌ترازیِ دوباره (پایین) بسپار.
                anchored = self._anchor_close(buf, phon)
                if anchored is not None:
                    self._phoneme_buffer = buf[anchored:]
                    self._emit_unit(
                        word_indices, "close", _PROB_CLOSE, distance=near_dist
                    )
                    continue
                nxt = self._next_unit_phon()
                if nxt is not None and len(buf) < len(phon) + len(nxt):
                    break
            if phon.startswith(buf):
                break
            # تکرار: سرِ بافر، واحدی است که همین آیه پیش‌تر صادر شده
            # (کاربر کلمه را دوباره خواند) — نه کلمهٔ تازه، نه خطا:
            # گزارش می‌شود، مصرف می‌شود و اشاره‌گر جلو نمی‌رود.
            repeat = self._find_repeat_unit(buf)
            if repeat is not None:
                repeat_pos, phon_len = repeat
                repeat_unit = self._units[repeat_pos]
                if any(
                    self._cell_status.get((self._ayah, wi)) == "wrong"
                    for wi in repeat_unit.word_indices
                ):
                    # بازخوانیِ واحدی که «غلط» خورده تکرار نیست —
                    # اصلاح است (ایراد ۱۴): کاربر همان کلمه را این
                    # بار درست خوانده؛ خانه‌ها با correction درست
                    # می‌شوند و اشاره‌گر سرِ جایش می‌ماند. پیش‌تر
                    # این بازخوانی «تکرار» شمرده و دور ریخته می‌شد
                    # و غلطِ کاذب (مثلاً واج‌های بسملهٔ آغازِ نشست
                    # که به‌حسابِ کلمه‌های اول رفته بود) دائمی
                    # می‌ماند.
                    self._phoneme_buffer = buf[phon_len:]
                    for wi in repeat_unit.word_indices:
                        expected = (
                            self._words[wi] if wi < len(self._words) else ""
                        )
                        self._emit_word(
                            self._ayah, wi, expected, "correct",
                            _PROB_CORRECT, None,
                        )
                    continue
                first_index = (
                    repeat_unit.word_indices[0]
                    if repeat_unit.word_indices
                    else self._index
                )
                repeated_words = [
                    self._words[wi]
                    for wi in repeat_unit.word_indices
                    if wi < len(self._words)
                ]
                expected = " ".join(repeated_words) if repeated_words else ""
                self._repeat_events += 1
                self._phoneme_buffer = buf[phon_len:]
                self._emit(
                    {
                        "type": "repeat",
                        "surah": self.surah,
                        "ayah": self._ayah,
                        "word_index": first_index,
                        "expected": expected,
                    }
                )
                continue
            found = self._find_ahead_unit(buf)
            if found is not None:
                # پرشِ درون‌آیه‌ای فقط با تأییدِ دوواحدی: بافر باید
                # پس از واحدِ جلوتر، با واحدِ بعد از آن هم بخواند.
                # تطابقِ تک‌واحدی تصادفی است (کلمهٔ مشترکِ دو سوره،
                # مثل «اللَّهِ» فاتحه با «اللَّهِ» ۲۴:۲، پیش‌تر ۱۵
                # کلمه را بی‌دلیل خاکستری می‌کرد). تأیید نشد →
                # نیفت (هم‌ترازیِ دوباره / شاخهٔ ۲برابر، واحدِ جاری
                # را غلط می‌کند)؛ هنوز صدا نرسیده → صبر کن.
                found_phon = self._units[found].phoneme
                assert found_phon is not None
                verdict = self._confirm_following(
                    buf[len(found_phon):], found
                )
                if verdict is True:
                    while self._unit_pos < found:
                        u_idxs = self._units[self._unit_pos].word_indices
                        self._emit_unit(u_idxs, "skipped", 0.0)
                    continue
                if verdict is None:
                    break
            if len(buf) >= len(phon):
                # هم‌ترازی دوباره: سرِ بافر شاید یک کلمهٔ
                # غلط‌خوانده‌شده (یا واج‌های اضافی) است که واحد جاری
                # و هیچ واحدِ جلوتر را نمی‌سازد. واج‌های اول را
                # یکی‌یکی کنار بگذار و ببین آیا ادامهٔ بافر با واحد
                # جاری یا واحدی جلوتر می‌خواند؛ اگر خواند، آن واج‌ها
                # دور ریخته می‌شوند و خواندن ادامه می‌یابد. اگر نه،
                # بافر دست‌نخورده می‌ماند — پس خواندنِ خیلی جلوتر
                # آسیب نمی‌بیند و ردِ واحدِ قبلی انجام می‌شود.
                cap = 2 * max(len(phon), 1)
                resynced = False
                for d in range(1, min(cap, len(buf)) + 1):
                    rest = buf[d:]
                    if rest.startswith(phon) or (
                        len(rest) >= len(phon)
                        and len(phon) > 3
                        and alignment.levenshtein(rest[: len(phon)], phon)
                        <= _NEAR_MISS_MAX_DISTANCE
                    ):
                        # ادامه با خودِ واحدِ جاری می‌خواند: خرده،
                        # نویز/شروعِ ناتمام بود — دورریختنِ خاموش.
                        self._phoneme_buffer = rest
                        self._resync_dropped += d
                        resynced = True
                        break
                    if self._find_ahead_unit(rest) is not None:
                        if d >= _RESYNC_WRONG_MIN_CHARS:
                            # ایراد ۱۴: کاربر به‌جای این واحد چیز
                            # دیگری خوانده و جلو رفته است. پیش‌تر
                            # خرده بی‌صدا دور ریخته می‌شد و واحد
                            # «جاافتاده» می‌خورد — یعنی سیستم خطا
                            # را نمی‌دید و درستِ خودش را می‌نوشت.
                            # حالا واحد «غلط» است و شنیده‌شده همان
                            # خردهٔ واقعی است؛ ادامه با واحدِ جلوتر
                            # در دورِ بعد هم‌تراز می‌شود.
                            chunk = buf[: len(phon)]
                            self._phoneme_buffer = rest
                            self._emit_unit(
                                word_indices, "wrong", _PROB_WRONG,
                                heard=chunk,
                            )
                        else:
                            self._phoneme_buffer = rest
                            self._resync_dropped += d
                        resynced = True
                        break
                if resynced:
                    continue
            if len(buf) >= 2 * max(len(phon), 1):
                # بافر حداقل دو برابرِ طولِ موردانتظار شده و هنوز با
                # واحد جاری نمی‌خواند و هم‌ترازیِ دوباره هم نشد.
                # بازخوانیِ آیهٔ پیش‌تر (فاز ۹) پیش از هر تصمیمِ
                # برگشت‌ناپذیر آزموده می‌شود: اگر بافر، بازخوانیِ
                # آیه‌ای خوانده‌شده + ادامهٔ واقعی باشد، بازخوانی
                # مصرف می‌شود و هیچ کلمه‌ای غلط نمی‌خورد؛ اگر
                # بازخوانی هنوز در حال رسیدن است، صبر می‌کنیم.
                revisit = self._try_consume_revisit(buf, phon)
                if revisit == "consumed":
                    continue
                if revisit == "wait":
                    break
                # قانونِ فاز ۶ (اصلاحِ عیبِ سورهٔ ۲۴): «جاافتاده»
                # فقط با مدرکِ مثبتِ جلو رفتن صادر می‌شود — پیش از
                # این، همین شاخه بدونِ هیچ مدرکی واحد را خاکستری
                # می‌کرد و اشاره‌گر بی‌مهار جلو می‌رفت، پس خواندنِ
                # سوره‌ای دیگر ۱۳۵ کلمهٔ سورهٔ ۲۴ را خاکستری نوشت.
                if self._locate_failed:
                    # یافتنِ آیه ناموفق بوده: کاربر چیزی می‌خواند که
                    # با سوره نمی‌خواند. این واحد «غلط» (قرمز)
                    # علامت می‌خورد و یک طولِ کلمهٔ موردانتظار از
                    # بافر مصرف می‌شود تا جریان ادامه پیدا کند
                    # (رفتارِ پرمیوم: علامتِ خطا + ادامه، نه
                    # یخ‌زدن) — همان منطقِ مسیرِ ضبطی (align_phonemes).
                    chunk = buf[: len(phon)]
                    self._emit_unit(word_indices, "wrong", _PROB_WRONG, heard=chunk)
                    self._phoneme_buffer = buf[len(phon):]
                    continue
                if len(buf) < _LOCATE_MIN_CHARS:
                    # بافر هنوز برای یافتنِ معنادار کوتاه است:
                    # تصمیم نگیر؛ منتظرِ واجِ بیشتر بمان. در شرایطِ
                    # مبهم، صبر بهتر از علامت‌گذاریِ قطعیِ اشتباه است.
                    break
                # برگشت: بافر با آیه‌ای پیش‌تر در همین سوره می‌خواند
                # (کاربر آیهٔ قبل را دوباره می‌خواند). نشست به عقب
                # نمی‌رود؛ فقط گزارش و مصرف، بی‌آنکه واحدِ جاری
                # علامت بخورد. مدرکِ ضعیف‌تر (۸ حرف) کافی است، چون
                # این شاخه اشاره‌گر را جلو نمی‌برد و کلمه‌ای
                # نمی‌نویسد. مصرف دقیقاً همان است که یافتن اثبات
                # کرد (خردهٔ سر + تطابق)، نه یک طولِ کلمه: مصرفِ
                # `len(phon)` از وسطِ بازخوانی می‌برید و هم‌ترازیِ
                # بقیهٔ نشست را می‌شکست (تکرارِ چندباره).
                # تساویِ واج‌های مشترکِ دو آیه با
                # `tie_break_recency` حل می‌شود (تازه‌ترینِ
                # خوانده‌شده) — مصرف برای برندگانِ مساوی یکی است.
                back = locate_ayah_span(
                    self.mapping, self.surah, buf,
                    hint_ayah=self._ayah, allow_backward=True,
                    min_len=_LOCATE_MIN_MATCH, tie_break_recency=True,
                )
                if back is not None and back[0] < self._ayah:
                    _b_ayah, _b_pos, best_len, buf_off = back
                    self._revisit_events += 1
                    self._emit(
                        {
                            "type": "revisit",
                            "surah": self.surah,
                            "ayah": back[0],
                        }
                    )
                    self._phoneme_buffer = buf[buf_off + best_len:]
                    continue
                # پرشِ مشروع فقط با مدرکِ مثبت: بافر باید آیه‌ای
                # جلوتر در همین سوره را ثابت کند (۲۴ حرف، یا تمامِ
                # رشتهٔ آیهٔ کوتاه). اگر ثابت نکرد، کاربر چیزی
                # می‌خواند که با سوره نمی‌خواند: واحدِ جاری «غلط»
                # می‌خورد، یک طولِ کلمه مصرف می‌شود و پرچمِ یافتنِ
                # ناموفق بالا می‌ماند تا واحدهای بعد هم غلط بخورند،
                # نه خاکستری — تا نخستین تطابقِ درست/نزدیک.
                forward = locate_ayah(
                    self.mapping, self.surah, buf,
                    hint_ayah=self._ayah, allow_backward=False,
                )
                if forward is not None:
                    self._emit_unit(word_indices, "skipped", 0.0)
                    continue
                self._locate_failed = True
                chunk = buf[: len(phon)]
                self._emit_unit(word_indices, "wrong", _PROB_WRONG, heard=chunk)
                self._phoneme_buffer = buf[len(phon):]
                continue
            # بافر کوتاه‌تر از طول واج‌های موردانتظار است و با آن
            # نمی‌خواند: واج‌های بیشتری لازم است؛ منتظر بمان.
            break

    async def finish(self) -> dict:
        """پایان جریان: بقیهٔ آیهٔ جاری جاافتاده، و نشست ذخیره می‌شود.

        فقط آیه‌هایی ذخیره می‌شوند که لمس شده‌اند (نوشته یا رد شده)؛
        بقیهٔ سوره هرگز «جاافتاده» علامت نمی‌خورد. نکتهٔ ظریف: اشاره‌گر
        هرگز جلو برده نمی‌شود — اگر آیه کامل خوانده شده (اشاره‌گر ته
        آیه)، آیهٔ بعد جاافتاده نمی‌شود؛ فقط وقتی اشاره‌گر وسط آیه
        است (یا سر آیهٔ شروع، بی‌هیچ کلمه‌ای) بقیهٔ همان آیه
        جاافتاده می‌شود.
        """
        if self._ended:
            raise APIError(422, "hifz_stream_ended", "جریان زنده قبلاً پایان یافته است")
        self._ended = True
        # بقیهٔ آیهٔ جاری، بدون جلو بردن اشاره‌گر (دیدگاه بالا) — و
        # فقط اگر آن آیه واقعاً شروع شده باشد: آیهٔ شروع، یا آیه‌ای که
        # دست‌کم یک کلمه‌اش نوشته شده است. آیهٔ بعدی که اشاره‌گر فقط
        # به‌صورت گمانه‌ای واردش شده (پس از آیهٔ کامل + کلمهٔ اضافه)،
        # لمس‌نشده می‌ماند و جاافتاده نمی‌شود.
        if not self._exhausted:
            current_started = self._ayah == self.start_ayah or any(
                a == self._ayah for (a, _i) in self._assigned
            )
            if current_started:
                # کلمه‌های پایانیِ آیهٔ جاری با event_type `final_word`
                # می‌آیند (نه `skipped` زنده): کلاینت آن‌ها را از
                # کلمه‌های وسطِ جلسه جدا می‌کند.
                self._emitting_final = True
                try:
                    while self._index < len(self._words):
                        # خانهٔ ازپیش‌صادرشده (مثلاً واحدِ غلطِ
                        # نگه‌داشته‌شده در حالتِ hold) دست نمی‌خورد:
                        # «جاافتاده» نباید روی «غلط» اصلاحیه بفرستد.
                        if (self._ayah, self._index) not in self._emitted_event_ids:
                            expected = self._words[self._index]
                            self._emit_word(self._ayah, self._index, expected, "skipped", 0.0, None)
                        self._index += 1
                finally:
                    self._emitting_final = False
        stored_counts = {"correct": 0, "close": 0, "wrong": 0, "skipped": 0}
        touched = sorted(self._touched_ayahs)
        for pos, ayah in enumerate(touched):
            expected_words = await self._load_ayah(ayah)
            heard: list[str] = []
            probs: list[float | None] = []
            for idx in range(len(expected_words)):
                entry = self._assigned.get((ayah, idx))
                if entry is not None and entry[0] is not None:
                    heard.append(entry[0])
                    probs.append(entry[1])
            aligned, _ = alignment.align_words(
                expected_words, heard, probs, self.green, self.amber
            )
            extra = self._extras if pos == len(touched) - 1 else []
            stored = await hifz_service._store_grade(
                self.db, self.attempt, self.surah, ayah, aligned, extra
            )
            for row in stored:
                if row.status in stored_counts:
                    stored_counts[row.status] += 1
        summary = {
            "attempt_id": str(self.attempt.id),
            "surah": self.surah,
            "ayahs": touched,
            "counts": stored_counts,
            "extra_words": list(self._extras),
        }
        self._emit({"type": "final", **summary})
        return summary


async def start_live_session(
    db: AsyncSession,
    user: User,
    attempt_id: UUID,
    surah: int,
    ayah: int,
    sender,
    mapping=None,
    hold_on_wrong: bool | None = None,
) -> LiveSession:
    """نشست زنده را بساز: مالکیت + موتور + (برای Zipformer) نگاشت.

    - نشستِ دیگری → ۴۰۴ (مثل مسیر HTTP).
    - سورهٔ پیام start با سورهٔ attempt نخواند → ۴۰۰ (موقعیت مرجع
      را کلاینت تعیین نمی‌کند؛ attempt مالکِ سوره است).
    - موتور انتخاب‌شده Whisper باشد → خطای صادقانهٔ زنده-ناممکن.
    - موتور Zipformer باشد و مدل پیکربندی نشده باشد → خطای صادقانه.
    - موتور Zipformer باشد و نگاشت پیکربندی نشده باشد → خطای ۵۰۳ مسدودکننده.
    - آیهٔ شروع، تراز پذیرفته‌شده نداشته باشد → همان ابتدا خطای
      صادقانهٔ `hifz_mapping_ayah_unavailable` (نه وسط خواندن).
    """
    attempt = await hifz_service._attempt_or_404(db, user, attempt_id)
    if attempt.surah != surah:
        raise APIError(
            400,
            "hifz_stream_surah_mismatch",
            "سورهٔ پیام start با سورهٔ نشست نمی‌خواند؛ "
            "موقعیت مرجع را کلاینت تعیین نمی‌کند.",
        )
    engine_id = await hifz_engines.resolve_engine_id(db)
    if engine_id != "zipformer":
        raise LiveUnavailableError(engine_id)
    engine = hifz_engines.get_engine("zipformer")
    available, reason = engine.is_configured()
    if not available:
        raise hifz_engines.EngineError("engine_not_configured", reason)
    if mapping is None:
        mapping = require_phoneme_mapping()
    green, amber = await hifz_service.get_thresholds(db)
    if hold_on_wrong is None:
        # پیام start نگفته: تنظیمِ ذخیرهٔ کاربر (`freeze_on_error`)
        # حاکم است — همان سوییچِ رابط که از فاز ۴ هست.
        settings = await hifz_service.get_user_settings(db, user)
        hold_on_wrong = bool(settings.get("freeze_on_error"))
    session = LiveSession(
        db=db,
        attempt=attempt,
        surah=surah,
        start_ayah=ayah,
        green=green,
        amber=amber,
        sender=sender,
        mapping=mapping,
        hold_on_wrong=hold_on_wrong,
    )
    session._ayah = ayah
    session._words = await session._load_ayah(ayah)
    session._index = 0
    await session._ensure_units()
    # قرارگیری روی آیهٔ شروع، همان آیه را «لمس‌شده» می‌کند: اگر کاربر
    # بی‌آنکه چیزی بخواند جریان را تمام کند، همان یک آیه جاافتاده
    # ثبت می‌شود (مثل نمره‌دهی ضبطی با صوت خالی)؛ بقیهٔ سوره هرگز.
    session._touch(ayah)
    # آیهٔ شروع فقط راهنماست: اگر خواندن از آیهٔ دیگری شروع شود،
    # نشست با چند ثانیهٔ اولِ واج‌ها درونِ همان سوره می‌یابد و
    # همان‌جا لنگر می‌اندازد (feed_phonemes → _try_anchor_or_locate).
    session._locating = True
    return session
