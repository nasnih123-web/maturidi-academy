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

logger = logging.getLogger(__name__)

# کلمهٔ قابل‌فهم برای آزمون: پنجرهٔ جست‌وجوی جلو در تراز زنده.
_LIVE_LOOKAHEAD = 40

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


def locate_ayah(mapping, surah, buf, hint_ayah=None, allow_backward=True):
    """آیه‌ای از سوره را پیدا کن که واج‌های شنیده‌شده در آن باشد.

    `buf` رشتهٔ واجیِ فروپاشیدهٔ شنیده‌شده (چند ثانیهٔ اول) است؛
    کاوش، چند ده کاراکترِ اولِ آن است. برای هر آیه، بلندترین پیشوندِ
    کاوش که دقیقاً زیررشته‌ای از رشتهٔ واجیِ موردانتظارِ آن آیه باشد
    امتیاز می‌گیرد؛ آیهٔ برنده باید دست‌کم `_LOCATE_MIN_CHARS`
    کاراکتر بخواند. اگر آیهٔ راهنما (hint) در میانِ برندگانِ مساوی
    باشد، همان برمی‌گردد (کاربر معمولاً همان‌جایی است که انتخاب
    کرده)؛ اگر چند آیه دقیقاً مساوی باشند، مبهم است و None
    برمی‌گردد (نشست روی راهنما می‌ماند). `allow_backward=False`
    یعنی فقط آیه‌های جلوتر از راهنما پذیرفته می‌شوند (یافتنِ دوبارهٔ
    وسطِ نشست فقط به جلو می‌رود، مثل ترتیل — خواندنِ دوبارهٔ آیهٔ
    قبلی، نشست را به عقب نمی‌برد).
    """
    if mapping is None or len(buf) < _LOCATE_MIN_CHARS:
        return None
    probe = buf[:_LOCATE_PROBE_CHARS]
    meta = quran_service.get_surah(surah)
    best_len = 0
    best: list[tuple[int, int, int]] = []  # (ayah, offset, unit_pos)
    for ayah in range(1, meta.ayahs + 1):
        if not allow_backward and hint_ayah is not None and ayah <= hint_ayah:
            continue
        segs = mapping.segments_for(surah, ayah)
        if not segs:
            continue
        expected = "".join(
            collapse_phoneme_runs(s.phoneme) for s in segs if s.phoneme is not None
        )
        if not expected:
            continue
        # بلندترین پیشوندِ کاوش که در رشتهٔ موردانتظار هست؛ آیهٔ
        # کوتاه هم با همین کفِ ۸ حرف پیدا می‌شود.
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
        # واحدی که تطابق از آن شروع می‌شود.
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
        if found_len > best_len:
            best_len = found_len
            best = [(ayah, found_off, unit_pos)]
        elif found_len == best_len:
            best.append((ayah, found_off, unit_pos))
    if not best:
        return None
    if hint_ayah is not None:
        for ayah, _off, unit_pos in best:
            if ayah == hint_ayah:
                return (ayah, unit_pos)
    if len(best) == 1:
        return (best[0][0], best[0][2])
    return None


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

    def event(self) -> dict:
        return {
            "type": "word",
            "surah": self.surah,
            "ayah": self.ayah,
            "word_index": self.word_index,
            "expected": self.expected,
            "status": self.status,
            "prob": self.prob,
            "heard": self.heard,
        }


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


