"""جریان زندهٔ حفاظ — رنگ زنده حین خواندن (WebSocket).

طرح (بازبینی فاز ۳، بخش ۱۵ سند طراحی):
- صفحهٔ مطالعه دیگر صفحهٔ SVG نیست؛ دیوار سفید خالی است که کلمه‌ها
  حین تلاوت، یکی‌یکی و با رنگ زنده، در آن نوشته می‌شوند.
- رنگ زنده فقط از مسیر جریانیِ سمت سرور می‌آید (WebSocket)، نه ONNX
  مرورگر و نه Web Speech API. مرورگر قاب‌های صوتی ۱۶ کیلوهرتز تک‌کاناله
  می‌فرستد؛ سرور کلمه‌های شناخته‌شده را با وضعیت و احتمال برمی‌گرداند.
- ادامه پس از جاافتادگی حفظ می‌شود: کلمه/آیهٔ جاافتاده خاکستری نوشته
  می‌شود و نوشتن از آن رد می‌شود؛ نمره‌دهی هرگز سر جاافتادگی نمی‌ایستد.
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
    load_phoneme_mapping,
)

logger = logging.getLogger(__name__)

# کلمهٔ قابل‌فهم برای آزمون: پنجرهٔ جست‌وجوی جلو در تراز زنده.
_LIVE_LOOKAHEAD = 40


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
    _assigned: dict = field(default_factory=dict)  # (ayah, idx) -> (heard, prob)
    _touched_ayahs: list = field(default_factory=list)
    _extras: list = field(default_factory=list)
    _events: list = field(default_factory=list)

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
        return True

    async def _load_units(self, ayah: int) -> list[Segment]:
        """قطعه‌های یک آیه از نگاشت؛ آیهٔ پذیرفته‌نشده خطای صادقانه است."""
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
        return list(segs)

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
        }

    def _emit_word(
        self, ayah: int, index: int, expected: str, status: str,
        prob: float, heard: str | None,
    ) -> None:
        if status == "skipped":
            self._live_skipped_events += 1
        else:
            self._live_word_events += 1
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
        self, word_indices: tuple[int, ...], status: str, prob: float
    ) -> None:
        """همهٔ کلمه‌های یک قطعه را با یک وضعیت ثبت کن و اشاره‌گر را جلو ببر."""
        for wi in word_indices:
            expected = self._words[wi] if wi < len(self._words) else ""
            heard = expected if status in ("correct", "close") else None
            self._emit_word(self._ayah, wi, expected, status, prob, heard)
        if word_indices:
            self._index = max(word_indices) + 1
        self._unit_pos += 1

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

    async def feed_phonemes(self, phonemes: list[str]) -> None:
        """واج‌های Zipformer را با نگاشت قطعه‌ای به کلمه تبدیل کن.

        بدون نگاشت، این تابع هرگز کلمه تولید نمی‌کند — خطا می‌دهد.
        تطابق روی رشتهٔ واجی است: توکن‌های بازشناس به هم چسبانده
        می‌شوند و با رشتهٔ واجیِ واحد جاری مقایسه می‌شوند. واحد کامل
        در ابتدای بافر → «درست» (۰٫۹۵)؛ تفاوت اندک (لوونشتاین ≤ ۲ و
        طول > ۳) → «نزدیک» (۰٫۶۵). وقتی بافر با واحدی جلوتر بخواند،
        واحدهای بین‌شان «جاافتاده» می‌شوند (gray) و خواندن ادامه
        می‌یابد. واحدِ رد خودکار (نشانهٔ وقف) واج مصرف نمی‌کند.
        شنیده‌شدهٔ درست/نزدیک، همان متن موردانتظار است — نه حدسِ
        بازشناس. توجه: خوانشِ کاملاً غلط، بافر را مسموم می‌کند تا
        هم‌ترازی دوباره (محدودیت شناخته‌شدهٔ مسیر زنده؛ نمره‌دهی
        ضبطی با تراز کلمه‌ای این را ندارد).
        """
        if self.mapping is None:
            raise MappingPendingError()
        self._phoneme_buffer += "".join(t for t in phonemes if t != "<blank>")
        while self._phoneme_buffer:
            if not await self._ensure_position():
                self._phoneme_buffer = ""
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
            if (
                len(buf) >= len(phon)
                and len(phon) > 3
                and alignment.levenshtein(buf[: len(phon)], phon) <= 2
            ):
                self._phoneme_buffer = buf[len(phon):]
                self._emit_unit(word_indices, "close", 0.65)
                continue
            if phon.startswith(buf):
                break
            found = self._find_ahead_unit(buf)
            if found is not None:
                while self._unit_pos < found:
                    u_idxs = self._units[self._unit_pos].word_indices
                    self._emit_unit(u_idxs, "skipped", 0.0)
                continue
            if len(buf) >= 2 * max(len(phon), 1):
                # بافر حداقل دو برابرِ طولِ موردانتظار شده و هنوز با
                # واحد جاری نمی‌خواند: این واحد جاافتاده است و خواندن
                # ادامه می‌یابد — ولی بافر مصرف نمی‌شود (شاید واج‌های
                # واحد بعد در آن باشد).
                self._emit_unit(word_indices, "skipped", 0.0)
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
    return session
