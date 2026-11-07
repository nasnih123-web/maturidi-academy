"""قرارداد نسخه‌دار WebSocket جریان زندهٔ حفاظ (فاز ۵: برابری با ترتیل).

این ماژول، قرارداد پیامِ نشست زنده را در یک جا تعریف می‌کند تا وب و API
از یک منبعِ واحد بخوانند؛ منطق تطابق/نمره در `hifz_stream.py` می‌ماند.

نسخه‌ها:
- نسخهٔ ۱ (قدیمی): رویدادها فقط `type` دارند (`word`/`extra`/`located`/
  `final`/`error`) و بدون ترتیب/شناسه‌اند. کلاینت قدیمی همین را
  می‌فرستد (پیام `start` بدون `protocol_version`) و همین را می‌گیرد؛
  فیلدهای پاکت نسخهٔ ۲ به رویدادهایش اضافه می‌شود ولی نامِ `type` و
  شکلِ فیلدهای قدیمی عوض نمی‌شود، پس کلاینت قدیمی بی‌سروصدا
  نمی‌شکند (فیلد اضافه را نادیده می‌گیرد).
- نسخهٔ ۲ (جاری): هر رویداد پاکت دارد — `session_id`، `event_id`،
  `sequence_no`، `event_type`، `status`، موقعیت قرآن (`surah`/`ayah`/
  `word_index` هرجا که معنا دارد؛ `page`/`line` سمت سرور معلوم نیست
  و فرستاده نمی‌شود)، `audio_ts_ms` (زمانِ صوتیِ تجمعیِ رسیده) و
  `confidence`/`reason` هرجا که معنا دارد. رویدادهای تازهٔ نسخهٔ ۲
  (`session_started`، `engine_ready`، `audio_ready`، `listening`،
  `partial`، `stable_word`، `final_word`، `correction`، `skipped`،
  `wrong`، `progress`، `warning`، `session_ended`) برای کلاینت قدیمی
  ناشناخته‌اند و نادیده گرفته می‌شوند؛ کلاینت نسخهٔ ۲ آن‌ها را
  می‌خواهد و `listening` را فقط پس از `audio_ready` نشان می‌دهد.

ماشین وضعیت نشست (سمت سرور):
    idle → connecting → connected → engine_loading → audio_ready
    → listening → processing → stopping → completed | failed
    (reconnecting / interrupted فقط سمت کلاینت‌اند: سرور نشست را
    از سر نمی‌گیرد؛ اتصالِ دوباره یعنی نشستِ تازه با `session_id`
    تازه روی همان attempt، و کلمه‌های ذخیره‌نشدهٔ نشستِ پیشین از دست
    می‌روند.)

سقف‌ها (R-11) — برای جلوگیری از اشباع CPU موتور ASR و رشد بی‌حد
حافظه/صف:
- هر قاب باینری حداکثر `MAX_FRAME_BYTES` بایت و طولِ زوج (Int16LE)؛
  قابِ بدشکل/بیش‌ازحد رد می‌شود (رویداد خطای غیرکشنده + شمارش؛
  تکرار → بستن اتصال).
- نرخ قاب با سطل توکن محدود می‌شود (`MAX_FRAMES_PER_SECOND` پایدار،
  با انفجارِ کوتاه)؛ تخطیِ پی‌درپی → بستن با کد `hifz_rate_limited`.
- هر پیام متنی حداکثر `MAX_TEXT_MESSAGE_BYTES` بایت.
- مدت نشست حداکثر `MAX_SESSION_SECONDS` ثانیه؛ پس از آن نشست مثل
  `end` نهایی می‌شود (تخلیه + ذخیره + `final` + `session_ended` با
  دلیل `max_duration`)، نه قطعِ بی‌سروصدا.
- بلیط (`?ticket=`) یک‌بارمصرف و ۶۰ ثانیه‌ای است و هرگز در لاگ
  نمی‌آید؛ `?token=<JWT>` پذیرفته نیست (همان قرارداد پیشین).

جعلِ هویت/موقعیت: پیام `start` نباید `user_id`، `attempt_id`،
`owner` یا `session_id` داشته باشد؛ `surah` باید با سورهٔ attempt
برابر باشد (مالکیت attempt پیش‌تر با `_attempt_or_404` چک می‌شود).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from uuid import UUID

from app.core.errors import APIError

# ---------------------------------------------------------------------------
# نسخهٔ قرارداد
# ---------------------------------------------------------------------------

HIFZ_WS_PROTOCOL_VERSION = 2
HIFZ_WS_PROTOCOL_VERSIONS = (1, 2)

# ---------------------------------------------------------------------------
# سقف‌ها (R-11)
# ---------------------------------------------------------------------------

# قابِ صوتی: Int16LE تک‌کانالهٔ ۱۶ کیلوهرتز، ۴۰۹۶ نمونه = ۸٬۱۹۲ بایت.
# سقف ۶۴ کیلوبایت یعنی ~۲ ثانیه صوت در یک پیام؛ بیشتر از آن، یا
# کلاینت خراب است یا سوءاستفاده.
MAX_FRAME_BYTES = 65536
# نرخِ قاب: کلاینت سالم ~۴ قاب در ثانیه می‌فرستد (۴۰۹۶ نمونه در
# ۱۶ کیلوهرتز = ۲۵۶ میلی‌ثانیه). سقفِ پایدار ۵۰ قاب/ثانیه با انفجارِ
# کوتاه، جلوی اشباع CPU را می‌گیرد بی‌آنکه کلاینت سالم را بگیرد.
MAX_FRAMES_PER_SECOND = 50
MAX_FRAME_BURST = 100
# پیام متنی (start/end/cancel): چند صد بایت کافی است.
MAX_TEXT_MESSAGE_BYTES = 4096
# مدت نشست زنده: ۳۰ دقیقه؛ پس از آن نهایی‌سازی مثل end.
MAX_SESSION_SECONDS = 1800
# اعتبارسنجی دوره‌ای نشست وسط جریان زنده (فاز ۱۲، P1-1): بلیط/JWT
# فقط در handshake چک می‌شوند؛ اگر کاربر وسط نشست، نشستش را باطل
# کند (خروج/تغییر رمز)، اتصال باید بسته شود، نه تا سقف ۳۰ دقیقه
# باز بماند. هر ۵ دقیقه یک بار، با SELECT تازه (نه شیء کش‌شده).
LIVE_SESSION_REVALIDATION_SECONDS = 300
# تخطیِ پی‌درپیِ اعتبارسنجیِ قاب پیش از بستن اتصال.
MAX_FRAME_VIOLATIONS = 3

# ---------------------------------------------------------------------------
# فیلدهای ممنوع در پیام کلاینت (جعل هویت/مالکیت/موقعیت)
# ---------------------------------------------------------------------------

FORBIDDEN_CLIENT_FIELDS = frozenset(
    {"user_id", "attempt_id", "owner", "session_id", "user"}
)

# ---------------------------------------------------------------------------
# نوع‌های رویداد نسخهٔ ۲ + نگاشت سازگاری به نامِ قدیمیِ `type`
# ---------------------------------------------------------------------------

# event_type -> نامِ قدیمیِ `type` (کلاینت قدیمی فقط `type` را می‌خواند).
LEGACY_TYPE_BY_EVENT_TYPE: dict[str, str] = {
    "session_started": "session_started",
    "engine_ready": "engine_ready",
    "audio_ready": "audio_ready",
    "listening": "listening",
    "partial": "partial",
    "stable_word": "word",
    "final_word": "word",
    "correction": "correction",
    "located": "located",
    "skipped": "word",
    "wrong": "word",
    "extra": "extra",
    "repeat": "repeat",
    "revisit": "revisit",
    "progress": "progress",
    "warning": "warning",
    "error": "error",
    "final": "final",
    "session_ended": "session_ended",
}

# وضعیتِ نهایی‌شدنِ رویدادِ کلمه‌ای (فاز ۶، سه‌وضعیتی):
# - provisional: فقط `partial` — موقت و قابلِ تغییر/پس‌گرفتن
#   (`retracted: true`)؛ هرگز ثبت نمی‌شود و confidence ندارد.
# - stable: `stable_word`/`wrong`/`skipped` — واحد تطابق خورده و
#   بافر از آن گذشته؛ تصمیمِ بعدی برای همان خانه، `correction`
#   است با `corrects_event_id` (همان خانه، بدونِ duplicate).
# - final: `final_word` — finish() آن را صادر کرده؛ پس از رویدادِ
#   `final` هیچ رویدادِ کلمه‌ای نمی‌آید. نمرهٔ ذخیره‌شده از
#   `final` می‌آید، نه از رویدادهای زنده.
# «نزدیک» در مرزِ بیشینهٔ فاصله (یا تطابقِ دقیق با احتمالِ پایین)
# پرچمِ `needs_review: true` دارد: قطعی نیست، بازبینی می‌خواهد.
# رویدادهای تازهٔ فاز ۶: `repeat` (بازخوانیِ واحدِ صادرشده — مصرف
# می‌شود، اشاره‌گر جلو نمی‌رود)، `revisit` (بازخوانیِ آیهٔ پیش‌تر —
# نشست به عقب نمی‌رود). هر دو کلمه نمی‌نویسند و در شمارنده‌های
# کلمه نمی‌آیند.

# وضعیتِ کلمه → event_type نسخهٔ ۲ (به‌جز کلمه‌های پایانیِ finish).
EVENT_TYPE_BY_WORD_STATUS: dict[str, str] = {
    "correct": "stable_word",
    "close": "stable_word",
    "wrong": "wrong",
    "skipped": "skipped",
}


class LiveSessionState(str, Enum):
    """وضعیت‌های نشست زنده (سمت سرور)."""

    IDLE = "idle"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ENGINE_LOADING = "engine_loading"
    AUDIO_READY = "audio_ready"
    LISTENING = "listening"
    PROCESSING = "processing"
    STOPPING = "stopping"
    COMPLETED = "completed"
    FAILED = "failed"


# گذرهای مجاز ماشین وضعیت (سرور). reconnecting/interrupted سمت
# کلاینت‌اند و در این نگاشت نیستند.
_ALLOWED_TRANSITIONS: dict[LiveSessionState, set[LiveSessionState]] = {
    LiveSessionState.IDLE: {LiveSessionState.CONNECTING},
    LiveSessionState.CONNECTING: {
        LiveSessionState.CONNECTED,
        LiveSessionState.FAILED,
    },
    LiveSessionState.CONNECTED: {
        LiveSessionState.ENGINE_LOADING,
        LiveSessionState.FAILED,
    },
    LiveSessionState.ENGINE_LOADING: {
        LiveSessionState.AUDIO_READY,
        LiveSessionState.FAILED,
    },
    LiveSessionState.AUDIO_READY: {
        LiveSessionState.LISTENING,
        LiveSessionState.FAILED,
    },
    LiveSessionState.LISTENING: {
        LiveSessionState.PROCESSING,
        LiveSessionState.STOPPING,
        LiveSessionState.FAILED,
    },
    LiveSessionState.PROCESSING: {
        LiveSessionState.STOPPING,
        LiveSessionState.FAILED,
    },
    LiveSessionState.STOPPING: {
        LiveSessionState.COMPLETED,
        LiveSessionState.FAILED,
    },
    LiveSessionState.COMPLETED: set(),
    LiveSessionState.FAILED: set(),
}


class LiveSessionStateMachine:
    """ماشین وضعیت صریح نشست زنده؛ گذرِ نامجاز خطا می‌دهد، نه سکوت."""

    def __init__(self) -> None:
        self.state = LiveSessionState.IDLE

    def transition(self, target: LiveSessionState) -> LiveSessionState:
        if target not in _ALLOWED_TRANSITIONS[self.state]:
            raise ValueError(
                f"invalid live session transition {self.state.value} "
                f"-> {target.value}"
            )
        self.state = target
        return self.state

    def force(self, target: LiveSessionState) -> LiveSessionState:
        """گذرِ اضطراری (قطع اتصال وسط هر وضعیت → failed)."""
        self.state = target
        return self.state


@dataclass
class LiveEventSequencer:
    """شماره‌گذاریِ یکنواخت رویدادهای یک نشست + ساخت پاکت نسخهٔ ۲.

    `sequence_no` از ۱ شروع می‌شود و برای هر رویداد یکی زیاد
    می‌شود؛ `event_id` یکتاست. کلاینت با همین دو فیلد، تکراری،
    بی‌ترتیب و جاافتاده را تشخیص می‌دهد (replay سرور هرگز انجام
    نمی‌شود؛ جاافتادگی فقط گزارش می‌شود).
    """

    session_id: str
    _next_sequence_no: int = 1

    def next_sequence_no(self) -> int:
        seq = self._next_sequence_no
        self._next_sequence_no += 1
        return seq

    def envelope(
        self,
        event_type: str,
        status: str,
        audio_ts_ms: int = 0,
        **fields,
    ) -> dict:
        """پاکت نسخهٔ ۲ را دور فیلدهای رویداد بپیچ (با `type` قدیمی)."""
        event = {
            "session_id": self.session_id,
            "event_id": str(uuid.uuid4()),
            "sequence_no": self.next_sequence_no(),
            "event_type": event_type,
            "type": LEGACY_TYPE_BY_EVENT_TYPE.get(event_type, event_type),
            "status": status,
            "audio_ts_ms": audio_ts_ms,
        }
        event.update(fields)
        return event


def parse_start_message(data: object) -> dict:
    """پیام `start` کلاینت را اعتبارسنجی کن؛ نامعتبر → APIError 4400.

    برمی‌گرداند: `protocol_version` (۱ یا ۲؛ پیش‌فرض ۱ برای کلاینت
    قدیمی)، `surah`، `ayah`، و `audio` (اعلامِ قابِ کلاینت نسخهٔ ۲،
    یا None). فیلدهای ممنوع (جعل هویت/مالکیت) و نسخهٔ ناشناخته رد
    می‌شوند؛ `surah`/`ayah` باید عدد و در بازه باشند.
    """
    if not isinstance(data, dict) or data.get("type") != "start":
        raise APIError(
            400, "hifz_stream_start_required", "نخستین پیام باید start باشد"
        )
    forbidden = FORBIDDEN_CLIENT_FIELDS & set(data.keys())
    if forbidden:
        raise APIError(
            400,
            "hifz_forbidden_field",
            "پیام start نباید فیلد "
            + "، ".join(sorted(forbidden))
            + " داشته باشد",
        )
    version = data.get("protocol_version", 1)
    if version not in HIFZ_WS_PROTOCOL_VERSIONS:
        raise APIError(
            400,
            "hifz_protocol_unsupported",
            f"نسخهٔ قرارداد {version!r} پشتیبانی نمی‌شود؛ "
            f"نسخه‌های پشتیبانی‌شده: {list(HIFZ_WS_PROTOCOL_VERSIONS)}",
        )
    try:
        surah = int(data.get("surah", 0))
        ayah = int(data.get("ayah", 0))
    except (TypeError, ValueError):
        raise APIError(
            400, "hifz_stream_start_required", "surah و ayah باید عدد باشند"
        ) from None
    if not 1 <= surah <= 114 or not 1 <= ayah <= 286:
        raise APIError(
            400, "hifz_stream_start_required", "surah یا ayah خارج از بازه است"
        )
    audio = data.get("audio")
    if version == 2 and audio is not None:
        if not isinstance(audio, dict):
            raise APIError(
                400,
                "hifz_stream_start_required",
                "audio باید شیء باشد",
            )
        # کلاینت نسخهٔ ۲ باید همان قالبی را اعلام کند که سرور
        # می‌خواهد: ۱۶ کیلوهرتز، تک‌کاناله، Int16LE. اعلامِ دیگر →
        # خطای روشن، نه پذیرشِ بی‌صدا.
        declared_rate = audio.get("sample_rate")
        declared_channels = audio.get("channels")
        declared_format = audio.get("format")
        if (
            declared_rate not in (None, 16000)
            or declared_channels not in (None, 1)
            or declared_format not in (None, "pcm16le")
        ):
            raise APIError(
                400,
                "hifz_audio_format_mismatch",
                "قاب صوتی باید ۱۶ کیلوهرتز تک‌کانالهٔ Int16LE باشد؛ "
                "کلاینت نرخ/کانال/قالب دیگری اعلام کرد",
            )
    return {
        "protocol_version": version,
        "surah": surah,
        "ayah": ayah,
        "audio": audio if isinstance(audio, dict) else None,
    }


def validate_frame(frame: bytes) -> str | None:
    """قاب باینری را اعتبارسنجی کن؛ None یعنی معتبر، وگرنه کد خطا.

    - طولِ فرد → Int16LE ناقص (`hifz_frame_malformed`).
    - بزرگ‌تر از سقف → `hifz_frame_too_large`.
    (سکوت/کلیپ/NaN: در Int16 معنا ندارند — NaN در عدد صحیح نیست؛
    سکوتِ کامل معتبر است و شمرده می‌شود، نه رد.)
    """
    if len(frame) % 2 != 0:
        return "hifz_frame_malformed"
    if len(frame) > MAX_FRAME_BYTES:
        return "hifz_frame_too_large"
    return None


@dataclass
class FrameRateLimiter:
    """سطل توکن برای نرخ قاب: پایدار N قاب/ثانیه، با انفجارِ کوتاه.

    `allow()` در هر فراخوانی، توکن‌ها را با زمانِ سپری‌شده پر می‌کند
    و اگر توکن بود یکی مصرف می‌کند. `now` قابل‌تزریق است تا آزمون
    بدون خوابیدنِ واقعی انجام شود.
    """

    rate_per_second: float = MAX_FRAMES_PER_SECOND
    burst: int = MAX_FRAME_BURST
    _tokens: float = field(default=MAX_FRAME_BURST, init=False)
    _last_refill: float = field(default_factory=time.monotonic, init=False)

    def allow(self, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        elapsed = max(0.0, now - self._last_refill)
        self._last_refill = now
        self._tokens = min(
            float(self.burst), self._tokens + elapsed * self.rate_per_second
        )
        if self._tokens < 1.0:
            return False
        self._tokens -= 1.0
        return True


# ---------------------------------------------------------------------------
# سقف اتصال‌های زندهٔ هم‌زمان (فاز ۱۱، امنیت)
# ---------------------------------------------------------------------------

# هر اتصال زنده، یک بازشناسِ Zipformerِ جدا (مدل ۷۳ مگابایتی + وضعیت
# جریان) در حافظه نگه می‌دارد؛ بدون سقف، چند اتصالِ هم‌زمانِ یک
# کاربر (یا چند کاربر) حافظهٔ فرایند API را اشباع می‌کند. سقف‌ها
# درونِ فرایندند (هر worker سهم خودش را دارد)؛ در استقرارِ
# چندworker، سقفِ سراسری نیازمند limiter مشترک (Redis) است.
# کاربر در لحظه فقط یک تلاوت می‌خواند، پس سقفِ هر کاربر ۱ است؛
# سقفِ کل ۴ است تا روی جعبهٔ ۱ گیگابایتی، حافظهٔ مدل‌ها (~۴×۸۰MB)
# + مدلِ کش‌شدهٔ مسیر ضبطی + نگاشت واجی جا بشود. ردشدن با کد
# `hifz_too_many_streams` و بستن ۴۴۰۹ است، نه خطای مبهم.
MAX_LIVE_STREAMS_PER_USER = 1
MAX_LIVE_STREAMS_TOTAL = 4


class LiveStreamLimiter:
    """سقف اتصال زندهٔ هم‌زمان — هر کاربر یکی، کل فرایند N تا.

    `try_acquire(user_id)`: True یعنی جا هست و شمرده شد؛ False یعنی
    سقف پر است و چیزی شمرده نشد. هر acquire موفق دقیقاً یک
    `release(user_id)` می‌خواهد (در `finally` فراخواننده).
    """

    def __init__(
        self,
        *,
        max_per_user: int = MAX_LIVE_STREAMS_PER_USER,
        max_total: int = MAX_LIVE_STREAMS_TOTAL,
    ) -> None:
        self._max_per_user = max_per_user
        self._max_total = max_total
        self._per_user: dict[UUID, int] = {}
        self._total = 0
        self._lock = asyncio.Lock()

    async def try_acquire(self, user_id: UUID) -> bool:
        async with self._lock:
            if self._total >= self._max_total:
                return False
            if self._per_user.get(user_id, 0) >= self._max_per_user:
                return False
            self._per_user[user_id] = self._per_user.get(user_id, 0) + 1
            self._total += 1
            return True

    async def release(self, user_id: UUID) -> None:
        async with self._lock:
            current = self._per_user.get(user_id, 0)
            if current <= 0:
                return
            if current == 1:
                del self._per_user[user_id]
            else:
                self._per_user[user_id] = current - 1
            self._total -= 1

    def active_total(self) -> int:
        return self._total

    def active_for(self, user_id: UUID) -> int:
        return self._per_user.get(user_id, 0)


# نمونهٔ مشترکِ فرایند برای `stream_attempt` در `hifz_router.py`.
live_stream_limiter = LiveStreamLimiter()