def _live_pair(
    expected: str, heard: str, prob: float | None, green: float, amber: float
) -> tuple[str, float, str | None]:
    """وضعیت زندهٔ یک جفت کلمه — دقیقاً همان منطق `alignment.emit_pair`."""
    norm_exp = alignment.normalize_arabic_word(expected)
    norm_hrd = alignment.normalize_arabic_word(heard)
    if norm_exp == norm_hrd:
        if alignment.strip_diacritics(expected) == alignment.strip_diacritics(heard):
            if expected != heard:
                return "close", 0.65, "wrong_tashkeel"
            p = 0.95 if prob is None else max(0.0, min(1.0, float(prob)))
            return ("correct" if p >= green else "close"), p, None
        return "close", 0.65, "wrong_word"
    dist = alignment.levenshtein(norm_exp, norm_hrd)
    if dist <= 2 and len(norm_exp) > 3:
        return "close", 0.65, "wrong_word"
    return "wrong", 0.30, "wrong_word"


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
    _touched_ayahs: list = field(default_factory=list)
    _extras: list = field(default_factory=list)
    _events: list = field(default_factory=list)

    def __post_init__(self) -> None:
        # آخرین آیهٔ شنیده‌شده از آیهٔ شروع (راهنما) آغاز می‌شود.
        self._last_heard_ayah = self.start_ayah

    def _emit(self, event: dict) -> None:
        self._events.append(event)
        if self.sender is not None:
            self.sender(event)

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
        }

    def _emit_word(
        self, ayah: int, index: int, expected: str, status: str,
        prob: float, heard: str | None,
    ) -> None:
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
        self._assigned[(ayah, index)] = (heard, prob)
        self._emit(LiveWord(self.surah, ayah, index, expected, status, prob, heard).event())

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
                alignment.levenshtein(norm_exp, norm_hrd) <= 2
                and len(norm_exp) > 3
            ):
                status, prob, _ = _live_pair(
                    expected, heard_word.text, heard_word.prob, self.green, self.amber
                )
                self._emit_word(
                    self._ayah, self._index, expected, status, prob, heard_word.text
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
            status, prob, _ = _live_pair(
                expected, heard_word.text, heard_word.prob, self.green, self.amber
            )
            self._emit_word(
                self._ayah, self._index, expected, status, prob, heard_word.text
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
                alignment.levenshtein(norm_exp, norm_heard) <= 2
                and len(norm_exp) > 3
            ):
                return (ayah, index)
        return None

    def _emit_unit(
        self, word_indices: tuple[int, ...], status: str, prob: float,
        heard: str | None = None,
    ) -> None:
        """همهٔ کلمه‌های یک قطعه را با یک وضعیت ثبت کن و اشاره‌گر را جلو ببر.

        `heard` فقط برای وضعیتِ «غلط» داده می‌شود (تکهٔ واجیِ
        شنیده‌شده)؛ برای درست/نزدیک، شنیده‌شده همان متنِ موردانتظار
        است و برای جاافتاده/ردِ خودکار، None.
        """
        for wi in word_indices:
            expected = self._words[wi] if wi < len(self._words) else ""
            if heard is not None:
                h: str | None = heard
            else:
                h = expected if status in ("correct", "close") else None
            self._emit_word(self._ayah, wi, expected, status, prob, h)
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
        """
        from_ayah = self._ayah
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
                and alignment.levenshtein(buf[: len(phon)], phon) <= 2
            ):
                self._locating = False
                self._relocate_pending = False
                return True
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
        نشد: اگر یافتنِ آیه ناموفق نبوده، واحد جاری «جاافتاده»
        (خاکستری، بی‌مصرفِ بافر) است تا اشاره‌گر به آیهٔ جلوتر برسد
        (پرشِ مشروع؛ قانونِ خاکستریِ ≤۵ آیه + یافتنِ دوباره از این
        جلوتر نگهبانی می‌کنند). اگر یافتن ناموفق بوده، واحد جاری
        «غلط» (قرمز، ۰٫۳۰) علامت می‌خورد و یک طولِ کلمهٔ موردانتظار
        از بافر مصرف می‌شود — رفتارِ پرمیوم (علامتِ خطا + ادامه، نه
        یخ‌زدن) و همان منطقِ مسیرِ ضبطی. اشاره‌گر هرگز بدونِ مصرفِ
        واجِ شنیده‌شده جلو نمی‌رود، پس آیه‌های نخوانده هرگز نوشته
        نمی‌شوند.
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
        while self._phoneme_buffer:
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
            unit = self._units[self._unit_pos]
            word_indices, phon = unit.word_indices, unit.phoneme
            if phon is None:
                # رد خودکار (نشانهٔ وقف): خاکستری، بی‌مصرف واج.
                self._emit_unit(word_indices, "skipped", 0.0)
                continue
            buf = self._phoneme_buffer
            if buf.startswith(phon):
                self._phoneme_buffer = buf[len(phon):]
                self._emit_unit(word_indices, "correct", 0.95)
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
                    self._phoneme_buffer = buf[len(stripped):]
                    self._emit_unit(word_indices, "correct", 0.95)
                    continue
            if (
                len(buf) >= len(phon)
                and len(phon) > 3
                and alignment.levenshtein(buf[: len(phon)], phon) <= 2
            ):
                # کلمهٔ نزدیک: مرزِ کلمه را روی شروعِ واحدِ بعد لنگر
                # کن تا جابه‌جاییِ یک‌حرفیِ مرز (همخوانِ مشترکِ دو
                # کلمه، حرکتِ پایانیِ خوانده‌شده در وصل) به کلمه‌های
                # بعد سرایت نکند. اگر واحدِ بعد هنوز نرسیده، صبر کن؛
                # اگر با وجودِ بافرِ بلند لنگر پیدا نشد، مصرف نکن و
                # به جست‌وجوی جلو / هم‌ترازیِ دوباره (پایین) بسپار.
                anchored = self._anchor_close(buf, phon)
                if anchored is not None:
                    self._phoneme_buffer = buf[anchored:]
                    self._emit_unit(word_indices, "close", 0.65)
                    continue
                nxt = self._next_unit_phon()
                if nxt is not None and len(buf) < len(phon) + len(nxt):
                    break
            if phon.startswith(buf):
                break
            found = self._find_ahead_unit(buf)
            if found is not None:
                while self._unit_pos < found:
                    u_idxs = self._units[self._unit_pos].word_indices
                    self._emit_unit(u_idxs, "skipped", 0.0)
                continue
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
                    if (
                        rest.startswith(phon)
                        or (
                            len(rest) >= len(phon)
                            and len(phon) > 3
                            and alignment.levenshtein(rest[: len(phon)], phon) <= 2
                        )
                        or self._find_ahead_unit(rest) is not None
                    ):
                        self._phoneme_buffer = rest
                        self._resync_dropped += d
                        resynced = True
                        break
                if resynced:
                    continue
            if len(buf) >= 2 * max(len(phon), 1):
                # بافر حداقل دو برابرِ طولِ موردانتظار شده و هنوز با
                # واحد جاری نمی‌خواند و هم‌ترازیِ دوباره هم نشد.
                # اگر یافتنِ آیه ناموفق نبوده، کاربر ممکن است آیه‌ای
                # جلوتر را بخواند: این واحد «جاافتاده» (خاکستری،
                # بی‌مصرفِ بافر) است تا اشاره‌گر به آن آیه برسد
                # (پرشِ مشروع؛ قانونِ خاکستریِ ≤۵ آیه + یافتنِ دوباره
                # از این جلوتر نگهبانی می‌کنند). اگر یافتن ناموفق
                # بوده، کاربر چیزی می‌خواند که با سوره نمی‌خواند:
                # این واحد «غلط» (قرمز) علامت می‌خورد و یک طولِ
                # کلمهٔ موردانتظار از بافر مصرف می‌شود تا جریان ادامه
                # پیدا کند (رفتارِ پرمیوم: علامتِ خطا + ادامه، نه
                # یخ‌زدن) — همان منطقِ مسیرِ ضبطی (align_phonemes).
                # اشاره‌گر هرگز بدونِ مصرفِ واجِ شنیده‌شده جلو
                # نمی‌رود، پس آیه‌های نخوانده هرگز نوشته نمی‌شوند —
                # عیبِ «خواندنِ سورهٔ دیگر و نوشتنِ آیاتِ سورهٔ
                # انتخاب‌شده» همین‌جا بود.
                if not self._locate_failed:
                    self._emit_unit(word_indices, "skipped", 0.0)
                    continue
                chunk = buf[: len(phon)]
                self._emit_unit(word_indices, "wrong", 0.30, heard=chunk)
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
                while self._index < len(self._words):
                    expected = self._words[self._index]
                    self._emit_word(self._ayah, self._index, expected, "skipped", 0.0, None)
                    self._index += 1
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
) -> LiveSession:
    """نشست زنده را بساز: مالکیت + موتور + (برای Zipformer) نگاشت.

    - نشستِ دیگری → ۴۰۴ (مثل مسیر HTTP).
    - موتور انتخاب‌شده Whisper باشد → خطای صادقانهٔ زنده-ناممکن.
    - موتور Zipformer باشد و مدل پیکربندی نشده باشد → خطای صادقانه.
    - موتور Zipformer باشد و نگاشت پیکربندی نشده باشد → خطای ۵۰۳ مسدودکننده.
    - آیهٔ شروع، تراز پذیرفته‌شده نداشته باشد → همان ابتدا خطای
      صادقانهٔ `hifz_mapping_ayah_unavailable` (نه وسط خواندن).
    """
    attempt = await hifz_service._attempt_or_404(db, user, attempt_id)
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
    session = LiveSession(
        db=db,
        attempt=attempt,
        surah=surah,
        start_ayah=ayah,
        green=green,
        amber=amber,
        sender=sender,
        mapping=mapping,
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
