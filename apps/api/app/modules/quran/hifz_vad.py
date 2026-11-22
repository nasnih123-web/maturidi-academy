"""دروازهٔ گفتارِ سبکِ انرژی/RMS برای مسیر حفاظ (پیشنهاد ۱۲).

فقط مسیر حفاظ؛ مسیر STT عمومی دست نمی‌خورد (همان‌جا vad_filter
دارد). قاب‌های زیر آستانهٔ سکوت از جریانِ واجی حذف می‌شوند؛ ضبطی
که هیچ گفتاری ندارد، خطای صادقانهٔ «صدایی شنیده نشد» می‌گیرد، نه
نمره‌های غلط/جاافتاده.

کالیبراسیون از روی فایلِ واقعیِ کاربر (fatiha-16k.wav، ۴۴٫۵ ثانیه،
۲۲۲۷ قابِ ۲۰ms): گفتارِ میانه −۱۹٫۵ dBFS و بلندترین −۱۰٫۴ است؛
آغازِ آرامِ بسمله از −۶۵ dBFS در ~۰٫۴ ثانیه تا −۴۵ بالا می‌آید؛
سکوتِ دیجیتال −۱۲۰ است. پس یک آستانهٔ واحد، یا آغازِ آرام را
می‌خورد (−۴۵) یا نویزِ اتاق را گفتار می‌خواند (−۶۵). راه‌حل، دو
آستانه با هیسترزیس است: شروعِ گفتار در −۶۰، پایان در −۵۰، با ۲
قاب پیش‌نگه‌داشت (۴۰ms — تا آغازِ کلمه بریده نشود) و ۵ قاب
پس‌نگه‌داشت (۱۰۰ms — تا دمِ کلمه و مکث‌های کوتاهِ بینِ کلمه‌ها
نریزد). با این‌ها، نخستین قابِ گفتارِ فاتحه در ~۰٫۲ ثانیه گرفته
می‌شود و نسخهٔ ۰٫۲۵ برابریِ آن (۱۲- dB آرام‌تر) هم هنوز گفتار
شناخته می‌شود.

محدودهٔ آگاهانه: این دروازهٔ انرژی است، نه طبقه‌بندِ گفتار در
برابرِ غیرگفتار؛ سوتِ بلند (پرانرژی) از آن می‌گذرد و دیکد می‌شود.
جلوگیری از سوت، VADِ مدلی (مثل Silero) می‌خواهد که بیرونِ
دامنهٔ این آیتم است. محاسبات، stdlib خالص‌اند (بدون numpy).
"""

from __future__ import annotations

import io
import math
import struct
import wave
from collections.abc import Sequence

from app.core.errors import APIError

SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # ۳۲۰ نمونه
#: شروعِ گفتار: حساس — تا آغازِ آرامِ کلمه (رامپِ −۶۵ تا −۴۵ در
#: فاتحهٔ کاربر) گرفته شود.
START_THRESHOLD_DBFS = -60.0
#: پایانِ گفتار: سخت‌گیرانه‌تر — مکثِ بینِ کلمه‌ها گفتار نمی‌ماند.
END_THRESHOLD_DBFS = -50.0
#: پیش‌نگه‌داشت: ۲ قاب (۴۰ms) پیش از نخستین قابِ گفتار هم نگه
#: داشته می‌شود تا آغازِ کلمه بریده نشود.
PRE_ROLL_FRAMES = 2
#: پس‌نگه‌داشت: ۵ قاب (۱۰۰ms) پس از آخرین قابِ گفتار هم نگه
#: داشته می‌شود تا دمِ کلمه و مکثِ کوتاه نریزد.
HANGOVER_FRAMES = 5


def frame_dbfs(samples: Sequence[int]) -> float:
    """RMS یک قاب (نمونه‌های int16) بر حسب dBFS؛ سکوتِ کامل −۱۲۰."""
    if not samples:
        return -120.0
    mean_sq = sum(s * s for s in samples) / len(samples)
    if mean_sq <= 0:
        return -120.0
    return 20.0 * math.log10(math.sqrt(mean_sq) / 32768.0)


def _frame_levels(pcm16: bytes) -> list[float]:
    count = len(pcm16) // 2
    samples = struct.unpack(f"<{count}h", pcm16[: count * 2])
    return [
        frame_dbfs(samples[i : i + FRAME_SAMPLES])
        for i in range(0, count, FRAME_SAMPLES)
    ]


def speech_mask(pcm16: bytes) -> list[bool]:
    """به‌ازای هر قابِ ۲۰ms: گفتار است یا سکوت (دو آستانه +
    پیش‌نگه‌داشت + پس‌نگه‌داشت). قابِ ناقصِ پایانی هم یک قابِ
    عادی است — فقط نمونه‌های کمتری دارد."""
    levels = _frame_levels(pcm16)
    mask = [False] * len(levels)
    in_speech = False
    hangover = 0
    for i, db in enumerate(levels):
        if not in_speech:
            if db >= START_THRESHOLD_DBFS:
                in_speech = True
                hangover = HANGOVER_FRAMES
                for j in range(max(0, i - PRE_ROLL_FRAMES), i + 1):
                    mask[j] = True
            continue
        if db >= END_THRESHOLD_DBFS:
            mask[i] = True
            hangover = HANGOVER_FRAMES
        elif hangover > 0:
            mask[i] = True
            hangover -= 1
        else:
            in_speech = False
    return mask


def filter_silence(pcm16: bytes) -> bytes:
    """فقط قاب‌های گفتار را برگردان (به‌ترتیب)؛ سکوت حذف می‌شود.
    ورودیِ خالی یا سراسر سکوت → b""."""
    mask = speech_mask(pcm16)
    if not any(mask):
        return b""
    count = len(pcm16) // 2
    samples = struct.unpack(f"<{count}h", pcm16[: count * 2])
    kept: list[int] = []
    for i, keep in enumerate(mask):
        if keep:
            kept.extend(samples[i * FRAME_SAMPLES : (i + 1) * FRAME_SAMPLES])
    return struct.pack(f"<{len(kept)}h", *kept)


def has_speech(pcm16: bytes) -> bool:
    """آیا دست‌کم یک قابِ گفتار در این PCM هست؟"""
    return any(speech_mask(pcm16))


def wav_pcm16(wav_bytes: bytes) -> bytes:
    """PCM خام یک WAV (پیش‌فرض: فراخواننده آن را با
    validate_wav_16k_mono اعتبارسنجی کرده است)."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        return wav.readframes(wav.getnframes())


def require_speech(wav_bytes: bytes) -> None:
    """ضبطِ بی‌گفتار → خطای صادقانهٔ ۴۲۲ با کد `hifz_no_speech`،
    نه نمرهٔ غلط/جاافتاده. WAV نامعتبر → همان `hifz_audio_format`
    مسیر اعتبارسنجی (نه خطای VAD)."""
    try:
        pcm = wav_pcm16(wav_bytes)
    except (wave.Error, EOFError, ValueError) as exc:
        raise APIError(
            422, "hifz_audio_format", "صدا باید فایل WAV معتبر باشد"
        ) from exc
    if not has_speech(pcm):
        raise APIError(
            422,
            "hifz_no_speech",
            "در این ضبط صدایی شنیده نشد؛ دوباره با صدای بلندتر بخوانید.",
        )
